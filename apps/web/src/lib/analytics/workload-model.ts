import {
  buildSeriesColors,
  SINGLE_SERIES_COLOR,
} from "@/lib/charts/series-colors";
import { formatNumber } from "@/lib/format";
import type {
  AnalyticsDimension,
  AnalyticsWorkload,
  AnalyticsWorkloadMember,
} from "@/types/analytics";
import type { ChartSeriesModel } from "./chart-model";
import type { Translate } from "./labels";
import { NONE_KEY } from "./labels";
import {
  segmentColumnId,
  type TableCell,
  type TableColumn,
  type TableModel,
} from "./table-model";

// The workload card's chart and table (GET /analytics/workload). The API has
// already sorted the members, heaviest first with unassigned last.

const TOP_ASSIGNEES = 10;
const OPEN_GROUPS = ["backlog", "unstarted", "started"] as const;

type LabelOf = (dimension: AnalyticsDimension, key: string) => string;

export const memberKey = (member: AnalyticsWorkloadMember) =>
  member.userId ?? NONE_KEY;

export const isOverloaded = (member: AnalyticsWorkloadMember) =>
  member.check?.status === "over";

/**
 * The ten heaviest people, anyone over their usual even past those (someone
 * checked by task count can have few points), then unassigned work.
 */
export function chartMembers(
  members: readonly AnalyticsWorkloadMember[],
): AnalyticsWorkloadMember[] {
  const named = members.filter((member) => member.userId !== null);
  const none = members.filter(
    (member) => member.userId === null && member.load > 0,
  );
  return [
    ...named.filter(
      (member, index) => index < TOP_ASSIGNEES || isOverloaded(member),
    ),
    ...none,
  ];
}

export function workloadChartModel(
  workload: AnalyticsWorkload,
  { labelOf }: { labelOf: LabelOf },
): {
  series: ChartSeriesModel[];
  data: { key: string; value: number; cells: Record<string, number> }[];
} {
  const colors = buildSeriesColors([...OPEN_GROUPS], { scheme: "group" });
  return {
    series: OPEN_GROUPS.map((group) => ({
      key: group,
      label: labelOf("group", group),
      color: colors.get(group) ?? SINGLE_SERIES_COLOR,
    })),
    data: chartMembers(workload.members).map((member) => ({
      key: memberKey(member),
      value: member.load,
      cells: member.cells,
    })),
  };
}

/** A person's load against their usual, in words, so it reads without colour. */
export function checkLabel(
  check: NonNullable<AnalyticsWorkloadMember["check"]>,
  t: Translate,
): string {
  if (check.usual === null) return t("analytics:overview.checkUnknown");
  const values = {
    load: formatNumber(check.load),
    usual: formatNumber(check.usual),
  };
  if (check.status === "over") {
    return check.unit === "points"
      ? t("analytics:overview.checkOverPoints", values)
      : t("analytics:overview.checkOverTasks", values);
  }
  return check.unit === "points"
    ? t("analytics:overview.checkOkPoints", values)
    : t("analytics:overview.checkOkTasks", values);
}

/** Everyone with open work, one column per group. No total: tasks with several assignees count for each. */
export function workloadTableModel(
  workload: AnalyticsWorkload,
  {
    t,
    labelOf,
    metricLabel,
  }: { t: Translate; labelOf: LabelOf; metricLabel: string },
): TableModel {
  const isPoints = workload.unit === "points";
  const hasCheck = workload.members.some((member) => member.check !== null);
  const columns: TableColumn[] = [
    { id: "name", label: t("analytics:dimensions.assignee"), kind: "text" },
    ...OPEN_GROUPS.map(
      (group): TableColumn => ({
        id: segmentColumnId(group),
        label: labelOf("group", group),
        kind: "number",
      }),
    ),
    { id: "value", label: metricLabel, kind: "number" },
  ];
  if (isPoints) {
    columns.push({
      id: "taskCount",
      label: t("analytics:table.tasks"),
      kind: "number",
    });
  }
  if (hasCheck) {
    columns.push({
      id: "check",
      label: t("analytics:overview.checkColumn"),
      kind: "text",
    });
  }

  return {
    columns,
    rows: workload.members.map((member, order) => {
      const key = memberKey(member);
      const cells: Record<string, TableCell> = {
        name: labelOf("assignee", key),
        value: member.load,
      };
      for (const group of OPEN_GROUPS) {
        cells[segmentColumnId(group)] = member.cells[group];
      }
      if (isPoints) cells.taskCount = member.tasks;
      if (hasCheck) {
        cells.check = member.check ? checkLabel(member.check, t) : null;
      }
      return {
        id: key,
        key,
        order,
        cells,
        alert: isOverloaded(member) ? ["check"] : undefined,
      };
    }),
  };
}
