#!/usr/bin/env node
/**
 * Captures the product screenshots on docs pages (`<Screenshot src="..." />`)
 * from the running app, signed in as the fictional Studio North accounts.
 *
 * LOCAL DEVELOPMENT ONLY. Needs the API (DOCS_SHOTS_API_URL, default :1337)
 * and the web app (DOCS_SHOTS_CLIENT_URL, default :5173) running, plus
 * Microsoft Edge. Playwright comes from tests/e2e, so install that first.
 *
 *   node apps/site/scripts/docs-shots/capture.mjs <section>             # every shot in specs/<section>.mjs
 *   node apps/site/scripts/docs-shots/capture.mjs <section> board/view  # only these shots
 *
 * A spec file exports an array of shots:
 *
 *   {
 *     name: "board/board-view",          // output name; folders allowed
 *     url: (seed) => `/dashboard/workspace/${seed.workspace.id}/...`,
 *     account: "press",                  // or "owner" (instance admin)
 *     ready: "Visible text",             // waited for before anything else
 *     before: async (page, seed) => {},  // runs before loading, e.g. page.route()
 *     prepare: async (page, seed) => {}, // open menus or dialogs, type, hover
 *     clip: { selector: "[role=dialog]", pad: 16 } | { x, y, width, height },
 *     viewport: { width: 1440, height: 900 },
 *     keepPointer: false,                // true keeps hover and focus from prepare
 *   }
 *
 * Shots are light mode only, by product decision; the dark docs theme shows
 * them in a bordered frame. Each becomes public/images/docs/<name>-light.webp
 * at device scale 2, and its size in CSS pixels goes into
 * public/images/docs/manifest.json, which the docs renderer reads.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(HERE, "../..");
const REPO = path.resolve(SITE, "../..");
const OUT = path.join(SITE, "public/images/docs");
const MANIFEST = path.join(OUT, "manifest.json");

// seed-demo.mjs reads these when it loads, so set them before importing it.
process.env.PRESS_API_URL ??=
  process.env.DOCS_SHOTS_API_URL ?? "http://localhost:1337";
process.env.PRESS_CLIENT_URL ??=
  process.env.DOCS_SHOTS_CLIENT_URL ?? "http://localhost:5173";
const { API_URL, CLIENT_URL, seedDemo } = await import(
  "../press/seed-demo.mjs"
);

const { chromium } = createRequire(path.join(REPO, "tests/e2e/package.json"))(
  "@playwright/test",
);

/** sharp ships with Next; without it the shots are kept as PNG. */
function loadSharp() {
  for (const from of [
    path.join(SITE, "package.json"),
    createRequire(path.join(SITE, "package.json")).resolve("next/package.json"),
  ]) {
    try {
      return createRequire(from)("sharp");
    } catch {}
  }
  return null;
}
const sharp = loadSharp();

const ACCOUNTS = {
  press: null, // filled from the seed
  owner: { email: "owner@margaya.test", password: "Margaya-Owner-2026!" },
};

const DEFAULT_VIEWPORT = { width: 1440, height: 900 };
const SCALE = 2;
const MAX_BYTES = 250 * 1024;

const HIDE = `
  [data-sonner-toaster], [data-sonner-toast], .tsqd-parent-container,
  [aria-label="Open Tanstack query devtools"], [class*="devtools"] {
    display: none !important;
  }
  *, *::before, *::after {
    caret-color: transparent !important;
    transition-duration: 0s !important;
    animation-duration: 0s !important;
    animation-delay: 0s !important;
    scroll-behavior: auto !important;
  }
`;

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function loadSpec(section) {
  const file = path.join(HERE, "specs", `${section}.mjs`);
  if (!existsSync(file)) fail(`No spec file: ${file}`);
  const shots = (await import(pathToFileURL(file).href)).default;
  if (!Array.isArray(shots)) fail(`${file} must export an array of shots.`);
  const names = new Set();
  for (const shot of shots) {
    if (!/^[a-z0-9]+(?:[-/][a-z0-9]+)*$/.test(shot.name ?? "")) {
      fail(`Shot name must be kebab-case (folders allowed): "${shot.name}"`);
    }
    if (names.has(shot.name)) fail(`Duplicate shot name: ${shot.name}`);
    names.add(shot.name);
    if (typeof shot.url !== "function" && typeof shot.url !== "string") {
      fail(`Shot ${shot.name} needs a url (string or function of the seed).`);
    }
  }
  return shots;
}

