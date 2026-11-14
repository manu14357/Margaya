import { describe, expect, it } from "vitest";
import { escapeXml, renderToSvg, safeImageHref } from "../src/render/svg.js";
import type { TaskCardData } from "../src/render/types.js";
import { everyElement, makeElement } from "./render-fixtures.js";

const hostile = `</text><script>alert("x")</script>' onload="evil()"`;

/** Removes the one allowed URL: the SVG namespace identifier. */
function withoutNamespace(svg: string): string {
  return svg.replace('xmlns="http://www.w3.org/2000/svg"', "");
}

describe("renderToSvg", () => {
  it("renders every element type as one standalone document", () => {
    for (const theme of ["light", "dark"] as const) {
      const svg = renderToSvg(everyElement(), {
        theme,
        resolveTask: (id) =>
          id === "task-1"
            ? {
                key: "MAR-1",
                title: "Plan",
                statusName: "Todo",
                statusColor: "#868e96",
                assigneeName: "Sam",
                dueDate: "2026-12-01",
                priority: "urgent",
                done: true,
              }
            : null,
      });
      expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(
        true,
      );
      expect(svg.endsWith("</svg>")).toBe(true);
      expect(svg).not.toMatch(/NaN|Infinity|undefined/);
      expect(svg).toContain("<path");
      expect(svg).toContain("<text");
      expect(svg).toContain("clip-path=");
    }
  });

  it("escapes script tags and quotes in text, frame names and task data", () => {
    const task: TaskCardData = {
      key: hostile,
      title: hostile,
      statusName: hostile,
      statusColor: `red" onclick="x`,
      assigneeName: hostile,
      dueDate: hostile,
      priority: hostile,
      done: false,
    };
    const svg = renderToSvg(
      [
        makeElement("text", { text: hostile }),
        makeElement("sticky", { text: hostile }),
        makeElement("rectangle", {
          text: hostile,
          strokeColor: `#000" onload="x`,
        }),
        makeElement("arrow", { text: hostile }),
        makeElement("frame", { name: hostile }),
        makeElement("task", { taskId: "t" }),
      ],
      { resolveTask: () => task, background: `#fff"><script>` },
    );
    expect(svg).not.toMatch(/<script/i);
    // The words survive as escaped text, never as attributes.
    expect(svg).not.toMatch(/\son\w+\s*=\s*["']/i);
    expect(svg).toContain("onload=&quot;evil()&quot;");
    expect(svg).not.toContain('"x"');
    expect(svg).toContain("&lt;script&gt;");
    expect(svg).toContain("&quot;");
    expect(svg).toContain("&#39;");
    expect(svg).not.toMatch(/foreignObject/i);
  });

  it("contains no external URLs or links", () => {
    const svg = renderToSvg([
      ...everyElement(),
      makeElement("rectangle", { link: "https://example.com/" }),
      makeElement("image", { assetId: "asset" }),
    ]);
    const body = withoutNamespace(svg);
    expect(body).not.toMatch(/https?:/i);
    expect(body).not.toMatch(/href/i);
    expect(body).not.toMatch(/<a[\s>]/i);
  });

  it("uses only image hrefs the caller provides, and only safe ones", () => {
    const data = "data:image/png;base64,iVBORw0KGgo=";
    const svg = renderToSvg(
      [
        makeElement("image", { assetId: "good" }),
        makeElement("image", { assetId: "bad", x: 200 }),
        makeElement("image", { assetId: "svg", x: 400 }),
        makeElement("image", {
          assetId: "cropped",
          x: 600,
          crop: { x: 1, y: 2, width: 30, height: 40 },
        }),
      ],
      {
        imageHref: (id) =>
          id === "good"
            ? data
            : id === "bad"
              ? "javascript:alert(1)"
              : id === "svg"
                ? "data:image/svg+xml;base64,PHN2Zz4="
                : "/api/whiteboard/b/assets/cropped",
      },
    );
    expect(svg).toContain(`href="${data}"`);
    expect(svg).toContain('href="/api/whiteboard/b/assets/cropped"');
    expect(svg).toContain('viewBox="1 2 30 40"');
    expect(svg).not.toContain("javascript");
    expect(svg).not.toContain("svg+xml");
    expect(svg.match(/<image /g)).toHaveLength(2);
  });

  it("skips deleted elements and sizes the document to the drawing", () => {
    const svg = renderToSvg(
      [
        makeElement("rectangle", { x: 0, y: 0, width: 100, height: 50 }),
        makeElement("rectangle", { x: 10_000, y: 10_000, deleted: true }),
      ],
      { padding: 10 },
    );
    const width = Number(/ width="(\d+)"/.exec(svg)?.[1]);
    expect(width).toBeGreaterThanOrEqual(120);
    expect(width).toBeLessThan(160);
  });

  it("renders an empty board", () => {
    const svg = renderToSvg([], { background: "transparent" });
    expect(svg).toMatch(/^<svg [^>]*><\/svg>$/);
  });

  it("is deterministic", () => {
    const elements = everyElement();
    expect(renderToSvg(elements)).toBe(renderToSvg(elements));
  });
});

describe("helpers", () => {
  it("escapeXml strips characters XML forbids", () => {
    expect(escapeXml("a\u0000b\u0007c<&>\"'")).toBe(
      "abc&lt;&amp;&gt;&quot;&#39;",
    );
  });

  it("safeImageHref", () => {
    expect(safeImageHref("https://cdn.example/x.png")).toBe(
      "https://cdn.example/x.png",
    );
    expect(safeImageHref("//evil.example/x.png")).toBeNull();
    expect(safeImageHref("javascript:alert(1)")).toBeNull();
    expect(safeImageHref('/a" onload="x')).toBeNull();
    expect(safeImageHref(null)).toBeNull();
  });
});
