import { describe, expect, it } from "vitest";
import type { PlanFacts } from "../../../apps/api/src/ai-chat-build/facts";
import {
  mentionedTaskRefs,
  resolveMember,
  validateActions,
} from "../../../apps/api/src/ai-chat-build/validate";

const facts: PlanFacts = {
  workspaceId: "w1",
  projects: [
    {
      id: "p-web",
      name: "Website",
      key: "WEB",
      restricted: false,
      archived: false,
      cyclesEnabled: true,
      modulesEnabled: false,
      pagesEnabled: true,
      columns: [
        { slug: "to-do", name: "To Do" },
        { slug: "doing", name: "Doing" },
        { slug: "done", name: "Done" },
      ],
    },
  ],
  members: [
    { id: "u-elena", name: "Elena Petrova" },
    { id: "u-mark1", name: "Mark Stone" },
    { id: "u-mark2", name: "Mark Lee" },
  ],
  agents: [
    { id: "ag-1", userId: "u-atlas", name: "Atlas", enabled: true },
    { id: "ag-2", userId: "u-off", name: "Sleepy", enabled: false },
  ],
  cycles: [
    {
      id: "c-1",
      projectId: "p-web",
      name: "Sprint 4",
      startDate: "2026-11-02",
      endDate: "2026-11-13",
    },
  ],
  modules: [],
  labels: [{ name: "Bug", color: "red" }],
  tasks: [
    {
      id: "t-12",
      projectId: "p-web",
      key: "WEB-12",
      title: "Fix login",
      status: "to-do",
    },
  ],
};

const everything = () => true;

function plan(raw: unknown[], can = everything, defaultProjectId = "p-web") {
  return validateActions(raw, {
    facts,
    can,
    defaultProjectId,
    source: "model",
  });
}

describe("resolveMember", () => {
  it("matches an id, a full name, a first name and a prefix", () => {
    expect(resolveMember("u-elena", facts.members)).toEqual({ id: "u-elena" });
    expect(resolveMember("elena petrova", facts.members)).toEqual({
      id: "u-elena",
    });
    expect(resolveMember("@Elena", facts.members)).toEqual({ id: "u-elena" });
    expect(resolveMember("Pet", facts.members)).toEqual({ id: "u-elena" });
  });

  it("reports an ambiguous name with its candidates, and an unknown one", () => {
    const mark = resolveMember("Mark", facts.members);
    expect(mark).toMatchObject({
      problem: {
        code: "ambiguous",
        candidates: [
          { id: "u-mark1", name: "Mark Stone" },
          { id: "u-mark2", name: "Mark Lee" },
        ],
      },
    });
    expect(resolveMember("Zed", facts.members)).toMatchObject({
      problem: { code: "not_found" },
    });
  });
});

