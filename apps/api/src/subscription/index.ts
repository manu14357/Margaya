import {
  apiRouter,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import setTaskSubscription from "./controllers/set-task-subscription";
import { taskSubscriptionSchema } from "./response";
import { taskSubscriptionParam } from "./schema";
import { getSubscriptionState } from "./service";
// Auto-subscribe subscribers and the task-query filter keys register once,
// with the router.
import "./subscribers";
import "./query-keys";

// Subscribing is personal and changes nothing on the task, so task:read is
// enough (viewers can watch tasks).
const middleware = [
  workspaceAccess.fromTaskId(),
  requireWorkspacePermission({ task: ["read"] }),
] as const;

const responses = {
  200: jsonResponse("The caller's subscription", taskSubscriptionSchema),
  400: errorResponse("Unknown task, or its workspace could not be determined"),
  403: errorResponse("No workspace access, or missing task:read permission"),
  404: errorResponse("Task not found"),
};

const getTaskSubscriptionRoute = createRoute({
  method: "get",
  operationId: "getTaskSubscription",
  path: "/task/{taskId}",
  tags: ["Subscriptions"],
  summary: "Get task subscription",
  description:
    "Whether the current user watches the task and why, plus how many people watch it. Watchers hear about status changes, comments, time entries and priority, due date and title changes.",
  middleware: [...middleware] as const,
  request: { params: taskSubscriptionParam },
  responses,
});

const subscribeToTaskRoute = createRoute({
  method: "put",
  operationId: "subscribeToTask",
  path: "/task/{taskId}",
  tags: ["Subscriptions"],
  summary: "Subscribe to task",
  description:
    "Subscribe the current user to the task, also after an earlier unsubscribe. Idempotent.",
  middleware: [...middleware] as const,
  request: { params: taskSubscriptionParam },
  responses,
});

const unsubscribeFromTaskRoute = createRoute({
  method: "delete",
  operationId: "unsubscribeFromTask",
  path: "/task/{taskId}",
  tags: ["Subscriptions"],
  summary: "Unsubscribe from task",
  description:
    "Stop watcher notifications and due-date reminders for the task, also as an assignee. Mentions and new assignments still notify and subscribe again. Idempotent.",
  middleware: [...middleware] as const,
  request: { params: taskSubscriptionParam },
  responses,
});

const subscription = apiRouter()
  .openapi(getTaskSubscriptionRoute, async (c) =>
    c.json(
      await getSubscriptionState(c.req.valid("param").taskId, c.get("userId")),
      200,
    ),
  )
  .openapi(subscribeToTaskRoute, async (c) =>
    c.json(
      await setTaskSubscription(
        c.req.valid("param").taskId,
        c.get("userId"),
        true,
      ),
      200,
    ),
  )
  .openapi(unsubscribeFromTaskRoute, async (c) =>
    c.json(
      await setTaskSubscription(
        c.req.valid("param").taskId,
        c.get("userId"),
        false,
      ),
      200,
    ),
  );

export default subscription;
