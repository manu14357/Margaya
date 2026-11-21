import { describe, expect, it } from "vitest";
import {
  applyBuild,
  BUILD_POINTS_SCALE,
} from "../../../apps/api/src/ai-build/apply";
import type { InternalApi } from "../../../apps/api/src/ai-build/dispatch";
import { normalizeProposal } from "../../../apps/api/src/ai-build/proposal";

type Call = { method: string; path: string; body?: unknown };

const POINTS = BUILD_POINTS_SCALE.map((value) => ({
  id: `pt-${value}`,
  numericValue: Number(value),
}));

/**
 * A fake internal API: records calls and answers the routes apply uses. A
 * project created with an estimate system has it active, like POST /project.
 */
function fakeApi(options: { existingActive?: boolean } = {}) {
  const calls: Call[] = [];
  let taskNumber = 0;
  let active = options.existingActive ?? false;
  const call = (async (method: string, path: string, body?: unknown) => {
    calls.push({ method, path, body });
    if (method === "POST" && path === "/project") {
      if ((body as { estimate?: unknown }).estimate) active = true;
      return {
        ok: true,
        status: 200,
        data: { id: "proj-1", name: "Plan", slug: "PLN", icon: null },
      };
    }
    if (method === "GET" && path.startsWith("/column/")) {
      return {
        ok: true,
        status: 200,
        data: [{ name: "To Do", slug: "to-do", position: 0 }],
      };
    }
    if (method === "GET" && path.startsWith("/label/workspace/")) {
      return { ok: true, status: 200, data: [] };
    }
    if (method === "GET" && path.startsWith("/estimate/")) {
      return {
        ok: true,
        status: 200,
        data: active
          ? {
              activeEstimateId: "est-1",
              estimates: [{ id: "est-1", type: "points", points: POINTS }],
            }
          : { activeEstimateId: null, estimates: [] },
      };
    }
    if (method === "POST" && path.startsWith("/task/")) {
      taskNumber += 1;
      return { ok: true, status: 200, data: { id: `task-${taskNumber}` } };
    }
    return { ok: true, status: 200, data: {} };
  }) as InternalApi;
  return { call, calls };
}

function proposal(newProject: boolean) {
  return normalizeProposal(
    {
      project: { name: "Plan", key: "PLN", description: "" },
      tasks: [
        { title: "A", estimate: 5 },
        { title: "B", estimate: 4 },
        { title: "C", estimate: null },
      ],
    },
    { newProject, fallbackName: "Plan" },
  );
}

const ledger = () => ({
  project: null,
  columns: [],
  cycles: [],
  modules: [],
  tasks: [],
  subtasks: [],
});

const taskBodies = (calls: Call[]) =>
  calls
    .filter((c) => c.method === "POST" && c.path === "/task/proj-1")
    .map((c) => c.body as { title: string; estimatePointId?: string });

describe("applyBuild estimates", () => {
  it("creates a new project with a points system so the reviewed estimates land", async () => {
    const { call, calls } = fakeApi();
    const report = await applyBuild({
      call,
      workspaceId: "ws-1",
      projectId: null,
      proposal: proposal(true),
      ledger: ledger(),
    });

    expect(report.estimatesSkipped).toBe(false);
    // Part of creating the project (project:create), not a later
    // estimate write that needs project:update.
    const project = calls.find((c) => c.path === "/project");
    expect(project?.body).toMatchObject({
      estimate: {
        name: "Story points",
        type: "points",
        values: BUILD_POINTS_SCALE,
      },
    });
    expect(
      calls.some((c) => c.method === "POST" && c.path.startsWith("/estimate/")),
    ).toBe(false);
    expect(
      taskBodies(calls).map((body) => [body.title, body.estimatePointId]),
    ).toEqual([
      ["A", "pt-5"],
      ["B", "pt-3"],
      ["C", undefined],
    ]);
  });

  it("sends no estimate system when the plan has no estimates", async () => {
    const { call, calls } = fakeApi();
    await applyBuild({
      call,
      workspaceId: "ws-1",
      projectId: null,
      proposal: normalizeProposal(
        { project: { name: "Plan", key: "PLN" }, tasks: [{ title: "A" }] },
        { newProject: true, fallbackName: "Plan" },
      ),
      ledger: ledger(),
    });
    const project = calls.find((c) => c.path === "/project");
    expect(project?.body).not.toHaveProperty("estimate");
    expect(calls.some((c) => c.path.startsWith("/estimate/"))).toBe(false);
  });

  it("uses an existing project's active points system", async () => {
    const { call, calls } = fakeApi({ existingActive: true });
    const report = await applyBuild({
      call,
      workspaceId: "ws-1",
      projectId: "proj-1",
      proposal: proposal(false),
      ledger: ledger(),
    });
    expect(report.estimatesSkipped).toBe(false);
    expect(taskBodies(calls)[0]?.estimatePointId).toBe("pt-5");
  });

  it("never adds a system to an existing project without one", async () => {
    const { call, calls } = fakeApi();
    const report = await applyBuild({
      call,
      workspaceId: "ws-1",
      projectId: "proj-1",
      proposal: proposal(false),
      ledger: ledger(),
    });
    expect(report.estimatesSkipped).toBe(true);
    expect(
      calls.some((c) => c.method === "POST" && c.path.startsWith("/estimate/")),
    ).toBe(false);
    expect(
      taskBodies(calls).every((body) => body.estimatePointId === undefined),
    ).toBe(true);
  });
});
