import { jsonToMarkdown } from "@margaya/editor-schema";
import { and, asc, count, eq, isNull, or } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import { pageTemplateTable, projectTable } from "../database/schema";
import { publishEvent } from "../events";
import { currentPageDocument } from "./content";
import { loadVisiblePage } from "./controllers/shared";
import type { PageCaller } from "./rules";

// Saved page templates. A template belongs to a project, or (projectId null)
// to the whole workspace; "New page from template" copies its markdown into
// a new page (createPage's templateId). Built-in starters live in the web
// app, where their headings are translated.

export const PAGE_TEMPLATE_LIMIT = 200;

export const TEMPLATE_MESSAGES = {
  notFound: "Template not found",
  limit: "This workspace has reached the limit of 200 page templates",
  forbidden: "Only the person who saved the template or an admin can delete it",
} as const;

type TemplateRow = typeof pageTemplateTable.$inferSelect;

function toTemplate(row: TemplateRow, caller: PageCaller) {
  return {
    id: row.id,
    name: row.name,
    scope: row.projectId ? ("project" as const) : ("workspace" as const),
    projectId: row.projectId,
    logoKind: row.logoKind,
    logoValue: row.logoValue,
    createdById: row.createdById,
    createdAt: row.createdAt,
    canDelete:
      caller.isManager ||
      (caller.canCreate &&
        row.createdById !== null &&
        row.createdById === caller.userId),
  };
}

/** Templates available in the project: its own and the workspace's. */
export async function listPageTemplates(projectId: string, caller: PageCaller) {
  const rows = await db
    .select()
    .from(pageTemplateTable)
    .innerJoin(
      projectTable,
      eq(projectTable.workspaceId, pageTemplateTable.workspaceId),
    )
    .where(
      and(
        eq(projectTable.id, projectId),
        or(
          eq(pageTemplateTable.projectId, projectId),
          isNull(pageTemplateTable.projectId),
        ),
      ),
    )
    .orderBy(asc(pageTemplateTable.name), asc(pageTemplateTable.id));
  return rows.map((row) => toTemplate(row.page_template, caller));
}

/** Saves the page's current content as a template. */
export async function savePageAsTemplate({
  pageId,
  name,
  scope,
  caller,
}: {
  pageId: string;
  name: string;
  scope: "project" | "workspace";
  caller: PageCaller;
}) {
  const page = await loadVisiblePage(db, pageId, caller);
  if (!caller.canCreate || !page.projectId) {
    throw new HTTPException(403, { message: "Insufficient permissions" });
  }
  const [{ total } = { total: 0 }] = await db
    .select({ total: count() })
    .from(pageTemplateTable)
    .where(eq(pageTemplateTable.workspaceId, page.workspaceId));
  if (total >= PAGE_TEMPLATE_LIMIT) {
    throw new HTTPException(409, { message: TEMPLATE_MESSAGES.limit });
  }

  const markdown = jsonToMarkdown(await currentPageDocument(page));
  const now = new Date();
  const [created] = await db
    .insert(pageTemplateTable)
    .values({
      workspaceId: page.workspaceId,
      projectId: scope === "project" ? page.projectId : null,
      name,
      logoKind: page.logoKind,
      logoValue: page.logoValue,
      contentMarkdown: markdown,
      createdById: caller.userId,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!created) throw new Error("Failed to save the template");
  await publishEvent("page_template.changed", {
    workspaceId: created.workspaceId,
    projectId: created.projectId,
    templateId: created.id,
    userId: caller.userId,
    action: "created",
  });
  return toTemplate(created, caller);
}

/** A template the project may use, or 404. */
export async function loadUsableTemplate(
  templateId: string,
  workspaceId: string,
  projectId: string,
) {
  const [row] = await db
    .select()
    .from(pageTemplateTable)
    .where(
      and(
        eq(pageTemplateTable.id, templateId),
        eq(pageTemplateTable.workspaceId, workspaceId),
        or(
          eq(pageTemplateTable.projectId, projectId),
          isNull(pageTemplateTable.projectId),
        ),
      ),
    )
    .limit(1);
  if (!row)
    throw new HTTPException(404, { message: TEMPLATE_MESSAGES.notFound });
  return row;
}

export async function deletePageTemplate({
  templateId,
  workspaceId,
  caller,
}: {
  templateId: string;
  workspaceId: string;
  caller: PageCaller;
}) {
  const [row] = await db
    .select()
    .from(pageTemplateTable)
    .where(
      and(
        eq(pageTemplateTable.id, templateId),
        eq(pageTemplateTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  if (!row)
    throw new HTTPException(404, { message: TEMPLATE_MESSAGES.notFound });
  if (!toTemplate(row, caller).canDelete) {
    throw new HTTPException(403, { message: TEMPLATE_MESSAGES.forbidden });
  }
  await db.delete(pageTemplateTable).where(eq(pageTemplateTable.id, row.id));
  await publishEvent("page_template.changed", {
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    templateId: row.id,
    userId: caller.userId,
    action: "deleted",
  });
  return { id: row.id };
}
