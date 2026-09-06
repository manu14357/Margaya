import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { columnTable, projectTable, taskTable } from "../../database/schema";
import { publishEvent } from "../../events";
import {
  filterAssignableUsers,
  NOT_ASSIGNABLE,
} from "../../utils/assert-assignable-user";
import { archivedTaskLanding, type StatusLanding } from "../archive";
import { resolveCreateAssignees } from "../assignee-rules";
import { insertInitialAssignees } from "../assignee-writes";
import {
  type AppliedExtras,
  applyImportExtras,
  checkImportEstimate,
  type ImportExtrasInput,
  loadImportFacts,
  MAX_IMPORT_TASKS,
  planImportExtras,
  publishImportExtras,
  resolveImportStatus,
} from "../import-extras";
import { completedAtForInsert, parseStatusInput, taskGroupOf } from "../scope";
import {
  coercePriority,
  coerceStatus,
  getValidTaskStatuses,
} from "../validate-task-fields";
import { claimTaskNumber } from "./claim-task-numbers";

export type ImportTask = ImportExtrasInput & {
  title: string;
  description?: string;
  status: string;
  priority?: string;
  startDate?: string | null;
  dueDate?: string | null;
  userId?: string | null;
  assigneeIds?: string[] | null;
  /** When set, the task is imported archived at that time. */
  archivedAt?: string | null;
};

/** The archive time of an imported task: null, a valid instant, or invalid. */
function importedArchivedAt(value: string | null | undefined) {
  if (!value) return null;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? "invalid" : at;
}

async function importTasks(
  projectId: string,
  tasksToImport: ImportTask[],
  currentUserId?: string,
) {
  if (tasksToImport.length > MAX_IMPORT_TASKS) {
    throw new HTTPException(400, {
      message: "Import at most 5,000 tasks per request",
    });
  }

  const project = await db.query.projectTable.findFirst({
    where: eq(projectTable.id, projectId),
  });

  if (!project) {
    throw new HTTPException(404, {
      message: "Project not found",
    });
  }

  const facts = await loadImportFacts(project, tasksToImport);

  // Same resolution as create: assigneeIds wins, else the single userId.
  const assigneesPerTask = tasksToImport.map((task) =>
    resolveCreateAssignees({
      assigneeIds: task.assigneeIds,
      userId: task.userId,
    }),
  );

  // One membership check for every id in the import.
  const assignableIds = await filterAssignableUsers(
    [...new Set(assigneesPerTask.flat())],
    project.workspaceId,
  );

  const validStatuses = await getValidTaskStatuses(projectId);
  // D7: the legacy "archived" status lands in the first completed column
  // (else the entry column, else planned), archived; read once per import.
  let archivedLanding: StatusLanding | null = null;

  const results = [];

  for (const [index, taskData] of tasksToImport.entries()) {
    const assigneeIds = assigneesPerTask[index] ?? [];

    if (assigneeIds.some((id) => !assignableIds.has(id))) {
      results.push({
        success: false,
        error: NOT_ASSIGNABLE,
        task: taskData,
      });
      continue;
    }

    try {
      const { status, warning: statusWarning } = coerceStatus(
        resolveImportStatus(taskData.status, validStatuses, facts),
        validStatuses,
      );
      const { priority, warning: priorityWarning } = coercePriority(
        taskData.priority || "low",
      );
      const extras = planImportExtras(taskData, facts);

      const requestedArchivedAt = importedArchivedAt(taskData.archivedAt);
      if (requestedArchivedAt === "invalid") {
        results.push({
          success: false,
          error: "Invalid archivedAt date",
          task: taskData,
        });
        continue;
      }
      if (parseStatusInput(status).archive && !archivedLanding) {
        archivedLanding = await archivedTaskLanding(db, projectId, "completed");
      }
      const landing = parseStatusInput(status).archive ? archivedLanding : null;
      const finalStatus = landing?.status ?? status;
      const archivedAt = requestedArchivedAt ?? (landing ? new Date() : null);
      const column = landing
        ? landing.columnId
          ? { id: landing.columnId, group: landing.group }
          : undefined
        : await db.query.columnTable.findFirst({
            where: and(
              eq(columnTable.projectId, projectId),
              eq(columnTable.slug, status),
            ),
          });

      const created = await db.transaction(async (tx) => {
        const taskNumber = await claimTaskNumber(projectId, tx);
        const estimatePointId = await checkImportEstimate(
          tx,
          extras,
          projectId,
        );

        const [task] = await tx
          .insert(taskTable)
          .values({
            projectId,
            userId: assigneeIds[0] ?? null,
            title: taskData.title,
            status: finalStatus,
            columnId: column?.id ?? null,
            completedAt: completedAtForInsert(
              taskGroupOf(finalStatus, column),
              new Date(),
            ),
            archivedAt,
            createdBy: currentUserId || null,
            startDate: taskData.startDate ? new Date(taskData.startDate) : null,
            dueDate: taskData.dueDate ? new Date(taskData.dueDate) : null,
            description: taskData.description || "",
            priority,
            number: taskNumber,
            estimatePointId,
          })
          .returning();

        if (!task) return { task, applied: null };
        await insertInitialAssignees(tx, task.id, assigneeIds);
        // Cycle and module rows need an acting user for their activity.
        const applied: AppliedExtras | null = currentUserId
          ? await applyImportExtras(
              tx,
              extras,
              task,
              project.workspaceId,
              currentUserId,
            )
          : null;
        return { task, applied };
      });
      const createdTask = created.task;
      const warnings = [
        statusWarning,
        priorityWarning,
        ...extras.warnings,
      ].filter(Boolean);

      if (createdTask) {
        await publishEvent("task.created", {
          ...createdTask,
          taskId: createdTask.id,
          userId: createdTask.userId ?? "",
          assigneeIds,
          currentUserId: currentUserId ?? "",
          type: "create",
          content: "imported the task",
        });
        if (created.applied && currentUserId) {
          await publishImportExtras(
            created.applied,
            createdTask,
            currentUserId,
          );
        }

        results.push({
          success: true,
          task: { ...createdTask, assigneeIds },
          ...(warnings.length > 0 && { warnings }),
        });
      } else {
        results.push({
          success: false,
          error: "Failed to create task",
          task: taskData,
        });
      }
    } catch (error) {
      if (error instanceof HTTPException) {
        throw error;
      }
      results.push({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        task: taskData,
      });
    }
  }

  return {
    importedAt: new Date().toISOString(),
    project: {
      id: project.id,
      name: project.name,
      slug: project.slug,
    },
    results: {
      total: tasksToImport.length,
      successful: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      tasks: results,
    },
  };
}

export default importTasks;
