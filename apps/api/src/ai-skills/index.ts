import { and, asc, count, eq } from "drizzle-orm";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { requireAiUse } from "../ai/access";
import db from "../database";
import { aiSkillTable } from "../database/schema";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
  responseTimestamp,
  z,
} from "../openapi";
import { boundedRequestBody } from "../utils/bounded-request-body";
import { workspacePermissionChecker } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import {
  MAX_SKILL_DESCRIPTION_CHARS,
  MAX_SKILL_NAME_CHARS,
  MAX_SKILL_PROMPT_CHARS,
  MAX_SKILLS_PER_WORKSPACE,
  SKILL_NOT_FOUND,
  skillVisibleTo,
} from "./load";

// Skills: saved, reusable prompts used from "/" in chat (Ask `skillId`) and
// attachable to agents. Shared skills are visible to everyone with ai:use;
// private ones only to their creator. The creator or ai:manage edits them.

const skillSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    prompt: z.string(),
    shared: z.boolean(),
    createdBy: z.string().nullable(),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
    canEdit: z.boolean().openapi({
      description: "The caller created it or has ai:manage.",
    }),
  })
  .openapi("AiSkill");

const name = z.string().trim().min(1).max(MAX_SKILL_NAME_CHARS);
const description = z
  .string()
  .trim()
  .max(MAX_SKILL_DESCRIPTION_CHARS)
  .nullable()
  .optional();
const prompt = z.string().trim().min(1).max(MAX_SKILL_PROMPT_CHARS).openapi({
  description:
    "The instructions the skill adds to a question (at most 4,000 characters).",
});
const shared = z.boolean().optional().openapi({
  description:
    "Visible to everyone in the workspace with ai:use (default), or only to its creator.",
});

const createBody = z
  .strictObject({
    workspaceId: z.string().min(1),
    name,
    description,
    prompt,
    shared,
  })
  .openapi("CreateAiSkill");

const updateBody = z
  .strictObject({
    name: name.optional(),
    description,
    prompt: prompt.optional(),
    shared,
  })
  .openapi("UpdateAiSkill");

const idParam = z.object({ id: z.string().min(1) });
const workspaceQuery = z.object({ workspaceId: z.string().min(1) });
const forbidden = errorResponse(
  "No workspace access, missing ai:use, or not the skill's creator without ai:manage",
);

type Row = typeof aiSkillTable.$inferSelect;

function present(row: Row, userId: string, manage: boolean) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    prompt: row.prompt,
    shared: row.shared,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    canEdit: manage || row.createdBy === userId,
  };
}

async function canManage(c: Context): Promise<boolean> {
  return (await workspacePermissionChecker(c))({ ai: ["manage"] });
}

/** The skill for an edit: visible to the caller, and theirs or ai:manage. */
async function editableSkill(c: Context, id: string) {
  const userId = c.get("userId") as string;
  const [row] = await db
    .select()
    .from(aiSkillTable)
    .where(
      and(
        eq(aiSkillTable.id, id),
        eq(aiSkillTable.workspaceId, c.get("workspaceId") as string),
        skillVisibleTo(userId),
      ),
    )
    .limit(1);
  if (!row) throw new HTTPException(404, { message: SKILL_NOT_FOUND });
  const manage = await canManage(c);
  if (!manage && row.createdBy !== userId) {
    throw new HTTPException(403, { message: "Insufficient permissions" });
  }
  return { row, manage };
}

const listRoute = createRoute({
  method: "get",
  operationId: "listAiSkills",
  path: "/",
  tags: ["AI"],
  summary: "List AI skills",
  description:
    "The workspace's shared skills and the caller's private ones, by name. Needs ai:use.",
  middleware: [workspaceAccess.fromQuery(), requireAiUse] as const,
  request: { query: workspaceQuery },
  responses: {
    200: jsonResponse(
      "The skills",
      z.object({ skills: z.array(skillSchema) }).openapi("AiSkillList"),
    ),
    403: forbidden,
  },
});

