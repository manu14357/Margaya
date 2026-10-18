import {
  and,
  asc,
  eq,
  inArray,
  isNull,
  max,
  ne,
  type SQL,
  sql,
} from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import {
  columnTable,
  estimatePointTable,
  estimateTable,
  labelTable,
  projectTable,
  taskTemplateTable,
  workspaceUserTable,
} from "../database/schema";
import { publishEvent } from "../events";
import { MAX_TEMPLATES_PER_PROJECT, type TemplateInput } from "./schema";

// Task templates: per-project defaults for new tasks. Writes validate every
// reference; reads drop the ones that went stale since, so a template never
// fails a create because a label or member is gone.

export const TEMPLATE_NOT_FOUND = "Template not found";
export const TEMPLATE_NAME_TAKEN = "A template with this name already exists";

type TemplateRow = typeof taskTemplateTable.$inferSelect;
type Reader = Pick<typeof db, "select">;

/** `{title}` takes the typed title; otherwise it follows the pattern. */
export function applyTitlePattern(pattern: string, typed = ""): string {
  const title = typed.trim();
  if (pattern.includes("{title}")) {
    return pattern.replaceAll("{title}", title).replace(/\s+/g, " ").trim();
  }
  return [pattern.trim(), title].filter(Boolean).join(" ");
}

/** Workspace labels by id (task copies and labels being deleted are not). */
async function workspaceLabels(
  reader: Reader,
  workspaceId: string,
  ids: readonly string[],
) {
  if (ids.length === 0) return [];
  return reader
    .select({
      id: labelTable.id,
      name: labelTable.name,
      color: labelTable.color,
    })
    .from(labelTable)
    .where(
      and(
        inArray(labelTable.id, [...ids]),
        eq(labelTable.workspaceId, workspaceId),
        isNull(labelTable.taskId),
        isNull(labelTable.deletionStartedAt),
      ),
    );
}

async function workspaceMembers(
  reader: Reader,
  workspaceId: string,
  ids: readonly string[],
) {
  if (ids.length === 0) return new Set<string>();
  const rows = await reader
    .select({ userId: workspaceUserTable.userId })
    .from(workspaceUserTable)
    .where(
      and(
        eq(workspaceUserTable.workspaceId, workspaceId),
        inArray(workspaceUserTable.userId, [...ids]),
      ),
    );
  return new Set(rows.map((row) => row.userId));
}

/** True when the point belongs to the project's active estimate system. */
async function isActivePoint(
  reader: Reader,
  projectId: string,
  pointId: string,
) {
  const [point] = await reader
    .select({ id: estimatePointTable.id })
    .from(estimatePointTable)
    .innerJoin(
      estimateTable,
      eq(estimateTable.id, estimatePointTable.estimateId),
    )
    .where(
      and(
        eq(estimatePointTable.id, pointId),
        eq(estimateTable.projectId, projectId),
        eq(estimateTable.isActive, true),
      ),
    )
    .limit(1);
  return Boolean(point);
}

async function projectOf(reader: Reader, projectId: string) {
  const [project] = await reader
    .select({
      id: projectTable.id,
      workspaceId: projectTable.workspaceId,
      estimatesEnabled: projectTable.estimatesEnabled,
    })
    .from(projectTable)
    .where(and(eq(projectTable.id, projectId), isNull(projectTable.deletedAt)))
    .limit(1);
  if (!project) throw new HTTPException(404, { message: "Project not found" });
  return project;
}

