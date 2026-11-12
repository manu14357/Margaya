import { createHmac, timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
  z,
} from "../openapi";
import { clientIp } from "../public-board/limits";
import { boundedRequestBody } from "../utils/bounded-request-body";
import { createRateLimiter, enforceRateLimits } from "../utils/rate-limit";
import { inboundWebhookSecret, intakeEmailLimits } from "./config";
import {
  type InboundMail,
  inboundFromParsed,
  receiveInboundMail,
} from "./inbound";
import {
  type MailAttachment,
  mailBodyText,
  parseAddressList,
  parseMail,
  parseMessageIds,
} from "./mime";

// The inbound mail webhook (#8): a mail provider (or a local MTA script)
// POSTs each message here, either parsed as JSON or as the raw message.
// Mounted before the app-wide auth middleware; it authenticates with the
// instance secret INTAKE_EMAIL_WEBHOOK_SECRET and answers 404 without one.

const TAGS = ["Intake email"];
const WEBHOOK_PATH = "/inbound";

type InboundVariables = BaseVariables & { inboundBody: Uint8Array };

const webhookLimiter = createRateLimiter({
  name: "intake-email-webhook",
  windowSeconds: 60,
  max: 600,
});

const addressField = z.union([
  z.string().max(10_000),
  z.array(z.string().max(1_000)).max(500),
]);

export const inboundMailBody = z
  .object({
    raw: z.string().optional().openapi({
      description:
        "The whole RFC 5322 message, base64-encoded. When present, the other fields are ignored (envelope recipients still count).",
    }),
    from: z.string().max(2_000).optional(),
    to: addressField.optional(),
    cc: addressField.optional(),
    recipients: z.array(z.string().max(1_000)).max(500).optional().openapi({
      description:
        "Envelope recipients. A project is found through its forwarding address in these, To or Cc.",
    }),
    subject: z.string().max(10_000).optional(),
    text: z.string().optional(),
    html: z.string().optional(),
    messageId: z.string().max(2_000).optional(),
    inReplyTo: z.string().max(10_000).optional(),
    references: addressField.optional(),
    headers: z
      .record(z.string(), z.union([z.string(), z.array(z.string())]))
      .optional()
      .openapi({
        description:
          "Original headers, used for loop, bounce and spam checks (Auto-Submitted, Precedence, X-Spam-Flag ...).",
      }),
    spamScore: z.number().optional().openapi({
      description: "The provider's spam score; 5 or more is refused as spam.",
    }),
    attachments: z
      .array(
        z.object({
          filename: z.string().max(1_000),
          contentType: z.string().max(255).optional(),
          content: z.string().openapi({ description: "Base64." }),
        }),
      )
      .max(100)
      .optional(),
  })
  .openapi("InboundMail");

const inboundResultSchema = z
  .object({
    results: z.array(
      z.object({
        status: z.enum(["created", "commented", "ignored"]),
        reason: z.string().nullable(),
      }),
    ),
  })
  .openapi("InboundMailResult");

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Bearer or Basic (password) secret, or an HMAC-SHA256 of the body. */
export function webhookAuthorized(
  secret: string,
  body: Uint8Array,
  authorization: string | undefined,
  signature: string | undefined,
): boolean {
  if (signature) {
    const expected = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
    if (safeEqual(signature.trim().toLowerCase(), expected)) return true;
  }
  const auth = authorization?.trim() ?? "";
  if (/^bearer\s+/i.test(auth)) {
    return safeEqual(auth.replace(/^bearer\s+/i, ""), secret);
  }
  if (/^basic\s+/i.test(auth)) {
    const decoded = Buffer.from(
      auth.replace(/^basic\s+/i, ""),
      "base64",
    ).toString("utf8");
    const password = decoded.slice(decoded.indexOf(":") + 1);
    return safeEqual(password, secret);
  }
  return false;
}

function requireWebhookSecret(): MiddlewareHandler {
  return async (c, next) => {
    // Off unless configured: the route doesn't exist.
    if (!inboundWebhookSecret()) {
      throw new HTTPException(404, { message: "Not found" });
    }
    await enforceRateLimits([[webhookLimiter, clientIp(c)]]);
    return next();
  };
}

function bounded(): MiddlewareHandler {
  return async (c, next) => {
    const { maxMessageBytes } = intakeEmailLimits();
    // Base64 grows a message by a third; JSON adds a little more.
    return boundedRequestBody(
      Math.ceil(maxMessageBytes * 1.4) + 256 * 1024,
      60_000,
    )(c, next);
  };
}

