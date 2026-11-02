import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateRawSync } from "node:zlib";

// Regenerates the committed press kit archive after changing its source
// images. Pure Node (24+), so it runs the same on every platform, and the
// fixed order and timestamps keep the archive byte-for-byte reproducible.
//
//   node scripts/generate-press-kit.mjs                 # build the zip
//   node scripts/generate-press-kit.mjs --render-logos  # also re-render the
//     PNG wordmarks in public/press/logos (needs tests/e2e's Playwright + Edge)
const site = fileURLToPath(new URL("../", import.meta.url));
const repo = join(site, "../..");
const output = join(site, "public/press/margaya-press-kit.zip");
const folder = "margaya-press-kit";
const messages = JSON.parse(
  readFileSync(join(repo, "i18n/en-US.json"), "utf8"),
);
const press = messages.press;

const WORDMARK_PNGS = [
  ["logo-dark.svg", "press/logos/margaya-wordmark-dark.png"],
  ["logo-light.svg", "press/logos/margaya-wordmark-light.png"],
];

if (process.argv.includes("--render-logos")) await renderWordmarks();

// ---------------------------------------------------------------------------
// 01-logos

const logos = [
  ["logo-dark.svg", "01-logos/margaya-wordmark-dark.svg"],
  ["logo-light.svg", "01-logos/margaya-wordmark-light.svg"],
  ...WORDMARK_PNGS.filter(([, png]) =>
    existsSync(join(site, "public", png)),
  ).map(([, png]) => [png, `01-logos/${png.split("/").pop()}`]),
  ["favicon.svg", "01-logos/margaya-icon.svg"],
  ["logo-512.png", "01-logos/margaya-icon-512.png"],
];

// ---------------------------------------------------------------------------
// 02-product, in the manifest's press order, light before dark

const manifest = JSON.parse(
  readFileSync(join(site, "public/images/product/manifest.json"), "utf8"),
);
const views = [...new Set(manifest.screenshots.map((s) => s.view))];
const screenshots = views.flatMap((view, index) =>
  ["light", "dark"].flatMap((theme) => {
    const shot = manifest.screenshots.find(
      (s) => s.view === view && s.theme === theme,
    );
    if (!shot) return [];
    const order = String(index + 1).padStart(2, "0");
    return [
      [
        `images/product/${shot.file}`,
        `02-product/${order}-margaya-${view}-${theme}.png`,
      ],
    ];
  }),
);

// ---------------------------------------------------------------------------
// 03-brand: theme tokens resolved to hex from app/globals.css

const brandColours = buildBrandColours();

const readme = buildReadme();

const assets = [
  ["README.txt", { text: readme }],
  ...logos,
  ...screenshots,
  ["03-brand/brand-colors.txt", { text: brandColours }],
];

// 2000-01-01 00:00:00 in MS-DOS date and time format.
const DOS_TIME = 0;
const DOS_DATE = ((2000 - 1980) << 9) | (1 << 5) | 1;

const localParts = [];
const centralParts = [];
let offset = 0;

for (const [source, name] of assets) {
  const data =
    typeof name === "object"
      ? Buffer.from(name.text, "utf8")
      : readFileSync(join(site, "public", source));
  const entry = typeof name === "object" ? source : name;
  const compressed = deflateRawSync(data, { level: 9 });
  const fileName = Buffer.from(`${folder}/${entry}`, "utf8");
  const checksum = crc32(data);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4); // version needed
  local.writeUInt16LE(0x0800, 6); // UTF-8 names
  local.writeUInt16LE(8, 8); // deflate
  local.writeUInt16LE(DOS_TIME, 10);
  local.writeUInt16LE(DOS_DATE, 12);
  local.writeUInt32LE(checksum, 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(fileName.length, 26);
  local.writeUInt16LE(0, 28);
  localParts.push(local, fileName, compressed);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4); // version made by
  central.writeUInt16LE(20, 6); // version needed
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt16LE(DOS_TIME, 12);
  central.writeUInt16LE(DOS_DATE, 14);
  central.writeUInt32LE(checksum, 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(fileName.length, 28);
  central.writeUInt32LE(offset, 42);
  centralParts.push(central, fileName);

  offset += local.length + fileName.length + compressed.length;
}

const centralDirectory = Buffer.concat(centralParts);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(assets.length, 8);
end.writeUInt16LE(assets.length, 10);
end.writeUInt32LE(centralDirectory.length, 12);
end.writeUInt32LE(offset, 16);

