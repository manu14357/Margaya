import type { Page } from "@playwright/test";
import { test } from "../../../fixtures";
import { createWorld, signUpUser, type World } from "../../../helpers/api-kit";
import { authFile, loadSeedManifest } from "../../../helpers/auth";
import { E2E_API_URL, E2E_WEB_URL } from "../../../helpers/env";
import { createApiContext, readJson } from "../../../helpers/http";
import {
  createProject,
  deleteProject,
  type TestProject,
} from "../../../helpers/task-data";
import { uniqueName } from "../../../helpers/ui";
import { expect, projectPath, workspaceSectionPath } from "./_support";

// The desktop app's window buttons against the app: minimize, maximize and
// close drawn by the web app at the top right (Windows, Linux) and the macOS
// traffic lights at the top left. Nothing may sit under them, app buttons
// keep a gap and a separator from them, every surface keeps a drag area,
// and an element in full screen keeps a title bar. The bridge is faked, as
// in modal-overlays.spec.ts; the tests only read seeded data, and create
// what they publish in a world of their own.

type Platform = "windows" | "linux" | "macos";
const PLATFORMS = ["windows", "linux", "macos"] as const;
const SIZES = [
  { width: 1024, height: 700 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1140 },
];
/** The least room between an app control and the window buttons. */
const MIN_GAP = 8;

