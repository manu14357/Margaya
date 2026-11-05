import {
  closestCorners,
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  type UniqueIdentifier,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { snapCenterToCursor } from "@dnd-kit/modifiers";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { AnimatePresence, motion } from "framer-motion";
import { produce } from "immer";
import { Archive, ChevronRight, Flag, Plus } from "lucide-react";
import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import FocusedTaskShortcuts from "@/components/task/task-shortcuts/focused-task-shortcuts";
import CaptureBar from "@/components/task-draft/capture-bar";
import useCaptureFocus from "@/components/task-draft/capture-store";
import { useCaptureHost } from "@/components/task-draft/use-capture-host";
import { priorityColorsTaskCard } from "@/constants/priority-colors";
import { useBulkOperations } from "@/hooks/mutations/task/use-bulk-operations";
import { useUpdateTaskPosition } from "@/hooks/mutations/task/use-update-task-position";
import { useGetColumns } from "@/hooks/queries/column/use-get-columns";
import { useRenderWindow } from "@/hooks/use-render-window";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { cn } from "@/lib/cn";
import { getColumnIcon } from "@/lib/column";
import { COLUMN_GROUP_META, columnGroupOf } from "@/lib/column-groups";
import { placementWrites } from "@/lib/placement-writes";
import { assigneesOfTask } from "@/lib/task-assignees";
import { formatTaskKey } from "@/lib/task-key";
import { toast } from "@/lib/toast";
import useBulkSelectionStore from "@/store/bulk-selection";
import useProjectStore from "@/store/project";
import type { ProjectWithTasks } from "@/types/project";
import BulkToolbar from "../bulk-selection/bulk-toolbar";
import { useCanBulkSelect } from "../bulk-selection/selection-checkbox";
import {
  type ColumnTone,
  columnTones,
} from "../kanban-board/column/column-tone";
import { ArchiveTasksModal } from "../shared/modals/archive-tasks-modal";
import CreateTaskModal from "../shared/modals/create-task-modal";
import TaskRow from "./task-row";
import { useListTriage } from "./use-list-triage";

type ProjectColumn = ProjectWithTasks["columns"][number];

type ListViewProps = {
  project: ProjectWithTasks;
  disableDragDrop?: boolean;
  /**
   * The capture bar under each group and `c`. Off where a new task would
   * not belong to what the list shows (a cycle or module).
   */
  capture?: boolean;
};

type ListGroupProps = {
  column: ProjectColumn;
  /** The column's colour on the board, so both views show it the same way. */
  tone?: ColumnTone;
  project: ProjectWithTasks;
  expanded: boolean;
  showDropIndicator: boolean;
  capture: boolean;
  onToggle: () => void;
  onAddTask: () => void;
  onArchive: () => void;
};

/**
 * One status group: a sticky header (glyph, name, count, add, archive), its
 * rows and the capture bar. A module-level component, so a list re-render
 * never remounts it (the capture bar keeps its focus and text).
 */
function ListGroup({
  column,
  tone,
  project,
  expanded,
  showDropIndicator,
  capture,
  onToggle,
  onAddTask,
  onArchive,
}: ListGroupProps) {
  const { t } = useTranslation();
  const { canCreateTasks, canUpdateTasks } = useWorkspacePermission();
  const canCreate = canCreateTasks();
  const selectable = useCanBulkSelect();
  // Large groups mount their rows as they scroll into view.
  const { count, hasMore, sentinelRef } = useRenderWindow(column.tasks.length);
  const visibleTasks = column.tasks.slice(0, count);
  const group = columnGroupOf(column);
  const hues = tone ?? COLUMN_GROUP_META[group];
  const { setNodeRef } = useDroppable({
    id: column.id,
    data: {
      type: "column",
      column,
    },
  });

  return (
    <section
      aria-label={column.name}
      className={cn(
        "border-border/50 border-b transition-colors duration-150",
        showDropIndicator &&
          "bg-accent/35 outline-2 outline-primary/60 outline-dashed -outline-offset-2",
      )}
    >
      <div
        className="group/header sticky top-0 z-10 flex h-8 items-center justify-between border-border/50 border-b px-2 shadow-[inset_3px_0_0_var(--group-color)] md:px-3"
        style={
          {
            "--group-color": hues.color,
            backgroundColor: hues.tint,
          } as CSSProperties
        }
        data-group={group}
      >
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="flex min-w-0 items-center gap-1.5 font-medium text-[13px] text-foreground"
        >
          <ChevronRight
            className={cn(
              "size-3 shrink-0 text-muted-foreground transition-transform",
              expanded && "rotate-90",
            )}
          />
          <span className="flex shrink-0">
            {getColumnIcon(
              column.id,
              column.isFinal,
              column.icon,
              column.group,
              { hue: hues.color },
            )}
          </span>
          <span className="truncate">{column.name}</span>
          <span
            className="rounded-full bg-card px-1.5 font-medium text-[11px] tabular-nums leading-4 ring-1 ring-(--group-color)/30"
            style={{ color: hues.foreground }}
          >
            {column.tasks.length}
          </span>
        </button>

        <div className="flex items-center gap-0.5">
          {canCreate && (
            <button
              type="button"
              onClick={onAddTask}
              className="flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-background/70 hover:text-foreground"
              title={t("tasks:listView.addTask")}
            >
              <Plus className="size-3.5" />
            </button>
          )}

          {canUpdateTasks() && column.isFinal && column.tasks.length > 0 && (
            <button
              type="button"
              onClick={onArchive}
              className="flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-background/70 hover:text-foreground"
              title={t("tasks:listView.archiveAllTooltip")}
            >
              <Archive className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <div
          ref={setNodeRef}
          className="bg-card transition-[translate,opacity] duration-150 ease-out starting:-translate-y-1 starting:opacity-0 motion-reduce:starting:translate-y-0"
        >
          <SortableContext
            items={visibleTasks}
            strategy={verticalListSortingStrategy}
          >
            <AnimatePresence initial={false} mode="popLayout">
              {visibleTasks.map((task) => (
                <motion.div
                  key={task.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15, ease: [0.23, 1, 0.32, 1] }}
                >
                  <TaskRow
                    task={task}
                    projectSlug={project.slug ?? ""}
                    statusHue={hues.color}
                    selectable={selectable}
                  />
                </motion.div>
              ))}
            </AnimatePresence>
            {hasMore && <div ref={sentinelRef} aria-hidden className="h-px" />}
          </SortableContext>

          {column.tasks.length === 0 && !capture && (
            <div className="px-4 py-3 text-center text-muted-foreground text-xs">
              {t("tasks:listView.noTasks")}
            </div>
          )}

          {capture && canCreate && (
            <div className="px-1 py-1 md:px-1.5">
              <CaptureBar
                projectId={project.id}
                workspaceId={project.workspaceId}
                status={column.slug}
                statusName={column.name}
              />
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function ListView({
  project,
  disableDragDrop = false,
  capture = false,
}: ListViewProps) {
  const { t } = useTranslation();
  const { setProject } = useProjectStore();
  const setAvailableTasks = useBulkSelectionStore(
    (state) => state.setAvailableTasks,
  );
  const clearFocus = useBulkSelectionStore((state) => state.clearFocus);
  const { mutate: updateTaskPosition } = useUpdateTaskPosition();
  const { bulkArchive } = useBulkOperations();
  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null);
  const [overColumnId, setOverColumnId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [activeColumn, setActiveColumn] = useState<string | null>(null);
  const [isArchiveModalOpen, setIsArchiveModalOpen] = useState(false);
  const [columnToArchive, setColumnToArchive] = useState<ProjectColumn | null>(
    null,
  );

  useCaptureHost(capture ? project : undefined);
  useListTriage();

  // The board payload carries no column colours; the (shared, cached) column
  // list does.
  const { data: columnRecords } = useGetColumns(project?.id ?? "");
  const tones = useMemo(
    () =>
      columnTones(
        project?.columns ?? [],
        new Map(columnRecords?.map((record) => [record.slug, record.color])),
      ),
    [project?.columns, columnRecords],
  );

  // A capture request for a collapsed group opens it first.
  const captureRequest = useCaptureFocus((state) => state.request);
  useEffect(() => {
    if (!captureRequest || captureRequest.projectId !== project?.id) return;
    const target = project.columns.find(
      (column) => column.slug === captureRequest.status,
    );
    if (!target) return;
    setCollapsed((previous) =>
      previous[target.id] ? { ...previous, [target.id]: false } : previous,
    );
    // The bar mounts with the group; ask again once it is there.
    const frame = window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLInputElement>(
          `[data-capture-input="${CSS.escape(target.slug)}"]`,
        )
        ?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [captureRequest, project]);

  useEffect(() => {
    if (project?.columns) {
      const visibleTaskIds = project.columns
        .filter((column) => !collapsed[column.id])
        .flatMap((column) => column.tasks.map((task) => task.id));
      setAvailableTasks(visibleTaskIds);
    }
  }, [project, collapsed, setAvailableTasks]);

  useEffect(() => {
    clearFocus();
  }, [clearFocus]);

  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: { distance: disableDragDrop ? 999999 : 8 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: disableDragDrop ? 999999 : 200,
        tolerance: 8,
      },
    }),
    useSensor(KeyboardSensor),
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id);
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { over } = event;
    if (!over || !activeId) {
      setOverColumnId(null);
      return;
    }

    if (project?.columns?.some((col) => col.id === over.id)) {
      setOverColumnId(over.id.toString());
      return;
    }

    const taskId = over.id.toString();
    const columnWithTask = project?.columns?.find((col) =>
      col.tasks.some((task) => task.id === taskId),
    );

    if (columnWithTask) {
      setOverColumnId(columnWithTask.id);
    } else {
      setOverColumnId(null);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    setOverColumnId(null);

    if (!over || !project?.columns) return;

    const activeTaskId = active.id.toString();
    const overId = over.id.toString();

    const updatedProject = produce(project, (draft) => {
      const sourceColumn = draft?.columns?.find((col) =>
        col.tasks.some((task) => task.id === activeTaskId),
      );
      const destinationColumn = draft?.columns?.find(
        (col) =>
          col.id === overId || col.tasks.some((task) => task.id === overId),
      );

      if (!sourceColumn || !destinationColumn) return;

      const sourceTaskIndex = sourceColumn.tasks.findIndex(
        (task) => task.id === activeTaskId,
      );
      const task = sourceColumn.tasks[sourceTaskIndex];

      sourceColumn.tasks = sourceColumn.tasks.filter(
        (t) => t.id !== activeTaskId,
      );

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
          activeTaskId,
        )) {
          // Only the dragged task changes column. A neighbour's status may
          // have changed since this list loaded, so it must not be sent.
          updateTaskPosition({
            id: write.task.id,
            projectId: project.id,
            position: write.position,
            ...(write.task.id === activeTaskId
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
  };

  const toggleSection = (sectionId: string) => {
    setCollapsed((previous) => ({
      ...previous,
      [sectionId]: !previous[sectionId],
    }));
  };

  const handleArchiveClick = (column: ProjectColumn) => {
    if (!column.isFinal || column.tasks.length === 0) return;
    setColumnToArchive(column);
    setIsArchiveModalOpen(true);
  };

  const handleConfirmArchive = () => {
    if (!columnToArchive) return;

    // Archived tasks keep their column and leave the board (D7).
    const taskIds = columnToArchive.tasks.map((task) => task.id);
    const updatedProject = produce(project, (draft) => {
      const archivedColumn = draft?.columns?.find(
        (col) => col.id === columnToArchive.id,
      );
      if (!archivedColumn) return;
      archivedColumn.tasks = [];
    });

    setProject(updatedProject);
    bulkArchive(taskIds)
      .then(() =>
        toast.success(t("tasks:archive.success", { count: taskIds.length })),
      )
      .catch(() => {
        setProject(project);
        toast.error(t("tasks:archive.error"));
      });

    setIsArchiveModalOpen(false);
    setColumnToArchive(null);
  };

  if (!project?.columns) {
    return null;
  }

  const activeTask = activeId
    ? project.columns
        ?.flatMap((col) => col.tasks)
        .find((task) => task.id === activeId)
    : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      modifiers={[snapCenterToCursor]}
    >
      <FocusedTaskShortcuts
        resolve={(taskId) => {
          const task = project.columns
            .flatMap((column) => column.tasks)
            .find((entry) => entry.id === taskId);
          if (!task) return null;
          return {
            taskId: task.id,
            projectId: project.id,
            workspaceId: project.workspaceId,
            key: project.slug ? formatTaskKey(project.slug, task.number) : null,
            assigneeIds: assigneesOfTask(task),
          };
        }}
      />
      <div className="h-full w-full overflow-auto bg-background pb-24">
        {project.columns.map((column) => (
          <ListGroup
            key={column.id}
            column={column}
            tone={tones.get(column.id)}
            project={project}
            expanded={!collapsed[column.id]}
            showDropIndicator={Boolean(activeId) && overColumnId === column.id}
            capture={capture}
            onToggle={() => toggleSection(column.id)}
            onAddTask={() => {
              setIsTaskModalOpen(true);
              setActiveColumn(column.id);
            }}
            onArchive={() => handleArchiveClick(column)}
          />
        ))}
      </div>

      <DragOverlay>
        {activeTask && (
          <div className="bg-card border border-border rounded-lg shadow-lg p-2 max-w-[200px] cursor-grabbing">
            <div className="flex items-center gap-2">
              <div className="flex-shrink-0">
                <Flag
                  className={cn(
                    "w-3 h-3",
                    priorityColorsTaskCard[
                      activeTask.priority as keyof typeof priorityColorsTaskCard
                    ],
                  )}
                />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-mono text-muted-foreground">
                    {project?.slug}-{activeTask.number}
                  </span>
                  <span className="text-xs text-foreground truncate">
                    {activeTask.title}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
      </DragOverlay>

      <CreateTaskModal
        open={isTaskModalOpen}
        projectId={project.id}
        onClose={() => setIsTaskModalOpen(false)}
        status={activeColumn ?? "done"}
      />
      <ArchiveTasksModal
        open={isArchiveModalOpen}
        onClose={() => {
          setIsArchiveModalOpen(false);
          setColumnToArchive(null);
        }}
        onConfirm={handleConfirmArchive}
        taskCount={columnToArchive?.tasks.length ?? 0}
      />

      <BulkToolbar />
    </DndContext>
  );
}

export default ListView;
