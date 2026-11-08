import { sql } from "drizzle-orm";
import { schema } from "../database";

// Whether a file reads as gone (C7), for the asset route's query: it joins the
// file's task, page and project, which these columns name.

const {
  activityTable,
  assetTable,
  pageTable,
  projectTable,
  taskTable,
  workspaceTable,
} = schema;

/** The file's own task, page or project is in the trash. */
export const assetInTrash = sql<boolean>`(${taskTable.deletedAt} is not null or ${pageTable.deletedAt} is not null or ${projectTable.deletedAt} is not null)`;

const linksAsset = (column: string) =>
  sql`${sql.raw(column)} like '%/api/asset/' || ${assetTable.id} || '%'`;

// A live task of a live project in the file's workspace.
const liveHolderTask = sql`holder_project.workspace_id = ${assetTable.workspaceId}
    and holder_project.deleted_at is null
    and holder_task.deleted_at is null`;

/**
 * In the trash, and nothing live in the workspace shows it. A file is shared
 * by everything that links it: a page duplicate shows the original's files,
 * and a task copy or any other text keeps the links it was given. So a file
 * only goes once no live page, task description or comment on a live task,
 * in a live project, links it. A trashed project doesn't stamp its pages, so
 * the holder's project is checked too. The CASE keeps the searches to files
 * in the trash.
 */
export const assetGone = sql<boolean>`case when ${assetInTrash} then not exists (
  select 1 from ${pageTable} as holder
  left join ${projectTable} as holder_project on holder_project.id = holder.project_id
  where holder.workspace_id = ${assetTable.workspaceId}
    and holder.deleted_at is null
    and holder_project.deleted_at is null
    and ${linksAsset("holder.content_markdown")}
) and not exists (
  select 1 from ${taskTable} as holder_task
  inner join ${projectTable} as holder_project on holder_project.id = holder_task.project_id
  where ${liveHolderTask}
    and ${linksAsset("holder_task.description")}
) and not exists (
  select 1 from ${activityTable} as holder_comment
  inner join ${taskTable} as holder_task on holder_task.id = holder_comment.task_id
  inner join ${projectTable} as holder_project on holder_project.id = holder_task.project_id
  where ${liveHolderTask}
    and holder_comment.type = 'comment'
    and ${linksAsset("holder_comment.content")}
) else false end`;

/**
 * In the trash, and live public text still shows the file: a task's
 * description or a public comment on a public board, or a published page.
 * Only that keeps it readable signed out; whatever else links it, the file is
 * the workspace's alone. The CASE keeps the searches to files in the trash.
 */
export const assetPublicHolder = sql<boolean>`case when ${assetInTrash} then exists (
  select 1 from ${taskTable} as holder_task
  inner join ${projectTable} as holder_project on holder_project.id = holder_task.project_id
  where ${liveHolderTask}
    and holder_project.is_public = true
    and ${linksAsset("holder_task.description")}
) or exists (
  select 1 from ${activityTable} as holder_comment
  inner join ${taskTable} as holder_task on holder_task.id = holder_comment.task_id
  inner join ${projectTable} as holder_project on holder_project.id = holder_task.project_id
  where ${liveHolderTask}
    and holder_project.is_public = true
    and holder_comment.type = 'comment'
    and holder_comment.visibility = 'public'
    and ${linksAsset("holder_comment.content")}
) or exists (
  select 1 from ${pageTable} as holder
  inner join ${projectTable} as holder_project on holder_project.id = holder.project_id
  inner join ${workspaceTable} as holder_workspace on holder_workspace.id = holder.workspace_id
  where holder.workspace_id = ${assetTable.workspaceId}
    and holder.deleted_at is null
    and holder.archived_at is null
    and holder.access = 'public'
    and holder.public_token is not null
    and holder_project.deleted_at is null
    and holder_project.archived_at is null
    and holder_project.pages_enabled = true
    and holder_workspace.allow_public_pages = true
    and holder_workspace.deletion_due_at is null
    and ${linksAsset("holder.content_markdown")}
) else false end`;
