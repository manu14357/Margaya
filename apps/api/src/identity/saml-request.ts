import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import type { GenericEndpointContext } from "better-auth";
import * as samlifyModule from "samlify";

// A SAML response must answer a request this server made for this connection, so
// an unsolicited response is refused, and one meant for elsewhere can't be used
// here. Better Auth's SSO plugin means to check this but doesn't: 1.6.25 reads
// `extract.inResponseTo`, which the SAML library never sets (it is
// `extract.response.inResponseTo`). So with its `allowIdpInitiated` left on, it
// lets every response through, and with it off, it refuses every response.
//
// The plugin still records each request when sign-in starts, under the key below,
// and the check happens here. A plugin version that fixes this would find the
// record already used and refuse everything, which the SAML integration tests
// catch: drop the request check when upgrading to one.
//
// That alone doesn't stop someone with an account at the identity provider from
// capturing their own unused response and auto-posting it from their page, which
// would sign you in to their account. So the response must also arrive in the
// browser that made the request, shown by a cookie set when sign-in starts.
//
// The post comes from the provider's site. On HTTPS the cookie is SameSite=None
// and Secure, so it comes back on that post. Plain HTTP can't have a Secure
// cookie, and a Lax one stays behind on a cross-site post, so there the post
// without it gets a page of ours that posts the same form again (repostPage).
// That post is same-site, so the Lax cookie comes along and is checked. The page
// says it's the re-post, and a re-post without the cookie is refused, so it's
// offered once. Both posts come before anything is verified or used up.

const AUTHN_REQUEST_KEY_PREFIX = "saml-authn-request:";

const REQUEST_COOKIE_PATH = "/api/auth/sso/saml2/sp/acs";
// As long as the plugin keeps a request (its requestTTL default).
const REQUEST_COOKIE_MAX_AGE = 300;

// The field the re-post page adds. A first post claiming it only goes without the
// page, so it decides nothing in anyone's favour.
const REPOST_FIELD = "samlRepost";

// The re-post page's script is a file of its own: in the bundled image the web
// server adds its page policy to API answers too, and that allows scripts from
// this origin but no inline or hashed one.
export const REPOST_SCRIPT_PATH = "/api/auth/sso/saml2/sp/continue.js";
export const REPOST_SCRIPT = "document.forms[0].submit();\n";

// The page may run only that script. form-action isn't set: browsers that check
// it also check where the post then redirects, which is the web app, on another
// origin on split-host installs.
const REPOST_PAGE_POLICY =
  "default-src 'none'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'";

// What the response is made of, so it can be repeated back. Anything else a
// lenient base64 decoder would skip over, and the page must not carry it.
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

// The library is CommonJS, and how it arrives depends on the loader.
type Samlify = typeof samlifyModule;
const samlify =
  (samlifyModule as unknown as { default?: Samlify }).default ?? samlifyModule;

// With two names the extractor reports every matching element, not only the first.
const ALGORITHM = ["Algorithm", "Algorithm"];

// Where the library looks for the signatures it verifies, so these are the ones
// that count. The plugin's own algorithm check reads only the redirect binding's
// SigAlg, so with the POST binding it never sees them.
const SIGNATURE_FIELDS = [["Response"], ["Response", "Assertion"]].flatMap(
  (signed, index) => [
    {
      key: `signatureMethod${index}`,
      localPath: [...signed, "Signature", "SignedInfo", "SignatureMethod"],
      attributes: ALGORITHM,
    },
    {
      key: `digestMethod${index}`,
      localPath: [
        ...signed,
        "Signature",
        "SignedInfo",
        "Reference",
        "DigestMethod",
      ],
      attributes: ALGORITHM,
    },
  ],
);

const STRONG_SIGNATURE = /#(rsa|ecdsa)-sha(256|384|512)$/;
const STRONG_DIGEST = /#sha(256|384|512)$/;

