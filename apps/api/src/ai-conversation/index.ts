import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import { requireAiUse } from "../ai/access";
import { loadWorkspaceAiPolicy } from "../ai/workspace-settings";
import db from "../database";
import { aiConversationTable, projectTable } from "../database/schema";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
  responseTimestamp,
  z,
} from "../openapi";
import { canSeeProject } from "../project/visibility";
import { boundedRequestBody } from "../utils/bounded-request-body";
import { workspaceAccess } from "../utils/workspace-access-middleware";

// Ask conversations kept on the server: only when the workspace opted in
// (workspace_ai_setting.store_conversations), and only ever for their owner.
// Without the opt-in every route answers 403 AI_HISTORY_OFF and the web keeps
// history in the browser. Reasoning is never part of a turn.

export const MAX_CONVERSATION_TURNS = 100;
export const MAX_CONVERSATION_BYTES = 200 * 1024;
export const MAX_CONVERSATIONS_PER_PERSON = 500;
const MAX_LIST = 200;
const NOT_FOUND = "Conversation not found";

/** 403 with the JSON body the web maps to a message (like AiError). */
export function historyOffError(): HTTPException {
  const body = {
    code: "AI_HISTORY_OFF",
    message: "This workspace doesn't keep AI conversations on the server",
  };
  return new HTTPException(403, {
    message: body.message,
    res: new Response(JSON.stringify(body), {
      status: 403,
      headers: { "content-type": "application/json" },
    }),
  });
}

/** Route middleware: the workspace keeps conversations. After workspaceAccess. */
async function requireHistoryOn(c: Context, next: Next) {
  const policy = await loadWorkspaceAiPolicy(c.get("workspaceId") as string);
  if (!policy.storeConversations) throw historyOffError();
  return next();
}

const turnSchema = z
  .looseObject({
    question: z.string().max(4_000),
    answer: z.string().max(60_000),
    sources: z.array(z.record(z.string(), z.unknown())).max(100).optional(),
    citations: z.array(z.string().max(200)).max(200).optional(),
    createdAt: z.string().max(40).optional(),
  })
  .openapi("AiConversationTurn", {
    description:
      "One question and its answer, stored as sent (other fields are kept too). Never include reasoning.",
  });

const summarySchema = z
  .object({
    id: z.string(),
    title: z.string(),
    projectId: z.string().nullable(),
    pinned: z.boolean(),
    turnCount: z.number().int(),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
  })
  .openapi("AiConversationSummary");

const conversationSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    projectId: z.string().nullable(),
    pinned: z.boolean(),
    turns: z.array(turnSchema),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
  })
  .openapi("AiConversation");

const title = z.string().trim().min(1).max(200);
const idParam = z.object({
  id: z
    .string()
    .regex(/^[A-Za-z0-9_-]{8,64}$/, "8 to 64 letters, digits, _ or -")
    .openapi({ description: "The conversation id the client chose." }),
});
const workspaceQuery = z.object({ workspaceId: z.string().min(1) });

const putBody = z
  .strictObject({
    workspaceId: z.string().min(1),
    title,
    projectId: z.string().min(1).max(128).nullable().optional().openapi({
      description:
        "The project Ask was opened in; dropped when the caller can't see it.",
    }),
    pinned: z.boolean().optional(),
    turns: z.array(turnSchema).max(MAX_CONVERSATION_TURNS),
  })
  .openapi("PutAiConversation");

const patchBody = z
  .strictObject({ title: title.optional(), pinned: z.boolean().optional() })
  .openapi("UpdateAiConversation");

const historyOff = {
  description:
    "AI_HISTORY_OFF: the workspace doesn't keep conversations; or a plain-text error: no workspace access or missing ai:use",
  content: {
    "application/json": {
      schema: z
        .object({ code: z.string(), message: z.string() })
        .openapi("AiHistoryOffError"),
    },
  },
};

const guards = [workspaceAccess.fromQuery(), requireAiUse, requireHistoryOn];

type Row = typeof aiConversationTable.$inferSelect;

function ownWhere(c: Context, id: string) {
  return and(
    eq(aiConversationTable.id, id),
    eq(aiConversationTable.workspaceId, c.get("workspaceId") as string),
    eq(aiConversationTable.userId, c.get("userId") as string),
  );
}

async function ownConversation(c: Context, id: string): Promise<Row> {
  const [row] = await db
    .select()
    .from(aiConversationTable)
    .where(ownWhere(c, id))
    .limit(1);
  if (!row) throw new HTTPException(404, { message: NOT_FOUND });
  return row;
}

