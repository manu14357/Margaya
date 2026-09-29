import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Task from "@/types/task";
import TaskTimeTracking from "./task-time-tracking";

const m = vi.hoisted(() => ({
  mutate: vi.fn(),
  canUpdate: true,
  canDelete: false,
  entries: [] as Array<Record<string, unknown>>,
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
    i18n: { resolvedLanguage: "en-US" },
  }),
}));
vi.mock("@/hooks/queries/time-entry/use-get-time-entries", () => ({
  default: () => ({ data: m.entries, isLoading: false }),
}));
vi.mock("@/hooks/mutations/time-entry/use-create-time-entry", () => ({
  default: () => ({ mutate: m.mutate, isPending: false }),
}));
vi.mock("@/hooks/mutations/time-entry/use-delete-time-entry", () => ({
  default: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canUpdateTasks: () => m.canUpdate,
    canDeleteTasks: () => m.canDelete,
  }),
}));
vi.mock("@/components/providers/auth-provider/hooks/use-auth", () => ({
  useAuth: () => ({ user: { id: "me" } }),
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const task = { id: "t1", projectId: "p1" } as Task;

function renderRow() {
  render(
    <TaskTimeTracking
      task={task}
      layout="stack"
      projectId="p1"
      workspaceId="w1"
    />,
  );
}

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  m.canUpdate = true;
  m.canDelete = false;
  m.entries = [];
});

describe("TaskTimeTracking", () => {
  it("logs a typed duration that ends now, with its note", () => {
    renderRow();
    fireEvent.click(
      screen.getByRole("button", { name: "tasks:timeTracking.logTime" }),
    );
    fireEvent.change(screen.getByLabelText("tasks:timeTracking.duration"), {
      target: { value: "1h 30m" },
    });
    fireEvent.change(screen.getByLabelText("tasks:timeTracking.note"), {
      target: { value: "Review" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "tasks:timeTracking.submit" }),
    );

    expect(m.mutate).toHaveBeenCalledTimes(1);
    const [entry] = m.mutate.mock.calls[0];
    expect(entry).toMatchObject({ taskId: "t1", description: "Review" });
    expect(Date.parse(entry.endTime) - Date.parse(entry.startTime)).toBe(
      5_400_000,
    );
  });

  it("explains a duration it can't read and sends nothing", () => {
    renderRow();
    fireEvent.click(
      screen.getByRole("button", { name: "tasks:timeTracking.logTime" }),
    );
    const input = screen.getByLabelText("tasks:timeTracking.duration");
    fireEvent.change(input, { target: { value: "soon" } });
    fireEvent.click(
      screen.getByRole("button", { name: "tasks:timeTracking.submit" }),
    );

    expect(m.mutate).not.toHaveBeenCalled();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(
      screen.getByText("tasks:timeTracking.durationInvalid"),
    ).toBeInTheDocument();
  });

  it("shows the total and each entry, read-only without task:update", () => {
    m.canUpdate = false;
    m.entries = [
      {
        id: "e1",
        userName: "Mia Member",
        duration: 5400,
        startTime: "2026-09-01T09:00:00.000Z",
        description: "Review",
      },
      {
        id: "e2",
        userName: null,
        duration: null,
        startTime: "2026-09-02T09:00:00.000Z",
        description: null,
      },
    ];
    renderRow();
    const trigger = screen.getByRole("button", {
      name: /tasks:timeTracking.spentAria/,
    });
    expect(trigger).toHaveTextContent('{"hours":1,"minutes":30}');
    fireEvent.click(trigger);

    const list = screen.getByRole("list", {
      name: "tasks:timeTracking.entries",
    });
    expect(within(list).getByText("Mia Member")).toBeInTheDocument();
    expect(
      within(list).getByText("tasks:timeTracking.formerMember"),
    ).toBeInTheDocument();
    expect(
      within(list).getByText("tasks:timeTracking.running"),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText("tasks:timeTracking.duration"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /tasks:timeTracking.deleteEntry/ }),
    ).not.toBeInTheDocument();
  });

  const twoEntries = () => [
    {
      id: "mine",
      userId: "me",
      userName: "Me",
      duration: 60,
      startTime: "2026-09-01T09:00:00.000Z",
      description: null,
    },
    {
      id: "theirs",
      userId: "someone-else",
      userName: "Sam",
      duration: 60,
      startTime: "2026-09-02T09:00:00.000Z",
      description: null,
    },
  ];
  const deleteButtons = () =>
    screen.queryAllByRole("button", { name: /tasks:timeTracking.deleteEntry/ });

  it("offers delete on the caller's own entries only", () => {
    m.entries = twoEntries();
    renderRow();
    fireEvent.click(
      screen.getByRole("button", { name: /tasks:timeTracking.spentAria/ }),
    );

    expect(deleteButtons()).toHaveLength(1);
    const own = screen.getByText("Me").closest("li");
    expect(own && within(own).getByRole("button")).toBeInTheDocument();
  });

  it("offers delete on every entry to someone who may delete tasks", () => {
    m.canDelete = true;
    m.entries = twoEntries();
    renderRow();
    fireEvent.click(
      screen.getByRole("button", { name: /tasks:timeTracking.spentAria/ }),
    );

    expect(deleteButtons()).toHaveLength(2);
  });
});
