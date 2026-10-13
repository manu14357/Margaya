import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { APIRequestContext, Page } from "@playwright/test";
import { REPO_ROOT } from "./env";

// Helpers for the opt-in docs-site project: the public site (apps/site on
// :3001) and the documentation sources it links to (apps/docs).

/** Production origin that absolute metadata URLs (og:image, sitemap) use. */
export const SITE_ORIGIN = "https://margaya.app";
/** Path prefix the site links documentation under. */
export const DOCS_PREFIX = "/docs";
export const DOCS_DIR = path.join(REPO_ROOT, "apps", "docs");

// ---------------------------------------------------------------------------
// Branding

// Legacy product names that must never reach a rendered page. Assembled from
// fragments so repository-wide brand greps stay clean.
const FORBIDDEN_BRANDS = [
  ["ka", "neo"],
  ["pla", "ne"],
  ["plan", "ka"],
].map((parts) => parts.join(""));

/** Whole-word, case-insensitive matches of a legacy brand name, with context. */
export function findBrandLeaks(text: string): string[] {
  const pattern = new RegExp(`\\b(?:${FORBIDDEN_BRANDS.join("|")})\\b`, "gi");
  const leaks: string[] = [];
  for (const match of text.matchAll(pattern)) {
    const start = Math.max(0, match.index - 40);
    const context = text
      .slice(start, match.index + match[0].length + 40)
      .replace(/\s+/g, " ");
    leaks.push(`"${match[0]}" in "…${context}…"`);
  }
  return leaks;
}

// ---------------------------------------------------------------------------
// URLs, sitemaps and link checks

/**
 * The same-origin path for an href or absolute production URL, without the
 * fragment, or null for external, mailto and other non-page links.
 */
export function toLocalPath(href: string): string | null {
  let value = href.trim();
  if (value.startsWith(SITE_ORIGIN)) value = value.slice(SITE_ORIGIN.length);
  if (value === "") return "/";
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  const withoutHash = value.split("#")[0] ?? "";
  return withoutHash === "" ? null : withoutHash;
}

export function isDocsPath(localPath: string): boolean {
  return localPath === DOCS_PREFIX || localPath.startsWith(`${DOCS_PREFIX}/`);
}

/** `<loc>` values of a sitemap or sitemap index, as local paths. */
export function parseSitemapLocations(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)]
    .map((match) => toLocalPath(match[1] ?? ""))
    .filter((value): value is string => value !== null);
}

/** Every page path the site lists in /sitemap-pages.xml. */
export async function sitemapPagePaths(
  request: APIRequestContext,
): Promise<string[]> {
  const response = await request.get("/sitemap-pages.xml");
  if (!response.ok()) {
    throw new Error(`/sitemap-pages.xml returned HTTP ${response.status()}`);
  }
  return parseSitemapLocations(await response.text());
}

