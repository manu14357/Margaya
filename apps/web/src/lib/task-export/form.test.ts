import { describe, expect, it } from "vitest";
import { buildExportInput, canSplitByProject } from "./form";

describe("canSplitByProject", () => {
  it("needs two picked projects, or All projects covering two", () => {
    expect(canSplitByProject(2, 0)).toBe(true);
    expect(canSplitByProject(1, 5)).toBe(false);
    expect(canSplitByProject(0, 2)).toBe(true);
    expect(canSplitByProject(0, 1)).toBe(false);
  });
});

describe("buildExportInput", () => {
  const base = {
    workspaceId: "ws-1",
    format: "xlsx" as const,
    includeArchived: true,
    activeProjectCount: 3,
  };

  it("leaves projectIds out for All projects", () => {
    expect(buildExportInput({ ...base, projectIds: [], split: true })).toEqual({
      workspaceId: "ws-1",
      format: "xlsx",
      projectIds: undefined,
      splitByProject: true,
      includeArchived: true,
    });
  });

  it("sends picked ids and drops a split that one project can't use", () => {
    expect(
      buildExportInput({
        ...base,
        projectIds: ["p-1"],
        split: true,
        includeArchived: false,
      }),
    ).toEqual({
      workspaceId: "ws-1",
      format: "xlsx",
      projectIds: ["p-1"],
      splitByProject: false,
      includeArchived: false,
    });
  });
});
