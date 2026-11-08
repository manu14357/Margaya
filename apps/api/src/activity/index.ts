import { HTTPException } from "hono/http-exception";
import { subscribeToEvent } from "../events";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
  lookupNotFound,
  z,
} from "../openapi";
import { hiddenForCurrentRequest } from "../project/visibility";
import { insertTaskActivity } from "../task-activity/insert-activity";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import getWorkspaceMember from "../workspace/controllers/get-workspace-member";
import createActivity from "./controllers/create-activity";
import createComment from "./controllers/create-comment";
import deleteComment from "./controllers/delete-comment";
import getActivities from "./controllers/get-activities";
import getMyActivity from "./controllers/get-my-activity";
import updateComment from "./controllers/update-comment";
import {
  activityListSchema,
  activitySchema,
  myActivityPageSchema,
} from "./response";
import {
  createActivityBody,
  createCommentBody,
  deleteCommentBody,
  memberActivityParam,
  myActivityQuery,
  taskIdParam,
  updateCommentBody,
} from "./schema";

const getMyActivityRoute = createRoute({
  method: "get",
  operationId: "getMyActivity",
  path: "/mine",
  tags: ["Activity"],
  summary: "Get my recent activity",
  description:
    "The current user's own activity on the workspace's tasks, newest first, with a reference to each task. Requests still waiting in intake are left out. A row naming a project the caller can't see is redacted, as in GET /activity/{taskId}. Cursor-paginated.",
  middleware: [
    workspaceAccess.fromQuery(),
    requireWorkspacePermission({ task: ["read"] }),
  ] as const,
  request: { query: myActivityQuery },
  responses: {
    200: jsonResponse("A page of the caller's activity", myActivityPageSchema),
    400: errorResponse(
      "Invalid limit or cursor, or the workspace could not be determined",
    ),
    403: errorResponse("No workspace access, or missing task:read permission"),
  },
});

const getMemberActivityRoute = createRoute({
  method: "get",
  operationId: "getMemberActivity",
  path: "/member/{userId}",
  tags: ["Activity"],
  summary: "Get a member's recent activity",
  description:
    "A workspace member's activity on the workspace's tasks, newest first, for their profile: the same rows as GET /activity/mine shows them. Requests still waiting in intake and trashed tasks are left out. A row naming a project the caller can't see is redacted, as in GET /activity/{taskId}. Cursor-paginated.",
  middleware: [
    workspaceAccess.fromQuery(),
    requireWorkspacePermission({ task: ["read"] }),
  ] as const,
  request: { params: memberActivityParam, query: myActivityQuery },
  responses: {
    200: jsonResponse("A page of the member's activity", myActivityPageSchema),
    400: errorResponse(
      "Invalid limit or cursor, or the workspace could not be determined",
    ),
    403: errorResponse("No workspace access, or missing task:read permission"),
    404: errorResponse("Not a member of this workspace"),
  },
});

const getActivitiesRoute = createRoute({
  method: "get",
  operationId: "getActivities",
  path: "/{taskId}",
  tags: ["Activity"],
  summary: "Get task activity",
  description:
    "Get a task's full activity feed, newest first: comments alongside system events such as status and assignee changes. Replies are in the same list: parentId names the top-level comment each one belongs to. Rows keep snapshots of other tasks and projects; one naming a project the caller can't see (restricted, outside a guest's projects or outside a project-limited API key) is redacted: see eventData.",
  middleware: [workspaceAccess.fromTaskId()] as const,
  request: { params: taskIdParam },
  responses: {
    200: jsonResponse("List of activities for the task", activityListSchema),
    403: errorResponse("No access to the task's workspace"),
    404: lookupNotFound("task"),
  },
});

const createActivityRoute = createRoute({
  method: "post",
  operationId: "createActivity",
  path: "/create",
  tags: ["Activity"],
  summary: "Create activity",
  description:
    "Record a system-generated event on a task. Most events are written by the server itself; this exists for importers and integrations.",
  middleware: [
    workspaceAccess.fromTaskId(),
    requireWorkspacePermission({ task: ["update"] }),
  ] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: createActivityBody } },
    },
  },
  responses: {
    200: jsonResponse("The created activity", activitySchema),
    400: {
      description:
        "Invalid body, or comment activity submitted through the generic endpoint",
      content: {
        "text/plain": { schema: z.string() },
        "application/json": { schema: z.object({ message: z.string() }) },
      },
    },
    403: errorResponse(
      "No workspace access, or missing task:update permission",
    ),
    404: lookupNotFound("task"),
  },
});

