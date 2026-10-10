import fs from "node:fs";
import path from "node:path";
import { findOperation } from "./openapi";

// The documentation lives in apps/docs (Mintlify-compatible MDX plus docs.json)
// and is rendered by this site under /docs. It is read from disk at build time,
// and per request in `next dev`.
export const DOCS_DIR = path.join(process.cwd(), "..", "docs");
export const DOCS_BASE = "/docs";

type NavEntrySource = string | { group: string; pages: NavEntrySource[] };

type DocsConfigSource = {
  redirects?: { source: string; destination: string }[];
  navigation: {
    tabs: {
      tab: string;
      groups: { group: string; pages: NavEntrySource[] }[];
    }[];
  };
};

export type DocPage = {
  id: string;
  href: string;
  title: string;
  description: string;
  openapi: { method: string; path: string } | null;
  tab: string;
  group: string;
};

export type NavItem = {
  id: string;
  href: string;
  label: string;
  method: string | null;
};
export type NavGroup = { group: string; items: NavItem[] };
export type NavTab = { tab: string; href: string; groups: NavGroup[] };

type DocsIndex = {
  pages: Map<string, DocPage>;
  byHref: Map<string, DocPage>;
  tabs: NavTab[];
  redirects: Map<string, string>;
};

// Mintlify skips these repository files; so does the site.
const IGNORED_PAGES = new Set([
  "README",
  "CONTRIBUTING",
  "LICENSE",
  "CHANGELOG",
]);

