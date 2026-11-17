import type { Page } from "@playwright/test";
import { test } from "../../../fixtures";
import { loadSeedManifest } from "../../../helpers/auth";
import { projectBoardPath } from "../../../helpers/ui";
import { expect } from "./_support";

// The top of a side panel (SheetHeaderBar), on the task panel. In the
// desktop app's frameless window a side panel runs the full height: row 1
// is the title bar's height and holds only the task's key and status, the
// window buttons alone in their corner; row 2 is the toolbar. In a browser
// it is one row while everything fits. Close panel is a panel glyph, never
// an X, the "N of M" counter never overlaps anything, and on a phone the
// lowest-priority actions move into "…". The checks read seeded data and
// change nothing.

type Platform = "windows" | "linux" | "macos";
const SIZES = [
  { width: 1920, height: 1140 },
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
];

/** A fake `window.__MARGAYA_DESKTOP__`, as in modal-overlays.spec.ts. */
function fakeDesktopBridge(platform: Platform) {
  const calls = { minimize: 0, toggleMaximize: 0, close: 0, startDragging: 0 };
  (window as unknown as { __calls: typeof calls }).__calls = calls;
  (window as unknown as { __MARGAYA_DESKTOP__: unknown }).__MARGAYA_DESKTOP__ =
    {
      version: "0.0.0-e2e",
      platform,
      titleBar: {
        style: "custom",
        platform,
        leftInset: platform === "macos" ? 80 : 0,
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
        minimize: () => calls.minimize++,
        toggleMaximize: () => calls.toggleMaximize++,
        close: () => calls.close++,
        startDragging: () => calls.startDragging++,
        isMaximized: async () => false,
        onStateChange: () => () => {},
      },
    };
}

function loginBug() {
  return loadSeedManifest().projects.web.tasks["login-bug"];
}

async function openTaskPanel(page: Page) {
  const web = loadSeedManifest().projects.web;
  await page.goto(`${projectBoardPath(web)}?taskId=${loginBug().id}`);
  const sheet = page.locator("[data-slot=sheet-popup]");
  await expect(sheet).toBeVisible({ timeout: 30_000 });
  const bar = sheet.locator("[data-slot=sheet-header-bar]");
  // The counter, watch and delete arrive with the board and permissions.
  await expect(bar.getByText(/^\d+ of \d+$/)).toBeVisible();
  await expect(bar.getByRole("button", { name: "More actions" })).toBeVisible();
  // Delete arrives with the permissions, inline or (narrow) in "…".
  await expect(sheet.locator("[data-task-delete]")).toBeAttached();
  return { sheet, bar };
}

