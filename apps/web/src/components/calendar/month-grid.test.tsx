import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CalendarTask } from "./calendar-task-bar";
import MonthGrid from "./month-grid";
import { buildMonthWeeks, buildWeekDays } from "./month-grid-model";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options?.date ? `${key}:${String(options.date)}` : key,
  }),
}));

vi.mock("@/lib/format", () => ({
  formatDate: (value: Date, options?: Intl.DateTimeFormatOptions) =>
    options?.weekday === "short"
      ? value.toLocaleDateString("en-US", { weekday: "short" })
      : `${value.getFullYear()}-${value.getMonth() + 1}-${value.getDate()}`,
  formatDateShort: (value: Date) => value.toDateString(),
}));

const WEDNESDAY = new Date(2026, 9, 14);

const tasks: CalendarTask[] = [
  {
    id: "weekday",
    title: "Weekday task",
    number: 1,
    status: "to-do",
    scheduleStart: WEDNESDAY,
    scheduleEnd: WEDNESDAY,
  },
  {
    id: "weekend",
    title: "Weekend task",
    number: 2,
    status: "to-do",
    // Saturday.
    scheduleStart: new Date(2026, 9, 17),
    scheduleEnd: new Date(2026, 9, 17),
  },
];

function headers(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll(".sticky > div"),
    (cell) => cell.textContent,
  );
}

describe("MonthGrid display choices", () => {
  it("shows every day by default and drops weekends when asked", () => {
    const week = [buildWeekDays(WEDNESDAY, 1)];
    const { container, rerender } = render(
      <MonthGrid
        weeks={week}
        tasks={tasks}
        maxLanes={3}
        onOpenTask={vi.fn()}
      />,
    );
    expect(headers(container)).toHaveLength(7);
    expect(screen.getByText("Weekend task")).toBeInTheDocument();

    rerender(
      <MonthGrid
        weeks={week}
        tasks={tasks}
        maxLanes={3}
        onOpenTask={vi.fn()}
        showWeekends={false}
      />,
    );
    expect(headers(container)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri"]);
    expect(screen.getByText("Weekday task")).toBeInTheDocument();
    expect(screen.queryByText("Weekend task")).toBeNull();
  });

  it("follows the week-start preference", () => {
    const { container } = render(
      <MonthGrid
        weeks={[buildWeekDays(WEDNESDAY, 0)]}
        tasks={[]}
        maxLanes={3}
        onOpenTask={vi.fn()}
      />,
    );
    expect(headers(container)[0]).toBe("Sun");
  });

  it("offers a create button per day only to people who can create", () => {
    const onCreateTask = vi.fn();
    const weeks = buildMonthWeeks(WEDNESDAY, 1);
    const { rerender } = render(
      <MonthGrid
        weeks={weeks}
        tasks={[]}
        visibleMonth={WEDNESDAY}
        maxLanes={3}
        onOpenTask={vi.fn()}
        onCreateTask={onCreateTask}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "tasks:calendar.addTaskOn:2026-10-14",
      }),
    );
    expect(onCreateTask).toHaveBeenCalledWith(WEDNESDAY);

    rerender(
      <MonthGrid
        weeks={weeks}
        tasks={[]}
        visibleMonth={WEDNESDAY}
        maxLanes={3}
        onOpenTask={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /tasks:calendar.addTaskOn/ }),
    ).toBeNull();
  });

  it("makes bars draggable only for people who can edit dates", () => {
    const week = [buildWeekDays(WEDNESDAY, 1)];
    const { rerender } = render(
      <MonthGrid
        weeks={week}
        tasks={tasks}
        maxLanes={3}
        onOpenTask={vi.fn()}
        onReschedule={vi.fn()}
      />,
    );
    expect(
      screen.getAllByRole("button", { name: "tasks:calendar.taskAriaLabel" }),
    ).toHaveLength(2);
    for (const element of screen.getAllByRole("button", {
      name: "tasks:calendar.taskAriaLabel",
    })) {
      expect(element).not.toHaveClass("cursor-grab");
    }

    rerender(
      <MonthGrid
        weeks={week}
        tasks={tasks}
        maxLanes={3}
        onOpenTask={vi.fn()}
        onReschedule={vi.fn()}
        canEditDates
      />,
    );
    for (const element of screen.getAllByRole("button", {
      name: "tasks:calendar.taskAriaLabel",
    })) {
      expect(element).toHaveClass("cursor-grab");
    }
  });
});
