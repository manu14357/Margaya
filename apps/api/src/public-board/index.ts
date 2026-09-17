import type { MiddlewareHandler } from "hono";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { descriptionPageSchema } from "../task/response";
import { descriptionPageQuery } from "../task/schema";
import { boundedRequestBody } from "../utils/bounded-request-body";
import { enforceRateLimits } from "../utils/rate-limit";
import { publicBoard } from "./board";
import {
  createPublicBoardComment,
  deletePublicBoardComment,
  listPublicBoardComments,
  updatePublicBoardComment,
} from "./controllers/comments";
import {
  listMyPublicBoardRequests,
  setPublicCommentReaction,
  setPublicTaskReaction,
  setPublicVote,
  submitPublicBoardRequest,
  withdrawPublicBoardRequest,
} from "./controllers/participate";
import {
  getPublicBoard,
  getPublicBoardTask,
  getPublicBoardTaskDescription,
  listPublicBoardTasks,
} from "./controllers/read";
import {
  perIpLimit,
  publicResponseHeaders,
  requireParticipation,
} from "./gate";
import { PUBLIC_LIMITS } from "./limits";
import type { ParticipationAction } from "./participation";
import {
  publicBoardSchema,
  publicCommentPageSchema,
  publicCommentSchema,
  publicIdSchema,
  publicReactionGroupListSchema,
  publicRequestPageSchema,
  publicRequestSchema,
  publicTaskDetailSchema,
  publicTaskPageSchema,
  publicVoteStateSchema,
} from "./response";
import {
  boardTasksQuery,
  commentBody,
  commentPageQuery,
  commentParam,
  commentReactionParam,
  requestBody,
  requestPageQuery,
  requestParam,
  taskNumberParam,
  taskReactionParam,
  tokenParam,
  voteBody,
} from "./schema";
import type { PublicBoardVariables } from "./types";
import { publicViewer } from "./viewer";

// The public board API (B12 §3.4, tag "Public boards"), mounted before the
// app-wide auth middleware: every route resolves its own optional viewer.

const TAGS = ["Public boards"];
const BODY_LIMIT_BYTES = 32 * 1024;
const BOARD_404 =
  "Unknown, unpublished or archived board, or public boards are off";

const readChain: MiddlewareHandler[] = [
  perIpLimit(PUBLIC_LIMITS.read),
  publicViewer(),
  publicBoard(),
];

function writeChain(action: ParticipationAction): MiddlewareHandler[] {
  return [
    perIpLimit(PUBLIC_LIMITS.write),
    boundedRequestBody(BODY_LIMIT_BYTES),
    publicViewer(),
    publicBoard(),
    requireParticipation(action),
  ];
}

const writeErrors = {
  400: errorResponse("Invalid body, or content the board refuses"),
  401: errorResponse("Sign in to take part"),
  403: errorResponse(
    "Participation or the feature is off, an API key was used, guests are not allowed, or the viewer is blocked",
  ),
  404: errorResponse(BOARD_404),
  413: errorResponse("Request body is too large"),
  429: errorResponse("Too many requests; see Retry-After"),
};

function jsonBody<T>(schema: T) {
  return { required: true, content: { "application/json": { schema } } };
}

const getBoardRoute = createRoute({
  method: "get",
  operationId: "getPublicBoard",
  path: "/{token}",
  tags: TAGS,
  summary: "Get a public board",
  description:
    "The board's project, settings, columns, labels, sorts and what the viewer may do. Works without signing in.",
  security: [],
  middleware: readChain,
  request: { params: tokenParam },
  responses: {
    200: jsonResponse("The board", publicBoardSchema),
    404: errorResponse(BOARD_404),
    429: errorResponse("Too many requests; see Retry-After"),
  },
});

const listTasksRoute = createRoute({
  method: "get",
  operationId: "listPublicBoardTasks",
  path: "/{token}/tasks",
  tags: TAGS,
  summary: "List a public board's tasks",
  description:
    "Tasks grouped by column, with filters, search, sorts and per-column paging. Viewer-agnostic and cached for 10 seconds.",
  security: [],
  middleware: readChain,
  request: { params: tokenParam, query: boardTasksQuery },
  responses: {
    200: jsonResponse("A page of tasks", publicTaskPageSchema),
    400: errorResponse(
      "Invalid query, votes sort with votes off, or the board changed",
    ),
    404: errorResponse(BOARD_404),
    429: errorResponse("Too many requests; see Retry-After"),
    503: errorResponse("The board took too long to load"),
  },
});

