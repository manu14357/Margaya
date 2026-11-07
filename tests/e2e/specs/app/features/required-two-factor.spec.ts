import type { Page } from "@playwright/test";
import { asAnonymous, expect, test } from "../../../fixtures";
import { signUpUser } from "../../../helpers/api-kit";
import { totpCode } from "../../../helpers/totp";

// The web flow when the server requires two-factor. The setting is instance
// wide, so turning it on for real would stop every spec running in parallel.
// These tell the browser it's on instead; what the API enforces is covered in
// tests/api-integration/two-factor-required.test.ts. Setting two-factor up
// below is real.

test.use(asAnonymous);

async function serverRequiresTwoFactor(page: Page) {
  await page.route("**/api/config", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      json: { ...(await response.json()), requireTwoFactor: true },
    });
  });
  await page.route("**/api/user/security", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      json: { ...(await response.json()), twoFactorRequired: true },
    });
  });
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/auth/sign-in");
  await page.getByLabel("Email").fill(email);
  await page
    .getByLabel("Password", { exact: true })
    .or(page.getByPlaceholder("••••••••"))
    .fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

test("an account that must set up two-factor does that first, then carries on", async ({
  page,
}) => {
  const user = await signUpUser("Required two-factor");
  await serverRequiresTwoFactor(page);
  await signIn(page, user.email, user.password);

  await expect(page).toHaveURL(/\/two-factor-setup/, { timeout: 30_000 });
  await expect(
    page.getByRole("heading", { name: "Set up two-factor to continue" }),
  ).toBeVisible();

  // Going elsewhere comes straight back here.
  await page.goto("/dashboard/settings/account/security");
  await expect(page).toHaveURL(/\/two-factor-setup\?redirect=/);

  await page.getByLabel("Confirm your password").fill(user.password);
  await page.getByRole("button", { name: "Continue" }).click();

  const appLink = page.getByRole("link", {
    name: "Open in an authenticator app on this device",
  });
  const totpURI = await appLink.getAttribute("href");
  await page.getByLabel("Authentication code").fill(totpCode(totpURI ?? ""));
  await page.getByRole("button", { name: "Verify" }).click();

  // The recovery codes come before anything else.
  await expect(page.getByText("Recovery codes", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();

  // Back where they were headed, and two-factor can't be turned off now.
  await expect(page).toHaveURL(/\/dashboard\/settings\/account\/security/);
  await expect(
    page.getByText(
      "This server requires two-factor, so it can't be turned off",
      {
        exact: false,
      },
    ),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Turn off" })).toHaveCount(0);
  await user.ctx.dispose();
});

test("the sign-in screen offers no email code while two-factor is required", async ({
  page,
}) => {
  await page.route("**/api/config", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      json: {
        ...(await response.json()),
        requireTwoFactor: true,
        disableEmailOtpSignIn: true,
      },
    });
  });
  await page.goto("/auth/sign-in");
  await expect(page.getByPlaceholder("••••••••")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Sign in with a password instead" }),
  ).toHaveCount(0);
});

// Someone who only ever used email codes has no password to sign in with.
for (const email of [true, false]) {
  test(`the sign-in screen says how to get a password ${email ? "with" : "without"} email`, async ({
    page,
  }) => {
    await page.route("**/api/config", async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        json: {
          ...(await response.json()),
          requireTwoFactor: true,
          disableEmailOtpSignIn: true,
          passwordResetEnabled: email,
        },
      });
    });
    await page.goto("/auth/sign-in");
    await expect(
      page.getByText(
        email
          ? "select Forgot password? to set one"
          : "ask an instance admin to set one for you",
        { exact: false },
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Forgot password?" }),
    ).toHaveCount(email ? 1 : 0);
  });
}
