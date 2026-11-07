import { and, asc, inArray, ne } from "drizzle-orm";
import db from "../../database";
import { projectTable, taskTable } from "../../database/schema";
import { shareProjectEstimates } from "../../estimate/write";
import { publishEvent } from "../../events";
import {
  carryCustomFieldValues,
  dropLabelsFromOtherWorkspaces,
} from "../move-carry-over";
import { liveTaskCondition } from "../scope";
import claimTaskNumbers from "./claim-task-numbers";
import {
  applyTaskMove,
  chooseDestinationColumn,
  findDestinationProject,
  loadDestinationColumns,
  publishTaskMove,
} from "./move-task";

/**
 * Moves the tasks to another project of their workspace, all or none, by the
 * single-task move's rules: new task keys, the same status when the
 * destination has it and otherwise its first column, and no cycle, module or
 * estimate. See move-carry-over.ts for custom fields and labels. Tasks already
 * in the destination are skipped. Authorization on both ends is the route's
 * (requireBulkTaskPermission). Returns how many tasks moved.
 */
async function bulkMoveTasks({
  tasks,
  workspaceId,
  destinationProjectId,
  userId,
}: {
  tasks: { id: string; projectId: string }[];
  workspaceId: string;
  destinationProjectId: string;
  userId: string;
}) {
  const destinationProject = await findDestinationProject(
    workspaceId,
    destinationProjectId,
    userId,
  );
  const columns = await loadDestinationColumns(destinationProjectId);

  const sourceProjectIds = [
    ...new Set(tasks.map((task) => task.projectId)),
  ].sort();

  const sourceProjects = await db
    .select({ id: projectTable.id, name: projectTable.name })
    .from(projectTable)
    .where(inArray(projectTable.id, sourceProjectIds));

  const { moves, droppedLabels } = await db.transaction(async (tx) => {
    // Sorted, like the task locks below, so that concurrent moves of
    // overlapping selections cannot deadlock.
    for (const projectId of sourceProjectIds) {
      await shareProjectEstimates(tx, projectId);
    }
    const locked = await tx
      .select({
        id: taskTable.id,
        projectId: taskTable.projectId,
        status: taskTable.status,
        position: taskTable.position,
        estimatePointId: taskTable.estimatePointId,
      })
      .from(taskTable)
      .where(
        and(
          inArray(
            taskTable.id,
            tasks.map((task) => task.id),
          ),
          liveTaskCondition,
          ne(taskTable.projectId, destinationProjectId),
        ),
      )
      .orderBy(asc(taskTable.id))
      .for("update");

    if (locked.length === 0) return { moves: [], droppedLabels: [] };

    const firstNumber = await claimTaskNumbers(
      destinationProjectId,
      locked.length,
      tx,
    );

    // Tasks that land in one column keep their relative order.
    const ordered = [...locked].sort(
      (a, b) => (a.position ?? 0) - (b.position ?? 0),
    );
    const moves = [];
    for (const [index, task] of ordered.entries()) {
      const move = await applyTaskMove(tx, {
        taskId: task.id,
        oldEstimatePointId: task.estimatePointId,
        column: chooseDestinationColumn(columns, task.status),
        taskNumber: firstNumber + index,
        destinationProjectId,
        userId,
      });
      moves.push({ move, source: task });
    }

    const movedIds = locked.map((task) => task.id);
    await carryCustomFieldValues(tx, movedIds, destinationProjectId);
    const droppedLabels = await dropLabelsFromOtherWorkspaces(
      tx,
      movedIds,
      workspaceId,
    );

    return { moves, droppedLabels };
  });

  const projectName = new Map(
    sourceProjects.map((project) => [project.id, project.name]),
  );
  for (const { move, source } of moves) {
    await publishTaskMove({
      move,
      sourceProject: {
        id: source.projectId,
        name: projectName.get(source.projectId) ?? "",
      },
      destinationProject,
      oldStatus: source.status,
      userId,
    });
    for (const label of droppedLabels) {
      if (label.taskId !== move.movedTask.id) continue;
      await publishEvent("task.label_unassigned", {
        label,
        task: move.movedTask,
        projectId: destinationProjectId,
        taskId: move.movedTask.id,
        userId,
        type: "label_unassigned",
      });
    }
  }

  return moves.length;
}

export default bulkMoveTasks;
