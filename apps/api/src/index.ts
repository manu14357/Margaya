import "./instrument";

import { dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { OpenAPIHono } from "@hono/zod-openapi";
import * as Sentry from "@sentry/node";
import type { Session, User } from "better-auth/types";
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Hono } from "hono";
import { compress } from "hono/compress";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import activity from "./activity";
import analytics from "./analytics";
import archive from "./archive";
import auditLog, { auditCapture } from "./audit-log";
import { auth } from "./auth";
import { organizationRoutes } from "./auth-openapi";
import billing from "./billing";
import column from "./column";
import comment from "./comment";
import config from "./config";
import customField from "./custom-field";
import cycle from "./cycle";
import db, { getDatabase, schema } from "./database";
import { prepareDatabaseStartup } from "./database/prepare-database-startup";
import { waitForDatabase } from "./database/wait-for-database";
import discordIntegration from "./discord-integration";
import estimate from "./estimate";
import { eventContext } from "./events";
import externalLink from "./external-link";
import favorite from "./favorite";
import genericWebhookIntegration from "./generic-webhook-integration";
import giteaIntegration, { handleGiteaWebhookRoute } from "./gitea-integration";
import githubIntegration, {
  handleGithubWebhookRoute,
} from "./github-integration";
import home from "./home";
import getInstanceStatus from "./instance/controllers/get-instance-status";
import instanceAdmin from "./instance-admin";
import {
  initializeInstanceSettings,
  stopInstanceSettings,
} from "./instance-settings/snapshot";
import intake from "./intake";
import invitation from "./invitation";
import jiraImport from "./jira-import";
import label from "./label";
import mattermostIntegration from "./mattermost-integration";
import mcpRoutes, { mcpWellKnownRoutes } from "./mcp";
import { migrateColumns } from "./migrations/column-migration";
import { migrateNotificationInbox } from "./migrations/notification-inbox-migration";
import { migratePublications } from "./migrations/publication-migration";
import { migrateTaskArchive } from "./migrations/task-archive-migration";
import { migrateTaskAssignees } from "./migrations/task-assignee-migration";
import moduleRouter from "./module";
import notification from "./notification";
import notificationPreferences from "./notification-preferences";
import oauth from "./oauth";
import { createRoute, errorResponse, jsonResponse, z } from "./openapi";
import page from "./page";
import { shutdownPageRooms } from "./page/collab/rooms";
import { pageCollabWebSocket } from "./page/collab/ws-route";
import { initializePlugins } from "./plugins";
import { migrateGitHubIntegration } from "./plugins/github/migration";
import project from "./project";
import projectAutomation from "./project-automation";
import publicBoard from "./public-board";
import { perIpLimit, publicResponseHeaders } from "./public-board/gate";
import {
  legacyProjectDescription,
  legacyPublicProject,
  legacyTaskDescription,
} from "./public-board/legacy";
import { PUBLIC_LIMITS } from "./public-board/limits";
import publication from "./publication";
import quickLink from "./quick-link";
import reaction from "./reaction";
import recentVisit from "./recent-visit";
import trash from "./trash";
import "./recent-visit/subscribers";
import { initializeScheduler, shutdownScheduler } from "./scheduler";
import search from "./search";
import slackIntegration from "./slack-integration";
import sticky from "./sticky";
import { getPrivateObject } from "./storage/s3";
import subscription from "./subscription";
import task from "./task";
import { boardSchema, descriptionPageSchema } from "./task/response";
import { descriptionPageQuery, listTasksQuery } from "./task/schema";
import taskAttachment from "./task-attachment";
import taskCopy from "./task-copy";
import taskDraft from "./task-draft";
import taskExport from "./task-export";
import { stopExportRunner } from "./task-export/runner";
import taskLink from "./task-link";
import taskQuery from "./task-query";
import taskRelation from "./task-relation";
import telegramIntegration from "./telegram-integration";
import timeEntry from "./time-entry";
import user from "./user";
import getAvatar from "./user/controllers/get-avatar";
import { applyRateLimitHeaders } from "./utils/api-key-rate-limit";
import { authenticateApiRequest } from "./utils/authenticate-api-request";
import {
  authorizeAssetAccess,
  isPublicAsset,
} from "./utils/authorize-asset-access";
import { backfillRolePermissions } from "./utils/backfill-role-permissions";
import { getInvitationDetails } from "./utils/check-registration-allowed";
import { clientIpMiddleware } from "./utils/client-ip";
import { forwardToAuth } from "./utils/forward-to-auth";
import { migrateApiKeyReferenceId } from "./utils/migrate-apikey-reference-id";
import { migrateNotificationPreferencesSchema } from "./utils/migrate-notification-preferences-schema";
import { migrateSessionColumn } from "./utils/migrate-session-column";
import { migrateWorkspaceUserEmail } from "./utils/migrate-workspace-user-email";
import { normalizeApiServerUrl } from "./utils/openapi-spec";
import { seedDefaultWorkspaceRoles } from "./utils/seed-default-workspace-roles";
import { validateWorkspaceAccess } from "./utils/validate-workspace-access";
import view from "./view";
import webhook from "./webhook";
import {
  startWebhookDispatcher,
  stopWebhookDispatcher,
} from "./webhook/dispatch/dispatcher";
import workflowRule from "./workflow-rule";
import workspace from "./workspace";
import {
  addConnection,
  addUserConnection,
  initializeWebSocketAdapter,
  removeConnection,
  removeUserConnection,
  shutdownWebSocketAdapter,
} from "./ws";
import {
  assertWebSocketOrigin,
  handleWebSocketMessage,
  MAX_WEBSOCKET_FRAME_BYTES,
} from "./ws/security";