/** Signs in through the API once per account; the cookies are reused. */
async function signInState(browser, account, seed) {
  const credentials =
    account === "press"
      ? { email: seed.user.email, password: seed.user.password }
      : ACCOUNTS[account];
  if (!credentials) fail(`Unknown account "${account}" (press or owner).`);
  const context = await browser.newContext();
  const response = await context.request.post(
    `${API_URL}/api/auth/sign-in/email`,
    { data: credentials, headers: { Origin: CLIENT_URL } },
  );
  if (!response.ok()) {
    fail(`Sign-in as ${credentials.email} failed: ${response.status()}`);
  }
  // The theme is also a synced server preference that wins over local
  // storage once loaded, so make sure the account itself is on light.
  const preferences = await context.request.get(
    `${API_URL}/api/user/preferences`,
  );
  const current = preferences.ok()
    ? (await preferences.json()).preferences?.theme
    : null;
  if (current !== "light") {
    const saved = await context.request.patch(
      `${API_URL}/api/user/preferences`,
      { data: { theme: "light" }, headers: { Origin: CLIENT_URL } },
    );
    if (!saved.ok()) {
      fail(
        `Setting the light theme for ${credentials.email} failed: ${saved.status()}`,
      );
    }
    console.log(`  ${credentials.email}: theme ${current ?? "unset"} -> light`);
  }
  const state = await context.storageState();
  await context.close();
  return state;
}

async function settle(page) {
  await page
    .waitForLoadState("networkidle", { timeout: 15_000 })
    .catch(() => {});
  // Skeletons and lazy charts finish after the network goes quiet.
  await page
    .waitForFunction(
      () => document.querySelectorAll(".animate-pulse").length === 0,
      undefined,
      { timeout: 10_000 },
    )
    .catch(() => {});
  await page.waitForTimeout(600);
}

async function clipFor(page, shot, viewport) {
  const clip = shot.clip;
  if (!clip) return { x: 0, y: 0, ...viewport };
  let box = clip;
  if (clip.selector) {
    const target = page.locator(clip.selector).first();
    await target.waitFor({ state: "visible", timeout: 30_000 });
    box = await target.boundingBox();
    if (!box) throw new Error(`clip selector has no box: ${clip.selector}`);
  }
  const pad = clip.pad ?? 0;
  const x = Math.max(0, Math.floor(box.x - pad));
  const y = Math.max(0, Math.floor(box.y - pad));
  const right = Math.min(viewport.width, Math.ceil(box.x + box.width + pad));
  const bottom = Math.min(viewport.height, Math.ceil(box.y + box.height + pad));
  return { x, y, width: right - x, height: bottom - y };
}

/** Encodes as WebP, lowering quality until the file fits the size budget. */
async function encode(png, size) {
  if (!sharp) return { buffer: png, format: "png" };
  let image = sharp(png);
  const meta = await image.metadata();
  const width = size.width * SCALE;
  const height = size.height * SCALE;
  if (meta.width !== width || meta.height !== height) {
    image = image.resize(width, height, { fit: "cover", position: "left top" });
  }
  const input = await image.png().toBuffer();
  let buffer = input;
  for (const quality of [86, 80, 72, 64, 56]) {
    buffer = await sharp(input)
      .webp({ quality, smartSubsample: true, effort: 5 })
      .toBuffer();
    if (buffer.length <= MAX_BYTES) break;
  }
  return { buffer, format: "webp" };
}