/** A fake `window.__MARGAYA_DESKTOP__` that counts window calls. */
function fakeDesktopBridge(input: { platform: Platform }) {
  const { platform } = input;
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

type Box = { x: number; y: number; w: number; h: number };
type Frame = {
  /** The window buttons (Windows, Linux) or the traffic lights (macOS). */
  box: Box;
  /** App elements that reach into that box. */
  overlaps: string[];
  /** The nearest app control on the same row, and its distance. */
  nearest: { gap: number; el: string } | null;
  /** Whether each window button takes a press at its centre. */
  reachable: boolean[];
  /** Points along the window's top edge that move the window. */
  dragPoints: number;
  /** The hairline before the window buttons, when drawn. */
  separator: string | null;
};

/** Where the window's own buttons are, and what of the app is near them. */
async function frame(page: Page, platform: Platform): Promise<Frame> {
  return page.evaluate((platform) => {
    const round = (r: DOMRect): Box => ({
      x: Math.round(r.x),
      y: Math.round(r.y),
      w: Math.round(r.width),
      h: Math.round(r.height),
    });
    // The fullscreen bar's buttons, while it shows, else the shell's or the
    // slim bar's.
    const controls =
      document.querySelector(
        "[data-slot=desktop-fullscreen-bar] [data-slot=window-controls]",
      ) ?? document.querySelector("[data-slot=window-controls]");
    // The traffic lights: three 12px lights from (16, 17), plus a margin.
    const box =
      platform === "macos"
        ? { x: 12, y: 13, w: 62, h: 22 }
        : controls
          ? round(controls.getBoundingClientRect())
          : null;
    if (!box) throw new Error("no window buttons");
    const describe = (el: Element) =>
      `${el.tagName.toLowerCase()}[${el.getAttribute("data-slot") ?? ""}] ${(
        el.getAttribute("aria-label") ??
        el.textContent ??
        ""
      )
        .trim()
        .slice(0, 40)}`;
    const overlaps: string[] = [];
    let nearest: { gap: number; el: string } | null = null;
    const targets = document.querySelectorAll(
      "button,a[href],input,textarea,[role=button],[role=tab],[role=combobox],[role=menu],[role=dialog]:not([data-slot=sheet-popup]),[role=alertdialog],[data-slot=toast-root]",
    );
    for (const el of targets) {
      if (el.closest("[data-slot=window-controls]")) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none") continue;
      // Only what a press could reach: not what a full-screen element hides.
      const cx = Math.min(Math.max(r.x + r.width / 2, 0), innerWidth - 1);
      const cy = Math.min(Math.max(r.y + r.height / 2, 0), innerHeight - 1);
      const top = document.elementFromPoint(cx, cy);
      const hidden =
        document.fullscreenElement &&
        !document.fullscreenElement.contains(el) &&
        !el.closest("[data-slot=desktop-fullscreen-bar]");
      if (hidden || !top) continue;
      const ix = Math.min(r.right, box.x + box.w) - Math.max(r.left, box.x);
      const iy = Math.min(r.bottom, box.y + box.h) - Math.max(r.top, box.y);
      if (ix > 0.5 && iy > 0.5) overlaps.push(describe(el));
      if (
        iy > 0 &&
        !el.matches("[role=menu],[role=dialog],[role=alertdialog]")
      ) {
        const gap =
          platform === "macos" ? r.left - (box.x + box.w) : box.x - r.right;
        if (gap > -0.5 && (!nearest || gap < nearest.gap))
          nearest = { gap: Math.round(gap * 10) / 10, el: describe(el) };
      }
    }
    const reachable =
      platform === "macos"
        ? []
        : [...(controls?.querySelectorAll("button") ?? [])].map((button) => {
            const r = button.getBoundingClientRect();
            const hit = document.elementFromPoint(
              r.x + r.width / 2,
              r.y + r.height / 2,
            );
            return Boolean(hit && controls?.contains(hit));
          });
    let dragPoints = 0;
    for (let x = 0; x < innerWidth; x += 8) {
      if (document.elementFromPoint(x, 6)?.closest("[data-window-drag]"))
        dragPoints++;
    }
    const before = controls ? getComputedStyle(controls, "::before") : null;
    return {
      box,
      overlaps,
      nearest,
      reachable,
      dragPoints,
      separator:
        before && before.content !== "none" && before.content !== "normal"
          ? before.backgroundColor
          : null,
    };
  }, platform);
}

/** No app element under the window buttons, a gap, and all of it usable. */
function expectClear(result: Frame, platform: Platform, where: string) {
  expect(result.overlaps, `${where}: under the window buttons`).toEqual([]);
  if (result.nearest)
    expect(
      result.nearest.gap,
      `${where}: ${result.nearest.el} is too close`,
    ).toBeGreaterThanOrEqual(MIN_GAP);
  if (platform !== "macos")
    expect(result.reachable, `${where}: window buttons`).toEqual([
      true,
      true,
      true,
    ]);
}

function calls(page: Page) {
  return page.evaluate(
    () => (window as unknown as { __calls: Record<string, number> }).__calls,
  );
}

const web = () => loadSeedManifest().projects.web;
const heroTask = () => web().tasks.hero.id;

function ownerApi() {
  return createApiContext({
    apiURL: E2E_API_URL,
    clientURL: E2E_WEB_URL,
    storageState: authFile("owner"),
  });
}

for (const platform of PLATFORMS) {
  test.describe(`desktop window buttons (${platform})`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(fakeDesktopBridge, { platform });
    });

    test("signed-in screens keep app buttons clear of them, with a drag area, at every size", async ({
      page,
    }) => {
      test.setTimeout(240_000);
      const screens = [
        ["board", projectPath(web().id, "board")],
        ["task page", projectPath(web().id, `task/${heroTask()}`)],
        ["inbox", workspaceSectionPath("inbox")],
        ["whiteboards", workspaceSectionPath("whiteboards")],
      ] as const;
      for (const size of SIZES) {
        await page.setViewportSize(size);
        for (const [name, path] of screens) {
          await page.goto(path);
          await expect(
            page
              .locator("[data-slot=top-bar], [data-slot=layout-header]")
              .first(),
          ).toBeVisible({ timeout: 30_000 });
          const result = await frame(page, platform);
          const where = `${name} at ${size.width}`;
          expectClear(result, platform, where);
          expect(result.dragPoints, `${where}: drag area`).toBeGreaterThan(10);
          if (platform !== "macos") {
            // The hairline that sets the window's buttons apart.
            expect(result.separator, where).not.toBeNull();
            expect(result.box.x + result.box.w).toBe(size.width);
          }
        }
      }
      if (platform === "macos") {
        await expect(page.locator("[data-slot=window-controls]")).toHaveCount(
          0,
        );
      }
    });

    test("menus, dialogs, the palette and top toasts stay clear of them", async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(projectPath(web().id, "board"));
      await expect(page.locator("[data-slot=top-bar]").first()).toBeVisible({
        timeout: 30_000,
      });

      // The account menu and the notifications, at the bar's right end.
      await page.locator("[data-slot=top-bar-account]").click();
      await expect(page.getByRole("menu")).toBeVisible();
      expectClear(await frame(page, platform), platform, "account menu");
      await page.keyboard.press("Escape");
      await page
        .locator("[data-slot=top-bar-actions]")
        .getByRole("button", { name: "Notifications" })
        .click();
      await expect(page.getByRole("menu")).toBeVisible();
      expectClear(await frame(page, platform), platform, "notifications");
      await page.keyboard.press("Escape");

      // The palette and a dialog, in a short window too.
      for (const size of [
        { width: 1024, height: 700 },
        { width: 1440, height: 900 },
      ]) {
        await page.setViewportSize(size);
        await page.keyboard.press("Control+k");
        await expect(
          page.locator("[data-slot=command-dialog-popup]"),
        ).toBeVisible();
        expectClear(await frame(page, platform), platform, "palette");
        await page.keyboard.press("Escape");
        await expect(
          page.locator("[data-slot=command-dialog-popup]"),
        ).toBeHidden();

        await expect(async () => {
          await page
            .locator("[data-slot=shell-main]")
            .click({ position: { x: 4, y: 300 } });
          await page.keyboard.press("p");
          await page.keyboard.press("c");
          await expect(page.getByRole("dialog")).toBeVisible({
            timeout: 2_000,
          });
        }).toPass({ timeout: 20_000 });
        const dialog = await page.getByRole("dialog").boundingBox();
        expect(dialog?.y ?? 0).toBeGreaterThanOrEqual(48);
        expectClear(await frame(page, platform), platform, "dialog");
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog")).toBeHidden();
      }

      // Toasts placed at the top start under the title bar line.
      const toastTop = await page.evaluate(() => {
        const probe = document.createElement("div");
        probe.dataset.slot = "toast-viewport";
        probe.dataset.position = "top-right";
        probe.style.position = "fixed";
        document.body.append(probe);
        const top = probe.getBoundingClientRect().top;
        probe.remove();
        return top;
      });
      expect(toastTop).toBeGreaterThanOrEqual(48);
    });

    test("the inbox preview and Ask keep their own rows under the title bar", async ({
      page,
    }) => {
      // AI is off on the test server; Ask's window only needs to be offered.
      await page.route("**/api/ai/availability**", (route) =>
        route.fulfill({
          json: {
            available: true,
            instanceEnabled: true,
            configured: true,
            workspaceEnabled: true,
            projectEnabled: null,
            canUse: true,
            canManage: false,
            destination: "cloud",
            provider: "test",
            zeroRetention: false,
            requireApprovalForWrites: true,
            autoTranslateComments: false,
            model: null,
            features: {
              webSearch: false,
              storeConversations: false,
              autopilot: false,
              speech: false,
              showReasoning: false,
            },
          },
        }),
      );
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(workspaceSectionPath("inbox"));
      // The seeded "Workspace created" notification opens in the preview,
      // whose header (snooze, archive, close) sits right under the window
      // buttons. Its full-page glyph is covered in inbox-preview.test.tsx.
      await page.getByText("Workspace created").first().click({
        timeout: 30_000,
      });
      const closePreview = page.getByRole("button", { name: "Close preview" });
      await expect(closePreview).toBeVisible();
      expectClear(await frame(page, platform), platform, "inbox preview");
      // A row of its own under the title bar line, never beside the
      // window's close.
      expect((await closePreview.boundingBox())?.y ?? 0).toBeGreaterThanOrEqual(
        48,
      );

      // Ask, docked at the bottom right, expanded, in a wide but short
      // window: its header (expand, close) stays under the title bar line
      // instead of beside the window's maximize and close.
      await page.setViewportSize({ width: 1440, height: 700 });
      await page.goto(projectPath(web().id, "board"));
      await expect(page.locator("[data-slot=top-bar]").first()).toBeVisible({
        timeout: 30_000,
      });
      await page
        .locator("[data-slot=top-bar-actions]")
        .getByRole("button", { name: "Ask AI" })
        .click();
      const ask = page.locator("[data-slot=ask-panel]");
      await expect(ask).toBeVisible();
      for (const step of ["docked", "expanded"]) {
        if (step === "expanded")
          await ask.getByRole("button", { name: "Expand" }).click();
        await expect
          .poll(async () => (await ask.boundingBox())?.y ?? 0)
          .toBeGreaterThanOrEqual(48 + MIN_GAP);
        expectClear(await frame(page, platform), platform, `Ask ${step}`);
      }
    });

    test("an Ask page without AI still has a title row", async ({ page }) => {
      await page.setViewportSize({ width: 1024, height: 700 });
      await page.goto(workspaceSectionPath("ai"));
      await expect(
        page.getByText("AI isn't available in this workspace."),
      ).toBeVisible({
        timeout: 30_000,
      });
      const result = await frame(page, platform);
      expectClear(result, platform, "Ask page");
      // The page's own top row moves the window, not just the rail's.
      await expect(
        page.getByRole("main").locator("[data-slot=top-bar]"),
      ).toBeVisible();
      expect(result.dragPoints).toBeGreaterThan(60);
    });
  });
}

