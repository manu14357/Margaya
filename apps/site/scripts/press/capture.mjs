#!/usr/bin/env node
/**
 * Captures the product screenshots in public/images/product from the running
 * app, signed in as the fictional press account that seed-demo.mjs creates.
 *
 * LOCAL DEVELOPMENT ONLY. Needs the API (PRESS_API_URL, default :3337) and the
 * web app (PRESS_CLIENT_URL, default :5174) running, plus Microsoft Edge.
 * Playwright comes from tests/e2e, so install that package first.
 *
 *   node scripts/press/capture.mjs                # every view, light and dark
 *   node scripts/press/capture.mjs board task     # only these views
 *   node scripts/press/capture.mjs --manifest     # only rewrite manifest.json
 *
 * Afterwards run `pnpm press:generate` and `node scripts/generate-og.mjs`,
 * and keep lib/press-assets.ts (which reads manifest.json) in mind.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { API_URL, CLIENT_URL, seedDemo } from "./seed-demo.mjs";

const SITE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const REPO = path.resolve(SITE, "../..");
const OUT = path.join(SITE, "public/images/product");

const { chromium } = createRequire(path.join(REPO, "tests/e2e/package.json"))(
  "@playwright/test",
);

const VIEWPORT = { width: 1728, height: 1000 };
const SCALE = 2;
const THEMES = ["light", "dark"];

/** The press order: also the order of manifest.json and the press kit. */
export const VIEWS = [
  ["board", "Board", "Tasks moving across workflow columns."],
  ["list", "List", "Every task grouped by status in a dense list."],
  ["spreadsheet", "Spreadsheet", "Edit task fields inline, like a sheet."],
  ["calendar", "Calendar", "Start and due dates on a month calendar."],
  ["gantt", "Gantt", "Schedules and dependencies on a timeline."],
  ["task", "Task", "Task details, sub-tasks and discussion."],
  ["page", "Page", "Project documents in the block editor."],
  ["cycles", "Cycles", "A sprint with its burndown and progress."],
  ["analytics", "Analytics", "Workload and progress across the workspace."],
  ["inbox", "Inbox", "Mentions, assignments and updates in one place."],
  ["home", "Home", "A personal overview of the workspace."],
];

const HIDE = `
  [data-sonner-toaster], [data-sonner-toast], .tsqd-parent-container,
  [aria-label="Open Tanstack query devtools"], [class*="devtools"] {
    display: none !important;
  }
  *, *::before, *::after {
    caret-color: transparent !important;
    cursor: none !important;
    transition-duration: 0s !important;
    animation-duration: 0s !important;
    animation-delay: 0s !important;
    scroll-behavior: auto !important;
  }
`;

function routes(seed) {
  const ws = `/dashboard/workspace/${seed.workspace.id}`;
  const web = seed.projects.web;
  const project = `${ws}/project/${web.id}`;
  return {
    board: {
      url: `${project}/board`,
      viewMode: "board",
      ready: "Annual billing toggle",
    },
    list: {
      url: `${project}/board`,
      viewMode: "list",
      ready: "Annual billing toggle",
    },
    spreadsheet: {
      url: `${project}/spreadsheet`,
      ready: "Annual billing toggle",
    },
    calendar: { url: `${project}/calendar`, ready: "Annual billing toggle" },
    gantt: { url: `${project}/gantt`, ready: "Ship the new homepage hero" },
    task: {
      url: `${project}/board?taskId=${web.tasks.pricing.id}`,
      ready: "Plan comparison table with the enterprise column",
    },
    page: { url: `${project}/pages/${web.page.id}`, ready: "Launch checklist" },
    cycles: {
      url: `${project}/cycles/${web.cycles["Sprint 14"].id}`,
      ready: "Tasks left",
    },
    analytics: { url: `${ws}/analytics`, ready: "Workload" },
    inbox: {
      url: `${ws}/inbox`,
      ready: "Biometric sign-in",
      // Opens a mention so the reading pane shows the task next to the list.
      prepare: async (page) => {
        await page
          .locator("button, a, [role='button'], [role='option'], li")
          .filter({ hasText: "Redesign the pricing page" })
          .filter({ hasText: "mentioned" })
          .last()
          .click();
        // The pane is done once its sub-tasks and the rail's links are in.
        for (const text of ["Annual billing toggle", "Analytics"]) {
          await page
            .getByText(text, { exact: true })
            .first()
            .waitFor({ state: "visible", timeout: 180_000 });
        }
      },
    },
    home: { url: ws, ready: "Brand guidelines" },
  };
}

async function settle(page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  // Skeletons and lazy charts finish after the network goes quiet.
  await page
    .waitForFunction(
      () => document.querySelectorAll(".animate-pulse").length === 0,
      undefined,
      { timeout: 10_000 },
    )
    .catch(() => {});
  await page.mouse.move(VIEWPORT.width - 2, VIEWPORT.height - 2);
  await page.waitForTimeout(1500);
}

