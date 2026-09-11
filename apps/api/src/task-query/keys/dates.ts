import { taskTable } from "../../database/schema";
import type { DateFilterKey } from "./registry";

// Task dates are instants; conditions compare calendar days in the
// requester's zone (see ../dates.ts).
export const dateKeys: DateFilterKey[] = [
  {
    key: "startDate",
    kind: "date",
    column: taskTable.startDate,
    nullable: true,
  },
  { key: "dueDate", kind: "date", column: taskTable.dueDate, nullable: true },
  {
    key: "createdAt",
    kind: "date",
    column: taskTable.createdAt,
    nullable: false,
  },
  {
    key: "updatedAt",
    kind: "date",
    column: taskTable.updatedAt,
    nullable: false,
  },
  {
    key: "completedAt",
    kind: "date",
    column: taskTable.completedAt,
    nullable: true,
  },
];
