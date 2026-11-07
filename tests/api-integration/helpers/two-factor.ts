import { createHmac } from "node:crypto";
import { expect } from "vitest";
import type { createApp } from "../../../apps/api/src/index";
import { authPost } from "./instance-admin";

type App = ReturnType<typeof createApp>["app"];

const PASSWORD = "correct horse battery staple";

/** The raw secret behind an otpauth:// URI (base32 in the URI). */
export function secretOf(totpURI: string): string {
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
  return Buffer.from(bytes).toString("utf8");
}

/** RFC 6238 TOTP: HMAC-SHA1, 30-second steps, 6 digits. */
export function codeFor(secret: string): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", Buffer.from(secret, "utf8"))
    .update(counter)
    .digest();
  const offset = (digest[digest.length - 1] ?? 0) & 0xf;
  const value = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(value % 1_000_000).padStart(6, "0");
}

/** Merges Set-Cookie answers into a cookie header. */
export function withCookies(previous: string, response: Response) {
  const jar = new Map(
    previous
      .split("; ")
      .filter(Boolean)
      .map((pair) => [pair.split("=")[0] ?? "", pair] as const),
  );
  for (const setCookie of response.headers.getSetCookie()) {
    const pair = setCookie.split(";")[0] ?? "";
    const name = pair.split("=")[0] ?? "";
    if (pair.split("=").slice(1).join("=") === "") jar.delete(name);
    else jar.set(name, pair);
  }
  return [...jar.values()].join("; ");
}

/** Turns two-factor on for a signed-in account; returns its new cookie. */
export async function enrol(app: App, cookie: string) {
  const enabled = await authPost(
    app,
    "/two-factor/enable",
    { password: PASSWORD },
    { cookie },
  );
  expect(enabled.status, await enabled.clone().text()).toBe(200);
  const body = (await enabled.json()) as {
    totpURI: string;
    backupCodes: string[];
  };
  const secret = secretOf(body.totpURI);
  const verified = await authPost(
    app,
    "/two-factor/verify-totp",
    { code: codeFor(secret) },
    { cookie },
  );
  expect(verified.status, await verified.clone().text()).toBe(200);
  return { cookie: withCookies(cookie, verified), secret };
}
