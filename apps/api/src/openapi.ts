import { OpenAPIHono, z } from "@hono/zod-openapi";
import type { Session, User } from "better-auth/types";
import { HTTPException } from "hono/http-exception";

export { createRoute } from "@hono/zod-openapi";
export { z };

export type ApiKey = {
  id: string;
  userId: string;
  enabled: boolean;
  permissions: Record<string, string[]> | null;
  /** Set when the key is limited to these projects (api-key/scope.ts). */
  projectIds?: string[] | null;
  readOnly?: boolean;
  /** Set on an agent run's key (ai-agent/attribution.ts). */
  agentRun?: {
    agentId: string;
    agentUserId: string;
    agentName: string;
    onBehalfOf: string;
    onBehalfOfName: string | null;
    runId: string;
  } | null;
};

export type BaseVariables = {
  userId: string;
  userEmail: string;
  user: User | null;
  session: Session | null;
  apiKey?: ApiKey;
};

// createRoute({ middleware }) registers middleware BEFORE the request
// validators, so middleware must read the raw request, not c.req.valid().
export function apiRouter<V extends BaseVariables = BaseVariables>() {
  return new OpenAPIHono<{ Variables: V }>({
    defaultHook: (result) => {
      if (!result.success) {
        const issue = result.error.issues[0];
        const field = issue?.path.join(".");
        throw new HTTPException(400, {
          message: issue
            ? `${field || "request"}: ${issue.message}`
            : "Invalid request",
        });
      }
    },
  });
}

export const responseTimestamp = z
  .date()
  .openapi({ type: "string", format: "date-time" });

export const nullableResponseTimestamp = responseTimestamp
  .nullable()
  .openapi({ type: ["string", "null"], format: "date-time" });

// Declaring a non-2xx response widens an untagged InferResponseType on the
// frontend, so those call sites must tag the status: InferResponseType<T, 200>.
export function errorResponse(description: string) {
  return {
    description,
    content: { "text/plain": { schema: z.string() } },
  };
}

// The 404 that the workspaceAccess lookups (utils/workspace-access-middleware.ts)
// answer for an id that is unknown, in the trash, or hidden from the caller
// (a restricted project, or one outside a project-limited API key).
const LOOKUP_NOT_FOUND = {
  project:
    "Unknown project, a project in the trash, or one the caller can't see",
  task: "Unknown task, a task in the trash, or one in a project the caller can't see",
  column:
    "Unknown column, or one in a project in the trash or that the caller can't see",
  label:
    "Unknown label, or one on a task in the trash or in a project the caller can't see",
  timeEntry:
    "Unknown time entry, or one on a task in the trash or in a project the caller can't see",
  comment:
    "Unknown comment, or one on a task in the trash or in a project the caller can't see",
  workflowRule:
    "Unknown rule, or one in a project in the trash or that the caller can't see",
  customField:
    "Unknown custom field, or one in a project in the trash or that the caller can't see",
} as const;

export function lookupNotFound(resource: keyof typeof LOOKUP_NOT_FOUND) {
  return errorResponse(LOOKUP_NOT_FOUND[resource]);
}

export function jsonResponse<T extends z.ZodType>(
  description: string,
  schema: T,
) {
  return {
    description,
    content: { "application/json": { schema } },
  };
}