/** GET each path (at most `concurrency` at a time) and return its status. */
export async function fetchStatuses(
  request: APIRequestContext,
  paths: Iterable<string>,
  concurrency = 6,
): Promise<Map<string, number>> {
  const queue = [...new Set(paths)];
  const statuses = new Map<string, number>();
  async function worker() {
    for (let next = queue.shift(); next; next = queue.shift()) {
      try {
        let response = await request.get(next, { timeout: 120_000 });
        // `next dev` can answer 500 while it compiles a route for a parallel
        // request; a persistent server error still fails on the retry.
        if (response.status() >= 500) {
          response = await request.get(next, { timeout: 120_000 });
        }
        statuses.set(next, response.status());
      } catch {
        statuses.set(next, 0);
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return statuses;
}

/** `path -> status` lines for every status of 400 or more (or no response). */
export function brokenEntries(
  statuses: Map<string, number>,
  referrers?: Map<string, Set<string>>,
): string[] {
  return [...statuses]
    .filter(([, status]) => status === 0 || status >= 400)
    .map(([target, status]) => {
      const from = referrers?.get(target);
      const where = from
        ? ` (linked from ${[...from].slice(0, 3).join(", ")})`
        : "";
      return `${target} -> HTTP ${status}${where}`;
    })
    .sort();
}

export type PageSnapshot = {
  path: string;
  status: number;
  title: string;
  lang: string;
  /** name/property -> content for every <meta> with content. */
  metas: Record<string, string>;
  /** rel -> href for every <link> with an href. */
  links: { rel: string; href: string }[];
  visibleText: string;
  h1Count: number;
  h1Text: string[];
  landmarks: { banner: number; main: number; contentinfo: number };
  imagesWithoutAlt: string[];
  hrefs: string[];
  imageSources: string[];
  ids: string[];
  skipLink: { text: string; target: string } | null;
};

/** Load `path` and capture what the SEO, branding and accessibility checks need. */
export async function snapshotPage(
  page: Page,
  pagePath: string,
): Promise<PageSnapshot> {
  const response = await page.goto(pagePath, { waitUntil: "load" });
  const status = response?.status() ?? 0;
  const data = await page.evaluate(() => {
    const attr = (element: Element, name: string) =>
      element.getAttribute(name) ?? "";
    const metas: Record<string, string> = {};
    for (const meta of document.querySelectorAll("meta[content]")) {
      const key = attr(meta, "name") || attr(meta, "property");
      if (key && !(key in metas)) metas[key] = attr(meta, "content");
    }
    const firstFocusable = document.querySelector(
      "body a[href], body button",
    ) as HTMLAnchorElement | null;
    const skipText = firstFocusable?.textContent?.trim() ?? "";
    const skipHref = firstFocusable?.getAttribute("href") ?? "";
    const roleCount = (selector: string) =>
      document.querySelectorAll(selector).length;
    return {
      title: document.title,
      lang: document.documentElement.lang,
      metas,
      links: [...document.querySelectorAll("link[href]")].map((link) => ({
        rel: attr(link, "rel"),
        href: attr(link, "href"),
      })),
      visibleText: document.body.innerText,
      h1Count: document.querySelectorAll("h1").length,
      h1Text: [...document.querySelectorAll("h1")].map((h1) =>
        (h1 as HTMLElement).innerText.trim(),
      ),
      landmarks: {
        banner: roleCount(
          "header:not(main header):not(article header), [role=banner]",
        ),
        main: roleCount("main, [role=main]"),
        contentinfo: roleCount(
          "footer:not(main footer):not(article footer), [role=contentinfo]",
        ),
      },
      imagesWithoutAlt: [...document.querySelectorAll("img")]
        .filter((image) => !image.hasAttribute("alt"))
        .map((image) => attr(image, "src")),
      hrefs: [...document.querySelectorAll("a[href]")].map((anchor) =>
        attr(anchor, "href"),
      ),
      imageSources: [...document.querySelectorAll("img[src]")].map((image) =>
        attr(image, "src"),
      ),
      ids: [...document.querySelectorAll("[id]")].map((element) => element.id),
      skipLink:
        /skip/i.test(skipText) && skipHref.startsWith("#")
          ? { text: skipText, target: skipHref.slice(1) }
          : null,
    };
  });
  return { path: pagePath, status, ...data };
}

// ---------------------------------------------------------------------------
// Documentation sources (apps/docs, Mintlify)

export type DocsConfig = {
  name: string;
  favicon?: string;
  logo?: { light?: string; dark?: string };
  fonts?: { source?: string };
  redirects?: { source: string; destination: string }[];
  navigation: {
    tabs: { tab: string; openapi?: string; groups: NavGroupSource[] }[];
  };
  seo?: { metatags?: Record<string, string> };
};

type NavGroupSource = { group: string; pages: (string | NavGroupSource)[] };

export type NavGroup = { tab: string; group: string; pages: string[] };

export function loadDocsConfig(): DocsConfig {
  return JSON.parse(readFileSync(path.join(DOCS_DIR, "docs.json"), "utf8"));
}

/** Sidebar groups in order, with nested groups flattened into their pages. */
export function docsNavigation(config = loadDocsConfig()): NavGroup[] {
  const groups: NavGroup[] = [];
  const flatten = (entries: (string | NavGroupSource)[]): string[] =>
    entries.flatMap((entry) =>
      typeof entry === "string" ? [entry] : flatten(entry.pages),
    );
  for (const tab of config.navigation.tabs) {
    for (const group of tab.groups) {
      groups.push({
        tab: tab.tab,
        group: group.group,
        pages: flatten(group.pages),
      });
    }
  }
  return groups;
}

/** Every sidebar page id in sidebar order, e.g. `core/installation/index`. */
export function docsNavigationPages(config = loadDocsConfig()): string[] {
  return docsNavigation(config).flatMap((group) => group.pages);
}

/** The URL the site serves a page id at: `index` -> /docs, `a/index` -> /docs/a. */
export function docsUrl(pageId: string): string {
  const trimmed = pageId.replace(/(^|\/)index$/, "");
  return trimmed ? `${DOCS_PREFIX}/${trimmed}` : DOCS_PREFIX;
}

// Mintlify skips these by default (see apps/docs/.mintignore).
const IGNORED_SOURCES = new Set([
  "README",
  "CONTRIBUTING",
  "LICENSE",
  "CHANGELOG",
]);

/** Every publishable .mdx page id under apps/docs. */
export function docsSourcePages(): string[] {
  const pages: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      if (entry.name === "drafts") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (
        /\.mdx?$/.test(entry.name) &&
        !/\.draft\.mdx$/.test(entry.name)
      ) {
        const id = path
          .relative(DOCS_DIR, full)
          .split(path.sep)
          .join("/")
          .replace(/\.mdx?$/, "");
        if (!IGNORED_SOURCES.has(id)) pages.push(id);
      }
    }
  };
  walk(DOCS_DIR);
  return pages.sort();
}

export type DocPage = {
  id: string;
  frontmatter: Record<string, string>;
  /** Markdown after the frontmatter. */
  body: string;
  /** Body with fenced code removed, for heading and link extraction. */
  prose: string;
  headings: { level: number; text: string }[];
  /** Every id a reader could land on: heading slugs plus explicit ids. */
  anchors: Set<string>;
  /** Markdown and JSX hrefs outside code blocks. */
  links: string[];
  codeBlocks: { info: string; content: string }[];
  /** Fence lines left unclosed at the end of the file. */
  unclosedFence: boolean;
};

export function docSourceExists(id: string): boolean {
  return (
    existsSync(path.join(DOCS_DIR, `${id}.mdx`)) ||
    existsSync(path.join(DOCS_DIR, `${id}.md`))
  );
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  const quoted = /^(['"])(.*)\1$/.exec(trimmed);
  return quoted ? (quoted[2] ?? "") : trimmed;
}

/** Candidate anchor ids for a heading, covering common slug algorithms. */
export function headingSlugs(text: string): string[] {
  const plain = text
    .replace(/<[^>]+>/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*_~]/g, "")
    .trim()
    .toLowerCase();
  const githubStyle = plain
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s/g, "-");
  const collapsed = plain
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  const keepPunctuation = plain.replace(/\s+/g, "-");
  return [
    ...new Set([
      githubStyle,
      collapsed,
      keepPunctuation,
      encodeURIComponent(keepPunctuation),
    ]),
  ];
}

export function readDocPage(id: string): DocPage {
  const file = existsSync(path.join(DOCS_DIR, `${id}.mdx`))
    ? path.join(DOCS_DIR, `${id}.mdx`)
    : path.join(DOCS_DIR, `${id}.md`);
  const source = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  const frontmatter: Record<string, string> = {};
  let body = source;
  const block = /^---\n([\s\S]*?)\n---\n?/.exec(source);
  if (block) {
    body = source.slice(block[0].length);
    for (const line of (block[1] ?? "").split("\n")) {
      const pair = /^([\w-]+):\s*(.*)$/.exec(line);
      if (pair?.[1]) frontmatter[pair[1]] = stripQuotes(pair[2] ?? "");
    }
  }

  const codeBlocks: DocPage["codeBlocks"] = [];
  const proseLines: string[] = [];
  let fence: { marker: string; info: string; lines: string[] } | null = null;
  for (const line of body.split("\n")) {
    const opener = /^\s*(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (opener?.[1]?.startsWith(fence.marker) && !opener[2]?.trim()) {
        codeBlocks.push({ info: fence.info, content: fence.lines.join("\n") });
        fence = null;
      } else {
        fence.lines.push(line);
      }
    } else if (opener) {
      fence = {
        marker: opener[1] ?? "```",
        info: (opener[2] ?? "").trim(),
        lines: [],
      };
    } else {
      proseLines.push(line);
    }
  }
  const prose = proseLines.join("\n");

  const headings = [...prose.matchAll(/^(#{1,6})\s+(.+?)\s*#*\s*$/gm)].map(
    (match) => ({ level: match[1]?.length ?? 0, text: match[2] ?? "" }),
  );
  const anchors = new Set<string>();
  for (const heading of headings) {
    for (const slug of headingSlugs(heading.text)) anchors.add(slug);
  }
  for (const match of prose.matchAll(/\bid=["']([^"']+)["']/g)) {
    if (match[1]) anchors.add(match[1]);
  }
  // Mintlify components such as <Step>, <Accordion> and <Card> take a title
  // that it turns into an anchor as well.
  for (const match of prose.matchAll(/<\w+[^>]*\btitle=["']([^"']+)["']/g)) {
    for (const slug of headingSlugs(match[1] ?? "")) anchors.add(slug);
  }

  const links = [
    ...[
      ...prose.matchAll(
        /(?<!!)\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g,
      ),
    ].map((match) => match[1] ?? ""),
    ...[...prose.matchAll(/\bhref=["']([^"']+)["']/g)].map(
      (match) => match[1] ?? "",
    ),
  ].filter(Boolean);

  return {
    id,
    frontmatter,
    body,
    prose,
    headings,
    anchors,
    links,
    codeBlocks,
    unclosedFence: fence !== null,
  };
}

export type ResolvedDocLink = { page: string; anchor: string | null };

/**
 * Resolve a docs href from page `fromId` to a page id and anchor. Returns null
 * for external links. The page id may not exist; callers check that.
 */
export function resolveDocLink(
  fromId: string,
  href: string,
  config = loadDocsConfig(),
): ResolvedDocLink | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//")) return null;
  const [rawPath = "", rawAnchor] = href.split("#");
  let target: string;
  if (rawPath === "") {
    target = fromId;
  } else if (rawPath.startsWith("/")) {
    target = rawPath.replace(/^\/docs(?=\/|$)/, "").replace(/^\/+|\/+$/g, "");
    if (target === "") target = "index";
  } else {
    target = path.posix.normalize(
      path.posix.join(path.posix.dirname(fromId), rawPath.replace(/\/+$/, "")),
    );
  }
  const redirect = config.redirects?.find(
    (entry) => entry.source === `/${target}`,
  );
  if (redirect) target = redirect.destination.replace(/^\/+/, "");
  if (!docSourceExists(target) && docSourceExists(`${target}/index`)) {
    target = `${target}/index`;
  }
  return {
    page: target,
    anchor: rawAnchor ? decodeURIComponent(rawAnchor) : null,
  };
}

// ---------------------------------------------------------------------------
// OpenAPI (apps/docs/openapi.json)

export type OpenApiOperation = {
  method: string;
  path: string;
  operationId?: string;
  summary?: string;
  tags: string[];
  responses: Record<string, unknown>;
};

export type OpenApiDocument = {
  openapi: string;
  info: { title: string; version: string; description?: string };
  servers?: { url: string }[];
  paths: Record<string, Record<string, unknown>>;
};

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const;

export function loadOpenApi(): OpenApiDocument {
  return JSON.parse(readFileSync(path.join(DOCS_DIR, "openapi.json"), "utf8"));
}

export function openApiOperations(
  document = loadOpenApi(),
): OpenApiOperation[] {
  const operations: OpenApiOperation[] = [];
  for (const [route, item] of Object.entries(document.paths)) {
    for (const method of HTTP_METHODS) {
      const operation = item[method] as
        | {
            operationId?: string;
            summary?: string;
            tags?: string[];
            responses?: Record<string, unknown>;
          }
        | undefined;
      if (!operation) continue;
      operations.push({
        method: method.toUpperCase(),
        path: route,
        operationId: operation.operationId,
        summary: operation.summary,
        tags: operation.tags ?? [],
        responses: operation.responses ?? {},
      });
    }
  }
  return operations;
}

/** `METHOD /path` keys that API reference pages reference via `openapi:` frontmatter. */
export function documentedOperationKeys(
  config = loadDocsConfig(),
): Map<string, string> {
  const keys = new Map<string, string>();
  for (const id of docsNavigationPages(config)) {
    if (!docSourceExists(id)) continue;
    const reference = readDocPage(id).frontmatter.openapi;
    if (!reference) continue;
    const [method = "", ...route] = reference.trim().split(/\s+/);
    keys.set(`${method.toUpperCase()} ${route.join(" ")}`, id);
  }
  return keys;
}
