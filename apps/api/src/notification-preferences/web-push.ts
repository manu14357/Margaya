import {
  createCipheriv,
  createECDH,
  createPrivateKey,
  type ECDH,
  hkdfSync,
  randomBytes,
  sign,
} from "node:crypto";

// Web push on node:crypto: message encryption (RFC 8291) and server
// identification (VAPID, RFC 8292). Building the request here, rather than in a
// client library that sends it too, lets every push go through
// sendOutboundRequest and its check on the browser-supplied endpoint.

const CURVE = "prime256v1";
const RECORD_SIZE = 4096;
const TOKEN_LIFETIME_SECONDS = 12 * 60 * 60;
const DEFAULT_TTL_SECONDS = 24 * 60 * 60;
// Only used when the instance names no contact and has no public HTTPS address.
// Push services may refuse it (Apple's among them), so startup warns while it's
// in use.
const FALLBACK_SUBJECT = "mailto:admin@example.com";
// Names reserved for examples and tests (RFC 2606, RFC 6761): nobody reads
// mail there, and a push service can't reach anyone through them.
const RESERVED_HOST =
  /(^|\.)(example\.(com|net|org)|example|test|invalid|localhost)$/i;

export type VapidConfig = {
  publicKey: string;
  privateKey: string;
  subject: string;
};

export type PushKeys = { p256dh: string; auth: string };

export type PushUrgency = "normal" | "high";

function decode(value: string) {
  return Buffer.from(value, "base64url");
}

export function isP256PublicKey(value: string) {
  const key = decode(value);
  if (key.length !== 65 || key[0] !== 4) return false;
  try {
    const ecdh = createECDH(CURVE);
    ecdh.generateKeys();
    ecdh.computeSecret(key);
    return true;
  } catch {
    return false;
  }
}

export function isPushAuthSecret(value: string) {
  return decode(value).length === 16;
}

function isKeyPair(publicKey: string, privateKey: string) {
  try {
    const ecdh = createECDH(CURVE);
    ecdh.setPrivateKey(decode(privateKey));
    return ecdh.getPublicKey("base64url") === publicKey;
  } catch {
    return false;
  }
}

function vapidSubject() {
  const subject = process.env.VAPID_SUBJECT?.trim();
  if (subject) return { subject, source: "VAPID_SUBJECT" };
  const clientUrl = process.env.MARGAYA_CLIENT_URL?.trim();
  return clientUrl?.startsWith("https://")
    ? { subject: clientUrl.replace(/\/+$/, ""), source: "MARGAYA_CLIENT_URL" }
    : { subject: FALLBACK_SUBJECT, source: null };
}

const USE_A_REAL_CONTACT =
  "Set VAPID_SUBJECT to a mailto: address you read, or set MARGAYA_CLIENT_URL to this server's https:// address.";

/** Why push services may refuse this contact, or null when it looks usable. */
function subjectProblem(subject: string): string | null {
  let host: string | undefined;
  try {
    const url = new URL(subject);
    if (url.protocol === "https:") host = url.hostname;
    else if (url.protocol === "mailto:") {
      const at = url.pathname.lastIndexOf("@");
      host = at > 0 ? url.pathname.slice(at + 1) : undefined;
    }
  } catch {}
  // Not echoed: it isn't a contact anyone chose to publish.
  if (!host) {
    return `VAPID_SUBJECT must be a mailto: address or an https:// URL, and push services may refuse this one. ${USE_A_REAL_CONTACT}`;
  }
  return RESERVED_HOST.test(host)
    ? `Push services see this server's contact as ${subject}, an example address that some of them, Apple's among them, may refuse. ${USE_A_REAL_CONTACT}`
    : null;
}

/** Startup: says so when push is on but its contact may be refused. */
export function warnAboutPushSubject() {
  const vapid = getVapidConfig();
  const problem = vapid && subjectProblem(vapid.subject);
  if (problem) console.warn(`Web push: ${problem}`);
}

/**
 * What the admin CLI's generate-push-keys prints: the two keys, and comments on
 * the contact, so the whole output can go into .env.
 */
export function pushKeysEnvLines(keys = generateVapidKeys()) {
  const { subject, source } = vapidSubject();
  const problem = subjectProblem(subject);
  const note = problem
    ? problem
    : `Push services will see this server's contact as ${subject}, from ${source}.`;
  return [
    `VAPID_PUBLIC_KEY=${keys.publicKey}`,
    `VAPID_PRIVATE_KEY=${keys.privateKey}`,
    ...wrap(note).map((line) => `# ${line}`),
  ];
}

