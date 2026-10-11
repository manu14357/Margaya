import { describe, expect, it } from "vitest";
import {
  naturalOrder,
  parseEstimateKey,
  segmentOrder,
} from "../../../apps/api/src/analytics/order";
import { fakeContext, fakeLookup } from "./lookup";

describe("natural order per dimension", () => {
  it("puts planned first, then columns by position", () => {
    const lookup = fakeLookup({ context: fakeContext(["web"]) });
    expect(
      naturalOrder("status", ["done", "planned", "to-do", "doing"], lookup),
    ).toEqual(["planned", "to-do", "doing", "done"]);
  });

  it("uses the group rank and the fixed priority order", () => {
    const lookup = fakeLookup();
    expect(
      naturalOrder(
        "group",
        ["cancelled", "backlog", "completed", "started", "unstarted"],
        lookup,
      ),
    ).toEqual(["backlog", "unstarted", "started", "completed", "cancelled"]);
    expect(
      naturalOrder(
        "priority",
        ["low", "no-priority", "urgent", "medium", "high"],
        lookup,
      ),
    ).toEqual(["urgent", "high", "medium", "low", "no-priority"]);
  });

  it("sorts people and labels by name, case-insensitively, none last", () => {
    const lookup = fakeLookup({
      users: [
        { id: "u1", name: "bob" },
        { id: "u2", name: "Alice" },
        { id: "u3", name: "Carol" },
      ],
    });
    expect(
      naturalOrder("assignee", ["none", "u3", "u1", "u2"], lookup),
    ).toEqual(["u2", "u1", "u3", "none"]);
    expect(naturalOrder("createdBy", ["u1", "none", "u2"], lookup)).toEqual([
      "u2",
      "u1",
      "none",
    ]);
    expect(
      naturalOrder("label", ["none", "name:beta", "name:Alpha"], lookup),
    ).toEqual(["name:Alpha", "name:beta", "none"]);
  });

  it("sorts cycles by start date with drafts after, by name", () => {
    const lookup = fakeLookup({
      cycles: [
        { id: "c1", name: "Later", startDate: "2026-04-01" },
        { id: "c2", name: "Sooner", startDate: "2026-03-01" },
        { id: "c3", name: "b draft" },
        { id: "c4", name: "A draft" },
      ],
    });
    expect(
      naturalOrder("cycle", ["none", "c3", "c1", "c4", "c2"], lookup),
    ).toEqual(["c2", "c1", "c4", "c3", "none"]);
  });

  it("sorts modules by status, then name", () => {
    const lookup = fakeLookup({
      modules: [
        { id: "m1", name: "Zed", status: "backlog" },
        { id: "m2", name: "Alpha", status: "in-progress" },
        { id: "m3", name: "beta", status: "backlog" },
      ],
    });
    expect(naturalOrder("module", ["m2", "none", "m1", "m3"], lookup)).toEqual([
      "m3",
      "m1",
      "m2",
      "none",
    ]);
  });

  it("sorts estimates by type, then value or category position", () => {
    const lookup = fakeLookup({
      estimates: [
        { key: "categories:S", position: 0 },
        { key: "categories:L", position: 2 },
        { key: "categories:M", position: 1 },
      ],
    });
    expect(
      naturalOrder(
        "estimate",
        [
          "categories:L",
          "none",
          "time:90",
          "points:13",
          "categories:S",
          "points:2",
          "time:30",
          "points:0.5",
          "categories:M",
        ],
        lookup,
      ),
    ).toEqual([
      "points:0.5",
      "points:2",
      "points:13",
      "time:30",
      "time:90",
      "categories:S",
      "categories:M",
      "categories:L",
      "none",
    ]);
  });

  it("keeps dates chronological with none last", () => {
    expect(
      naturalOrder(
        "dueDate",
        ["none", "2026-03-01", "2025-12-01", "2026-01-01"],
        fakeLookup(),
      ),
    ).toEqual(["2025-12-01", "2026-01-01", "2026-03-01", "none"]);
  });

  it("orders projects by sidebar position", () => {
    expect(naturalOrder("project", ["api", "web"], fakeLookup())).toEqual([
      "web",
      "api",
    ]);
  });

  it("puts other and none after named segments", () => {
    expect(
      segmentOrder(
        "priority",
        ["none", "other", "low", "urgent"],
        fakeLookup(),
      ),
    ).toEqual(["urgent", "low", "other", "none"]);
  });

  it("parses estimate keys whose value holds a colon", () => {
    expect(parseEstimateKey("categories:a:b")).toEqual({
      type: "categories",
      value: "a:b",
    });
    expect(parseEstimateKey("none")).toBeNull();
  });
});
