import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import { getProjectAutomations } from "./controllers/get-automations";
import { previewProjectAutomation } from "./controllers/preview-automation";
import { updateProjectAutomations } from "./controllers/update-automations";
import { automationPreviewSchema, projectAutomationsSchema } from "./response";
import {
  automationPreviewQuery,
  automationProjectParam,
  updateProjectAutomationsBody,
} from "./schema";

const TAGS = ["Projects"];
const readMiddleware = [
  workspaceAccess.fromProject("projectId"),
  requireWorkspacePermission({ project: ["read"] }),
] as const;

const previewRoute = createRoute({
  method: "get",
  operationId: "previewProjectAutomation",
  path: "/{projectId}/preview",
  tags: TAGS,
  summary: "Preview a scheduled automation",
  description:
    "How many tasks a rule would take right now with the given months: auto-archive takes tasks in Completed or Cancelled columns, auto-close takes open tasks (planned included) without an upcoming start or due date. Tasks in a running cycle or module are skipped. Counts at most 10,000.",
  middleware: [...readMiddleware] as const,
  request: { params: automationProjectParam, query: automationPreviewQuery },
  responses: {
    200: jsonResponse("The matching task count", automationPreviewSchema),
    400: errorResponse("Invalid rule or months, or unknown project"),
    403: errorResponse("No workspace access, or missing project:read"),
    503: errorResponse("Preview took too long; retry later"),
  },
});

const getRoute = createRoute({
  method: "get",
  operationId: "getProjectAutomations",
  path: "/{projectId}",
  tags: TAGS,
  summary: "Get scheduled automations",
  description:
    "The project's auto-archive and auto-close settings, the auto-close state and what each rule did last. Both rules are off until first set.",
  middleware: [...readMiddleware] as const,
  request: { params: automationProjectParam },
  responses: {
    200: jsonResponse("The project's automations", projectAutomationsSchema),
    400: errorResponse("Unknown project"),
    403: errorResponse("No workspace access, or missing project:read"),
  },
});

const updateRoute = createRoute({
  method: "patch",
  operationId: "updateProjectAutomations",
  path: "/{projectId}",
  tags: TAGS,
  summary: "Update scheduled automations",
  description:
    "Turn auto-archive or auto-close on or off, or change their months (1-12) or the auto-close column (a column of this project in the Cancelled group). The hourly job applies them, records each change in the task's history and sends no notifications. Publishes project.automations_updated when something changed.",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ project: ["update"] }),
  ] as const,
  request: {
    params: automationProjectParam,
    body: {
      required: true,
      content: {
        "application/json": { schema: updateProjectAutomationsBody },
      },
    },
  },
  responses: {
    200: jsonResponse(
      "The automations after the change",
      projectAutomationsSchema,
    ),
    400: errorResponse(
      "Invalid body, nothing to change, or auto-close without a column in the Cancelled group",
    ),
    403: errorResponse("No workspace access, or missing project:update"),
  },
});

const projectAutomation = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(previewRoute, async (c) => {
    const { rule, months } = c.req.valid("query");
    return c.json(
      await previewProjectAutomation({
        projectId: c.req.valid("param").projectId,
        rule,
        months,
      }),
      200,
    );
  })
  .openapi(getRoute, async (c) =>
    c.json(await getProjectAutomations(c.req.valid("param").projectId), 200),
  )
  .openapi(updateRoute, async (c) =>
    c.json(
      await updateProjectAutomations({
        projectId: c.req.valid("param").projectId,
        workspaceId: c.get("workspaceId"),
        userId: c.get("userId"),
        patch: c.req.valid("json"),
      }),
      200,
    ),
  );

export default projectAutomation;
