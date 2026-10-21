import { and, asc, count, eq, isNull, or, type SQL } from "drizzle-orm";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { requireAiUse } from "../ai/access";
import db from "../database";
import { aiMemoryNoteTable, projectTable } from "../database/schema";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
  responseTimestamp,
  z,
} from "../openapi";
import { canSeeProject, hiddenProjectIds } from "../project/visibility";
import { boundedRequestBody } from "../utils/bounded-request-body";
import { workspacePermissionChecker } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";

// Memory notes: short facts the AI remembers for the workspace, a project or
// one person ("our release day is Thursday"). Everyone with ai:use reads the
// workspace notes and the notes of projects they can see; ai:manage edits
// them. A person's own notes are private to them. Prompts get them through
// memoryNotesFor() (load.ts).

export const MAX_NOTE_CHARS = 500;
/** Notes per workspace, per project and per person. */
export const MAX_NOTES_PER_SCOPE = 100;

const NOT_FOUND = "Memory note not found";
const SCOPES = ["workspace", "project", "user"] as const;

const noteSchema = z
  .object({
    id: z.string(),
    scope: z.enum(SCOPES),
    projectId: z.string().nullable(),
    content: z.string(),
    createdBy: z.string().nullable(),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
    canEdit: z.boolean().openapi({
      description:
        "The caller may change or delete it: their own note, or ai:manage for workspace and project notes.",
    }),
  })
  .openapi("AiMemoryNote");

const content = z.string().trim().min(1).max(MAX_NOTE_CHARS).openapi({
  description: "The fact to remember, at most 500 characters.",
});

const listQuery = z.object({
  workspaceId: z.string().min(1),
  projectId: z.string().min(1).optional().openapi({
    description: "Only this project's notes, plus workspace and own notes.",
  }),
});

const createBody = z
  .strictObject({
    workspaceId: z.string().min(1),
    scope: z.enum(SCOPES).openapi({
      description:
        "workspace and project notes need ai:manage; user notes are the caller's own and private.",
    }),
    projectId: z.string().min(1).optional().openapi({
      description: "Required for project notes.",
    }),
    content,
  })
  .openapi("CreateAiMemoryNote");

const updateBody = z.strictObject({ content }).openapi("UpdateAiMemoryNote");
const idParam = z.object({ id: z.string().min(1) });
const workspaceQuery = z.object({ workspaceId: z.string().min(1) });

const forbidden = errorResponse(
  "No workspace access, missing ai:use, or ai:manage for workspace and project notes",
);

type Row = typeof aiMemoryNoteTable.$inferSelect;

function present(row: Row, userId: string, canManage: boolean) {
  return {
    id: row.id,
    scope: row.scope,
    projectId: row.projectId,
    content: row.content,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    canEdit: row.scope === "user" ? row.userId === userId : canManage,
  };
}

async function canManage(c: Context): Promise<boolean> {
  return (await workspacePermissionChecker(c))({ ai: ["manage"] });
}

