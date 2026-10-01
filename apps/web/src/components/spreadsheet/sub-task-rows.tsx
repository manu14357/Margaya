import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Spinner } from "@/components/ui/spinner";
import { useTaskQueryRows } from "@/hooks/queries/task-query/use-task-query-rows";
import { defaultDisplay } from "@/lib/task-query/display";
import type {
  DisplayProperties,
  OrderBy,
  TaskQueryScope,
  TaskQueryState,
} from "@/lib/task-query/model";
import type { TaskQueryMeta } from "@/types/task-query";
import type { SpreadsheetColumn } from "./columns";
import SpreadsheetRow, { MAX_SUB_TASK_DEPTH } from "./spreadsheet-row";

type RowProps = {
  meta: TaskQueryMeta;
  workspaceId: string;
  columns: readonly SpreadsheetColumn[];
  customFieldIds: readonly string[];
  properties: DisplayProperties;
  canEdit: boolean;
  canAssign: boolean;
};

type SubTaskRowsProps = {
  parentId: string;
  depth: number;
  scope: TaskQueryScope;
  orderBy: OrderBy;
  properties: DisplayProperties;
  rowProps: RowProps;
};

/** An expanded row's sub-tasks, indented under it (B4 §6.5). */
export default function SubTaskRows({
  parentId,
  depth,
  scope,
  orderBy,
  properties,
  rowProps,
}: SubTaskRowsProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const state = useMemo<TaskQueryState>(
    () => ({
      filters: {
        op: "and",
        children: [{ key: "parent", operator: "in", values: [parentId] }],
      },
      archived: "exclude",
      display: {
        ...defaultDisplay("project"),
        groupBy: null,
        orderBy,
        showSubTasks: true,
      },
      displayProperties: properties,
    }),
    [parentId, orderBy, properties],
  );
  const query = useTaskQueryRows({
    workspaceId: rowProps.workspaceId,
    scope,
    state,
    limit: 100,
    ungrouped: true,
  });
  const colSpan = rowProps.columns.length + rowProps.customFieldIds.length + 2;

  if (!query.data) {
    return (
      <tr>
        <td colSpan={colSpan}>
          <div
            className="flex h-9 items-center text-muted-foreground text-xs"
            style={{ paddingLeft: 32 + depth * 16 }}
          >
            {query.isError ? (
              t("tasks:spreadsheet.loadError")
            ) : (
              <Spinner className="size-3.5" />
            )}
          </div>
        </td>
      </tr>
    );
  }

  const ids = query.data.groups[0]?.taskIds ?? [];
  const meta = { ...rowProps.meta, ...query.data.meta };

  return (
    <>
      {ids.map((id) => {
        const row = query.data?.tasks[id];
        if (!row) return null;
        const isExpanded = Boolean(expanded[id]);
        return (
          <SubTaskRowGroup key={id}>
            <SpreadsheetRow
              {...rowProps}
              meta={meta}
              row={row}
              depth={depth}
              expanded={isExpanded}
              onToggleExpand={() =>
                setExpanded((current) => ({ ...current, [id]: !isExpanded }))
              }
            />
            {isExpanded && depth + 1 < MAX_SUB_TASK_DEPTH + 1 && (
              <SubTaskRows
                parentId={id}
                depth={depth + 1}
                scope={scope}
                orderBy={orderBy}
                properties={properties}
                rowProps={{ ...rowProps, meta }}
              />
            )}
          </SubTaskRowGroup>
        );
      })}
    </>
  );
}

function SubTaskRowGroup({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