/** `index` -> /docs, `core/index` -> /docs/core, `core/cycles` -> /docs/core/cycles. */
export function docsHref(id: string): string {
  const trimmed = id.replace(/(^|\/)index$/, "");
  return trimmed ? `${DOCS_BASE}/${trimmed}` : DOCS_BASE;
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  const quoted = /^(['"])(.*)\1$/.exec(trimmed);
  return quoted ? (quoted[2] ?? "") : trimmed;
}

/** Splits a page into its flat `key: value` frontmatter and its MDX body. */
export function parseDocSource(source: string): {
  frontmatter: Record<string, string>;
  body: string;
} {
  const normalised = source.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const block = /^---\n([\s\S]*?)\n---\n?/.exec(normalised);
  if (!block) return { frontmatter: {}, body: normalised };
  const frontmatter: Record<string, string> = {};
  for (const line of (block[1] ?? "").split("\n")) {
    const pair = /^([\w-]+):\s*(.*)$/.exec(line);
    if (pair?.[1]) frontmatter[pair[1]] = stripQuotes(pair[2] ?? "");
  }
  return { frontmatter, body: normalised.slice(block[0].length) };
}

function sourceFile(id: string): string | null {
  for (const extension of [".mdx", ".md"]) {
    const file = path.join(DOCS_DIR, `${id}${extension}`);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

function listSourceIds(): string[] {
  const ids: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      if (entry.name === "drafts") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (
        /\.mdx?$/.test(entry.name) &&
        !entry.name.endsWith(".draft.mdx")
      ) {
        const id = path
          .relative(DOCS_DIR, full)
          .split(path.sep)
          .join("/")
          .replace(/\.mdx?$/, "");
        if (!IGNORED_PAGES.has(id)) ids.push(id);
      }
    }
  };
  walk(DOCS_DIR);
  return ids.sort();
}

function parseOpenApiReference(value: string | undefined) {
  if (!value) return null;
  const [method = "", ...route] = value.trim().split(/\s+/);
  if (!method || route.length === 0) return null;
  return { method: method.toUpperCase(), path: route.join(" ") };
}

function readPage(id: string, tab: string, group: string): DocPage {
  const file = sourceFile(id);
  if (!file) {
    throw new Error(`docs.json lists "${id}", but apps/docs has no ${id}.mdx.`);
  }
  const { frontmatter } = parseDocSource(fs.readFileSync(file, "utf8"));
  if (!frontmatter.title) {
    throw new Error(`apps/docs/${id}.mdx has no frontmatter title.`);
  }
  return {
    id,
    href: docsHref(id),
    title: frontmatter.title,
    description: frontmatter.description ?? "",
    openapi: parseOpenApiReference(frontmatter.openapi),
    tab,
    group,
  };
}

function flatten(entries: NavEntrySource[]): string[] {
  return entries.flatMap((entry) =>
    typeof entry === "string" ? [entry] : flatten(entry.pages),
  );
}

function buildIndex(): DocsIndex {
  const config = JSON.parse(
    fs.readFileSync(path.join(DOCS_DIR, "docs.json"), "utf8"),
  ) as DocsConfigSource;

  const pages = new Map<string, DocPage>();
  const tabs: NavTab[] = [];
  for (const tab of config.navigation.tabs) {
    const groups: NavGroup[] = [];
    for (const group of tab.groups) {
      const items: NavItem[] = [];
      for (const id of flatten(group.pages)) {
        const page = readPage(id, tab.tab, group.group);
        pages.set(id, page);
        const operation = page.openapi
          ? findOperation(page.openapi.method, page.openapi.path)
          : null;
        items.push({
          id,
          href: page.href,
          label: operation?.summary ?? page.title,
          method: page.openapi?.method ?? null,
        });
      }
      groups.push({ group: group.group, items });
    }
    tabs.push({
      tab: tab.tab,
      href: groups[0]?.items[0]?.href ?? DOCS_BASE,
      groups,
    });
  }

  // Pages missing from the sidebar are still published, like Mintlify's hidden pages.
  for (const id of listSourceIds()) {
    if (pages.has(id)) continue;
    const tab = id.startsWith("api-reference/")
      ? (tabs[1]?.tab ?? "API Reference")
      : (tabs[0]?.tab ?? "Guides");
    pages.set(id, readPage(id, tab, ""));
  }

  const byHref = new Map<string, DocPage>();
  for (const page of pages.values()) byHref.set(page.href, page);

  const redirects = new Map<string, string>();
  for (const redirect of config.redirects ?? []) {
    redirects.set(
      redirect.source.replace(/^\/+|\/+$/g, ""),
      redirect.destination.replace(/^\/+|\/+$/g, ""),
    );
  }

  return { pages, byHref, tabs, redirects };
}

let cached: { index: DocsIndex; version: number } | null = null;

function docsIndex(): DocsIndex {
  // `next dev` keeps this module between requests: rebuild when docs.json
  // changes so new and moved pages show up without a restart.
  const version =
    process.env.NODE_ENV === "development"
      ? fs.statSync(path.join(DOCS_DIR, "docs.json")).mtimeMs
      : 0;
  if (!cached || cached.version !== version) {
    cached = { index: buildIndex(), version };
  }
  return cached.index;
}

export function getDocsTabs(): NavTab[] {
  return docsIndex().tabs;
}

export function getAllDocPages(): DocPage[] {
  return [...docsIndex().pages.values()];
}

export function getDocPageBySlug(slug: string[] | undefined): DocPage | null {
  const href = slug?.length ? `${DOCS_BASE}/${slug.join("/")}` : DOCS_BASE;
  return docsIndex().byHref.get(href) ?? null;
}

/** Redirect sources from docs.json, as `/docs/...` slugs and their targets. */
export function getDocsRedirects(): { slug: string[]; href: string }[] {
  return [...docsIndex().redirects].map(([source, destination]) => ({
    slug: source.split("/"),
    href: resolveDocLink("index", `/${destination}`),
  }));
}

export function getDocPageBody(page: DocPage): string {
  const file = sourceFile(page.id);
  if (!file) return "";
  return parseDocSource(fs.readFileSync(file, "utf8")).body;
}

/** The previous and next pages in the sidebar order of the page's tab. */
export function getDocNeighbours(page: DocPage): {
  previous: NavItem | null;
  next: NavItem | null;
} {
  const tab = docsIndex().tabs.find((entry) => entry.tab === page.tab);
  const items = tab?.groups.flatMap((group) => group.items) ?? [];
  const index = items.findIndex((item) => item.id === page.id);
  if (index === -1) return { previous: null, next: null };
  return {
    previous: items[index - 1] ?? null,
    next: items[index + 1] ?? null,
  };
}

/**
 * Resolves an href written in a docs page (Mintlify style: `/core/...` is
 * relative to the docs root) to a URL on this site. External links and
 * same-page anchors are returned unchanged.
 */
export function resolveDocLink(fromId: string, href: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//")) return href;
  if (href.startsWith("#")) return href;
  const hashAt = href.indexOf("#");
  const rawPath = hashAt === -1 ? href : href.slice(0, hashAt);
  const hash = hashAt === -1 ? "" : href.slice(hashAt);
  if (rawPath === "") return hash;

  let target: string;
  if (rawPath.startsWith("/")) {
    target = rawPath.replace(/^\/docs(?=\/|$)/, "").replace(/^\/+|\/+$/g, "");
  } else {
    target = path.posix.normalize(
      path.posix.join(path.posix.dirname(fromId), rawPath.replace(/\/+$/, "")),
    );
  }

  const { pages, redirects } = docsIndex();
  if (target === "" || target === ".") target = "index";
  target = redirects.get(target) ?? target;
  // Static files next to the docs, such as openapi.json.
  if (/\.[a-z0-9]+$/i.test(target)) return `${DOCS_BASE}/${target}${hash}`;
  if (!pages.has(target) && pages.has(`${target}/index`)) {
    target = `${target}/index`;
  }
  return `${docsHref(target)}${hash}`;
}
