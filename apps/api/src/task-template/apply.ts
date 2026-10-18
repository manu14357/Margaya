import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import { columnTable, projectTable } from "../database/schema";
import createLabel from "../label/controllers/create-label";
import { projectDefaultAssignee } from "../project/people";
import createTask from "../task/controllers/create-task";
import { entryColumn } from "../task/scope";
import { applyTitlePattern, getTemplate, templateScope } from "./templates";

/**
 * Creates a task from a template: its title pattern, description, column,
 * priority, assignees and estimate, then its labels and sub-tasks. The task
 * and each sub-task go through the regular create, so events, activity and
 * notifications are the same as for a task created by hand.
 */
export async function applyTemplate({
  templateId,
  title,
  status,
  userId,
  canLinkSubtasks,
}: {
  templateId: string;
  title?: string;
  status?: string;
  userId: string;
  /** task:update, which linking sub-tasks under the new task needs. */
  canLinkSubtasks: boolean;
}) {
  const scope = await templateScope(templateId);
  if (!scope) throw new HTTPException(404, { message: "Template not found" });
  const template = await getTemplate(templateId);
  if (template.subtasks.length > 0 && !canLinkSubtasks) {
    throw new HTTPException(403, {
      message: "Creating sub-tasks needs the task:update permission",
    });
  }

  const resolvedTitle = applyTitlePattern(template.titlePattern, title);
  if (!resolvedTitle) {
    throw new HTTPException(400, { message: "The task needs a title" });
  }

  const [project] = await db
    .select({ estimatesEnabled: projectTable.estimatesEnabled })
    .from(projectTable)
    .where(eq(projectTable.id, scope.projectId))
    .limit(1);
  const columns = await db
    .select({
      slug: columnTable.slug,
      position: columnTable.position,
      group: columnTable.group,
    })
    .from(columnTable)
    .where(eq(columnTable.projectId, scope.projectId));
  const entrySlug = entryColumn(columns)?.slug ?? "to-do";
  const targetStatus = status ?? template.column?.slug ?? entrySlug;

  const defaultAssignee =
    template.assigneeIds.length === 0
      ? await projectDefaultAssignee(scope.projectId)
      : null;

  const task = await createTask({
    projectId: scope.projectId,
    currentUserId: userId,
    assigneeIds:
      template.assigneeIds.length > 0
        ? template.assigneeIds
        : defaultAssignee
          ? [defaultAssignee]
          : [],
    title: resolvedTitle,
    description: template.description,
    status: targetStatus,
    priority: template.priority ?? undefined,
    estimatePointId: project?.estimatesEnabled
      ? template.estimatePointId
      : null,
  });

  for (const label of template.labels) {
    await createLabel(
      label.name,
      label.color,
      task.id,
      scope.workspaceId,
      userId,
    );
  }

  const subtaskIds: string[] = [];
  for (const subtaskTitle of template.subtasks) {
    const subtask = await createTask({
      projectId: scope.projectId,
      currentUserId: userId,
      assigneeIds: [],
      title: subtaskTitle,
      status: entrySlug,
      parentId: task.id,
    });
    subtaskIds.push(subtask.id);
  }

  return { ...task, subtaskIds };
}
