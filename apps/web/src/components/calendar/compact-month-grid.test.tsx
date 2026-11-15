import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CalendarTask } from "./calendar-task-bar";
import CompactMonthGrid from "./compact-month-grid";
import { groupTasksByDay } from "./compact-month-model";
import { buildMonthWeeks, buildWeekDays } from "./month-grid-model";

afterEach(() => {
  cleanup();
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options
        ? `${key}(${Object.entries(options)
            .map(([name, value]) => `${name}=${String(value)}`)
            .join(",")})`
        : key,
  }),
}));

vi.mock("@/lib/format", () => ({
  formatDate: (value: Date, options?: Intl.DateTimeFormatOptions) =>
    value.toLocaleDateString("en-US", options),
}));

const MONTH = new Date(2026, 10, 1);
const THURSDAY = new Date(2026, 10, 19);

function dated(id: string, status: string, day = THURSDAY): CalendarTask {
  return {
    id,
    title: `Task ${id}`,
    number: 1,
    status,
    scheduleStart: day,
    scheduleEnd: day,
  };
}

const tasks = [
  dated("a", "to-do"),
  dated("b", "in-progress"),
  dated("c", "in-review"),
  dated("d", "done"),
  dated("e", "to-do"),
];

function renderGrid(selectedDay = THURSDAY, onSelectDay = vi.fn()) {
  const weeks = buildMonthWeeks(MONTH, 1);
  const tasksByDay = groupTasksByDay(weeks.flat(), tasks);
  render(
    <CompactMonthGrid
      weeks={weeks}
      visibleMonth={MONTH}
      tasksByDay={tasksByDay}
      selectedDay={selectedDay}
      onSelectDay={onSelectDay}
    />,
  );
  return onSelectDay;
}

describe("CompactMonthGrid", () => {
  it("names each day with its date and task count", () => {
    renderGrid();
    expect(
      screen.getByRole("button", {
        name: "tasks:calendar.touch.dayLabel(date=Thursday, November 19,count=5)",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "tasks:calendar.touch.dayLabelEmpty(date=Friday, November 20)",
      }),
    ).toBeInTheDocument();
  });

  it("shows at most three markers plus the count, never colour alone", () => {
    renderGrid();
    const thursday = document.querySelector('[data-calendar-day="2026-11-19"]');
    expect(thursday?.querySelectorAll("[data-day-marker]")).toHaveLength(3);
    expect(thursday?.querySelector("[data-day-count]")?.textContent).toBe("5");
    const friday = document.querySelector('[data-calendar-day="2026-11-20"]');
    expect(friday?.querySelector("[data-day-count]")).toBeNull();
  });

  it("marks the selected day and keeps only it in the tab order", () => {
    renderGrid();
    const selected = document.querySelector<HTMLButtonElement>(
      '[data-calendar-day="2026-11-19"]',
    );
    expect(selected).toHaveAttribute("aria-pressed", "true");
    expect(selected).toHaveAttribute("tabindex", "0");
    const other = document.querySelector('[data-calendar-day="2026-11-18"]');
    expect(other).toHaveAttribute("aria-pressed", "false");
    expect(other).toHaveAttribute("tabindex", "-1");
  });

  it("selects a tapped day, including one from the next month", () => {
    const onSelectDay = renderGrid();
    fireEvent.click(
      screen.getByRole("button", {
        name: "tasks:calendar.touch.dayLabelEmpty(date=Friday, November 20)",
      }),
    );
    expect(onSelectDay.mock.calls[0][0].getDate()).toBe(20);

    fireEvent.click(
      document.querySelector('[data-calendar-day="2026-12-03"]') as Element,
    );
    expect(onSelectDay.mock.calls[1][0].getMonth()).toBe(11);
  });

  it("moves the selection with the arrow keys", () => {
    const onSelectDay = renderGrid();
    const selected = document.querySelector(
      '[data-calendar-day="2026-11-19"]',
    ) as Element;
    fireEvent.keyDown(selected, { key: "ArrowRight" });
    fireEvent.keyDown(selected, { key: "ArrowDown" });
    fireEvent.keyDown(selected, { key: "Home" });
    expect(
      onSelectDay.mock.calls.map(([day]) => (day as Date).getDate()),
    ).toEqual([20, 26, 16]);
  });

  it("marks today for assistive technology", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 17, 9));
    renderGrid();
    expect(
      document.querySelector('[data-calendar-day="2026-11-17"]'),
    ).toHaveAttribute("aria-current", "date");
    expect(
      document.querySelector('[data-calendar-day="2026-11-18"]'),
    ).not.toHaveAttribute("aria-current");
    vi.useRealTimers();
  });
});

