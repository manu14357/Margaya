import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AnalyticsWorkload } from "@/types/analytics";
import WorkloadCard from "./workload-card";

const m = vi.hoisted(() => ({
  query: {} as Record<string, unknown>,
  categories: [] as ReactNode[],
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
  }),
}));
vi.mock("./analytics-context", () => ({
  useAnalyticsScope: () => ({
    workspaceId: "ws-1",
    projectIds: undefined,
    slug: "ws",
  }),
}));
vi.mock("@/hooks/queries/analytics/use-analytics-workload", () => ({
  useAnalyticsWorkload: () => m.query,
}));
vi.mock("@/components/charts/bar-chart", () => ({
  default: ({
    data,
    categoryLabel,
  }: {
    data: { key: string }[];
    categoryLabel: (key: string) => ReactNode;
  }) => (
    <ul data-testid="bar-chart">
      {data.map((datum) => (
        <li key={datum.key}>{categoryLabel(datum.key)}</li>
      ))}
    </ul>
  ),
}));

const workload = (
  overrides: Partial<AnalyticsWorkload> = {},
): AnalyticsWorkload => ({
  unit: "tasks",
  usualDays: 28,
  historyDays: 56,
  members: [
    {
      userId: "ann",
      tasks: 6,
      points: 0,
      load: 6,
      cells: { backlog: 0, unstarted: 2, started: 4 },
      check: { unit: "tasks", load: 6, usual: 4, status: "over" },
    },
    {
      userId: "ben",
      tasks: 2,
      points: 0,
      load: 2,
      cells: { backlog: 0, unstarted: 2, started: 0 },
      check: { unit: "tasks", load: 2, usual: 4, status: "ok" },
    },
  ],
  meta: {
    users: [
      { id: "ann", name: "Ann", image: null },
      { id: "ben", name: "Ben", image: null },
    ],
  },
  ...overrides,
});

const ready = (data: AnalyticsWorkload) => ({
  data,
  isLoading: false,
  error: null,
  isPlaceholderData: false,
  refetch: vi.fn(),
});

afterEach(() => {
  cleanup();
});

describe("WorkloadCard", () => {
  it("names who is over their usual, in words and on the chart", () => {
    m.query = ready(workload());
    render(<WorkloadCard />);
    expect(
      screen.getByText(/analytics:overview\.overloaded .*"names":"Ann"/),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("img", { name: "analytics:overview.overUsual" }),
    ).toHaveLength(1);
    expect(
      screen.getByText(/analytics:overview\.usualHint/),
    ).toBeInTheDocument();
  });

  it("says nothing about usuals when nobody is over", () => {
    const data = workload();
    m.query = ready({
      ...data,
      members: data.members.filter((member) => member.userId === "ben"),
    });
    render(<WorkloadCard />);
    expect(screen.queryByText(/analytics:overview\.overloaded/)).toBeNull();
    expect(
      screen.queryByRole("img", { name: "analytics:overview.overUsual" }),
    ).toBeNull();
  });

  it("shows no comparison without the right to see it", () => {
    const data = workload();
    m.query = ready({
      ...data,
      members: data.members.map((member) => ({ ...member, check: null })),
    });
    render(<WorkloadCard />);
    expect(screen.queryByText(/analytics:overview\.overloaded/)).toBeNull();
    expect(screen.queryByText(/analytics:overview\.usualHint/)).toBeNull();
    expect(screen.getByTestId("bar-chart")).toBeInTheDocument();
  });

  it("says which unit it counts", () => {
    m.query = ready(workload({ unit: "points" }));
    render(<WorkloadCard />);
    expect(
      screen.getByText("analytics:overview.workloadSubtitlePoints"),
    ).toBeInTheDocument();
  });

  it("shows the empty state with no open work", () => {
    m.query = ready(workload({ members: [] }));
    render(<WorkloadCard />);
    expect(screen.getByText("analytics:states.noTasks")).toBeInTheDocument();
  });
});
