import { createHmac } from "node:crypto";

// Authenticator-app codes for test accounts. LOCAL TESTING ONLY.

/** The raw secret behind an otpauth:// URI (base32 in the URI). */
function secretOf(totpURI: string): Buffer {
  const encoded = new URL(totpURI).searchParams.get("secret") ?? "";
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of encoded.replace(/=+$/, "").toUpperCase()) {
    bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  return Buffer.from(bytes);
}

/** RFC 6238 TOTP: HMAC-SHA1, 30-second steps, 6 digits. */
export function totpCode(totpURI: string): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", secretOf(totpURI)).update(counter).digest();
  const offset = (digest[digest.length - 1] ?? 0) & 0xf;
  const value = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(value % 1_000_000).padStart(6, "0");
}