describe("CompactMonthGrid as a week strip", () => {
  // Monday November 16 to Sunday November 22, 2026.
  const week = buildWeekDays(THURSDAY, 1);
  const weekTasks = [...tasks, dated("next", "to-do", new Date(2026, 10, 23))];

  function renderStrip(onSelectDay = vi.fn(), showWeekends = true) {
    render(
      <CompactMonthGrid
        weeks={[week]}
        tasksByDay={groupTasksByDay(week, weekTasks)}
        selectedDay={THURSDAY}
        onSelectDay={onSelectDay}
        showWeekends={showWeekends}
      />,
    );
    return onSelectDay;
  }

  const dayKeys = () =>
    Array.from(document.querySelectorAll("[data-calendar-day]")).map((day) =>
      day.getAttribute("data-calendar-day"),
    );

  it("shows the seven days as one row named by the week's range", () => {
    renderStrip();
    expect(dayKeys()).toEqual([
      "2026-11-16",
      "2026-11-17",
      "2026-11-18",
      "2026-11-19",
      "2026-11-20",
      "2026-11-21",
      "2026-11-22",
    ]);
    expect(
      screen.getByRole("group", {
        name: "tasks:calendar.touch.weekDaysLabel(start=November 16,end=November 22, 2026)",
      }),
    ).toBeInTheDocument();
    expect(
      document.querySelector("[data-calendar-region=compact-week]"),
    ).not.toBeNull();
    // Every day is in the period: none is shaded as outside it.
    for (const day of document.querySelectorAll("[data-calendar-day]")) {
      expect(day.className).not.toContain("bg-muted/50");
    }
  });

  it("names, marks and selects days as the month cells do", () => {
    const onSelectDay = renderStrip();
    const thursday = screen.getByRole("button", {
      name: "tasks:calendar.touch.dayLabel(date=Thursday, November 19,count=5)",
    });
    expect(thursday).toHaveAttribute("aria-pressed", "true");
    expect(thursday).toHaveAttribute("tabindex", "0");
    expect(thursday.querySelectorAll("[data-day-marker]")).toHaveLength(3);
    expect(thursday.querySelector("[data-day-count]")?.textContent).toBe("5");

    const friday = screen.getByRole("button", {
      name: "tasks:calendar.touch.dayLabelEmpty(date=Friday, November 20)",
    });
    expect(friday).toHaveAttribute("aria-pressed", "false");
    expect(friday).toHaveAttribute("tabindex", "-1");
    fireEvent.click(friday);
    expect(onSelectDay.mock.calls[0][0].getDate()).toBe(20);
  });

  it("moves along the strip with the arrow keys, Home and End", () => {
    const onSelectDay = renderStrip();
    const selected = document.querySelector(
      '[data-calendar-day="2026-11-19"]',
    ) as Element;
    fireEvent.keyDown(selected, { key: "ArrowLeft" });
    fireEvent.keyDown(selected, { key: "ArrowRight" });
    fireEvent.keyDown(selected, { key: "Home" });
    fireEvent.keyDown(selected, { key: "End" });
    // One row: up and down have nowhere to go.
    fireEvent.keyDown(selected, { key: "ArrowDown" });
    fireEvent.keyDown(selected, { key: "ArrowUp" });
    expect(
      onSelectDay.mock.calls.map(([day]) => (day as Date).getDate()),
    ).toEqual([18, 20, 16, 22]);
  });

  it("leaves the weekend out when weekends are hidden", () => {
    const onSelectDay = renderStrip(vi.fn(), false);
    expect(dayKeys()).toEqual([
      "2026-11-16",
      "2026-11-17",
      "2026-11-18",
      "2026-11-19",
      "2026-11-20",
    ]);
    fireEvent.keyDown(
      document.querySelector('[data-calendar-day="2026-11-19"]') as Element,
      { key: "End" },
    );
    expect(onSelectDay.mock.calls[0][0].getDate()).toBe(20);
  });
});
