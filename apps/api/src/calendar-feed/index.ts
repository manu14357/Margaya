import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
  lookupNotFound,
  z,
} from "../openapi";
import { perIpLimit } from "../public-board/gate";
import { createRateLimiter } from "../utils/rate-limit";
import { requireUserSession } from "../utils/require-user-session";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import createCalendarFeed from "./controllers/create-calendar-feed";
import listCalendarFeeds from "./controllers/list-calendar-feeds";
import revokeCalendarFeed from "./controllers/revoke-calendar-feed";
import { renderFeed } from "./feed";
import { calendarFeedListSchema, createdCalendarFeedSchema } from "./response";
import {
  createProjectFeedBody,
  createWorkspaceFeedBody,
  feedIdParam,
  feedTokenParam,
  projectIdParam,
  workspaceIdParam,
} from "./schema";

// Read-only iCalendar subscription feeds. Managing feeds needs a signed-in
// session (a feed URL is a credential, so API keys can't mint one). The
// feed itself is fetched by calendar apps with no session: the secret token
// in its URL is the only credential, and every fetch re-checks access.

const TAGS = ["Calendar feeds"];
const SESSION_NOTE = " Needs a signed-in session; API keys are refused.";
const sessionOrForbidden = errorResponse(
  "An API key instead of a user session, no workspace access, missing task:read, or not a member of the workspace",
);

function jsonBody<T>(schema: T) {
  return { required: true, content: { "application/json": { schema } } };
}

const listRoute = createRoute({
  method: "get",
  operationId: "listCalendarFeeds",
  path: "/workspace/{workspaceId}",
  tags: TAGS,
  summary: "List your calendar feeds",
  description: `Your calendar subscription feeds in a workspace, newest first. The URL token is never returned, only its first characters.${SESSION_NOTE}`,
  middleware: [
    requireUserSession,
    workspaceAccess.fromParam(),
    requireWorkspacePermission({ task: ["read"] }),
  ] as const,
  request: { params: workspaceIdParam },
  responses: {
    200: jsonResponse("Your feeds", calendarFeedListSchema),
    403: sessionOrForbidden,
  },
});

const createWorkspaceFeedRoute = createRoute({
  method: "post",
  operationId: "createWorkspaceCalendarFeed",
  path: "/workspace/{workspaceId}",
  tags: TAGS,
  summary: "Create or regenerate a workspace calendar feed",
  description: `Creates your "my tasks" or "milestones and cycles" feed for the workspace, or gives it a new URL when it exists (the old URL stops working at once). The URL is returned only in this response.${SESSION_NOTE}`,
  middleware: [
    requireUserSession,
    workspaceAccess.fromParam(),
    requireWorkspacePermission({ task: ["read"] }),
  ] as const,
  request: {
    params: workspaceIdParam,
    body: jsonBody(createWorkspaceFeedBody),
  },
  responses: {
    200: jsonResponse(
      "The feed and its URL, shown once",
      createdCalendarFeedSchema,
    ),
    400: errorResponse("Invalid kind or name"),
    403: sessionOrForbidden,
  },
});

const createProjectFeedRoute = createRoute({
  method: "post",
  operationId: "createProjectCalendarFeed",
  path: "/project/{projectId}",
  tags: TAGS,
  summary: "Create or regenerate a project calendar feed",
  description: `Creates your feed of a project's dated tasks, milestones and cycles, or gives it a new URL when it exists (the old URL stops working at once). The URL is returned only in this response.${SESSION_NOTE}`,
  middleware: [
    requireUserSession,
    workspaceAccess.fromProjectId(),
    requireWorkspacePermission({ task: ["read"] }),
  ] as const,
  request: { params: projectIdParam, body: jsonBody(createProjectFeedBody) },
  responses: {
    200: jsonResponse(
      "The feed and its URL, shown once",
      createdCalendarFeedSchema,
    ),
    400: errorResponse("Invalid name"),
    403: sessionOrForbidden,
    404: lookupNotFound("project"),
  },
});

