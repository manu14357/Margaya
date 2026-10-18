import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Page } from "@/types/page";
import PageSidePanel from "./page-side-panel";

vi.mock("@/lib/i18n", () => ({
  i18n: { t: (key: string) => key, language: "en-US" },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("./page-outline", () => ({ default: () => <p>outline body</p> }));
vi.mock("./page-info", () => ({ default: () => <p>info body</p> }));
vi.mock("./page-version-list", () => ({ default: () => <p>history body</p> }));

let wide = true;

function stubMatchMedia() {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: query.includes("min-width: 1024px") ? wide : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  });
}

beforeEach(() => {
  wide = true;
  stubMatchMedia();
});

afterEach(() => {
  cleanup();
});

const PAGE = { id: "page_1", projectId: "p1" } as unknown as Page;

function renderPanel(panel: "outline" | "info" | "history" | undefined) {
  const onPanelChange = vi.fn();
  const onClose = vi.fn();
  const view = render(
    <PageSidePanel
      page={PAGE}
      workspaceId="w1"
      editor={null}
      panel={panel}
      onPanelChange={onPanelChange}
      onClose={onClose}
      onVersionSelect={vi.fn()}
      getMember={() => null}
    />,
  );
  return { ...view, onPanelChange, onClose };
}

describe("PageSidePanel", () => {
  it("docks beside the page from 1024px and slides open", async () => {
    renderPanel("outline");
    const aside = screen.getByRole("complementary", {
      name: "pages:panel.outline",
    });
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    expect(aside).toHaveAttribute("data-open", "true");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens as a sheet below 1024px", async () => {
    wide = false;
    stubMatchMedia();
    renderPanel("info");
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("lists Outline, Info and History in that order", () => {
    renderPanel("outline");
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "pages:panel.outline",
      "pages:panel.info",
      "pages:panel.history",
    ]);
  });

  it("closes from the button at the top and hands focus back", () => {
    const { onPanelChange, onClose } = renderPanel("history");
    fireEvent.click(screen.getByRole("button", { name: "pages:panel.close" }));
    expect(onPanelChange).toHaveBeenCalledWith(undefined);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps the docked pane mounted while it closes", () => {
    vi.useFakeTimers();
    try {
      const { rerender } = renderPanel("outline");
      rerender(
        <PageSidePanel
          page={PAGE}
          workspaceId="w1"
          editor={null}
          panel={undefined}
          onPanelChange={vi.fn()}
          onVersionSelect={vi.fn()}
          getMember={() => null}
        />,
      );
      const aside = screen.getByRole("complementary");
      expect(aside).toHaveAttribute("data-open", "false");
      act(() => {
        vi.advanceTimersByTime(300);
      });
      expect(screen.queryByRole("complementary")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
