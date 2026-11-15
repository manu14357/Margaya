import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toTaskDateValue } from "@/lib/schedule-dates";
import { useScheduleViewPreferences } from "@/store/schedule-view-preferences";
import type { ProjectWithTasks } from "@/types/project";
import ProjectCalendar from "./project-calendar";

const state = vi.hoisted(() => ({
  coarse: false,
  narrow: false,
  mutate: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options?.title
        ? `${key}:${String(options.title)}`
        : options?.date
          ? `${key}:${String(options.date)}`
          : key,
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
  getPriorityLabel: (priority: string) => priority,
}));

vi.mock("@/lib/i18n", () => ({ i18n: { t: (key: string) => key } }));

vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/hooks/queries/column/use-get-columns", () => ({
  useGetColumns: () => ({ data: [] }),
}));

vi.mock("@/hooks/mutations/task/use-update-task-dates", () => ({
  useUpdateTaskDates: () => ({ mutate: state.mutate }),
}));

vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canUpdateTasks: () => true,
    canCreateTasks: () => true,
  }),
}));

vi.mock("@/components/calendar/schedule-field", () => ({
  useScheduleField: () => ({
    fields: [],
    fieldId: null,
    setFieldId: vi.fn(),
    display: null,
  }),
  ScheduleFieldPicker: () => null,
}));

vi.mock("@/components/calendar/day-capture-popover", () => ({
  default: () => null,
}));

vi.mock("@/components/shared/modals/create-task-modal", () => ({
  default: () => null,
}));

// The picker itself is react-day-picker; the dialog only needs a day back.
vi.mock("@/components/ui/calendar", () => ({
  Calendar: ({ onSelect }: { onSelect: (day: Date) => void }) => (
    <button type="button" onClick={() => onSelect(new Date(2026, 10, 24))}>
      pick November 24
    </button>
  ),
}));

const DUE = new Date(2026, 10, 19);

const project = {
  id: "p1",
  slug: "WEB",
  name: "Website",
  columns: [
    {
      id: "to-do",
      slug: "to-do",
      name: "To Do",
      tasks: [
        {
          id: "t1",
          title: "Write launch checklist",
          number: 7,
          status: "to-do",
          priority: "high",
          projectId: "p1",
          startDate: null,
          dueDate: toTaskDateValue(DUE),
        },
      ],
    },
  ],
  plannedTasks: [],
  archivedTasks: [],
} as unknown as ProjectWithTasks;

