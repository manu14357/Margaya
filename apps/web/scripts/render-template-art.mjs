#!/usr/bin/env node
/*
 * Dev-only contact sheet of the project-template illustrations.
 *
 *   node scripts/render-template-art.mjs <out.html> [--only id,id] [--primitives]
 *     [--themes light,dark,contrast,dark-contrast] [--png <out.png>]
 *
 * Renders every `src/components/project-templates/art/<id>.tsx` (plus the
 * fallback) with Vite's SSR loader into one static HTML page, at full gallery
 * size and at half size, once per theme. `--png` also screenshots the page
 * with the Playwright install from tests/e2e (bundled Chromium, else Edge).
 * `--primitives` puts a catalogue of every skeleton and accent shape first.
 * Nothing is served and no app data is touched.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import react from "@vitejs/plugin-react";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const webRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const repoRoot = path.resolve(webRoot, "../..");

const THEMES = {
  light: { className: "", page: "#fafaf7", card: "#ffffff", text: "#1c1f1d" },
  dark: {
    className: "dark",
    page: "#0c0d0d",
    card: "#131515",
    text: "#e9ebea",
  },
  contrast: {
    className: "contrast",
    page: "#ffffff",
    card: "#ffffff",
    text: "#0a0d0b",
  },
  "dark-contrast": {
    className: "dark contrast",
    page: "#000000",
    card: "#0a0a0a",
    text: "#ffffff",
  },
};

function parseArgs(argv) {
  const options = {
    out: null,
    only: null,
    themes: ["light", "dark"],
    png: null,
    primitives: false,
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--only")
      options.only = argv[++index].split(",").filter(Boolean);
    else if (arg === "--themes")
      options.themes = argv[++index].split(",").filter(Boolean);
    else if (arg === "--png") options.png = path.resolve(argv[++index]);
    else if (arg === "--primitives") options.primitives = true;
    else if (!options.out) options.out = path.resolve(arg);
    else throw new Error(`Unexpected argument: ${arg}`);
  }
  if (!options.out) {
    throw new Error(
      "Usage: node scripts/render-template-art.mjs <out.html> [--only id,id] [--themes light,dark] [--png <out.png>]",
    );
  }
  for (const theme of options.themes) {
    if (!THEMES[theme])
      throw new Error(
        `Unknown theme "${theme}". Use: ${Object.keys(THEMES).join(", ")}`,
      );
  }
  return options;
}

/** One frame per skeleton, plus one with every accent shape. */
async function renderPrimitives(server) {
  const P = await server.ssrLoadModule(
    "/src/components/project-templates/art/primitives.tsx",
  );
  const { Sparkles } = await import("lucide-react");
  const box = { x: 24, y: 28, w: 272, h: 190 };
  const S = P.Skeleton;
  const samples = {
    "Skeleton.Board": h(S.Board, { ...box, highlight: { column: 1, card: 0 } }),
    "Skeleton.Rows": h(S.Rows, { ...box, highlight: 1 }),
    "Skeleton.Timeline": h(S.Timeline, { ...box, highlight: 2, today: 0.55 }),
    "Skeleton.Calendar": h(S.Calendar, {
      ...box,
      highlight: [9],
      events: [3, 12, 16],
    }),
    "Skeleton.Form": h(S.Form, { ...box }),
    "Skeleton.Cards": h(S.Cards, { ...box, highlight: 1 }),
    "Skeleton.Chart": h(S.Chart, { ...box, highlight: 3 }),
    "Skeleton.Chart horizontal": h(S.Chart, {
      ...box,
      highlight: 0,
      horizontal: true,
      values: [0.9, 0.7, 0.55, 0.4],
    }),
    "Skeleton.Doc": h(S.Doc, { ...box, highlight: 2 }),
    "Accent shapes": [
      h(P.AccentCard, { key: 1, x: 18, y: 18, tilt: -4, avatar: true }),
      h(P.AccentCard, { key: 2, x: 112, y: 18, tone: "soft" }),
      h(P.AccentCard, { key: 3, x: 206, y: 18, outline: true }),
      h(P.AccentBar, { key: 4, x: 18, y: 76, w: 120 }),
      h(P.AccentBar, { key: 5, x: 18, y: 94, w: 80, tone: "accent-5" }),
      h(P.Pill, { key: 6, x: 150, y: 72 }),
      h(P.Pill, { key: 7, x: 214, y: 72, solid: true, tone: "accent-7" }),
      h(P.Avatar, { key: 8, x: 162, y: 112 }),
      h(P.Avatar, { key: 9, x: 186, y: 112, tone: "accent-4" }),
      h(P.Dot, { key: 10, x: 214, y: 112 }),
      h(P.Tick, { key: 11, x: 238, y: 112 }),
      h(P.FlowArrow, { key: 12, from: [24, 170], to: [130, 130] }),
      h(P.Badge, {
        key: 13,
        x: 190,
        y: 164,
        size: 40,
        icon: Sparkles,
        sparks: "left",
        sparkCount: 4,
      }),
      h(P.Badge, {
        key: 14,
        x: 274,
        y: 164,
        size: 40,
        icon: Sparkles,
        tone: "accent",
      }),
    ],
  };
  return Object.entries(samples).map(([id, element]) => ({
    id,
    markup: renderToStaticMarkup(h(P.ArtFrame, { accent: 1 }, element)),
  }));
}

