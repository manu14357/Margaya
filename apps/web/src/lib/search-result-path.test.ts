import { describe, expect, it } from "vitest";
import { planningResultPath } from "./search-result-path";

describe("planningResultPath", () => {
  const ws = "w1";

  it("opens cycles and modules on their pages", () => {
    expect(
      planningResultPath({ id: "c1", type: "cycle", projectId: "p1" }, ws),
    ).toBe("/dashboard/workspace/w1/project/p1/cycles/c1");
    expect(
      planningResultPath({ id: "m1", type: "module", projectId: "p1" }, ws),
    ).toBe("/dashboard/workspace/w1/project/p1/modules/m1");
  });

  it("opens project and workspace views", () => {
    expect(
      planningResultPath({ id: "v1", type: "view", projectId: "p1" }, ws),
    ).toBe("/dashboard/workspace/w1/project/p1/views/v1");
    expect(planningResultPath({ id: "v2", type: "view" }, ws)).toBe(
      "/dashboard/workspace/w1/views/v2",
    );
  });

  it("opens an intake request under the tab that lists it", () => {
    expect(
      planningResultPath(
        { id: "i1", type: "intake", projectId: "p1", status: "pending" },
        ws,
      ),
    ).toBe("/dashboard/workspace/w1/project/p1/intake?item=i1");
    expect(
      planningResultPath(
        { id: "i2", type: "intake", projectId: "p1", status: "declined" },
        ws,
      ),
    ).toBe("/dashboard/workspace/w1/project/p1/intake?item=i2&tab=closed");
  });

  it("returns null for other kinds or a missing project", () => {
    expect(planningResultPath({ id: "t1", type: "task" }, ws)).toBeNull();
    expect(planningResultPath({ id: "c1", type: "cycle" }, ws)).toBeNull();
  });
});