type Box = {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

/** Every control and the counter in the header, and the window buttons. */
async function headerBoxes(page: Page) {
  return page.evaluate(() => {
    const box = (el: Element, name: string) => {
      const r = el.getBoundingClientRect();
      return { name, x: r.x, y: r.y, width: r.width, height: r.height };
    };
    const bar = document.querySelector("[data-slot=sheet-header-bar]");
    if (!bar) throw new Error("no header bar");
    const identity = bar.querySelector("[data-slot=sheet-header-identity]");
    const counter = bar.querySelector("[data-slot=task-stepper-position]");
    const panel: Box[] = [];
    for (const el of bar.querySelectorAll("button")) {
      if (el.getBoundingClientRect().width === 0) continue;
      panel.push(
        box(el, el.getAttribute("aria-label") ?? el.textContent ?? ""),
      );
    }
    for (const el of identity?.children ?? []) {
      if (el.tagName !== "BUTTON") panel.push(box(el, "identity"));
    }
    return {
      layout: bar.getAttribute("data-layout"),
      bar: box(bar, "bar"),
      identity: identity ? box(identity, "identity-row") : null,
      toolbar: box(
        bar.querySelector("[data-slot=sheet-header-toolbar]") ?? bar,
        "toolbar",
      ),
      counter: counter
        ? {
            ...box(counter, "counter"),
            clipped:
              (counter as HTMLElement).scrollWidth >
              (counter as HTMLElement).clientWidth + 0.5,
          }
        : null,
      panel,
      window: [
        ...document.querySelectorAll("[data-slot=window-controls] button"),
      ].map((el) => box(el, el.getAttribute("aria-label") ?? "")),
    };
  });
}

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width - 0.5 &&
  b.x < a.x + a.width - 0.5 &&
  a.y < b.y + b.height - 0.5 &&
  b.y < a.y + a.height - 0.5;

function overlapping(boxes: Box[]) {
  const found: string[] = [];
  boxes.forEach((a, i) => {
    for (const b of boxes.slice(i + 1))
      if (overlaps(a, b)) found.push(`${a.name} x ${b.name}`);
  });
  return found;
}

for (const platform of ["windows", "linux", "macos"] as const) {
  test.describe(`side panel header in the desktop app (${platform})`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(fakeDesktopBridge, platform);
    });

    for (const size of SIZES) {
      test(`${size.width}x${size.height}: a title row, then the toolbar`, async ({
        page,
      }) => {
        await page.setViewportSize(size);
        const { sheet, bar } = await openTaskPanel(page);
        await expect(bar).toHaveAttribute("data-layout", "two-rows");
        const m = await headerBoxes(page);

        // Row 1 is the title bar: 48px from the window's top edge.
        expect(m.identity?.y).toBe(0);
        expect(m.identity?.height).toBe(48);
        expect(m.toolbar.y).toBe(48);
        // Only the key (a copy button) is interactive on it.
        const titleRow = m.panel.filter((b) => b.y < 48);
        expect(titleRow.map((b) => b.name)).not.toContain("Close panel");
        for (const b of titleRow)
          expect(b.y + b.height).toBeLessThanOrEqual(48);

        // Nothing overlaps: the panel's controls, the counter and the
        // window buttons, which sit alone in their corner.
        const counter = m.counter;
        if (!counter) throw new Error("no counter");
        expect(counter.clipped).toBe(false);
        expect(counter.width).toBeGreaterThan(0);
        expect(overlapping([...m.panel, counter, ...m.window])).toEqual([]);
        if (platform === "macos") {
          expect(m.window).toHaveLength(0);
        } else {
          expect(m.window).toHaveLength(3);
          const corner = Math.min(...m.window.map((b) => b.x));
          for (const b of titleRow)
            expect(b.x + b.width, b.name).toBeLessThan(corner - 8);
        }

        // The toolbar, in order, with one close: the panel's.
        const names = await bar
          .locator("[data-slot=sheet-header-toolbar] button")
          .evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")));
        expect(names).toEqual([
          "Previous task",
          "Next task",
          expect.stringMatching(/^(Subscribe|Unsubscribe)$/),
          "More actions",
          "Delete task",
          "Open in full page",
          "Close panel",
        ]);
        const close = bar.getByRole("button", { name: "Close panel" });
        await expect(close.locator("svg")).toHaveClass(
          /lucide-panel-right-close/,
        );
        await expect(sheet.locator(".lucide-x")).toHaveCount(0);

        await close.click();
        await expect(sheet).toBeHidden();
      });
    }

    test("the empty title row moves the window and Escape closes the panel", async ({
      page,
    }) => {
      const { sheet } = await openTaskPanel(page);
      const point = await sheet
        .locator("[data-slot=sheet-header-identity]")
        .evaluate((row) => {
          const last = row.lastElementChild?.getBoundingClientRect().right;
          const end =
            row.getBoundingClientRect().right -
            Number.parseFloat(getComputedStyle(row).paddingRight);
          if (last === undefined) throw new Error("empty identity");
          return { x: (last + end) / 2, y: 24 };
        });
      await page.mouse.click(point.x, point.y);
      expect(
        await page.evaluate(
          () =>
            (window as unknown as { __calls: { startDragging: number } })
              .__calls.startDragging,
        ),
      ).toBe(1);
      await expect(sheet).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(sheet).toBeHidden();
    });
  });
}

test.describe("side panel header in a browser", () => {
  for (const size of SIZES) {
    test(`${size.width}x${size.height}: one row that fits`, async ({
      page,
    }) => {
      await page.setViewportSize(size);
      const { bar } = await openTaskPanel(page);
      await expect(bar).toHaveAttribute("data-layout", "one-row");
      const m = await headerBoxes(page);
      expect(m.bar.height).toBe(48);
      const counter = m.counter;
      if (!counter) throw new Error("no counter");
      expect(counter.clipped).toBe(false);
      expect(overlapping([...m.panel, counter])).toEqual([]);
      for (const b of m.panel)
        expect(b.x + b.width, b.name).toBeLessThanOrEqual(
          m.bar.x + m.bar.width,
        );
      await expect(
        bar.getByRole("button", { name: "Delete task" }),
      ).toBeVisible();
      await expect(
        bar.getByRole("button", { name: "Close panel" }),
      ).toBeVisible();
    });
  }
});

test.describe("side panel header on a phone", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });

  test("keeps 44px targets and moves delete into the menu", async ({
    page,
  }) => {
    const { sheet, bar } = await openTaskPanel(page);
    await expect(bar).toHaveAttribute("data-layout", "two-rows");
    const m = await headerBoxes(page);
    const counter = m.counter;
    if (!counter) throw new Error("no counter");
    expect(counter.clipped).toBe(false);
    expect(overlapping([...m.panel, counter])).toEqual([]);
    for (const b of m.panel)
      expect(b.x + b.width, b.name).toBeLessThanOrEqual(m.bar.x + m.bar.width);

    // The toolbar's buttons sit at least a 44px hit area apart.
    const row = m.panel
      .filter((b) => b.y >= m.toolbar.y)
      .sort((a, b) => a.x - b.x);
    for (let index = 1; index < row.length; index += 1) {
      const previous = row[index - 1] as Box;
      const current = row[index] as Box;
      expect(
        current.x + current.width / 2 - (previous.x + previous.width / 2),
        `${previous.name} | ${current.name}`,
      ).toBeGreaterThanOrEqual(44);
    }

    await expect(bar.getByRole("button", { name: "Delete task" })).toHaveCount(
      0,
    );
    await bar.getByRole("button", { name: "More actions" }).click();
    const remove = page.getByRole("menuitem", { name: "Delete task" });
    await expect(remove).toBeVisible();
    await remove.click();
    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(confirm).toBeHidden();
    await expect(sheet).toBeVisible();
  });
});