function present(row: Row) {
  return {
    id: row.id,
    title: row.title,
    projectId: row.projectId,
    pinned: row.pinned,
    turns: row.turns as z.infer<typeof turnSchema>[],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const listRoute = createRoute({
  method: "get",
  operationId: "listAiConversations",
  path: "/",
  tags: ["AI"],
  summary: "List my AI conversations",
  description: `The caller's own Ask conversations in this workspace, pinned first, then the most recently updated (at most ${MAX_LIST}). Needs ai:use and the workspace's "keep conversations" setting.`,
  middleware: guards,
  request: { query: workspaceQuery },
  responses: {
    200: jsonResponse(
      "The conversations",
      z
        .object({ conversations: z.array(summarySchema) })
        .openapi("AiConversationList"),
    ),
    403: historyOff,
  },
});

const getRoute = createRoute({
  method: "get",
  operationId: "getAiConversation",
  path: "/{id}",
  tags: ["AI"],
  summary: "Get an AI conversation",
  description:
    "One of the caller's conversations with its turns. Other people's conversations read as missing.",
  middleware: guards,
  request: { params: idParam, query: workspaceQuery },
  responses: {
    200: jsonResponse("The conversation", conversationSchema),
    403: historyOff,
    404: errorResponse(NOT_FOUND),
  },
});

const putRoute = createRoute({
  method: "put",
  operationId: "putAiConversation",
  path: "/{id}",
  tags: ["AI"],
  summary: "Save an AI conversation",
  description: `Create or replace one of the caller's conversations under the id the client chose: title, project, pin and turns, stored as sent. At most ${MAX_CONVERSATION_TURNS} turns and ${MAX_CONVERSATION_BYTES / 1024} KB of turns per conversation, ${MAX_CONVERSATIONS_PER_PERSON} conversations per person. An id that belongs to someone else reads as missing.`,
  middleware: [
    boundedRequestBody(MAX_CONVERSATION_BYTES + 16 * 1024),
    workspaceAccess.fromBody(),
    requireAiUse,
    requireHistoryOn,
  ] as const,
  request: {
    params: idParam,
    body: {
      required: true,
      content: { "application/json": { schema: putBody } },
    },
  },
  responses: {
    200: jsonResponse("The saved conversation", conversationSchema),
    400: errorResponse("Invalid body"),
    403: historyOff,
    404: errorResponse(NOT_FOUND),
    409: errorResponse("The caller already has the most conversations allowed"),
    413: errorResponse("The turns are larger than 200 KB"),
  },
});

const patchRoute = createRoute({
  method: "patch",
  operationId: "updateAiConversation",
  path: "/{id}",
  tags: ["AI"],
  summary: "Rename or pin an AI conversation",
  description: "Change a conversation's title or pin.",
  middleware: [
    boundedRequestBody(8 * 1024),
    workspaceAccess.fromQuery(),
    requireAiUse,
    requireHistoryOn,
  ] as const,
  request: {
    params: idParam,
    query: workspaceQuery,
    body: {
      required: true,
      content: { "application/json": { schema: patchBody } },
    },
  },
  responses: {
    200: jsonResponse("The conversation after the change", summarySchema),
    400: errorResponse("Invalid body"),
    403: historyOff,
    404: errorResponse(NOT_FOUND),
  },
});

const deleteRoute = createRoute({
  method: "delete",
  operationId: "deleteAiConversation",
  path: "/{id}",
  tags: ["AI"],
  summary: "Delete an AI conversation",
  description: "Delete one of the caller's conversations for good.",
  middleware: guards,
  request: { params: idParam, query: workspaceQuery },
  responses: {
    200: jsonResponse(
      "The conversation was deleted",
      z.object({ id: z.string() }).openapi("AiConversationDeleted"),
    ),
    403: historyOff,
    404: errorResponse(NOT_FOUND),
  },
});

async function visibleProject(c: Context, projectId: string | null) {
  if (!projectId) return null;
  const [project] = await db
    .select({ id: projectTable.id })
    .from(projectTable)
    .where(
      and(
        eq(projectTable.id, projectId),
        eq(projectTable.workspaceId, c.get("workspaceId") as string),
        isNull(projectTable.deletedAt),
      ),
    )
    .limit(1);
  if (!project) return null;
  return (await canSeeProject(c.get("userId") as string, project.id))
    ? project.id
    : null;
}

const aiConversations = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(listRoute, async (c) => {
    const rows = await db
      .select({
        id: aiConversationTable.id,
        title: aiConversationTable.title,
        projectId: aiConversationTable.projectId,
        pinned: aiConversationTable.pinned,
        turnCount: sql<number>`coalesce(jsonb_array_length(${aiConversationTable.turns}), 0)::int`,
        createdAt: aiConversationTable.createdAt,
        updatedAt: aiConversationTable.updatedAt,
      })
      .from(aiConversationTable)
      .where(
        and(
          eq(aiConversationTable.workspaceId, c.get("workspaceId")),
          eq(aiConversationTable.userId, c.get("userId")),
        ),
      )
      .orderBy(
        desc(aiConversationTable.pinned),
        desc(aiConversationTable.updatedAt),
      )
      .limit(MAX_LIST);
    return c.json(
      {
        conversations: rows.map((row) => ({
          ...row,
          turnCount: Number(row.turnCount),
        })),
      },
      200,
    );
  })
  .openapi(getRoute, async (c) =>
    c.json(present(await ownConversation(c, c.req.valid("param").id)), 200),
  )
  .openapi(putRoute, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const workspaceId = c.get("workspaceId");
    const userId = c.get("userId");
    if (
      Buffer.byteLength(JSON.stringify(body.turns)) > MAX_CONVERSATION_BYTES
    ) {
      throw new HTTPException(413, {
        message: "The conversation is larger than 200 KB",
      });
    }
    const [existing] = await db
      .select({
        userId: aiConversationTable.userId,
        workspaceId: aiConversationTable.workspaceId,
      })
      .from(aiConversationTable)
      .where(eq(aiConversationTable.id, id))
      .limit(1);
    if (
      existing &&
      (existing.userId !== userId || existing.workspaceId !== workspaceId)
    ) {
      throw new HTTPException(404, { message: NOT_FOUND });
    }
    const projectId =
      body.projectId === undefined
        ? undefined
        : await visibleProject(c, body.projectId);
    let row: Row | undefined;
    if (existing) {
      [row] = await db
        .update(aiConversationTable)
        .set({
          title: body.title,
          turns: body.turns,
          ...(projectId !== undefined ? { projectId } : {}),
          ...(body.pinned !== undefined ? { pinned: body.pinned } : {}),
        })
        .where(ownWhere(c, id))
        .returning();
    } else {
      const [mine] = await db
        .select({ total: count() })
        .from(aiConversationTable)
        .where(
          and(
            eq(aiConversationTable.workspaceId, workspaceId),
            eq(aiConversationTable.userId, userId),
          ),
        );
      if ((mine?.total ?? 0) >= MAX_CONVERSATIONS_PER_PERSON) {
        throw new HTTPException(409, {
          message: `At most ${MAX_CONVERSATIONS_PER_PERSON} conversations; delete older ones first`,
        });
      }
      [row] = await db
        .insert(aiConversationTable)
        .values({
          id,
          workspaceId,
          userId,
          projectId: projectId ?? null,
          title: body.title,
          pinned: body.pinned ?? false,
          turns: body.turns,
        })
        .onConflictDoNothing()
        .returning();
    }
    if (!row) throw new HTTPException(404, { message: NOT_FOUND });
    return c.json(present(row), 200);
  })
  .openapi(patchRoute, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const row = await ownConversation(c, id);
    const values: Partial<typeof aiConversationTable.$inferInsert> = {};
    if (body.title !== undefined) values.title = body.title;
    if (body.pinned !== undefined) values.pinned = body.pinned;
    const [updated] =
      Object.keys(values).length > 0
        ? await db
            .update(aiConversationTable)
            .set(values)
            .where(ownWhere(c, id))
            .returning()
        : [row];
    if (!updated) throw new HTTPException(404, { message: NOT_FOUND });
    return c.json(
      {
        id: updated.id,
        title: updated.title,
        projectId: updated.projectId,
        pinned: updated.pinned,
        turnCount: Array.isArray(updated.turns) ? updated.turns.length : 0,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      },
      200,
    );
  })
  .openapi(deleteRoute, async (c) => {
    const { id } = c.req.valid("param");
    const row = await ownConversation(c, id);
    await db.delete(aiConversationTable).where(ownWhere(c, row.id));
    return c.json({ id: row.id }, 200);
  });

export default aiConversations;