function renderCalendar(
  props: Partial<Parameters<typeof ProjectCalendar>[0]> = {},
) {
  return render(
    <ProjectCalendar
      workspaceId="w1"
      projectId="p1"
      loadedProject={project}
      project={project}
      isLoading={false}
      isError={false}
      renderToolbar={(toolbar) => toolbar}
      onOpenTask={vi.fn()}
      {...props}
    />,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 17, 10));
  state.coarse = false;
  state.narrow = false;
  state.mutate.mockReset();
  useScheduleViewPreferences.setState({
    calendarMode: "month",
    calendarShowWeekends: true,
  });
  window.matchMedia = ((query: string) => ({
    matches:
      (query.includes("pointer: coarse") && state.coarse) ||
      (query.includes("max-width: 639px") && state.narrow) ||
      (query.includes("max-width: 767px") && state.narrow),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function dayButton(date: string) {
  return document.querySelector<HTMLButtonElement>(
    `button[data-calendar-day="${date}"]`,
  );
}

describe("ProjectCalendar month view on touch screens", () => {
  it("shows day cells and the agenda instead of bars", () => {
    state.coarse = true;
    renderCalendar();

    expect(dayButton("2026-11-19")).not.toBeNull();
    expect(
      screen.queryByRole("button", {
        name: /tasks:calendar.taskAriaLabel/,
      }),
    ).toBeNull();
    // Today is selected until another day is tapped.
    expect(dayButton("2026-11-17")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("tasks:calendar.touch.empty")).toBeInTheDocument();

    fireEvent.click(dayButton("2026-11-19") as HTMLButtonElement);
    expect(dayButton("2026-11-19")).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("heading", { name: "Thursday, November 19" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^Write launch checklist/ }),
    ).toHaveTextContent("WEB-7");
  });

  it("moves a task to the picked date with the dates mutation", () => {
    state.coarse = true;
    renderCalendar();
    fireEvent.click(dayButton("2026-11-19") as HTMLButtonElement);

    fireEvent.click(
      screen.getByRole("button", {
        name: "tasks:calendar.touch.moveTask:Write launch checklist",
      }),
    );
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByText("tasks:calendar.touch.moveTitle"),
    ).toBeInTheDocument();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "pick November 24" }),
    );

    expect(state.mutate).toHaveBeenCalledTimes(1);
    const [variables, options] = state.mutate.mock.calls[0];
    expect(variables.task.id).toBe("t1");
    expect(variables.dueDate).toBe(toTaskDateValue(new Date(2026, 10, 24)));
    expect(variables.startDate).toBeNull();
    expect(options.onSuccess).toEqual(expect.any(Function));
    expect(options.onError).toEqual(expect.any(Function));
  });

  it("keeps the selected day in the page's URL state when given", () => {
    state.narrow = true;
    const onSelectedDayChange = vi.fn();
    renderCalendar({ selectedDay: "2026-11-19", onSelectedDayChange });

    expect(dayButton("2026-11-19")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(dayButton("2026-11-20") as HTMLButtonElement);
    expect(onSelectedDayChange).toHaveBeenCalledWith("2026-11-20");

    // A new month starts from its default day.
    fireEvent.click(
      screen.getByRole("button", { name: "tasks:calendar.nextMonth" }),
    );
    expect(onSelectedDayChange).toHaveBeenLastCalledWith(undefined);
  });
});

describe("ProjectCalendar month view with a mouse at desktop width", () => {
  it("keeps the bars and draws no day agenda", () => {
    renderCalendar();

    expect(
      screen.getByRole("button", {
        name: "tasks:calendar.taskAriaLabel:Write launch checklist",
      }),
    ).toBeInTheDocument();
    expect(dayButton("2026-11-19")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "tasks:calendar.touch.addTask" }),
    ).toBeNull();
  });
});

function dayKeys() {
  return Array.from(document.querySelectorAll("button[data-calendar-day]")).map(
    (day) => day.getAttribute("data-calendar-day"),
  );
}

// Weeks start on Sunday by default: today, Tuesday November 17, is in the
// week of November 15 to 21.
const THIS_WEEK = [
  "2026-11-15",
  "2026-11-16",
  "2026-11-17",
  "2026-11-18",
  "2026-11-19",
  "2026-11-20",
  "2026-11-21",
];

