import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import { requireEntitlement } from "../../billing/require-entitlement-middleware";
import { requireWorkspacePermission } from "../../utils/require-workspace-permission";
import { resolveFullUpdateAssignees, sameAssigneeSet } from "../assignee-rules";
import { assigneesOfTask } from "../assignees";

type BulkTaskOperation =
  | "updateStatus"
  | "updatePriority"
  | "updateAssignee"
  | "addAssignee"
  | "removeAssignee"
  | "delete"
  | "addLabel"
  | "removeLabel"
  | "updateDueDate"
  | "updateStartDate"
  | "updateEstimate"
  | "archive"
  | "unarchive";

const BULK_OPERATIONS: readonly BulkTaskOperation[] = [
  "updateStatus",
  "updatePriority",
  "updateAssignee",
  "addAssignee",
  "removeAssignee",
  "delete",
  "addLabel",
  "removeLabel",
  "updateDueDate",
  "updateStartDate",
  "updateEstimate",
  "archive",
  "unarchive",
];

const ASSIGNEE_OPERATIONS: readonly BulkTaskOperation[] = [
  "updateAssignee",
  "addAssignee",
  "removeAssignee",
];

// Route middleware runs before the validators, so c.req.valid() is unavailable.
async function readJsonBody(c: Context): Promise<Record<string, unknown>> {
  const raw = (await c.req.json().catch(() => ({}))) as unknown;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {};
  }
  return raw as Record<string, unknown>;
}

async function bulkOperation(c: Context): Promise<BulkTaskOperation> {
  const { operation } = await readJsonBody(c);
  if (
    typeof operation !== "string" ||
    !(BULK_OPERATIONS as readonly string[]).includes(operation)
  ) {
    throw new HTTPException(400, {
      message: `operation must be one of: ${BULK_OPERATIONS.join(", ")}`,
    });
  }
  return operation as BulkTaskOperation;
}

export async function requireBulkTaskPermission(c: Context, next: Next) {
  const operation = await bulkOperation(c);

  if (operation === "delete") {
    return requireWorkspacePermission({ task: ["delete"] })(c, next);
  }

  if (ASSIGNEE_OPERATIONS.includes(operation)) {
    return requireWorkspacePermission({ task: ["assign"] })(c, next);
  }

  if (operation === "addLabel" || operation === "removeLabel") {
    return requireWorkspacePermission({ label: ["update"] })(c, next);
  }

  return requireWorkspacePermission({ task: ["update"] })(c, next);
}

export async function requireBulkTaskEntitlement(c: Context, next: Next) {
  const operation = await bulkOperation(c);

  if (
    operation === "delete" ||
    operation === "addLabel" ||
    operation === "removeLabel"
  ) {
    return next();
  }

  return requireEntitlement(c, next);
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

/**
 * The full update needs task:assign only when it changes who is assigned,
 * decided by the same resolver the controller uses, so echoing the task
 * back (including its first assignee) never needs it.
 */
export async function requireTaskAssigneePermission(c: Context, next: Next) {
  const { assigneeIds, userId } = await readJsonBody(c);
  // Malformed lists are the validator's to reject with a 400.
  if (assigneeIds != null && !isStringArray(assigneeIds)) return next();

  const current = await assigneesOfTask(c.req.param("id") ?? "");
  const target = resolveFullUpdateAssignees({
    assigneeIds: assigneeIds ?? undefined,
    userId: typeof userId === "string" ? userId : undefined,
    current,
  });

  if (target !== null && !sameAssigneeSet(target, current)) {
    return requireWorkspacePermission({ task: ["assign"] })(c, next);
  }

  return next();
}
