import { HTTPException } from "hono/http-exception";
import { describe, expect, it } from "vitest";
import {
  DATE_DIMENSIONS,
  DIMENSIONS,
  isDateDimension,
} from "../../../apps/api/src/analytics/dimensions";
import {
  analyticsChartRequestSchema,
  analyticsIntakeQuerySchema,
  analyticsTrendRequestSchema,
  PROJECT_IDS_MESSAGE,
  parseProjectIdsParam,
} from "../../../apps/api/src/analytics/schema";

function refusal(raw: string): string | null {
  try {
    parseProjectIdsParam(raw);
    return null;
  } catch (error) {
    expect(error).toBeInstanceOf(HTTPException);
    return (error as HTTPException).message;
  }
}

describe("parseProjectIdsParam", () => {
  it("trims and de-duplicates", () => {
    expect(parseProjectIdsParam(" a, b ,a")).toEqual(["a", "b"]);
    expect(parseProjectIdsParam(undefined)).toBeUndefined();
  });

  it("accepts 1–100 ids of at most 128 characters", () => {
    const hundred = Array.from({ length: 100 }, (_, i) => `p${i}`);
    expect(parseProjectIdsParam(hundred.join(","))).toHaveLength(100);
    expect(refusal([...hundred, "p100"].join(","))).toBe(PROJECT_IDS_MESSAGE);
    expect(refusal("")).toBe(PROJECT_IDS_MESSAGE);
    expect(refusal("a,,b")).toBe(PROJECT_IDS_MESSAGE);
    expect(refusal(" ")).toBe(PROJECT_IDS_MESSAGE);
    expect(refusal("x".repeat(129))).toBe(PROJECT_IDS_MESSAGE);
    expect(parseProjectIdsParam("x".repeat(128))).toHaveLength(1);
  });
});

describe("request schemas", () => {
  const chart = (body: Record<string, unknown>) =>
    analyticsChartRequestSchema.safeParse({ workspaceId: "w", ...body })
      .success;

  it("accepts the documented chart fields", () => {
    expect(chart({ xAxis: "group" })).toBe(true);
    expect(
      chart({
        xAxis: "createdAt",
        segment: "assignee",
        metric: "estimatePoints",
        dateBucket: "week",
        includeNone: false,
        archived: "include",
        showSubTasks: false,
        scope: { projectIds: ["p1"] },
        context: { timeZone: "Asia/Kolkata", weekStartsOn: 6 },
        filters: { key: "priority", operator: "in", values: ["high"] },
      }),
    ).toBe(true);
    // Segment rules (equal to x, dates) are the controller's 400s.
    expect(chart({ xAxis: "group", segment: "dueDate" })).toBe(true);
    expect(chart({ xAxis: "group", segment: null })).toBe(true);
  });

  it("refuses unknown dimensions, metrics, buckets and fields", () => {
    expect(chart({})).toBe(false);
    expect(chart({ xAxis: "size" })).toBe(false);
    expect(chart({ xAxis: "group", segment: "size" })).toBe(false);
    expect(chart({ xAxis: "group", metric: "hours" })).toBe(false);
    expect(chart({ xAxis: "createdAt", dateBucket: "day" })).toBe(false);
    expect(chart({ xAxis: "group", extra: 1 })).toBe(false);
    expect(chart({ xAxis: "group", scope: { projectIds: [] } })).toBe(false);
    expect(
      chart({
        xAxis: "group",
        scope: { projectIds: Array.from({ length: 101 }, (_, i) => `p${i}`) },
      }),
    ).toBe(false);
    expect(chart({ xAxis: "group", context: { weekStartsOn: 3 } })).toBe(false);
  });

  it("needs from, to and bucket for series", () => {
    const trend = (body: Record<string, unknown>) =>
      analyticsTrendRequestSchema.safeParse({ workspaceId: "w", ...body })
        .success;
    expect(
      trend({ from: "2026-03-01", to: "2026-03-31", bucket: "week" }),
    ).toBe(true);
    expect(trend({ from: "2026-03-01", to: "2026-03-31" })).toBe(false);
    expect(trend({ from: "2026-03-01", bucket: "month" })).toBe(false);
    const intake = (query: Record<string, string>) =>
      analyticsIntakeQuerySchema.safeParse({
        workspaceId: "w",
        from: "2026-03-01",
        to: "2026-03-31",
        bucket: "week",
        ...query,
      }).success;
    expect(intake({})).toBe(true);
    expect(intake({ weekStartsOn: "1" })).toBe(true);
    expect(intake({ weekStartsOn: "2" })).toBe(false);
  });
});

describe("dimension catalog", () => {
  it("marks dates, many-valued keys and none buckets", () => {
    expect(DATE_DIMENSIONS.every((key) => isDateDimension(key))).toBe(true);
    expect(isDateDimension("group")).toBe(false);
    const many = Object.entries(DIMENSIONS)
      .filter(([, info]) => info.many)
      .map(([key]) => key);
    expect(many).toEqual(["assignee", "label", "module"]);
    const withoutNone = Object.entries(DIMENSIONS)
      .filter(([, info]) => !info.hasNone)
      .map(([key]) => key);
    expect(withoutNone).toEqual([
      "status",
      "group",
      "priority",
      "project",
      "createdAt",
    ]);
    expect(DIMENSIONS.label.segmentCap).toBe(8);
    expect(DIMENSIONS.assignee.segmentCap).toBe(5);
    expect(DIMENSIONS.group.segmentCap).toBeNull();
    expect(DIMENSIONS.priority.segmentCap).toBeNull();
  });
});