const getTaskRoute = createRoute({
  method: "get",
  operationId: "getPublicBoardTask",
  path: "/{token}/tasks/{number}",
  tags: TAGS,
  summary: "Get a public task",
  security: [],
  middleware: readChain,
  request: { params: taskNumberParam },
  responses: {
    200: jsonResponse("The task", publicTaskDetailSchema),
    404: errorResponse("Unknown board, or the task isn't on the board"),
    429: errorResponse("Too many requests; see Retry-After"),
  },
});

const getTaskDescriptionRoute = createRoute({
  method: "get",
  operationId: "getPublicBoardTaskDescription",
  path: "/{token}/tasks/{number}/description",
  tags: TAGS,
  summary: "Read a public task's long description",
  security: [],
  middleware: readChain,
  request: { params: taskNumberParam, query: descriptionPageQuery },
  responses: {
    200: jsonResponse("A description page", descriptionPageSchema),
    400: errorResponse("Invalid description cursor"),
    404: errorResponse("Unknown board, or the task isn't on the board"),
    409: errorResponse("Description changed"),
    429: errorResponse("Too many requests; see Retry-After"),
    503: errorResponse("Description request timed out"),
  },
});

const listCommentsRoute = createRoute({
  method: "get",
  operationId: "listPublicBoardComments",
  path: "/{token}/tasks/{number}/comments",
  tags: TAGS,
  summary: "List a task's public comments",
  description: "Oldest first. Only when the board has comments on.",
  security: [],
  middleware: readChain,
  request: { params: taskNumberParam, query: commentPageQuery },
  responses: {
    200: jsonResponse("A page of public comments", publicCommentPageSchema),
    400: errorResponse("Invalid cursor or limit"),
    403: errorResponse("Comments are turned off for this board"),
    404: errorResponse("Unknown board, or the task isn't on the board"),
    429: errorResponse("Too many requests; see Retry-After"),
  },
});

const createCommentRoute = createRoute({
  method: "post",
  operationId: "createPublicBoardComment",
  path: "/{token}/tasks/{number}/comments",
  tags: TAGS,
  summary: "Comment on a public task",
  description:
    "Markdown only: HTML, images and mentions are stripped; at most 10 links and 5,000 characters. Accounts, or guests where the board allows them.",
  security: [],
  middleware: writeChain("comment"),
  request: { params: taskNumberParam, body: jsonBody(commentBody) },
  responses: {
    201: jsonResponse("The new comment", publicCommentSchema),
    ...writeErrors,
  },
});

const updateCommentRoute = createRoute({
  method: "patch",
  operationId: "updatePublicBoardComment",
  path: "/{token}/comments/{commentId}",
  tags: TAGS,
  summary: "Edit your public comment",
  security: [],
  middleware: writeChain("manageOwnComment"),
  request: { params: commentParam, body: jsonBody(commentBody) },
  responses: {
    200: jsonResponse("The edited comment", publicCommentSchema),
    ...writeErrors,
  },
});

const deleteCommentRoute = createRoute({
  method: "delete",
  operationId: "deletePublicBoardComment",
  path: "/{token}/comments/{commentId}",
  tags: TAGS,
  summary: "Delete your public comment",
  security: [],
  middleware: writeChain("manageOwnComment"),
  request: { params: commentParam },
  responses: {
    200: jsonResponse("The deleted comment's id", publicIdSchema),
    ...writeErrors,
  },
});

const reactionDescription =
  "Idempotent. Answers the target's reaction counts, never names.";
const reactionResponses = {
  200: jsonResponse("The reaction groups", publicReactionGroupListSchema),
  ...writeErrors,
};

function taskReactionRoute<M extends "put" | "delete">(method: M) {
  return createRoute({
    method,
    operationId:
      method === "put"
        ? "addPublicBoardTaskReaction"
        : "removePublicBoardTaskReaction",
    path: "/{token}/tasks/{number}/reactions/{emoji}",
    tags: TAGS,
    summary:
      method === "put"
        ? "React to a public task"
        : "Remove your reaction from a public task",
    description: reactionDescription,
    security: [],
    middleware: writeChain("react"),
    request: { params: taskReactionParam },
    responses: reactionResponses,
  });
}

