import { expect, test } from "@playwright/test";

// Runs only in the opt-in docs-site project: E2E_DOCS_SITE=1 pnpm e2e --project=docs-site

// `next dev` compiles routes on first request and is slow under parallel load.
test.describe.configure({ timeout: 180_000 });
test.use({ navigationTimeout: 150_000 });

test("the public site home page renders", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Margaya/);
  await expect(page.getByRole("main").first()).toBeVisible();
});
