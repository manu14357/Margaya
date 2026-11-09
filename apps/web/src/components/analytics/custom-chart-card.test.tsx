import { act, cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  availabilityOf,
  type CategoryDimension,
} from "@/lib/analytics/dimensions";
import type { ReportTarget } from "@/lib/analytics/report-config";
import { makeChartResult } from "@/lib/analytics/test-fixtures";
import type {
  AnalyticsChartResult,
  AnalyticsDimension,
} from "@/types/analytics";
import type { AnalyticsReport } from "@/types/analytics-report";
import {
  type AnalyticsScope,
  AnalyticsScopeProvider,
} from "./analytics-context";
import type BuilderControlsComponent from "./builder-controls";
import CustomChartCard from "./custom-chart-card";
import type ReportActionsComponent from "./report-actions";

type ControlsProps = ComponentProps<typeof BuilderControlsComponent>;
type ReportActionsProps = ComponentProps<typeof ReportActionsComponent>;

const m = vi.hoisted(() => ({
  result: null as AnalyticsChartResult | null,
  controls: null as {
    dimensions: readonly AnalyticsDimension[];
    segments: readonly CategoryDimension[];
    pointsAvailable: boolean;
    fields?: ControlsProps["fields"];
  } | null,
  chartEnabled: [] as boolean[],
  state: null as ControlsProps["state"] | null,
  orientation: "" as string,
  reports: [] as AnalyticsReport[],
  actions: null as ReportActionsProps | null,
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
  useAnalyticsChart: (_request: unknown, options?: { enabled?: boolean }) => {
    m.chartEnabled.push(options?.enabled ?? true);
    return {
      data: m.result ?? undefined,
      isLoading: false,
      error: null,
      isPlaceholderData: false,
      refetch: vi.fn(),
    };
  },
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
      fields: props.fields,
    };
    m.state = props.state;
    return null;
  },
}));
vi.mock("@/hooks/queries/analytics-report/use-analytics-reports", () => ({
  useAnalyticsReports: () => ({
    data: m.reports,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock("./report-actions", () => ({
  default: (props: ReportActionsProps) => {
    m.actions = props;
    return null;
  },
  ReportStatus: ({
    report,
    isDirty,
    notes,
  }: {
    report: AnalyticsReport;
    isDirty: boolean;
    notes: Array<{ kind: string }>;
  }) => (
    <p>
      {`open:${report.name}:${isDirty ? "dirty" : "clean"}:${notes
        .map((note) => note.kind)
        .join(",")}`}
    </p>
  ),
}));

const base = { workspaceId: "ws-1", context: { timeZone: "UTC" } };
const one = [{ id: "p1", estimatesEnabled: true }];
const two = [{ id: "p1" }, { id: "p2", cyclesEnabled: true }];

function renderCard(
  projects: Array<Record<string, unknown>>,
  {
    pointsPossible = false,
    reports,
    fields,
    scopeKey,
  }: {
    pointsPossible?: boolean;
    reports?: ComponentProps<typeof CustomChartCard>["reports"];
    fields?: Parameters<typeof availabilityOf>[1];
    scopeKey?: string;
  } = {},
) {
  const scope: AnalyticsScope = {
    kind: "workspace",
    workspaceId: "ws-1",
    scopeKey: scopeKey ?? `test-${projects.length}-${Math.random()}`,
    projects: [],
    slug: "acme",
  };
  render(
    <AnalyticsScopeProvider value={scope}>
      <CustomChartCard
        base={base}
        availability={availabilityOf(projects, fields)}
        pointsPossible={pointsPossible}
        reports={reports}
      />
    </AnalyticsScopeProvider>,
  );
  return scope;
}

afterEach(() => {
  cleanup();
  m.result = null;
  m.controls = null;
  m.state = null;
  m.orientation = "";
  m.reports = [];
  m.actions = null;
  m.chartEnabled = [];
  window.localStorage.clear();
});

describe("CustomChartCard with custom fields", () => {
  const fields = [
    { id: "tier", name: "Tier", type: "dropdown" },
    { id: "budget", name: "Budget", type: "number" },
  ];
  const tierResult = () =>
    makeChartResult({
      xAxis: "customField:tier",
      segment: null,
      segments: [],
      metric: "customField:budget",
      multiValued: { x: false, segment: false },
      buckets: [
        { key: "value:Gold", value: 300.5, taskCount: 2, progress: null },
        { key: "none", value: 0, taskCount: 1, progress: null },
      ],
      meta: {
        ...makeChartResult().meta,
        customFields: [
          { id: "budget", name: "Budget", type: "number" },
          { id: "tier", name: "Tier", type: "dropdown" },
        ],
      },
    });

  it("offers a dropdown with one project, and hands the fields to the controls", () => {
    m.result = makeChartResult();
    renderCard(one, { fields });
    expect(m.controls?.dimensions).toContain("customField:tier");
    expect(m.controls?.segments).toContain("customField:tier");
    expect(m.controls?.fields).toEqual(fields);
    cleanup();

    renderCard(two, { fields });
    expect(m.controls?.dimensions).not.toContain("customField:tier");
  });

  it("tables a dropdown's values with the field's and the sum's names", () => {
    m.result = tierResult();
    const scopeKey = "custom-fields";
    window.localStorage.setItem(
      `margaya:analytics:builder:${scopeKey}`,
      JSON.stringify({
        xAxis: "customField:tier",
        metric: "customField:budget",
      }),
    );
    renderCard(one, { fields, scopeKey });
    expect(m.state).toMatchObject({
      xAxis: "customField:tier",
      metric: "customField:budget",
    });
    const headers = screen
      .getAllByRole("columnheader")
      .map((header) => header.textContent);
    expect(headers).toEqual([
      "Tier",
      'analytics:metric.sumOf {"name":"Budget"}',
      "analytics:table.tasks",
    ]);
    expect(screen.getAllByText("Gold").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText("analytics:none.customField").length,
    ).toBeGreaterThan(0);
  });

  it("waits for the project's fields before charting a stored field", () => {
    m.result = tierResult();
    const scopeKey = "custom-fields-loading";
    window.localStorage.setItem(
      `margaya:analytics:builder:${scopeKey}`,
      JSON.stringify({ xAxis: "customField:tier" }),
    );
    renderCard(one, { scopeKey });
    expect(m.state?.xAxis).toBe("customField:tier");
    expect(m.chartEnabled.at(-1)).toBe(false);
    expect(screen.queryByTestId("bar-chart")).toBeNull();
    cleanup();

    // Loaded without it: the field was deleted, so the default x-axis shows.
    renderCard(one, { scopeKey, fields: [] });
    expect(m.state?.xAxis).toBe("priority");
    expect(m.chartEnabled.at(-1)).toBe(true);
  });
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

  it("offers saved reports only when the page can apply them", () => {
    m.result = makeChartResult();
    renderCard(one);
    expect(m.actions).toBeNull();
    cleanup();

    renderCard(one, {
      reports: { taskSet: {}, onOpen: vi.fn() },
    });
    expect(m.actions?.currentConfig).toMatchObject({
      xAxis: "priority",
      archived: "exclude",
    });
    expect(m.actions?.opened).toBeNull();
  });

  it("opens a report: applies its chart settings and notes what was left out", () => {
    m.result = makeChartResult();
    const report = {
      id: "r1",
      workspaceId: "ws-1",
      name: "Bugs",
      visibility: "private",
      owner: { id: "u1", name: "Ada" },
      isOwner: true,
      canDelete: true,
      config: { xAxis: "label", segment: "group", archived: "exclude" },
      droppedProjectCount: 1,
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
    } as AnalyticsReport;
    m.reports = [report];
    let scopeKey = "";
    const onOpen = vi.fn(
      (): ReportTarget => ({
        scopeKey,
        availability: availabilityOf(one),
        plan: {
          projectIds: [],
          scopeKey,
          leftOutCount: 0,
          allProjects: false,
          otherProjects: false,
        },
      }),
    );
    scopeKey = renderCard(one, {
      reports: { taskSet: {}, onOpen },
    }).scopeKey;

    act(() => m.actions?.onOpen(report));
    expect(onOpen).toHaveBeenCalledWith(report);
    expect(m.state).toMatchObject({ xAxis: "label", segment: "group" });
    expect(screen.getByText("open:Bugs:clean:dropped")).toBeInTheDocument();
    expect(m.actions?.opened?.id).toBe("r1");
  });
});