function commentReactionRoute<M extends "put" | "delete">(method: M) {
  return createRoute({
    method,
    operationId:
      method === "put"
        ? "addPublicBoardCommentReaction"
        : "removePublicBoardCommentReaction",
    path: "/{token}/comments/{commentId}/reactions/{emoji}",
    tags: TAGS,
    summary:
      method === "put"
        ? "React to a public comment"
        : "Remove your reaction from a public comment",
    description: reactionDescription,
    security: [],
    middleware: writeChain("react"),
    request: { params: commentReactionParam },
    responses: reactionResponses,
  });
}

const addTaskReactionRoute = taskReactionRoute("put");
const removeTaskReactionRoute = taskReactionRoute("delete");
const addCommentReactionRoute = commentReactionRoute("put");
const removeCommentReactionRoute = commentReactionRoute("delete");

const setVoteRoute = createRoute({
  method: "put",
  operationId: "setPublicBoardVote",
  path: "/{token}/tasks/{number}/vote",
  tags: TAGS,
  summary: "Vote on a public task",
  description:
    "One vote per account per task; the same value again is a no-op.",
  security: [],
  middleware: writeChain("vote"),
  request: { params: taskNumberParam, body: jsonBody(voteBody) },
  responses: {
    200: jsonResponse("The task's votes", publicVoteStateSchema),
    ...writeErrors,
  },
});

const removeVoteRoute = createRoute({
  method: "delete",
  operationId: "removePublicBoardVote",
  path: "/{token}/tasks/{number}/vote",
  tags: TAGS,
  summary: "Remove your vote",
  security: [],
  middleware: writeChain("vote"),
  request: { params: taskNumberParam },
  responses: {
    200: jsonResponse("The task's votes", publicVoteStateSchema),
    ...writeErrors,
  },
});

const submitRequestRoute = createRoute({
  method: "post",
  operationId: "submitPublicBoardRequest",
  path: "/{token}/requests",
  tags: TAGS,
  summary: "Submit a request",
  description:
    "Files an intake request (source public_board). It shows on the board only once accepted. Accounts only.",
  security: [],
  middleware: writeChain("request"),
  request: { params: tokenParam, body: jsonBody(requestBody) },
  responses: {
    201: jsonResponse("The request", publicRequestSchema),
    ...writeErrors,
  },
});

const listMyRequestsRoute = createRoute({
  method: "get",
  operationId: "listMyPublicBoardRequests",
  path: "/{token}/requests/mine",
  tags: TAGS,
  summary: "List your requests",
  description: "Your requests on this project, newest first, 20 per page.",
  security: [],
  middleware: [...readChain, requireParticipation("manageOwnRequest")],
  request: { params: tokenParam, query: requestPageQuery },
  responses: {
    200: jsonResponse("A page of requests", publicRequestPageSchema),
    400: errorResponse("Invalid cursor"),
    401: errorResponse("Sign in to take part"),
    403: errorResponse("Requests are off, or guests and API keys can't"),
    404: errorResponse(BOARD_404),
    429: errorResponse("Too many requests; see Retry-After"),
  },
});

const withdrawRequestRoute = createRoute({
  method: "delete",
  operationId: "withdrawPublicBoardRequest",
  path: "/{token}/requests/{requestId}",
  tags: TAGS,
  summary: "Withdraw your open request",
  security: [],
  middleware: [
    ...writeChain("manageOwnRequest"),
    (async (c, next) => {
      await enforceRateLimits([
        [PUBLIC_LIMITS.requestHour, c.get("viewer")?.userId ?? null],
      ]);
      return next();
    }) as MiddlewareHandler,
  ],
  request: { params: requestParam },
  responses: {
    200: jsonResponse("The withdrawn request's id", publicIdSchema),
    ...writeErrors,
    409: errorResponse("This request can't be withdrawn anymore"),
  },
});

type Variables = BaseVariables & PublicBoardVariables;

const publicBoardRouter = apiRouter<Variables>();
publicBoardRouter.use("*", publicResponseHeaders());

