import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { InternalApi } from "../../../apps/api/src/ai-build/dispatch";
import {
  applyActions,
  openUndo,
  sealUndo,
  UNDO_TTL_MS,
  undoAction,
} from "../../../apps/api/src/ai-chat-build/executor";
import type { PlanFacts } from "../../../apps/api/src/ai-chat-build/facts";
import type { ChatBuildAction } from "../../../apps/api/src/ai-chat-build/schema";

const ORIGINAL = process.env.AUTH_SECRET;
beforeEach(() => {
  process.env.AUTH_SECRET = "s".repeat(40);
});
afterEach(() => {
  process.env.AUTH_SECRET = ORIGINAL;
});

type Call = { method: string; path: string; body?: unknown };

/** A fake API: answers by "METHOD path", records every call. */
function fakeApi(
  answers: Record<
    string,
    { status?: number; data?: unknown; message?: string }
  >,
) {
  const calls: Call[] = [];
  const call = (async (method: string, path: string, body?: unknown) => {
    calls.push({ method, path, body });
    const answer = answers[`${method} ${path}`] ?? { data: {} };
    const status = answer.status ?? 200;
    return status < 300
      ? { ok: true, status, data: answer.data }
      : { ok: false, status, message: answer.message ?? "Nope" };
  }) as InternalApi;
  return { call, calls };
}

const facts: PlanFacts = {
  workspaceId: "w1",
  projects: [
    {
      id: "p1",
      name: "Web",
      key: "WEB",
      restricted: false,
      archived: false,
      cyclesEnabled: true,
      modulesEnabled: true,
      pagesEnabled: true,
      columns: [{ slug: "backlog", name: "Backlog" }],
    },
  ],
  members: [],
  agents: [],
  cycles: [],
  modules: [],
  labels: [],
  tasks: [],
};

describe("undo tokens", () => {
  it("seal and open, and refuse tampering", () => {
    const token = sealUndo(
      {
        userId: "u1",
        workspaceId: "w1",
        undo: { op: "delete_task", id: "t1" },
      },
      1_000,
    );
    expect(token).toBeTruthy();
    expect(openUndo(token as string)).toMatchObject({
      userId: "u1",
      exp: 1_000 + UNDO_TTL_MS,
      undo: { op: "delete_task", id: "t1" },
    });
    expect(openUndo(`${token}x`)).toBeNull();
    expect(openUndo("nonsense")).toBeNull();
  });

  it("checks owner and expiry, replays the inverse once", async () => {
    const token = sealUndo({
      userId: "u1",
      workspaceId: "w1",
      undo: { op: "status", id: "t1", before: "to-do" },
    }) as string;
    const { call, calls } = fakeApi({});
    await expect(
      undoAction({ call, token, userId: "u2", workspaceId: "w1" }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      undoAction({
        call,
        token,
        userId: "u1",
        workspaceId: "w1",
        now: Date.now() + UNDO_TTL_MS + 1,
      }),
    ).rejects.toMatchObject({ status: 410 });
    expect(calls).toHaveLength(0);

    await undoAction({ call, token, userId: "u1", workspaceId: "w1" });
    expect(calls).toEqual([
      { method: "PUT", path: "/task/status/t1", body: { status: "to-do" } },
    ]);
    await expect(
      undoAction({ call, token, userId: "u1", workspaceId: "w1" }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("archives a created task when the caller may not delete it", async () => {
    const token = sealUndo({
      userId: "u1",
      workspaceId: "w1",
      undo: { op: "delete_task", id: "t9" },
    }) as string;
    const { call, calls } = fakeApi({
      "DELETE /task/t9": { status: 403 },
    });
    await undoAction({ call, token, userId: "u1", workspaceId: "w1" });
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "DELETE /task/t9",
      "POST /task/archive/t9",
    ]);
  });
});

describe("applyActions", () => {
  it("resolves temp refs, skips dependents of failures and unconfirmed deletions", async () => {
    const { call, calls } = fakeApi({
      "POST /task/p1": {
        data: { id: "t-new", number: 7, title: "Write spec" },
      },
      "POST /cycle/project/p1": { status: 400, message: "Bad dates" },
    });
    const actions: ChatBuildAction[] = [
      {
        id: "a1",
        op: "create_task",
        title: "Write spec",
        risk: "write",
        refs: { tempId: "t1" },
        params: { projectId: "p1", title: "Write spec" },
        problem: null,
      },
      {
        id: "a2",
        op: "add_comment",
        title: "Comment",
        risk: "write",
        params: { taskRef: "t1", content: "Go" },
        problem: null,
      },
      {
        id: "a3",
        op: "create_cycle",
        title: "Sprint",
        risk: "write",
        refs: { tempId: "c1" },
        params: { projectId: "p1", name: "Sprint" },
        problem: null,
      },
      {
        id: "a4",
        op: "add_to_cycle",
        title: "Plan it",
        risk: "write",
        params: { cycleRef: "c1", taskRefs: ["t1"] },
        problem: null,
      },
      {
        id: "a5",
        op: "delete_task",
        title: "Delete",
        risk: "destructive",
        params: { taskId: "t-old" },
        problem: null,
      },
    ];
    const results = await applyActions({
      call,
      workspaceId: "w1",
      userId: "u1",
      facts,
      actions,
      confirmed: new Set(),
    });
    expect(results.map((r) => [r.actionId, r.ok, r.skipped ?? false])).toEqual([
      ["a1", true, false],
      ["a2", true, false],
      ["a3", false, false],
      ["a4", false, true],
      ["a5", false, true],
    ]);
    expect(results[0]).toMatchObject({
      url: "/dashboard/workspace/w1/project/p1/task/t-new",
      label: "WEB-7 Write spec",
    });
    expect(results[2]?.error).toBe("Bad dates");
    // The new task lands in the project's first column; the comment goes on it.
    expect(calls[0]).toMatchObject({
      method: "POST",
      path: "/task/p1",
      body: { status: "backlog", priority: "no-priority" },
    });
    expect(calls[1]).toMatchObject({
      method: "POST",
      path: "/comment/t-new",
      body: { content: "Go" },
    });
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
  });
});
