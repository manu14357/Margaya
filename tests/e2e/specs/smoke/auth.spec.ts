import { asAnonymous, expect, test } from "../../fixtures";
import { signInViaUI, signOutViaUI, workspaceSwitcher } from "../../helpers/ui";
import { SEED_USERS } from "../../seed/data";

// Starts signed out: signing out revokes the session, so this spec must never
// reuse the shared owner storage state.
test.use(asAnonymous);

test("owner signs in and signs out through the UI", async ({ page, seed }) => {
  const owner = SEED_USERS.owner;

  await signInViaUI(page, owner);
  await expect(page).toHaveURL(
    new RegExp(`/dashboard/workspace/${seed.workspace.id}`),
  );
  await expect(workspaceSwitcher(page, seed.workspace.name)).toBeVisible();

  await signOutViaUI(page, owner);
  // The form can take a few seconds to render on a dev server.
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible({ timeout: 30_000 });

  // The session is gone: a protected page sends us back to sign-in.
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/auth\/sign-in/);
});