type ApiKey = {
  id: string;
  userId: string;
  enabled: boolean;
  permissions: Record<string, string[]> | null;
};

type AppVariables = {
  Variables: {
    user: User | null;
    session: Session | null;
    userId: string;
    apiKey?: ApiKey;
  };
};

type ApiVariables = {
  Variables: {
    user: User | null;
    session: Session | null;
    userId: string;
    userEmail: string;
    apiKey?: ApiKey;
  };
};

const SAFE_INLINE_ASSET_TYPES = new Set([
  "image/apng",
  "image/avif",
  "image/gif",
  "image/heic",
  "image/heif",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

function buildContentDisposition(filename: string, inline: boolean) {
  const normalized = filename
    .normalize("NFC")
    .replace(/[\r\n"]/g, "")
    .trim();
  const safeFilename = normalized || "file";
  const asciiFallback =
    safeFilename
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[\\/]/g, "-")
      .replace(/[^\x20-\x7E]+/g, "_")
      .replace(/\s+/g, " ")
      .trim() || "file";
  const encodedFilename = encodeURIComponent(safeFilename).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );

  const disposition = inline ? "inline" : "attachment";
  return `${disposition}; filename="${asciiFallback}"; filename*=UTF-8''${encodedFilename}`;
}

export function createApp() {
  const app = new Hono<AppVariables>();
  app.use("*", clientIpMiddleware());

  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      // expected errors (401/404/...) are not reported; real failures are
      if (err.status >= 500) {
        Sentry.captureException(err);
      }
      return err.getResponse();
    }

    Sentry.captureException(err);
    return c.json({ message: "Internal Server Error" }, 500);
  });
  const nodeWs = createNodeWebSocket({ app });
  // node-ws exposes its ws server, but does not accept constructor options.
  // Set the receiver limit before any connection can upgrade, including
  // fragmented messages, before node-ws converts text buffers to strings.
  // 1 MiB for page collaboration; the project and user sockets keep their
  // 64-byte rule in handleWebSocketMessage (see ws/security.ts).
  nodeWs.wss.options.maxPayload = MAX_WEBSOCKET_FRAME_BYTES;
  nodeWs.wss.options.perMessageDeflate = false;
  const { upgradeWebSocket, injectWebSocket } = nodeWs;
  const corsOriginSource = [
    process.env.CORS_ORIGINS,
    process.env.MARGAYA_CLIENT_URL,
  ].find((value) => value?.trim());
  const corsOrigins = corsOriginSource
    ?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  const reflectUnconfiguredOrigins = process.env.NODE_ENV !== "production";

  if (!corsOrigins && !reflectUnconfiguredOrigins) {
    console.warn(
      "[cors] Neither CORS_ORIGINS nor MARGAYA_CLIENT_URL is set, so cross-origin requests are refused. Same-origin deployments (the bundled image) are unaffected; set MARGAYA_CLIENT_URL if the web app is served from another origin.",
    );
  }

  app.use(
    "*",
    cors({
      credentials: true,
      origin: (origin) => {
        // Reflecting an arbitrary origin alongside credentials lets any site
        // read authenticated responses, so it stays a development convenience.
        if (!corsOrigins) {
          return reflectUnconfiguredOrigins ? origin || "*" : null;
        }

        if (!origin) {
          return null;
        }

        return corsOrigins.includes(origin) ? origin : null;
      },
    }),
  );

  // Large boards return multi-MB JSON (board/task list responses embed
  // labels and external links per task); gzip cuts that by 85-95% since
  // JSON with repeated keys compresses extremely well.
  app.use(compress());

  const api = new OpenAPIHono<ApiVariables>();

  api.get("/health", (c) => {
    return c.json({ status: "ok" });
  });

  api.openapi(
    createRoute({
      method: "get",
      operationId: "getInstanceStatus",
      path: "/instance/status",
      tags: ["Instance"],
      summary: "Get instance status",
      description:
        "Public instance setup status. When hasUsers is false the next signup becomes the instance admin.",
      security: [],
      responses: {
        200: jsonResponse(
          "Instance status",
          z
            .object({ hasUsers: z.boolean(), hasAdmin: z.boolean() })
            .openapi("InstanceStatus"),
        ),
      },
    }),
    async (c) => c.json(await getInstanceStatus(), 200),
  );

  // Deprecated: `{id}` is a board link token (B12 §3.4).
  const legacyPublicMiddleware = [
    publicResponseHeaders(),
    perIpLimit(PUBLIC_LIMITS.read),
  ];
  const publicProjectApi = api
    .openapi(
      createRoute({
        method: "get",
        operationId: "getPublicProject",
        path: "/public-project/{id}",
        tags: ["Projects"],
        summary: "Get a public project board",
        deprecated: true,
        middleware: legacyPublicMiddleware,
        description:
          "Read a public board in bounded task pages. Visibility is checked before loading tasks. Continue through pagination.totalPages for all tasks and through relatedPage/pagination.relatedTotalPages for their complete related records.",
        security: [],
        request: {
          params: z.object({ id: z.string() }),
          query: listTasksQuery,
        },
        responses: {
          200: jsonResponse(
            "A public board page",
            boardSchema.shape.data
              .extend({ pagination: boardSchema.shape.pagination })
              .openapi("PublicBoardPage"),
          ),
          404: errorResponse(
            "Unknown link, an unpublished or archived board, or public boards are off",
          ),
          400: errorResponse("Invalid pagination or filters"),
          503: errorResponse("Task list request timed out"),
        },
      }),
      async (c) => {
        const { id } = c.req.valid("param");
        const project = await legacyPublicProject(id, c.req.valid("query"));
        return c.json(project, 200);
      },
      (result) => {
        if (!result.success)
          throw new HTTPException(400, {
            message: "Invalid task pagination or filters",
          });
      },
    )
    .openapi(
      createRoute({
        method: "get",
        operationId: "getPublicProjectDescriptionPage",
        path: "/public-project/{id}/description",
        tags: ["Projects"],
        summary: "Read a public project description page",
        deprecated: true,
        middleware: legacyPublicMiddleware,
        security: [],
        request: {
          params: z.object({ id: z.string() }),
          query: descriptionPageQuery,
        },
        responses: {
          200: jsonResponse(
            "Public project description page",
            descriptionPageSchema,
          ),
          400: errorResponse("Invalid description cursor"),
          404: errorResponse("Public project not found"),
          409: errorResponse("Description changed or no longer public"),
          503: errorResponse("Description request timed out"),
        },
      }),
      async (c) =>
        c.json(
          await legacyProjectDescription(
            c.req.valid("param").id,
            c.req.valid("query"),
          ),
          200,
        ),
      (result) => {
        if (!result.success)
          throw new HTTPException(400, {
            message: "Invalid description cursor",
          });
      },
    )
    .openapi(
      createRoute({
        method: "get",
        operationId: "getPublicTaskDescriptionPage",
        path: "/public-project/{id}/task/{taskId}/description",
        tags: ["Projects"],
        summary: "Read a public task description page",
        deprecated: true,
        middleware: legacyPublicMiddleware,
        security: [],
        request: {
          params: z.object({ id: z.string(), taskId: z.string() }),
          query: descriptionPageQuery,
        },
        responses: {
          200: jsonResponse(
            "Public task description page",
            descriptionPageSchema,
          ),
          400: errorResponse("Invalid description cursor"),
          404: errorResponse("Public task not found"),
          409: errorResponse("Description changed or no longer public"),
          503: errorResponse("Description request timed out"),
        },
      }),
      async (c) => {
        const { id, taskId } = c.req.valid("param");
        return c.json(
          await legacyTaskDescription(id, taskId, c.req.valid("query")),
          200,
        );
      },
      (result) => {
        if (!result.success)
          throw new HTTPException(400, {
            message: "Invalid description cursor",
          });
      },
    );

  // Before the app-wide auth middleware: each route resolves its own viewer.
  const publicBoardApi = api.route("/public-board", publicBoard);

  api.post("/github-integration/webhook", handleGithubWebhookRoute);

  api.post(
    "/gitea-integration/webhook/:integrationId",
    handleGiteaWebhookRoute,
  );

  const invitationPublicApi = api.get("/invitation/public/:id", async (c) => {
    const { id } = c.req.param();
    const result = await getInvitationDetails(id);
    return c.json(result);
  });

  api.openapi(
    createRoute({
      method: "get",
      operationId: "getSession",
      path: "/auth/get-session",
      tags: ["Authentication"],
      summary: "Get session",
      description:
        "Get the current authenticated session, or null when the caller is not signed in. Served by Better Auth.",
      security: [],
      responses: {
        200: {
          description: "Current session details, or null when unauthenticated",
        },
      },
    }),
    (c) => forwardToAuth(c.req.raw),
  );

  api.openapi(
    createRoute({
      method: "get",
      operationId: "getAsset",
      path: "/asset/{id}",
      tags: ["Assets"],
      summary: "Download asset",
      description:
        "Download an uploaded asset. Readable without signing in only when it is a description image of a public project (task attachments never are); image types are served inline, everything else as an attachment. Add ?download=1 to always download.",
      security: [],
      request: {
        params: z.object({ id: z.string() }),
        query: z.object({
          download: z.string().optional().openapi({
            description:
              "1 or true forces an attachment Content-Disposition, even for images.",
          }),
        }),
      },
      responses: {
        200: {
          description: "The requested asset binary stream",
          content: { "*/*": { schema: { type: "string", format: "binary" } } },
        },
        304: { description: "Not modified" },
        403: { description: "No access to this asset" },
        404: { description: "Asset not found" },
      },
    }),
    async (c) => {
      const { id } = c.req.param();
      const [asset] = await db
        .select({
          id: schema.assetTable.id,
          objectKey: schema.assetTable.objectKey,
          mimeType: schema.assetTable.mimeType,
          filename: schema.assetTable.filename,
          surface: schema.assetTable.surface,
          workspaceId: schema.assetTable.workspaceId,
          isPublic: schema.projectTable.isPublic,
          pageAccess: schema.pageTable.access,
          pageOwnerId: schema.pageTable.ownerId,
          // B12 §3.13: comment uploads are not linked to their comment
          // row, so a public comment is found by its reference to the asset.
          inPublicComment: sql<boolean>`exists (
            select 1 from ${schema.activityTable}
            where ${schema.activityTable.taskId} = ${schema.assetTable.taskId}
              and ${schema.activityTable.type} = 'comment'
              and ${schema.activityTable.visibility} = 'public'
              and ${schema.activityTable.content} like '%/api/asset/' || ${schema.assetTable.id} || '%'
          )`,
        })
        .from(schema.assetTable)
        .innerJoin(
          schema.projectTable,
          eq(schema.assetTable.projectId, schema.projectTable.id),
        )
        .leftJoin(
          schema.pageTable,
          eq(schema.assetTable.pageId, schema.pageTable.id),
        )

        .where(eq(schema.assetTable.id, id))
        .limit(1);

      if (!asset) {
        throw new HTTPException(404, { message: "Asset not found" });
      }

      await authorizeAssetAccess(c, asset);

      try {
        const object = await getPrivateObject(asset.objectKey);
        const storedContentType =
          (object.contentType || asset.mimeType)
            .toLowerCase()
            .split(";")[0]
            ?.trim() ?? "";
        const download = c.req.query("download");
        const forceDownload = download === "1" || download === "true";
        const inline =
          !forceDownload && SAFE_INLINE_ASSET_TYPES.has(storedContentType);

        return new Response(object.body as BodyInit, {
          headers: {
            "Cache-Control": isPublicAsset(asset)
              ? "public, max-age=300"
              : "private, max-age=120",
            "Content-Disposition": buildContentDisposition(
              asset.filename,
              inline,
            ),
            "Content-Length": object.contentLength?.toString() || "",
            "Content-Type": inline
              ? storedContentType
              : "application/octet-stream",
            "X-Content-Type-Options": "nosniff",
            ETag: object.etag || "",
            "Last-Modified": object.lastModified?.toUTCString() || "",
          },
        });
      } catch (error) {
        console.error("Failed to stream asset:", error);
        throw new HTTPException(404, { message: "Asset object not found" });
      }
    },
  );

  api.openapi(
    createRoute({
      method: "get",
      operationId: "getUserAvatar",
      path: "/user/avatar/{id}",
      tags: ["User"],
      summary: "Download avatar",
      description:
        "Download a user avatar by its avatar ID. Public, immutable, and cache-friendly: the id changes whenever the avatar is replaced.",
      security: [],
      request: { params: z.object({ id: z.string() }) },
      responses: {
        200: {
          description: "The avatar image",
          content: {
            "image/*": { schema: { type: "string", format: "binary" } },
          },
        },
        304: { description: "Not modified" },
        404: { description: "Avatar not found" },
      },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const avatar = await getAvatar(id);

      if (!avatar) {
        throw new HTTPException(404, { message: "Avatar not found" });
      }

      const etag = `"${avatar.id}"`;
      if (c.req.header("If-None-Match") === etag) {
        return new Response(null, { status: 304, headers: { ETag: etag } });
      }

      return new Response(new Uint8Array(avatar.data) as BodyInit, {
        headers: {
          "Cache-Control": "public, max-age=31536000, immutable",
          "Content-Length": avatar.size.toString(),
          "Content-Type": avatar.mimeType,
          "X-Content-Type-Options": "nosniff",
          ETag: etag,
          "Last-Modified": avatar.updatedAt.toUTCString(),
        },
      });
    },
  );

  const configApi = api.route("/config", config);

  api.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", {
    type: "http",
    scheme: "bearer",
    description: "API key or session token (Bearer)",
  });
  organizationRoutes(api.openAPIRegistry);

  api.get("/openapi", (c) => {
    const document = api.getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "Margaya API",
        version: "1.0.0",
        description:
          "Margaya Project Management API - Manage projects, tasks, labels, and more",
      },
      servers: [
        {
          url: normalizeApiServerUrl(
            process.env.MARGAYA_API_URL || "https://cloud.margaya.app",
          ),
          description: "Margaya API Server",
        },
      ],
      security: [{ bearerAuth: [] }],
    });

    // Every authenticated route sits behind the same app-wide
    // authenticateApiRequest middleware, so the shared 401 is injected here
    // rather than repeated on all ~120 route definitions. Routes that opt out
    // of auth declare `security: []` and are skipped.
    const httpMethods = [
      "get",
      "post",
      "put",
      "delete",
      "patch",
      "options",
      "head",
      "trace",
    ];
    const paths = (document.paths ?? {}) as Record<
      string,
      Record<
        string,
        { responses?: Record<string, unknown>; security?: unknown[] }
      >
    >;
    for (const operations of Object.values(paths)) {
      for (const [method, operation] of Object.entries(operations)) {
        if (!httpMethods.includes(method) || !operation.responses) continue;
        if (
          Array.isArray(operation.security) &&
          operation.security.length === 0
        ) {
          continue;
        }
        operation.responses["401"] ??= {
          description: "Missing or invalid credentials",
        };
      }
    }

    return c.json(document);
  });

  // Better Auth serves GET /auth/device as JSON. Browsers that open the API URL
  // directly expect a page, so redirect full document navigations to the web app.
  const authDeviceQuerySchema = z.object({
    user_code: z.string().optional().openapi({
      description: "The device authorization user code.",
    }),
    ui: z.enum(["1"]).optional().openapi({
      description:
        "Force a redirect to the web UI, for clients that do not send Sec-Fetch-* headers.",
    }),
  });

  api.openapi(
    createRoute({
      method: "get",
      operationId: "getDeviceAuthorizationPage",
      path: "/auth/device",
      tags: ["Authentication"],
      summary: "Device authorization page",
      description:
        "Better Auth serves this as JSON. A top-level browser navigation is redirected to the web app's device screen instead, so opening the URL by hand shows a page rather than a JSON blob.",
      security: [],
      request: { query: authDeviceQuerySchema },
      responses: {
        302: {
          description: "Redirects the browser to the web app device screen",
        },
        200: { description: "Device authorization payload from Better Auth" },
      },
    }),
    async (c) => {
      const { user_code: userCode, ui } = c.req.valid("query");
      const secFetchDest = c.req.header("Sec-Fetch-Dest");
      const forceUiRedirect = ui === "1";
      // Top-level browser tab / address bar (not `fetch()` / XHR from the SPA).
      // Optional `ui=1` forces redirect when Sec-Fetch-* headers are missing (e.g. some clients).
      if (forceUiRedirect || secFetchDest === "document") {
        const clientUrl = (
          process.env.MARGAYA_CLIENT_URL || "http://localhost:5173"
        ).replace(/\/$/, "");
        const deviceUrl = new URL(`${clientUrl}/device`);
        if (userCode) {
          deviceUrl.searchParams.set("user_code", userCode);
        }
        return c.redirect(deviceUrl.toString(), 302);
      }
      return auth.handler(c.req.raw);
    },
  );

  // Before the auth routes: the audit log records their outcomes too.
  api.use("*", auditCapture());

  api.on(["POST", "GET", "PUT", "PATCH", "DELETE"], "/auth/*", (c) =>
    forwardToAuth(c.req.raw),
  );

  api.route("/", mcpRoutes);

  api.use("*", async (c, next) => {
    const path = c.req.path;
    if (
      path.startsWith("/api/mcp") ||
      path.startsWith("/api/.well-known/") ||
      path === "/api/billing/webhook"
    ) {
      return next();
    }
    return Sentry.withIsolationScope(async () => {
      Sentry.setUser(null);
      try {
        await authenticateApiRequest(c);
        const windowId = c.req.header("X-Margaya-Window-Id");
        const userId = c.get("userId");
        const initiatorId = windowId ? `${userId}:${windowId}` : userId;
        await eventContext.run({ initiatorId }, next);
        // After next(): the final response, error responses included.
        applyRateLimitHeaders(c);
        return;
      } catch (error) {
        if (!(error instanceof HTTPException)) {
          console.error("API authentication failed:", error);
          throw new HTTPException(500, { message: "Internal Server Error" });
        }
        throw error;
      } finally {
        Sentry.setUser(null);
      }
    });
  });

  const oauthApi = api.route("/oauth", oauth);

  const billingApi = api.route("/billing", billing);
  const projectApi = api.route("/project", project);
  const taskApi = api.route("/task", task);
  const columnApi = api.route("/column", column);
  const activityApi = api.route("/activity", activity);
  const commentApi = api.route("/comment", comment);
  const timeEntryApi = api.route("/time-entry", timeEntry);
  const labelApi = api.route("/label", label);
  const notificationApi = api.route("/notification", notification);
  const notificationPreferencesApi = api.route(
    "/notification-preferences",
    notificationPreferences,
  );
  const searchApi = api.route("/search", search);
  const githubIntegrationApi = api.route(
    "/github-integration",
    githubIntegration,
  );
  const giteaIntegrationApi = api.route("/gitea-integration", giteaIntegration);
  const genericWebhookIntegrationApi = api.route(
    "/generic-webhook-integration",
    genericWebhookIntegration,
  );
  const discordIntegrationApi = api.route(
    "/discord-integration",
    discordIntegration,
  );
  const mattermostIntegrationApi = api.route(
    "/mattermost-integration",
    mattermostIntegration,
  );
  const slackIntegrationApi = api.route("/slack-integration", slackIntegration);
  const telegramIntegrationApi = api.route(
    "/telegram-integration",
    telegramIntegration,
  );
  const taskRelationApi = api.route("/task-relation", taskRelation);
  const taskLinkApi = api.route("/task-link", taskLink);
  const taskAttachmentApi = api.route("/task-attachment", taskAttachment);
  const taskCopyApi = api.route("/task-copy", taskCopy);
  const jiraImportApi = api.route("/jira-import", jiraImport);
  const externalLinkApi = api.route("/external-link", externalLink);
  const workflowRuleApi = api.route("/workflow-rule", workflowRule);
  const invitationApi = api.route("/invitation", invitation);
  const workspaceApi = api.route("/workspace", workspace);
  const customFieldApi = api.route("/custom-field", customField);
  const userApi = api.route("/user", user);
  const favoriteApi = api.route("/favorite", favorite);
  const recentVisitApi = api.route("/recent-visit", recentVisit);
  const cycleApi = api.route("/cycle", cycle);
  const moduleApi = api.route("/module", moduleRouter);
  const estimateApi = api.route("/estimate", estimate);
  const intakeApi = api.route("/intake", intake);
  const taskQueryApi = api.route("/task-query", taskQuery);
  const subscriptionApi = api.route("/subscription", subscription);
  const reactionApi = api.route("/reaction", reaction);
  const viewApi = api.route("/view", view);
  const stickyApi = api.route("/sticky", sticky);
  const quickLinkApi = api.route("/quick-link", quickLink);
  const homeApi = api.route("/home", home);
  const analyticsApi = api.route("/analytics", analytics);
  const taskDraftApi = api.route("/task-draft", taskDraft);
  const taskExportApi = api.route("/task-export", taskExport);
  const archiveApi = api.route("/archive", archive);
  const trashApi = api.route("/trash", trash);
  const projectAutomationApi = api.route(
    "/project-automation",
    projectAutomation,
  );
  const pageApi = api.route("/page", page);
  const webhookApi = api.route("/webhook", webhook);
  const auditLogApi = api.route("/audit-log", auditLog);
  const publicationApi = api.route("/publication", publication);
  const instanceAdminApi = api.route("/instance-admin", instanceAdmin);

  app.route(
    "/",
    mcpWellKnownRoutes(
      (process.env.MARGAYA_API_URL || "http://localhost:1337").replace(
        /\/api\/?$/,
        "",
      ),
    ),
  );

  // Page collaboration socket (Yjs sync and awareness, binary frames).
  api.get("/ws/page/:pageId", pageCollabWebSocket(upgradeWebSocket));

  // User-scoped WebSocket endpoint; MUST be registered before /ws/:projectId
  // so the literal path "user" isn't consumed by the param route.
  api.get(
    "/ws/user",
    upgradeWebSocket(async (c) => {
      assertWebSocketOrigin(c.req.raw.headers);
      try {
        await authenticateApiRequest(c);
      } catch (error) {
        if (error instanceof HTTPException) {
          throw error;
        }
        console.error("API authentication failed:", error);
        throw new HTTPException(500, { message: "Internal Server Error" });
      }

      const userId = c.get("userId");
      let conn: ReturnType<typeof addUserConnection> | null = null;

      return {
        onOpen(_evt, ws) {
          if (userId) {
            conn = addUserConnection(userId, ws);
          }
        },
        onMessage: handleWebSocketMessage,
        onClose() {
          if (conn && userId) {
            removeUserConnection(userId, conn);
          }
        },
      };
    }),
  );

  api.get(
    "/ws/:projectId",
    upgradeWebSocket(async (c) => {
      assertWebSocketOrigin(c.req.raw.headers);
      const projectId = c.req.param("projectId");

      try {
        await authenticateApiRequest(c);
      } catch (error) {
        if (error instanceof HTTPException) {
          throw error;
        }
        console.error("API authentication failed:", error);
        throw new HTTPException(500, { message: "Internal Server Error" });
      }

      const userId = c.get("userId");

      if (projectId) {
        const [project] = await db
          .select({
            workspaceId: schema.projectTable.workspaceId,
            deletedAt: schema.projectTable.deletedAt,
          })
          .from(schema.projectTable)
          .where(eq(schema.projectTable.id, projectId))
          .limit(1);

        // A trashed project (C7) reads as gone.
        if (!project || project.deletedAt) {
          throw new HTTPException(401, { message: "Unauthorized" });
        }

        await validateWorkspaceAccess(userId, project.workspaceId);
      }

      const windowId = c.req.query("windowId");
      const initiatorId = windowId ? `${userId}:${windowId}` : userId;
      let conn: ReturnType<typeof addConnection> | null = null;

      return {
        onOpen(_evt, ws) {
          if (projectId) {
            conn = addConnection(projectId, ws, userId, initiatorId);
          }
        },
        onMessage: handleWebSocketMessage,
        onClose() {
          if (conn && projectId) {
            removeConnection(projectId, conn);
          }
        },
      };
    }),
  );

  app.route("/api", api);

  return {
    app,
    api,
    injectWebSocket,
    activityApi,
    billingApi,
    columnApi,
    commentApi,
    configApi,
    discordIntegrationApi,
    externalLinkApi,
    favoriteApi,
    genericWebhookIntegrationApi,
    githubIntegrationApi,
    giteaIntegrationApi,
    invitationApi,
    invitationPublicApi,
    labelApi,
    notificationApi,
    notificationPreferencesApi,
    projectApi,
    publicProjectApi,
    publicBoardApi,
    publicationApi,
    instanceAdminApi,
    recentVisitApi,
    searchApi,
    mattermostIntegrationApi,
    slackIntegrationApi,
    taskApi,
    taskRelationApi,
    taskLinkApi,
    taskAttachmentApi,
    taskCopyApi,
    jiraImportApi,
    telegramIntegrationApi,
    timeEntryApi,
    userApi,
    workflowRuleApi,
    workspaceApi,
    customFieldApi,
    cycleApi,
    moduleApi,
    estimateApi,
    intakeApi,
    taskQueryApi,
    subscriptionApi,
    reactionApi,
    viewApi,
    stickyApi,
    quickLinkApi,
    homeApi,
    analyticsApi,
    taskDraftApi,
    taskExportApi,
    archiveApi,
    trashApi,
    projectAutomationApi,
    pageApi,
    webhookApi,
    auditLogApi,
    oauthApi,
  };
}

