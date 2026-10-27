import type { Page } from "@playwright/test";
import { test } from "../../../fixtures";
import { E2E_API_URL, E2E_WEB_URL } from "../../../helpers/env";
import { expect, newUserWithWorkspace, workspacePath } from "./_support";

// Multi-step flows against shared, often busy dev servers: allow more than
// the default 60 s per test and 30 s per navigation.
test.describe.configure({ timeout: 180_000 });
test.use({ navigationTimeout: 60_000 });

// Home, quick links and stickies are personal, so each test signs up its own
// user and workspace.

const ORIGIN = { Origin: E2E_WEB_URL };

function widget(
  page: Page,
  name: "Quick links" | "Recents" | "Stickies" | "At risk",
) {
  return page.getByRole("region", { name, exact: true });
}

type Sticky = { id: string; content: string; color: string };

async function listStickies(page: Page, workspaceId: string, q?: string) {
  const response = await page.request.get(`${E2E_API_URL}/api/sticky`, {
    params: { workspaceId, ...(q ? { q } : {}) },
    headers: ORIGIN,
  });
  expect(response.status()).toBe(200);
  const body = await response.json();
  return (
    Array.isArray(body) ? body : (body.items ?? body.stickies ?? body.data)
  ) as Sticky[];
}

/** The sticky card that holds `text`, through its labelled editor group. */
function stickyCard(page: Page, text: string) {
  return page
    .locator("[data-sticky-id]")
    .filter({ has: page.getByRole("group", { name: "Sticky note" }) })
    .filter({ hasText: text });
}

test.describe("home", () => {
  test("greets the user, and its widgets can be hidden and shown again", async ({
    pageAs,
  }) => {
    const { page, user, workspace } = await newUserWithWorkspace(pageAs);
    await page.goto(workspacePath(workspace.id));
    await expect(
      page.getByRole("heading", {
        name: new RegExp(`^Good (morning|afternoon|evening), ${user.name}$`),
      }),
    ).toBeVisible();
    for (const name of [
      "Quick links",
      "Recents",
      "Stickies",
      "At risk",
    ] as const) {
      await expect(widget(page, name)).toBeVisible();
    }

    await page.getByRole("button", { name: "Manage widgets" }).click();
    const dialog = page.getByRole("dialog", { name: "Manage widgets" });
    await expect(
      dialog.getByText("Choose what shows on your home and drag to reorder."),
    ).toBeVisible();
    const showRecents = dialog.getByRole("switch", { name: "Show Recents" });
    await expect(showRecents).toBeChecked();
    // My brief is opt-in.
    await expect(
      dialog.getByRole("switch", { name: "Show My brief" }),
    ).not.toBeChecked();
    // Each switch is saved before the next one is flipped.
    const saveAfter = async (action: Promise<void>) => {
      const saved = page.waitForResponse(
        (response) =>
          response.url().includes("/api/home/preferences") &&
          response.request().method() === "PUT",
      );
      await action;
      expect((await saved).ok()).toBe(true);
    };
    await saveAfter(showRecents.click());
    await expect(showRecents).not.toBeChecked();

    // One switch at a time, each settled before the next.
    for (const name of ["Quick links", "Stickies", "Risks"] as const) {
      const toggle = dialog.getByRole("switch", { name: `Show ${name}` });
      await saveAfter(toggle.click());
      await expect(toggle).not.toBeChecked();
    }
    await dialog.getByRole("button", { name: "Close" }).first().click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("Your home is empty")).toBeVisible();

    // Stored for the user, not just in this tab.
    await page.reload();
    await expect(page.getByText("Your home is empty")).toBeVisible();

    await page.getByRole("button", { name: "Manage widgets" }).first().click();
    for (const name of [
      "Quick links",
      "Recents",
      "Stickies",
      "Risks",
    ] as const) {
      const toggle = dialog.getByRole("switch", { name: `Show ${name}` });
      await saveAfter(toggle.click());
      await expect(toggle).toBeChecked();
    }
    await dialog.getByRole("button", { name: "Close" }).first().click();
    for (const name of [
      "Quick links",
      "Recents",
      "Stickies",
      "At risk",
    ] as const) {
      await expect(widget(page, name)).toBeVisible();
    }
    await expect(page.getByText("Your home is empty")).toHaveCount(0);
  });

  test("adds, edits and deletes a quick link", async ({ pageAs }) => {
    const { page, workspace } = await newUserWithWorkspace(pageAs);
    await page.goto(workspacePath(workspace.id));
    const links = widget(page, "Quick links");
    await expect(
      links.getByText(
        "Save links you open often, like docs, dashboards or designs.",
      ),
    ).toBeVisible();

    await links.getByRole("button", { name: "Add link" }).click();
    const add = page.getByRole("dialog", { name: "Add quick link" });
    await add.getByLabel("URL").fill("not a url");
    await add.getByRole("button", { name: "Add link" }).click();
    await expect(
      add.getByText("Enter a valid web address (http or https)"),
    ).toBeVisible();

    const url = `https://docs.example.com/core-${Date.now().toString(36)}`;
    await add.getByLabel("URL").fill(url);
    await add.getByLabel(/^Title/).fill("Team docs");
    await add.getByRole("button", { name: "Add link" }).click();
    await expect(page.getByText("Link added")).toBeVisible();
    await expect(add).toBeHidden();
    const card = links.getByRole("button", { name: /Team docs/ });
    await expect(card).toBeVisible();
    await expect(card).toContainText("docs.example.com");

    // The same URL twice is refused.
    await links.getByRole("button", { name: "Add link" }).click();
    await add.getByLabel("URL").fill(url);
    await add.getByRole("button", { name: "Add link" }).click();
    await expect(
      add.getByText("This link is already in your quick links"),
    ).toBeVisible();
    await add.getByRole("button", { name: "Cancel" }).click();

    // Edit the title.
    await card.hover();
    await links.getByRole("button", { name: "Link actions" }).click();
    await page.getByRole("menuitem", { name: "Edit" }).click();
    const edit = page.getByRole("dialog", { name: "Edit quick link" });
    await expect(edit.getByLabel("URL")).toHaveValue(url);
    await edit.getByLabel(/^Title/).fill("Handbook");
    await edit.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Link updated")).toBeVisible();
    await expect(links.getByRole("button", { name: /Handbook/ })).toBeVisible();

    await page.reload();
    const renamed = widget(page, "Quick links").getByRole("button", {
      name: /Handbook/,
    });
    await expect(renamed).toBeVisible();

    // Delete it.
    await renamed.hover();
    await widget(page, "Quick links")
      .getByRole("button", { name: "Link actions" })
      .click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await expect(page.getByText("Link removed")).toBeVisible();
    await expect(renamed).toHaveCount(0);
    await expect(
      widget(page, "Quick links").getByText(
        "Save links you open often, like docs, dashboards or designs.",
      ),
    ).toBeVisible();
  });
});