async function captureShot(browser, states, seed, shot) {
  const theme = "light";
  const viewport = shot.viewport ?? DEFAULT_VIEWPORT;
  const context = await browser.newContext({
    storageState: states[shot.account ?? "press"],
    viewport,
    deviceScaleFactor: SCALE,
    colorScheme: theme,
    locale: "en-US",
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  try {
    await page.addInitScript((theme) => {
      const key = "user-preferences";
      let stored = {};
      try {
        stored = JSON.parse(localStorage.getItem(key) ?? "{}");
      } catch {}
      localStorage.setItem(
        key,
        JSON.stringify({
          version: stored.version ?? 0,
          state: { ...(stored.state ?? {}), theme, sidebarDefaultOpen: true },
        }),
      );
    }, theme);
    if (shot.before) await shot.before(page, seed);
    const url = typeof shot.url === "function" ? shot.url(seed) : shot.url;
    await page.goto(new URL(url, CLIENT_URL).href, {
      waitUntil: "domcontentloaded",
      timeout: 120_000,
    });
    await page.addStyleTag({ content: HIDE });
    if (shot.ready) {
      await page
        .getByText(shot.ready)
        .first()
        .waitFor({ state: "visible", timeout: 120_000 });
    }
    await settle(page);
    if (shot.prepare) {
      await shot.prepare(page, seed);
      await settle(page);
    }
    // No hover states or focus rings left over from loading or preparing,
    // unless the spec asked for them.
    if (!shot.keepPointer) {
      await page.mouse.move(viewport.width - 2, viewport.height - 2);
      await page.evaluate(() => document.activeElement?.blur?.());
    }
    await page.waitForTimeout(300);
    // Docs screenshots are light only, whatever the account prefers.
    if (
      await page.evaluate(() =>
        document.documentElement.classList.contains("dark"),
      )
    ) {
      throw new Error("the app rendered in a dark theme; shots must be light");
    }
    const clip = await clipFor(page, shot, viewport);
    const png = await page.screenshot({ clip });
    return { png, size: { width: clip.width, height: clip.height } };
  } catch (error) {
    const debug = path.join(
      os.tmpdir(),
      `docs-shot-failed-${shot.name.replaceAll("/", "_")}.png`,
    );
    await page.screenshot({ path: debug }).catch(() => {});
    throw new Error(`${error.message}\n    (page at failure: ${debug})`);
  } finally {
    await context.close();
  }
}

/**
 * Upserts entries into manifest.json. Several agents may capture at once, so
 * the read-modify-write runs under a lock directory (mkdir is atomic).
 */
async function upsertManifest(entries) {
  const lock = path.join(os.tmpdir(), "margaya-docs-shots-manifest.lock");
  for (let attempt = 0; ; attempt += 1) {
    try {
      mkdirSync(lock);
      break;
    } catch {
      // A lock older than a minute was left by a crashed run.
      try {
        if (Date.now() - statSync(lock).mtimeMs > 60_000)
          rmSync(lock, { recursive: true });
      } catch {}
      if (attempt > 600) fail("Timed out waiting for the manifest lock.");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  try {
    const manifest = existsSync(MANIFEST)
      ? JSON.parse(readFileSync(MANIFEST, "utf8"))
      : {};
    const shots = { ...(manifest.shots ?? {}), ...entries };
    const sorted = Object.fromEntries(
      Object.keys(shots)
        .sort()
        .map((name) => [name, shots[name]]),
    );
    const next = {
      description:
        "Docs screenshots: real Margaya UI with fictional Studio North data, captured by apps/site/scripts/docs-shots/capture.mjs. Light mode only. Sizes are CSS pixels; the files are twice that.",
      shots: sorted,
    };
    writeFileSync(MANIFEST, `${JSON.stringify(next, null, "\t")}\n`);
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

const [section, ...only] = process.argv.slice(2);
if (!section) {
  fail(
    "Usage: node apps/site/scripts/docs-shots/capture.mjs <section> [shotName ...]",
  );
}
const shots = (await loadSpec(section)).filter(
  (shot) => only.length === 0 || only.includes(shot.name),
);
if (shots.length === 0) fail(`No shots matched: ${only.join(", ")}`);

const seed = await seedDemo();
const browser = await chromium.launch({
  channel: "msedge",
  // `localhost` over IPv6 can hang on this kind of machine; the app must
  // still load as http://localhost:5173 because CORS trusts that origin.
  args: ["--host-resolver-rules=MAP localhost 127.0.0.1"],
});
const failures = [];
try {
  const states = {};
  for (const account of new Set(shots.map((shot) => shot.account ?? "press"))) {
    states[account] = await signInState(browser, account, seed);
  }
  for (const shot of shots) {
    try {
      mkdirSync(path.dirname(path.join(OUT, shot.name)), { recursive: true });
      const { png, size } = await captureShot(browser, states, seed, shot);
      const { buffer, format } = await encode(png, size);
      const file = path.join(OUT, `${shot.name}-light.${format}`);
      writeFileSync(file, buffer);
      console.log(
        `  ${path.relative(SITE, file)}  ${size.width}x${size.height}  ${(buffer.length / 1024).toFixed(0)} KB`,
      );
      await upsertManifest({
        [shot.name]: { width: size.width, height: size.height, format },
      });
    } catch (error) {
      failures.push(shot.name);
      console.error(`  FAILED ${shot.name}: ${error.message}`);
    }
  }
} finally {
  await browser.close();
}
if (failures.length > 0) {
  fail(`${failures.length} shot(s) failed: ${failures.join(", ")}`);
}
console.log(`Captured ${shots.length} shot(s); manifest updated.`);