const publicBoardApi = publicBoardRouter
  .openapi(getBoardRoute, async (c) =>
    c.json(await getPublicBoard(c.get("board"), c.get("viewer")), 200),
  )
  .openapi(listTasksRoute, async (c) =>
    c.json(
      await listPublicBoardTasks(c.get("board"), c.req.valid("query")),
      200,
    ),
  )
  .openapi(getTaskRoute, async (c) =>
    c.json(
      await getPublicBoardTask(
        c.get("board"),
        c.get("viewer"),
        c.req.valid("param").number,
      ),
      200,
    ),
  )
  .openapi(getTaskDescriptionRoute, async (c) =>
    c.json(
      await getPublicBoardTaskDescription(
        c.get("board"),
        c.req.valid("param").number,
        c.req.valid("query"),
      ),
      200,
    ),
  )
  .openapi(listCommentsRoute, async (c) =>
    c.json(
      await listPublicBoardComments(
        c.get("board"),
        c.get("viewer"),
        c.req.valid("param").number,
        c.req.valid("query"),
      ),
      200,
    ),
  )
  .openapi(createCommentRoute, async (c) =>
    c.json(
      await createPublicBoardComment(
        c.get("board"),
        c.get("viewer"),
        c.req.valid("param").number,
        c.req.valid("json").content,
      ),
      201,
    ),
  )
  .openapi(updateCommentRoute, async (c) =>
    c.json(
      await updatePublicBoardComment(
        c.get("board"),
        c.get("viewer"),
        c.req.valid("param").commentId,
        c.req.valid("json").content,
      ),
      200,
    ),
  )
  .openapi(deleteCommentRoute, async (c) =>
    c.json(
      await deletePublicBoardComment(
        c.get("board"),
        c.get("viewer"),
        c.req.valid("param").commentId,
      ),
      200,
    ),
  )
  .openapi(addTaskReactionRoute, async (c) => {
    const { number, emoji } = c.req.valid("param");
    return c.json(
      await setPublicTaskReaction(
        c.get("board"),
        c.get("viewer"),
        number,
        emoji,
        true,
      ),
      200,
    );
  })
  .openapi(removeTaskReactionRoute, async (c) => {
    const { number, emoji } = c.req.valid("param");
    return c.json(
      await setPublicTaskReaction(
        c.get("board"),
        c.get("viewer"),
        number,
        emoji,
        false,
      ),
      200,
    );
  })
  .openapi(addCommentReactionRoute, async (c) => {
    const { commentId, emoji } = c.req.valid("param");
    return c.json(
      await setPublicCommentReaction(
        c.get("board"),
        c.get("viewer"),
        commentId,
        emoji,
        true,
      ),
      200,
    );
  })
  .openapi(removeCommentReactionRoute, async (c) => {
    const { commentId, emoji } = c.req.valid("param");
    return c.json(
      await setPublicCommentReaction(
        c.get("board"),
        c.get("viewer"),
        commentId,
        emoji,
        false,
      ),
      200,
    );
  })
  .openapi(setVoteRoute, async (c) =>
    c.json(
      await setPublicVote(
        c.get("board"),
        c.get("viewer"),
        c.req.valid("param").number,
        c.req.valid("json").value,
      ),
      200,
    ),
  )
  .openapi(removeVoteRoute, async (c) =>
    c.json(
      await setPublicVote(
        c.get("board"),
        c.get("viewer"),
        c.req.valid("param").number,
        null,
      ),
      200,
    ),
  )
  .openapi(submitRequestRoute, async (c) =>
    c.json(
      await submitPublicBoardRequest(
        c.get("board"),
        c.get("viewer"),
        c.req.valid("json"),
      ),
      201,
    ),
  )
  .openapi(listMyRequestsRoute, async (c) =>
    c.json(
      await listMyPublicBoardRequests(
        c.get("board"),
        c.get("viewer"),
        c.req.valid("query").cursor,
      ),
      200,
    ),
  )
  .openapi(withdrawRequestRoute, async (c) =>
    c.json(
      await withdrawPublicBoardRequest(
        c.get("board"),
        c.get("viewer"),
        c.req.valid("param").requestId,
      ),
      200,
    ),
  );

export default publicBoardApi;
