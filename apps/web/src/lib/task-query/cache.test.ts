import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
  invalidateTaskQueries,
  patchTaskInQueryCache,
  scopeKeyOf,
  taskPatchFromVariables,
  taskQueryKeys,
} from "./cache";

function result(tasks: Record<string, { id: string; status: string }>) {
  return { mode: "rows", groups: [], tasks, meta: {} };
}

describe("task query cache", () => {
  it("patches a task in every cached result and restores it", () => {
    const client = new QueryClient();
    const a = taskQueryKeys.request("w1", "p1", "rows", { a: 1 });
    const b = taskQueryKeys.request("w1", "workspace", "rows", { b: 1 });
    const other = ["tasks", "p1"];
    client.setQueryData(a, result({ t1: { id: "t1", status: "to-do" } }));
    client.setQueryData(b, result({ t1: { id: "t1", status: "to-do" } }));
    client.setQueryData(other, { t1: { id: "t1", status: "to-do" } });

    const rollback = patchTaskInQueryCache(client, "t1", { status: "done" });
    expect(
      (client.getQueryData(a) as ReturnType<typeof result>).tasks.t1?.status,
    ).toBe("done");
    expect(
      (client.getQueryData(b) as ReturnType<typeof result>).tasks.t1?.status,
    ).toBe("done");
    // Other caches are not task query results.
    expect(client.getQueryData(other)).toEqual({
      t1: { id: "t1", status: "to-do" },
    });

    rollback();
    expect(
      (client.getQueryData(a) as ReturnType<typeof result>).tasks.t1?.status,
    ).toBe("to-do");
  });

  it("invalidates one project's results and every workspace list", async () => {
    const client = new QueryClient();
    const project = taskQueryKeys.request("w1", "p1", "rows", {});
    const otherProject = taskQueryKeys.request("w1", "p2", "rows", {});
    const workspace = taskQueryKeys.request("w1", "workspace", "ids", {});
    for (const key of [project, otherProject, workspace]) {
      client.setQueryData(key, result({}));
    }
    await invalidateTaskQueries(client, "p1");
    const stale = (key: readonly unknown[]) =>
      client.getQueryState(key)?.isInvalidated;
    expect(stale(project)).toBe(true);
    expect(stale(workspace)).toBe(true);
    expect(stale(otherProject)).toBe(false);
  });

  it("reads patchable task fields from mutation variables", () => {
    expect(
      taskPatchFromVariables({
        id: "t1",
        status: "done",
        priority: "high",
        dueDate: null,
        description: "ignored",
      }),
    ).toEqual({
      taskId: "t1",
      patch: { status: "done", priority: "high", dueDate: null },
    });
    expect(taskPatchFromVariables({ id: "t1", status: "archived" })).toBe(null);
    expect(taskPatchFromVariables({ taskId: "t1", status: "done" })).toBe(null);
    expect(taskPatchFromVariables("t1")).toBe(null);
  });

  it("keys a single project by its id, anything else as the workspace", () => {
    expect(scopeKeyOf(["p1"])).toBe("p1");
    expect(scopeKeyOf(["p1", "p2"])).toBe("workspace");
    expect(scopeKeyOf(undefined)).toBe("workspace");
  });
});
