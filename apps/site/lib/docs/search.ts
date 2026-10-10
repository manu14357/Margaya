import { findOperation } from "./openapi";
import { getAllDocPages, getDocPageBody } from "./source";

export type DocsSearchEntry = {
  href: string;
  title: string;
  description: string;
  section: string;
  method: string | null;
  path: string | null;
  headings: string[];
};

function bodyHeadings(body: string): string[] {
  const headings: string[] = [];
  let inFence = false;
  for (const line of body.split("\n")) {
    if (/^\s*(`{3,}|~{3,})/.test(line)) inFence = !inFence;
    if (inFence) continue;
    const match = /^#{2,3}\s+(.+?)\s*#*\s*$/.exec(line);
    if (match?.[1]) headings.push(match[1].replace(/[`*_]/g, ""));
  }
  return headings;
}

/** One entry per published page, served as /docs/search-index.json. */
export function buildDocsSearchIndex(): DocsSearchEntry[] {
  return getAllDocPages().map((page) => {
    const operation = page.openapi
      ? findOperation(page.openapi.method, page.openapi.path)
      : null;
    return {
      href: page.href,
      title: operation?.summary || page.title,
      description: operation
        ? `${page.title} · ${page.description}`
        : page.description,
      section: [page.tab, page.group].filter(Boolean).join(" › "),
      method: operation?.method ?? null,
      path: operation?.path ?? null,
      headings: operation ? [] : bodyHeadings(getDocPageBody(page)),
    };
  });
}
