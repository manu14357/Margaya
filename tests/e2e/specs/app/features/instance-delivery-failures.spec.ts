import { expect, test } from "../../../fixtures";

// The seeded owner is the instance administrator. Failed deliveries come from
// other specs' webhooks, so this only relies on the section and its two states.

test("the General page shows recent delivery failures to an instance admin", async ({
  pageAs,
}) => {
  const page = await pageAs("owner");
  await page.goto("/dashboard/settings/instance/general");

  await expect(
    page.getByRole("heading", { name: "Recent delivery failures" }),
  ).toBeVisible();

  const empty = page.getByText("No failed deliveries in the last 7 days.");
  const table = page.getByRole("columnheader", { name: "Webhook" });
  await expect(empty.or(table)).toBeVisible();
});
