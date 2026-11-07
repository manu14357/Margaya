import { expect, test } from "../../fixtures";
import { expectJson, expectStatus, signUpUser } from "../../helpers/api-kit";
import { covers } from "../../helpers/openapi";
import { totpCode } from "../../helpers/totp";
import { SEED_USERS } from "../../seed/data";

// An instance admin resets the two-factor of someone who lost their
// authenticator. The seeded owner is the instance administrator. The setting
// that requires two-factor stays off here: turning it on would stop every
// other spec running in parallel. tests/api-integration/two-factor-required
// covers that against its own database.

test(
  "an instance admin resets another account's two-factor",
  covers("resetInstanceUserTwoFactor"),
  async ({ api, seed }) => {
    const target = await signUpUser("Two-factor reset");
    const enabled = await expectJson<{ totpURI: string }>(
      await target.ctx.post("/api/auth/two-factor/enable", {
        data: { password: target.password },
      }),
    );
    await expectJson(
      await target.ctx.post("/api/auth/two-factor/verify-totp", {
        data: { code: totpCode(enabled.totpURI) },
      }),
    );
    const challenged = await expectJson<{ twoFactorRedirect?: boolean }>(
      await target.ctx.post("/api/auth/sign-in/email", {
        data: { email: target.email, password: target.password },
      }),
    );
    expect(challenged.twoFactorRedirect).toBe(true);

    // Not for just anyone, and not for your own account.
    await expectStatus(
      await target.ctx.post(
        `/api/instance-admin/users/${seed.users.member.id}/reset-two-factor`,
      ),
      [401, 403],
    );
    await expectJson(
      await api.post("/api/instance-admin/reauth", {
        data: { password: SEED_USERS.owner.password },
      }),
    );
    await expectStatus(
      await api.post(
        `/api/instance-admin/users/${seed.users.owner.id}/reset-two-factor`,
      ),
      400,
    );

    const reset = await expectJson<{ userId: string }>(
      await api.post(`/api/instance-admin/users/${target.id}/reset-two-factor`),
    );
    expect(reset.userId).toBe(target.id);

    // The password alone signs in again.
    const signIn = await expectJson<{
      twoFactorRedirect?: boolean;
      token?: string;
    }>(
      await target.ctx.post("/api/auth/sign-in/email", {
        data: { email: target.email, password: target.password },
      }),
    );
    expect(signIn.twoFactorRedirect).toBeUndefined();
    expect(signIn.token).toBeTruthy();

    const audit = await expectJson<{ items: { action: string }[] }>(
      await api.get("/api/instance-admin/audit-log", {
        params: { action: "user.two_factor_reset", limit: "5" },
      }),
    );
    expect(audit.items.length).toBeGreaterThanOrEqual(1);
    await target.ctx.dispose();
  },
);

test("the server won't require two-factor before the admin has it", async ({
  api,
}) => {
  await expectJson(
    await api.post("/api/instance-admin/reauth", {
      data: { password: SEED_USERS.owner.password },
    }),
  );
  await expectStatus(
    await api.patch("/api/instance-admin/settings", {
      data: { values: { "auth.requireTwoFactor": true } },
    }),
    409,
  );
});
