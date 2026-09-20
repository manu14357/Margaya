import { describe, expect, it } from "vitest";
import { COLUMN_GROUP_META } from "@/lib/column-groups";
import {
  assignSlots,
  buildSeriesColors,
  CHART_SLOT_COLORS,
  customChartColor,
  GROUP_CHART_COLORS,
  NONE_CHART_COLOR,
  OTHER_CHART_COLOR,
  PRIORITY_CHART_COLORS,
  preferredSlot,
} from "./series-colors";

/** Sample keys grouped by the slot they prefer. */
function keysBySlot() {
  const bySlot: string[][] = CHART_SLOT_COLORS.map(() => []);
  for (let index = 0; index < 200; index += 1) {
    const key = `key-${index}`;
    bySlot[preferredSlot(key)].push(key);
  }
  return bySlot;
}

describe("slot colors", () => {
  it("are the five chart tokens, in order", () => {
    expect(CHART_SLOT_COLORS.map((color) => color.fill)).toEqual([
      "fill-chart-1",
      "fill-chart-2",
      "fill-chart-3",
      "fill-chart-4",
      "fill-chart-5",
    ]);
    expect(CHART_SLOT_COLORS[2]).toEqual({
      fill: "fill-chart-3",
      stroke: "stroke-chart-3",
      swatch: "bg-chart-3",
    });
  });

  it("prefer a stable slot per key", () => {
    expect(preferredSlot("user-1")).toBe(preferredSlot("user-1"));
    for (const key of ["a", "b", "project-42", "name:Bug"]) {
      const slot = preferredSlot(key);
      expect(slot).toBeGreaterThanOrEqual(0);
      expect(slot).toBeLessThan(5);
    }
  });
});

describe("assignSlots", () => {
  const bySlot = keysBySlot();

  it("keeps a key's slot when another key is removed", () => {
    const [a, b, c] = [bySlot[0][0], bySlot[2][0], bySlot[4][0]];
    const all = assignSlots([a, b, c]);
    const withoutB = assignSlots([a, c]);
    expect(all.get(a)).toBe(0);
    expect(all.get(c)).toBe(4);
    expect(withoutB.get(a)).toBe(all.get(a));
    expect(withoutB.get(c)).toBe(all.get(c));
  });

  it("resolves collisions in natural order with the next free slot", () => {
    const [first, second] = bySlot[1];
    expect(assignSlots([first, second])).toEqual(
      new Map([
        [first, 1],
        [second, 2],
      ]),
    );
    expect(assignSlots([second, first])).toEqual(
      new Map([
        [second, 1],
        [first, 2],
      ]),
    );
    // Once the collision is gone, the displaced key returns to its own slot.
    expect(assignSlots([second]).get(second)).toBe(1);
  });

  it("wraps around past the last slot", () => {
    const [first, second] = bySlot[4];
    expect(assignSlots([first, second]).get(second)).toBe(0);
  });

  it("uses all five slots before repeating", () => {
    const keys = bySlot[3].slice(0, 6);
    const slots = assignSlots(keys);
    expect(new Set(keys.slice(0, 5).map((key) => slots.get(key))).size).toBe(5);
    expect(slots.get(keys[5])).toBe(3);
  });
});

describe("buildSeriesColors", () => {
  it("maps groups to their identity colors, mirroring column-groups", () => {
    const colors = buildSeriesColors(
      ["backlog", "unstarted", "started", "completed", "cancelled"],
      { scheme: "group" },
    );
    expect(colors.get("backlog")?.fill).toBe("fill-muted-foreground/40");
    expect(colors.get("unstarted")?.fill).toBe("fill-info");
    expect(colors.get("started")?.fill).toBe("fill-warning");
    expect(colors.get("completed")?.fill).toBe("fill-success");
    expect(colors.get("cancelled")?.fill).toBe("fill-destructive/60");
    for (const group of Object.keys(GROUP_CHART_COLORS) as Array<
      keyof typeof GROUP_CHART_COLORS
    >) {
      expect(GROUP_CHART_COLORS[group].swatch).toBe(
        COLUMN_GROUP_META[group].barClassName,
      );
    }
  });

  it("maps priorities to their identity colors", () => {
    const colors = buildSeriesColors(
      ["urgent", "high", "medium", "low", "no-priority"],
      { scheme: "priority" },
    );
    expect(colors.get("urgent")).toBe(PRIORITY_CHART_COLORS.urgent);
    expect(colors.get("urgent")?.fill).toBe("fill-destructive");
    expect(colors.get("high")?.fill).toBe("fill-warning");
    expect(colors.get("medium")?.fill).toBe("fill-warning/55");
    expect(colors.get("low")?.fill).toBe("fill-info");
    expect(colors.get("no-priority")?.fill).toBe("fill-muted-foreground/35");
  });

  it("gives other and none their muted classes in every scheme", () => {
    for (const scheme of ["group", "priority", "slots"] as const) {
      const colors = buildSeriesColors(["a", "other", "none"], { scheme });
      expect(colors.get("other")).toBe(OTHER_CHART_COLOR);
      expect(colors.get("none")).toBe(NONE_CHART_COLOR);
    }
    expect(OTHER_CHART_COLOR.fill).toBe("fill-muted-foreground/60");
    expect(NONE_CHART_COLOR.fill).toBe("fill-muted-foreground/30");
  });

  it("applies custom colors (labels) inline", () => {
    const colors = buildSeriesColors(["name:Bug", "name:Idea"], {
      custom: { "name:Bug": "#ef4444", "name:Idea": null },
    });
    expect(colors.get("name:Bug")).toEqual(customChartColor("#ef4444"));
    expect(colors.get("name:Bug")?.fill).toBe("");
    expect(colors.get("name:Idea")?.fill).toMatch(/^fill-chart-\d$/);
  });

  it("slots every other key stably, ignoring prototype names", () => {
    const colors = buildSeriesColors(["constructor", "user-1"], {
      scheme: "group",
    });
    expect(colors.get("constructor")?.fill).toMatch(/^fill-chart-\d$/);
    expect(colors.get("user-1")).toBe(
      CHART_SLOT_COLORS[
        assignSlots(["constructor", "user-1"]).get("user-1") ?? 0
      ],
    );
  });
});
