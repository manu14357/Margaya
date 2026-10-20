import { checkVectorStore } from "../ai-memory/vector-store";
import { requireInstanceAdmin } from "../instance-admin/middleware";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { enforceRateLimits } from "../utils/rate-limit";
import { requireUserSession } from "../utils/require-user-session";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import {
  aiAvailability,
  instanceAiConfigured,
  requireAiManage,
} from "./access";
import {
  getWorkspaceAiSettings,
  updateWorkspaceAiSettings,
  usageRange,
} from "./controllers/settings";
import {
  getAiInstanceConfig,
  hasLocalEndpoint,
  modelForTier,
} from "./instance-config";
import {
  aiAvailabilitySchema,
  aiSettingsSchema,
  aiTestResultSchema,
  aiUsageSchema,
  instanceAiStatusSchema,
  instanceAiUsageSchema,
} from "./response";
import {
  aiAvailabilityQuery,
  aiUsageQuery,
  aiWorkspaceQuery,
  instanceAiTestBody,
  instanceAiUsageQuery,
  updateAiSettingsBody,
} from "./schema";
import { aiTestLimiter, testAiConnection } from "./test-connection";
import {
  instanceUsageSummary,
  MAX_USAGE_EXPORT_ROWS,
  workspaceUsageCsv,
  workspaceUsageSummary,
} from "./usage";
import {
  DEFAULT_WORKSPACE_AI_POLICY,
  loadWorkspaceAi,
} from "./workspace-settings";

// AI foundation routes: availability, workspace settings, connection tests
// and the usage ledger. AI features add their own routes elsewhere and call
// the gateway (ai/gateway.ts).

const TAGS = ["AI"];
const forbidden = errorResponse(
  "No workspace access, missing ai:manage, or an API key without that scope",
);
const json = <T>(schema: T) => ({
  required: true,
  content: { "application/json": { schema } },
});

const availabilityRoute = createRoute({
  method: "get",
  operationId: "getAiAvailability",
  path: "/availability",
  tags: TAGS,
  summary: "Get AI availability",
  description:
    "Whether AI features should show for the caller: on for the instance, the workspace and (with projectId) the project, a provider set up, and ai:use. Any workspace member may ask.",
  middleware: [workspaceAccess.fromQuery()] as const,
  request: { query: aiAvailabilityQuery },
  responses: {
    200: jsonResponse("The availability", aiAvailabilitySchema),
    403: errorResponse("No access to the workspace"),
  },
});

const getSettingsRoute = createRoute({
  method: "get",
  operationId: "getAiSettings",
  path: "/settings",
  tags: TAGS,
  summary: "Get workspace AI settings",
  description:
    "The workspace's AI opt-in, caps and privacy choices, what the instance allows, and this month's spend. The own key is never returned, only whether one is set and its last four characters. Needs ai:manage.",
  middleware: [workspaceAccess.fromQuery(), requireAiManage] as const,
  request: { query: aiWorkspaceQuery },
  responses: {
    200: jsonResponse("The settings", aiSettingsSchema),
    403: forbidden,
  },
});

const updateSettingsRoute = createRoute({
  method: "patch",
  operationId: "updateAiSettings",
  path: "/settings",
  tags: TAGS,
  summary: "Update workspace AI settings",
  description:
    "Change any of the workspace's AI settings. An own provider key is sealed on the server and only accepted when the instance allows workspace keys; local-only needs the instance's local model. Recorded in the audit log (field names only). Needs ai:manage.",
  middleware: [workspaceAccess.fromBody(), requireAiManage] as const,
  request: { body: json(updateAiSettingsBody) },
  responses: {
    200: jsonResponse("The settings after the change", aiSettingsSchema),
    400: errorResponse("Invalid value"),
    403: forbidden,
    409: errorResponse(
      "Workspace keys are not allowed, local-only mode has no local model, or semantic search has no embeddings endpoint or pgvector",
    ),
  },
});

