import type { Page } from "@playwright/test";
import { expect, test } from "../../../fixtures";
import { authFile } from "../../../helpers/auth";
import { E2E_API_URL, E2E_WEB_URL } from "../../../helpers/env";
import { createApiContext } from "../../../helpers/http";
import {
  createCycle,
  createProject,
  createTask,
  isoDayOffset,
} from "../../../helpers/task-data";
import { uniqueName } from "../../../helpers/ui";
import { projectPath } from "./_support";

// The top bar, the project's tab row and the filter bar stay tidy with a
// long project name, a long task title, a long cycle name and every project
// feature on: nothing overlaps, no label is cut off mid-word (truncation
// shows an ellipsis), tabs that do not fit wait in "More", and destructive
// actions stay out of the bar's end. On a laptop and on a phone, in a browser
// and in the desktop app's frameless window.

const ALL_FEATURES = {
  cyclesEnabled: true,
  modulesEnabled: true,
  viewsEnabled: true,
  pagesEnabled: true,
  whiteboardsEnabled: true,
  intakeEnabled: true,
  estimatesEnabled: true,
  timeTrackingEnabled: true,
  updatesEnabled: true,
};

let project: { id: string; name: string };
let taskId: string;
let cycleId: string;

function ownerApi() {
  return createApiContext({
    apiURL: E2E_API_URL,
    clientURL: E2E_WEB_URL,
    storageState: authFile("owner"),
  });
}

test.beforeAll(async () => {
  const api = await ownerApi();
  project = await createProject(api, {
    name: uniqueName(
      "Customer onboarding experience redesign for enterprise accounts",
    ),
    features: ALL_FEATURES,
  });
  const task = await createTask(api, project.id, {
    title:
      "Investigate the intermittent single sign-on failures reported by enterprise customers after the identity provider migration",
    priority: "high",
  });
  taskId = task.id;
  const cycle = await createCycle(api, project.id, {
    name: "Sprint 14 — enterprise onboarding hardening and identity fixes",
    startDate: isoDayOffset(0).slice(0, 10),
    endDate: isoDayOffset(13).slice(0, 10),
  });
  cycleId = cycle.id;
  await api.dispose();
});

test.afterAll(async () => {
  const api = await ownerApi();
  await api.delete(`/api/project/${project.id}`).catch(() => null);
  await api.dispose();
});

type Problems = {
  overlaps: string[];
  cut: string[];
  tabsOutOfRow: string[];
};

/** Overlapping controls and text, cut-off text and half-hidden tabs. */
async function headerProblems(page: Page): Promise<Problems> {
  return page.evaluate(() => {
    const INTERACTIVE =
      "button,a[href],input,[role=button],[role=tab],[role=combobox]";
    const rows = [
      ...document.querySelectorAll(
        "[data-slot=top-bar],[data-slot=view-tabs],[data-slot=filter-bar]",
      ),
    ];
    const shown = (element: Element) => {
      for (
        let node: Element | null = element;
        node;
        node = node.parentElement
      ) {
        const style = getComputedStyle(node);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          Number(style.opacity) < 0.05
        )
          return false;
      }
      const rect = element.getBoundingClientRect();
      return rect.width > 1.5 && rect.height > 1.5;
    };
    type Box = { left: number; top: number; right: number; bottom: number };
    const intersect = (a: Box, b: Box): Box => ({
      left: Math.max(a.left, b.left),
      top: Math.max(a.top, b.top),
      right: Math.min(a.right, b.right),
      bottom: Math.min(a.bottom, b.bottom),
    });
    /** The part of an element not clipped by an ancestor's overflow. */
    const visible = (element: Element): Box => {
      let box: Box = element.getBoundingClientRect();
      for (let node = element.parentElement; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.overflowX !== "visible" || style.overflowY !== "visible")
          box = intersect(box, node.getBoundingClientRect());
      }
      return box;
    };
    const name = (element: Element) =>
      (
        element.getAttribute("aria-label") ||
        element.textContent ||
        element.tagName
      )
        .trim()
        .slice(0, 40);

    const overlaps: string[] = [];
    const cut: string[] = [];
    const tabsOutOfRow: string[] = [];
    const windowButtons = [
      ...document.querySelectorAll("[data-slot=window-controls] button"),
    ];
    for (const row of rows) {
      if (!shown(row)) continue;
      const atoms: Element[] = [];
      for (const element of row.querySelectorAll(INTERACTIVE)) {
        const outer = element.parentElement?.closest(INTERACTIVE);
        if (outer && row.contains(outer)) continue;
        if (shown(element)) atoms.push(element);
      }
      const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const parent = node.parentElement;
        if (!parent || !node.textContent?.trim()) continue;
        if (parent.closest(INTERACTIVE) || !shown(parent)) continue;
        atoms.push(parent);
      }
      if (row.getAttribute("data-slot") === "top-bar") {
        atoms.push(...windowButtons.filter(shown));
      }
      const parts = atoms.map((element) => ({
        element,
        box: visible(element),
      }));
      parts.forEach((a, index) => {
        for (const b of parts.slice(index + 1)) {
          if (a.element.contains(b.element) || b.element.contains(a.element))
            continue;
          const both = intersect(a.box, b.box);
          if (both.right - both.left > 1.5 && both.bottom - both.top > 1.5)
            overlaps.push(`${name(a.element)} × ${name(b.element)}`);
        }
      });
      // Cut off by an ancestor that does not scroll (no ellipsis shows).
      if (row.getAttribute("data-slot") !== "filter-bar") {
        for (const { element, box } of parts) {
          const full = element.getBoundingClientRect();
          if (full.width - (box.right - box.left) > 1.5)
            cut.push(name(element));
        }
      }
      // Every tab is wholly in the row, or in "More".
      if (row.getAttribute("data-slot") === "view-tabs") {
        const rowBox = row.getBoundingClientRect();
        for (const tab of row.querySelectorAll("[role=tab]")) {
          if (!shown(tab)) continue;
          const box = tab.getBoundingClientRect();
          if (box.left < rowBox.left - 1 || box.right > rowBox.right + 1)
            tabsOutOfRow.push(name(tab));
        }
      }
    }
    return { overlaps, cut, tabsOutOfRow };
  });
}

