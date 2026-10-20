import { eq } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import { requireAiEnabled, requireAiUse } from "../ai/access";
import { aiErrorResponse, aiStreamResponse } from "../ai/sse";
import db from "../database";
import { aiBriefTable } from "../database/schema";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
  z,
} from "../openapi";
import { validateWorkspaceAccess } from "../utils/validate-workspace-access";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import { generateBrief, shareBrief } from "./brief";
import {
  briefCitationSchema,
  briefFactsSchema,
  briefSharedSchema,
} from "./response";
import { briefIdParam, generateBriefBody, shareBriefBody } from "./schema";

// Stakeholder brief routes (B8).

const TAGS = ["AI"];

/** Resolves the brief in the path to its workspace (raw param: runs first). */
async function briefAccess(c: Context, next: Next) {
  const userId = c.get("userId") as string | undefined;
  if (!userId) throw new HTTPException(401, { message: "Unauthorized" });
  const id = c.req.param("id");
  const [brief] = id
    ? await db
        .select({
          workspaceId: aiBriefTable.workspaceId,
          projectId: aiBriefTable.projectId,
        })
        .from(aiBriefTable)
        .where(eq(aiBriefTable.id, id))
        .limit(1)
    : [];
  if (!brief) throw new HTTPException(404, { message: "Brief not found" });
  await validateWorkspaceAccess(
    userId,
    brief.workspaceId,
    c.get("apiKey")?.id,
    brief.projectId,
  );
  c.set("workspaceId", brief.workspaceId);
  return next();
}

const generateRoute = createRoute({
  method: "post",
  operationId: "aiGenerateBrief",
  path: "/",
  tags: TAGS,
  summary: "Generate a stakeholder brief",
  description:
    "Write a status brief for a cycle, module or project for an audience. The model writes only from facts computed by the server (progress, changes since the last shared brief, completed and added tasks, risks and the delivery forecast) and cites tasks by key. The facts are kept so the next brief can show what changed; the text is not. Needs ai:use and task:read on a visible project with AI on (and cycles or modules on).",
  middleware: [
    workspaceAccess.fromBody(),
    requireAiUse,
    requireAiEnabled(),
  ] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: generateBriefBody } },
    },
  },
  responses: {
    200: aiStreamResponse(
      "The brief, with its facts and citable tasks (in the meta event when streaming).",
      {
        briefId: z.string(),
        facts: briefFactsSchema,
        citations: z.array(briefCitationSchema),
      },
    ),
    403: aiErrorResponse(
      "AI is off (AI_DISABLED), the data may not leave (AI_ROUTE_BLOCKED), a client brief of a restricted project, or missing permissions",
    ),
    404: errorResponse("Cycle, module or project not found"),
    409: aiErrorResponse("No AI provider is set up (AI_NOT_CONFIGURED)"),
    429: aiErrorResponse("AI_BUDGET_EXCEEDED or AI_RATE_LIMITED"),
  },
});

const shareRoute = createRoute({
  method: "post",
  operationId: "aiShareBrief",
  path: "/{id}/share",
  tags: TAGS,
  summary: "Mark a brief as shared",
  description:
    "Record that a generated brief was saved as a Page or copied: the next brief of the same scope shows what changed since this one. Only its author may.",
  middleware: [briefAccess, requireAiUse] as const,
  request: {
    params: briefIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: shareBriefBody } },
    },
  },
  responses: {
    200: jsonResponse("The shared brief", briefSharedSchema),
    400: errorResponse("The page is not in the brief's project"),
    403: errorResponse("No workspace access, or missing ai:use"),
    404: errorResponse("Brief not found"),
  },
});

const brief = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(generateRoute, async (c) => {
    const { scopeType, scopeId, audience, locale } = c.req.valid("json");
    // An SSE stream or its JSON fallback (ai/sse.ts).
    return generateBrief(c, { scopeType, scopeId, audience, locale });
  })
  .openapi(shareRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { pageId } = c.req.valid("json");
    return c.json(await shareBrief(id, c.get("userId"), pageId ?? null), 200);
  });

export default brief;
