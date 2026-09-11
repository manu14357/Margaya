import { hasAnyAssignee, hasNoAssigneeSql } from "../../task/assignees";
import type { SetFilterKey } from "./registry";

// Assignees are a set per task (D5), read only through task/assignees.ts:
// "assigned to X" means X is anywhere in the set.
export const assigneeKey: SetFilterKey = {
  key: "assignee",
  kind: "set",
  tokens: ["me"],
  matchAny: (userIds) => hasAnyAssignee(userIds),
  isEmpty: () => hasNoAssigneeSql,
};
