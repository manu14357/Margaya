import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";
import TimeReportTab, { hoursOf } from "./time-report-tab";

const m = vi.hoisted(() => ({
  report: null as Record<string, unknown> | null,
  error: null as unknown,
  isLoading: false,
  refetch: vi.fn(),
  lastQuery: null as Record<string, unknown> | null,
  running: null as Record<string, unknown> | null,
  canUpdate: true,
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
    i18n: { resolvedLanguage: "en-US" },
  }),
}));
vi.mock("@/hooks/queries/time-entry/use-get-time-report", () => ({
  default: (query: Record<string, unknown>) => {
    m.lastQuery = query;
    return {
      data: m.report,
      error: m.error,
      isLoading: m.isLoading,
      refetch: m.refetch,
    };
  },
}));
vi.mock("@/hooks/queries/time-entry/use-get-running-time-entry", () => ({
  default: () => ({ data: { entry: m.running } }),
}));
vi.mock("@/hooks/mutations/time-entry/use-stop-time-entry", () => ({
  default: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({ canUpdateTasks: () => m.canUpdate }),
}));
vi.mock("@/components/analytics/analytics-context", () => ({
  useAnalyticsScope: () => ({
    workspaceId: "ws-1",
    projectIds: ["p1"],
    slug: "acme",
  }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: unknown }) => (
    <a href="/task">{children as string}</a>
  ),
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const report = {
  from: "2026-03-01",
  to: "2026-03-31",
  timeZone: "UTC",
  totalSeconds: 9000,
  entryCount: 3,
  runningCount: 1,
  byPerson: [
    {
      userId: "u1",
      name: "Mia Member",
      image: null,
      seconds: 5400,
      entryCount: 2,
    },
    { userId: null, name: null, image: null, seconds: 3600, entryCount: 1 },
  ],
  byProject: [
    {
      projectId: "p1",
      name: "Web",
      slug: "web",
      icon: null,
      seconds: 9000,
      entryCount: 3,
    },
  ],
};

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  m.report = report;
  m.error = null;
  m.isLoading = false;
  m.running = null;
  m.canUpdate = true;
});

describe("TimeReportTab", () => {
  it("shows the totals by person and by project", () => {
    render(<TimeReportTab />);

    expect(screen.getByText("Mia Member")).toBeInTheDocument();
    expect(screen.getByText("analytics:time.formerMember")).toBeInTheDocument();
    expect(screen.getByText("Web")).toBeInTheDocument();
    expect(
      screen.getByText(
        'tasks:timeTracking.hoursMinutes {"hours":1,"minutes":30}',
      ),
    ).toBeInTheDocument();
    // The grand total and the one project's row are the same 2h 30m.
    expect(
      screen.getAllByText(
        'tasks:timeTracking.hoursMinutes {"hours":2,"minutes":30}',
      ),
    ).toHaveLength(2);
    expect(screen.getByText("analytics:time.runningNote")).toBeInTheDocument();
  });

  it("asks for the analytics scope's projects over the chosen period", () => {
    render(<TimeReportTab />);

    expect(m.lastQuery).toMatchObject({
      workspaceId: "ws-1",
      projectIds: ["p1"],
    });
    expect(m.lastQuery?.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(m.lastQuery?.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("has no week or month choice: totals aren't drawn over time", () => {
    render(<TimeReportTab />);

    expect(screen.queryByText("analytics:bucket.week")).toBeNull();
  });

  it("says when a period has no time, without an error", () => {
    m.report = { ...report, byPerson: [], byProject: [], runningCount: 0 };
    render(<TimeReportTab />);

    expect(screen.getAllByText("analytics:time.empty")).toHaveLength(2);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText("analytics:time.runningNote")).toBeNull();
  });

  it("shows a failed load with a retry, never an empty report", () => {
    m.report = null;
    m.error = new HttpError(500, "boom");
    render(<TimeReportTab />);

    expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
    expect(screen.queryByText("analytics:time.empty")).toBeNull();
    fireEvent.click(
      screen.getAllByRole("button", { name: "analytics:states.retry" })[0],
    );
    expect(m.refetch).toHaveBeenCalled();
  });

  it("puts your running timer here so it can be stopped", () => {
    m.running = {
      id: "e1",
      taskId: "t1",
      startTime: "2026-03-01T09:00:00.000Z",
      taskTitle: "Fix login",
      taskNumber: 7,
      projectId: "p1",
      projectSlug: "web",
    };
    render(<TimeReportTab />);

    expect(
      screen.getByRole("button", { name: "tasks:timeTracking.stopTimer" }),
    ).toBeInTheDocument();
  });

  it("offers no stop to someone who can't change time", () => {
    m.canUpdate = false;
    m.running = {
      id: "e1",
      taskId: "t1",
      startTime: "2026-03-01T09:00:00.000Z",
      taskTitle: "Fix login",
      taskNumber: 7,
      projectId: "p1",
      projectSlug: "web",
    };
    render(<TimeReportTab />);

    expect(
      screen.queryByRole("button", { name: "tasks:timeTracking.stopTimer" }),
    ).toBeNull();
  });
});

describe("hoursOf", () => {
  it("rounds to two places for sorting and CSV", () => {
    expect(hoursOf(5400)).toBe(1.5);
    expect(hoursOf(3700)).toBe(1.03);
    expect(hoursOf(0)).toBe(0);
  });
});
