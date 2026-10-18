import { describe, expect, it } from "vitest";
import { matchEntityRoute } from "./entity-commands";

describe("matchEntityRoute", () => {
  const base = "/dashboard/workspace/w1/project/p1";

  it("finds an open page, cycle or module", () => {
    expect(matchEntityRoute(`${base}/pages/pg1`)).toEqual({
      kind: "page",
      projectId: "p1",
      id: "pg1",
    });
    expect(matchEntityRoute(`${base}/cycles/c1`)).toEqual({
      kind: "cycle",
      projectId: "p1",
      id: "c1",
    });
    expect(matchEntityRoute(`${base}/modules/m1/`)).toEqual({
      kind: "module",
      projectId: "p1",
      id: "m1",
    });
  });

  it("ignores lists and other screens", () => {
    expect(matchEntityRoute(`${base}/pages`)).toBeNull();
    expect(matchEntityRoute(`${base}/cycles`)).toBeNull();
    expect(matchEntityRoute(`${base}/board`)).toBeNull();
    expect(matchEntityRoute(`${base}/task/t1`)).toBeNull();
  });
});
