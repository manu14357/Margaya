import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Task from "@/types/task";
import TaskTimeTracking from "./task-time-tracking";

const m = vi.hoisted(() => ({
  mutate: vi.fn(),
  update: vi.fn(),
  stop: vi.fn(),
  running: null as Record<string, unknown> | null,
  failed: false,
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
  default: () => ({
    data: m.failed ? undefined : m.entries,
    isLoading: false,
    isError: m.failed,
  }),
}));
vi.mock("@/hooks/mutations/time-entry/use-create-time-entry", () => ({
  default: () => ({ mutate: m.mutate, isPending: false }),
}));
vi.mock("@/hooks/mutations/time-entry/use-delete-time-entry", () => ({
  default: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/mutations/time-entry/use-update-time-entry", () => ({
  default: () => ({ mutate: m.update, isPending: false }),
}));
vi.mock("@/hooks/mutations/time-entry/use-stop-time-entry", () => ({
  default: () => ({ mutate: m.stop, isPending: false }),
}));
vi.mock("@/hooks/queries/time-entry/use-get-running-time-entry", () => ({
  default: () => ({ data: { entry: m.running }, isLoading: false }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => (
    <a href="/task">{children}</a>
  ),
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
  m.running = null;
  m.failed = false;
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
    expect(
      own &&
        within(own).getByRole("button", {
          name: /tasks:timeTracking.deleteEntry/,
        }),
    ).toBeInTheDocument();
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

  describe("the timer", () => {
    const openPopover = () =>
      fireEvent.click(screen.getByRole("button", { name: /timeTracking/ }));
    const timer = (taskId: string) => ({
      id: "running-1",
      taskId,
      startTime: "2026-09-01T09:00:00.000Z",
      taskTitle: "Other task",
      taskNumber: 12,
      projectId: "p2",
      projectSlug: "web",
    });

    it("starts a running entry with no end", () => {
      renderRow();
      openPopover();
      fireEvent.click(
        screen.getByRole("button", { name: "tasks:timeTracking.startTimer" }),
      );

      expect(m.mutate).toHaveBeenCalledTimes(1);
      const [entry] = m.mutate.mock.calls[0];
      expect(entry.taskId).toBe("t1");
      expect(entry.endTime).toBeUndefined();
    });

    it("offers stop, and no start, while it runs on this task", () => {
      m.running = timer("t1");
      m.entries = [
        {
          id: "running-1",
          userId: "me",
          userName: "Me",
          duration: null,
          endTime: null,
          startTime: "2026-09-01T09:00:00.000Z",
          description: null,
        },
      ];
      renderRow();
      fireEvent.click(
        screen.getByRole("button", { name: "tasks:timeTracking.timerRunning" }),
      );

      expect(
        screen.queryByRole("button", { name: /startTimer|startHere/ }),
      ).not.toBeInTheDocument();
      fireEvent.click(
        screen.getByRole("button", { name: "tasks:timeTracking.stopTimer" }),
      );
      expect(m.stop.mock.calls[0][0]).toEqual({
        id: "running-1",
        taskId: "t1",
      });
    });

    it("names a timer on another task and says starting here stops it", () => {
      m.running = timer("t2");
      renderRow();
      openPopover();

      expect(screen.getByRole("link")).toHaveTextContent(
        'tasks:timeTracking.timerRunningOn {"task":"WEB-12"}',
      );
      fireEvent.click(
        screen.getByRole("button", { name: "tasks:timeTracking.startHere" }),
      );
      expect(m.mutate).toHaveBeenCalledTimes(1);
    });

    it("hides start and stop from someone who can't log time", () => {
      m.canUpdate = false;
      m.running = timer("t2");
      renderRow();
      openPopover();

      expect(
        screen.queryByRole("button", {
          name: /startTimer|startHere|stopTimer/,
        }),
      ).not.toBeInTheDocument();
    });
  });

  describe("editing an entry", () => {
    const finished = {
      id: "mine",
      userId: "me",
      userName: "Me",
      duration: 3600,
      startTime: "2026-09-01T09:00:30.000Z",
      endTime: "2026-09-01T10:00:30.000Z",
      description: "Review",
    };
    const openForm = () => {
      renderRow();
      fireEvent.click(
        screen.getByRole("button", { name: /tasks:timeTracking.spentAria/ }),
      );
      fireEvent.click(
        screen.getByRole("button", { name: /tasks:timeTracking.editEntry/ }),
      );
    };

    it("offers edit only where delete is offered", () => {
      m.entries = [finished, { ...finished, id: "theirs", userId: "sam" }];
      renderRow();
      fireEvent.click(
        screen.getByRole("button", { name: /tasks:timeTracking.spentAria/ }),
      );

      expect(
        screen.getAllByRole("button", { name: /tasks:timeTracking.editEntry/ }),
      ).toHaveLength(1);
    });

    it("sends a changed note and keeps the untouched times to the second", () => {
      m.entries = [finished];
      openForm();
      const form = screen
        .getByLabelText("tasks:timeTracking.editStart")
        .closest("form") as HTMLFormElement;
      fireEvent.change(within(form).getByLabelText("tasks:timeTracking.note"), {
        target: { value: "  Pairing  " },
      });
      fireEvent.click(
        within(form).getByRole("button", {
          name: "tasks:timeTracking.editSave",
        }),
      );

      expect(m.update.mock.calls[0][0]).toEqual({
        id: "mine",
        startTime: finished.startTime,
        endTime: finished.endTime,
        description: "Pairing",
      });
    });

    it("refuses an end before the start, and sends nothing", () => {
      m.entries = [finished];
      openForm();
      const end = screen.getByLabelText("tasks:timeTracking.editEnd");
      fireEvent.change(end, { target: { value: "2020-01-01T00:00" } });
      fireEvent.click(
        screen.getByRole("button", { name: "tasks:timeTracking.editSave" }),
      );

      expect(m.update).not.toHaveBeenCalled();
      expect(end).toHaveAttribute("aria-invalid", "true");
      expect(
        screen.getByText("tasks:timeTracking.editEndBeforeStart"),
      ).toBeInTheDocument();
    });

    it("won't reopen a finished entry", () => {
      m.entries = [finished];
      openForm();
      fireEvent.change(screen.getByLabelText("tasks:timeTracking.editEnd"), {
        target: { value: "" },
      });
      fireEvent.click(
        screen.getByRole("button", { name: "tasks:timeTracking.editSave" }),
      );

      expect(m.update).not.toHaveBeenCalled();
      expect(
        screen.getByText("tasks:timeTracking.editEndRequired"),
      ).toBeInTheDocument();
    });

    it("lets a running entry stay open with a new start", () => {
      m.entries = [{ ...finished, endTime: null, duration: null }];
      renderRow();
      fireEvent.click(
        screen.getByRole("button", { name: "tasks:timeTracking.timerRunning" }),
      );
      fireEvent.click(
        screen.getByRole("button", { name: /tasks:timeTracking.editEntry/ }),
      );
      fireEvent.change(screen.getByLabelText("tasks:timeTracking.editStart"), {
        target: { value: "2026-09-01T08:00" },
      });
      fireEvent.click(
        screen.getByRole("button", { name: "tasks:timeTracking.editSave" }),
      );

      const [sent] = m.update.mock.calls[0];
      expect(sent.endTime).toBeUndefined();
      expect(sent.startTime).toBe(new Date("2026-09-01T08:00").toISOString());
    });
  });

  it("says when the entries failed to load instead of showing none", () => {
    m.failed = true;
    renderRow();
    fireEvent.click(
      screen.getByRole("button", { name: "tasks:timeTracking.logTime" }),
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "tasks:timeTracking.loadError",
    );
    expect(screen.queryByText("tasks:timeTracking.empty")).toBeNull();
  });
});
