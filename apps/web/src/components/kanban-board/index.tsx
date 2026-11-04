import {
  closestCorners,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  type DropAnimation,
  defaultDropAnimationSideEffects,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  type UniqueIdentifier,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { useQueryClient } from "@tanstack/react-query";
import { produce } from "immer";
import { useEffect, useMemo, useState } from "react";
import { useUpdateTaskPosition } from "@/hooks/mutations/task/use-update-task-position";
import { useGetColumns } from "@/hooks/queries/column/use-get-columns";
import { placementWrites } from "@/lib/placement-writes";
import useBulkSelectionStore from "@/store/bulk-selection";
import useProjectStore from "@/store/project";
import type { ProjectWithTasks } from "@/types/project";
import BulkToolbar from "../bulk-selection/bulk-toolbar";
import { useCaptureHost } from "../task-draft/use-capture-host";
import { BoardStageStrip } from "./board-stage-strip";
import Column from "./column";
import { columnTones } from "./column/column-tone";
import TaskCard from "./task-card";
import { useCardKeyboard } from "./use-card-keyboard";

type KanbanBoardProps = {
  project: ProjectWithTasks;
  disableDragDrop?: boolean;
  /**
   * A capture bar under each column and `c`. Off where a new task would not
   * belong to what the board shows (a cycle or module).
   */
  capture?: boolean;
};

function KanbanBoard({
  project,
  disableDragDrop = false,
  capture = false,
}: KanbanBoardProps) {
  const queryClient = useQueryClient();
  const { setProject } = useProjectStore();
  // Select the actions only: reading the whole store would re-render the
  // board on every selection and focus change.
  const setAvailableTasks = useBulkSelectionStore(
    (state) => state.setAvailableTasks,
  );
  const clearFocus = useBulkSelectionStore((state) => state.clearFocus);
  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null);
  const { mutate: updateTaskPosition } = useUpdateTaskPosition();
  useCaptureHost(capture ? project : undefined);
  // The board payload carries no column colours; the (shared, cached)
  // column list does.
  const { data: columnRecords } = useGetColumns(project?.id ?? "");
  const tones = useMemo(
    () =>
      columnTones(
        project?.columns ?? [],
        new Map(columnRecords?.map((record) => [record.slug, record.color])),
      ),
    [project?.columns, columnRecords],
  );

  useEffect(() => {
    if (project?.columns) {
      const allTaskIds = project.columns.flatMap((column) =>
        column.tasks.map((task) => task.id),
      );
      setAvailableTasks(allTaskIds);
    }
  }, [project, setAvailableTasks]);

  useEffect(() => {
    clearFocus();
  }, [clearFocus]);

  useCardKeyboard(useBulkSelectionStore, activeId !== null);

  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: { distance: disableDragDrop ? 999999 : 8 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: disableDragDrop ? 999999 : 250,
        tolerance: 10,
      },
    }),
    useSensor(KeyboardSensor),
  );

  const dropAnimation: DropAnimation = {
    sideEffects: defaultDropAnimationSideEffects({
      styles: {
        active: {
          opacity: "0.8",
        },
      },
    }),
    duration: 300,
    easing: "cubic-bezier(0.23, 1, 0.32, 1)",
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    if (!over || !project?.columns) return;

    const activeId = active.id.toString();
    const overId = over.id.toString();

    const updatedProject = produce(project, (draft) => {
      const sourceColumn = draft?.columns?.find((col) =>
        col.tasks.some((task) => task.id === activeId),
      );
      const destinationColumn = draft?.columns?.find(
        (col) =>
          col.id === overId || col.tasks.some((task) => task.id === overId),
      );

      if (!sourceColumn || !destinationColumn) return;

      const sourceTaskIndex = sourceColumn.tasks.findIndex(
        (task) => task.id === activeId,
      );
      const task = sourceColumn.tasks[sourceTaskIndex];

      sourceColumn.tasks = sourceColumn.tasks.filter((t) => t.id !== activeId);

      if (sourceColumn.id === destinationColumn.id) {
        let destinationIndex = destinationColumn.tasks.findIndex(
          (t) => t.id === overId,
        );
        if (sourceTaskIndex <= destinationIndex) {
          destinationIndex += 1;
        }
        destinationColumn.tasks.splice(destinationIndex, 0, task);

        for (const write of placementWrites(destinationColumn.tasks)) {
          updateTaskPosition({
            id: write.task.id,
            projectId: project.id,
            position: write.position,
          });
          write.task.position = write.position;
        }

        queryClient.invalidateQueries({
          queryKey: ["projects", project.workspaceId],
        });
      } else {
        // A task's status is a column slug. The column id is only the
        // droppable identity here, and the two are interchangeable only
        // because the tasks endpoint happens to return `id: column.slug`.
        task.status = destinationColumn.slug;
        const destinationIndex =
          overId === destinationColumn.id
            ? destinationColumn.tasks.length
            : destinationColumn.tasks.findIndex((t) => t.id === overId) + 1;

        destinationColumn.tasks.splice(destinationIndex, 0, task);

        for (const write of placementWrites(
          destinationColumn.tasks,
          activeId,
        )) {
          // Only the dragged card changes column. A neighbour's status may
          // have changed since this board loaded, so it must not be sent.
          updateTaskPosition({
            id: write.task.id,
            projectId: project.id,
            position: write.position,
            ...(write.task.id === activeId
              ? { status: destinationColumn.slug }
              : {}),
          });
          write.task.position = write.position;
        }

        for (const write of placementWrites(sourceColumn.tasks)) {
          updateTaskPosition({
            id: write.task.id,
            projectId: project.id,
            position: write.position,
          });
          write.task.position = write.position;
        }
      }
    });

    setProject(updatedProject);
    setActiveId(null);
  };

  if (!project?.columns) {
    return (
      <div className="flex h-full w-full gap-3 overflow-hidden p-3">
        {["a", "b", "c", "d"].map((column) => (
          <div
            key={`kanban-column-skeleton-${column}`}
            className="flex h-full w-[296px] shrink-0 flex-col gap-1.5 rounded-xl bg-muted/50 p-1.5"
          >
            <div className="flex h-7 items-center gap-2 px-1">
              <div className="h-3.5 w-24 animate-pulse rounded bg-muted" />
              <div className="h-3.5 w-5 animate-pulse rounded bg-muted" />
            </div>
            {["1", "2", "3"].map((card) => (
              <div
                key={`kanban-task-skeleton-${column}-${card}`}
                className="space-y-2 rounded-lg border border-border/60 bg-card p-2.5"
              >
                <div className="h-3.5 w-2/3 animate-pulse rounded bg-muted" />
                <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  }

  const activeTask = activeId
    ? project.columns
        .flatMap((col) => col.tasks)
        .find((task) => task.id === activeId)
    : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex h-full w-full flex-col">
        <BoardStageStrip columns={project.columns} />
        <div className="min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto [-webkit-overflow-scrolling:touch] md:snap-none">
          <div className="flex h-full min-w-max gap-2 px-2 py-2 md:gap-3 md:px-3 md:py-3">
            {project.columns?.map((column) => (
              <div
                key={column.id}
                id={`board-column-${column.id}`}
                className="h-full w-[calc(100vw-2rem)] max-w-[296px] shrink-0 snap-start scroll-ms-2 md:w-[280px] lg:w-[296px]"
              >
                <Column
                  column={column}
                  tone={tones.get(column.id)}
                  disableDragDrop={disableDragDrop}
                  capture={capture}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
      <DragOverlay dropAnimation={dropAnimation}>
        {activeTask ? (
          <div className="scale-[1.02] cursor-grabbing rounded-lg shadow-lg">
            <TaskCard task={activeTask} overlay />
          </div>
        ) : null}
      </DragOverlay>

      <BulkToolbar />
    </DndContext>
  );
}

export default KanbanBoard;