const revokeRoute = createRoute({
  method: "delete",
  operationId: "revokeCalendarFeed",
  path: "/{id}",
  tags: TAGS,
  summary: "Revoke a calendar feed",
  description: `Deletes one of your feeds. Its URL answers 404 from now on, and calendar apps stop updating it.${SESSION_NOTE}`,
  middleware: [requireUserSession] as const,
  request: { params: feedIdParam },
  responses: {
    200: jsonResponse("The revoked feed's id", z.object({ id: z.string() })),
    403: errorResponse("An API key instead of a user session"),
    404: errorResponse("Not one of your feeds"),
  },
});

const calendarFeed = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(listRoute, async (c) =>
    c.json(await listCalendarFeeds(c.get("userId"), c.get("workspaceId")), 200),
  )
  .openapi(createWorkspaceFeedRoute, async (c) =>
    c.json(
      await createCalendarFeed(
        c.get("userId"),
        c.get("workspaceId"),
        c.req.valid("json"),
      ),
      200,
    ),
  )
  .openapi(createProjectFeedRoute, async (c) => {
    const { projectId } = c.req.valid("param");
    return c.json(
      await createCalendarFeed(c.get("userId"), c.get("workspaceId"), {
        kind: "project",
        projectId,
        name: c.req.valid("json").name,
      }),
      200,
    );
  })
  .openapi(revokeRoute, async (c) =>
    c.json(
      await revokeCalendarFeed(c.get("userId"), c.req.valid("param").id),
      200,
    ),
  );

export default calendarFeed;

// Calendar apps poll each feed every hour or so; this bounds token guessing.
const feedReadLimit = createRateLimiter({
  name: "calendar-feed-read",
  windowSeconds: 60,
  max: 60,
});

const getFeedRoute = createRoute({
  method: "get",
  operationId: "getCalendarFeed",
  path: "/{token}/feed.ics",
  tags: TAGS,
  summary: "Get a calendar feed",
  description:
    "The iCalendar (RFC 5545) file a calendar app subscribes to: all-day events for dated tasks, milestones and cycles, in the owner's time zone (else the workspace's). The token in the path is the only credential. It answers 404 once the feed is revoked or regenerated, the owner leaves the workspace or loses access, or the project is hidden or in the trash. Supports If-None-Match.",
  security: [],
  middleware: [perIpLimit(feedReadLimit)] as const,
  request: { params: feedTokenParam },
  responses: {
    200: {
      description: "The iCalendar file",
      content: { "text/calendar": { schema: { type: "string" } } },
    },
    304: { description: "Not modified since the ETag in If-None-Match" },
    404: errorResponse("Unknown, revoked or no longer accessible feed"),
    429: errorResponse("Too many requests; see Retry-After"),
  },
});

/** Mounted before the app-wide auth middleware: the token authenticates. */
export const calendarFeedPublic = apiRouter().openapi(
  getFeedRoute,
  async (c) => {
    const feed = await renderFeed(c.req.valid("param").token);
    const headers = {
      // The URL is a secret: keep it out of shared caches, indexes and
      // referrers.
      "Cache-Control": "private, max-age=900",
      "X-Robots-Tag": "noindex",
      "Referrer-Policy": "no-referrer",
    };
    if (!feed) {
      return new Response("Calendar feed not found", {
        status: 404,
        headers: {
          ...headers,
          "Cache-Control": "no-store",
          "Content-Type": "text/plain; charset=utf-8",
        },
      });
    }
    const etagHeaders = { ...headers, ETag: feed.etag };
    const ifNoneMatch = c.req.header("If-None-Match");
    if (
      ifNoneMatch
        ?.split(",")
        .map((tag) => tag.trim().replace(/^W\//, ""))
        .includes(feed.etag)
    ) {
      return new Response(null, { status: 304, headers: etagHeaders });
    }
    return new Response(feed.body, {
      status: 200,
      headers: {
        ...etagHeaders,
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `inline; filename="${feed.filename}"`,
      },
    });
  },
);
