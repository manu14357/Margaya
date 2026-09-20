import type { client } from "@margaya/libs";
import type { InferResponseType } from "hono/client";

export type Cycle = InferResponseType<
  (typeof client)["cycle"][":id"]["$get"],
  200
>;

export type CycleStatus = Cycle["status"];

export type CycleCounts = Cycle["counts"];

export type CycleProgress = InferResponseType<
  (typeof client)["cycle"][":id"]["progress"]["$get"],
  200
>;

export type CycleChart = NonNullable<CycleProgress["chart"]>;

export type CycleChartDay = CycleChart["days"][number];

export type CycleAssigneeRow = CycleProgress["assignees"][number];

export type CycleLabelRow = CycleProgress["labels"][number];

export type CyclePriorityRow = CycleProgress["priorities"][number];

export type CycleListView =
  | "all"
  | "current"
  | "upcoming"
  | "draft"
  | "completed"
  | "incomplete"
  | "archived";
