import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AnalyticsMeta } from "@/types/analytics";
import { DIMENSIONS } from "./dimensions";
import {
  bucketLabel,
  formatBucketDay,
  type LabelContext,
  periodTitle,
} from "./labels";

const t: LabelContext["t"] = (key, options) =>
  options ? `${key} ${JSON.stringify(options)}` : key;

const meta: Partial<AnalyticsMeta> = {
  users: [{ id: "u1", name: "Ada Lovelace", image: null }],
  projects: [{ id: "p1", name: "Web", slug: "WEB", icon: null }],
  labels: [{ key: "name:Bug", name: "Bug", color: "red" }],
  cycles: [
    {
      id: "c1",
      projectId: "p1",
      name: "Sprint 4",
      status: "current",
      startDate: "2026-03-02",
      endDate: "2026-03-15",
    },
  ],
  modules: [{ id: "m1", projectId: "p1", name: "Checkout", status: "planned" }],
  columns: [
    {
      slug: "to-do",
      name: "Ready",
      icon: null,
      group: "unstarted",
      position: 1,
    },
  ],
  estimates: [
    { key: "points:3", type: "points", value: "3" },
    { key: "time:90", type: "time", value: "90" },
    { key: "categories:XS", type: "categories", value: "XS" },
  ],
};

const context: LabelContext = { t, meta };

describe("bucketLabel", () => {
  it("names every none bucket with its dimension's copy", () => {
    for (const [dimension, info] of Object.entries(DIMENSIONS)) {
      if (!info.noneKey) continue;
      expect(
        bucketLabel(dimension as keyof typeof DIMENSIONS, "none", context),
      ).toBe(info.noneKey);
    }
    expect(bucketLabel("assignee", "none", context)).toBe(
      "analytics:none.assignee",
    );
  });

  it("names folded segments Other", () => {
    expect(bucketLabel("label", "other", context)).toBe("analytics:other");
  });

  it("reads names from meta", () => {
    expect(bucketLabel("assignee", "u1", context)).toBe("Ada Lovelace");
    expect(bucketLabel("createdBy", "u1", context)).toBe("Ada Lovelace");
    expect(bucketLabel("project", "p1", context)).toBe("Web");
    expect(bucketLabel("cycle", "c1", context)).toBe("Sprint 4");
    expect(bucketLabel("module", "m1", context)).toBe("Checkout");
    expect(bucketLabel("status", "to-do", context)).toBe("Ready");
  });

  it("names label keys, with or without meta", () => {
    expect(bucketLabel("label", "name:Bug", context)).toBe("Bug");
    expect(bucketLabel("label", "name:Chore", context)).toBe("Chore");
  });

  it("translates groups, priorities and the planned status", () => {
    expect(bucketLabel("group", "started", context)).toBe(
      "tasks:columnGroups.started.label",
    );
    expect(bucketLabel("priority", "no-priority", context)).toBe(
      "tasks:priority.no-priority",
    );
    expect(bucketLabel("status", "planned", context)).toBe(
      "tasks:status.planned",
    );
  });

  it("formats estimate values by their system type", () => {
    expect(bucketLabel("estimate", "points:3", context)).toBe(
      'tasks:estimate.pointsValue {"value":"3","count":3}',
    );
    expect(bucketLabel("estimate", "time:90", context)).toBe(
      'tasks:estimate.duration.hoursMinutes {"hours":1,"minutes":30}',
    );
    expect(bucketLabel("estimate", "categories:XS", context)).toBe("XS");
  });

  it("falls back to the key when meta lacks it", () => {
    expect(bucketLabel("assignee", "u9", context)).toBe("u9");
  });
});

describe("date keys", () => {
  const originalTz = process.env.TZ;
  beforeAll(() => {
    // West of Greenwich, `new Date("2026-03-01")` would read Feb 28.
    process.env.TZ = "America/Los_Angeles";
  });
  afterAll(() => {
    process.env.TZ = originalTz;
  });

  it("parses bucket days as local dates", () => {
    expect(formatBucketDay("2026-03-01", "week", { locale: "en-US" })).toBe(
      "Mar 1",
    );
    expect(
      bucketLabel("createdAt", "2026-03-01", {
        t,
        dateBucket: "week",
        locale: "en-US",
      }),
    ).toBe("Mar 1");
  });

  it("drops the year for months of the current year only", () => {
    expect(
      formatBucketDay("2026-03-01", "month", {
        today: "2026-09-30",
        locale: "en-US",
      }),
    ).toBe("Mar");
    expect(
      formatBucketDay("2025-12-01", "month", {
        today: "2026-09-30",
        locale: "en-US",
      }),
    ).toBe("Dec 2025");
  });

  it("titles a period with its clipped range, or its week", () => {
    expect(
      periodTitle(
        {
          start: "2026-02-23",
          rangeStart: "2026-03-01",
          rangeEnd: "2026-03-01",
        },
        "week",
        { t, locale: "en-US" },
      ),
    ).toBe("Mar 1, 2026");
    expect(
      periodTitle(
        {
          start: "2026-03-02",
          rangeStart: "2026-03-02",
          rangeEnd: "2026-03-08",
        },
        "week",
        { t, locale: "en-US" },
      ),
    ).toBe('analytics:buckets.range {"from":"Mar 2","to":"Mar 8, 2026"}');
    expect(
      periodTitle({ start: "2026-03-02" }, "week", { t, locale: "en-US" }),
    ).toBe('analytics:buckets.weekOf {"date":"Mar 2, 2026"}');
  });
});
