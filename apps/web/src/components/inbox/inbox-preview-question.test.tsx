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
import InboxPreview from "./inbox-preview";
import { inboxNotification } from "./inbox-test-fixtures";

// The real answer card, panel and hooks; only the API calls are stubbed.
const api = vi.hoisted(() => ({
  getAgentRun: vi.fn(),
  replyToAgentRun: vi.fn(),
}));

vi.mock("@/fetchers/ai/agents", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/fetchers/ai/agents")>()),
  getAgentRun: api.getAgentRun,
  replyToAgentRun: api.replyToAgentRun,
}));
vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children?: ReactNode }) => (
    <a href="/agents">{children}</a>
  ),
}));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// The task preview's parts: not rendered for a notice.
vi.mock("@/hooks/queries/task/use-get-task", () => ({ default: vi.fn() }));
vi.mock("@/hooks/use-project-websocket", () => ({
  useProjectWebSocket: vi.fn(),
}));
vi.mock("@/hooks/mutations/recent-visit/use-record-visit", () => ({
  useRecordVisit: vi.fn(),
  visitArchiveState: vi.fn(),
}));
vi.mock("@/components/ai/agents/approval-card", () => ({
  ApprovalCard: () => null,
}));
vi.mock("@/components/task/task-details-content", () => ({
  default: () => null,
}));
vi.mock("@/components/task/task-page-skeleton", () => ({
  TaskDetailsSkeleton: () => null,
}));
vi.mock("@/components/task/task-properties-sidebar", () => ({
  default: () => null,
}));
vi.mock("@/components/task/task-subscribe-button", () => ({
  default: () => null,
}));

const QUESTION = "Which project should the weekly standup cover?";
const OPTIONS = ["Website Relaunch", "Mobile app"];

// An agent's question from a run without a task (a scheduled standup).
const question = inboxNotification({
  type: "ai_agent_reply",
  task: null,
  resourceType: "workspace",
  resourceId: "ws",
  actor: { id: "agent-1", name: "Standup", image: null },
  actorId: "agent-1",
  title: "Standup has a question",
  content: QUESTION,
  eventData: {
    runId: "run-q",
    agentName: "Standup",
    needsInput: true,
    options: OPTIONS,
  },
});

function renderPreview() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <InboxPreview
        notification={question}
        workspaceId="ws"
        onAction={vi.fn()}
        onClose={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api.getAgentRun.mockResolvedValue({
    id: "run-q",
    status: "needs_input",
    question: { text: QUESTION, options: OPTIONS },
  });
  api.replyToAgentRun.mockResolvedValue({ id: "run-q", status: "running" });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("InboxPreview: an agent's question without a task", () => {
  it("is answered with a suggested option right in the preview", async () => {
    renderPreview();
    const option = await screen.findByRole("button", { name: OPTIONS[0] });
    expect(api.getAgentRun).toHaveBeenCalledWith("ws", "run-q");

    // Once answered, the run moves on and the question stops waiting.
    api.getAgentRun.mockResolvedValue({
      id: "run-q",
      status: "running",
      question: null,
    });
    fireEvent.click(option);
    await waitFor(() =>
      expect(api.replyToAgentRun.mock.calls[0]?.[0]).toEqual({
        workspaceId: "ws",
        runId: "run-q",
        text: OPTIONS[0],
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: OPTIONS[0] })).toBeNull(),
    );
    expect(screen.getByText(QUESTION)).toBeInTheDocument();
  });

  it("is answered in free text right in the preview", async () => {
    renderPreview();
    fireEvent.change(
      await screen.findByLabelText("ai:agents.needsInput.answerLabel"),
      { target: { value: "Both, please" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: /ai:agents\.needsInput\.reply/ }),
    );
    await waitFor(() =>
      expect(api.replyToAgentRun.mock.calls[0]?.[0]).toEqual({
        workspaceId: "ws",
        runId: "run-q",
        text: "Both, please",
      }),
    );
  });

  it("points to the Agent Desk once the run no longer waits", async () => {
    api.getAgentRun.mockResolvedValue({
      id: "run-q",
      status: "succeeded",
      question: null,
    });
    renderPreview();
    expect(
      await screen.findByText("ai:agents.run.viewInDesk"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: OPTIONS[0] })).toBeNull();
  });
});
