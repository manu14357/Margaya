import type {
  FilterCondition,
  FilterNode,
  GroupByKey,
} from "@/lib/task-query/model";

// A member's profile (C9): their numbers and workload, each one engine count
// over the workspace's projects, so every task passes the same visibility
// rules as any list the viewer opens.

export const OPEN_GROUPS = ["backlog", "unstarted", "started"];

export type MemberCountSpec = {
  name: "byGroup" | "byPriority" | "overdue" | "completed30" | "created30";
  filters: FilterNode;
  groupBy?: GroupByKey;
  showEmptyGroups?: boolean;
};

const and = (...children: FilterCondition[]): FilterNode => ({
  op: "and",
  children,
});

/** The hidden condition of a member's "Assigned" list. */
export function memberAssignedConditions(userId: string): FilterCondition[] {
  return [{ key: "assignee", operator: "in", values: [userId] }];
}

export function memberCountSpecs(userId: string): MemberCountSpec[] {
  const [assigned] = memberAssignedConditions(userId) as [FilterCondition];
  const isOpen: FilterCondition = {
    key: "group",
    operator: "in",
    values: OPEN_GROUPS,
  };
  return [
    { name: "byGroup", filters: and(assigned), groupBy: "group" },
    {
      name: "byPriority",
      filters: and(assigned, isOpen),
      groupBy: "priority",
      showEmptyGroups: true,
    },
    {
      name: "overdue",
      filters: and(assigned, isOpen, {
        key: "dueDate",
        operator: "in",
        values: ["past"],
      }),
    },
    {
      name: "completed30",
      filters: and(
        assigned,
        { key: "group", operator: "in", values: ["completed"] },
        {
          key: "completedAt",
          operator: "withinLast",
          amount: 30,
          unit: "days",
        },
      ),
    },
    {
      name: "created30",
      filters: and(
        { key: "createdBy", operator: "in", values: [userId] },
        { key: "createdAt", operator: "withinLast", amount: 30, unit: "days" },
      ),
    },
  ];
}
