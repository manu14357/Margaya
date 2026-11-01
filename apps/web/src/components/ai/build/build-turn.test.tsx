import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BuildAction } from "@/fetchers/ai/chat-build";
import { BuildTurn, pickCandidate, willApply } from "./build-turn";
import type { BuildTurn as BuildTurnState } from "./use-build-session";

vi.setConfig({ testTimeout: 15_000 });

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
    i18n: { resolvedLanguage: "en-US", language: "en-US" },
  }),
}));

vi.mock(
  "@/hooks/queries/workspace-users/use-get-active-workspace-users",
  () => ({
    useGetActiveWorkspaceUsers: () => ({
      data: {
        members: [
          { userId: "u-mia", user: { name: "Mia" } },
          { userId: "u-ada", user: { name: "Ada" } },
        ],
      },
    }),
  }),
);

vi.mock("@/hooks/queries/ai/use-agents", () => ({
  useAgentRun: () => ({
    data: {
      id: "run-1",
      status: "running",
      agent: { id: "ag-1", userId: "u-atlas", name: "Atlas" },
      task: { id: "t1", projectId: "p1", key: "WEB-1", title: "Fix" },
      outputSummary: null,
    },
    isError: false,
  }),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...props }: { children?: React.ReactNode }) => (
    <a href="/agents" {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/i18n/domain", () => ({
  getPriorityLabel: (priority: string) => priority,
}));

afterEach(() => {
  cleanup();
});

const task: BuildAction = {
  id: "a1",
  op: "create_task",
  title: "Create task Calibrate IMU",
  risk: "write",
  params: { projectId: "p1", title: "Calibrate IMU" },
  problem: null,
};
const deletion: BuildAction = {
  id: "a2",
  op: "delete_task",
  title: "Delete WEB-1",
  risk: "destructive",
  params: { taskId: "t1" },
  problem: null,
};

function turnOf(patch: Partial<BuildTurnState> = {}): BuildTurnState {
  return {
    id: "b1",
    prompt: "Add a task and delete WEB-1",
    status: "ready",
    plan: "proposal",
    summary: "One task and one deletion.",
    actions: [task, deletion],
    question: null,
    truncated: false,
    confirmed: [],
    results: {},
    undo: {},
    autopilot: null,
    errorKey: null,
    startedAt: 0,
    context: null,
    reasoning: "",
    reasoningMs: null,
    ...patch,
  };
}

function show(turn: BuildTurnState, handlers: Record<string, unknown> = {}) {
  const props = {
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    onUndo: vi.fn(),
    onEdit: vi.fn(),
    onRemove: vi.fn(),
    onToggleDestructive: vi.fn(),
    onAnswer: vi.fn(),
    onOpen: vi.fn(),
    ...handlers,
  };
  render(<BuildTurn turn={turn} workspaceId="w1" {...props} />);
  return props;
}

