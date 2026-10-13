import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "../../fixtures";
import {
  DOCS_DIR,
  docSourceExists,
  docsNavigation,
  docsNavigationPages,
  docsSourcePages,
  findBrandLeaks,
  loadDocsConfig,
  readDocPage,
  resolveDocLink,
} from "../../helpers/docs-site";

// Opt-in docs-site project: E2E_DOCS_SITE=1 pnpm e2e --project=docs-site
//
// The documentation sources behind the site's /docs links (apps/docs, MDX
// plus docs.json, rendered by apps/site). These checks read docs.json and the
// .mdx pages directly: the sidebar, every page it lists, links, anchors,
// headings, code blocks and branding.

const config = loadDocsConfig();
const navigationPages = docsNavigationPages(config);
const guidePages = navigationPages.filter(
  (id) => !id.startsWith("api-reference/endpoints/"),
);

test.describe("sidebar", () => {
  test("docs.json lists both tabs and the guide sections", () => {
    expect(config.navigation.tabs.map((tab) => tab.tab)).toEqual([
      "Guides",
      "API Reference",
    ]);
    const groups = docsNavigation(config).map((group) => group.group);
    expect(groups).toEqual(
      expect.arrayContaining([
        "Overview",
        "Functional Guides",
        "Installation",
        "Integrations",
        "Authentication Providers",
        "Deployment & Operations",
        "Projects",
        "Tasks",
        "Notifications",
      ]),
    );
    for (const group of docsNavigation(config)) {
      expect(
        group.pages.length,
        `${group.tab} / ${group.group}`,
      ).toBeGreaterThan(0);
    }
    expect(new Set(navigationPages).size).toBe(navigationPages.length);
  });

  test("every sidebar page has a source with a title and a description", () => {
    const problems: string[] = [];
    for (const id of navigationPages) {
      if (!docSourceExists(id)) {
        problems.push(`${id}: no .mdx source`);
        continue;
      }
      const { frontmatter } = readDocPage(id);
      if (!frontmatter.title?.trim()) problems.push(`${id}: no title`);
      if (!frontmatter.description?.trim())
        problems.push(`${id}: no description`);
    }
    expect(problems).toEqual([]);
  });

  test("every docs page is reachable from the sidebar", () => {
    const listed = new Set(navigationPages);
    expect(docsSourcePages().filter((id) => !listed.has(id))).toEqual([]);
  });

  test("redirects lead to existing pages", () => {
    const problems = (config.redirects ?? [])
      .filter(
        (redirect) =>
          !docSourceExists(redirect.destination.replace(/^\/+/, "")),
      )
      .map((redirect) => `${redirect.source} -> ${redirect.destination}`);
    expect(problems).toEqual([]);
  });
});

test.describe("pages", () => {
  test("internal links point to existing pages", () => {
    const problems: string[] = [];
    for (const id of navigationPages) {
      for (const href of readDocPage(id).links) {
        const target = resolveDocLink(id, href, config);
        if (!target) continue;
        const isAsset = /\.[a-z0-9]+$/i.test(target.page);
        const exists = isAsset
          ? existsSync(path.join(DOCS_DIR, target.page))
          : docSourceExists(target.page);
        if (!exists) problems.push(`${id}: ${href} -> missing ${target.page}`);
      }
    }
    expect(problems).toEqual([]);
  });

  test("in-page anchors point to existing headings", () => {
    const problems: string[] = [];
    for (const id of navigationPages) {
      for (const href of readDocPage(id).links) {
        const target = resolveDocLink(id, href, config);
        if (!target?.anchor || !docSourceExists(target.page)) continue;
        if (
          !readDocPage(target.page).anchors.has(target.anchor.toLowerCase())
        ) {
          problems.push(
            `${id}: ${href} -> no heading #${target.anchor} in ${target.page}`,
          );
        }
      }
    }
    expect(problems).toEqual([]);
  });

  test("each page has a single h1, rendered from its frontmatter title", () => {
    const problems = navigationPages
      .filter((id) =>
        readDocPage(id).headings.some((heading) => heading.level === 1),
      )
      .map((id) => `${id}: body contains a level-1 heading`);
    expect(problems).toEqual([]);
  });

  test("headings do not skip levels", () => {
    const problems: string[] = [];
    for (const id of guidePages) {
      let previous = 1;
      for (const heading of readDocPage(id).headings) {
        if (heading.level > previous + 1) {
          problems.push(
            `${id}: h${previous} -> h${heading.level} "${heading.text}"`,
          );
        }
        previous = heading.level;
      }
    }
    expect(problems).toEqual([]);
  });

  test("code blocks are closed and not empty", () => {
    const problems: string[] = [];
    let blocks = 0;
    for (const id of navigationPages) {
      const page = readDocPage(id);
      if (page.unclosedFence) problems.push(`${id}: unclosed code fence`);
      for (const block of page.codeBlocks) {
        blocks += 1;
        if (!block.content.trim())
          problems.push(`${id}: empty code block (${block.info})`);
      }
    }
    expect(problems).toEqual([]);
    expect(blocks).toBeGreaterThan(50);

    // The Docker Compose guide shows a runnable compose file.
    const compose = readDocPage("core/installation/docker-compose").codeBlocks;
    expect(compose.some((block) => /services:/.test(block.content))).toBe(true);
  });

  test("setup guides exist for every integration the site advertises", () => {
    for (const id of [
      "core/installation/docker-compose",
      "core/installation/environment-variables",
      "core/integrations/github/setup",
      "core/integrations/mcp",
      "core/integrations/slack",
      "core/integrations/discord",
      "core/integrations/telegram",
      "core/integrations/outgoing-webhooks",
      "core/social-providers/custom-oauth",
      "core/functional/cycles",
      "core/functional/modules",
      "core/functional/estimates",
    ]) {
      expect(navigationPages, id).toContain(id);
    }
  });
});

test.describe("branding", () => {
  test("no docs page mentions a legacy brand name", () => {
    const problems: string[] = [];
    for (const id of docsSourcePages()) {
      const page = readDocPage(id);
      for (const leak of [
        ...findBrandLeaks(page.body),
        ...Object.values(page.frontmatter).flatMap(findBrandLeaks),
      ]) {
        problems.push(`${id}: ${leak}`);
      }
    }
    expect(problems).toEqual([]);
  });

  test("docs.json is Margaya-branded and its assets exist", () => {
    const raw = readFileSync(path.join(DOCS_DIR, "docs.json"), "utf8");
    expect(findBrandLeaks(raw)).toEqual([]);
    expect(config.name).toBe("Margaya");
    expect(config.seo?.metatags?.["og:site_name"]).toBe("Margaya Docs");
    for (const asset of [
      config.favicon,
      config.logo?.light,
      config.logo?.dark,
      config.fonts?.source,
    ]) {
      expect(asset, "asset path").toBeTruthy();
      expect(
        existsSync(path.join(DOCS_DIR, asset ?? "")),
        `${asset} exists`,
      ).toBe(true);
    }
    const favicon = readFileSync(
      path.join(DOCS_DIR, config.favicon ?? ""),
      "utf8",
    );
    expect(favicon).toContain("<svg");
  });
});
