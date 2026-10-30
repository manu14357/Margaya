import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentItemShownAbove, TaskAgentWaiting } from "./task-agent-waiting";

const m = vi.hoisted(() => ({
  user: { id: "me" } as { id: string } | null,
  canUse: true,
  runs: {} as Record<string, unknown[]>,
  approvals: [] as unknown[],
  getAgentRuns: vi.fn(),
  getAgentApprovals: vi.fn(),
  replyToAgentRun: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  useTranslation: () => ({
    t: (key: string, options?: { agentName?: string }) =>
      options?.agentName ? `${key}:${options.agentName}` : key,
  }),
}));
vi.mock("@/components/providers/auth-provider/hooks/use-auth", () => ({
  default: () => ({ user: m.user }),
}));
vi.mock("@/hooks/queries/ai/use-ai", () => ({
  useAiAvailability: () => ({ canUse: m.canUse }),
}));
vi.mock("@/fetchers/ai/agents", () => ({
  getAgentRuns: m.getAgentRuns,
  getAgentApprovals: m.getAgentApprovals,
  replyToAgentRun: m.replyToAgentRun,
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
// The approval card has its own tests; here it only marks what is shown.
vi.mock("./approval-card", () => ({
  ApprovalCard: ({ approvalId }: { approvalId: string }) => (
    <div data-testid="approval">{approvalId}</div>
  ),
}));

function run(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    status: "needs_input",
    agent: { id: "agent-1", userId: "agent-user", name: "Spec writer" },
    principal: { id: "me", name: "Me" },
    task: { id: "task-1", projectId: "p-1", key: "WEB-7", title: "Spec" },
    question: {
      text: "Which release should this go in?",
      options: ["2.4", "2.5"],
    },
    ...overrides,
  };
}

function renderCard(wrap?: (node: ReactNode) => ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const card = (
    <TaskAgentWaiting workspaceId="ws-1" projectId="p-1" taskId="task-1" />
  );
  render(
    <QueryClientProvider client={queryClient}>
      {wrap ? wrap(card) : card}
    </QueryClientProvider>,
  );
  return { invalidate };
}

beforeEach(() => {
  m.user = { id: "me" };
  m.canUse = true;
  m.runs = {};
  m.approvals = [];
  m.getAgentRuns.mockImplementation(
    async (input: { status: string }) => m.runs[input.status] ?? [],
  );
  m.getAgentApprovals.mockImplementation(async () => m.approvals);
  m.replyToAgentRun.mockResolvedValue({ id: "run-1", status: "queued" });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TaskAgentWaiting", () => {
  it("shows the agent's question on this task with its options", async () => {
    m.runs.needs_input = [run()];
    renderCard();
    expect(
      await screen.findByText("Which release should this go in?"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("ai:agents.needsInput.notificationTitle:Spec writer"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2.4" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2.5" })).toBeInTheDocument();
    expect(
      screen.getByLabelText("ai:agents.needsInput.answerLabel"),
    ).toBeInTheDocument();
    expect(m.getAgentRuns).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      taskId: "task-1",
      status: "needs_input",
    });
  });

  it("answers in one click and refreshes the runs", async () => {
    m.runs.needs_input = [run()];
    const { invalidate } = renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "2.5" }));
    await waitFor(() =>
      expect(m.replyToAgentRun).toHaveBeenCalledWith(
        { workspaceId: "ws-1", runId: "run-1", text: "2.5" },
        expect.anything(),
      ),
    );
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: ["ai-runs", "ws-1"],
      }),
    );
  });

  it("leaves out other people's runs and runs on other tasks", async () => {
    m.runs.needs_input = [
      run({
        id: "run-2",
        principal: { id: "someone-else", name: "Ana" },
        // A manager sees that the run waits, not what it asked.
        question: null,
      }),
      run({
        id: "run-3",
        principal: { id: "someone-else", name: "Ana" },
        question: { text: "Not for me", options: [] },
      }),
      run({
        id: "run-4",
        task: { id: "task-9", projectId: "p-1", key: "WEB-9", title: "x" },
        question: { text: "Another task", options: [] },
      }),
    ];
    renderCard();
    await waitFor(() => expect(m.getAgentRuns).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("Not for me")).not.toBeInTheDocument();
    expect(screen.queryByText("Another task")).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("ai:agents.needsInput.answerLabel"),
    ).not.toBeInTheDocument();
  });

  it("shows nothing without ai:use", async () => {
    m.canUse = false;
    m.runs.needs_input = [run()];
    renderCard();
    expect(m.getAgentRuns).not.toHaveBeenCalled();
    expect(screen.queryByText("Which release should this go in?")).toBeNull();
  });

  it("shows the person's pending approvals of runs on this task", async () => {
    m.runs.awaiting_approval = [
      run({ id: "run-5", status: "awaiting_approval", question: null }),
      run({
        id: "run-6",
        status: "awaiting_approval",
        question: null,
        principal: { id: "someone-else", name: "Ana" },
      }),
    ];
    m.approvals = [
      { id: "ap-1", runId: "run-5" },
      // A run on another task.
      { id: "ap-2", runId: "run-elsewhere" },
    ];
    renderCard();
    expect(await screen.findByTestId("approval")).toHaveTextContent("ap-1");
    expect(screen.getAllByTestId("approval")).toHaveLength(1);
  });

  it("skips what the inbox already shows above the task", async () => {
    m.runs.needs_input = [run()];
    m.runs.awaiting_approval = [
      run({ id: "run-5", status: "awaiting_approval", question: null }),
    ];
    m.approvals = [{ id: "ap-1", runId: "run-5" }];
    renderCard((node) => (
      <AgentItemShownAbove.Provider
        value={{ runId: "run-1", approvalId: "ap-1" }}
      >
        {node}
      </AgentItemShownAbove.Provider>
    ));
    await waitFor(() => expect(m.getAgentApprovals).toHaveBeenCalled());
    expect(screen.queryByText("Which release should this go in?")).toBeNull();
    expect(screen.queryByTestId("approval")).toBeNull();
  });
});