/** The templates matching `where`, in order, with stale references dropped. */
export async function readTemplates(
  where: SQL,
  reader: Reader = db,
): Promise<TemplateResponse[]> {
  const rows = await reader
    .select({
      template: taskTemplateTable,
      column: {
        id: columnTable.id,
        name: columnTable.name,
        slug: columnTable.slug,
        projectId: columnTable.projectId,
      },
      workspaceId: projectTable.workspaceId,
    })
    .from(taskTemplateTable)
    .innerJoin(projectTable, eq(projectTable.id, taskTemplateTable.projectId))
    .leftJoin(columnTable, eq(columnTable.id, taskTemplateTable.columnId))
    .where(where)
    .orderBy(asc(taskTemplateTable.position), asc(taskTemplateTable.createdAt));
  if (rows.length === 0) return [];

  const workspaceId = rows[0]?.workspaceId ?? "";
  const labelIds = [...new Set(rows.flatMap((row) => row.template.labelIds))];
  const userIds = [...new Set(rows.flatMap((row) => row.template.assigneeIds))];
  const labels = new Map(
    (await workspaceLabels(reader, workspaceId, labelIds)).map((label) => [
      label.id,
      label,
    ]),
  );
  const members = await workspaceMembers(reader, workspaceId, userIds);
  const pointIds = [
    ...new Set(rows.flatMap((row) => row.template.estimatePointId ?? [])),
  ];
  // "point@project" for points of their project's active system.
  const activePoints = new Set(
    pointIds.length === 0
      ? []
      : (
          await reader
            .select({
              id: estimatePointTable.id,
              projectId: estimateTable.projectId,
            })
            .from(estimatePointTable)
            .innerJoin(
              estimateTable,
              eq(estimateTable.id, estimatePointTable.estimateId),
            )
            .where(
              and(
                inArray(estimatePointTable.id, pointIds),
                eq(estimateTable.isActive, true),
              ),
            )
        ).map((point) => `${point.id}@${point.projectId}`),
  );

  return rows.map(({ template, column }) =>
    toTemplate(template, {
      column:
        column?.id && column.projectId === template.projectId
          ? { id: column.id, name: column.name, slug: column.slug }
          : null,
      labels: template.labelIds.flatMap((id) => {
        const label = labels.get(id);
        return label ? [label] : [];
      }),
      assigneeIds: template.assigneeIds.filter((id) => members.has(id)),
      estimatePointId:
        template.estimatePointId &&
        activePoints.has(`${template.estimatePointId}@${template.projectId}`)
          ? template.estimatePointId
          : null,
    }),
  );
}

