import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TriageSuggestions as Suggestions } from "@/fetchers/ai/triage";
import type Task from "@/types/task";
import { wantsTriage } from "./task-triage-entry";
import TriageSuggestions from "./triage-suggestions";

const m = vi.hoisted(() => ({
  available: true,
  canTriage: true,
  canUpdate: true,
  canLabel: true,
  data: null as unknown,
  pending: false,
  asked: [] as unknown[],
  applied: [] as Array<[string, unknown]>,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
  }),
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@/hooks/queries/ai/use-ai", () => ({
  useAiAvailability: () => ({ available: m.available }),
}));
vi.mock("@/components/editor/ai/use-editor-ai", () => ({
  useAiLocale: () => "de-DE",
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    isCheckingPermissions: false,
    canTriageIntake: () => m.canTriage,
    canUpdateTasks: () => m.canUpdate,
    canUpdateLabels: () => m.canLabel,
  }),
}));
vi.mock("@/hooks/mutations/ai/use-ai-triage", async () => {
  const React = await import("react");
  return {
    useSuggestTriage: () => {
      const [state, setState] = React.useState<"idle" | "done">("idle");
      return {
        isIdle: state === "idle",
        isPending: m.pending && state === "done",
        isError: false,
        error: null,
        data: state === "done" && !m.pending ? m.data : undefined,
        mutate: (input: unknown) => {
          m.asked.push(input);
          setState("done");
        },
        reset: () => setState("idle"),
      };
    },
  };
});
const { mutation, passThrough } = vi.hoisted(() => ({
  mutation: (name: string) => () => ({
    mutateAsync: async (input: unknown) => {
      m.applied.push([name, input]);
    },
  }),
  passThrough: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/hooks/mutations/label/use-attach-label-to-task", () => ({
  default: mutation("label"),
}));
vi.mock("@/hooks/mutations/task/use-update-task-assignees", () => ({
  useUpdateTaskAssignees: mutation("assignee"),
}));
vi.mock("@/hooks/mutations/task/use-update-task-status-priority", () => ({
  useUpdateTaskPriority: mutation("priority"),
}));
vi.mock("@/hooks/mutations/task/use-move-task", () => ({
  useMoveTask: mutation("move"),
}));
vi.mock("@/hooks/mutations/task-relation/use-create-task-relation", () => ({
  default: mutation("relation"),
}));
vi.mock("@/hooks/mutations/intake/use-triage-intake-item", () => ({
  useTriageIntakeItem: mutation("intake"),
}));
vi.mock("@/hooks/queries/label/use-get-labels-by-task", () => ({
  default: () => ({ data: [], isLoading: false }),
}));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/task/task-labels-popover", () => ({
  default: passThrough,
}));
vi.mock("@/components/task/task-assignee-popover", () => ({
  default: passThrough,
}));
vi.mock("@/components/task/task-priority-popover", () => ({
  default: passThrough,
}));

const task = {
  id: "task-1",
  title: "Login crashes",
  number: 7,
  description: null,
  status: "to-do",
  priority: "no-priority",
  startDate: null,
  dueDate: null,
  position: 0,
  createdAt: "2026-10-21T10:00:00.000Z",
  userId: null,
  assigneeId: null,
  assigneeName: null,
  assigneeIds: [],
  projectId: "project-web",
} satisfies Task;

const suggestions: Suggestions = {
  taskId: "task-1",
  kind: "task",
  labels: [
    {
      labelId: "label-bug",
      name: "bug",
      color: "#4f8a5b",
      reason: "Similar crashes carry it",
      applied: false,
    },
  ],
  assignee: {
    userId: "user-mia",
    name: "Mia",
    image: null,
    reason: "Fixed the last crash",
  },
  priority: { value: "high", reason: "Users can't sign in" },
  project: {
    projectId: "project-api",
    name: "API",
    slug: "api",
    reason: "A server error",
  },
  duplicates: [
    {
      taskId: "task-3",
      projectId: "project-web",
      key: "WEB-3",
      title: "Login crashes on Safari",
      status: "done",
      reason: null,
    },
  ],
  autoApplied: false,
};