export async function runStartupTasks() {
  const currentDir = dirname(fileURLToPath(import.meta.url));

  await prepareDatabaseStartup({
    waitForDatabase: async () => {
      await waitForDatabase({
        query: async () => {
          await getDatabase().execute(sql`SELECT 1`);
        },
      });
    },
    runStartupMigrations: async () => {
      await migrateWorkspaceUserEmail();
      await migrateSessionColumn();

      console.log("🔄 Migrating database...");
      await migrate(getDatabase(), {
        migrationsFolder: `${currentDir}/../drizzle`,
      });
      console.log("✅ Database migrated successfully!");
    },
  });

  // After Drizzle migrations: apikey table must exist so we can align columns
  // with Better Auth (reference_id + nullable user_id).
  await migrateApiKeyReferenceId();

  await migrateNotificationPreferencesSchema();
  await migrateGitHubIntegration();
  await migrateColumns();
  // After the columns exist: archived tasks get their column back (D7).
  await migrateTaskArchive();
  await migrateTaskAssignees();
  // After both: it needs task_assignee rows and task.created_by (B10).
  await migrateNotificationInbox();
  // B12: boards public before publications existed keep their links.
  await migratePublications();
  await seedDefaultWorkspaceRoles();
  // After the seed: rows it just inserted already hold every resource.
  await backfillRolePermissions();
  // B12: DB-backed instance settings; the auth facade and email read them.
  await initializeInstanceSettings();

  initializePlugins();
  initializeScheduler();
  startWebhookDispatcher();
  await initializeWebSocketAdapter();
}

