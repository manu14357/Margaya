import { eq } from "drizzle-orm";
import { requireAiEnabled, requireAiUse } from "../ai/access";
import { aiErrorResponse } from "../ai/sse";
import db from "../database";
import { projectTable } from "../database/schema";
import { publishEvent } from "../events";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { requireProjectFeature } from "../project/features";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import { suggestDraftLabels } from "./draft-labels";
import {
  draftLabelSuggestionsSchema,
  triageSettingsSchema,
  triageSuggestionsSchema,
} from "./response";
import {
  draftLabelsBody,
  triageProjectParam,
  triageSuggestBody,
  updateTriageSettingsBody,
} from "./schema";
import { getTriageSettings, suggestTriage } from "./suggest";

// Triage Copilot routes (B7). Suggestions are read-only; people apply them
// through the ordinary label, assignee, priority, move and intake routes.

const TAGS = ["AI"];

const suggestRoute = createRoute({
  method: "post",
  operationId: "aiTriageSuggest",
  path: "/suggest",
  tags: TAGS,
  summary: "Suggest triage for a task or request",
  description:
    "Suggest labels, an assignee, a priority, a better project and possible duplicates for a task or an open intake request, each with a one-line reason in the caller's language. Only existing labels, people who can see the project, AI-enabled projects and tasks found by workspace search (as the caller) are suggested. Nothing is changed, except that a project with auto-apply on attaches the suggested labels at once (needs label:update; audited as ai.triage_labels_applied). Needs ai:use, plus intake:triage for a request or task:update for a task.",
  middleware: [
    workspaceAccess.fromTaskId("taskId"),
    requireAiUse,
    requireAiEnabled(),
    requireProjectFeature("ai", {
      resource: "task",
      key: "taskId",
      in: "body",
    }),
  ] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: triageSuggestBody } },
    },
  },
  responses: {
    200: jsonResponse("The suggestions", triageSuggestionsSchema),
    403: aiErrorResponse(
      "AI is off (AI_DISABLED), the data may not leave (AI_ROUTE_BLOCKED), or missing ai:use, intake:triage or task:update",
    ),
    404: errorResponse("Task not found"),
    409: aiErrorResponse("No AI provider is set up (AI_NOT_CONFIGURED)"),
    429: aiErrorResponse("AI_BUDGET_EXCEEDED or AI_RATE_LIMITED"),
    502: aiErrorResponse("The AI provider failed (AI_PROVIDER_ERROR)"),
  },
});

const draftLabelsRoute = createRoute({
  method: "post",
  operationId: "aiTriageDraftLabels",
  path: "/labels",
  tags: TAGS,
  summary: "Suggest labels for a task being written",
  description:
    "Up to three workspace labels for a draft task (its title and description so far), each with a one-line reason, from the labels' names and the labels of similar existing tasks the caller can see. Nothing is changed: the create form adds a label when the person picks it. No model call when the workspace has no labels. Needs ai:use and task:create, with AI on for the workspace and the project. Feature triage, fast tier.",
  middleware: [
    workspaceAccess.fromProject("projectId", {
      notFoundMessage: "Project not found",
    }),
    requireAiUse,
    requireWorkspacePermission({ task: ["create"] }),
    requireAiEnabled(),
    requireProjectFeature("ai", {
      resource: "project",
      key: "projectId",
      in: "body",
    }),
  ] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: draftLabelsBody } },
    },
  },
  responses: {
    200: jsonResponse("The suggested labels", draftLabelSuggestionsSchema),
    400: errorResponse("Invalid body"),
    403: aiErrorResponse(
      "AI is off (AI_DISABLED), the data may not leave (AI_ROUTE_BLOCKED), or missing ai:use or task:create",
    ),
    404: errorResponse("Project not found"),
    409: aiErrorResponse("No AI provider is set up (AI_NOT_CONFIGURED)"),
    429: aiErrorResponse("AI_BUDGET_EXCEEDED or AI_RATE_LIMITED"),
    502: aiErrorResponse("The AI provider failed (AI_PROVIDER_ERROR)"),
  },
});

const getSettingsRoute = createRoute({
  method: "get",
  operationId: "getAiTriageSettings",
  path: "/settings/{projectId}",
  tags: TAGS,
  summary: "Get a project's triage settings",
  description:
    "Whether the project applies suggested labels at once. Any workspace member who can see the project may read it.",
  middleware: [
    workspaceAccess.fromProjectId("projectId", {
      notFoundMessage: "Project not found",
    }),
  ] as const,
  request: { params: triageProjectParam },
  responses: {
    200: jsonResponse("The settings", triageSettingsSchema),
    403: errorResponse("No access to the workspace or project"),
    404: errorResponse("Unknown project, or one you can't see"),
  },
});

const updateSettingsRoute = createRoute({
  method: "patch",
  operationId: "updateAiTriageSettings",
  path: "/settings/{projectId}",
  tags: TAGS,
  summary: "Update a project's triage settings",
  description:
    "Turn auto-apply of suggested labels on or off for the project. Off by default. Recorded in the audit log as a project settings change. Needs project:update.",
  middleware: [
    workspaceAccess.fromProjectId("projectId", {
      notFoundMessage: "Project not found",
    }),
    requireWorkspacePermission({ project: ["update"] }),
  ] as const,
  request: {
    params: triageProjectParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateTriageSettingsBody } },
    },
  },
  responses: {
    200: jsonResponse("The settings after the change", triageSettingsSchema),
    400: errorResponse("Invalid body"),
    403: errorResponse("No workspace access, or missing project:update"),
    404: errorResponse("Unknown project, or one you can't see"),
  },
});

const triage = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(suggestRoute, async (c) => {
    const { taskId, locale } = c.req.valid("json");
    return c.json(await suggestTriage(c, taskId, locale), 200);
  })
  .openapi(draftLabelsRoute, async (c) => {
    const body = c.req.valid("json");
    return c.json(await suggestDraftLabels(c, body), 200);
  })
  .openapi(getSettingsRoute, async (c) => {
    const { projectId } = c.req.valid("param");
    return c.json(await getTriageSettings(projectId), 200);
  })
  .openapi(updateSettingsRoute, async (c) => {
    const { projectId } = c.req.valid("param");
    const { autoApplyLabels } = c.req.valid("json");
    const before = await getTriageSettings(projectId);
    if (before.autoApplyLabels !== autoApplyLabels) {
      await db
        .update(projectTable)
        .set({ aiTriageAutoApplyLabels: autoApplyLabels })
        .where(eq(projectTable.id, projectId));
      // Audited as project.settings_changed (audit-log/capture-events.ts).
      await publishEvent("project.updated", {
        projectId,
        workspaceId: c.get("workspaceId"),
        userId: c.get("userId"),
        changed: ["aiTriageAutoApplyLabels"],
      });
    }
    return c.json({ projectId, autoApplyLabels }, 200);
  });

export default triage;
