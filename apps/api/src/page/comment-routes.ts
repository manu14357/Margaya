import { requireEntitlement } from "../billing/require-entitlement-middleware";
import { createRoute, errorResponse, jsonResponse } from "../openapi";
import { pageRoute } from "./middleware";
import {
  deletedPageCommentSchema,
  pageCommentListSchema,
  pageCommentSchema,
  pageSubscriptionSchema,
} from "./response";
import { pageCommentBody, pageCommentParam, pageParam } from "./schema";

// Route definitions for a page's comments and watching. Comments are internal:
// public links never show them.

const TAGS = ["Pages"];
const FEATURE_OFF = "the Pages feature is turned off for the page's project";
const NOT_FOUND = "Unknown page, or another user's private page";

function jsonBody<T>(schema: T) {
  return {
    required: true,
    content: { "application/json": { schema } },
  };
}

export const listPageCommentsRoute = createRoute({
  method: "get",
  operationId: "listPageComments",
  path: "/{id}/comments",
  tags: TAGS,
  summary: "List page comments",
  description:
    "Every comment on the page, oldest first, with its author's name and avatar. Needs page:read.",
  middleware: [...pageRoute("read")] as const,
  request: { params: pageParam },
  responses: {
    200: jsonResponse("The comments", pageCommentListSchema),
    403: errorResponse(`Missing page:read, or ${FEATURE_OFF}`),
    404: errorResponse(NOT_FOUND),
  },
});

export const createPageCommentRoute = createRoute({
  method: "post",
  operationId: "createPageComment",
  path: "/{id}/comments",
  tags: TAGS,
  summary: "Add a page comment",
  description:
    "Add a comment. Works on a locked page, not on an archived one. Mentioned workspace members are notified, the page's watchers hear about it, and the author and those mentioned start watching. Needs page:update.",
  middleware: [...pageRoute("update"), requireEntitlement] as const,
  request: { params: pageParam, body: jsonBody(pageCommentBody) },
  responses: {
    200: jsonResponse("The new comment", pageCommentSchema),
    400: errorResponse("Empty content, or more than 20,000 characters"),
    403: errorResponse(`Missing page:update, or ${FEATURE_OFF}`),
    404: errorResponse(NOT_FOUND),
    409: errorResponse("The page is archived"),
  },
});

export const updatePageCommentRoute = createRoute({
  method: "put",
  operationId: "updatePageComment",
  path: "/{id}/comments/{commentId}",
  tags: TAGS,
  summary: "Edit a page comment",
  description:
    "Edit a comment. Only its author may do this, and not on an archived page. People newly mentioned are notified.",
  middleware: [...pageRoute("update"), requireEntitlement] as const,
  request: { params: pageCommentParam, body: jsonBody(pageCommentBody) },
  responses: {
    200: jsonResponse("The updated comment", pageCommentSchema),
    400: errorResponse("Empty content, or more than 20,000 characters"),
    403: errorResponse(
      `Not the author, missing page:update, or ${FEATURE_OFF}`,
    ),
    404: errorResponse("Unknown page or comment"),
    409: errorResponse("The page is archived"),
  },
});

export const deletePageCommentRoute = createRoute({
  method: "delete",
  operationId: "deletePageComment",
  path: "/{id}/comments/{commentId}",
  tags: TAGS,
  summary: "Delete a page comment",
  description:
    "Delete a comment: its author with page:update, or anyone with page:delete.",
  middleware: [...pageRoute("read")] as const,
  request: { params: pageCommentParam },
  responses: {
    200: jsonResponse("The deleted comment", deletedPageCommentSchema),
    403: errorResponse(`Not the author or an admin, or ${FEATURE_OFF}`),
    404: errorResponse("Unknown page or comment"),
  },
});

// Watching is personal and changes nothing on the page, so page:read is
// enough (viewers can watch pages).
const subscriptionResponses = {
  200: jsonResponse("The caller's subscription", pageSubscriptionSchema),
  403: errorResponse(`Missing page:read, or ${FEATURE_OFF}`),
  404: errorResponse(NOT_FOUND),
};

export const getPageSubscriptionRoute = createRoute({
  method: "get",
  operationId: "getPageSubscription",
  path: "/{id}/subscription",
  tags: TAGS,
  summary: "Get page subscription",
  description:
    "Whether the current user watches the page. Watchers hear about new comments and, at most once an hour, content changes.",
  middleware: [...pageRoute("read")] as const,
  request: { params: pageParam },
  responses: subscriptionResponses,
});

export const subscribeToPageRoute = createRoute({
  method: "put",
  operationId: "subscribeToPage",
  path: "/{id}/subscription",
  tags: TAGS,
  summary: "Watch a page",
  description:
    "Start watching the page, also after an earlier unwatch. Idempotent.",
  middleware: [...pageRoute("read")] as const,
  request: { params: pageParam },
  responses: subscriptionResponses,
});

export const unsubscribeFromPageRoute = createRoute({
  method: "delete",
  operationId: "unsubscribeFromPage",
  path: "/{id}/subscription",
  tags: TAGS,
  summary: "Stop watching a page",
  description:
    "Stop watcher notifications for the page, also as its owner. Mentions still notify. Commenting or being mentioned starts watching again. Idempotent.",
  middleware: [...pageRoute("read")] as const,
  request: { params: pageParam },
  responses: subscriptionResponses,
});