/** A note the caller may see, or 404 (other people's notes read as missing). */
async function visibleNote(c: Context, id: string): Promise<Row> {
  const workspaceId = c.get("workspaceId") as string;
  const userId = c.get("userId") as string;
  const [row] = await db
    .select()
    .from(aiMemoryNoteTable)
    .where(
      and(
        eq(aiMemoryNoteTable.id, id),
        eq(aiMemoryNoteTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  if (!row) throw new HTTPException(404, { message: NOT_FOUND });
  if (row.scope === "user" && row.userId !== userId) {
    throw new HTTPException(404, { message: NOT_FOUND });
  }
  if (
    row.scope === "project" &&
    row.projectId &&
    !(await canSeeProject(userId, row.projectId))
  ) {
    throw new HTTPException(404, { message: NOT_FOUND });
  }
  return row;
}

async function assertMayEdit(c: Context, row: Row): Promise<boolean> {
  const manage = await canManage(c);
  const own = row.scope === "user" && row.userId === c.get("userId");
  if (!own && (row.scope === "user" || !manage)) {
    throw new HTTPException(403, { message: "Insufficient permissions" });
  }
  return manage;
}

const listRoute = createRoute({
  method: "get",
  operationId: "listAiMemoryNotes",
  path: "/",
  tags: ["AI"],
  summary: "List AI memory notes",
  description:
    "The notes AI prompts use: the workspace's, those of projects the caller can see (or only `projectId`'s), and the caller's own. Workspace and project notes first, oldest first. Needs ai:use.",
  middleware: [workspaceAccess.fromQuery(), requireAiUse] as const,
  request: { query: listQuery },
  responses: {
    200: jsonResponse(
      "The notes",
      z.object({ notes: z.array(noteSchema) }).openapi("AiMemoryNoteList"),
    ),
    403: forbidden,
  },
});

const createNoteRoute = createRoute({
  method: "post",
  operationId: "createAiMemoryNote",
  path: "/",
  tags: ["AI"],
  summary: "Add an AI memory note",
  description: `Remember a fact for AI answers. Workspace and project notes need ai:manage; user notes are private to the caller. At most ${MAX_NOTES_PER_SCOPE} notes per workspace, project or person.`,
  middleware: [
    boundedRequestBody(16 * 1024),
    workspaceAccess.fromBody(),
    requireAiUse,
  ] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: createBody } },
    },
  },
  responses: {
    200: jsonResponse("The new note", noteSchema),
    400: errorResponse("Invalid body, or a project note without projectId"),
    403: forbidden,
    404: errorResponse("The project is not in the workspace or not visible"),
    409: errorResponse("The scope already has the most notes allowed"),
  },
});

const updateNoteRoute = createRoute({
  method: "patch",
  operationId: "updateAiMemoryNote",
  path: "/{id}",
  tags: ["AI"],
  summary: "Change an AI memory note",
  description:
    "Change a note's text: the caller's own note, or (with ai:manage) a workspace or project note.",
  middleware: [
    boundedRequestBody(16 * 1024),
    workspaceAccess.fromQuery(),
    requireAiUse,
  ] as const,
  request: {
    params: idParam,
    query: workspaceQuery,
    body: {
      required: true,
      content: { "application/json": { schema: updateBody } },
    },
  },
  responses: {
    200: jsonResponse("The note after the change", noteSchema),
    400: errorResponse("Invalid body"),
    403: forbidden,
    404: errorResponse(NOT_FOUND),
  },
});

const deleteNoteRoute = createRoute({
  method: "delete",
  operationId: "deleteAiMemoryNote",
  path: "/{id}",
  tags: ["AI"],
  summary: "Delete an AI memory note",
  description:
    "Forget a note: the caller's own, or (with ai:manage) a workspace or project note.",
  middleware: [workspaceAccess.fromQuery(), requireAiUse] as const,
  request: { params: idParam, query: workspaceQuery },
  responses: {
    200: jsonResponse(
      "The note was deleted",
      z.object({ id: z.string() }).openapi("AiMemoryNoteDeleted"),
    ),
    403: forbidden,
    404: errorResponse(NOT_FOUND),
  },
});

