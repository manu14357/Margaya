import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { syncSavedProject } from "./use-update-project";

describe("syncSavedProject", () => {
  it("updates every cached copy of the project", () => {
    const queryClient = new QueryClient();
    const stale = { id: "p1", name: "Old", slug: "OLD", description: "" };
    queryClient.setQueryData(["projects", "w1", "p1"], stale);
    queryClient.setQueryData(
      ["projects", "w1"],
      [stale, { id: "p2", name: "Other" }],
    );
    queryClient.setQueryData(["tasks", "p1"], { ...stale, columns: [] });

    syncSavedProject(queryClient, {
      id: "p1",
      workspaceId: "w1",
      name: "New",
      slug: "NEW",
      description: "Text",
      icon: "Layout",
      isPublic: true,
    } as Parameters<typeof syncSavedProject>[1]);

    expect(queryClient.getQueryData(["projects", "w1", "p1"])).toMatchObject({
      name: "New",
      slug: "NEW",
    });
    expect(queryClient.getQueryData(["projects", "w1"])).toEqual([
      expect.objectContaining({ id: "p1", name: "New", isPublic: true }),
      { id: "p2", name: "Other" },
    ]);
    expect(queryClient.getQueryData(["tasks", "p1"])).toMatchObject({
      name: "New",
      description: "Text",
      columns: [],
    });
  });
});
