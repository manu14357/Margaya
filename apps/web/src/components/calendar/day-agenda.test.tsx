import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CalendarTask } from "./calendar-task-bar";
import DayAgenda from "./day-agenda";

afterEach(() => {
  cleanup();
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options?.title ? `${key}:${String(options.title)}` : key,
  }),
}));

vi.mock("@/lib/format", () => ({
  formatDate: (value: Date, options?: Intl.DateTimeFormatOptions) =>
    value.toLocaleDateString("en-US", options),
  formatDateShort: (value: Date) =>
    value.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
}));

vi.mock("@/lib/i18n/domain", () => ({
  getStatusDisplayLabel: (status: string, name?: string) => name ?? status,
  getPriorityLabel: (priority: string) => `priority ${priority}`,
}));

const DAY = new Date(2026, 10, 19);

const tasks: CalendarTask[] = [
  {
    id: "t1",
    title: "Write launch checklist",
    number: 7,
    status: "to-do",
    priority: "high",
    scheduleStart: DAY,
    scheduleEnd: DAY,
    dueDate: DAY.toISOString(),
    assignees: [{ id: "u1", name: "Mia Moss", image: null }],
  } as CalendarTask,
  {
    id: "t2",
    title: "Plan analytics events",
    number: 8,
    status: "in-progress",
    scheduleStart: new Date(2026, 10, 18),
    scheduleEnd: new Date(2026, 10, 21),
  },
];

const statusNames = new Map([
  ["to-do", "To Do"],
  ["in-progress", "In Progress"],
]);

describe("DayAgenda", () => {
  it("lists the day's tasks with key, status and assignee", () => {
    render(
      <DayAgenda
        day={DAY}
        tasks={tasks}
        projectSlug="WEB"
        statusNames={statusNames}
        onOpenTask={vi.fn()}
      />,
    );
    const first = screen.getByRole("button", {
      name: /Write launch checklist/,
    });
    expect(first).toHaveTextContent("WEB-7");
    expect(first).toHaveTextContent("To Do");
    expect(first).toHaveTextContent("Mia Moss");
    expect(screen.getByRole("img", { name: "priority high" })).toBeVisible();
    expect(
      screen.getByRole("button", { name: /Plan analytics events/ }),
    ).toHaveTextContent("In Progress");
    expect(screen.getByRole("heading", { level: 2 })).toBeInTheDocument();
  });

  it("opens a task from its row", () => {
    const onOpenTask = vi.fn();
    render(<DayAgenda day={DAY} tasks={tasks} onOpenTask={onOpenTask} />);
    fireEvent.click(
      screen.getByRole("button", { name: /Plan analytics events/ }),
    );
    expect(onOpenTask).toHaveBeenCalledWith("t2");
  });

  it("shows an empty state and still offers Add task", () => {
    const onCreateTask = vi.fn();
    render(
      <DayAgenda
        day={DAY}
        tasks={[]}
        onOpenTask={vi.fn()}
        onCreateTask={onCreateTask}
      />,
    );
    expect(screen.getByText("tasks:calendar.touch.empty")).toBeInTheDocument();
    expect(screen.queryByRole("list")).toBeNull();
    const add = screen.getByRole("button", {
      name: "tasks:calendar.touch.addTask",
    });
    fireEvent.click(add);
    expect(onCreateTask).toHaveBeenCalledWith(DAY, add);
  });

  it("offers Move to date only to people who can edit dates", () => {
    const onMoveTask = vi.fn();
    const { rerender } = render(
      <DayAgenda day={DAY} tasks={tasks} onOpenTask={vi.fn()} />,
    );
    expect(
      screen.queryByRole("button", { name: /tasks:calendar.touch.moveTask/ }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "tasks:calendar.touch.addTask" }),
    ).toBeNull();

    rerender(
      <DayAgenda
        day={DAY}
        tasks={tasks}
        onOpenTask={vi.fn()}
        onMoveTask={onMoveTask}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "tasks:calendar.touch.moveTask:Write launch checklist",
      }),
    );
    expect(onMoveTask).toHaveBeenCalledWith(tasks[0]);
  });

  it("shows skeleton rows while loading", () => {
    render(<DayAgenda day={DAY} tasks={[]} isLoading onOpenTask={vi.fn()} />);
    expect(screen.getByText("common:empty.loading")).toBeInTheDocument();
    expect(screen.queryByText("tasks:calendar.touch.empty")).toBeNull();
  });
});
