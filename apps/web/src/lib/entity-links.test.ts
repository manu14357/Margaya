import { IterationCw, Layout, SquareCheck, Star } from "lucide-react";
import { describe, expect, it } from "vitest";
import {
  getEntityIcon,
  getEntityPath,
  registerEntityLink,
} from "./entity-links";

describe("entity links", () => {
  it("opens a project on its board with its own icon", () => {
    const project = {
      type: "project",
      id: "p1",
      icon: "Star",
      projectId: "p1",
    };
    expect(getEntityPath(project, "w1")).toBe(
      "/dashboard/workspace/w1/project/p1/board",
    );
    expect(getEntityIcon(project)).toBe(Star);
    expect(getEntityIcon({ ...project, icon: "__proto__" })).toBe(Layout);
  });

  it("opens a task on its page", () => {
    const task = { type: "task", id: "t1", icon: null, projectId: "p1" };
    expect(getEntityPath(task, "w1")).toBe(
      "/dashboard/workspace/w1/project/p1/task/t1",
    );
    expect(getEntityIcon(task)).toBe(SquareCheck);
  });

  it("lets a slice register a type and restores on cleanup", () => {
    const cycle = { type: "cycle", id: "c1", icon: null, projectId: "p1" };
    expect(getEntityPath(cycle, "w1")).toBeNull();

    const unregister = registerEntityLink("cycle", {
      icon: () => IterationCw,
      path: (entity, workspaceId) =>
        `/dashboard/workspace/${workspaceId}/project/${entity.projectId}/cycles/${entity.id}`,
    });
    expect(getEntityPath(cycle, "w1")).toBe(
      "/dashboard/workspace/w1/project/p1/cycles/c1",
    );
    expect(getEntityIcon(cycle)).toBe(IterationCw);

    unregister();
    expect(getEntityPath(cycle, "w1")).toBeNull();
  });
});
