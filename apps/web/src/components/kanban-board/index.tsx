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
import { useNavigate } from "@tanstack/react-router";
import { produce } from "immer";
import { useEffect, useState } from "react";
import { useUpdateTask } from "@/hooks/mutations/task/use-update-task";
import { useRegisterShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { placementWrites } from "@/lib/placement-writes";
import useBulkSelectionStore from "@/store/bulk-selection";
import useProjectStore from "@/store/project";
import type { ProjectWithTasks } from "@/types/project";
import BulkToolbar from "../bulk-selection/bulk-toolbar";
import { useCaptureHost } from "../task-draft/use-capture-host";
import { BoardStageStrip } from "./board-stage-strip";
import Column from "./column";
import TaskCard from "./task-card";

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
  const {
    setAvailableTasks,
    focusNext,
    focusPrevious,
    focusedTaskId,
    clearFocus,
  } = useBulkSelectionStore();
  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null);
  const { mutate: updateTask } = useUpdateTask();
  const navigate = useNavigate();
  useCaptureHost(capture ? project : undefined);

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

  useRegisterShortcuts({
    shortcuts: {
      j: () => {
        focusNext();
        const state = useBulkSelectionStore.getState();
        if (state.focusedTaskId) {
          navigate({ to: ".", search: { taskId: state.focusedTaskId } });
        }
      },
      k: () => {
        focusPrevious();
        const state = useBulkSelectionStore.getState();
        if (state.focusedTaskId) {
          navigate({ to: ".", search: { taskId: state.focusedTaskId } });
        }
      },
      Enter: () => {
        if (focusedTaskId && project) {
          navigate({
            to: "/dashboard/workspace/$workspaceId/project/$projectId/task/$taskId",
            params: {
              workspaceId: project.workspaceId,
              projectId: project.id,
              taskId: focusedTaskId,
            },
          });
        }
      },
    },
  });

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
          updateTask({ ...write.task, position: write.position });
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
          updateTask({
            ...write.task,
            status: destinationColumn.slug,
            position: write.position,
          });
          write.task.position = write.position;
        }

        for (const write of placementWrites(sourceColumn.tasks)) {
          updateTask({ ...write.task, position: write.position });
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
          <div className="transform rotate-1 scale-[1.03] shadow-lg">
            <div className="ring-2 ring-ring/35 rounded-lg">
              <TaskCard task={activeTask} />
            </div>
          </div>
        ) : null}
      </DragOverlay>

      <BulkToolbar />
    </DndContext>
  );
}

export default KanbanBoard;