async function capture(browser, seed, theme, views) {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: SCALE,
    colorScheme: theme,
    locale: "en-US",
    reducedMotion: "reduce",
  });
  const signIn = await context.request.post(
    `${API_URL}/api/auth/sign-in/email`,
    {
      data: { email: seed.user.email, password: seed.user.password },
      headers: { Origin: CLIENT_URL },
    },
  );
  if (!signIn.ok()) throw new Error(`sign-in failed: ${signIn.status()}`);

  // Opening a notification marks it read; restore every one before each view
  // so all screens show the same unread count.
  const restoreUnread = async () => {
    const inbox = await context.request.get(
      `${API_URL}/api/notification/inbox`,
      { params: { workspaceId: seed.workspace.id } },
    );
    for (const item of (await inbox.json()).items ?? []) {
      if (item.isRead) {
        await context.request.patch(
          `${API_URL}/api/notification/${item.id}/unread`,
          { headers: { Origin: CLIENT_URL } },
        );
      }
    }
  };

  const all = routes(seed);
  const files = [];
  for (const view of views) {
    const route = all[view];
    await restoreUnread();
    const page = await context.newPage();
    await page.addInitScript(
      ([theme, viewMode]) => {
        const key = "user-preferences";
        let stored = {};
        try {
          stored = JSON.parse(localStorage.getItem(key) ?? "{}");
        } catch {}
        localStorage.setItem(
          key,
          JSON.stringify({
            version: stored.version ?? 0,
            state: {
              ...(stored.state ?? {}),
              theme,
              viewMode,
              sidebarDefaultOpen: true,
            },
          }),
        );
      },
      [theme, route.viewMode ?? "board"],
    );
    await page.goto(`${CLIENT_URL}${route.url}`, {
      waitUntil: "domcontentloaded",
      timeout: 180_000,
    });
    await page.addStyleTag({ content: HIDE });
    // A busy dev server can stall one load, so reload once before giving up.
    const ready = page.getByText(route.ready).first();
    try {
      await ready.waitFor({ state: "visible", timeout: 180_000 });
    } catch {
      await page.reload({ waitUntil: "domcontentloaded", timeout: 180_000 });
      await page.addStyleTag({ content: HIDE });
      await ready.waitFor({ state: "visible", timeout: 300_000 });
    }
    await settle(page);
    if (route.prepare) {
      await route.prepare(page);
      await settle(page);
    }
    // No focus rings on whatever the page focused on load.
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.waitForTimeout(300);
    const file = `${view}-${theme}.png`;
    await page.screenshot({ path: path.join(OUT, file) });
    console.log(`  ${file}`);
    files.push(file);
    await page.close();
  }
  await context.close();
  return files;
}

/**
 * Reduces to a 256-colour palette without dithering, which flat UI survives
 * with crisp text at under half the size. Needs Python with Pillow; without
 * it the original PNG is kept.
 */
function compress(file) {
  const script = [
    "import sys",
    "from PIL import Image",
    "p = sys.argv[1]",
    "im = Image.open(p).convert('RGB')",
    "q = im.quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)",
    "q.save(p, optimize=True)",
  ].join("\n");
  try {
    execFileSync("python", ["-I", "-c", script, file], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function writeManifest() {
  const screenshots = [];
  // Press order: each view in light, then dark.
  for (const [view, title, description] of VIEWS) {
    for (const theme of THEMES) {
      const file = `${view}-${theme}.png`;
      if (!existsSync(path.join(OUT, file))) continue;
      screenshots.push({
        file,
        width: VIEWPORT.width * SCALE,
        height: VIEWPORT.height * SCALE,
        theme,
        view,
        title,
        description,
      });
    }
  }
  const manifest = {
    description:
      "Real Margaya UI with fictional Studio North project data, captured by apps/site/scripts/press/capture.mjs.",
    viewport: VIEWPORT,
    deviceScaleFactor: SCALE,
    date: new Date().toISOString(),
    screenshots,
  };
  writeFileSync(
    path.join(OUT, "manifest.json"),
    `${JSON.stringify(manifest, null, "\t")}\n`,
  );
}

if (
  process.argv[1] === fileURLToPath(import.meta.url) &&
  process.argv.includes("--manifest")
) {
  writeManifest();
  console.log("Wrote manifest.json");
} else if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const only = process.argv.slice(2);
  const views = VIEWS.map(([view]) => view).filter(
    (view) => only.length === 0 || only.includes(view),
  );
  const seed = await seedDemo();
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: "msedge" });
  try {
    for (const theme of THEMES) {
      console.log(`Capturing ${theme}`);
      for (const file of await capture(browser, seed, theme, views)) {
        const target = path.join(OUT, file);
        const before = statSync(target).size;
        if (compress(target)) {
          const after = statSync(target).size;
          console.log(
            `    ${(before / 1024).toFixed(0)} KB -> ${(after / 1024).toFixed(0)} KB`,
          );
        }
      }
    }
  } finally {
    await browser.close();
  }
  writeManifest();
  console.log("Wrote manifest.json");
}
