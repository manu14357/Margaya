import { describe, expect, it } from "vitest";
import {
  imageWidth,
  jsonToMarkdown,
  jsonToYDoc,
  markdownToJson,
  normalizeDocument,
  pageSchema,
  yDocToJson,
} from "../src/index";

function image(attrs: Record<string, unknown>) {
  return normalizeDocument({
    type: "doc",
    content: [{ type: "image", attrs }],
  });
}

describe("image markdown", () => {
  it("writes plain markdown while no width or alignment is set", () => {
    const json = image({ src: "https://x.test/a.png", alt: "A" });
    expect(jsonToMarkdown(json)).toBe("![A](https://x.test/a.png)");
    expect(markdownToJson("![A](https://x.test/a.png)")).toEqual(json);
  });

  it("writes an <img> tag with a width and alignment, and reads it back", () => {
    const json = image({
      src: "https://x.test/a.png",
      alt: 'Say "hi" & <wave>',
      title: "T",
      width: 50,
      align: "center",
    });
    const markdown = jsonToMarkdown(json);
    expect(markdown).toBe(
      '<img src="https://x.test/a.png" alt="Say &quot;hi&quot; &amp; &lt;wave&gt;" title="T" width="50%" data-align="center" />',
    );
    expect(markdownToJson(markdown)).toEqual(json);
  });

  it("writes only the attribute that is set", () => {
    expect(
      jsonToMarkdown(image({ src: "https://x.test/a.png", align: "right" })),
    ).toBe('<img src="https://x.test/a.png" alt="" data-align="right" />');
    const widthOnly = image({
      src: "https://x.test/a.png",
      alt: "",
      width: 30,
    });
    expect(jsonToMarkdown(widthOnly)).toBe(
      '<img src="https://x.test/a.png" alt="" width="30%" />',
    );
    expect(markdownToJson(jsonToMarkdown(widthOnly))).toEqual(widthOnly);
  });

  it("keeps the blocks around an image tag", () => {
    const markdown =
      'Before\n\n<img src="https://x.test/a.png" alt="" width="40%" />\n\nAfter';
    const json = markdownToJson(markdown);
    expect(json.content?.map((node) => node.type)).toEqual([
      "paragraph",
      "image",
      "paragraph",
    ]);
    expect(jsonToMarkdown(json)).toBe(markdown);
  });

  it("reads a sized image inside a callout", () => {
    const markdown =
      '> [!TIP]\n> <img src="https://x.test/a.png" alt="" width="40%" data-align="left" />';
    const json = markdownToJson(markdown);
    expect(json.content?.[0]?.content?.[0]?.attrs).toMatchObject({
      width: 40,
      align: "left",
    });
    expect(jsonToMarkdown(json)).toBe(markdown);
  });

  it("drops attributes outside the allowlist from an <img> tag", () => {
    const json = markdownToJson(
      '<img src="https://x.test/a.png" alt="a" onerror="alert(1)" style="x" width="300" data-align="middle" />',
    );
    expect(json.content?.[0]).toEqual({
      type: "image",
      attrs: {
        src: "https://x.test/a.png",
        alt: "a",
        title: null,
        width: null,
        height: null,
        align: null,
      },
    });
    expect(JSON.stringify(json)).not.toContain("onerror");
  });

  it("does not read a data: URL tag as an image", () => {
    const json = markdownToJson('<img src="data:image/png;base64,AAAA" />');
    expect(JSON.stringify(json)).not.toContain('"type":"image"');
  });
});

describe("image attributes", () => {
  it("declares width and align, both empty by default", () => {
    const attrs = pageSchema().nodes.image?.spec.attrs ?? {};
    expect(attrs.width?.default).toBeNull();
    expect(attrs.align?.default).toBeNull();
  });

  it("normalize values outside the allowlist to null", () => {
    expect(
      image({ src: "s", width: 400, align: "justify" }).content?.[0]?.attrs,
    ).toMatchObject({ width: null, align: null });
    expect(
      image({ src: "s", width: "300", align: 1 }).content?.[0]?.attrs,
    ).toMatchObject({ width: null, align: null });
    expect(
      image({ src: "s", width: 33.4, align: "left" }).content?.[0]?.attrs,
    ).toMatchObject({ width: 33, align: "left" });
  });

  it("reads widths as whole percentages from 10 to 100", () => {
    expect(imageWidth(5)).toBeNull();
    expect(imageWidth(10)).toBe(10);
    expect(imageWidth("75%")).toBe(75);
    expect(imageWidth("100")).toBe(100);
    expect(imageWidth("101")).toBeNull();
    expect(imageWidth("calc(1px)")).toBeNull();
    expect(imageWidth(null)).toBeNull();
  });

  it("survive a Yjs round trip", () => {
    const json = image({
      src: "https://x.test/a.png",
      width: 60,
      align: "right",
    });
    expect(yDocToJson(jsonToYDoc(json))).toEqual(json);
  });
});