async function settle(page: Page) {
  // A busy shared server can take a while to serve the first project page.
  await expect(page.locator("[data-slot=top-bar]")).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page.locator("[data-slot=top-bar] [data-slot=skeleton]"),
  ).toHaveCount(0);
  // The project and its sections arrive, then the bar and the tab row fit
  // themselves (the full-page task has no tab row).
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(300);
}

const SCREENS = [
  { name: "board", path: () => projectPath(project.id, "board") },
  {
    name: "full-page task",
    path: () => projectPath(project.id, `task/${taskId}`),
  },
  { name: "cycle", path: () => projectPath(project.id, `cycles/${cycleId}`) },
  { name: "updates", path: () => projectPath(project.id, "updates") },
];

function fakeDesktopBridge() {
  (window as unknown as { __MARGAYA_DESKTOP__: unknown }).__MARGAYA_DESKTOP__ =
    {
      version: "0.0.0-e2e",
      platform: "windows",
      titleBar: {
        style: "custom",
        platform: "windows",
        leftInset: 0,
        rightInset: 0,
      },
      notificationSound: "system",
      startBrowserSignIn() {},
      openExternal() {},
      setBadge() {},
      showQuickAdd() {},
      takeHandoffSecret: async () => null,
      showServers() {},
      signedOut() {},
      openSignInPopup() {},
      ready() {},
      setSoundMuted() {},
      window: {
        minimize() {},
        toggleMaximize() {},
        close() {},
        startDragging() {},
        isMaximized: async () => false,
        onStateChange: () => () => {},
      },
    };
}

for (const shell of ["browser", "desktop"] as const) {
  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 390, height: 844 },
  ]) {
    if (shell === "desktop" && viewport.width < 640) continue;
    test.describe(`header rows in the ${shell} at ${viewport.width}px`, () => {
      test.use({ viewport, hasTouch: viewport.width < 640 });

      test.beforeEach(async ({ page }) => {
        if (shell === "desktop") await page.addInitScript(fakeDesktopBridge);
      });

      for (const screen of SCREENS) {
        test(`${screen.name}: nothing overlaps or is cut off`, async ({
          page,
        }) => {
          await page.goto(screen.path());
          await settle(page);
          await expect
            .poll(() => headerProblems(page), { timeout: 10_000 })
            .toEqual({ overlaps: [], cut: [], tabsOutOfRow: [] });
        });
      }

      test("tabs that do not fit are one click away in More", async ({
        page,
      }) => {
        await page.goto(projectPath(project.id, "board"));
        await settle(page);
        const tabs = page.locator("[data-slot=view-tabs]");
        const more = tabs.getByRole("button", { name: "More tabs" });
        // Tabs in "More" stay in the row, hidden.
        const allTabs = await tabs.locator("[role=tab]").count();
        const shownTabs = await tabs.getByRole("tab").count();
        // Six layouts plus eight sections: never all on a phone.
        if (viewport.width < 640) await expect(more).toBeVisible();
        if (!(await more.isVisible())) return;
        await more.click();
        const items = page.getByRole("menuitem");
        expect(shownTabs + (await items.count())).toBe(allTabs);
        expect(allTabs).toBeGreaterThan(shownTabs);
        await items.last().click();
        await expect(page).not.toHaveURL(/\/board$/);
      });
    });
  }
}

test.describe("full-page task header", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("delete waits in the task menu, not at the bar's end", async ({
    page,
  }) => {
    await page.goto(projectPath(project.id, `task/${taskId}`));
    const bar = page.locator("[data-slot=top-bar]");
    // The task loads before its menu shows; a busy server can be slow.
    await expect(bar.getByRole("button", { name: "More actions" })).toBeVisible(
      { timeout: 30_000 },
    );
    await expect(bar.getByRole("button", { name: "Delete task" })).toHaveCount(
      0,
    );
    await bar.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Delete task" }).click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
  });
});
