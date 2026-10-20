import { useMemo } from "react";
import type {
  FilterCondition,
  TaskQueryScope,
  TaskQueryState,
} from "@/lib/task-query/model";
import {
  buildIdsRequest,
  buildRowsRequest,
  useUserTimeZone,
} from "@/lib/task-query/request";
import { useUserPreferencesStore } from "@/store/user-preferences";
import { useTaskQuery } from "./use-task-query";
import { useTaskQueryIds } from "./use-task-query-ids";

type RowsOptions = {
  workspaceId: string;
  scope: TaskQueryScope;
  state: TaskQueryState;
  baseConditions?: readonly FilterCondition[];
  search?: string;
  /** Rows per group: 50 in grouped layouts, 100 in the spreadsheet. */
  limit?: number;
  /** The spreadsheet lists everything in one ungrouped page. */
  ungrouped?: boolean;
  enabled?: boolean;
};

/** Rows of a task list's current state (rows mode, grouped or not). */
export function useTaskQueryRows({
  workspaceId,
  scope,
  state,
  baseConditions,
  search,
  limit = 50,
  ungrouped = false,
  enabled = true,
}: RowsOptions) {
  const weekStartsOn = useUserPreferencesStore((store) => store.weekStartsOn);
  const timeZone = useUserTimeZone();
  const request = useMemo(
    () =>
      workspaceId
        ? buildRowsRequest({
            workspaceId,
            scope,
            state,
            baseConditions,
            search,
            weekStartsOn,
            timeZone,
            limit,
            ungrouped,
          })
        : null,
    [
      workspaceId,
      scope,
      state,
      baseConditions,
      search,
      weekStartsOn,
      timeZone,
      limit,
      ungrouped,
    ],
  );
  return useTaskQuery(request, { enabled });
}

type IdsOptions = {
  workspaceId: string;
  scope: TaskQueryScope;
  state: Pick<TaskQueryState, "filters" | "archived" | "display">;
  baseConditions?: readonly FilterCondition[];
  enabled?: boolean;
};

/** Every id matching a task list's filters, for an already loaded board. */
export function useTaskQueryIdsFor({
  workspaceId,
  scope,
  state,
  baseConditions,
  enabled = true,
}: IdsOptions) {
  const weekStartsOn = useUserPreferencesStore((store) => store.weekStartsOn);
  const timeZone = useUserTimeZone();
  const request = useMemo(
    () =>
      workspaceId
        ? buildIdsRequest({
            workspaceId,
            scope,
            state,
            baseConditions,
            weekStartsOn,
            timeZone,
          })
        : null,
    [workspaceId, scope, state, baseConditions, weekStartsOn, timeZone],
  );
  return useTaskQueryIds(request, { enabled });
}
