import { requireAiEnabled, requireAiUse } from "../ai/access";
import { aiErrorResponse } from "../ai/sse";
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
import { compileRule } from "./compile";
import { dryRunRule } from "./dry-run";
import { compileRuleResultSchema, dryRunResultSchema } from "./response";
import { compileRuleBody, dryRunRuleBody } from "./schema";

// Rule compiler routes (C5). Compiling asks the model for a rule in an
// existing engine's schema; the dry run is computed from history. Neither
// saves anything: people save through the workflow-rule,
// project-automation and automation-rule routes, and saved rules run without a model.

const TAGS = ["AI"];

// Managing automations is project:update, as on the engines' own routes.
const manageAutomations = requireWorkspacePermission({ project: ["update"] });

const compileRoute = createRoute({
  method: "post",
  operationId: "aiCompileRule",
  path: "/compile",
  tags: TAGS,
  summary: "Compile a rule from plain words",
  description:
    "Turn a plain-language request into rules in the existing engines' own schemas: a workflow rule (an integration event moves the linked task to a column) a project automation change (auto-archive, auto-close, cycle rollover, flow alerts), or an automation rule (When a task changes, If it meets conditions, Then act on it: status, assignees, labels, priority, due date, comments, cycle, module, subtasks, notifications). Every rule is checked with the engines' Zod schemas and the project's columns, people, cycles, modules and custom fields; parts no engine can express come back in `unsupported`, in the caller's language, and nothing is invented for them. Nothing is saved. Needs ai:use and project:update, with AI on for the workspace and the project.",
  middleware: [
    workspaceAccess.fromProject("projectId", {
      notFoundMessage: "Project not found",
    }),
    requireAiUse,
    manageAutomations,
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
      content: { "application/json": { schema: compileRuleBody } },
    },
  },
  responses: {
    200: jsonResponse("The compiled rules", compileRuleResultSchema),
    400: errorResponse("Invalid body"),
    403: aiErrorResponse(
      "AI is off (AI_DISABLED), the data may not leave (AI_ROUTE_BLOCKED), or missing ai:use or project:update",
    ),
    404: errorResponse("Project not found"),
    409: aiErrorResponse("No AI provider is set up (AI_NOT_CONFIGURED)"),
    429: aiErrorResponse("AI_BUDGET_EXCEEDED or AI_RATE_LIMITED"),
    502: aiErrorResponse(
      "The AI provider failed or answered in another format (AI_PROVIDER_ERROR)",
    ),
  },
});

const dryRunRoute = createRoute({
  method: "post",
  operationId: "aiRuleDryRun",
  path: "/dry-run",
  tags: TAGS,
  summary: "Replay a rule over recent history",
  description:
    "Replay a rule (as returned by compile, possibly edited) over the project's last 1-90 days: for a workflow rule, the integration events recorded on the project's linked branches, pull requests and issues, with each task's column at that moment from its status history; for auto-archive and auto-close, the tasks the first run would take and when each crossed the months threshold; for cycle rollover, the unfinished tasks of cycles that ended in the window; for an automation rule, the history rows of its trigger (status, assignee, label, priority, due date, comment, cycle and module changes, task creations, passed due dates), with the conditions checked against each task as it is now. Computed only: no model is called, nothing changes, and it works while AI is off. Lists at most 200 matches. Needs project:update.",
  middleware: [
    workspaceAccess.fromProject("projectId", {
      notFoundMessage: "Project not found",
    }),
    manageAutomations,
  ] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: dryRunRuleBody } },
    },
  },
  responses: {
    200: jsonResponse("What the rule would have done", dryRunResultSchema),
    400: errorResponse(
      "Invalid body, or the rule does not fit the project (unknown column, auto-close without a Cancelled-group column, nothing to change)",
    ),
    403: errorResponse("No workspace access, or missing project:update"),
    404: errorResponse("Project not found"),
    503: errorResponse("The replay took too long; try fewer days"),
  },
});

const aiRule = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(compileRoute, async (c) => {
    const { projectId, prompt, locale } = c.req.valid("json");
    return c.json(await compileRule(c, { projectId, prompt, locale }), 200);
  })
  .openapi(dryRunRoute, async (c) => {
    const { projectId, rule, days } = c.req.valid("json");
    return c.json(await dryRunRule({ projectId, rule, days }), 200);
  });

export default aiRule;
