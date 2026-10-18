import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OutlineHeading } from "@/lib/pages/editor-document";
import PageOutlineMinimap from "./page-outline-minimap";

vi.mock("@/lib/i18n", () => ({
  i18n: { t: (key: string) => key, language: "en-US" },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const HEADINGS: OutlineHeading[] = [
  { level: 1, text: "Intro", pos: 0 },
  { level: 2, text: "Setup", pos: 10 },
  { level: 3, text: "Details", pos: 20 },
];

afterEach(cleanup);

function renderMinimap(
  headings: OutlineHeading[] = HEADINGS,
  activePos: number | null = 10,
) {
  const onOpenPanel = vi.fn();
  const onJump = vi.fn();
  const view = render(
    <PageOutlineMinimap
      headings={headings}
      activePos={activePos}
      onOpenPanel={onOpenPanel}
      onJump={onJump}
    />,
  );
  return { ...view, onOpenPanel, onJump };
}

describe("PageOutlineMinimap", () => {
  it("draws one hidden-from-readers bar per heading, sized by level", () => {
    const { container } = renderMinimap();
    const bars = [...container.querySelectorAll("[data-level]")];
    expect(bars.map((bar) => bar.getAttribute("data-level"))).toEqual([
      "1",
      "2",
      "3",
    ]);
    expect(bars.map((bar) => bar.className.match(/\bw-\d\b/)?.[0])).toEqual([
      "w-5",
      "w-4",
      "w-3",
    ]);
    for (const bar of bars) expect(bar).toHaveAttribute("aria-hidden", "true");
    expect(bars[1]).toHaveAttribute("data-active", "true");
  });

  it("stays hidden with fewer than two headings", () => {
    const { container } = renderMinimap(HEADINGS.slice(0, 1));
    expect(container).toBeEmptyDOMElement();
  });

  it("opens the outline pane from the bars", () => {
    const { onOpenPanel } = renderMinimap();
    fireEvent.click(
      screen.getByRole("button", { name: "pages:detail.openOutline" }),
    );
    expect(onOpenPanel).toHaveBeenCalledTimes(1);
  });

  it("jumps to a heading from the hover card and marks the current one", () => {
    const { onJump } = renderMinimap();
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    expect(onJump).toHaveBeenCalledWith(HEADINGS[2]);
    expect(screen.getByRole("button", { name: /Setup/ })).toHaveAttribute(
      "aria-current",
      "location",
    );
  });
});