const createSkillRoute = createRoute({
  method: "post",
  operationId: "createAiSkill",
  path: "/",
  tags: ["AI"],
  summary: "Create an AI skill",
  description: `Save a reusable prompt. At most ${MAX_SKILLS_PER_WORKSPACE} skills per workspace. Needs ai:use.`,
  middleware: [
    boundedRequestBody(32 * 1024),
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
    200: jsonResponse("The new skill", skillSchema),
    400: errorResponse("Invalid body"),
    403: forbidden,
    409: errorResponse("The workspace already has the most skills allowed"),
  },
});

const updateSkillRoute = createRoute({
  method: "patch",
  operationId: "updateAiSkill",
  path: "/{id}",
  tags: ["AI"],
  summary: "Change an AI skill",
  description:
    "Change a skill's name, description, prompt or sharing. Its creator or ai:manage.",
  middleware: [
    boundedRequestBody(32 * 1024),
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
    200: jsonResponse("The skill after the change", skillSchema),
    400: errorResponse("Invalid body"),
    403: forbidden,
    404: errorResponse(SKILL_NOT_FOUND),
  },
});

const deleteSkillRoute = createRoute({
  method: "delete",
  operationId: "deleteAiSkill",
  path: "/{id}",
  tags: ["AI"],
  summary: "Delete an AI skill",
  description:
    "Delete a skill for good. Its creator or ai:manage. Agents that used it stop getting its prompt.",
  middleware: [workspaceAccess.fromQuery(), requireAiUse] as const,
  request: { params: idParam, query: workspaceQuery },
  responses: {
    200: jsonResponse(
      "The skill was deleted",
      z.object({ id: z.string() }).openapi("AiSkillDeleted"),
    ),
    403: forbidden,
    404: errorResponse(SKILL_NOT_FOUND),
  },
});

const aiSkills = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(listRoute, async (c) => {
    const userId = c.get("userId");
    const manage = await canManage(c);
    const rows = await db
      .select()
      .from(aiSkillTable)
      .where(
        and(
          eq(aiSkillTable.workspaceId, c.get("workspaceId")),
          skillVisibleTo(userId),
        ),
      )
      .orderBy(asc(aiSkillTable.name), asc(aiSkillTable.id));
    return c.json(
      { skills: rows.map((row) => present(row, userId, manage)) },
      200,
    );
  })
  .openapi(createSkillRoute, async (c) => {
    const workspaceId = c.get("workspaceId");
    const userId = c.get("userId");
    const body = c.req.valid("json");
    const [existing] = await db
      .select({ total: count() })
      .from(aiSkillTable)
      .where(eq(aiSkillTable.workspaceId, workspaceId));
    if ((existing?.total ?? 0) >= MAX_SKILLS_PER_WORKSPACE) {
      throw new HTTPException(409, {
        message: `At most ${MAX_SKILLS_PER_WORKSPACE} skills per workspace`,
      });
    }
    const [row] = await db
      .insert(aiSkillTable)
      .values({
        workspaceId,
        name: body.name,
        description: body.description || null,
        prompt: body.prompt,
        shared: body.shared ?? true,
        createdBy: userId,
      })
      .returning();
    if (!row) throw new HTTPException(500, { message: "Skill not saved" });
    return c.json(present(row, userId, await canManage(c)), 200);
  })
  .openapi(updateSkillRoute, async (c) => {
    const { row, manage } = await editableSkill(c, c.req.valid("param").id);
    const body = c.req.valid("json");
    const values: Partial<typeof aiSkillTable.$inferInsert> = {};
    if (body.name !== undefined) values.name = body.name;
    if (body.description !== undefined) {
      values.description = body.description || null;
    }
    if (body.prompt !== undefined) values.prompt = body.prompt;
    if (body.shared !== undefined) values.shared = body.shared;
    if (Object.keys(values).length === 0) {
      return c.json(present(row, c.get("userId"), manage), 200);
    }
    const [updated] = await db
      .update(aiSkillTable)
      .set(values)
      .where(eq(aiSkillTable.id, row.id))
      .returning();
    if (!updated) throw new HTTPException(404, { message: SKILL_NOT_FOUND });
    return c.json(present(updated, c.get("userId"), manage), 200);
  })
  .openapi(deleteSkillRoute, async (c) => {
    const { row } = await editableSkill(c, c.req.valid("param").id);
    await db.delete(aiSkillTable).where(eq(aiSkillTable.id, row.id));
    return c.json({ id: row.id }, 200);
  });

export default aiSkills;