function wrap(text: string, width = 76) {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line && line.length + word.length + 1 > width) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  return line ? [...lines, line] : lines;
}

let warnedAboutKeys = false;

/** The instance's push identity, or null when push isn't set up. */
export function getVapidConfig(): VapidConfig | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey && !privateKey) return null;
  if (!publicKey || !privateKey || !isKeyPair(publicKey, privateKey)) {
    if (!warnedAboutKeys) {
      warnedAboutKeys = true;
      console.warn(
        "Web push is off: VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are not a valid key pair. Generate one with the admin CLI's generate-push-keys command.",
      );
    }
    return null;
  }
  return { publicKey, privateKey, subject: vapidSubject().subject };
}

export function generateVapidKeys() {
  const ecdh = createECDH(CURVE);
  ecdh.generateKeys();
  return {
    publicKey: ecdh.getPublicKey("base64url"),
    privateKey: ecdh.getPrivateKey("base64url"),
  };
}

function vapidAuthorization(endpoint: string, vapid: VapidConfig) {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${encode({ typ: "JWT", alg: "ES256" })}.${encode({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + TOKEN_LIFETIME_SECONDS,
    sub: vapid.subject,
  })}`;
  const publicKey = decode(vapid.publicKey);
  const signature = sign("sha256", Buffer.from(unsigned), {
    key: createPrivateKey({
      format: "jwk",
      key: {
        kty: "EC",
        crv: "P-256",
        d: vapid.privateKey,
        x: publicKey.subarray(1, 33).toString("base64url"),
        y: publicKey.subarray(33).toString("base64url"),
      },
    }),
    dsaEncoding: "ieee-p1363",
  });
  return `vapid t=${unsigned}.${signature.toString("base64url")}, k=${vapid.publicKey}`;
}

/**
 * The aes128gcm body of one push message. `salt` and `ecdh` are fresh for every
 * message and only passed in by the RFC's test vector.
 */
export function encryptPushPayload(
  payload: string,
  keys: PushKeys,
  fixed: { salt?: Buffer; ecdh?: ECDH } = {},
) {
  const salt = fixed.salt ?? randomBytes(16);
  const ecdh = fixed.ecdh ?? createECDH(CURVE);
  if (!fixed.ecdh) ecdh.generateKeys();

  const receiverKey = decode(keys.p256dh);
  const senderKey = ecdh.getPublicKey();
  const secret = hkdfSync(
    "sha256",
    ecdh.computeSecret(receiverKey),
    decode(keys.auth),
    Buffer.concat([Buffer.from("WebPush: info\0"), receiverKey, senderKey]),
    32,
  );
  const contentKey = hkdfSync(
    "sha256",
    Buffer.from(secret),
    salt,
    "Content-Encoding: aes128gcm\0",
    16,
  );
  const nonce = hkdfSync(
    "sha256",
    Buffer.from(secret),
    salt,
    "Content-Encoding: nonce\0",
    12,
  );

  const cipher = createCipheriv(
    "aes-128-gcm",
    Buffer.from(contentKey),
    Buffer.from(nonce),
  );
  // 0x02 marks this as the last (and only) record.
  const encrypted = Buffer.concat([
    cipher.update(Buffer.from(payload)),
    cipher.update(Buffer.from([2])),
    cipher.final(),
    cipher.getAuthTag(),
  ]);

  const recordSize = Buffer.alloc(4);
  recordSize.writeUInt32BE(RECORD_SIZE);
  return Buffer.concat([
    salt,
    recordSize,
    Buffer.from([senderKey.length]),
    senderKey,
    encrypted,
  ]);
}

/** Headers and body for one push, for sendOutboundRequest to deliver. */
export function buildPushRequest(input: {
  endpoint: string;
  keys: PushKeys;
  payload: string;
  urgency: PushUrgency;
  vapid: VapidConfig;
}) {
  return {
    headers: {
      Authorization: vapidAuthorization(input.endpoint, input.vapid),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(DEFAULT_TTL_SECONDS),
      Urgency: input.urgency,
    },
    body: new Uint8Array(
      encryptPushPayload(input.payload, input.keys),
    ) as BodyInit,
  };
}