const aiMemoryNotes = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(listRoute, async (c) => {
    const workspaceId = c.get("workspaceId");
    const userId = c.get("userId");
    const { projectId } = c.req.valid("query");
    const manage = await canManage(c);
    const projectScope: SQL = projectId
      ? (and(
          eq(aiMemoryNoteTable.scope, "project"),
          eq(aiMemoryNoteTable.projectId, projectId),
        ) as SQL)
      : eq(aiMemoryNoteTable.scope, "project");
    const rows = await db
      .select({ note: aiMemoryNoteTable })
      .from(aiMemoryNoteTable)
      .leftJoin(projectTable, eq(projectTable.id, aiMemoryNoteTable.projectId))
      .where(
        and(
          eq(aiMemoryNoteTable.workspaceId, workspaceId),
          or(
            eq(aiMemoryNoteTable.scope, "workspace"),
            and(projectScope, isNull(projectTable.deletedAt)),
            and(
              eq(aiMemoryNoteTable.scope, "user"),
              eq(aiMemoryNoteTable.userId, userId),
            ),
          ),
        ),
      )
      .orderBy(asc(aiMemoryNoteTable.createdAt), asc(aiMemoryNoteTable.id));
    const hidden = new Set(await hiddenProjectIds(userId, workspaceId));
    const rank = { workspace: 0, project: 1, user: 2 } as const;
    const notes = rows
      .map((row) => row.note)
      .filter((note) => !note.projectId || !hidden.has(note.projectId))
      .sort((a, b) => rank[a.scope] - rank[b.scope])
      .map((note) => present(note, userId, manage));
    return c.json({ notes }, 200);
  })
  .openapi(createNoteRoute, async (c) => {
    const workspaceId = c.get("workspaceId");
    const userId = c.get("userId");
    const body = c.req.valid("json");
    const manage = await canManage(c);
    if (body.scope !== "user" && !manage) {
      throw new HTTPException(403, { message: "Insufficient permissions" });
    }
    let projectId: string | null = null;
    if (body.scope === "project") {
      if (!body.projectId) {
        throw new HTTPException(400, {
          message: "projectId: required for project notes",
        });
      }
      const [project] = await db
        .select({ id: projectTable.id })
        .from(projectTable)
        .where(
          and(
            eq(projectTable.id, body.projectId),
            eq(projectTable.workspaceId, workspaceId),
            isNull(projectTable.deletedAt),
          ),
        )
        .limit(1);
      if (!project || !(await canSeeProject(userId, project.id))) {
        throw new HTTPException(404, { message: "Project not found" });
      }
      projectId = project.id;
    }
    const owner = body.scope === "user" ? userId : null;
    const [existing] = await db
      .select({ total: count() })
      .from(aiMemoryNoteTable)
      .where(
        and(
          eq(aiMemoryNoteTable.workspaceId, workspaceId),
          eq(aiMemoryNoteTable.scope, body.scope),
          projectId
            ? eq(aiMemoryNoteTable.projectId, projectId)
            : isNull(aiMemoryNoteTable.projectId),
          owner
            ? eq(aiMemoryNoteTable.userId, owner)
            : isNull(aiMemoryNoteTable.userId),
        ),
      );
    if ((existing?.total ?? 0) >= MAX_NOTES_PER_SCOPE) {
      throw new HTTPException(409, {
        message: `At most ${MAX_NOTES_PER_SCOPE} notes here; delete one first`,
      });
    }
    const [row] = await db
      .insert(aiMemoryNoteTable)
      .values({
        workspaceId,
        scope: body.scope,
        projectId,
        userId: owner,
        content: body.content,
        createdBy: userId,
      })
      .returning();
    if (!row) throw new HTTPException(500, { message: "Note not saved" });
    return c.json(present(row, userId, manage), 200);
  })
  .openapi(updateNoteRoute, async (c) => {
    const { id } = c.req.valid("param");
    const row = await visibleNote(c, id);
    const manage = await assertMayEdit(c, row);
    const [updated] = await db
      .update(aiMemoryNoteTable)
      .set({ content: c.req.valid("json").content })
      .where(eq(aiMemoryNoteTable.id, row.id))
      .returning();
    if (!updated) throw new HTTPException(404, { message: NOT_FOUND });
    return c.json(present(updated, c.get("userId"), manage), 200);
  })
  .openapi(deleteNoteRoute, async (c) => {
    const { id } = c.req.valid("param");
    const row = await visibleNote(c, id);
    await assertMayEdit(c, row);
    await db.delete(aiMemoryNoteTable).where(eq(aiMemoryNoteTable.id, row.id));
    return c.json({ id: row.id }, 200);
  });

export default aiMemoryNotes;
