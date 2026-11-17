import type { Page } from "@playwright/test";
import { expect, test } from "../../../fixtures";
import {
  type ApiKey,
  createApiKey,
  deleteApiKey,
  expectJson,
} from "../../../helpers/api-kit";
import { authFile, loadSeedManifest } from "../../../helpers/auth";
import { E2E_API_URL, E2E_WEB_URL } from "../../../helpers/env";
import { createApiContext } from "../../../helpers/http";
import { uniqueName } from "../../../helpers/ui";

// Settings tables fit their column: no sideways scrolling and every row's
// actions on screen, on a laptop and on a phone. Long names, emails and URLs
// are created here so the tables have something to squeeze.

let apiKey: ApiKey | undefined;
let webhookId: string | undefined;
let invitationId: string | undefined;

function ownerApi() {
  return createApiContext({
    apiURL: E2E_API_URL,
    clientURL: E2E_WEB_URL,
    storageState: authFile("owner"),
  });
}

test.beforeAll(async () => {
  const seed = loadSeedManifest();
  const api = await ownerApi();
  const suffix = Date.now().toString(36);
  apiKey = await createApiKey(api, uniqueName("Deploy key"));
  const webhook = await expectJson<{ id?: string; webhook?: { id: string } }>(
    await api.post("/api/webhook", {
      data: {
        workspaceId: seed.workspace.id,
        name: uniqueName(
          "Interplanetary logistics and operations coordination",
        ),
        url: `https://hooks.integration-platform.example.com/services/${"x".repeat(40)}/${suffix}`,
        events: ["task.*", "comment.created"],
      },
    }),
    [200, 201],
  );
  webhookId = webhook.webhook?.id ?? webhook.id;
  const invitation = await expectJson<{ id: string }>(
    await api.post("/api/auth/organization/invite-member", {
      data: {
        email: `pending.invitee.with.a.really.long.address.${suffix}@subsidiary-organisation.example.com`,
        role: "member",
        organizationId: seed.workspace.id,
      },
    }),
    [200, 201],
  );
  invitationId = invitation.id;
  await api.dispose();
});

test.afterAll(async () => {
  const api = await ownerApi();
  if (apiKey) await deleteApiKey(api, apiKey.id);
  if (webhookId)
    await api.delete(`/api/webhook/${webhookId}`).catch(() => null);
  if (invitationId) {
    await api
      .post("/api/auth/organization/cancel-invitation", {
        data: { invitationId },
      })
      .catch(() => null);
  }
  await api.dispose();
});

const PAGES: { name: string; path: (workspaceId: string) => string }[] = [
  { name: "Workspaces", path: () => "/dashboard/settings/instance/workspaces" },
  { name: "Admins", path: () => "/dashboard/settings/instance/admins" },
  { name: "Users", path: () => "/dashboard/settings/instance/users" },
  { name: "Members", path: (id) => `/dashboard/workspace/${id}/members` },
  { name: "Webhooks", path: () => "/dashboard/settings/workspace/webhooks" },
  { name: "API keys", path: () => "/dashboard/settings/account/developer" },
  { name: "Audit log", path: () => "/dashboard/settings/workspace/audit-log" },
];

/** Horizontal overflow of the page, the settings canvas and every table. */
async function overflow(page: Page) {
  return page.evaluate(() => {
    const over = (element: Element | null) =>
      element ? element.scrollWidth - element.clientWidth : 0;
    return {
      document: over(document.documentElement),
      canvas: over(document.querySelector("[data-slot=settings-canvas]")),
      tables: [...document.querySelectorAll("[data-slot=settings-table]")].map(
        (table) => over(table),
      ),
    };
  });
}

/** Row action buttons that stick out of their table or the window. */
async function clippedActions(page: Page) {
  return page.evaluate(() => {
    const clipped: string[] = [];
    for (const table of document.querySelectorAll(
      "[data-slot=settings-table]",
    )) {
      const box = table.getBoundingClientRect();
      for (const button of table.querySelectorAll(
        "td[data-kind=actions] button",
      )) {
        const rect = button.getBoundingClientRect();
        if (rect.width === 0) continue; // the folded-away variant
        if (
          rect.left < box.left - 1 ||
          rect.right > Math.min(box.right, window.innerWidth) + 1
        ) {
          clipped.push(
            button.getAttribute("aria-label") ?? button.textContent ?? "",
          );
        }
      }
    }
    return clipped;
  });
}

for (const viewport of [
  { width: 1280, height: 900 },
  { width: 390, height: 844 },
]) {
  test.describe(`settings tables at ${viewport.width}px`, () => {
    test.use({ viewport, hasTouch: viewport.width < 640 });

    for (const target of PAGES) {
      test(`${target.name} fits without sideways scrolling`, async ({
        page,
        seed,
      }) => {
        await page.goto(target.path(seed.workspace.id));
        const table = page.locator("[data-slot=settings-table]").first();
        await expect(table).toBeVisible();
        await expect(table.getByRole("row").nth(1)).toBeVisible();

        const measured = await overflow(page);
        expect(measured.document, "page scrolls sideways").toBeLessThanOrEqual(
          0,
        );
        expect(measured.canvas, "canvas scrolls sideways").toBeLessThanOrEqual(
          0,
        );
        for (const tableOverflow of measured.tables) {
          expect(tableOverflow, "a table scrolls sideways").toBeLessThanOrEqual(
            0,
          );
        }
        expect(await clippedActions(page)).toEqual([]);

        // Every row with actions shows one on screen.
        const actionCells = table.locator("td[data-kind=actions]");
        const count = await actionCells.count();
        for (let index = 0; index < Math.min(count, 10); index++) {
          const cell = actionCells.nth(index);
          if ((await cell.locator("button").count()) === 0) continue;
          await cell.scrollIntoViewIfNeeded();
          await expect(cell.locator("button:visible").first()).toBeInViewport();
        }
      });
    }
  });
}

test("a phone shows table rows as labelled cards", async ({ page, seed }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/dashboard/workspace/${seed.workspace.id}/members`);
  const table = page.locator("[data-slot=settings-table]");
  // Column headers stay for screen readers but leave the layout.
  await expect(table.getByRole("rowgroup").first()).toHaveCSS(
    "position",
    "absolute",
  );
  const row = table.getByRole("row").nth(1);
  await expect(row).toHaveCSS("display", "grid");
  await expect(row.getByText("Role", { exact: true })).toBeVisible();
});
