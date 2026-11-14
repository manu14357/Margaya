// Random identifiers. The alphabet has exactly 64 symbols, so masking a random
// byte with 63 picks each symbol with equal probability.
const ID_SYMBOLS =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_-";

export const ELEMENT_ID_LENGTH = 21;

function randomBytes(count: number): Uint8Array {
  const bytes = new Uint8Array(count);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

function randomUint31(): number {
  const bytes = randomBytes(4);
  return (
    ((bytes[0] << 23) |
      (bytes[1] << 15) |
      (bytes[2] << 7) |
      (bytes[3] >> 1)) >>>
    0
  );
}

/** A 21-character URL-safe random id. */
export function newElementId(): string {
  let id = "";
  for (const byte of randomBytes(ELEMENT_ID_LENGTH)) {
    id += ID_SYMBOLS[byte & 63];
  }
  return id;
}

/** A positive 31-bit integer used to seed an element's hand-drawn look. */
export function randomSeed(): number {
  return randomUint31() || 1;
}

/** A 31-bit integer used to break ties between equal element versions. */
export function randomNonce(): number {
  return randomUint31();
}
