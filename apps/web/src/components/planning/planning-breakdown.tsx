import { useTranslation } from "react-i18next";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@/components/ui/tabs";
import type { ColumnGroup } from "@/lib/column-groups";
import {
  type BreakdownFilterKey,
  groupStatusValues,
  isBreakdownFilterActive,
  nextBreakdownFilter,
} from "@/lib/planning/breakdown-filter";
import type { BoardFilters } from "@/lib/task-query/planning-filters";
import type { CycleProgress } from "@/types/cycle";
import {
  type BreakdownItem,
  BreakdownList,
  priorityItems,
  useAssigneeItems,
  useGroupItems,
  useLabelItems,
} from "./breakdown-list";

type WorkspaceLabel = { id: string; name: string };

/** The scoped board's filters, which the breakdown rows set and read. */
export type PlanningFilterControls = {
  filters: BoardFilters;
  updateFilter: (
    key: keyof BoardFilters,
    value: BoardFilters[keyof BoardFilters],
  ) => void;
  updateLabelFilter: (labelId: string) => void;
  columns: ReadonlyArray<{ slug: string; group?: string | null }>;
  workspaceLabels: readonly WorkspaceLabel[];
};

type PlanningBreakdownProps = PlanningFilterControls & {
  /** A cycle or module progress report; both share these rows. */
  progress: Pick<
    CycleProgress,
    "counts" | "assignees" | "labels" | "priorities"
  >;
};

/** Status, assignee, label and priority rows; a click filters the board. */
export default function PlanningBreakdown({
  progress,
  filters,
  updateFilter,
  updateLabelFilter,
  columns,
  workspaceLabels,
}: PlanningBreakdownProps) {
  const { t } = useTranslation();
  const groups = useGroupItems(progress.counts);
  const assignees = useAssigneeItems(progress.assignees);
  const labels = useLabelItems(progress.labels);
  const priorities = priorityItems(progress.priorities);

  const valuesFor = (key: BreakdownFilterKey, item: BreakdownItem) =>
    key === "status"
      ? groupStatusValues(columns, item.key as ColumnGroup)
      : [item.key];

  const filterProps = (key: BreakdownFilterKey) => ({
    isActive: (item: BreakdownItem) =>
      isBreakdownFilterActive(filters, key, valuesFor(key, item)),
    onToggle: (item: BreakdownItem) =>
      updateFilter(
        key,
        nextBreakdownFilter(filters, key, valuesFor(key, item)),
      ),
  });

  const labelIds = (name: string) =>
    workspaceLabels.filter((label) => label.name === name).map((l) => l.id);
  const isLabelActive = (item: BreakdownItem) =>
    labelIds(item.key).some((id) => filters.labels?.includes(id));
  const toggleLabel = (item: BreakdownItem) => {
    const ids = labelIds(item.key);
    const anySelected = ids.some((id) => filters.labels?.includes(id));
    for (const id of ids) {
      if (anySelected === Boolean(filters.labels?.includes(id))) {
        updateLabelFilter(id);
      }
    }
  };

  return (
    <Tabs defaultValue="status">
      <TabsList className="w-full">
        <TabsTab value="status" className="text-xs">
          {t("planning:breakdown.tabStatus")}
        </TabsTab>
        <TabsTab value="assignees" className="text-xs">
          {t("planning:breakdown.tabAssignees")}
        </TabsTab>
        <TabsTab value="labels" className="text-xs">
          {t("planning:breakdown.tabLabels")}
        </TabsTab>
        <TabsTab value="priority" className="text-xs">
          {t("planning:breakdown.tabPriority")}
        </TabsTab>
      </TabsList>
      <TabsPanel value="status">
        <BreakdownList
          items={groups}
          emptyText={t("planning:breakdown.noTasks")}
          {...filterProps("status")}
        />
      </TabsPanel>
      <TabsPanel value="assignees">
        <BreakdownList
          items={assignees}
          emptyText={t("planning:breakdown.noAssignees")}
          {...filterProps("assignee")}
        />
      </TabsPanel>
      <TabsPanel value="labels">
        <BreakdownList
          items={labels}
          emptyText={t("planning:breakdown.noLabels")}
          isActive={isLabelActive}
          onToggle={toggleLabel}
        />
      </TabsPanel>
      <TabsPanel value="priority">
        <BreakdownList items={priorities} {...filterProps("priority")} />
      </TabsPanel>
    </Tabs>
  );
}
