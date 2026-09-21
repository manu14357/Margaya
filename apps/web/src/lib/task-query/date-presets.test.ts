import { describe, expect, it } from "vitest";
import {
  fromDayString,
  isOverdueActive,
  OVERDUE_CONDITIONS,
  presetsForKey,
  toDayString,
  toggleOverdue,
} from "./date-presets";
import { rootConditions } from "./filter-tree";

describe("date presets", () => {
  it("offers forward-looking presets only for planned dates", () => {
    expect(presetsForKey("dueDate")).toContain("nextWeek");
    expect(presetsForKey("createdAt")).not.toContain("nextWeek");
    expect(presetsForKey("createdAt")).not.toContain("none");
    expect(presetsForKey("completedAt")).toContain("none");
  });

  it("toggles the overdue pair", () => {
    const on = toggleOverdue(null, []);
    const conditions = rootConditions(on);
    expect(conditions).toEqual(OVERDUE_CONDITIONS);
    expect(isOverdueActive(conditions)).toBe(true);
    expect(toggleOverdue(on, conditions)).toBe(null);
  });

  it("round-trips calendar days", () => {
    const day = fromDayString("2026-02-03");
    expect(day?.getFullYear()).toBe(2026);
    expect(day?.getMonth()).toBe(1);
    expect(day?.getDate()).toBe(3);
    expect(day && toDayString(day)).toBe("2026-02-03");
    expect(fromDayString("03/02/2026")).toBeUndefined();
    expect(fromDayString(undefined)).toBeUndefined();
  });
});
