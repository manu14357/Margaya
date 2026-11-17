import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { loadTemplateArt, templateArtIds } from "./art/registry";
import { TemplateArt } from "./template-art";

const sources = import.meta.glob<string>(
  ["./art/*.tsx", "!./art/primitives.tsx", "!./art/*.test.tsx"],
  { query: "?raw", import: "default", eager: true },
);

const THEMES = ["", "dark", "contrast", "dark contrast"];

afterEach(cleanup);

describe("template art registry", () => {
  it("finds every art file without a registry edit", () => {
    expect(templateArtIds).toEqual(
      expect.arrayContaining([
        "blank",
        "bug-tracking",
        "it-service-desk",
        "kanban",
        "product-roadmap",
      ]),
    );
    expect(templateArtIds).not.toContain("primitives");
    for (const id of templateArtIds)
      expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it.each(templateArtIds)(
    "%s renders a decorative 320x200 svg in every theme",
    async (id) => {
      const art = await loadTemplateArt(id);
      expect(art?.default).toBeTypeOf("function");
      const Art = art?.default ?? (() => null);
      for (const theme of THEMES) {
        const { container, unmount } = render(
          <div className={theme}>
            <Art className="w-40" />
          </div>,
        );
        const svg = container.querySelector("svg[data-template-art]");
        expect(svg, `${id} (${theme || "light"})`).not.toBeNull();
        expect(svg?.getAttribute("viewBox")).toBe("0 0 320 200");
        expect(svg?.getAttribute("aria-hidden")).toBe("true");
        expect(svg?.getAttribute("class")).toContain("w-40");
        unmount();
      }
    },
  );
});

describe("template art sources", () => {
  it.each(Object.entries(sources))(
    "%s follows the art rules",
    (_file, source) => {
      // Colours come from styles/template-art.css through the primitives.
      expect(source).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(/i);
      // No words in the art: the card has the text, and text needs translating.
      expect(source).not.toMatch(/<text\b|<tspan\b/);
      expect(source).toMatch(/export default function \w+Art\(/);
      expect(source).toContain("<ArtFrame");
    },
  );
});

describe("TemplateArt", () => {
  it("shows the fallback art for an id without its own", () => {
    const { container } = render(<TemplateArt id="no-such-template" />);
    expect(container.querySelector("svg[data-template-art]")).not.toBeNull();
  });

  it("shows the fallback without an id", () => {
    const { container } = render(<TemplateArt id={null} />);
    expect(container.querySelector("svg[data-template-art]")).not.toBeNull();
  });

  it("lazily loads a registered art", async () => {
    render(
      <div data-testid="card">
        <TemplateArt className="art" id="kanban" />
      </div>,
    );
    const card = await screen.findByTestId("card");
    // The fallback has no badge; the kanban art's badge is a lucide icon.
    await expect
      .poll(() => card.querySelector("svg[data-template-art] svg.lucide"))
      .not.toBeNull();
    expect(card.querySelectorAll("svg[data-template-art]")).toHaveLength(1);
  });
});