function toTemplate(
  row: TemplateRow,
  live: {
    column: { id: string; name: string; slug: string } | null;
    labels: { id: string; name: string; color: string }[];
    assigneeIds: string[];
    estimatePointId: string | null;
  },
) {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    titlePattern: row.titlePattern,
    description: row.description,
    columnId: live.column?.id ?? null,
    column: live.column,
    priority: row.priority,
    labels: live.labels,
    assigneeIds: live.assigneeIds,
    estimatePointId: live.estimatePointId,
    subtasks: row.subtasks,
    position: row.position,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export type TemplateResponse = ReturnType<typeof toTemplate>;

export async function listTemplates(projectId: string) {
  return readTemplates(eq(taskTemplateTable.projectId, projectId));
}

export async function getTemplate(id: string) {
  const [template] = await readTemplates(eq(taskTemplateTable.id, id));
  if (!template) throw new HTTPException(404, { message: TEMPLATE_NOT_FOUND });
  return template;
}

/** Rejects references the template may not hold (400 or 403). */
async function assertReferences(projectId: string, input: TemplateInput) {
  const project = await projectOf(db, projectId);
  if (input.columnId) {
    const [column] = await db
      .select({ group: columnTable.group })
      .from(columnTable)
      .where(
        and(
          eq(columnTable.id, input.columnId),
          eq(columnTable.projectId, projectId),
        ),
      )
      .limit(1);
    if (!column || column.group === "triage") {
      throw new HTTPException(400, {
        message: "Choose a column of this project",
      });
    }
  }
  if (input.labelIds?.length) {
    const found = await workspaceLabels(
      db,
      project.workspaceId,
      input.labelIds,
    );
    if (found.length !== new Set(input.labelIds).size) {
      throw new HTTPException(400, {
        message: "Every label must be a label of this workspace",
      });
    }
  }
  if (input.assigneeIds?.length) {
    const members = await workspaceMembers(
      db,
      project.workspaceId,
      input.assigneeIds,
    );
    if (input.assigneeIds.some((id) => !members.has(id))) {
      throw new HTTPException(403, {
        message: "Assignees must be workspace members",
      });
    }
  }
  if (
    input.estimatePointId &&
    !(await isActivePoint(db, projectId, input.estimatePointId))
  ) {
    throw new HTTPException(400, {
      message: "The estimate must be a value of the project's active system",
    });
  }
  return project;
}

const unique = (ids: readonly string[] | undefined) =>
  ids === undefined ? undefined : [...new Set(ids)];

function isNameConflict(error: unknown): boolean {
  const cause = (error as { cause?: { code?: string } })?.cause;
  const code = (error as { code?: string })?.code ?? cause?.code;
  return code === "23505";
}

async function assertNameFree(projectId: string, name: string, id?: string) {
  const [taken] = await db
    .select({ id: taskTemplateTable.id })
    .from(taskTemplateTable)
    .where(
      and(
        eq(taskTemplateTable.projectId, projectId),
        sql`lower(${taskTemplateTable.name}) = lower(${name})`,
        id ? ne(taskTemplateTable.id, id) : undefined,
      ),
    )
    .limit(1);
  if (taken) throw new HTTPException(409, { message: TEMPLATE_NAME_TAKEN });
}

async function announce(
  projectId: string,
  workspaceId: string,
  userId: string,
  action: "created" | "updated" | "deleted",
  templateId: string,
) {
  await publishEvent("project.task_templates_updated", {
    projectId,
    workspaceId,
    userId,
    action,
    templateId,
  });
}

export async function createTemplate(
  input: TemplateInput & { projectId: string; name: string },
  userId: string,
) {
  const project = await assertReferences(input.projectId, input);
  await assertNameFree(input.projectId, input.name);

  const [{ count, top } = { count: 0, top: null }] = await db
    .select({
      count: sql<number>`count(*)::int`,
      top: max(taskTemplateTable.position),
    })
    .from(taskTemplateTable)
    .where(eq(taskTemplateTable.projectId, input.projectId));
  if (count >= MAX_TEMPLATES_PER_PROJECT) {
    throw new HTTPException(400, {
      message: `A project can have at most ${MAX_TEMPLATES_PER_PROJECT} templates`,
    });
  }

  let created: TemplateRow | undefined;
  try {
    [created] = await db
      .insert(taskTemplateTable)
      .values({
        projectId: input.projectId,
        name: input.name,
        titlePattern: input.titlePattern ?? "",
        description: input.description ?? "",
        columnId: input.columnId ?? null,
        priority: input.priority ?? null,
        labelIds: unique(input.labelIds) ?? [],
        assigneeIds: unique(input.assigneeIds) ?? [],
        estimatePointId: input.estimatePointId ?? null,
        subtasks: input.subtasks ?? [],
        position: top === null ? 0 : top + 1,
        createdBy: userId,
      })
      .returning();
  } catch (error) {
    if (isNameConflict(error)) {
      throw new HTTPException(409, { message: TEMPLATE_NAME_TAKEN });
    }
    throw error;
  }
  if (!created) throw new HTTPException(500, { message: "Create failed" });

  await announce(
    input.projectId,
    project.workspaceId,
    userId,
    "created",
    created.id,
  );
  return getTemplate(created.id);
}

/** The template's project and workspace, or 404. */
export async function templateScope(id: string) {
  const [row] = await db
    .select({
      projectId: taskTemplateTable.projectId,
      workspaceId: projectTable.workspaceId,
      deletedAt: projectTable.deletedAt,
    })
    .from(taskTemplateTable)
    .innerJoin(projectTable, eq(projectTable.id, taskTemplateTable.projectId))
    .where(eq(taskTemplateTable.id, id))
    .limit(1);
  // A template of a trashed project reads as gone.
  return row && !row.deletedAt ? row : null;
}

export async function updateTemplate(
  id: string,
  input: TemplateInput,
  userId: string,
) {
  const scope = await templateScope(id);
  if (!scope) throw new HTTPException(404, { message: TEMPLATE_NOT_FOUND });
  if (Object.values(input).every((value) => value === undefined)) {
    throw new HTTPException(400, {
      message: "Provide at least one field to change",
    });
  }
  await assertReferences(scope.projectId, input);
  if (input.name !== undefined) {
    await assertNameFree(scope.projectId, input.name, id);
  }

  try {
    await db
      .update(taskTemplateTable)
      .set({
        ...input,
        labelIds: unique(input.labelIds),
        assigneeIds: unique(input.assigneeIds),
      })
      .where(eq(taskTemplateTable.id, id));
  } catch (error) {
    if (isNameConflict(error)) {
      throw new HTTPException(409, { message: TEMPLATE_NAME_TAKEN });
    }
    throw error;
  }

  await announce(scope.projectId, scope.workspaceId, userId, "updated", id);
  return getTemplate(id);
}

export async function deleteTemplate(id: string, userId: string) {
  const scope = await templateScope(id);
  if (!scope) throw new HTTPException(404, { message: TEMPLATE_NOT_FOUND });
  await db.delete(taskTemplateTable).where(eq(taskTemplateTable.id, id));
  await announce(scope.projectId, scope.workspaceId, userId, "deleted", id);
  return { id };
}
