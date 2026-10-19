import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AnalyticsCycleRow, AnalyticsCycles } from "@/types/analytics";
import {
  type AnalyticsScope,
  AnalyticsScopeProvider,
} from "./analytics-context";
import CyclesTable from "./cycles-table";

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function row(
  id: string,
  status: AnalyticsCycleRow["status"],
  projectId = "p1",
): AnalyticsCycleRow {
  return {
    id,
    projectId,
    name: `Cycle ${id}`,
    status,
    startDate: "2026-10-01",
    endDate: "2026-10-14",
    isFrozen: false,
    counts: {
      backlog: 0,
      unstarted: 1,
      started: 1,
      completed: 2,
      cancelled: 0,
    },
    committed: 4,
    pending: 2,
    progress: 50,
    committedPoints: null,
    completedPoints: null,
  } as AnalyticsCycleRow;
}

function cycles(rows: AnalyticsCycleRow[]): AnalyticsCycles {
  return {
    today: "2026-10-20",
    enabledProjectIds: ["p1", "p2"],
    summary: { current: 0, upcoming: 0, draft: 0, completedRecent: 0 },
    rows,
    velocity: null,
    averageCompleted: null,
    averageCompletedPoints: null,
    meta: {
      projects: [
        { id: "p1", name: "Alpha", slug: "alpha", icon: null },
        { id: "p2", name: "Beta", slug: "beta", icon: null },
      ],
    },
  } as unknown as AnalyticsCycles;
}

const scope: AnalyticsScope = {
  kind: "workspace",
  workspaceId: "ws-1",
  scopeKey: "all",
  projects: [],
  slug: "acme",
};

function renderTable(data: AnalyticsCycles) {
  render(
    <AnalyticsScopeProvider value={scope}>
      <CyclesTable
        data={data}
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
      />
    </AnalyticsScopeProvider>,
  );
}

const running = () =>
  screen.getByRole("button", { name: "analytics:cycles.filter.running" });

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("CyclesTable running filter", () => {
  it("shows only running cycles across projects and remembers it", () => {
    renderTable(
      cycles([
        row("a", "current"),
        row("b", "upcoming"),
        row("c", "current", "p2"),
      ]),
    );
    expect(screen.getByText("Cycle b")).toBeInTheDocument();

    fireEvent.click(running());
    expect(screen.queryByText("Cycle b")).not.toBeInTheDocument();
    expect(screen.getByText("Cycle a")).toBeInTheDocument();
    expect(screen.getByText("Cycle c")).toBeInTheDocument();
    cleanup();

    renderTable(cycles([row("a", "current"), row("b", "upcoming")]));
    expect(running()).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText("Cycle b")).not.toBeInTheDocument();
  });

  it("says when no cycle is running", () => {
    renderTable(cycles([row("b", "upcoming")]));
    fireEvent.click(running());
    expect(
      screen.getByText("analytics:states.noRunningCycles"),
    ).toBeInTheDocument();
  });

  it("keeps the no-cycles message when there are none at all", () => {
    renderTable(cycles([]));
    fireEvent.click(running());
    expect(screen.getByText("analytics:states.noCycles")).toBeInTheDocument();
  });
});
