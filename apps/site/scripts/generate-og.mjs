#!/usr/bin/env node
/**
 * Generates the site-wide Open Graph image, public/og-image.png: the landing
 * headline over the real board screenshot. `output: "export"` rules out
 * generating it at request time, so the PNG is committed instead.
 *
 * It embeds a PNG and the Geist font, which SVG rasterisers handle poorly, so
 * it renders in Microsoft Edge through the Playwright that tests/e2e installs.
 *
 *   node scripts/generate-og.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const WIDTH = 1200;
const HEIGHT = 630;

function escapeXml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const hero = JSON.parse(
  fs.readFileSync(path.join(ROOT, "../../i18n/en-US.json"), "utf8"),
).landing.home.hero;
const dataUri = (file, type) =>
  `data:${type};base64,${fs.readFileSync(file).toString("base64")}`;
const font = dataUri(
  path.join(
    ROOT,
    "node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2",
  ),
  "font/woff2",
);
const board = dataUri(
  path.join(ROOT, "public/images/product/board-light.png"),
  "image/png",
);
const logo = fs.readFileSync(path.join(ROOT, "public/logo-dark.svg"), "utf8");

const html = `<!doctype html><html><head><style>
  @font-face { font-family: "Geist Variable"; font-weight: 100 900; src: url(${font}) format("woff2"); }
  * { box-sizing: border-box; margin: 0; }
  body { width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; font-family: "Geist Variable", sans-serif;
    background: linear-gradient(180deg, #F5F5F5 0%, #FFFFFF 60%); color: #171717; position: relative; }
  .top { position: absolute; left: 72px; right: 72px; top: 52px; display: flex; align-items: center; justify-content: space-between; }
  .top svg { height: 34px; width: auto; display: block; }
  .url { font-size: 22px; font-weight: 500; color: #737373; }
  h1 { position: absolute; left: 72px; top: 118px; font-size: 54px; font-weight: 600; letter-spacing: -1.6px; line-height: 1.1; }
  h1 span { color: #737373; }
  .shot { position: absolute; left: 72px; right: 72px; top: 214px; height: 520px; border-radius: 14px; overflow: hidden;
    border: 1px solid rgba(0,0,0,0.1); box-shadow: 0 24px 60px -12px rgba(0,0,0,0.22), 0 2px 6px rgba(0,0,0,0.06); background: #fff; }
  .shot img { width: 100%; display: block; }
  </style></head><body>
  <div class="top">${logo}<div class="url">margaya.app</div></div>
  <h1>${escapeXml(hero.title)} <span>${escapeXml(hero.titleAccent)}</span></h1>
  <div class="shot"><img src="${board}" alt=""></div>
  </body></html>`;

const { createRequire } = await import("node:module");
const { chromium } = createRequire(
  path.join(ROOT, "../../tests/e2e/package.json"),
)("@playwright/test");
const browser = await chromium.launch({ channel: "msedge" });
try {
  const page = await browser.newPage({
    viewport: { width: WIDTH, height: HEIGHT },
  });
  await page.setContent(html);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() =>
    [...document.images].every((image) => image.complete),
  );
  await page.screenshot({ path: path.join(ROOT, "public/og-image.png") });
  console.log("og-image.png  (playwright)");
} finally {
  await browser.close();
}
