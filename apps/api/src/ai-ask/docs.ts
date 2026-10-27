import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { AskItem } from "./retrieve";

// Margaya's own documentation (apps/docs/core) as Ask context, so "how do I
// turn on AI?" is answered from the guides and cited as [D:n]. The guides
// are read once into memory and searched by weighted term overlap; they are
// public, so nothing about the workspace is involved. Without the folder
// (an image built without it) Ask simply has no docs.

type DocSection = {
  /** Path under the docs site, e.g. "core/functional/ask-ai". */
  page: string;
  pageTitle: string;
  heading: string;
  text: string;
  terms: Map<string, number>;
  titleTerms: Set<string>;
};

const MAX_SECTION_CHARS = 1_500;
const MAX_DOC_ITEMS = 2;
const STOP_WORDS = new Set(
  "the and for are you your can how what with this that from does have has use using into when then than our out about there their them will just get set any all not but its was were who why which where while should could would may might also only more most some such each other been being a an to of in on or is it as at by be do if no so up we i my me".split(
    " ",
  ),
);

let cache: DocSection[] | null = null;

function docsDir(): string {
  if (process.env.MARGAYA_DOCS_DIR) return process.env.MARGAYA_DOCS_DIR;
  // The API runs from apps/api (dev, tests and the images); the guides sit
  // next to it in apps/docs/core.
  return path.resolve(process.cwd(), "../docs/core");
}

/** The public docs site the citations link to. */
function docsBaseUrl(): string {
  return (process.env.MARGAYA_DOCS_URL ?? "https://margaya.app/docs").replace(
    /\/+$/,
    "",
  );
}

// Words people use for what the guides call something else.
const SYNONYMS: Record<string, string> = {
  recurring: "repeat",
  recurrence: "repeat",
  recur: "repeat",
  wiki: "page",
  doc: "page",
  sprint: "cycle",
  iteration: "cycle",
  epic: "module",
  issue: "task",
  ticket: "task",
};

/** A crude English stem, so "repeating", "repeats" and "repeat" meet. */
function stem(word: string): string {
  let w = SYNONYMS[word] ?? word;
  if (w.length > 4 && w.endsWith("ies")) w = `${w.slice(0, -3)}y`;
  else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss"))
    w = w.slice(0, -1);
  if (w.length > 5 && w.endsWith("ing")) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith("ed")) w = w.slice(0, -2);
  if (w.length > 3 && w.endsWith("e")) w = w.slice(0, -1);
  if (w.length > 3 && /([b-df-hj-np-tv-z])\1$/.test(w)) w = w.slice(0, -1);
  return SYNONYMS[w] ?? w;
}

function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word))
    .map(stem);
}

// Words that say "the docs" rather than what the question is about.
const META = new Set(
  [
    "docs",
    "documentation",
    "margaya",
    "guide",
    "guides",
    "help",
    "access",
    "available",
    "know",
    "read",
  ].map(stem),
);

function countTerms(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const word of tokens(text))
    counts.set(word, (counts.get(word) ?? 0) + 1);
  return counts;
}

/** Markdown without MDX components, imports and frontmatter. */
function plainText(body: string): string {
  return body
    .replace(/^import .*$/gm, "")
    .replace(/<[A-Z][\w.]*\b[^>]*\/>/gs, "")
    .replace(/<\/?[A-Z][\w.]*\b[^>]*>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith(".mdx") || name.endsWith(".md")) out.push(full);
  }
  return out;
}

