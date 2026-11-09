import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { availabilityOf } from "@/lib/analytics/dimensions";
import { localToday } from "@/lib/analytics/periods";
import { makeChartResult } from "@/lib/analytics/test-fixtures";
import type { AnalyticsChartResult } from "@/types/analytics";
import {
  type AnalyticsScope,
  AnalyticsScopeProvider,
} from "./analytics-context";
import BreakdownCard, {
  breakdownOptions,
  defaultBreakdown,
} from "./breakdown-card";

const m = vi.hoisted(() => ({
  result: null as AnalyticsChartResult | null,
  requests: [] as Array<{ xAxis: string; segment?: string | null }>,
  download: vi.fn(),
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/analytics/export", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/analytics/export")>()),
  downloadCsv: m.download,
}));
vi.mock("@/hooks/queries/analytics/use-analytics-chart", () => ({
  useAnalyticsChart: (request: { xAxis: string; segment?: string | null }) => {
    m.requests.push(request);
    return {
      data: m.result ?? undefined,
      isLoading: false,
      error: null,
      isPlaceholderData: false,
      refetch: vi.fn(),
    };
  },
}));

const base = { workspaceId: "ws-1", context: { timeZone: "UTC" } };
const projects = [{ id: "p1" }, { id: "p2", cyclesEnabled: true }];
const fields = [
  { id: "tier", name: "Tier", type: "dropdown" },
  { id: "budget", name: "Budget", type: "number" },
];

function renderCard(
  kind: AnalyticsScope["kind"] = "workspace",
  customFields?: typeof fields,
) {
  const scope: AnalyticsScope = {
    kind,
    workspaceId: "ws-1",
    scopeKey: "all",
    projects: [],
    slug: "acme",
  };
  render(
    <AnalyticsScopeProvider value={scope}>
      <BreakdownCard
        base={base}
        availability={availabilityOf(
          kind === "workspace" ? projects : [projects[0]],
          customFields,
        )}
      />
    </AnalyticsScopeProvider>,
  );
}

afterEach(() => {
  cleanup();
  m.result = null;
  m.requests = [];
  m.download.mockReset();
});

/** Each row's name (without avatar initials), the total row last. */
function nameColumn() {
  return screen
    .getAllByRole("row")
    .slice(1)
    .map((row) => {
      const cell = row.querySelector("td");
      return (
        cell?.querySelector("[title]")?.textContent ?? cell?.textContent ?? ""
      );
    });
}

describe("breakdown options", () => {
  it("groups by project in a workspace with several projects, else by assignee", () => {
    const workspace = breakdownOptions(availabilityOf(projects));
    expect(workspace).toEqual([
      "project",
      "assignee",
      "label",
      "priority",
      "cycle",
      "createdBy",
    ]);
    expect(defaultBreakdown("workspace", workspace)).toBe("project");

    const single = breakdownOptions(availabilityOf([projects[0]]));
    expect(single).not.toContain("project");
    expect(single).not.toContain("cycle");
    expect(defaultBreakdown("project", single)).toBe("assignee");
  });
});

describe("breakdown by a custom field", () => {
  it("offers the project's dropdowns with one project only", () => {
    expect(breakdownOptions(availabilityOf([projects[0]], fields))).toEqual([
      "assignee",
      "label",
      "priority",
      "createdBy",
      "customField:tier",
    ]);
    expect(breakdownOptions(availabilityOf(projects, fields))).not.toContain(
      "customField:tier",
    );
  });

  it("groups rows by a dropdown and exports them under its name", async () => {
    m.result = makeChartResult({
      xAxis: "customField:tier",
      multiValued: { x: false, segment: false },
      buckets: [
        {
          key: "value:Gold",
          value: 2,
          taskCount: 2,
          cells: { started: 1, completed: 1 },
          progress: 50,
        },
        {
          key: "none",
          value: 1,
          taskCount: 1,
          cells: { unstarted: 1 },
          progress: 0,
        },
      ],
      meta: {
        ...makeChartResult().meta,
        customFields: [{ id: "tier", name: "Tier", type: "dropdown" }],
      },
    });
    renderCard("project", fields);

    fireEvent.click(
      screen.getByRole("combobox", { name: "analytics:breakdown.groupRowsBy" }),
    );
    const tier = await screen.findByRole("option", { name: "Tier" });
    fireEvent.pointerDown(tier, { pointerType: "mouse" });
    fireEvent.click(tier);
    expect(m.requests.at(-1)).toMatchObject({
      xAxis: "customField:tier",
      segment: "group",
    });
    expect(nameColumn()).toEqual([
      "Gold",
      "analytics:none.customField",
      "analytics:table.total",
    ]);

    fireEvent.click(
      screen.getByRole("button", { name: /analytics:export.button/ }),
    );
    const [fileName, text] = m.download.mock.calls[0] as [string, string];
    expect(fileName).toBe(`acme-analytics-breakdown-tier-${localToday()}.csv`);
    const lines = text.slice(1).trim().split("\r\n");
    expect(lines[0]?.startsWith('"Tier"')).toBe(true);
    expect(lines[1]).toContain('"Gold"');
  });
});

describe("BreakdownCard", () => {
  it("asks for the default dimension segmented by group", () => {
    m.result = makeChartResult();
    renderCard();
    expect(m.requests.at(-1)).toMatchObject({
      xAxis: "project",
      segment: "group",
    });
  });

  it("sorts rows from a header and keeps the total last", () => {
    m.result = makeChartResult({
      buckets: [
        {
          key: "m2",
          value: 3,
          taskCount: 3,
          cells: { started: 3 },
          progress: 0,
        },
        {
          key: "m1",
          value: 4,
          taskCount: 4,
          cells: { completed: 4 },
          progress: 100,
        },
      ],
    });
    renderCard("project");
    expect(nameColumn()).toEqual(["Max", "Mia", "analytics:table.total"]);

    const totalHeader = screen
      .getAllByRole("columnheader")
      .find((header) => header.textContent === "analytics:table.total");
    fireEvent.click(totalHeader?.querySelector("button") as HTMLElement);
    expect(nameColumn()).toEqual(["Mia", "Max", "analytics:table.total"]);
    expect(totalHeader).toHaveAttribute("aria-sort", "descending");
  });

  it("exports the displayed rows under the section's file name", () => {
    m.result = makeChartResult();
    renderCard();
    fireEvent.click(
      screen.getByRole("button", { name: /analytics:export.button/ }),
    );

    expect(m.download).toHaveBeenCalledTimes(1);
    const [fileName, text] = m.download.mock.calls[0] as [string, string];
    expect(fileName).toBe(
      `acme-analytics-breakdown-project-${localToday()}.csv`,
    );
    const lines = text.slice(1).trim().split("\r\n");
    expect(lines).toHaveLength(1 + 3 + 1);
    expect(lines[1]).toContain('"Mia"');
    expect(lines[4]).toContain('"analytics:table.total"');
  });
});