beforeEach(() => {
  m.available = true;
  m.canTriage = true;
  m.canUpdate = true;
  m.canLabel = true;
  m.data = suggestions;
  m.pending = false;
  m.asked = [];
  m.applied = [];
});
afterEach(cleanup);

describe("TriageSuggestions", () => {
  it("is hidden while AI is unavailable or the person can't triage", () => {
    m.available = false;
    const { container, rerender } = render(
      <TriageSuggestions task={task} workspaceId="ws" />,
    );
    expect(container).toBeEmptyDOMElement();
    m.available = true;
    m.canUpdate = false;
    rerender(<TriageSuggestions task={task} workspaceId="ws" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("asks only on a click and shows each suggestion with its reason", () => {
    render(<TriageSuggestions task={task} workspaceId="ws" />);
    expect(m.asked).toEqual([]);
    fireEvent.click(screen.getByText("ai:triage.button"));
    expect(m.asked).toEqual([{ taskId: "task-1", locale: "de-DE" }]);
    expect(screen.getByText("bug")).toBeInTheDocument();
    expect(screen.getByText("Similar crashes carry it")).toBeInTheDocument();
    expect(screen.getByText("Mia")).toBeInTheDocument();
    expect(screen.getByText("Users can't sign in")).toBeInTheDocument();
    // A title match without a model reason says so.
    expect(screen.getByText("ai:triage.sameTitle")).toBeInTheDocument();
    expect(m.applied).toEqual([]);
  });

  it("applies one suggestion on Accept and hides one on Dismiss", async () => {
    render(<TriageSuggestions task={task} workspaceId="ws" />);
    fireEvent.click(screen.getByText("ai:triage.button"));
    const accepts = screen.getAllByText("ai:triage.accept");
    fireEvent.click(accepts[0] as HTMLElement);
    await waitFor(() =>
      expect(m.applied).toEqual([
        ["label", { labelId: "label-bug", taskId: "task-1" }],
      ]),
    );
    expect(await screen.findByText("ai:triage.applied")).toBeInTheDocument();

    const dismiss = screen.getAllByLabelText("ai:triage.dismiss");
    fireEvent.click(dismiss[0] as HTMLElement);
    expect(screen.queryByText("Mia")).not.toBeInTheDocument();
  });

  it("accepts labels, assignee and priority together, never a move or duplicate", async () => {
    render(<TriageSuggestions task={task} workspaceId="ws" />);
    fireEvent.click(screen.getByText("ai:triage.button"));
    fireEvent.click(screen.getByText("ai:triage.acceptAll"));
    await waitFor(() => expect(m.applied).toHaveLength(3));
    expect(m.applied.map(([name]) => name)).toEqual([
      "label",
      "assignee",
      "priority",
    ]);
  });

  it("keeps a request's project suggestion as advice", () => {
    render(
      <TriageSuggestions task={task} workspaceId="ws" intakeItemId="item-1" />,
    );
    fireEvent.click(screen.getByText("ai:triage.button"));
    expect(screen.getByText("ai:triage.projectAdvice")).toBeInTheDocument();
  });
});

describe("wantsTriage", () => {
  const now = Date.parse("2026-10-21T12:00:00.000Z");
  it("offers triage for unlabelled or new tasks only", () => {
    expect(wantsTriage({ createdAt: "2026-01-01T00:00:00.000Z" }, 0, now)).toBe(
      true,
    );
    expect(wantsTriage({ createdAt: "2026-10-21T00:00:00.000Z" }, 2, now)).toBe(
      true,
    );
    expect(wantsTriage({ createdAt: "2026-01-01T00:00:00.000Z" }, 2, now)).toBe(
      false,
    );
  });
});