test.describe("navigation", () => {
  test("Home jumps to the inbox, Your work and Stickies, and the rail and panel lead back", async ({
    pageAs,
  }) => {
    const { page, workspace } = await newUserWithWorkspace(pageAs);
    await page.goto(workspacePath(workspace.id));
    const rail = page.locator('[data-slot="app-rail"]');
    const panel = page.locator('[data-slot="context-panel"]').first();
    const jump = page.getByRole("region", { name: "Jump back in" });
    // Creating the workspace notifies its owner ("workspace created"), shortly
    // after the API call returns. Counts are a large number with a caption
    // beside it, so the text has no space between them.
    await expect(jump.getByRole("link", { name: /^Inbox/ })).toContainText(
      /All caught up|1\s*unread/,
    );
    await expect(jump.getByRole("link", { name: /^Your work/ })).toContainText(
      /0\s*open/,
    );

    await jump.getByRole("link", { name: /^Stickies/ }).click();
    await expect(page).toHaveURL(
      new RegExp(`${workspacePath(workspace.id)}/stickies$`),
    );
    await expect(page.getByText("No stickies yet")).toBeVisible();

    // The Home panel lists Home and Stickies.
    await panel.getByRole("button", { name: "Home", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${workspacePath(workspace.id)}$`));
    await panel.getByRole("button", { name: "Stickies" }).click();
    await expect(page).toHaveURL(/\/stickies$/);

    await rail.getByRole("button", { name: "Your work" }).click();
    await expect(page).toHaveURL(
      new RegExp(`${workspacePath(workspace.id)}/my-work`),
    );
    const tabs = page.getByRole("navigation", { name: "Your work views" });
    await expect(tabs.getByRole("tab", { name: "Summary" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(
      page.getByRole("complementary", { name: "Recent activity" }),
    ).toBeVisible();

    await rail.getByRole("button", { name: "Home", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${workspacePath(workspace.id)}$`));
  });
});