type Algorithm = { algorithm?: string } | { algorithm?: string }[];
type Extracted = {
  response?: { inResponseTo?: string };
  confirmation?: { inResponseTo?: string } | { inResponseTo?: string }[];
  signatureMethod0?: Algorithm;
  signatureMethod1?: Algorithm;
  digestMethod0?: Algorithm;
  digestMethod1?: Algorithm;
};

function readResponse(samlResponse: string): Extracted | null {
  try {
    const xml = Buffer.from(
      samlResponse.replace(/\s+/g, ""),
      "base64",
    ).toString("utf8");
    return samlify.Extractor.extract(xml, [
      {
        key: "response",
        localPath: ["Response"],
        attributes: ["ID", "InResponseTo"],
      },
      {
        key: "confirmation",
        localPath: [
          "Response",
          "Assertion",
          "Subject",
          "SubjectConfirmation",
          "SubjectConfirmationData",
        ],
        attributes: ["Recipient", "InResponseTo"],
      },
      ...SIGNATURE_FIELDS,
    ]) as Extracted;
  } catch {
    return null;
  }
}

/**
 * The request a response answers. Only the bearer confirmation is trusted, as it
 * sits inside what the signature must cover (the assertion, or the whole
 * response); the attribute on the outer Response may be outside it. Nothing is
 * verified yet at this point: the plugin checks the signature next, and that
 * covers the value read here. It also refuses a second assertion, so this can't
 * be reading a different one from the one it verifies.
 */
function answeredRequestId(extracted: Extracted): string | null {
  const answered = new Set(
    ([] as { inResponseTo?: string }[])
      .concat(extracted.confirmation ?? [])
      .map((confirmation) => confirmation.inResponseTo)
      .filter((id): id is string => Boolean(id)),
  );
  const [id] = answered;
  if (!id || answered.size !== 1) return null;
  const outer = extracted.response?.inResponseTo;
  return outer && outer !== id ? null : id;
}

const algorithmsOf = (...found: (Algorithm | undefined)[]) =>
  found.flatMap((entry) => entry ?? []).map((entry) => entry.algorithm ?? "");

/** A signature that can't be trusted to last, such as anything SHA-1. */
function usesWeakAlgorithm(extracted: Extracted): boolean {
  return (
    algorithmsOf(extracted.signatureMethod0, extracted.signatureMethod1).some(
      (algorithm) => !STRONG_SIGNATURE.test(algorithm),
    ) ||
    algorithmsOf(extracted.digestMethod0, extracted.digestMethod1).some(
      (algorithm) => !STRONG_DIGEST.test(algorithm),
    )
  );
}

type CookieContext = Pick<GenericEndpointContext, "context">;

const bindsToBrowser = (ctx: CookieContext) =>
  ctx.context.baseURL.startsWith("https://");

// One cookie per request, so sign-ins started side by side don't undo each other.
// Hashed because the plugin decides what a request id looks like, and a cookie's
// name can't hold just anything.
function requestCookie(ctx: CookieContext, requestId: string) {
  const hash = createHash("sha256")
    .update(requestId)
    .digest("hex")
    .slice(0, 32);
  const https = bindsToBrowser(ctx);
  return ctx.context.createAuthCookie(`saml_request_${hash}`, {
    sameSite: https ? "none" : "lax",
    secure: https,
    httpOnly: true,
    // A partitioned cookie set while the app was on top wouldn't come back when
    // the assertion endpoint is.
    partitioned: false,
    path: REQUEST_COOKIE_PATH,
    maxAge: REQUEST_COOKIE_MAX_AGE,
  });
}

/** The id inside the redirect the plugin answered /sign-in/sso with. */
function requestIdInRedirect(url: unknown): string | null {
  if (typeof url !== "string") return null;
  try {
    const request = new URL(url).searchParams.get("SAMLRequest");
    if (!request) return null;
    const xml = inflateRawSync(Buffer.from(request, "base64")).toString("utf8");
    return xml.match(/\sID="([^"]+)"/)?.[1] ?? null;
  } catch {
    return null;
  }
}

