import { createHmac } from "node:crypto";
import * as email from "@margaya/email";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { resetRateLimitMemory } from "../../apps/api/src/utils/rate-limit";
import {
  authPost,
  issuedCookies,
  resetInstanceState,
  signUpWithSession,
} from "./helpers/instance-admin";

// Follow-up (a): TOTP two-factor with recovery codes through Better Auth's
// two-factor plugin: enrol, verify, the sign-in challenge, recovery codes,
// no email-link bypass, and turning it off.

type App = ReturnType<typeof createApp>["app"];

const PASSWORD = "correct horse battery staple";
const ADDRESS = "totp@example.com";

let app: App;
let cookie: string;
let userId: string;

/** The raw secret behind an otpauth:// URI (base32 in the URI). */
function secretOf(totpURI: string): string {
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
async function codeFor(secret: string): Promise<string> {
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
function withCookies(previous: string, response: Response) {
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

async function twoFactorEnabled() {
  const [row] = await db
    .select({ on: schema.userTable.twoFactorEnabled })
    .from(schema.userTable)
    .where(eq(schema.userTable.id, userId));
  return row?.on;
}

async function enrol() {
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
    { code: await codeFor(secret) },
    { cookie },
  );
  expect(verified.status, await verified.clone().text()).toBe(200);
  cookie = withCookies(cookie, verified);
  return { secret, backupCodes: body.backupCodes, totpURI: body.totpURI };
}

beforeEach(async () => {
  await resetInstanceState();
  resetRateLimitMemory();
  app = createApp().app;
  const signedUp = await signUpWithSession(app, ADDRESS);
  cookie = signedUp.cookie;
  userId = signedUp.user.id;
});

describe("two-factor authentication", () => {
  it("is on only once the first code checks", async () => {
    const enabled = await authPost(
      app,
      "/two-factor/enable",
      { password: PASSWORD },
      { cookie },
    );
    const body = (await enabled.json()) as {
      totpURI: string;
      backupCodes: string[];
    };
    expect(body.totpURI).toMatch(/^otpauth:\/\/totp\/Margaya:/);
    expect(body.backupCodes).toHaveLength(10);
    expect(await twoFactorEnabled()).toBe(false);

    const wrongPassword = await authPost(
      app,
      "/two-factor/enable",
      { password: "not my password at all" },
      { cookie },
    );
    expect(wrongPassword.status).toBe(400);
  });

  it("challenges password sign-in and accepts a code or a recovery code", async () => {
    const { secret, backupCodes } = await enrol();
    expect(await twoFactorEnabled()).toBe(true);
    // The secret and recovery codes are stored encrypted.
    const [stored] = await db
      .select()
      .from(schema.twoFactorTable)
      .where(eq(schema.twoFactorTable.userId, userId));
    expect(stored?.secret).not.toContain(secret);
    expect(stored?.backupCodes).not.toContain(backupCodes[0] ?? "x");

    const signIn = await authPost(app, "/sign-in/email", {
      email: ADDRESS,
      password: PASSWORD,
    });
    expect(signIn.status).toBe(200);
    expect(await signIn.json()).toMatchObject({ twoFactorRedirect: true });
    const challenge = issuedCookies(signIn);
    expect(challenge).not.toContain("session_token");
    expect(challenge).toContain("two_factor");

    const wrong = await authPost(
      app,
      "/two-factor/verify-totp",
      { code: "000000" },
      { cookie: challenge },
    );
    expect(wrong.status).toBeGreaterThanOrEqual(400);

    const right = await authPost(
      app,
      "/two-factor/verify-totp",
      { code: await codeFor(secret) },
      { cookie: challenge },
    );
    expect(right.status).toBe(200);
    expect(issuedCookies(right)).toContain("session_token");

    // A recovery code works once.
    const again = await authPost(app, "/sign-in/email", {
      email: ADDRESS,
      password: PASSWORD,
    });
    const challenge2 = issuedCookies(again);
    const recovery = await authPost(
      app,
      "/two-factor/verify-backup-code",
      { code: backupCodes[0] },
      { cookie: challenge2 },
    );
    expect(recovery.status).toBe(200);
    expect(issuedCookies(recovery)).toContain("session_token");

    const third = await authPost(app, "/sign-in/email", {
      email: ADDRESS,
      password: PASSWORD,
    });
    const reused = await authPost(
      app,
      "/two-factor/verify-backup-code",
      { code: backupCodes[0] },
      { cookie: issuedCookies(third) },
    );
    expect(reused.status).toBeGreaterThanOrEqual(400);
  });

  it("keeps email links and codes from skipping the second step", async () => {
    await enrol();
    const sendMagicLink = vi.spyOn(email, "sendMagicLinkEmail");
    const sendOtp = vi.spyOn(email, "sendOtpEmail");

    const link = await authPost(app, "/sign-in/magic-link", { email: ADDRESS });
    expect(link.status).toBe(200);
    expect(sendMagicLink).not.toHaveBeenCalled();

    const code = await authPost(app, "/email-otp/send-verification-otp", {
      email: ADDRESS,
      type: "sign-in",
    });
    expect(code.status).toBe(200);
    expect(sendOtp).not.toHaveBeenCalled();

    const otpSignIn = await authPost(app, "/sign-in/email-otp", {
      email: ADDRESS,
      otp: "123456",
    });
    expect(otpSignIn.status).toBe(400);
  });

  it("turns off with the password", async () => {
    await enrol();
    const disabled = await authPost(
      app,
      "/two-factor/disable",
      { password: PASSWORD },
      { cookie },
    );
    expect(disabled.status, await disabled.clone().text()).toBe(200);
    expect(await twoFactorEnabled()).toBe(false);

    const signIn = await authPost(app, "/sign-in/email", {
      email: ADDRESS,
      password: PASSWORD,
    });
    expect(signIn.status).toBe(200);
    expect(issuedCookies(signIn)).toContain("session_token");
  });
});
