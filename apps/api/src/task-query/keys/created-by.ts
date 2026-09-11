import { and, inArray, isNotNull, isNull, type SQL } from "drizzle-orm";
import { taskTable } from "../../database/schema";
import type { SetFilterKey } from "./registry";

export const createdByKey: SetFilterKey = {
  key: "createdBy",
  kind: "set",
  tokens: ["me"],
  personal: true,
  matchAny: (userIds) =>
    and(
      isNotNull(taskTable.createdBy),
      inArray(taskTable.createdBy, [...userIds]),
    ) as SQL,
  isEmpty: () => isNull(taskTable.createdBy),
};
