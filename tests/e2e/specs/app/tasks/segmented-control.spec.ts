import type { Locator } from "@playwright/test";
import { expect, test } from "../../../fixtures";

test.describe.configure({ timeout: 180_000 });
test.use({ navigationTimeout: 120_000 });

function fill(segment: Locator) {
  return segment.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
}

const TRANSPARENT = "rgba(0, 0, 0, 0)";

test("Cycles shows the chosen segment raised and the other unfilled", async ({
  page,
  seed,
}) => {
  await page.goto(
    `/dashboard/workspace/${seed.workspace.id}/project/${seed.projects.web.id}/cycles`,
  );
  const archived = page.getByRole("button", { name: "Archived", exact: true });
  const cycles = page
    .getByRole("group")
    .filter({ has: archived })
    .getByRole("button", { name: "Cycles", exact: true });

  await expect(cycles).toHaveAttribute("aria-pressed", "true");
  await expect(archived).toHaveAttribute("aria-pressed", "false");
  expect(await fill(cycles)).not.toBe(TRANSPARENT);
  // Move away so a hover tint can't stand in for the unselected fill.
  await page.mouse.move(0, 0);
  await expect.poll(() => fill(archived)).toBe(TRANSPARENT);

  await archived.click();
  await expect(page).toHaveURL(/view=archived/);
  await expect(archived).toHaveAttribute("aria-pressed", "true");
  await expect(cycles).toHaveAttribute("aria-pressed", "false");

  // Pressing the chosen segment keeps the choice.
  await archived.click();
  await expect(archived).toHaveAttribute("aria-pressed", "true");

  await cycles.click();
  await expect(cycles).toHaveAttribute("aria-pressed", "true");
  await expect(page).not.toHaveURL(/view=archived/);
});
