import type { client } from "@margaya/libs";
import type { InferRequestType, InferResponseType } from "hono/client";

export type IntakeItem = InferResponseType<
  (typeof client)["intake"]["item"][":id"]["$get"],
  200
>;

export type IntakeItemList = InferResponseType<
  (typeof client)["intake"]["project"][":projectId"]["$get"],
  200
>;

export type IntakeSummary = InferResponseType<
  (typeof client)["intake"]["project"][":projectId"]["summary"]["$get"],
  200
>;

export type IntakeCounts = IntakeItemList["counts"];

export type IntakeStatus = IntakeItem["status"];

export type IntakeSource = IntakeItem["source"];

export type IntakeListQuery = NonNullable<
  InferRequestType<
    (typeof client)["intake"]["project"][":projectId"]["$get"]
  >["query"]
>;

export type CreateIntakeRequest = InferRequestType<
  (typeof client)["intake"]["project"][":projectId"]["$post"]
>["json"];

export type UpdateIntakeRequest = InferRequestType<
  (typeof client)["intake"]["item"][":id"]["$patch"]
>["json"];

export type IntakePriority = NonNullable<CreateIntakeRequest["priority"]>;

export const INTAKE_TABS = ["open", "closed"] as const;

export type IntakeTab = (typeof INTAKE_TABS)[number];

export const INTAKE_SORT_FIELDS = ["createdAt", "updatedAt", "number"] as const;

export type IntakeSortField = (typeof INTAKE_SORT_FIELDS)[number];

export type IntakeSortOrder = "asc" | "desc";

/** The list's filters, as the URL holds them after normalizing. */
export type IntakeFilters = {
  tab: IntakeTab;
  statuses: IntakeStatus[];
  priorities: IntakePriority[];
  submittedBy: string | undefined;
  q: string | undefined;
  sortBy: IntakeSortField;
  sortOrder: IntakeSortOrder;
};

/** The triage routes of one request, by action. */
export type IntakeTriageAction =
  | { action: "accept"; status: string }
  | { action: "decline"; note?: string }
  | { action: "snooze"; until: string }
  | { action: "unsnooze" }
  | { action: "duplicate"; duplicateOfTaskId: string; note?: string }
  | { action: "reopen" };
