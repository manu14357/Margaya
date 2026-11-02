import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderDocMarkdown } from "./markdown";
import {
  type DocsShotManifest,
  docsShotUrl,
  readDocsShotManifest,
  screenshotHtml,
} from "./screenshots";
import { DOCS_DIR, getAllDocPages, getDocPageBody } from "./source";

const MANIFEST: DocsShotManifest = {
  "board/view": { width: 800, height: 500 },
  "admin/one": { width: 400, height: 300, format: "png" },
};

describe("<Screenshot>", () => {
  it("renders the light capture, sized from the manifest", () => {
    const html = screenshotHtml(
      { src: "board/view", alt: "The board", caption: "Columns & tasks" },
      "test",
      MANIFEST,
    );
    expect(html).toContain('class="docs-shot"');
    expect(html).toContain("--shot-w:800px");
    expect(html).toContain(
      'class="docs-shot-img" src="/images/docs/board/view-light.webp" alt="The board" width="800" height="500" loading="lazy"',
    );
    expect(html).not.toContain("-dark.");
    expect(html).toContain('aria-label="Enlarge image: The board"');
    expect(html).toContain("<figcaption>Columns &amp; tasks</figcaption>");
  });

  it("keeps the recorded format and leaves the caption out when unset", () => {
    const html = screenshotHtml(
      { src: "admin/one", alt: "" },
      "test",
      MANIFEST,
    );
    expect(html).toContain('src="/images/docs/admin/one-light.png"');
    expect(html).not.toContain("<figcaption>");
  });

  it("fails loudly on an unknown name", () => {
    expect(() =>
      screenshotHtml({ src: "board/veiw" }, "core/tasks", MANIFEST),
    ).toThrow(/core\/tasks: <Screenshot src="board\/veiw">/);
  });

  it("renders inside MDX as one block", () => {
    const shots = readDocsShotManifest();
    const name = Object.keys(shots)[0];
    if (!name) return;
    const html = renderDocMarkdown(
      `Before.\n\n<Screenshot src="${name}" alt="A view" />\n\nAfter.`,
      { source: "test" },
    ).html;
    expect(html).toContain("<p>Before.</p>");
    expect(html).toMatch(/<figure class="docs-shot"[\s\S]*<\/figure>/);
    expect(html).toContain("<p>After.</p>");
  });
});

// The quick check for docs authors: every page renders, and every screenshot
// it names exists on disk. Rendering all ~600 pages takes about a second on an
// idle machine but is CPU-bound, so a busy one can pass the default 5 s.
const ALL_PAGES_TIMEOUT_MS = 30_000;

describe("docs pages", { timeout: ALL_PAGES_TIMEOUT_MS }, () => {
  it("render, with every screenshot present", () => {
    const shots = readDocsShotManifest();
    for (const page of getAllDocPages()) {
      expect(() =>
        renderDocMarkdown(getDocPageBody(page), {
          source: page.id,
          highlight: false,
        }),
      ).not.toThrow();
    }
    const missing: string[] = [];
    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return walk(full);
        return entry.name.endsWith(".mdx") ? [full] : [];
      });
    for (const file of walk(DOCS_DIR)) {
      const text = fs.readFileSync(file, "utf8");
      for (const match of text.matchAll(/<Screenshot\b[^>]*\bsrc="([^"]+)"/g)) {
        const name = match[1] as string;
        const shot = shots[name];
        if (!shot) {
          missing.push(
            `${path.relative(DOCS_DIR, file)}: ${name} (not in manifest)`,
          );
          continue;
        }
        const url = docsShotUrl(name, shot);
        if (!fs.existsSync(path.join(process.cwd(), "public", url))) {
          missing.push(`${path.relative(DOCS_DIR, file)}: ${url}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