describe("validateActions", () => {
  it("resolves names, keys and statuses, and links temp refs", () => {
    const { actions, truncated } = plan([
      {
        op: "create_project",
        title: "Create project NX-7 Sensor Fusion",
        detail: "",
        tempId: "p1",
        params: JSON.stringify({
          name: "Sensor Fusion",
          key: "nx7",
          leadUserId: "Elena",
        }),
      },
      {
        op: "create_task",
        title: "Calibrate IMU",
        detail: "",
        tempId: "t1",
        params: JSON.stringify({
          projectRef: "p1",
          title: "Calibrate IMU",
          status: "In Review",
          assigneeIds: ["Elena"],
          dueDate: "2026-11-20",
          priority: null,
        }),
      },
      {
        op: "set_status",
        title: "Move WEB-12 to Doing",
        detail: "",
        tempId: "",
        params: { taskId: "WEB-12", status: "Doing" },
      },
      {
        op: "add_to_cycle",
        title: "Plan WEB-12 in Sprint 4",
        detail: "",
        tempId: "",
        params: { cycleId: "Sprint 4", taskIds: ["WEB-12"] },
      },
    ]);
    expect(truncated).toBe(false);
    expect(actions.map((action) => [action.id, action.problem])).toEqual([
      ["a1", null],
      ["a2", null],
      ["a3", null],
      ["a4", null],
    ]);
    expect(actions[0]).toMatchObject({
      op: "create_project",
      risk: "write",
      refs: { tempId: "p1" },
      params: { name: "Sensor Fusion", key: "NX7", leadUserId: "u-elena" },
    });
    expect(actions[1]?.params).toEqual({
      projectRef: "p1",
      title: "Calibrate IMU",
      status: "in-review",
      assigneeIds: ["u-elena"],
      dueDate: "2026-11-20",
    });
    expect(actions[2]?.params).toEqual({ taskId: "t-12", status: "doing" });
    expect(actions[3]?.params).toEqual({ cycleId: "c-1", taskIds: ["t-12"] });
  });

  it("puts new things in the current project by default", () => {
    const { actions } = plan([
      {
        op: "create_task",
        title: "Write docs",
        params: { title: "Write docs" },
      },
    ]);
    expect(actions[0]?.params).toMatchObject({ projectId: "p-web" });
    expect(actions[0]?.problem).toBeNull();
  });

  it("flags unknown and ambiguous people, unknown tasks and bad refs", () => {
    const { actions } = plan([
      {
        op: "assign",
        title: "Assign to Mark",
        params: { taskId: "WEB-12", userIds: ["Mark"] },
      },
      {
        op: "assign",
        title: "Assign to Zed",
        params: { taskId: "WEB-12", userIds: ["Zed"] },
      },
      {
        op: "add_comment",
        title: "Comment",
        params: { taskId: "WEB-99", content: "Hi" },
      },
      {
        op: "create_task",
        title: "Orphan",
        params: { projectRef: "p9", title: "Orphan" },
      },
    ]);
    expect(actions.map((action) => action.problem?.code)).toEqual([
      "ambiguous",
      "not_found",
      "not_found",
      "not_found",
    ]);
    expect(actions[0]?.problem?.candidates).toHaveLength(2);
  });

  it("reads an existing project's key or a task's key in a ref field", () => {
    const { actions } = plan([
      {
        op: "create_task",
        title: "Resolve blockers",
        params: { projectRef: "WEB", title: "Resolve blockers" },
      },
      {
        op: "add_comment",
        title: "Note",
        params: { taskRef: "WEB-12", content: "Hi" },
      },
    ]);
    expect(actions.map((action) => action.problem)).toEqual([null, null]);
    expect(actions[0]?.params).toMatchObject({ projectId: "p-web" });
    expect(actions[0]?.params).not.toHaveProperty("projectRef");
    expect(actions[1]?.params).not.toHaveProperty("taskRef");
  });

  it("marks what depends on a broken action, and feature switches", () => {
    const { actions } = plan([
      {
        op: "create_task",
        title: "Bad",
        tempId: "t1",
        params: { projectId: "nope", title: "Bad" },
      },
      {
        op: "add_comment",
        title: "On bad",
        params: { taskRef: "t1", content: "Hi" },
      },
      {
        op: "create_module",
        title: "Module",
        params: { name: "Auth" },
      },
    ]);
    expect(actions.map((action) => action.problem?.code)).toEqual([
      "not_found",
      "unresolved_ref",
      "feature_off",
    ]);
  });

  it("checks the caller's permissions per action", () => {
    const viewer = (permissions: Record<string, string[]>) =>
      Object.entries(permissions).every(([resource, actions]) =>
        actions.every((action) => resource === "task" && action === "read"),
      );
    const { actions } = plan(
      [
        { op: "create_task", title: "New", params: { title: "New" } },
        {
          op: "delete_task",
          title: "Delete WEB-12",
          params: { taskId: "WEB-12" },
        },
      ],
      viewer,
    );
    expect(actions[0]?.problem).toMatchObject({
      code: "forbidden",
      message: "You need task:create for this",
    });
    expect(actions[1]).toMatchObject({
      risk: "destructive",
      problem: { code: "forbidden" },
    });
  });

  it("drops invalid model output and caps the plan at 50 actions", () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      op: "create_label",
      title: `Label ${i}`,
      params: { name: `L${i}`, color: "teal" },
    }));
    const { actions, truncated } = plan([
      { op: "drop_database", title: "No", params: {} },
      { op: "create_task", title: "No title", params: {} },
      ...many,
    ]);
    expect(truncated).toBe(true);
    expect(actions).toHaveLength(48);
    expect(actions[0]?.op).toBe("create_label");
  });

  it("checks cycle dates and agents", () => {
    const { actions } = plan([
      {
        op: "create_cycle",
        title: "Sprint",
        params: { name: "Sprint 5", startDate: "2026-11-20" },
      },
      {
        op: "run_agent",
        title: "Atlas triages WEB-12",
        params: { agentId: "atlas", taskId: "WEB-12", prompt: "Triage" },
      },
      {
        op: "run_agent",
        title: "Sleepy",
        params: { agentId: "Sleepy", taskId: "WEB-12", prompt: "Triage" },
      },
    ]);
    expect(actions[0]?.problem?.code).toBe("invalid");
    expect(actions[1]).toMatchObject({
      problem: null,
      params: { agentId: "ag-1", taskId: "t-12" },
    });
    expect(actions[2]?.problem?.message).toBe("This agent is turned off");
  });

  it("keeps the person's action ids and reports invalid edits", () => {
    const { actions } = validateActions(
      [
        {
          id: "x7",
          op: "set_status",
          title: "Move",
          risk: "write",
          params: { taskId: "t-12", status: "nowhere" },
        },
      ],
      { facts, can: everything, source: "client" },
    );
    expect(actions[0]).toMatchObject({
      id: "x7",
      problem: { code: "invalid", message: 'Unknown status "nowhere"' },
    });
  });

  it("lists the tasks the raw actions mention", () => {
    expect(
      mentionedTaskRefs([
        { op: "assign", params: JSON.stringify({ taskId: "WEB-1" }) },
        { op: "add_to_cycle", params: { taskIds: ["WEB-2", "t-3"] } },
      ]),
    ).toEqual(["WEB-1", "WEB-2", "t-3"]);
  });
});

describe("task keys a plan reads", () => {
  // The planner's first import loads most of the API, which can take longer
  // than the default 5 s while the full suite runs in parallel.
  it("takes keys from the request, then the last two turns", {
    timeout: 30_000,
  }, async () => {
    const { typedTaskKeys } = await import(
      "../../../apps/api/src/ai-chat-build/planner"
    );
    expect(
      typedTaskKeys({
        prompt: "Generate a short description from the title",
        history: [
          { question: "Move OLD-1 to done", answer: "Moved." },
          { question: "Make WEB-3 urgent", answer: "Set." },
          {
            question: "add the description for WEB-18",
            answer: "What should the description for WEB-18 say?",
          },
        ],
      }),
    ).toEqual(["WEB-3", "WEB-18"]);
    expect(typedTaskKeys({ prompt: "Close WEB-2 and WEB-2" })).toEqual([
      "WEB-2",
    ]);
  });
});