function authenticate(): MiddlewareHandler<{ Variables: InboundVariables }> {
  return async (c, next) => {
    const secret = inboundWebhookSecret() as string;
    const body = new Uint8Array(await c.req.raw.clone().arrayBuffer());
    if (
      !webhookAuthorized(
        secret,
        body,
        c.req.header("authorization"),
        c.req.header("x-margaya-signature"),
      )
    ) {
      throw new HTTPException(401, { message: "Invalid signature or secret" });
    }
    c.set("inboundBody", body);
    return next();
  };
}

function list(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value.join(", ") : (value ?? "");
}

function headerMap(
  headers: Record<string, string | string[]> | undefined,
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const [name, value] of Object.entries(headers ?? {})) {
    map.set(name.toLowerCase(), Array.isArray(value) ? value : [value]);
  }
  return map;
}

/** An `InboundMail` from the webhook's JSON. */
export function inboundFromJson(
  body: z.infer<typeof inboundMailBody>,
  size: number,
): InboundMail {
  const envelope = body.recipients ?? [];
  if (body.raw) {
    const raw = Buffer.from(body.raw, "base64");
    return inboundFromParsed(parseMail(raw), raw.byteLength, envelope);
  }
  const headers = headerMap(body.headers);
  const from = parseAddressList(body.from)[0] ?? null;
  const to = parseAddressList(list(body.to));
  const cc = parseAddressList(list(body.cc));
  const attachments: MailAttachment[] = (body.attachments ?? []).map(
    (file) => ({
      filename: file.filename,
      contentType: file.contentType ?? "application/octet-stream",
      content: Buffer.from(file.content, "base64"),
    }),
  );
  const parsedLike = {
    headers,
    from,
    to,
    cc,
    subject: body.subject ?? "",
    messageId:
      parseMessageIds(body.messageId)[0] ??
      (body.messageId?.trim() ? body.messageId.trim() : null),
    inReplyTo: parseMessageIds(body.inReplyTo),
    references: parseMessageIds(list(body.references)),
    contentType:
      headers.get("content-type")?.[0]?.split(";")[0]?.trim().toLowerCase() ??
      "text/plain",
    text: body.text ?? "",
    html: body.html ?? "",
    attachments,
  };
  const mail = inboundFromParsed(parsedLike, size, envelope);
  return { ...mail, text: mailBodyText(parsedLike), spamScore: body.spamScore };
}

const inboundRoute = createRoute({
  method: "post",
  operationId: "receiveIntakeEmail",
  path: WEBHOOK_PATH,
  tags: TAGS,
  summary: "Receive an email",
  description:
    "Files an inbound email into the intake of the project whose forwarding address it was sent to: a new request, or a comment when it replies to one from the same sender. Send JSON (parsed fields, or `raw` with the base64 message) or the raw message as message/rfc822. Authenticate with the instance's INTAKE_EMAIL_WEBHOOK_SECRET as a Bearer token, as the Basic auth password, or with X-Margaya-Signature: sha256=<HMAC-SHA256 of the body>. Loops, bounces, auto-replies, spam, blocked senders, repeats and senders over the rate limit are answered 200 with status ignored, so providers don't retry them. Answers 404 while no secret is configured.",
  security: [],
  middleware: [requireWebhookSecret(), bounded(), authenticate()] as const,
  request: {
    body: {
      required: false,
      content: {
        "application/json": { schema: inboundMailBody },
        "message/rfc822": {
          schema: z.string().openapi({ format: "binary" }),
        },
      },
    },
  },
  responses: {
    200: jsonResponse("What became of the message", inboundResultSchema),
    400: errorResponse("Invalid body"),
    401: errorResponse("Missing or wrong secret or signature"),
    404: errorResponse("The webhook isn't configured"),
    413: errorResponse("Request body is too large"),
    429: errorResponse("Too many requests; see Retry-After"),
  },
});

const intakeEmailInbound = apiRouter<InboundVariables>().openapi(
  inboundRoute,
  async (c) => {
    const body = c.get("inboundBody");
    const type = c.req.header("content-type")?.toLowerCase() ?? "";
    let mail: InboundMail;
    if (type.includes("json")) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(Buffer.from(body).toString("utf8"));
      } catch {
        throw new HTTPException(400, { message: "Invalid JSON" });
      }
      const result = inboundMailBody.safeParse(parsed);
      if (!result.success) {
        throw new HTTPException(400, { message: "Invalid body" });
      }
      mail = inboundFromJson(result.data, body.byteLength);
    } else {
      const raw = Buffer.from(body);
      if (raw.byteLength === 0) {
        throw new HTTPException(400, { message: "Empty message" });
      }
      mail = inboundFromParsed(parseMail(raw), raw.byteLength);
    }
    const outcomes = await receiveInboundMail(mail, { kind: "instance" });
    return c.json(
      {
        results: outcomes.map((outcome) => ({
          status: outcome.status,
          reason: outcome.status === "ignored" ? outcome.reason : null,
        })),
      },
      200,
    );
  },
);

export default intakeEmailInbound;
