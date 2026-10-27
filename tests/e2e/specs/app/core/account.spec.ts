import type { Page } from "@playwright/test";
import { test } from "../../../fixtures";
import { E2E_API_URL, E2E_WEB_URL } from "../../../helpers/env";
import {
  expect,
  initialsOf,
  newUserWithWorkspace,
  solidPng,
  workspacePath,
} from "./_support";

// Multi-step flows against shared, often busy dev servers: allow more than
// the default 60 s per test and 30 s per navigation.
test.describe.configure({ timeout: 180_000 });
test.use({ navigationTimeout: 60_000 });

// Account settings change the signed-in user, so every test uses a user
// created for it: the seeded accounts keep their names, theme and language.

const ORIGIN = { Origin: E2E_WEB_URL };

type SessionUser = {
  name: string;
  image: string | null;
  locale: string | null;
};

async function sessionUser(page: Page): Promise<SessionUser> {
  const response = await page.request.get(
    `${E2E_API_URL}/api/auth/get-session`,
    {
      headers: ORIGIN,
      params: { disableCookieCache: "true" },
    },
  );
  expect(response.status()).toBe(200);
  return (await response.json()).user;
}

async function openSettings(page: Page, workspaceId: string, section: string) {
  await page.goto(workspacePath(workspaceId));
  await page.goto(`/dashboard/settings/account/${section}`);
}

test.describe("profile", () => {
  test("changes the display name", async ({ pageAs }) => {
    const { page, user, workspace } = await newUserWithWorkspace(pageAs);
    await openSettings(page, workspace.id, "information");
    await expect(
      page.getByRole("heading", { name: "Personal information" }),
    ).toBeVisible();
    const name = page.getByLabel("Full name");
    await expect(name).toHaveValue(user.name);
    await expect(page.getByLabel("Email")).toHaveValue(user.email);
    await expect(page.getByLabel("Email")).toBeDisabled();

    await name.fill("Z");
    await expect(
      page.getByText("Name must be at least 2 characters"),
    ).toBeVisible();

    // Typed key by key, as a person would.
    await name.clear();
    await name.pressSequentially("Paula Profile", { delay: 20 });
    await expect(page.getByText("Profile updated successfully")).toBeVisible();
    await expect
      .poll(async () => (await sessionUser(page)).name)
      .toBe("Paula Profile");

    await page.reload();
    await expect(page.getByLabel("Full name")).toHaveValue("Paula Profile");

    // The sidebar avatar follows the new name.
    await page.goto(workspacePath(workspace.id));
    // The shell's account button is named "Account menu" and shows the initials.
    await expect(
      page.getByRole("button", { name: "Account menu" }),
    ).toContainText(initialsOf("Paula Profile"));
  });

  test("uploads and removes a profile picture", async ({ pageAs }) => {
    const { page, workspace } = await newUserWithWorkspace(pageAs);
    await openSettings(page, workspace.id, "information");
    const avatarButton = page.getByRole("button", {
      name: "Change your profile picture",
    });
    await expect(avatarButton).toBeVisible();

    await avatarButton.click();
    // "Remove avatar" is only offered once there is a picture.
    await expect(
      page.getByRole("menuitem", { name: "Remove avatar" }),
    ).toHaveCount(0);
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("menuitem", { name: "Change avatar" }).click();
    await (await chooser).setFiles({
      name: "avatar.png",
      mimeType: "image/png",
      buffer: solidPng(),
    });

    await expect(page.getByText("Profile picture updated")).toBeVisible();
    await expect.poll(async () => (await sessionUser(page)).image).toBeTruthy();
    const image = avatarButton.getByRole("img");
    await expect(image).toBeVisible();
    await expect(image).toHaveAttribute("src", /.+/);

    await avatarButton.click();
    await page.getByRole("menuitem", { name: "Remove avatar" }).click();
    await expect(page.getByText("Profile picture removed")).toBeVisible();
    await expect.poll(async () => (await sessionUser(page)).image).toBeNull();
  });
});

test.describe("preferences", () => {
  test("switches between light and dark themes", async ({ pageAs }) => {
    const { page, workspace } = await newUserWithWorkspace(pageAs);
    await openSettings(page, workspace.id, "preferences");
    await expect(
      page.getByRole("heading", { name: "Preferences" }),
    ).toBeVisible();

    const html = page.locator("html");
    // New users start light.
    await expect(html).toHaveClass(/\blight\b/);
    const theme = page.getByRole("combobox").first();
    await expect(theme).toHaveText("Light");

    // Exact: the high-contrast options also contain "Light" and "Dark".
    await theme.click();
    await page.getByRole("option", { name: "Dark", exact: true }).click();
    await expect(html).toHaveClass(/\bdark\b/);
    await expect(html).not.toHaveClass(/\blight\b/);
    await expect(theme).toHaveText("Dark");

    // Kept across reloads.
    await page.reload();
    await expect(html).toHaveClass(/\bdark\b/);

    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: "Light", exact: true }).click();
    await expect(html).toHaveClass(/\blight\b/);
  });

  test("switches the interface to German and back", async ({ pageAs }) => {
    const { page, workspace } = await newUserWithWorkspace(pageAs);
    await openSettings(page, workspace.id, "preferences");
    await expect(
      page.getByRole("heading", { name: "Preferences" }),
    ).toBeVisible();

    const language = page.getByRole("combobox").nth(1);
    await expect(language).toHaveText("English");
    await language.click();
    await page.getByRole("option", { name: "Deutsch" }).click();

    await expect(
      page.getByRole("heading", { name: "Einstellungen" }).first(),
    ).toBeVisible();
    await expect(page.getByText("Darstellung")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "de-DE");
    await expect
      .poll(async () => (await sessionUser(page)).locale)
      .toBe("de-DE");

    // Stored on the account: the rest of the app is German after a reload.
    // Members lives under Settings, so the German page title is the check.
    await page.goto(`${workspacePath(workspace.id)}/members`);
    await expect(
      page.getByRole("heading", { name: "Mitglieder", exact: true }),
    ).toBeVisible();

    await page.goto("/dashboard/settings/account/preferences");
    const sprache = page.getByRole("combobox").nth(1);
    await expect(sprache).toHaveText("Deutsch");
    await sprache.click();
    await page.getByRole("option", { name: "English" }).click();
    await expect(
      page.getByRole("heading", { name: "Preferences" }),
    ).toBeVisible();
    await expect(page.getByText("Appearance")).toBeVisible();
    await expect
      .poll(async () => (await sessionUser(page)).locale)
      .toBe("en-US");
  });
});