describe("BuildTurn", () => {
  it("shows what the plan read and the live reasoning, then how long it thought", () => {
    vi.useFakeTimers();
    try {
      const planning = turnOf({
        status: "planning",
        plan: null,
        summary: "",
        actions: [],
        startedAt: Date.now(),
        context: {
          facts: { projects: 2, tasks: 30, members: 4, cycles: 1 },
          items: [
            { kind: "task", title: "WEB-5 Audit page titles", url: "/t/5" },
            { kind: "comment", title: "Comment on WEB-5", url: "/t/5" },
            { kind: "comment", title: "Comment on WEB-5", url: "/t/5" },
          ],
          memoryNotes: 1,
          earlierTurns: 2,
        },
        reasoning: "Mia is a member; WEB-5 has no assignee.",
      });
      const props = { onConfirm: vi.fn(), onCancel: vi.fn(), onUndo: vi.fn() };
      const onOpen = vi.fn();
      const { rerender } = render(
        <BuildTurn
          turn={planning}
          workspaceId="w1"
          onOpen={onOpen}
          {...props}
        />,
      );
      // Context is open while planning: facts, items (comments grouped),
      // memory and earlier messages.
      expect(
        screen.getByText('ai:build.context.title {"count":5}'),
      ).toBeTruthy();
      expect(
        screen.getByText(
          'ai:build.context.facts {"projects":2,"tasks":30,"members":4,"cycles":1}',
        ),
      ).toBeTruthy();
      expect(screen.getByText("Comment on WEB-5 ×2")).toBeTruthy();
      expect(
        screen.getByText('ai:build.context.memory {"count":1}'),
      ).toBeTruthy();
      expect(
        screen.getByText('ai:build.context.history {"count":2}'),
      ).toBeTruthy();
      fireEvent.click(screen.getByText("WEB-5 Audit page titles"));
      expect(onOpen).toHaveBeenCalledWith("/t/5");
      // The model's reasoning streams in under a live count.
      expect(
        screen.getByText("Mia is a member; WEB-5 has no assignee."),
      ).toBeTruthy();
      expect(
        screen.getByText('ai:ask.thinking.live {"seconds":0}'),
      ).toBeTruthy();
      act(() => {
        vi.advanceTimersByTime(3000);
      });
      expect(
        screen.getByText('ai:ask.thinking.live {"seconds":3}'),
      ).toBeTruthy();
      // Done: both fold, the duration stays.
      rerender(
        <BuildTurn
          turn={{
            ...planning,
            ...turnOf({ reasoningMs: 3000 }),
            context: planning.context,
            reasoning: planning.reasoning,
          }}
          workspaceId="w1"
          {...props}
        />,
      );
      expect(
        screen.getByText('ai:ask.thinking.done {"seconds":3}'),
      ).toBeTruthy();
      expect(screen.queryByText("Comment on WEB-5 ×2")).toBeNull();
      rerender(
        <BuildTurn
          turn={turnOf({ status: "applying" })}
          workspaceId="w1"
          {...props}
        />,
      );
      expect(screen.getByText("ai:build.chat.applying")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the cards and the awaiting footer, and confirms or cancels", () => {
    const props = show(turnOf());
    expect(screen.getByText("One task and one deletion.")).toBeTruthy();
    expect(screen.getByText("Create task Calibrate IMU")).toBeTruthy();
    expect(screen.getByText("ai:build.chat.awaiting")).toBeTruthy();
    // The unticked deletion doesn't count.
    expect(screen.getByText('ai:build.chat.ready {"count":1}')).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "ai:build.chat.confirm" }),
    );
    expect(props.onConfirm).toHaveBeenCalledOnce();
    fireEvent.click(
      screen.getByRole("button", { name: "ai:build.chat.cancel" }),
    );
    expect(props.onCancel).toHaveBeenCalledOnce();
  });

  it("removes a card and edits a field", () => {
    const props = show(turnOf());
    fireEvent.click(
      screen.getByRole("button", {
        name: 'ai:build.chat.remove {"title":"Delete WEB-1"}',
      }),
    );
    expect(props.onRemove).toHaveBeenCalledWith("a2");

    fireEvent.change(screen.getByLabelText("ai:build.chat.fields.title"), {
      target: { value: "Calibrate the IMU" },
    });
    expect(props.onEdit).toHaveBeenCalledWith(
      "a1",
      expect.objectContaining({
        params: { projectId: "p1", title: "Calibrate the IMU" },
      }),
    );
    fireEvent.change(screen.getByLabelText("ai:build.chat.fields.assignee"), {
      target: { value: "u-ada" },
    });
    expect(props.onEdit).toHaveBeenLastCalledWith(
      "a1",
      expect.objectContaining({
        params: expect.objectContaining({ assigneeIds: ["u-ada"] }),
      }),
    );
  });

  it("says why nothing can be confirmed when every change is flagged", () => {
    show(
      turnOf({
        actions: [
          {
            ...task,
            problem: { code: "not_found", message: "Project not found" },
          },
        ],
      }),
    );
    expect(screen.getByText("ai:build.chat.noneReady")).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "ai:build.chat.confirm",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("needs an explicit tick for a destructive action", () => {
    const props = show(turnOf({ actions: [deletion] }));
    const confirm = screen.getByRole("button", {
      name: "ai:build.chat.confirm",
    }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("ai:build.chat.confirmDestructive"));
    expect(props.onToggleDestructive).toHaveBeenCalledWith("a2");

    cleanup();
    show(turnOf({ actions: [deletion], confirmed: ["a2"] }));
    expect(
      (
        screen.getByRole("button", {
          name: "ai:build.chat.confirm",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });

  it("shows results with links, errors and Undo", () => {
    const props = show(
      turnOf({
        status: "applied",
        results: {
          a1: {
            actionId: "a1",
            ok: true,
            url: "/dashboard/workspace/w1/project/p1/task/t9",
            label: "WEB-9 Calibrate IMU",
            undoToken: "tok",
          },
          a2: {
            actionId: "a2",
            ok: false,
            skipped: true,
            error: "Not confirmed",
          },
        },
      }),
    );
    expect(screen.queryByText("ai:build.chat.awaiting")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "WEB-9 Calibrate IMU" }),
    );
    expect(props.onOpen).toHaveBeenCalledWith(
      "/dashboard/workspace/w1/project/p1/task/t9",
    );
    fireEvent.click(screen.getByRole("button", { name: "ai:build.chat.undo" }));
    expect(props.onUndo).toHaveBeenCalledWith("a1");
    expect(screen.getByRole("alert").textContent).toContain("Not confirmed");
    expect(
      screen.getByText('ai:build.chat.appliedSummary {"done":1,"total":2}'),
    ).toBeTruthy();
    // No editing once applied.
    expect(screen.queryByLabelText("ai:build.chat.fields.title")).toBeNull();
  });

  it("marks an undone action", () => {
    show(
      turnOf({
        status: "applied",
        actions: [task],
        results: { a1: { actionId: "a1", ok: true, undoToken: "tok" } },
        undo: { a1: "done" },
      }),
    );
    expect(screen.getByText("ai:build.chat.undone")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "ai:build.chat.undo" }),
    ).toBeNull();
  });

  it("offers a question's options and an ambiguous name's candidates", () => {
    const props = show(
      turnOf({
        plan: "question",
        actions: [],
        question: { text: "Which project?", options: ["Web", "Api"] },
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Api" }));
    expect(props.onAnswer).toHaveBeenCalledWith("Api");

    cleanup();
    const ambiguous: BuildAction = {
      id: "a3",
      op: "assign",
      title: "Assign WEB-1 to Mark",
      risk: "write",
      params: { taskId: "t1", userIds: ["Mark"] },
      problem: {
        code: "ambiguous",
        message: '"Mark" matches 2 members',
        field: "userIds",
        value: "Mark",
        candidates: [
          { id: "u-m1", name: "Mark Stone" },
          { id: "u-m2", name: "Mark Lee" },
        ],
      },
    };
    const next = show(turnOf({ actions: [ambiguous] }));
    fireEvent.click(screen.getByRole("button", { name: "Mark Lee" }));
    expect(next.onEdit).toHaveBeenCalledWith(
      "a3",
      expect.objectContaining({
        problem: null,
        params: { taskId: "t1", userIds: ["u-m2"] },
      }),
    );
  });

  it("shows a live agent run card for run_agent results", () => {
    const run: BuildAction = {
      id: "a4",
      op: "run_agent",
      title: "Atlas triages WEB-1",
      risk: "write",
      params: { agentId: "ag-1", taskId: "t1", prompt: "Triage" },
      problem: null,
    };
    show(
      turnOf({
        status: "applied",
        actions: [run],
        results: { a4: { actionId: "a4", ok: true, runId: "run-1" } },
      }),
    );
    const card = screen.getByRole("region", {
      name: "ai:build.chat.agentRun.title",
    });
    expect(card.textContent).toContain("Atlas");
    expect(card.textContent).toContain("ai:agents.status.running");
    expect(card.textContent).toContain("ai:agents.run.viewInDesk");
  });
});

describe("helpers", () => {
  it("willApply skips problems and unticked destructive actions", () => {
    expect(willApply(task, [])).toBe(true);
    expect(willApply(deletion, [])).toBe(false);
    expect(willApply(deletion, ["a2"])).toBe(true);
    expect(
      willApply({ ...task, problem: { code: "forbidden", message: "" } }, []),
    ).toBe(false);
  });

  it("pickCandidate replaces a lead name", () => {
    const project: BuildAction = {
      id: "a1",
      op: "create_project",
      title: "Create",
      risk: "write",
      params: { name: "NX", leadUserId: "Mark" },
      problem: {
        code: "ambiguous",
        message: "",
        field: "leadUserId",
        value: "Mark",
      },
    };
    expect(pickCandidate(project, "u-m1")).toMatchObject({
      problem: null,
      params: { name: "NX", leadUserId: "u-m1" },
    });
  });
});