function load(): DocSection[] {
  if (cache) return cache;
  const root = docsDir();
  const sections: DocSection[] = [];
  let files: string[] = [];
  try {
    files = walk(root);
  } catch {
    cache = sections;
    return sections;
  }
  for (const file of files) {
    const raw = readFileSync(file, "utf8");
    const front = /^---\n([\s\S]*?)\n---\n?/.exec(raw);
    const title =
      /^title:\s*["']?(.+?)["']?\s*$/m.exec(front?.[1] ?? "")?.[1] ??
      path.basename(file, path.extname(file));
    const description =
      /^description:\s*["']?(.+?)["']?\s*$/m.exec(front?.[1] ?? "")?.[1] ?? "";
    const page = `core/${path
      .relative(root, file)
      .replace(/\\/g, "/")
      .replace(/\.mdx?$/, "")}`;
    const body = plainText(raw.slice(front?.[0].length ?? 0));
    // One section per "## " heading; the intro is its own section.
    const parts = body.split(/^## /m);
    parts.forEach((part, index) => {
      const lines = part.split("\n");
      const heading = index === 0 ? "" : (lines.shift() ?? "").trim();
      const text = (index === 0 ? [description, part] : lines)
        .join("\n")
        .trim();
      if (!text) return;
      sections.push({
        page,
        pageTitle: title,
        heading,
        text,
        terms: countTerms(`${heading}\n${text}`),
        titleTerms: new Set(tokens(`${title} ${heading}`)),
      });
    });
  }
  cache = sections;
  return sections;
}

/** Clears the in-memory index (tests). */
export function resetDocsIndex(): void {
  cache = null;
}

/**
 * The best-matching documentation sections for a question, at most two and
 * one per page. A section must share at least two informative words with
 * the question (or one in its title or heading) to count.
 */
export function searchDocs(question: string, limit = MAX_DOC_ITEMS) {
  const sections = load();
  const query = [...new Set(tokens(question))].filter(
    (term) => !META.has(term),
  );
  if (sections.length === 0 || query.length === 0) return [];
  const df = new Map<string, number>();
  for (const term of query) {
    df.set(term, sections.filter((section) => section.terms.has(term)).length);
  }
  const scored = sections
    .map((section) => {
      let score = 0;
      let matched = 0;
      let inTitle = false;
      for (const term of query) {
        const count = section.terms.get(term) ?? 0;
        const titled = section.titleTerms.has(term);
        if (count === 0 && !titled) continue;
        matched += 1;
        inTitle ||= titled;
        const idf = Math.log(1 + sections.length / (1 + (df.get(term) ?? 0)));
        score += idf * (Math.min(count, 3) + (titled ? 3 : 0));
      }
      return { section, score, matched, inTitle };
    })
    .filter((hit) => hit.matched >= 2 || hit.inTitle)
    .sort((a, b) => b.score - a.score);
  const pages = new Set<string>();
  const hits: DocSection[] = [];
  for (const { section } of scored) {
    if (pages.has(section.page)) continue;
    pages.add(section.page);
    hits.push(section);
    if (hits.length >= limit) break;
  }
  return hits;
}

// "How do I …", "where is …", "docs", "help": a question about using Margaya.
const HOW_TO =
  /\b(how (do|can|to|does)|where (is|are|do|can)|docs?|documentation|guide|help|set ?up|enable|turn on|configure|what is margaya)\b/i;

/**
 * For a question about using Margaya ("how do I…", "where is…", "help",
 * naming Margaya): the matching documentation sections and a list of the
 * guides, as citable [D:n] items. Questions about the team's work get none.
 */
export function docsItems(question: string): AskItem[] {
  if (!HOW_TO.test(question) && !/\bmargaya\b/i.test(question)) return [];
  const base = docsBaseUrl();
  const hits = searchDocs(question);
  const items: AskItem[] = hits.map((section, index) => {
    const ref = `D:${index + 1}`;
    const name = section.heading
      ? `${section.pageTitle}: ${section.heading}`
      : section.pageTitle;
    const url = `${base}/${section.page}`;
    return {
      kind: "web",
      id: `${url}#${index}`,
      projectId: null,
      title: `Margaya docs: ${name}`,
      url,
      source: ref,
      author: null,
      text: `Margaya documentation: ${name}\nURL: ${url}\n${section.text.slice(0, MAX_SECTION_CHARS)}`,
      // Published documentation: no workspace data.
      dataTier: "public",
      ref,
      updatedAt: null,
    };
  });
  {
    const guides = [
      ...new Set(
        load()
          .filter((section) => section.page.startsWith("core/functional/"))
          .map((section) => section.pageTitle),
      ),
    ];
    if (guides.length > 0) {
      items.push({
        kind: "web",
        id: `${base}#guides`,
        projectId: null,
        title: "Margaya docs",
        url: `${base}/core/functional`,
        source: `D:${items.length + 1}`,
        author: null,
        text: `Margaya documentation is available to you. Its guides: ${guides.join("; ")}.`,
        dataTier: "public",
        ref: `D:${items.length + 1}`,
        updatedAt: null,
      });
    }
  }
  return items;
}
