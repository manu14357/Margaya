import { expect, type Page } from "@playwright/test";
import { SEED_USERS, type SeedUser } from "../seed/data";
import { loadSeedManifest } from "./auth";

/** A unique, readable name for data a spec creates, e.g. `Task 1737-x1y2`. */
export function uniqueName(prefix: string): string {
  return `${prefix} ${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Sign in through the password form and wait for the workspace to load. */
export async function signInViaUI(
  page: Page,
  user: Pick<SeedUser, "email" | "password"> = SEED_USERS.owner,
): Promise<void> {
  await page.goto("/auth/sign-in");
  await page.getByLabel("Email").fill(user.email);
  // The password input is not associated with its "Password" label (it sits in
  // a wrapper div), so fall back to its placeholder until that is fixed.
  await page
    .getByLabel("Password", { exact: true })
    .or(page.getByPlaceholder("••••••••"))
    .fill(user.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/workspace\//, { timeout: 30_000 });
  // The router commits the URL before the lazily loaded dashboard renders;
  // on a cold dev server the sign-in form stays up for several seconds more.
  await expect(
    page.getByRole("button", { name: "Account menu" }).first(),
  ).toBeVisible({ timeout: 60_000 });
}

/**
 * Open the avatar menu (bottom of the rail) and choose Log out. The button is
 * named "Account menu" and shows the user's initials.
 */
export async function signOutViaUI(page: Page, user: SeedUser): Promise<void> {
  const account = page.getByRole("button", { name: "Account menu" }).first();
  await expect(account).toContainText(user.initials);
  await account.click();
  await page.getByRole("menuitem", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/auth\/sign-in/);
  // The sign-in page shows first and the session ends right after, so only this
  // says it has ended.
  await expect(page.getByText("Signed out successfully")).toBeVisible();
}

/**
 * The rail's workspace tile. It shows the workspace's initials; its
 * accessible name carries the full name.
 */
export function workspaceSwitcher(page: Page, name: string) {
  return page
    .getByRole("button", { name: `Switch workspace: ${name}`, exact: true })
    .first();
}

export function projectBoardPath(project: { id: string }): string {
  const { workspace } = loadSeedManifest();
  return `/dashboard/workspace/${workspace.id}/project/${project.id}/board`;
}

/** Open a seeded project's board and wait for its columns to render. */
export async function openProjectBoard(
  page: Page,
  project: { id: string },
): Promise<void> {
  await page.goto(projectBoardPath(project));
  await expect(
    page.getByRole("button", { name: "Add task" }).first(),
  ).toBeVisible({ timeout: 30_000 });
}
