import { describe, expect, it, vi } from "vitest";
import { createApp } from "../../apps/api/src/index";
import { resetTestDatabase } from "./helpers/database";

// D20: environment-only deployments behave exactly as before instance
// settings. These variables must be set before the auth module loads, as a
// deployment sets them before the server starts (vitest hoists this above
// the imports).
vi.hoisted(() => {
  process.env.DISABLE_GUEST_ACCESS = "true";
  process.env.DISABLE_EMAIL_OTP_SIGN_IN = "true";
});

const app = createApp().app;

function post(path: string, body: unknown) {
  return app.request(`/api/auth${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Origin: "http://localhost:5173",
    },
    body: JSON.stringify(body),
  });
}

/** What Better Auth answers for an endpoint no plugin registered. */
async function snapshot(response: Response) {
  return {
    status: response.status,
    contentType: response.headers.get("content-type"),
    body: await response.text(),
  };
}

async function unregisteredEndpoint(path: string) {
  return snapshot(await post(path, {}));
}

describe("D20: plugins turned off at startup answer as before", () => {
  it("guest sign-in answers like an unregistered endpoint (404)", async () => {
    const reference = await unregisteredEndpoint("/sign-in/no-such-method");
    expect(reference.status).toBe(404);
    expect(await snapshot(await post("/sign-in/anonymous", {}))).toEqual(
      reference,
    );
  });

  it("email-code paths answer like unregistered endpoints (404)", async () => {
    const reference = await unregisteredEndpoint("/email-otp/no-such-step");
    expect(reference.status).toBe(404);
    expect(
      await snapshot(
        await post("/email-otp/send-verification-otp", {
          email: "someone@example.com",
          type: "sign-in",
        }),
      ),
    ).toEqual(reference);
    expect(
      await snapshot(
        await post("/sign-in/email-otp", {
          email: "someone@example.com",
          otp: "123456",
        }),
      ),
    ).toEqual(await unregisteredEndpoint("/sign-in/no-such-method"));
  });

  it("still verifies email addresses with codes", async () => {
    await resetTestDatabase();
    const signUp = await post("/sign-up/email", {
      name: "Verifier",
      email: "verify-me@example.com",
      password: "correct horse battery staple",
    });
    expect(signUp.status).toBe(200);
    const cookie = signUp.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");

    const send = await app.request(
      "/api/auth/email-otp/send-verification-otp",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Origin: "http://localhost:5173",
          cookie,
        },
        body: JSON.stringify({
          email: "verify-me@example.com",
          type: "email-verification",
        }),
      },
    );
    expect(send.status).toBe(200);
    expect(await send.json()).toEqual({ success: true });
  });

  it("reports both as off in /config, as before", async () => {
    const config = (await (await app.request("/api/config")).json()) as Record<
      string,
      unknown
    >;
    expect(config).toMatchObject({
      hasGuestAccess: false,
      disableEmailOtpSignIn: true,
    });
  });
});
