import { describe, expect, it } from "vitest";
import { captureAssignees, prefillAssignees } from "./default-assignee";

describe("default assignee prefill", () => {
  it("starts a form with the project default, or nobody", () => {
    expect(prefillAssignees("u1")).toEqual(["u1"]);
    expect(prefillAssignees(null)).toEqual([]);
    expect(prefillAssignees(undefined)).toEqual([]);
  });

  it("lets typed people win and respects a dismissed default", () => {
    expect(captureAssignees(["u2"], "u1", false)).toEqual(["u2"]);
    expect(captureAssignees([], "u1", false)).toEqual(["u1"]);
    expect(captureAssignees([], "u1", true)).toEqual([]);
    expect(captureAssignees([], null, false)).toEqual([]);
  });
});
