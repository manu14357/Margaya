import { describe, expect, it } from "vitest";
import { rankDocs } from "@/components/docs/docs-search";
import { renderDocMarkdown } from "./markdown";
import { buildDocsSearchIndex, type DocsSearchEntry } from "./search";
import { getAllDocPages, getDocPageBody } from "./source";

describe("buildDocsSearchIndex", () => {
  const index = buildDocsSearchIndex();

  it("has one entry per page and stays small enough to load lazily", () => {
    expect(index).toHaveLength(getAllDocPages().length);
    expect(JSON.stringify(index).length).toBeLessThan(400_000);
  });

  it("deep-links headings to ids the rendered page really has", () => {
    for (const page of getAllDocPages().filter((entry) => !entry.openapi)) {
      const entry = index.find((item) => item.href === page.href);
      const { html } = renderDocMarkdown(getDocPageBody(page), {
        highlight: false,
      });
      for (const section of entry?.sections ?? []) {
        expect(html, `${page.id}#${section.id}`).toContain(
          `id="${section.id}"`,
        );
      }
    }
  });

  it("titles operations by their summary and indexes parameter names", () => {
    const createTask = index.find((entry) =>
      entry.href.endsWith("/createTask"),
    );
    expect(createTask?.title).not.toBe("createTask");
    expect(createTask?.method).toBe("POST");
    expect(createTask?.keywords).toContain("createTask");
    expect(createTask?.keywords).toContain("projectId");
  });
});

describe("rankDocs", () => {
  const entry = (overrides: Partial<DocsSearchEntry>): DocsSearchEntry => ({
    href: "/docs/x",
    title: "Page",
    description: "",
    section: "Guides › Overview",
    method: null,
    path: null,
    sections: [],
    keywords: "",
    ...overrides,
  });

  it("puts title hits first and nests matching headings under their page", () => {
    const rows = rankDocs(
      [
        entry({
          href: "/docs/a",
          title: "Install",
          sections: [{ id: "docker-compose", text: "Docker Compose" }],
        }),
        entry({ href: "/docs/b", title: "Docker Compose" }),
      ],
      "docker",
    );
    expect(rows.map((row) => [row.kind, row.href])).toEqual([
      ["page", "/docs/b"],
      ["page", "/docs/a"],
      ["section", "/docs/a#docker-compose"],
    ]);
    expect(rows[2]?.context).toBe("Install");
  });

  it("requires every term to match somewhere on the page", () => {
    const rows = rankDocs(
      [entry({ title: "Cycles", description: "Time-boxed planning" })],
      "cycles kanban",
    );
    expect(rows).toEqual([]);
  });
});