async function renderArts(only, primitives) {
  const server = await createServer({
    configFile: false,
    root: webRoot,
    logLevel: "error",
    appType: "custom",
    server: { middlewareMode: true, hmr: false, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
    plugins: [react()],
    resolve: { alias: { "@": path.join(webRoot, "src") } },
  });
  try {
    const registry = await server.ssrLoadModule(
      "/src/components/project-templates/art/registry.ts",
    );
    const { FallbackTemplateArt } = await server.ssrLoadModule(
      "/src/components/project-templates/template-art.tsx",
    );
    const ids = only ?? registry.templateArtIds;
    const arts = primitives ? await renderPrimitives(server) : [];
    for (const id of ids) {
      const loading = registry.loadTemplateArt(id);
      if (!loading) throw new Error(`No art/${id}.tsx`);
      const { default: Art } = await loading;
      arts.push({ id, markup: renderToStaticMarkup(h(Art)) });
    }
    if (!only) {
      arts.push({
        id: "(fallback)",
        markup: renderToStaticMarkup(h(FallbackTemplateArt)),
      });
    }
    return arts;
  } finally {
    await server.close();
  }
}

function page(arts, themes, css) {
  const sections = themes
    .map((name) => {
      const theme = THEMES[name];
      const cards = arts
        .map(
          ({ id, markup }) => `
        <figure class="card">
          <div class="art">${markup}</div>
          <figcaption><span>${id}</span><div class="small">${markup}</div></figcaption>
        </figure>`,
        )
        .join("");
      return `
    <section class="${theme.className}" style="background:${theme.page};color:${theme.text};--card:${theme.card}">
      <h2>${name}</h2>
      <div class="grid">${cards}</div>
    </section>`;
    })
    .join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Template art contact sheet</title>
<style>
${css}
* { box-sizing: border-box; }
body { margin: 0; font: 13px/1.4 system-ui, sans-serif; }
section { padding: 20px 24px 28px; }
h2 { margin: 0 0 14px; font-size: 14px; font-weight: 600; text-transform: capitalize; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, 320px); gap: 18px; }
.card { margin: 0; border-radius: 14px; background: var(--card); box-shadow: 0 0 0 1px rgb(127 127 127 / 0.25); overflow: hidden; }
.art svg { display: block; width: 320px; height: 200px; }
figcaption { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 10px; font-weight: 600; }
.small svg { display: block; width: 160px; height: 100px; }
</style>
</head>
<body>${sections}
</body>
</html>
`;
}

async function screenshot(htmlPath, pngPath) {
  const requireFromE2e = createRequire(
    path.join(repoRoot, "tests/e2e/package.json"),
  );
  const playwright = await import(
    pathToFileURL(requireFromE2e.resolve("@playwright/test")).href
  );
  const chromium = playwright.chromium ?? playwright.default.chromium;
  let browser;
  try {
    browser = await chromium.launch();
  } catch {
    browser = await chromium.launch({ channel: "msedge" });
  }
  try {
    const browserPage = await browser.newPage({
      viewport: { width: 1400, height: 900 },
    });
    await browserPage.goto(pathToFileURL(htmlPath).href);
    await mkdir(path.dirname(pngPath), { recursive: true });
    await browserPage.screenshot({ path: pngPath, fullPage: true });
  } finally {
    await browser.close();
  }
}

const options = parseArgs(process.argv.slice(2));
const css = await readFile(
  path.join(webRoot, "src/styles/template-art.css"),
  "utf8",
);
const arts = await renderArts(options.only, options.primitives);
await mkdir(path.dirname(options.out), { recursive: true });
await writeFile(options.out, page(arts, options.themes, css));
console.log(
  `Wrote ${arts.length} illustrations x ${options.themes.length} themes to ${options.out}`,
);
if (options.png) {
  await screenshot(options.out, options.png);
  console.log(`Screenshot: ${options.png}`);
}
