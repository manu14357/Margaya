import { describe, expect, it } from "vitest";
import {
  densityForWidth,
  nextTopBarDensity,
  TOP_BAR_COMPACT_WIDTH,
  TOP_BAR_TIGHT_WIDTH,
} from "./top-bar-density";

describe("densityForWidth", () => {
  it("starts full, compact, then tight as the bar narrows", () => {
    expect(densityForWidth(1200)).toBe("full");
    expect(densityForWidth(TOP_BAR_COMPACT_WIDTH)).toBe("full");
    expect(densityForWidth(TOP_BAR_COMPACT_WIDTH - 1)).toBe("compact");
    expect(densityForWidth(TOP_BAR_TIGHT_WIDTH)).toBe("compact");
    expect(densityForWidth(TOP_BAR_TIGHT_WIDTH - 1)).toBe("tight");
  });
});

describe("nextTopBarDensity", () => {
  it("follows the width while nothing overflows", () => {
    expect(
      nextTopBarDensity({ current: "full", width: 900, overflow: 0, needs: {} })
        .density,
    ).toBe("full");
    expect(
      nextTopBarDensity({ current: "full", width: 400, overflow: 0, needs: {} })
        .density,
    ).toBe("compact");
    expect(
      nextTopBarDensity({
        current: "tight",
        width: 900,
        overflow: 0,
        needs: {},
      }).density,
    ).toBe("full");
  });

  it("steps denser on overflow and remembers what the roomier one needs", () => {
    const first = nextTopBarDensity({
      current: "full",
      width: 700,
      overflow: 120.4,
      needs: {},
    });
    expect(first.density).toBe("compact");
    expect(first.needs.full).toBe(821);

    // Still narrower than full needs: stays compact without flickering.
    expect(
      nextTopBarDensity({
        current: "compact",
        width: 800,
        overflow: 0,
        needs: first.needs,
      }).density,
    ).toBe("compact");

    // Wide enough again: back to full.
    expect(
      nextTopBarDensity({
        current: "compact",
        width: 821,
        overflow: 0,
        needs: first.needs,
      }).density,
    ).toBe("full");
  });

  it("goes tight when even the compact bar overflows", () => {
    const result = nextTopBarDensity({
      current: "compact",
      width: 420,
      overflow: 30,
      needs: { full: 900 },
    });
    expect(result.density).toBe("tight");
    expect(result.needs).toEqual({ full: 900, compact: 450 });
  });

  it("ignores sub-pixel overflow and never goes past tight", () => {
    expect(
      nextTopBarDensity({ current: "full", width: 700, overflow: 1, needs: {} })
        .density,
    ).toBe("full");
    const tight = nextTopBarDensity({
      current: "tight",
      width: 200,
      overflow: 80,
      needs: {},
    });
    expect(tight.density).toBe("tight");
    expect(tight.needs).toEqual({});
  });
});
