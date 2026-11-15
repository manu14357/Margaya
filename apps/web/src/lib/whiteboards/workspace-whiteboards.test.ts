import { describe, expect, it } from "vitest";
import type { WorkspaceWhiteboard } from "@/types/whiteboard";
import {
  groupWhiteboardsByProject,
  projectsWithWhiteboards,
  showWhiteboardsDestination,
} from "./workspace-whiteboards";

const on = { id: "p1", whiteboardsEnabled: true };
const off = { id: "p2", whiteboardsEnabled: false };

describe("projectsWithWhiteboards", () => {
  it("keeps the projects with Whiteboards on, in order", () => {
    const later = { id: "p3", whiteboardsEnabled: true };
    expect(projectsWithWhiteboards([on, off, later])).toEqual([on, later]);
    expect(projectsWithWhiteboards(undefined)).toEqual([]);
  });
});

describe("showWhiteboardsDestination", () => {
  const ready = {
    isGuest: false,
    isCheckingPermissions: false,
    canRead: true,
    projects: [off, on],
  };

  it("shows for readers once one project has Whiteboards on", () => {
    expect(showWhiteboardsDestination(ready)).toBe(true);
  });

  it("stays hidden without a project that has them on", () => {
    expect(showWhiteboardsDestination({ ...ready, projects: [off] })).toBe(
      false,
    );
    expect(showWhiteboardsDestination({ ...ready, projects: undefined })).toBe(
      false,
    );
  });

  it("stays hidden without whiteboard:read, while checking, and for guests", () => {
    expect(showWhiteboardsDestination({ ...ready, canRead: false })).toBe(
      false,
    );
    expect(
      showWhiteboardsDestination({ ...ready, isCheckingPermissions: true }),
    ).toBe(false);
    expect(showWhiteboardsDestination({ ...ready, isGuest: true })).toBe(false);
  });
});

describe("groupWhiteboardsByProject", () => {
  const project = (id: string) => ({ id, name: id, slug: id, icon: null });
  const board = (id: string, projectId: string) =>
    ({ id, projectId, project: project(projectId) }) as WorkspaceWhiteboard;

  it("groups in order of first appearance, keeping board order", () => {
    const groups = groupWhiteboardsByProject([
      board("a", "p2"),
      board("b", "p1"),
      board("c", "p2"),
    ]);
    expect(
      groups.map((group) => [
        group.project.id,
        group.boards.map((entry) => entry.id),
      ]),
    ).toEqual([
      ["p2", ["a", "c"]],
      ["p1", ["b"]],
    ]);
    expect(groupWhiteboardsByProject([])).toEqual([]);
  });
});