export async function startServer(
  injectWebSocket: ReturnType<typeof createNodeWebSocket>["injectWebSocket"],
  port = Number(process.env.PORT) || 1337,
) {
  try {
    await runStartupTasks();
  } catch (error) {
    console.error("❌ Database migration failed!", error);
    process.exit(1);
  }

  let shuttingDown = false;

  const server = serve(
    {
      fetch: app.fetch,
      port,
    },
    () => {
      console.log(
        `⚡ API is running at ${process.env.MARGAYA_API_URL || "http://localhost:1337"}`,
      );
    },
  );

  injectWebSocket(server);

  const gracefulShutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;

    console.log("🛑 Shutting down gracefully...");
    shutdownScheduler();
    stopExportRunner();
    stopWebhookDispatcher();
    stopInstanceSettings();
    // Page rooms persist (and tell clients to reconnect) before the
    // broadcast adapter goes away.
    await shutdownPageRooms();
    await shutdownWebSocketAdapter();
    server.close();
    process.exit(0);
  };

  process.on("SIGTERM", () => {
    void gracefulShutdown();
  });

  process.on("SIGINT", () => {
    void gracefulShutdown();
  });
}

const createdApp = createApp();
const {
  app,
  injectWebSocket,
  activityApi,
  billingApi,
  columnApi,
  commentApi,
  configApi,
  discordIntegrationApi,
  externalLinkApi,
  favoriteApi,
  genericWebhookIntegrationApi,
  githubIntegrationApi,
  giteaIntegrationApi,
  invitationApi,
  invitationPublicApi,
  labelApi,
  mattermostIntegrationApi,
  notificationApi,
  notificationPreferencesApi,
  projectApi,
  publicProjectApi,
  publicBoardApi,
  publicationApi,
  instanceAdminApi,
  recentVisitApi,
  searchApi,
  slackIntegrationApi,
  taskApi,
  taskRelationApi,
  taskLinkApi,
  taskAttachmentApi,
  taskCopyApi,
  jiraImportApi,
  telegramIntegrationApi,
  timeEntryApi,
  userApi,
  workflowRuleApi,
  workspaceApi,
  customFieldApi,
  cycleApi,
  moduleApi,
  estimateApi,
  intakeApi,
  taskQueryApi,
  subscriptionApi,
  reactionApi,
  viewApi,
  stickyApi,
  quickLinkApi,
  homeApi,
  analyticsApi,
  taskDraftApi,
  taskExportApi,
  archiveApi,
  trashApi,
  projectAutomationApi,
  pageApi,
  webhookApi,
  auditLogApi,
  oauthApi,
} = createdApp;

