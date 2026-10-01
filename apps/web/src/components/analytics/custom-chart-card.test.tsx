import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  availabilityOf,
  type CategoryDimension,
} from "@/lib/analytics/dimensions";
import { makeChartResult } from "@/lib/analytics/test-fixtures";
import type {
  AnalyticsChartResult,
  AnalyticsDimension,
} from "@/types/analytics";
import {
  type AnalyticsScope,
  AnalyticsScopeProvider,
} from "./analytics-context";
import type BuilderControlsComponent from "./builder-controls";
import CustomChartCard from "./custom-chart-card";

type ControlsProps = ComponentProps<typeof BuilderControlsComponent>;

const m = vi.hoisted(() => ({
  result: null as AnalyticsChartResult | null,
  controls: null as {
    dimensions: readonly AnalyticsDimension[];
    segments: readonly CategoryDimension[];
    pointsAvailable: boolean;
  } | null,
  orientation: "" as string,
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
  }),
}));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/queries/analytics/use-analytics-chart", () => ({
  useAnalyticsChart: () => ({
    data: m.result ?? undefined,
    isLoading: false,
    error: null,
    isPlaceholderData: false,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/components/charts/bar-chart", () => ({
  default: ({ orientation }: { orientation: string }) => {
    m.orientation = orientation;
    return <div data-testid="bar-chart" />;
  },
}));
vi.mock("./builder-controls", () => ({
  default: (props: ControlsProps) => {
    m.controls = {
      dimensions: props.dimensions,
      segments: props.segments,
      pointsAvailable: props.pointsAvailable,
    };
    return null;
  },
}));

const base = { workspaceId: "ws-1", context: { timeZone: "UTC" } };
const one = [{ id: "p1", estimatesEnabled: true }];
const two = [{ id: "p1" }, { id: "p2", cyclesEnabled: true }];

function renderCard(
  projects: Array<Record<string, unknown>>,
  { pointsPossible = false }: { pointsPossible?: boolean } = {},
) {
  const scope: AnalyticsScope = {
    kind: "workspace",
    workspaceId: "ws-1",
    scopeKey: `test-${projects.length}-${Math.random()}`,
    projects: [],
    slug: "acme",
  };
  render(
    <AnalyticsScopeProvider value={scope}>
      <CustomChartCard
        base={base}
        availability={availabilityOf(projects)}
        pointsPossible={pointsPossible}
      />
    </AnalyticsScopeProvider>,
  );
}

afterEach(() => {
  cleanup();
  m.result = null;
  m.controls = null;
  m.orientation = "";
  window.localStorage.clear();
});

describe("CustomChartCard", () => {
  it("offers Status only with one project and Project only with several", () => {
    m.result = makeChartResult();
    renderCard(one);
    expect(m.controls?.dimensions).toContain("status");
    expect(m.controls?.dimensions).not.toContain("project");
    cleanup();

    renderCard(two);
    expect(m.controls?.dimensions).not.toContain("status");
    expect(m.controls?.dimensions).toContain("project");
    expect(m.controls?.dimensions).toContain("cycle");
  });

  it("hides points when no scope project can contribute them", () => {
    m.result = makeChartResult({ pointsProjectIds: [] });
    renderCard(one, { pointsPossible: true });
    expect(m.controls?.pointsAvailable).toBe(false);
    cleanup();

    m.result = makeChartResult({ pointsProjectIds: ["p1"] });
    renderCard(one, { pointsPossible: true });
    expect(m.controls?.pointsAvailable).toBe(true);
  });

  it("offers segments other than the x-axis and never dates", () => {
    m.result = makeChartResult();
    renderCard(one);
    expect(m.controls?.segments).not.toContain("priority");
    expect(m.controls?.segments).not.toContain("createdAt");
    expect(m.controls?.segments).toContain("group");
  });

  it("draws names as horizontal rows and notes truncation and many-valued counts", () => {
    m.result = makeChartResult({
      truncated: {
        x: true,
        hiddenXCount: 10,
        segment: true,
        hiddenSegmentCount: 2,
      },
    });
    renderCard(one);
    expect(screen.getByTestId("bar-chart")).toBeInTheDocument();
    expect(m.orientation).toBe("horizontal");
    expect(
      screen.getByText(
        'analytics:builder.truncatedX {"shown":3,"total":13,"dimension":"analytics:dimensionsPlural.assignee"}',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText('analytics:builder.truncatedSegments {"count":2}'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'analytics:builder.multiValued {"dimension":"analytics:dimensionsPlural.assignee"}',
      ),
    ).toBeInTheDocument();
  });

  it("draws date buckets as vertical bars", () => {
    m.result = makeChartResult({
      xAxis: "createdAt",
      segment: null,
      segments: [],
      dateBucket: "month",
      multiValued: { x: false, segment: false },
      buckets: [
        {
          key: "2026-03-01",
          value: 8,
          taskCount: 8,
          progress: null,
          rangeStart: "2026-03-01",
          rangeEnd: "2026-03-31",
        },
      ],
    });
    renderCard(one);
    expect(m.orientation).toBe("vertical");
  });

  it("shows the empty state when no task matches", () => {
    m.result = makeChartResult({ totalCount: 0, buckets: [], segments: [] });
    renderCard(one);
    expect(screen.getByText("analytics:states.noTasks")).toBeInTheDocument();
  });
});