test.describe("an element in full screen", () => {
  let project: TestProject;
  let boardId: string;

  test.beforeAll(async () => {
    const api = await ownerApi();
    project = await createProject(api, { name: uniqueName("Window buttons") });
    await readJson(
      await api.patch(`/api/project/${project.id}/features`, {
        data: { whiteboardsEnabled: true },
      }),
      "turn whiteboards on",
    );
    const board = await readJson<{ id: string }>(
      await api.post("/api/whiteboard", {
        data: { projectId: project.id, title: uniqueName("Board") },
      }),
      "create whiteboard",
    );
    boardId = board.id;
    await api.dispose();
  });

  test.afterAll(async () => {
    const api = await ownerApi();
    if (project) await deleteProject(api, project.id);
    await api.dispose();
  });

  for (const platform of PLATFORMS) {
    test(`keeps a title bar over the whiteboard in full screen (${platform})`, async ({
      page,
    }) => {
      await page.addInitScript(fakeDesktopBridge, { platform });
      await page.setViewportSize({ width: 1024, height: 700 });
      await page.goto(projectPath(project.id, `whiteboards/${boardId}`));
      await expect(
        page.getByRole("application", { name: "Whiteboard canvas" }),
      ).toBeVisible({ timeout: 30_000 });
      await page.getByRole("button", { name: "More board options" }).click();
      await page.getByRole("menuitem", { name: "Full screen" }).click();
      await expect
        .poll(() => page.evaluate(() => Boolean(document.fullscreenElement)))
        .toBe(true);

      const bar = page.locator("[data-slot=desktop-fullscreen-bar]");
      await expect(bar).toBeVisible();
      const barBox = await bar.boundingBox();
      const height = platform === "macos" ? 48 : platform === "linux" ? 36 : 32;
      expect(barBox).toMatchObject({ x: 0, y: 0, width: 1024, height });

      // The editor's toolbar starts under the bar.
      const toolbar = await page
        .locator("[data-slot=whiteboard-canvas]")
        .getByRole("toolbar")
        .first()
        .boundingBox();
      expect(toolbar?.y ?? 0).toBeGreaterThanOrEqual(height);

      const result = await frame(page, platform);
      expectClear(result, platform, "whiteboard full screen");
      expect(result.dragPoints).toBeGreaterThan(60);

      // The bar moves the window, a double-click maximizes, and its
      // buttons work.
      await page.mouse.click(400, height / 2);
      await page.mouse.dblclick(400, height / 2);
      const after = await calls(page);
      expect(after.startDragging).toBeGreaterThan(0);
      expect(after.toggleMaximize).toBe(1);
      if (platform !== "macos") {
        await bar.getByRole("button", { name: "Minimize" }).click();
        await bar.getByRole("button", { name: "Close" }).click();
        const clicked = await calls(page);
        expect(clicked.minimize).toBe(1);
        expect(clicked.close).toBe(1);
      } else {
        await expect(bar.locator("[data-slot=window-controls]")).toHaveCount(0);
      }

      // Escape is the browser's own key, which Playwright cannot press.
      await page.evaluate(() => document.exitFullscreen());
      await expect
        .poll(() => page.evaluate(() => Boolean(document.fullscreenElement)))
        .toBe(false);
      await expect(bar).toHaveCount(0);
    });
  }
});

