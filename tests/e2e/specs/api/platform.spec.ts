import { expect, test } from "../../fixtures";
import {
  expectJson,
  expectStatus,
  signUpUser,
  type TestUser,
} from "../../helpers/api-kit";
import { E2E_WEB_URL } from "../../helpers/env";
import { covers } from "../../helpers/openapi";

// Instance-level and account routes: public settings and status, the
// session, the device authorization page, OAuth id tokens, avatars and the
// asset download guard.

// A 1x1 transparent PNG.
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

test(
  "public instance status and settings",
  covers("getInstanceStatus", "getConfig", "getReadiness"),
  async ({ apiAs }) => {
    const anonymous = await apiAs("anonymous");
    const status = await expectJson<{ hasUsers: boolean; hasAdmin: boolean }>(
      await anonymous.get("/api/instance/status"),
    );
    expect(status).toEqual({ hasUsers: true, hasAdmin: true });

    const readiness = await expectJson<{
      status: string;
      checks: Record<string, unknown>;
    }>(await anonymous.get("/api/health/ready"));
    expect(readiness).toMatchObject({
      status: "ready",
      checks: { database: "ok", draining: false },
    });

    const config = await expectJson<Record<string, unknown>>(
      await anonymous.get("/api/config"),
    );
    // The e2e API: SMTP to MailPit, password sign-in, open registration.
    expect(config).toMatchObject({
      hasSmtp: true,
      disableRegistration: false,
      disablePasswordRegistration: false,
      disableEmailOtpSignIn: true,
      disableLoginForm: false,
    });
    // Public settings are flags and URLs, never secrets or credentials.
    expect(
      Object.keys(config).filter((key) =>
        /secret|token|apikey|clientid/i.test(key),
      ),
    ).toEqual([]);
  },
);

test(
  "the session, signed in and signed out",
  covers("getSession"),
  async ({ api, apiAs, seed }) => {
    const session = await expectJson<{
      user: { id: string; email: string };
      session: { userId: string };
    }>(await api.get("/api/auth/get-session"));
    expect(session.user).toMatchObject({
      id: seed.users.owner.id,
      email: seed.users.owner.email,
    });
    expect(session.session.userId).toBe(seed.users.owner.id);

    const anonymous = await apiAs("anonymous");
    const none = await anonymous.get("/api/auth/get-session");
    expect(none.status()).toBe(200);
    expect(await none.json()).toBeNull();
  },
);

test(
  "OAuth id token is null for password accounts",
  covers("getOAuthIdToken"),
  async ({ api }) => {
    expect(await expectJson(await api.get("/api/oauth/id-token"))).toEqual({
      idToken: null,
    });
  },
);

test(
  "the device page redirects browsers to the web app",
  covers("getDeviceAuthorizationPage"),
  async ({ apiAs }) => {
    const anonymous = await apiAs("anonymous");
    const redirect = await anonymous.get("/api/auth/device", {
      params: { user_code: "ABCD-EFGH", ui: "1" },
      maxRedirects: 0,
    });
    expect(redirect.status()).toBe(302);
    expect(redirect.headers().location).toBe(
      `${E2E_WEB_URL}/device?user_code=ABCD-EFGH`,
    );

    // A document navigation (Sec-Fetch-Dest) is redirected too.
    const navigation = await anonymous.get("/api/auth/device", {
      headers: { "Sec-Fetch-Dest": "document" },
      maxRedirects: 0,
    });
    expect(navigation.status()).toBe(302);
    expect(navigation.headers().location).toBe(`${E2E_WEB_URL}/device`);

    // A fetch() gets Better Auth's JSON; an unknown code is refused.
    const json = await anonymous.get("/api/auth/device", {
      params: { user_code: "ZZZZ-ZZZZ" },
      maxRedirects: 0,
    });
    expect(json.status()).toBeGreaterThanOrEqual(400);
    expect(json.status()).toBeLessThan(500);
  },
);

test.describe("avatars", () => {
  let user: TestUser;

  test.beforeAll(async () => {
    // A fresh account: seeded avatars must keep showing initials.
    user = await signUpUser("avatar");
  });

  test.afterAll(async () => {
    await user?.ctx.dispose();
  });

  test(
    "upload, download and remove an avatar",
    covers("uploadUserAvatar", "getUserAvatar", "deleteUserAvatar"),
    async ({ apiAs }) => {
      const stored = await expectJson<{
        id: string;
        url: string;
        size: number;
      }>(
        await user.ctx.put("/api/user/avatar", {
          data: { contentType: "image/png", data: PNG_BASE64 },
        }),
      );
      expect(stored.size).toBe(Buffer.from(PNG_BASE64, "base64").length);
      expect(stored.url).toContain(`/api/user/avatar/${stored.id}`);

      // Public and cacheable: readable without signing in.
      const anonymous = await apiAs("anonymous");
      const image = await anonymous.get(`/api/user/avatar/${stored.id}`);
      expect(image.status()).toBe(200);
      expect(image.headers()["content-type"]).toBe("image/png");
      expect(image.headers()["cache-control"]).toContain("immutable");
      expect(
        Buffer.compare(await image.body(), Buffer.from(PNG_BASE64, "base64")),
      ).toBe(0);
      const cached = await anonymous.get(`/api/user/avatar/${stored.id}`, {
        headers: { "If-None-Match": `"${stored.id}"` },
      });
      expect(cached.status()).toBe(304);

      await expectStatus(
        await user.ctx.put("/api/user/avatar", {
          data: { contentType: "image/svg+xml", data: PNG_BASE64 },
        }),
        400,
      );
      await expectStatus(
        await user.ctx.put("/api/user/avatar", {
          data: { contentType: "image/png", data: "not base64!!" },
        }),
        400,
      );

      const removed = await expectJson<{ deleted: boolean }>(
        await user.ctx.delete("/api/user/avatar"),
      );
      expect(removed.deleted).toBe(true);
      await expectStatus(
        await anonymous.get(`/api/user/avatar/${stored.id}`),
        404,
      );
      // Removing again still succeeds.
      await expectJson(await user.ctx.delete("/api/user/avatar"));
    },
  );
});

test(
  "asset downloads are guarded",
  covers("getAsset"),
  async ({ api, apiAs }) => {
    // No asset can exist without object storage (allowlisted in coverage.spec.ts):
    // unknown ids are 404 for everyone, signed in or not.
    await expectStatus(await api.get("/api/asset/e2e-unknown-asset"), 404);
    const anonymous = await apiAs("anonymous");
    await expectStatus(
      await anonymous.get("/api/asset/e2e-unknown-asset"),
      404,
    );
  },
);
