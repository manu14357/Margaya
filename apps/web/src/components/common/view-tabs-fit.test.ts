import { describe, expect, it } from "vitest";
import { overflowingTabs } from "./view-tabs-fit";

const widths = [80, 70, 60, 100, 90, 80];

describe("overflowingTabs", () => {
  it("keeps every tab when they all fit", () => {
    expect(
      overflowingTabs({
        widths,
        available: 480,
        moreWidth: 80,
        activeIndex: 0,
      }),
    ).toEqual([]);
  });

  it("moves the last tabs into More, leaving room for its button", () => {
    // 400 - 80 = 320 for tabs: 80 + 70 + 60 + 100 fit, 90 does not.
    expect(
      overflowingTabs({
        widths,
        available: 400,
        moreWidth: 80,
        activeIndex: 0,
      }),
    ).toEqual([4, 5]);
  });

  it("always keeps the selected tab in the row", () => {
    // The last tab is selected: it takes its room first, the rest fill in.
    expect(
      overflowingTabs({
        widths,
        available: 400,
        moreWidth: 80,
        activeIndex: 5,
      }),
    ).toEqual([3, 4]);
  });

  it("keeps the order of what stays (no tab jumps ahead)", () => {
    const hidden = overflowingTabs({
      widths,
      available: 300,
      moreWidth: 80,
      activeIndex: 4,
    });
    const kept = widths
      .map((_, index) => index)
      .filter((index) => !hidden.includes(index));
    expect(kept).toEqual([0, 4]);
  });

  it("does nothing before the row is measured", () => {
    expect(
      overflowingTabs({ widths, available: 0, moreWidth: 80, activeIndex: 0 }),
    ).toEqual([]);
    expect(
      overflowingTabs({
        widths: [],
        available: 300,
        moreWidth: 80,
        activeIndex: -1,
      }),
    ).toEqual([]);
  });

  it("with nothing selected, fills from the start", () => {
    expect(
      overflowingTabs({
        widths,
        available: 300,
        moreWidth: 80,
        activeIndex: -1,
      }),
    ).toEqual([3, 4, 5]);
  });
});
