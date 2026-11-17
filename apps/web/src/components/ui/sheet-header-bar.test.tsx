import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Sheet, SheetContent } from "./sheet";
import {
  planSheetHeader,
  type SheetHeaderAction,
  SheetHeaderBar,
  type SheetHeaderPlanInput,
} from "./sheet-header-bar";

const desktop = vi.hoisted(() => ({ fullHeight: false }));

vi.mock("@/components/desktop/desktop-title-bar", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/components/desktop/desktop-title-bar")
  >()),
  useDesktopFullHeightPanels: () => desktop.fullHeight,
}));

vi.mock("@/lib/i18n", () => ({
  i18n: { t: (key: string) => key, language: "en-US" },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

beforeEach(() => {
  desktop.fullHeight = false;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const item = (
  id: string,
  priority: number,
  extra: Partial<SheetHeaderPlanInput["items"][number]> = {},
) => ({ id, width: 28, group: "actions", priority, menu: false, ...extra });

const base: SheetHeaderPlanInput = {
  width: 520,
  gap: 8,
  identity: 176,
  navigation: 120,
  actionGap: 2,
  close: 28,
  menu: 28,
  separator: 9,
  items: [
    item("watch", 3),
    item("more", 0, { menu: true }),
    item("delete", 1, { group: "danger" }),
    item("full-page", 2, { group: "panel" }),
  ],
  singleRow: true,
};

describe("planSheetHeader", () => {
  it("keeps one row while the identity, navigation and actions fit", () => {
    expect(planSheetHeader(base)).toEqual({ rows: 1, collapsed: [] });
  });

  it("takes two rows before it collapses anything", () => {
    expect(planSheetHeader({ ...base, width: 400 })).toEqual({
      rows: 2,
      collapsed: [],
    });
  });

  it("always takes two rows in the desktop shell's full-height panels", () => {
    expect(planSheetHeader({ ...base, width: 1920, singleRow: false })).toEqual(
      { rows: 2, collapsed: [] },
    );
  });

  it("moves the lowest priority into the menu first", () => {
    // Two rows: navigation 120 + gap 8 + actions (4 x 28, close 28, two
    // separators of 9 and six gaps of 2: 170) = 298.
    expect(planSheetHeader({ ...base, width: 298 }).collapsed).toEqual([]);
    expect(planSheetHeader({ ...base, width: 290 }).collapsed).toEqual([
      "delete",
    ]);
    expect(planSheetHeader({ ...base, width: 220 }).collapsed).toEqual([
      "delete",
      "full-page",
      "watch",
    ]);
  });

  it("never collapses the menu, pinned actions or close panel", () => {
    const plan = planSheetHeader({
      ...base,
      width: 10,
      items: [...base.items, item("accept", 9, { pinned: true })],
    });
    expect(plan.collapsed).toEqual(["delete", "full-page", "watch"]);
  });

  it("counts a default menu when the panel has none of its own", () => {
    const items = [item("a", 2), item("b", 1)];
    // a, b, a separator and close, with three gaps: 99.
    const input = { ...base, navigation: null, items, singleRow: false };
    expect(planSheetHeader({ ...input, width: 99 }).collapsed).toEqual([]);
    // Moving b alone brings in a "…" just as wide, so a moves too.
    expect(planSheetHeader({ ...input, width: 98 }).collapsed).toEqual([
      "b",
      "a",
    ]);
  });
});

function renderInSheet(
  props: Parameters<typeof SheetHeaderBar>[0],
  side: "left" | "right" = "right",
) {
  const onOpenChange = vi.fn();
  render(
    <Sheet open onOpenChange={onOpenChange}>
      <SheetContent side={side}>
        <SheetHeaderBar {...props} />
        <p>body</p>
      </SheetContent>
    </Sheet>,
  );
  return { onOpenChange };
}

const taskActions = (onSelect = vi.fn()): SheetHeaderAction[] => [
  { id: "watch", label: "Watch", icon: <svg />, onSelect, priority: 3 },
  {
    id: "delete",
    label: "Delete task",
    icon: <svg />,
    onSelect,
    group: "danger",
    destructive: true,
    priority: 1,
  },
  {
    id: "full-page",
    label: "Open in full page",
    icon: <svg />,
    onSelect,
    group: "panel",
    priority: 2,
  },
];

describe("SheetHeaderBar", () => {
  it("is one row in a browser, closing the panel with a panel glyph", async () => {
    const { onOpenChange } = renderInSheet({
      title: "Deliveries",
      actions: taskActions(),
    });
    const bar = document.querySelector("[data-slot=sheet-header-bar]");
    expect(bar).toHaveAttribute("data-layout", "one-row");
    expect(bar).not.toHaveAttribute("data-title-row");
    expect(screen.getByRole("dialog")).toHaveAccessibleName("Deliveries");

    const close = screen.getByRole("button", {
      name: "common:actions.closePanel",
    });
    expect(close.querySelector("svg")).toHaveClass("lucide-panel-right-close");
    expect(document.querySelector(".lucide-x")).toBeNull();
    // The sheet's own fallback close steps aside for the header's.
    expect(
      screen.getAllByRole("button", { name: "common:actions.closePanel" }),
    ).toHaveLength(1);

    fireEvent.click(close);
    expect(onOpenChange).toHaveBeenCalledWith(false, expect.anything());
  });

  it("mirrors the glyph for a left panel", () => {
    renderInSheet({ title: "Panel" }, "left");
    const close = screen.getByRole("button", {
      name: "common:actions.closePanel",
    });
    expect(close.querySelector("svg")).toHaveClass(
      "lucide-panel-left-close",
      "rtl:-scale-x-100",
    );
  });

  it("splits into a title row and a toolbar in the desktop shell", () => {
    desktop.fullHeight = true;
    renderInSheet({
      identity: <span>WEB-2</span>,
      navigation: <span>16 of 19</span>,
      actions: taskActions(),
    });
    const bar = document.querySelector("[data-slot=sheet-header-bar]");
    expect(bar).toHaveAttribute("data-layout", "two-rows");
    expect(bar).toHaveAttribute("data-title-row", "");
    const [titleRow, toolbar] = Array.from(bar?.children ?? []);
    // Row 1: only the identity, clear of the window buttons.
    expect(titleRow).toHaveAttribute("data-slot", "sheet-header-identity");
    expect(titleRow).toHaveClass("h-12", "pe-(--sheet-controls-inset)");
    expect(within(titleRow as HTMLElement).queryAllByRole("button")).toEqual(
      [],
    );
    // Row 2: navigation, actions and close panel.
    expect(toolbar).toHaveAttribute("data-slot", "sheet-header-toolbar");
    const row = within(toolbar as HTMLElement);
    expect(row.getByText("16 of 19")).toBeInTheDocument();
    expect(
      row
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label")),
    ).toEqual([
      "Watch",
      "Delete task",
      "Open in full page",
      "common:actions.closePanel",
    ]);
  });

  it("stays one row outside the desktop shell's full-height panels", () => {
    desktop.fullHeight = true;
    render(<SheetHeaderBar title="Outline" onClose={vi.fn()} />);
    expect(
      document.querySelector("[data-slot=sheet-header-bar]"),
    ).toHaveAttribute("data-layout", "one-row");
  });

  it("moves what does not fit into the menu, lowest priority first", async () => {
    // A 300px wide panel: room for the navigation, watch and close only.
    const widths: Record<string, number> = {
      "sheet-header-navigation": 120,
      "sheet-header-close": 28,
      "sheet-header-separator": 1,
    };
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(
      function (this: HTMLElement) {
        return this.dataset.slot === "sheet-header-bar" ? 224 : 0;
      },
    );
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        const width =
          widths[this.dataset.slot ?? ""] ?? (this.dataset.actionId ? 28 : 0);
        return { width, height: 28 } as DOMRect;
      },
    );
    const onSelect = vi.fn();
    renderInSheet({
      identity: <span>WEB-2</span>,
      navigation: <span>16 of 19</span>,
      actions: taskActions(onSelect),
    });
    const bar = document.querySelector("[data-slot=sheet-header-bar]");
    expect(bar).toHaveAttribute("data-layout", "two-rows");
    expect(screen.queryByRole("button", { name: "Delete task" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Open in full page" }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Watch" })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "common:actions.moreActions" }),
      );
    });
    const items = await screen.findAllByRole("menuitem");
    expect(items.map((menuItem) => menuItem.textContent)).toEqual([
      "Delete task",
      "Open in full page",
    ]);
    fireEvent.click(items[0] as HTMLElement);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});