mkdirSync(join(site, "public/press"), { recursive: true });
writeFileSync(output, Buffer.concat([...localParts, centralDirectory, end]));
console.log(
  `Generated public/press/margaya-press-kit.zip (${assets.length} files)`,
);

// ---------------------------------------------------------------------------

/** Plain ASCII, so the text files read the same in every editor. */
function ascii(text) {
  return text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u00D7/g, "x")
    .replace(/[\u2013\u2014]/g, "-");
}

function buildReadme() {
  const wrap = (text, width = 76) => {
    const lines = [];
    let line = "";
    for (const word of text.split(/\s+/)) {
      if (line && `${line} ${word}`.length > width) {
        lines.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    if (line) lines.push(line);
    return lines.join("\n");
  };
  const bullets = (items) =>
    Object.values(items)
      .map((item) => wrap(`- ${item}`).replace(/\n/g, "\n  "))
      .join("\n");
  const shotList = screenshots
    .map(([, name]) => `  ${name.replace("02-product/", "")}`)
    .join("\n");

  return ascii(`MARGAYA PRESS KIT
=================

${wrap(press.boilerplate.short.text)}

Website     https://margaya.app
Press page  https://margaya.app/press
GitHub      https://github.com/manu14357/Margaya
Licence     ${press.facts.licence.value}


ABOUT MARGAYA
-------------

${wrap(press.boilerplate.long.text)}


WHAT'S INSIDE
-------------

01-logos/
  margaya-wordmark-dark.svg / .png   For light backgrounds
  margaya-wordmark-light.svg / .png  For dark backgrounds
  margaya-icon.svg                   ${press.logos.iconSvg.detail}
  margaya-icon-512.png               ${press.logos.iconPng.detail}

02-product/
${wrap(`Real Margaya screens with fictional demo data, ${manifest.viewport.width * manifest.deviceScaleFactor} x ${manifest.viewport.height * manifest.deviceScaleFactor} pixels, light theme before dark:`)}
${shotList}

03-brand/
  brand-colors.txt   Theme colours as hex, and the typefaces


USAGE GUIDELINES
----------------

${wrap(press.intro.replace("on this page", "in this kit"))}

${press.guidelines.doTitle}:
${bullets(press.guidelines.do)}

${press.guidelines.dontTitle}:
${bullets(press.guidelines.dont)}

${wrap(press.contact.body)}
`);
}

function buildBrandColours() {
  const css = readFileSync(join(site, "app/globals.css"), "utf8");
  const theme = readFileSync(
    createRequire(join(site, "package.json")).resolve("tailwindcss/theme.css"),
    "utf8",
  );
  const block = (source, selector) => {
    const start = source.indexOf(`${selector} {`);
    if (start === -1) throw new Error(`No ${selector} block`);
    const body = source.slice(start, source.indexOf("\n}", start));
    const vars = {};
    for (const match of body.matchAll(/(--[\w-]+):\s*([^;]+);/g)) {
      vars[match[1]] = match[2]
        .replace(/\s+/g, " ")
        .replace(/\( /g, "(")
        .replace(/ \)/g, ")")
        .trim();
    }
    return vars;
  };
  const palette = block(theme, "@theme default");
  const light = block(css, ":root");
  const dark = { ...light, ...block(css, ".dark") };

  const resolve = (raw, scope) => {
    const value = raw.trim();
    let match = value.match(/^var\((--[\w-]+)\)$/);
    if (match) {
      const name = match[1];
      const next = scope[name] ?? palette[name];
      if (!next) throw new Error(`Unknown ${name}`);
      return resolve(next, scope);
    }
    match = value.match(/^--alpha\((.+) \/ ([\d.]+)%\)$/);
    if (match) {
      const colour = resolve(match[1], scope);
      return { ...colour, a: Number(match[2]) / 100 };
    }
    match = value.match(/^color-mix\(in srgb, (.+?) ([\d.]+)%, (.+)\)$/);
    if (match) {
      const a = resolve(match[1], scope);
      const b = resolve(match[3], scope);
      const p = Number(match[2]) / 100;
      return {
        r: a.r * p + b.r * (1 - p),
        g: a.g * p + b.g * (1 - p),
        b: a.b * p + b.b * (1 - p),
        a: 1,
      };
    }
    match = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (match) {
      const hex =
        match[1].length === 3
          ? [...match[1]].map((c) => c + c).join("")
          : match[1];
      return {
        r: Number.parseInt(hex.slice(0, 2), 16) / 255,
        g: Number.parseInt(hex.slice(2, 4), 16) / 255,
        b: Number.parseInt(hex.slice(4, 6), 16) / 255,
        a: 1,
      };
    }
    match = value.match(/^oklch\(([\d.]+)% ([\d.]+|none) ([\d.]+|none)\)$/);
    if (match) {
      return oklchToSrgb(
        Number(match[1]) / 100,
        match[2] === "none" ? 0 : Number(match[2]),
        match[3] === "none" ? 0 : Number(match[3]),
      );
    }
    throw new Error(`Cannot resolve colour "${value}"`);
  };

  const hex = ({ r, g, b, a }) => {
    const byte = (v) =>
      Math.round(Math.min(1, Math.max(0, v)) * 255)
        .toString(16)
        .padStart(2, "0")
        .toUpperCase();
    return `#${byte(r)}${byte(g)}${byte(b)}${a < 1 ? byte(a) : ""}`;
  };

  const tokens = Object.keys(light).filter(
    (name) => !/^--(font|radius)/.test(name),
  );
  const width = Math.max(...tokens.map((t) => t.length)) + 2;
  const rows = tokens.map((name) => {
    const l = hex(resolve(light[name], light));
    const d = hex(resolve(dark[name], dark));
    return `${name.slice(2).padEnd(width)}${l.padEnd(12)}${d}`;
  });
  const brand = [
    ["Ink", "#141414", press.colours.ink.usage],
    ["Graphite", "#262626", press.colours.graphite.usage],
    ["Paper", "#F5F5F5", press.colours.paper.usage],
    ["Mist", "#FAFAFA", press.colours.mist.usage],
    ["White", "#FFFFFF", press.colours.white.usage],
  ];

  return ascii(`MARGAYA BRAND COLOURS AND TYPE
==============================

${press.colours.description}

Brand neutrals
--------------
${brand.map(([name, value, usage]) => `${name.padEnd(10)}${value}   ${usage}`).join("\n")}

Theme tokens (app/globals.css)
------------------------------
Hex values of the light (:root) and dark (.dark) themes. Eight-digit values
carry an alpha channel (#RRGGBBAA) and sit on the theme background.

${"token".padEnd(width)}${"light".padEnd(12)}dark
${rows.join("\n")}

Typography
----------
${press.colours.sans.name.padEnd(12)}${press.colours.sans.usage}
${press.colours.mono.name.padEnd(12)}${press.colours.mono.usage}

Both are free under the SIL Open Font License: https://vercel.com/font
`);
}

/** OKLCH to gamma-encoded sRGB, per CSS Color 4. */
function oklchToSrgb(lightness, chroma, hue) {
  const h = (hue * Math.PI) / 180;
  const A = chroma * Math.cos(h);
  const B = chroma * Math.sin(h);
  const l = (lightness + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (lightness - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (lightness - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  const [r, g, b] = linear.map((v) => {
    const abs = Math.abs(v);
    const encoded =
      abs <= 0.0031308 ? 12.92 * abs : 1.055 * abs ** (1 / 2.4) - 0.055;
    return Math.sign(v) * encoded;
  });
  return { r, g, b, a: 1 };
}

/** Renders the SVG wordmarks to 4x PNGs with the repository's Playwright. */
async function renderWordmarks() {
  const { chromium } = createRequire(join(repo, "tests/e2e/package.json"))(
    "@playwright/test",
  );
  const browser = await chromium.launch({ channel: "msedge" });
  try {
    const page = await browser.newPage({
      viewport: { width: 450, height: 104 },
      deviceScaleFactor: 4,
    });
    const fonts = join(site, "node_modules/@fontsource-variable/geist/files");
    const font = readFileSync(join(fonts, "geist-latin-wght-normal.woff2"));
    for (const [svg, png] of WORDMARK_PNGS) {
      const markup = readFileSync(join(site, "public", svg), "utf8");
      await page.setContent(
        `<style>@font-face{font-family:"Geist Variable";font-weight:100 900;src:url(data:font/woff2;base64,${font.toString("base64")}) format("woff2")}html,body{margin:0;background:transparent}svg{display:block}</style>${markup}`,
      );
      await page.evaluate(() => document.fonts.ready);
      mkdirSync(join(site, "public/press/logos"), { recursive: true });
      await page.locator("svg").screenshot({
        path: join(site, "public", png),
        omitBackground: true,
      });
      console.log(`Rendered public/${png}`);
    }
  } finally {
    await browser.close();
  }
}
