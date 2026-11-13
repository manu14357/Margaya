import { createHash, randomBytes } from "node:crypto";
import { expect, test } from "../../fixtures";
import {
  expectJson,
  expectStatus,
  headerContext,
  signUpUser,
} from "../../helpers/api-kit";
import { E2E_WEB_URL } from "../../helpers/env";
import { covers } from "../../helpers/openapi";

// Margaya Desktop's server side: browser sign-in with PKCE, the bearer
// session it yields, sign-out, and the alert text for a notification. The
// app itself is not driven here.

function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  return {
    verifier,
    challenge: createHash("sha256").update(verifier).digest("base64url"),
    state: randomBytes(16).toString("base64url"),
  };
}

type Desktop = {
  token: string;
  webviewUrl: string;
  webviewSecret: string;
  user: { id: string; email: string };
  expiresAt: string;
};

test(
  "desktop sign-in: confirm page, code for the verifier, bearer session, sign-out",
  covers(
    "startDesktopSignIn",
    "authorizeDesktopSignIn",
    "exchangeDesktopSignInCode",
    "signOutDesktop",
  ),
  async ({ apiAs }) => {
    const user = await signUpUser("Desktop");
    const request = pkce();
    const query = {
      state: request.state,
      code_challenge: request.challenge,
      code_challenge_method: "S256",
    };

    // The system browser always lands on the app's confirm page first.
    const started = await user.ctx.get("/api/auth/desktop/sign-in", {
      params: query,
      maxRedirects: 0,
    });
    expect(started.status()).toBe(302);
    const page = new URL(started.headers().location ?? "");
    expect(`${page.origin}${page.pathname}`).toBe(
      `${E2E_WEB_URL}/desktop/authorize`,
    );
    expect(page.searchParams.get("state")).toBe(request.state);

    // Confirming there mints the one-time code; signed out mints nothing.
    const anonymous = await apiAs("anonymous");
    await expectStatus(
      await anonymous.post("/api/auth/desktop/authorize", { data: query }),
      401,
    );
    const minted = await expectJson<{ code: string; redirectTo: string }>(
      await user.ctx.post("/api/auth/desktop/authorize", { data: query }),
    );
    expect(minted.redirectTo).toContain("com.margaya.desktop://auth/callback?");

    // The app trades code and verifier once; a wrong verifier burns the code.
    const native = await headerContext({});
    const desktop = await expectJson<Desktop>(
      await native.post("/api/auth/desktop/token", {
        data: { code: minted.code, code_verifier: request.verifier },
      }),
    );
    expect(desktop.user.id).toBe(user.id);
    expect(desktop.webviewUrl).toContain(`${E2E_WEB_URL}/auth/complete#token=`);
    await expectStatus(
      await native.post("/api/auth/desktop/token", {
        data: { code: minted.code, code_verifier: request.verifier },
      }),
      401,
    );

    const bearer = await headerContext({
      Authorization: `Bearer ${desktop.token}`,
    });
    await expectJson(await bearer.get("/api/notification"));

    // The app always sends a JSON body; the auth layer answers 415 before
    // it checks credentials when there is none.
    await expectStatus(
      await native.post("/api/auth/desktop/sign-out", { data: {} }),
      401,
    );
    expect(
      await expectJson(
        await bearer.post("/api/auth/desktop/sign-out", { data: {} }),
      ),
    ).toEqual({ success: true });
    await expectStatus(await bearer.get("/api/notification"), 401);

    await Promise.all([native.dispose(), bearer.dispose(), user.ctx.dispose()]);
  },
);

test(
  "desktop alert text for the caller's own notification only",
  covers("getDesktopNotification"),
  async () => {
    const owner = await signUpUser("Desktop alert");
    const other = await signUpUser("Desktop other");
    const created = await expectJson<{ id: string }>(
      await owner.ctx.post("/api/notification", {
        data: {
          title: "Heads up",
          message: "words nobody else should read",
          type: "info",
        },
      }),
    );

    const bearer = await headerContext({
      Authorization: `Bearer ${owner.token}`,
    });
    const alert = await expectJson<{
      id: string;
      title: string;
      body: string;
      url: string;
      tag: string;
    }>(await bearer.get(`/api/notification/${created.id}/desktop`));
    expect(Object.keys(alert).sort()).toEqual([
      "body",
      "held",
      "id",
      "sound",
      "soundName",
      "tag",
      "title",
      "url",
      "volume",
    ]);
    expect(alert.url.startsWith(E2E_WEB_URL)).toBe(true);
    expect(JSON.stringify(alert)).not.toContain("nobody else");

    await expectStatus(
      await other.ctx.get(`/api/notification/${created.id}/desktop`),
      404,
    );
    await Promise.all([
      bearer.dispose(),
      owner.ctx.dispose(),
      other.ctx.dispose(),
    ]);
  },
);
