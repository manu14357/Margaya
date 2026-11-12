import {
  createHash,
  createPrivateKey,
  createPublicKey,
  hkdfSync,
  type KeyObject,
  sign,
  verify,
} from "node:crypto";
import { resolveAuthSecret } from "../utils/auth-secret";

// Signed Agent Cards (A2A 1.0): a JWS (RFC 7515) over the card's JSON
// Canonicalization Scheme form (RFC 8785), with the `signatures` field left
// out of what is signed. The key is Ed25519, derived from AUTH_SECRET, so
// every instance of a deployment signs with the same key without storing
// one; the public half is served as a JWK Set and named by `jku` and `kid`.
// Changing AUTH_SECRET rotates the key.

export const AGENT_CARD_JWKS_PATH = "/.well-known/agent-card-jwks.json";

/** RFC 8785 JSON Canonicalization Scheme. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new TypeError("JCS cannot encode a non-finite number");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value
      .map((item) => (item === undefined ? "null" : canonicalJson(item)))
      .join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  // Keys sort by UTF-16 code units, which is what JS string comparison does.
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

// PKCS#8 wrapper for a raw 32-byte Ed25519 seed.
const ED25519_PKCS8_PREFIX = Buffer.from(
  "302e020100300506032b657004220420",
  "hex",
);

type SigningKey = {
  privateKey: KeyObject;
  publicJwk: { kty: string; crv: string; x: string };
  kid: string;
};

let cached: { secret: string; key: SigningKey } | null = null;

export function agentCardSigningKey(
  authSecret: string = resolveAuthSecret(),
): SigningKey {
  if (cached?.secret === authSecret) return cached.key;
  const seed = Buffer.from(
    hkdfSync("sha256", authSecret, "margaya-a2a", "margaya:agent-card:v1", 32),
  );
  const privateKey = createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]),
    format: "der",
    type: "pkcs8",
  });
  const jwk = createPublicKey(privateKey).export({ format: "jwk" }) as {
    kty: string;
    crv: string;
    x: string;
  };
  const publicJwk = { kty: jwk.kty, crv: jwk.crv, x: jwk.x };
  // RFC 7638 thumbprint.
  const kid = createHash("sha256")
    .update(canonicalJson(publicJwk))
    .digest("base64url");
  const key = { privateKey, publicJwk, kid };
  cached = { secret: authSecret, key };
  return key;
}

/** The JWK Set clients verify card signatures with. */
export function agentCardJwks() {
  const { publicJwk, kid } = agentCardSigningKey();
  return { keys: [{ ...publicJwk, kid, use: "sig", alg: "EdDSA" }] };
}

export type AgentCardSignature = { protected: string; signature: string };

/** The card with one signature in `signatures` (any old ones dropped). */
export function signAgentCard<T extends Record<string, unknown>>(
  card: T,
  jku: string,
): T & { signatures: AgentCardSignature[] } {
  const { signatures: _old, ...content } = card;
  const { privateKey, kid } = agentCardSigningKey();
  const header = Buffer.from(
    JSON.stringify({ alg: "EdDSA", typ: "JOSE", kid, jku }),
  ).toString("base64url");
  const payload = Buffer.from(canonicalJson(content)).toString("base64url");
  const signature = sign(
    null,
    Buffer.from(`${header}.${payload}`),
    privateKey,
  ).toString("base64url");
  return {
    ...(content as T),
    signatures: [{ protected: header, signature }],
  };
}

/** Verifies a card's signature against a public JWK (for tests and clients). */
export function verifyAgentCard(
  card: Record<string, unknown>,
  jwk: { kty: string; crv: string; x: string },
): boolean {
  const signatures = card.signatures as AgentCardSignature[] | undefined;
  const first = signatures?.[0];
  if (!first) return false;
  const { signatures: _drop, ...content } = card;
  const payload = Buffer.from(canonicalJson(content)).toString("base64url");
  try {
    return verify(
      null,
      Buffer.from(`${first.protected}.${payload}`),
      createPublicKey({ key: jwk, format: "jwk" }),
      Buffer.from(first.signature, "base64url"),
    );
  } catch {
    return false;
  }
}
