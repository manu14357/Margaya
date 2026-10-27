import { describe, expect, it } from "vitest";
import {
  completeOrder,
  DEFAULT_SIDEBAR_LAYOUT,
  isDefaultSidebarLayout,
  moveItem,
  resolveSidebarLayout,
  visiblePanelSections,
  visibleRailItems,
} from "./sidebar-layout";

describe("sidebar layout", () => {
  it("shows the default layout when nothing is saved", () => {
    expect(resolveSidebarLayout(null)).toEqual(DEFAULT_SIDEBAR_LAYOUT);
    expect(visibleRailItems(null)).toEqual([
      "home",
      "inbox",
      "my-work",
      "projects",
      "pages",
      "analytics",
    ]);
    expect(visiblePanelSections(undefined)).toEqual([
      "views",
      "favorites",
      "projects",
    ]);
  });

  it("completes a partial order and drops unknown items", () => {
    expect(
      completeOrder(
        ["pages", "nope", "home", "pages"],
        ["home", "inbox", "pages"],
      ),
    ).toEqual(["pages", "home", "inbox"]);
  });

  it("applies the user's order and hidden items", () => {
    const layout = {
      railOrder: ["projects" as const, "home" as const],
      railHidden: ["inbox" as const, "analytics" as const],
      panelOrder: ["projects" as const],
      panelHidden: ["views" as const],
    };
    expect(visibleRailItems(layout)).toEqual([
      "projects",
      "home",
      "my-work",
      "pages",
    ]);
    expect(visiblePanelSections(layout)).toEqual(["projects", "favorites"]);
  });

  it("never hides Home", () => {
    expect(
      visibleRailItems({
        ...DEFAULT_SIDEBAR_LAYOUT,
        railHidden: ["home"],
      }),
    ).toContain("home");
  });

  it("moves items within bounds", () => {
    expect(moveItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveItem(["a", "b", "c"], 2, -5)).toEqual(["c", "a", "b"]);
    expect(moveItem(["a", "b"], 5, 0)).toEqual(["a", "b"]);
  });

  it("recognises a layout that matches the default", () => {
    expect(isDefaultSidebarLayout(DEFAULT_SIDEBAR_LAYOUT)).toBe(true);
    expect(
      isDefaultSidebarLayout({
        ...DEFAULT_SIDEBAR_LAYOUT,
        panelHidden: ["views"],
      }),
    ).toBe(false);
  });
});