test.describe("pages without the shell", () => {
  let world: World;
  let paths: Record<string, string> = {};

  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeAll(async () => {
    world = await createWorld("Window buttons");
    const owner = world.users.owner.ctx;
    await readJson(
      await owner.patch(`/api/workspace/${world.workspace.id}/settings`, {
        data: { allowPublicPages: true },
      }),
      "allow public pages",
    );
    const project = await readJson<{ id: string }>(
      await owner.post("/api/project", {
        data: {
          name: uniqueName("Published"),
          slug: `W${Math.random().toString(36).slice(2, 7)}`.toUpperCase(),
          icon: "Layout",
          workspaceId: world.workspace.id,
        },
      }),
      "create project",
    );
    await readJson(
      await owner.patch(`/api/project/${project.id}/features`, {
        data: { pagesEnabled: true, whiteboardsEnabled: true },
      }),
      "turn pages and whiteboards on",
    );
    const doc = await readJson<{ id: string }>(
      await owner.post(`/api/page/project/${project.id}`, {
        data: { title: "Published page", content: "Hello" },
      }),
      "create page",
    );
    const page = await readJson<{ path: string }>(
      await owner.post(`/api/page/${doc.id}/publish`),
      "publish page",
    );
    const board = await readJson<{ id: string }>(
      await owner.post("/api/whiteboard", {
        data: { projectId: project.id, title: "Published board" },
      }),
      "create whiteboard",
    );
    const whiteboard = await readJson<{ publicToken: string }>(
      await owner.post(`/api/whiteboard/${board.id}/publication`),
      "publish whiteboard",
    );
    const publication = await readJson<{ path: string }>(
      await owner.post(`/api/publication/project/${project.id}/publish`, {
        data: {},
      }),
      "publish project",
    );
    paths = {
      "sign-in": "/auth/sign-in",
      "sign-up": "/auth/sign-up",
      "public page": page.path,
      "public whiteboard": `/public-whiteboard/${whiteboard.publicToken}`,
      "public board": publication.path,
    };
  });

  test.afterAll(async () => {
    await world?.dispose();
  });

  for (const platform of PLATFORMS) {
    test(`keep a slim bar with the window buttons clear (${platform})`, async ({
      page,
    }) => {
      test.setTimeout(180_000);
      await page.addInitScript(fakeDesktopBridge, { platform });
      for (const size of SIZES) {
        await page.setViewportSize(size);
        for (const [name, path] of Object.entries(paths)) {
          await page.goto(path);
          const bar = page.locator("[data-slot=desktop-title-bar]");
          await expect(bar).toBeVisible({ timeout: 30_000 });
          await page.waitForLoadState("networkidle");
          const result = await frame(page, platform);
          const where = `${name} at ${size.width}`;
          expectClear(result, platform, where);
          expect(result.dragPoints, where).toBeGreaterThan(60);
          // Content starts under the bar.
          const barBox = await bar.boundingBox();
          const below = await page.evaluate(
            (bottom) =>
              [...document.querySelectorAll("main, header, h1, button, a")]
                .filter((el) => {
                  const r = el.getBoundingClientRect();
                  return (
                    !el.closest("[data-slot=desktop-title-bar]") &&
                    r.height > 1 &&
                    r.width > 1 &&
                    getComputedStyle(el).visibility !== "hidden"
                  );
                })
                .every((el) => el.getBoundingClientRect().top >= bottom - 0.5),
            (barBox?.y ?? 0) + (barBox?.height ?? 0),
          );
          expect(below, where).toBe(true);
        }
      }
    });
  }

  test("onboarding keeps the window movable and closable", async ({ page }) => {
    const user = await signUpUser("Window buttons onboarding");
    await page.addInitScript(fakeDesktopBridge, {
      platform: "windows" as Platform,
    });
    // A new account without a workspace lands on onboarding.
    await page.goto("/auth/sign-in");
    await page.getByLabel("Email").fill(user.email);
    await page
      .getByLabel("Password", { exact: true })
      .or(page.getByPlaceholder("••••••••"))
      .fill(user.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/onboarding/, { timeout: 30_000 });
    await expect(page.locator("[data-slot=desktop-title-bar]")).toBeVisible({
      timeout: 30_000,
    });
    for (const size of SIZES) {
      await page.setViewportSize(size);
      const result = await frame(page, "windows");
      expectClear(result, "windows", `onboarding at ${size.width}`);
      expect(result.dragPoints).toBeGreaterThan(60);
    }
    await user.ctx.dispose();
  });
});

test.describe("right-to-left text", () => {
  for (const platform of ["windows", "linux"] as const) {
    test(`keeps the window buttons where the OS puts them (${platform})`, async ({
      page,
    }) => {
      await page.addInitScript(fakeDesktopBridge, { platform });
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(projectPath(web().id, "board"));
      await expect(page.locator("[data-slot=top-bar]").first()).toBeVisible({
        timeout: 30_000,
      });
      // No shipped locale is right to left yet; set the direction directly.
      await page.evaluate(() => {
        document.documentElement.dir = "rtl";
      });
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
      const controls = page.locator("[data-slot=window-controls]");
      await expect(controls).toBeVisible({ timeout: 30_000 });
      const box = await controls.boundingBox();
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBe(1440);
      // Minimize, maximize, close, from left to right.
      const xs = await controls
        .getByRole("button")
        .evaluateAll((buttons) =>
          buttons.map((b) => b.getBoundingClientRect().x),
        );
      expect(xs).toEqual([...xs].sort((a, b) => a - b));
      await expect(controls.getByRole("button").last()).toHaveAccessibleName(
        "Close",
      );
    });
  }
});