describe("ProjectCalendar week view on touch screens", () => {
  beforeEach(() => {
    useScheduleViewPreferences.setState({ calendarMode: "week" });
  });

  it("shows the week as a strip of days and the agenda instead of bars", () => {
    state.coarse = true;
    renderCalendar();

    expect(dayKeys()).toEqual(THIS_WEEK);
    expect(
      document.querySelector("[data-calendar-region=compact-week]"),
    ).not.toBeNull();
    expect(
      screen.queryByRole("button", {
        name: /tasks:calendar.taskAriaLabel/,
      }),
    ).toBeNull();
    expect(dayButton("2026-11-17")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("tasks:calendar.touch.empty")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "tasks:calendar.touch.addTask" }),
    ).toBeInTheDocument();

    fireEvent.click(dayButton("2026-11-19") as HTMLButtonElement);
    expect(dayButton("2026-11-19")).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("heading", { name: "Thursday, November 19" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^Write launch checklist/ }),
    ).toHaveTextContent("WEB-7");
  });

  it("moves a task from the week's agenda with the dates mutation", () => {
    state.narrow = true;
    renderCalendar();
    fireEvent.click(dayButton("2026-11-19") as HTMLButtonElement);
    fireEvent.click(
      screen.getByRole("button", {
        name: "tasks:calendar.touch.moveTask:Write launch checklist",
      }),
    );
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "pick November 24",
      }),
    );

    expect(state.mutate).toHaveBeenCalledTimes(1);
    const [variables] = state.mutate.mock.calls[0];
    expect(variables.task.id).toBe("t1");
    expect(variables.dueDate).toBe(toTaskDateValue(new Date(2026, 10, 24)));
  });

  it("moves by week and resets the selection to the default day", () => {
    state.coarse = true;
    renderCalendar();
    fireEvent.click(dayButton("2026-11-19") as HTMLButtonElement);

    fireEvent.click(
      screen.getByRole("button", { name: "tasks:calendar.nextWeek" }),
    );
    expect(dayKeys()[0]).toBe("2026-11-22");
    expect(dayKeys()).toHaveLength(7);
    // Today is not in this week: its first day is selected.
    expect(dayButton("2026-11-22")).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(
      screen.getByRole("button", { name: "tasks:calendar.previousWeek" }),
    );
    expect(dayKeys()).toEqual(THIS_WEEK);
    // Back on this week, today is selected again, not the day tapped before.
    expect(dayButton("2026-11-17")).toHaveAttribute("aria-pressed", "true");
    expect(dayButton("2026-11-19")).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(
      screen.getByRole("button", { name: "tasks:calendar.previousWeek" }),
    );
    expect(dayKeys()[0]).toBe("2026-11-08");
    fireEvent.click(
      screen.getByRole("button", { name: "tasks:calendar.today" }),
    );
    expect(dayKeys()).toEqual(THIS_WEEK);
    expect(dayButton("2026-11-17")).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps the selected day in the page's URL state when given", () => {
    state.narrow = true;
    const onSelectedDayChange = vi.fn();
    renderCalendar({ selectedDay: "2026-11-24", onSelectedDayChange });

    // The week opens on the day from the URL.
    expect(dayKeys()[0]).toBe("2026-11-22");
    expect(dayButton("2026-11-24")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(dayButton("2026-11-25") as HTMLButtonElement);
    expect(onSelectedDayChange).toHaveBeenCalledWith("2026-11-25");

    fireEvent.click(
      screen.getByRole("button", { name: "tasks:calendar.nextWeek" }),
    );
    expect(onSelectedDayChange).toHaveBeenLastCalledWith(undefined);
  });

  it("keeps the selected day in view when switching from the month", () => {
    state.coarse = true;
    useScheduleViewPreferences.setState({ calendarMode: "month" });
    renderCalendar();
    fireEvent.click(
      screen.getByRole("button", { name: "tasks:calendar.nextMonth" }),
    );
    fireEvent.click(dayButton("2026-12-10") as HTMLButtonElement);

    fireEvent.click(
      screen.getByRole("button", { name: "tasks:calendar.week" }),
    );
    expect(dayKeys()[0]).toBe("2026-12-06");
    expect(dayButton("2026-12-10")).toHaveAttribute("aria-pressed", "true");
  });
});

describe("ProjectCalendar week view with a mouse at desktop width", () => {
  it("keeps the bars and draws no strip or agenda", () => {
    useScheduleViewPreferences.setState({ calendarMode: "week" });
    renderCalendar();

    expect(
      screen.getByRole("button", {
        name: "tasks:calendar.taskAriaLabel:Write launch checklist",
      }),
    ).toBeInTheDocument();
    expect(dayButton("2026-11-19")).toBeNull();
    expect(
      document.querySelector("[data-calendar-region=compact-week]"),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "tasks:calendar.touch.addTask" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "tasks:calendar.nextWeek" }),
    ).toBeInTheDocument();
  });
});