const entrypoint = process.argv[1];
const isMainModule =
  entrypoint !== undefined &&
  entrypoint !== "" &&
  import.meta.url === pathToFileURL(entrypoint).href;

if (isMainModule) {
  void startServer(injectWebSocket);
}

export type AppType =
  | typeof billingApi
  | typeof configApi
  | typeof projectApi
  | typeof taskApi
  | typeof columnApi
  | typeof activityApi
  | typeof commentApi
  | typeof timeEntryApi
  | typeof labelApi
  | typeof notificationApi
  | typeof notificationPreferencesApi
  | typeof searchApi
  | typeof githubIntegrationApi
  | typeof giteaIntegrationApi
  | typeof genericWebhookIntegrationApi
  | typeof discordIntegrationApi
  | typeof mattermostIntegrationApi
  | typeof slackIntegrationApi
  | typeof telegramIntegrationApi
  | typeof taskRelationApi
  | typeof taskLinkApi
  | typeof taskAttachmentApi
  | typeof taskCopyApi
  | typeof jiraImportApi
  | typeof externalLinkApi
  | typeof workflowRuleApi
  | typeof invitationApi
  | typeof workspaceApi
  | typeof customFieldApi
  | typeof userApi
  | typeof favoriteApi
  | typeof recentVisitApi
  | typeof cycleApi
  | typeof moduleApi
  | typeof estimateApi
  | typeof intakeApi
  | typeof taskQueryApi
  | typeof subscriptionApi
  | typeof reactionApi
  | typeof viewApi
  | typeof stickyApi
  | typeof quickLinkApi
  | typeof homeApi
  | typeof analyticsApi
  | typeof taskDraftApi
  | typeof taskExportApi
  | typeof archiveApi
  | typeof trashApi
  | typeof projectAutomationApi
  | typeof pageApi
  | typeof webhookApi
  | typeof auditLogApi
  | typeof publicProjectApi
  | typeof publicBoardApi
  | typeof publicationApi
  | typeof instanceAdminApi
  | typeof invitationPublicApi
  | typeof oauthApi;

export default app;
