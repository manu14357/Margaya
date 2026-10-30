import { expect, test } from "../../fixtures";

// Opt-in docs-site project: E2E_DOCS_SITE=1 pnpm e2e --project=docs-site

// The first request compiles Next's error route, which can take minutes.
test.describe.configure({ timeout: 300_000 });
test.use({ navigationTimeout: 150_000 });

const NESTED_UNKNOWN = "/this/route/does-not-exist";
const TOP_LEVEL_UNKNOWN = "/this-page-does-not-exist";

test("an unknown nested URL answers 404", async ({ page }) => {
  const response = await page.goto(NESTED_UNKNOWN);
  expect(response?.status()).toBe(404);
  await expect(
    page.getByText(/could not be found|not found/i).first(),
  ).toBeVisible();
});

test("the 404 page is Margaya-branded with a way back home", async ({
  page,
}) => {
  const response = await page.goto(NESTED_UNKNOWN);
  expect(response?.status()).toBe(404);
  await expect(page).toHaveTitle(/Margaya/);
  await expect(
    page.getByRole("banner").getByRole("link", { name: "Margaya home" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByRole("contentinfo")).toBeVisible();
});

test("an unknown top-level URL answers 404, not a server error", async ({
  request,
}) => {
  const response = await request.get(TOP_LEVEL_UNKNOWN, { timeout: 240_000 });
  expect(response.status()).toBe(404);
});

test("the removed comparison and blog pages answer 404", async ({
  request,
}) => {
  for (const path of ["/alternatives", "/jira-alternative", "/blog"]) {
    const response = await request.get(path, { timeout: 240_000 });
    expect(response.status(), path).toBe(404);
  }
});