/** Runs after the plugin answers /sign-in/sso: marks this browser as the asker. */
export function bindRequestToBrowser(
  ctx: CookieContext & Pick<GenericEndpointContext, "setCookie">,
) {
  const returned = ctx.context.returned as { url?: unknown } | undefined;
  const id = requestIdInRedirect(returned?.url);
  if (!id) return;
  const cookie = requestCookie(ctx, id);
  ctx.setCookie(cookie.name, "1", cookie.attributes);
}

/**
 * Uses up the request a response answers. Returns why the response is refused,
 * as a code for the sign-in screen; "repost" when the browser should post it
 * again, same-site, with the page from repostPage; or null when it may go on to
 * the plugin.
 */
export async function consumeAnsweredRequest(
  ctx: Pick<
    GenericEndpointContext,
    "body" | "params" | "context" | "getCookie"
  >,
): Promise<
  | "unsolicited_response"
  | "invalid_saml_response"
  | "saml_deprecated_algorithm"
  | "saml_other_browser"
  | "repost"
  | null
> {
  const extracted =
    typeof ctx.body?.SAMLResponse === "string"
      ? readResponse(ctx.body.SAMLResponse)
      : null;
  const id = extracted && answeredRequestId(extracted);
  if (!extracted || !id) return "unsolicited_response";
  if (usesWeakAlgorithm(extracted)) return "saml_deprecated_algorithm";
  // Ahead of using the request up, and of the signature check: nothing is verified
  // yet, and a response posted at someone mustn't spoil their sign-in.
  if (!ctx.getCookie(requestCookie(ctx, id).name)) {
    if (bindsToBrowser(ctx) || ctx.body?.[REPOST_FIELD] !== undefined) {
      return "saml_other_browser";
    }
    return repostable(ctx.body) ? "repost" : "invalid_saml_response";
  }

  const consumed = await ctx.context.internalAdapter.consumeVerificationValue(
    `${AUTHN_REQUEST_KEY_PREFIX}${id}`,
  );
  if (!consumed) return "invalid_saml_response";
  let request: { providerId?: unknown } | null = null;
  try {
    request = JSON.parse(consumed.value);
  } catch {}
  return request?.providerId === ctx.params?.providerId
    ? null
    : "invalid_saml_response";
}

// The plugin refuses anything bigger, so there's no point repeating it.
const MAX_REPOST_SIZE = 262_144;

function repostable(body: unknown): body is {
  SAMLResponse: string;
  RelayState?: string;
} {
  const { SAMLResponse, RelayState } = (body ?? {}) as Record<string, unknown>;
  return (
    typeof SAMLResponse === "string" &&
    SAMLResponse.length <= MAX_REPOST_SIZE &&
    BASE64.test(SAMLResponse.replace(/\s+/g, "")) &&
    (RelayState === undefined || typeof RelayState === "string")
  );
}

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

/**
 * The page that has the browser post the provider's form again, from this
 * origin, to the address it came to. Without its script (blocked, or scripts
 * off) the browser's own submit button does the same; it has no text of ours.
 */
export function repostPage(ctx: Pick<GenericEndpointContext, "body">) {
  const body = ctx.body as { SAMLResponse: string; RelayState?: string };
  const field = (name: string, value: string) =>
    `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`;
  const html = [
    '<!doctype html><html><head><meta charset="utf-8"><title>Margaya</title></head><body>',
    '<form method="post">',
    field("SAMLResponse", body.SAMLResponse.replace(/\s+/g, "")),
    body.RelayState === undefined ? "" : field("RelayState", body.RelayState),
    field(REPOST_FIELD, "1"),
    '<input type="submit"></form>',
    `<script src="${REPOST_SCRIPT_PATH}"></script>`,
    "</body></html>",
  ].join("");
  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": REPOST_PAGE_POLICY,
    },
  });
}