test.describe("stickies", () => {
  test("adds a sticky, recolours it and deletes an empty one without asking", async ({
    pageAs,
  }) => {
    const { page, workspace } = await newUserWithWorkspace(pageAs);
    await page.goto(`${workspacePath(workspace.id)}/stickies`);
    await expect(page.getByText("No stickies yet")).toBeVisible();
    await expect(
      page.getByText("Only you can see your stickies.").first(),
    ).toBeVisible();

    await page.getByRole("button", { name: "Add sticky" }).first().click();
    const card = page.locator("[data-sticky-id]");
    await expect(card).toHaveCount(1);
    await expect(
      card
        .getByRole("group", { name: "Sticky note" })
        .locator("[contenteditable=true]"),
    ).toBeFocused();
    await expect
      .poll(async () => (await listStickies(page, workspace.id)).length)
      .toBe(1);

    await card.getByRole("button", { name: "Change color" }).click();
    await page.getByRole("button", { name: "Forest" }).click();
    await expect
      .poll(async () => (await listStickies(page, workspace.id))[0]?.color)
      .toBe("green");
    await card.getByRole("button", { name: "Change color" }).click();
    await expect(page.getByRole("button", { name: "Forest" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.keyboard.press("Escape");

    // Home lists it in its Stickies widget, with a way back to the page.
    await page.goto(workspacePath(workspace.id));
    await expect(
      widget(page, "Stickies").locator("[data-sticky-id]"),
    ).toHaveCount(1);
    await widget(page, "Stickies")
      .getByRole("link", { name: "View all" })
      .click();
    await expect(page).toHaveURL(/\/stickies$/);

    // An empty sticky is deleted without a confirmation.
    await card.getByRole("button", { name: "Delete sticky" }).click();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(page.getByText("No stickies yet")).toBeVisible();
    // The card leaves optimistically; the delete request may still be in
    // flight.
    await expect
      .poll(async () => (await listStickies(page, workspace.id)).length)
      .toBe(0);
  });

  test("keeps stored text, searches it and confirms deleting a written note", async ({
    pageAs,
  }) => {
    const { page, workspace } = await newUserWithWorkspace(pageAs);
    const first = `Buy oat milk ${Date.now().toString(36)}`;
    const second = `Call the plumber ${Date.now().toString(36)}`;
    for (const content of [first, second]) {
      const created = await page.request.post(`${E2E_API_URL}/api/sticky`, {
        data: { workspaceId: workspace.id, content },
        headers: ORIGIN,
      });
      expect(created.ok()).toBe(true);
    }

    await page.goto(`${workspacePath(workspace.id)}/stickies`);
    // The editor-backed cards take a while on a cold, busy dev server.
    await expect(stickyCard(page, first)).toBeVisible({ timeout: 45_000 });
    await expect(stickyCard(page, second)).toBeVisible();

    await page.getByRole("button", { name: "Search stickies" }).click();
    const search = page.getByRole("searchbox", { name: "Search stickies" });
    await search.fill("plumber");
    await expect(stickyCard(page, second)).toBeVisible();
    await expect(stickyCard(page, first)).toHaveCount(0);
    await search.fill("zzqqxx");
    await expect(page.getByText("No stickies match “zzqqxx”")).toBeVisible();
    await page.getByRole("button", { name: "Clear search" }).first().click();

    const doomed = stickyCard(page, second);
    await doomed.getByRole("button", { name: "Delete sticky" }).click();
    const confirm = page.getByRole("alertdialog", {
      name: "Delete this sticky?",
    });
    await expect(
      confirm.getByText("This note will be deleted for good."),
    ).toBeVisible();
    await confirm.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText("Sticky deleted")).toBeVisible();
    expect(
      (await listStickies(page, workspace.id)).map((sticky) => sticky.content),
    ).toEqual([first]);
  });

  test("a new sticky keeps its text while you keep editing", async ({
    pageAs,
  }) => {
    const { page, workspace } = await newUserWithWorkspace(pageAs);
    await page.goto(`${workspacePath(workspace.id)}/stickies`);
    await page.getByRole("button", { name: "Add sticky" }).first().click();
    const editor = page
      .getByRole("group", { name: "Sticky note" })
      .first()
      .locator("[contenteditable=true]");
    await expect(editor).toBeFocused();
    await page.keyboard.type("Buy oat milk");
    await expect
      .poll(async () => (await listStickies(page, workspace.id))[0]?.content)
      .toContain("Buy oat milk");

    await editor.click();
    await page.keyboard.press("End");
    await page.keyboard.type(" and coffee");
    await expect
      .poll(async () => (await listStickies(page, workspace.id))[0]?.content, {
        timeout: 10_000,
      })
      .toContain("Buy oat milk and coffee");
  });
});
