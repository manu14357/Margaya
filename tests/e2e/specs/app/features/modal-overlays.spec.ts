import type { Page } from "@playwright/test";
import { test } from "../../../fixtures";
import { loadSeedManifest } from "../../../helpers/auth";
import { projectBoardPath } from "../../../helpers/ui";
import { expect } from "./_support";

// Modal overlays (dialogs, confirms, sheets, the command palette) dim the
// whole window evenly: one backdrop over the rail, the panel, the top bar and
// the page, with no blur. In the desktop app's frameless window the top bar is
// the title bar: it is dimmed too, a press on it moves the window instead of
// reaching its buttons, and the window buttons keep working. These checks run
// against the seeded Website Relaunch board and never change data.

type Platform = "windows" | "linux" | "macos";

/** A fake `window.__MARGAYA_DESKTOP__` that counts window calls. */
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

function webProject() {
  return loadSeedManifest().projects.web;
}

async function openBoard(page: Page, search = "") {
  await page.goto(`${projectBoardPath(webProject())}${search}`);
  await expect(page.locator("[data-slot=top-bar]").first()).toBeVisible({
    timeout: 30_000,
  });
}

/** Opens "Create a new project" with its P, C shortcut. */
async function openCreateProject(page: Page) {
  // On a cold page the shortcut can land before the shell registers it.
  await expect(async () => {
    await page
      .locator("[data-slot=shell-main]")
      .click({ position: { x: 4, y: 300 } });
    await page.keyboard.press("p");
    await page.keyboard.press("c");
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}

/**
 * Where the header sits in the hit-test stack at its centre: the overlay's
 * backdrop must come first (it is above the bar), and the bar must not be
 * the topmost element.
 */
async function headerCoverage(page: Page) {
  return page.evaluate(() => {
    const bar = document.querySelector("[data-slot=top-bar]");
    if (!bar) throw new Error("no top bar");
    const box = bar.getBoundingClientRect();
    const x = box.x + box.width * 0.4;
    const y = box.y + box.height / 2;
    const stack = document.elementsFromPoint(x, y);
    const top = document.elementFromPoint(x, y);
    const backdrops = [
      ...document.querySelectorAll<HTMLElement>("[data-overlay-backdrop]"),
    ];
    const painting = backdrops.filter(
      (el) => getComputedStyle(el).backgroundColor !== "rgba(0, 0, 0, 0)",
    );
    return {
      top: top
        ? `${top.tagName.toLowerCase()}[${top.getAttribute("data-slot") ?? ""}]`
        : null,
      topIsBackdrop: Boolean(top?.hasAttribute("data-overlay-backdrop")),
      topInBar: Boolean(top && bar.contains(top)),
      backdropIndex: stack.findIndex((el) =>
        el.hasAttribute("data-overlay-backdrop"),
      ),
      barIndex: stack.indexOf(bar),
      painting: painting.length,
      blur: backdrops.map((el) => getComputedStyle(el).backdropFilter),
      backdropTop: painting[0]?.getBoundingClientRect().top ?? null,
    };
  });
}

test.describe("modal overlays dim the whole window", () => {
  test("a dialog covers the top bar with the one backdrop, without blur", async ({
    page,
  }) => {
    await openBoard(page);
    await openCreateProject(page);
    const hit = await headerCoverage(page);
    // Over the bar the backdrop is what a press lands on.
    expect(hit.topIsBackdrop, hit.top ?? "").toBe(true);
    expect(hit.topInBar).toBe(false);
    expect(hit.backdropIndex).toBeLessThan(hit.barIndex);
    expect(hit.painting).toBe(1);
    expect(hit.backdropTop).toBe(0);
    expect(hit.blur.every((value) => value === "none")).toBe(true);

    // Escape closes it and gives the page back.
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    expect((await headerCoverage(page)).topInBar).toBe(true);
  });

  test("the command palette and the task sheet use the same backdrop", async ({
    page,
  }) => {
    await openBoard(page);
    await page.keyboard.press("Control+k");
    await expect(
      page.locator("[data-slot=command-dialog-popup]"),
    ).toBeVisible();
    const palette = await headerCoverage(page);
    expect(palette.topIsBackdrop, palette.top ?? "").toBe(true);
    expect(palette.painting).toBe(1);
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-slot=command-dialog-popup]")).toBeHidden();

    await openBoard(page, `?taskId=${webProject().tasks.hero.id}`);
    await expect(page.locator("[data-slot=sheet-popup]")).toBeVisible();
    const sheet = await headerCoverage(page);
    expect(sheet.topIsBackdrop, sheet.top ?? "").toBe(true);
    expect(sheet.painting).toBe(1);
  });

  test("a confirm over the task sheet keeps one even dim and Escape closes only the confirm", async ({
    page,
  }) => {
    await openBoard(page, `?taskId=${webProject().tasks.hero.id}`);
    const sheet = page.locator("[data-slot=sheet-popup]");
    await expect(sheet).toBeVisible();
    await sheet.locator("[data-task-delete] button").first().click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    // Two backdrops are mounted, but only the topmost paints, so the sheet
    // under the confirm darkens like the rest and nothing stacks to black.
    await expect
      .poll(async () => {
        const hit = await headerCoverage(page);
        return `${hit.painting}:${hit.topIsBackdrop}`;
      })
      .toBe("1:true");
    await expect(page.locator("[data-overlay-backdrop]")).toHaveCount(2);

    await page.keyboard.press("Escape");
    await expect(page.getByRole("alertdialog")).toBeHidden();
    await expect(sheet).toBeVisible();
    await expect
      .poll(async () => (await headerCoverage(page)).painting)
      .toBe(1);
  });
});

for (const platform of ["windows", "linux", "macos"] as const) {
  test.describe(`desktop app title bar (${platform})`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(fakeDesktopBridge, platform);
    });

    test("is dimmed with the window, moves the window and keeps its buttons working", async ({
      page,
    }) => {
      await openBoard(page);
      await expect(page.locator("html")).toHaveAttribute(
        "data-desktop-titlebar",
        platform,
      );
      await openCreateProject(page);
      const dialog = page.getByRole("dialog");

      const hit = await headerCoverage(page);
      // The backdrop covers the bar from the window's top edge, and the bar
      // takes no presses: the transparent drag strip above it does.
      expect(hit.backdropTop).toBe(0);
      expect(hit.backdropIndex).toBeLessThan(hit.barIndex);
      expect(hit.topInBar).toBe(false);
      expect(hit.top).toBe("div[desktop-overlay-drag]");

      // A press on the dimmed bar moves the window; the dialog stays and the
      // bar's own controls (the command field) do not react.
      const bar = await page.locator("[data-slot=top-bar]").boundingBox();
      if (!bar) throw new Error("no top bar");
      await page.mouse.move(bar.x + bar.width * 0.4, bar.y + bar.height / 2);
      await page.mouse.down();
      await page.mouse.up();
      await expect(dialog).toBeVisible();
      await expect(
        page.locator("[data-slot=command-dialog-popup]"),
      ).toHaveCount(0);
      expect(
        await page.evaluate(
          () =>
            (window as unknown as { __calls: { startDragging: number } })
              .__calls.startDragging,
        ),
      ).toBeGreaterThan(0);

      if (platform === "macos") {
        // The traffic lights are the system's; the page draws no buttons.
        await expect(page.locator("[data-slot=window-controls]")).toHaveCount(
          0,
        );
        return;
      }

      // The window buttons sit above the backdrop, dimmed by the same amount,
      // and still take real clicks.
      const controls = page.locator("[data-slot=window-controls]");
      await expect
        .poll(() => controls.evaluate((el) => getComputedStyle(el).filter))
        .toMatch(/^brightness\(0\.\d+\)$/);
      const buttons = controls.getByRole("button", { includeHidden: true });
      await expect(buttons).toHaveCount(3);
      for (let index = 0; index < 3; index += 1) {
        const box = await buttons.nth(index).boundingBox();
        if (!box) throw new Error("no window button");
        const x = box.x + box.width / 2;
        const y = box.y + box.height / 2;
        expect(
          await page.evaluate(
            ({ px, py }) =>
              Boolean(
                document
                  .elementFromPoint(px, py)
                  ?.closest("[data-slot=window-controls]"),
              ),
            { px: x, py: y },
          ),
        ).toBe(true);
        await page.mouse.click(x, y);
      }
      const calls = await page.evaluate(
        () =>
          (window as unknown as { __calls: Record<string, number> }).__calls,
      );
      expect(calls.minimize).toBe(1);
      expect(calls.toggleMaximize).toBe(1);
      expect(calls.close).toBe(1);
      await expect(dialog).toBeVisible();

      // Closing the dialog brings the buttons back to full brightness.
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect
        .poll(() => controls.evaluate((el) => getComputedStyle(el).filter))
        .toBe("none");
    });

    test("runs the task panel full height, its top row clear of the window buttons", async ({
      page,
    }) => {
      await openBoard(page, `?taskId=${webProject().tasks.hero.id}`);
      const sheet = page.locator("[data-slot=sheet-popup]");
      await expect(sheet).toBeVisible();
      // No strip of dimmed title bar above the panel: it starts at the top.
      await expect.poll(async () => (await sheet.boundingBox())?.y).toBe(0);

      const calls = () =>
        page.evaluate(
          () =>
            (window as unknown as { __calls: Record<string, number> }).__calls,
        );
      const panel = await sheet.boundingBox();
      if (!panel) throw new Error("no panel");
      const controls = page.locator("[data-slot=window-controls]");

      if (platform === "macos") {
        await expect(controls).toHaveCount(0);
      } else {
        // The panel's own buttons never sit under the window buttons.
        const box = await controls.boundingBox();
        if (!box) throw new Error("no window buttons");
        const buttons = await sheet
          .locator("[data-slot=sheet-header-bar]")
          .locator("button")
          .evaluateAll((els) =>
            els.map((el) => {
              const r = el.getBoundingClientRect();
              return { x: r.x, y: r.y, width: r.width, height: r.height };
            }),
          );
        expect(buttons.length).toBeGreaterThan(2);
        for (const b of buttons) {
          const overlaps =
            b.x < box.x + box.width &&
            box.x < b.x + b.width &&
            b.y < box.y + box.height &&
            box.y < b.y + b.height;
          expect(overlaps, JSON.stringify(b)).toBe(false);
        }
        // On the panel's row the buttons look as they are, and work.
        expect(
          await controls.evaluate((el) => getComputedStyle(el).filter),
        ).toBe("none");
        const maximize = controls
          .getByRole("button", { includeHidden: true })
          .nth(1);
        await maximize.click();
        expect((await calls()).toggleMaximize).toBe(1);
      }

      // The empty part of the panel's title row (its key and status, then
      // nothing up to the window buttons) and the dimmed title bar beside
      // the panel both move the window; the panel stays open.
      const titleRow = sheet.locator("[data-slot=sheet-header-identity]");
      const header = await titleRow.boundingBox();
      if (!header) throw new Error("no panel title row");
      const emptyX = await titleRow.evaluate((el) => {
        const last = el.lastElementChild?.getBoundingClientRect().right;
        const end =
          el.getBoundingClientRect().right -
          Number.parseFloat(getComputedStyle(el).paddingRight);
        if (last === undefined) return null;
        return (last + end) / 2;
      });
      if (emptyX === null) throw new Error("no empty space in the title row");
      await page.mouse.click(emptyX, header.y + header.height / 2);
      await page.mouse.click(panel.x / 2, 20);
      expect((await calls()).startDragging).toBe(2);
      await expect(sheet).toBeVisible();

      // A confirm over the panel dims everything again, buttons included.
      await sheet.locator("[data-task-delete] button").first().click();
      await expect(page.getByRole("alertdialog")).toBeVisible();
      if (platform !== "macos") {
        await expect
          .poll(() => controls.evaluate((el) => getComputedStyle(el).filter))
          .toMatch(/^brightness\(0\.\d+\)$/);
      }
      await page.keyboard.press("Escape");
      await expect(page.getByRole("alertdialog")).toBeHidden();
    });
  });
}
