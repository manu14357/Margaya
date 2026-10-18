import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import {
  createAutomationRule,
  deleteAutomationRule,
  listAutomationRules,
  listAutomationRuns,
  updateAutomationRule,
} from "./controllers";
import {
  automationRuleListSchema,
  automationRuleSchema,
  automationRunListSchema,
  deletedAutomationRuleSchema,
} from "./response";
import {
  automationProjectParam,
  automationRuleParam,
  automationRunsQuery,
  createAutomationRuleBody,
  updateAutomationRuleBody,
} from "./schema";
import "./subscribers";

// Project automation rules ("When → If → Then"). Reading needs
// project:read; managing needs project:update, the permission of every
// other project automation. Restricted projects answer 404 to people who
// can't see them (workspaceAccess.fromProject).

const TAGS = ["Projects"];
const read = [
  workspaceAccess.fromProject("projectId", {
    notFoundMessage: "Project not found",
  }),
  requireWorkspacePermission({ project: ["read"] }),
] as const;
const manage = [
  workspaceAccess.fromProject("projectId", {
    notFoundMessage: "Project not found",
  }),
  requireWorkspacePermission({ project: ["update"] }),
] as const;

const RULE_DESCRIPTION =
  "A rule runs when its trigger happens to a task of the project (task created, status changed, assignee or label added or removed, priority changed, due date set or passed, comment added, moved into a cycle or module) and the task meets its conditions (AND/OR groups of status, labels, priority, assignee, due date, estimate, title and custom field checks). Its actions (set status, assign, unassign, add or remove a label, set priority, set a due date relative to the run, add a comment, move to a cycle or module, create a subtask, notify people) go through the same code as a person's change and act as the system actor Automation. No model runs. Actions caused by a rule never trigger that rule again, chains stop after 3 rules and a task takes at most 20 runs a minute.";

const listRoute = createRoute({
  method: "get",
  operationId: "listAutomationRules",
  path: "/{projectId}",
  tags: TAGS,
  summary: "List automation rules",
  description: `The project's automation rules, oldest first, with run counters. ${RULE_DESCRIPTION}`,
  middleware: [...read] as const,
  request: { params: automationProjectParam },
  responses: {
    200: jsonResponse("The rules", automationRuleListSchema),
    403: errorResponse("No workspace access, or missing project:read"),
    404: errorResponse("Project not found"),
  },
});

const createRuleRoute = createRoute({
  method: "post",
  operationId: "createAutomationRule",
  path: "/{projectId}",
  tags: TAGS,
  summary: "Create an automation rule",
  description: `Columns, cycles, modules and custom fields must belong to the project, people to the workspace, and people an action assigns or notifies must see the project. At most 100 rules per project. ${RULE_DESCRIPTION}`,
  middleware: [...manage] as const,
  request: {
    params: automationProjectParam,
    body: {
      required: true,
      content: { "application/json": { schema: createAutomationRuleBody } },
    },
  },
  responses: {
    200: jsonResponse("The new rule", automationRuleSchema),
    400: errorResponse(
      "Invalid rule, or it names something outside the project",
    ),
    403: errorResponse(
      "No workspace access, missing project:update, or a Run agent action without ai:use",
    ),
    404: errorResponse("Project not found"),
  },
});

const updateRuleRoute = createRoute({
  method: "patch",
  operationId: "updateAutomationRule",
  path: "/{projectId}/{ruleId}",
  tags: TAGS,
  summary: "Update or toggle an automation rule",
  description:
    "Change a rule's name, trigger, conditions or actions, or turn it on or off with `enabled`. Turning a rule off always works; anything else checks the rule again.",
  middleware: [...manage] as const,
  request: {
    params: automationRuleParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateAutomationRuleBody } },
    },
  },
  responses: {
    200: jsonResponse("The rule after the change", automationRuleSchema),
    400: errorResponse(
      "Invalid rule, or it names something outside the project",
    ),
    403: errorResponse(
      "No workspace access, missing project:update, or a Run agent action without ai:use",
    ),
    404: errorResponse("Project or rule not found"),
  },
});

const deleteRuleRoute = createRoute({
  method: "delete",
  operationId: "deleteAutomationRule",
  path: "/{projectId}/{ruleId}",
  tags: TAGS,
  summary: "Delete an automation rule",
  description: "Deletes the rule and its run history.",
  middleware: [...manage] as const,
  request: { params: automationRuleParam },
  responses: {
    200: jsonResponse("The deleted rule", deletedAutomationRuleSchema),
    403: errorResponse("No workspace access, or missing project:update"),
    404: errorResponse("Project or rule not found"),
  },
});

const runsRoute = createRoute({
  method: "get",
  operationId: "listAutomationRuns",
  path: "/{projectId}/runs",
  tags: TAGS,
  summary: "List automation runs",
  description:
    "The project's latest automation runs, newest first: which rule ran on which task, each action's result and the outcome. A run is logged when a rule's trigger and conditions matched; runs are kept for AUTOMATION_RUN_RETENTION_DAYS (default 30).",
  middleware: [...read] as const,
  request: { params: automationProjectParam, query: automationRunsQuery },
  responses: {
    200: jsonResponse("The runs", automationRunListSchema),
    403: errorResponse("No workspace access, or missing project:read"),
    404: errorResponse("Project not found"),
  },
});

const automationRule = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(listRoute, async (c) =>
    c.json(await listAutomationRules(c.req.valid("param").projectId), 200),
  )
  .openapi(runsRoute, async (c) => {
    const { ruleId, limit } = c.req.valid("query");
    return c.json(
      await listAutomationRuns({
        projectId: c.req.valid("param").projectId,
        ruleId,
        limit,
      }),
      200,
    );
  })
  .openapi(createRuleRoute, async (c) =>
    c.json(
      await createAutomationRule({
        projectId: c.req.valid("param").projectId,
        userId: c.get("userId"),
        body: c.req.valid("json"),
      }),
      200,
    ),
  )
  .openapi(updateRuleRoute, async (c) => {
    const { projectId, ruleId } = c.req.valid("param");
    return c.json(
      await updateAutomationRule({
        projectId,
        ruleId,
        userId: c.get("userId"),
        patch: c.req.valid("json"),
      }),
      200,
    );
  })
  .openapi(deleteRuleRoute, async (c) => {
    const { projectId, ruleId } = c.req.valid("param");
    return c.json(await deleteAutomationRule({ projectId, ruleId }), 200);
  });

export default automationRule;