test.describe("notifications", () => {
  test("renders the channels and saves notification types", async ({
    pageAs,
  }) => {
    const { page, user, workspace } = await newUserWithWorkspace(pageAs);
    await openSettings(page, workspace.id, "notifications");
    await expect(
      page.getByRole("heading", { name: "Notifications", exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Notify me about" }),
    ).toBeVisible();
    for (const channel of ["ntfy", "Gotify", "Custom webhook"]) {
      await expect(
        page.getByText(channel, { exact: true }).first(),
      ).toBeVisible();
    }
    // The account email is the read-only value of the "Account email" field.
    await expect(
      page.locator(`input[value="${user.email}"]`).first(),
    ).toBeVisible();

    const assignments = page.getByRole("switch", { name: "Task assignments" });
    await expect(assignments).toBeChecked();
    await assignments.click();
    await expect(assignments).not.toBeChecked();
    await page.getByRole("button", { name: "Save notification types" }).click();
    await expect(
      page.getByText("Notification preferences saved"),
    ).toBeVisible();

    await page.reload();
    await expect(
      page.getByRole("switch", { name: "Task assignments" }),
    ).not.toBeChecked();

    await page.getByRole("switch", { name: "Task assignments" }).click();
    await page.getByRole("button", { name: "Save notification types" }).click();
    await expect(
      page.getByText("Notification preferences saved"),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("switch", { name: "Task assignments" }),
    ).toBeChecked();
  });
});

test.describe("developer", () => {
  test("creates an API key that is shown once, works, and is deleted", async ({
    pageAs,
    request,
  }) => {
    const { page, workspace } = await newUserWithWorkspace(pageAs);
    await page
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"], {
        origin: E2E_WEB_URL,
      });
    await openSettings(page, workspace.id, "developer");
    await expect(
      page.getByRole("heading", { name: "Developer settings" }),
    ).toBeVisible();
    await expect(
      page.getByText("No API keys yet. Create one to get started."),
    ).toBeVisible();

    await page.getByRole("button", { name: "Create API key" }).click();
    const create = page.getByRole("dialog", { name: "Create API key" });
    await create.getByLabel("Name").fill("ab");
    await create.getByRole("button", { name: "Create", exact: true }).click();
    await expect(
      create.getByText("Name must be at least 3 characters"),
    ).toBeVisible();

    const keyName = `Core key ${Date.now().toString(36)}`;
    await create.getByLabel("Name").fill(keyName);
    await create.getByRole("button", { name: "Create", exact: true }).click();

    const created = page.getByRole("dialog", { name: "API key created" });
    await expect(
      created.getByText(
        `Your API key "${keyName}" has been created successfully.`,
      ),
    ).toBeVisible();
    await expect(
      created.getByText(
        "Copy this key now. You won't be able to see it again.",
      ),
    ).toBeVisible();
    const key = (await created.locator("code").innerText()).trim();
    expect(key.length).toBeGreaterThan(20);

    // Done stays locked until the key was copied.
    await expect(
      created.getByRole("button", { name: "Copy key to continue" }),
    ).toBeDisabled();
    await created.getByRole("button", { name: "Copy", exact: true }).click();
    await expect(page.getByText("API key copied to clipboard")).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(key);
    await created.getByRole("button", { name: "Done" }).click();
    await expect(created).toBeHidden();

    // Listed, but never shown in full again.
    const row = page.getByRole("row").filter({ hasText: keyName });
    await expect(row).toBeVisible();
    await expect(page.getByText(key)).toHaveCount(0);

    // The key authenticates API calls.
    const withKey = await request.get(`${E2E_API_URL}/api/project`, {
      params: { workspaceId: workspace.id },
      headers: { "x-api-key": key },
    });
    expect(withKey.status()).toBe(200);

    await row.getByRole("button", { name: `Delete ${keyName}` }).click();
    const confirm = page.getByRole("alertdialog", { name: "Delete API key?" });
    await expect(confirm.getByText(keyName)).toBeVisible();
    await confirm.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByText("API key deleted successfully")).toBeVisible();
    await expect(row).toHaveCount(0);

    const revoked = await request.get(`${E2E_API_URL}/api/project`, {
      params: { workspaceId: workspace.id },
      headers: { "x-api-key": key },
    });
    expect(revoked.status()).toBe(401);
  });
});