const createCommentRoute = createRoute({
  method: "post",
  operationId: "createComment",
  path: "/comment",
  tags: ["Activity"],
  summary: "Create comment",
  description:
    "Add a comment to a task, or a reply with parentId. Equivalent to POST /comment/{taskId}, kept for the activity-feed client.",
  middleware: [
    workspaceAccess.fromTaskId(),
    requireWorkspacePermission({ task: ["update"] }),
  ] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: createCommentBody } },
    },
  },
  responses: {
    200: jsonResponse("The created comment", activitySchema),
    400: errorResponse("Invalid body"),
    403: errorResponse(
      "No workspace access, or missing task:update permission",
    ),
    404: errorResponse(
      "Unknown task, a task in the trash, or one in a project the caller can't see; or parentId is not a comment on this task",
    ),
  },
});

const updateCommentRoute = createRoute({
  method: "put",
  operationId: "updateComment",
  path: "/comment",
  tags: ["Activity"],
  summary: "Update comment",
  description:
    "Edit a comment. Only the comment's author may do this, with task:update.",
  middleware: [
    workspaceAccess.fromActivity("activityId"),
    requireWorkspacePermission({ task: ["update"] }),
  ] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: updateCommentBody } },
    },
  },
  responses: {
    200: jsonResponse("The updated comment", activitySchema),
    400: errorResponse("Invalid body"),
    403: errorResponse(
      "Not the author, no access to the workspace, or missing task:update permission",
    ),
    404: errorResponse("Comment not found"),
  },
});

const deleteCommentRoute = createRoute({
  method: "delete",
  operationId: "deleteComment",
  path: "/comment",
  tags: ["Activity"],
  summary: "Delete comment",
  description:
    "Delete a comment. Only the comment's author may do this, with task:update.",
  middleware: [
    workspaceAccess.fromActivity("activityId"),
    requireWorkspacePermission({ task: ["update"] }),
  ] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: deleteCommentBody } },
    },
  },
  responses: {
    200: jsonResponse("The deleted comment", activitySchema),
    400: errorResponse("Invalid body"),
    403: errorResponse(
      "Not the author, no access to the workspace, or missing task:update permission",
    ),
    404: errorResponse("Comment not found"),
  },
});

// "/mine" is registered before "/{taskId}", which would otherwise match it.
const activity = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(getMyActivityRoute, async (c) => {
    const { workspaceId, limit, cursor } = c.req.valid("query");
    return c.json(
      await getMyActivity({
        userId: c.get("userId"),
        workspaceId,
        limit,
        cursor,
        hidden: await hiddenForCurrentRequest(workspaceId),
      }),
      200,
    );
  })
  .openapi(getMemberActivityRoute, async (c) => {
    const { workspaceId, limit, cursor } = c.req.valid("query");
    const { userId } = c.req.valid("param");
    await getWorkspaceMember(workspaceId, userId);
    return c.json(
      await getMyActivity({
        userId,
        workspaceId,
        limit,
        cursor,
        // The viewer's restricted projects, not the member's.
        hidden: await hiddenForCurrentRequest(workspaceId),
      }),
      200,
    );
  })
  .openapi(getActivitiesRoute, async (c) => {
    const workspaceId = c.get("workspaceId");
    return c.json(
      await getActivities(c.req.valid("param").taskId, {
        workspaceId,
        hidden: await hiddenForCurrentRequest(workspaceId),
      }),
      200,
    );
  })
  .openapi(createActivityRoute, async (c) => {
    const { taskId, message, type, eventData } = c.req.valid("json");
    if (type === "comment") {
      throw new HTTPException(400, {
        res: c.json(
          { message: "Use the comment endpoint to create comments" },
          400,
        ),
      });
    }
    return c.json(
      await createActivity(taskId, type, c.get("userId"), message, eventData),
      200,
    );
  })
  .openapi(createCommentRoute, async (c) => {
    const { taskId, comment, parentId } = c.req.valid("json");
    return c.json(
      await createComment(taskId, c.get("userId"), comment, undefined, {
        parentId,
      }),
      200,
    );
  })
  .openapi(updateCommentRoute, async (c) => {
    const { activityId, comment } = c.req.valid("json");
    return c.json(
      await updateComment(c.get("userId"), activityId, comment),
      200,
    );
  })
  .openapi(deleteCommentRoute, async (c) =>
    c.json(
      await deleteComment(c.get("userId"), c.req.valid("json").activityId),
      200,
    ),
  );

subscribeToEvent<{
  taskId: string;
  currentUserId: string;
  type: string;
  content: string | null;
  source?: string;
}>("task.created", async (data) => {
  if (!data.currentUserId || !data.taskId || !data.type) {
    return;
  }
  // An accepted intake request already has its submitted and accepted rows;
  // a published draft wrote its "created" row in the publish transaction; a
  // repeating task's next instance has its recurred_from row instead.
  if (
    data.source === "intake" ||
    data.source === "draft" ||
    data.source === "recurrence"
  ) {
    return;
  }
  await createActivity(data.taskId, data.type, data.currentUserId, null, {});
});

