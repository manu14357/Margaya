import { asAnonymous, test } from "../../../fixtures";
import { expect } from "./_support";

// Signed-out entry points: the product landing at `/` (instance setting
// `publicLanding`, on by default) and the language menu on the auth pages.
// Every test starts signed out in a fresh context, so the stored guest
// language never leaks into other specs.

test.describe.configure({ timeout: 120_000 });
test.use({ navigationTimeout: 60_000 });
test.use(asAnonymous);

test("a signed-out visitor at / sees the landing and can go to sign in", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/$/);
  // The product demos render headings of their own; match the hero's.
  await expect(
    page.getByRole("heading", { level: 1, name: /^Plan the work\./ }),
  ).toBeVisible();
  const nav = page.getByRole("banner");
  await expect(nav.getByRole("link", { name: "Get started" })).toBeVisible();

  await nav.getByRole("link", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/auth\/sign-in/);
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
});

test("the auth pages switch language and keep it after a reload", async ({
  page,
}) => {
  await page.goto("/auth/sign-in");
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Language: English" }).click();
  await page.getByRole("menuitemradio", { name: "Deutsch" }).click();

  await expect(
    page.getByRole("heading", { name: "Willkommen zurück" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Sprache: Deutsch" }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "de-DE");

  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Willkommen zurück" }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "de-DE");

  // Back to English, so the choice is visibly reversible.
  await page.getByRole("button", { name: "Sprache: Deutsch" }).click();
  await page.getByRole("menuitemradio", { name: "English" }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
});