const testRoute = createRoute({
  method: "post",
  operationId: "testAiConnection",
  path: "/settings/test",
  tags: TAGS,
  summary: "Test the workspace AI connection",
  description:
    "Send one tiny request the way this workspace's calls are routed and report the provider, model and latency. Failures answer 200 with ok false and a curated message. Counted in the usage ledger. Limited to 10 a minute per person. Needs ai:manage.",
  middleware: [workspaceAccess.fromBody(), requireAiManage] as const,
  request: { body: json(aiWorkspaceQuery) },
  responses: {
    200: jsonResponse("The test result", aiTestResultSchema),
    403: forbidden,
    429: errorResponse("Too many tests; retry after Retry-After seconds"),
  },
});

const usageRoute = createRoute({
  method: "get",
  operationId: "getAiUsage",
  path: "/usage",
  tags: TAGS,
  summary: "Get workspace AI usage",
  description:
    "Calls, tokens and list-price cost from the AI ledger for a range of UTC days (default: this month, at most 366 days), in total and by feature, model, person and day. The ledger holds counts only, never prompts or answers. Needs ai:manage.",
  middleware: [workspaceAccess.fromQuery(), requireAiManage] as const,
  request: { query: aiUsageQuery },
  responses: {
    200: jsonResponse("The usage", aiUsageSchema),
    400: errorResponse("Invalid range"),
    403: forbidden,
  },
});

const usageExportRoute = createRoute({
  method: "get",
  operationId: "exportAiUsage",
  path: "/usage/export",
  tags: TAGS,
  summary: "Export workspace AI usage as CSV",
  description: `The usage the dashboard shows as a CSV attachment (UTF-8 with a byte-order mark): one row per UTC day, feature, model and person with calls, input and output tokens and list-price cost in US dollars, at most ${MAX_USAGE_EXPORT_ROWS.toLocaleString("en-US")} rows. Same range rules as GET /ai/usage. Counts only, never prompts or answers. Needs ai:manage.`,
  middleware: [workspaceAccess.fromQuery(), requireAiManage] as const,
  request: { query: aiUsageQuery },
  responses: {
    200: {
      description: "The CSV file",
      content: { "text/csv": { schema: { type: "string" as const } } },
    },
    400: errorResponse("Invalid range"),
    403: forbidden,
  },
});

const ADMIN_NOTE =
  " Instance admins only, with a signed-in session: API keys are refused.";
const adminForbidden = errorResponse(
  "Not an instance admin, or an API key instead of a user session",
);

const instanceStatusRoute = createRoute({
  method: "get",
  operationId: "getInstanceAiStatus",
  path: "/instance/status",
  tags: TAGS,
  summary: "Get instance AI status",
  description: `The effective AI provider and models per tier, whether the local and embedding endpoints are set up, whether pgvector is available for semantic search, and whether the fake provider may be chosen. Settings themselves are read and saved through /instance-admin/settings (group "ai").${ADMIN_NOTE}`,
  middleware: [requireUserSession, requireInstanceAdmin] as const,
  responses: {
    200: jsonResponse("The status", instanceAiStatusSchema),
    403: adminForbidden,
  },
});

const instanceTestRoute = createRoute({
  method: "post",
  operationId: "testInstanceAiConnection",
  path: "/instance/test",
  tags: TAGS,
  summary: "Test the instance AI connection",
  description: `Send one tiny request to the saved cloud provider or local endpoint. Failures answer 200 with ok false and a curated message. Limited to 10 a minute per admin.${ADMIN_NOTE}`,
  middleware: [requireUserSession, requireInstanceAdmin] as const,
  request: { body: json(instanceAiTestBody) },
  responses: {
    200: jsonResponse("The test result", aiTestResultSchema),
    403: adminForbidden,
    429: errorResponse("Too many tests; retry after Retry-After seconds"),
  },
});