subscribeToEvent<{
  taskId: string;
  userId: string;
  type: string;
  content: string;
  fromProjectId: string;
  fromProjectName: string;
  toProjectId: string;
  toProjectName: string;
  oldStatus: string;
  newStatus: string;
}>("task.moved", async (data) => {
  const {
    fromProjectId,
    fromProjectName,
    toProjectId,
    toProjectName,
    oldStatus,
    newStatus,
  } = data;

  await createActivity(data.taskId, data.type, data.userId, null, {
    fromProjectId,
    fromProjectName,
    toProjectId,
    toProjectName,
    oldStatus,
    newStatus,
  });
});

subscribeToEvent<{
  taskId: string;
  userId: string;
  oldStatus: string;
  newStatus: string;
  title: string;
  assigneeId?: string;
  type: string;
}>("task.status_changed", async (data) => {
  await createActivity(data.taskId, data.type, data.userId, null, {
    oldStatus: data.oldStatus,
    newStatus: data.newStatus,
  });
});

// D7: archiving and restoring are their own history rows. Integration
// changes carry no user and stay unattributed, like their status changes.
for (const eventName of ["task.archived", "task.unarchived"] as const) {
  subscribeToEvent<{ taskId: string; userId: string | null; type: string }>(
    eventName,
    async (data) => {
      if (!data.taskId || !data.type) return;
      await insertTaskActivity({
        taskId: data.taskId,
        type: data.type,
        userId: data.userId ?? "",
        eventData: {},
      });
    },
  );
}

// C7: moving to the trash and restoring are history rows of their own. The
// row survives in the trash (the task row still exists) and shows after a
// restore; a permanent delete takes it along.
for (const [eventName, type] of [
  ["task.deleted", "deleted"],
  ["task.restored", "restored"],
] as const) {
  subscribeToEvent<{ taskId?: string; userId?: string | null; type?: string }>(
    eventName,
    async (data) => {
      // Only trash moves carry the type; an intake delete is permanent.
      if (!data.taskId || data.type !== type) return;
      await insertTaskActivity({
        taskId: data.taskId,
        type,
        userId: data.userId ?? null,
        eventData: {},
      });
    },
  );
}

subscribeToEvent<{
  taskId: string;
  userId: string;
  oldPriority: string;
  newPriority: string;
  title: string;
  type: string;
}>("task.priority_changed", async (data) => {
  await createActivity(data.taskId, data.type, data.userId, null, {
    oldPriority: data.oldPriority,
    newPriority: data.newPriority,
  });
});

// One request publishes its removals, then its additions, back to back.
// Writing each task's assignee rows one after another keeps created_at (and
// so the feed) in publish order: "unassigned Ana" before "assigned Ben".
const assigneeActivityQueues = new Map<string, Promise<unknown>>();

function inTaskOrder(taskId: string, write: () => Promise<unknown>) {
  const next = (assigneeActivityQueues.get(taskId) ?? Promise.resolve())
    .catch(() => undefined)
    .then(write);
  assigneeActivityQueues.set(taskId, next);
  const release = () => {
    if (assigneeActivityQueues.get(taskId) === next) {
      assigneeActivityQueues.delete(taskId);
    }
  };
  next.then(release, release);
  return next;
}

subscribeToEvent<{
  taskId: string;
  userId: string;
  title: string;
  type: string;
  oldAssigneeId?: string;
  oldAssignee?: string | null;
}>("task.unassigned", async (data) => {
  // Legacy publishers sent no user: the row then reads "unassigned the task".
  const eventData = data.oldAssigneeId
    ? {
        oldAssigneeId: data.oldAssigneeId,
        oldAssignee: data.oldAssignee ?? null,
        isSelfUnassigned: data.userId === data.oldAssigneeId,
      }
    : {};
  await inTaskOrder(data.taskId, () =>
    createActivity(data.taskId, data.type, data.userId, null, eventData),
  );
});

subscribeToEvent<{
  taskId: string;
  userId: string;
  oldAssignee: string | null;
  newAssignee: string;
  newAssigneeId: string;
  title: string;
  type: string;
}>("task.assignee_changed", async (data) => {
  await inTaskOrder(data.taskId, () =>
    createActivity(data.taskId, data.type, data.userId, null, {
      newAssigneeId: data.newAssigneeId,
      newAssignee: data.newAssignee,
      isSelfAssigned: data.userId === data.newAssigneeId,
    }),
  );
});

subscribeToEvent<{
  taskId: string;
  userId: string;
  oldDueDate: Date | null;
  newDueDate: Date;
  title: string;
  type: string;
}>("task.due_date_changed", async (data) => {
  await createActivity(data.taskId, data.type, data.userId, null, {
    oldDueDate:
      data.oldDueDate instanceof Date
        ? data.oldDueDate.toISOString()
        : data.oldDueDate,
    newDueDate:
      data.newDueDate instanceof Date
        ? data.newDueDate.toISOString()
        : data.newDueDate,
  });
});

export default activity;