const instanceUsageRoute = createRoute({
  method: "get",
  operationId: "getInstanceAiUsage",
  path: "/instance/usage",
  tags: TAGS,
  summary: "Get instance AI usage",
  description: `AI ledger totals across every workspace for a range of UTC days (default: this month), by workspace, model and day.${ADMIN_NOTE}`,
  middleware: [requireUserSession, requireInstanceAdmin] as const,
  request: { query: instanceAiUsageQuery },
  responses: {
    200: jsonResponse("The usage", instanceAiUsageSchema),
    400: errorResponse("Invalid range"),
    403: adminForbidden,
  },
});

const iso = (date: Date) => date.toISOString();

const ai = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(availabilityRoute, async (c) => {
    const { projectId } = c.req.valid("query");
    return c.json(await aiAvailability(c, projectId ?? null), 200);
  })
  .openapi(getSettingsRoute, async (c) =>
    c.json(await getWorkspaceAiSettings(c.get("workspaceId")), 200),
  )
  .openapi(updateSettingsRoute, async (c) => {
    const { workspaceId: _workspaceId, ...patch } = c.req.valid("json");
    return c.json(
      await updateWorkspaceAiSettings(
        c.get("workspaceId"),
        c.get("userId"),
        patch,
      ),
      200,
    );
  })
  .openapi(testRoute, async (c) => {
    const userId = c.get("userId");
    await enforceRateLimits([[aiTestLimiter, userId]]);
    const workspaceId = c.get("workspaceId");
    const workspace = await loadWorkspaceAi(workspaceId);
    return c.json(
      await testAiConnection({
        instance: getAiInstanceConfig(),
        workspace: workspace.policy,
        workspaceApiKey: workspace.apiKey,
        ledger: { workspaceId, userId },
      }),
      200,
    );
  })
  .openapi(usageRoute, async (c) => {
    const { from, to } = c.req.valid("query");
    const summary = await workspaceUsageSummary(
      c.get("workspaceId"),
      usageRange(from, to),
    );
    return c.json(
      { ...summary, from: iso(summary.from), to: iso(summary.to) },
      200,
    );
  })
  .openapi(usageExportRoute, async (c) => {
    const { from, to } = c.req.valid("query");
    const range = usageRange(from, to);
    const csv = await workspaceUsageCsv(c.get("workspaceId"), range);
    const first = iso(range.from).slice(0, 10);
    const last = iso(new Date(range.to.getTime() - 86_400_000)).slice(0, 10);
    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="ai-usage-${first}-${last}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  })
  .openapi(instanceStatusRoute, async (c) => {
    const config = getAiInstanceConfig();
    return c.json(
      {
        enabled: config.enabled,
        configured: instanceAiConfigured(config),
        fakeAllowed: config.fakeAllowed,
        provider: config.provider,
        models: {
          fast: modelForTier(config.provider, config.models, "fast"),
          balanced: modelForTier(config.provider, config.models, "balanced"),
          deep: modelForTier(config.provider, config.models, "deep"),
        },
        localAvailable: hasLocalEndpoint(config),
        embeddingsConfigured: Boolean(
          config.embeddings.baseUrl && config.embeddings.model,
        ),
        vectorStore: await checkVectorStore(),
      },
      200,
    );
  })
  .openapi(instanceTestRoute, async (c) => {
    await enforceRateLimits([[aiTestLimiter, c.get("userId")]]);
    const { target } = c.req.valid("json");
    return c.json(
      await testAiConnection({
        instance: getAiInstanceConfig(),
        workspace: DEFAULT_WORKSPACE_AI_POLICY,
        workspaceApiKey: null,
        target: target ?? "cloud",
      }),
      200,
    );
  })
  .openapi(instanceUsageRoute, async (c) => {
    const { from, to } = c.req.valid("query");
    const summary = await instanceUsageSummary(usageRange(from, to));
    return c.json(
      { ...summary, from: iso(summary.from), to: iso(summary.to) },
      200,
    );
  });

export default ai;
