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
import { useNavigate } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import { produce } from "immer";
import { Archive, ChevronRight, Clock, Flag, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { priorityColorsTaskCard } from "@/constants/priority-colors";
import { useArchiveTask } from "@/hooks/mutations/task/use-archive-task";
import { useUpdateTask } from "@/hooks/mutations/task/use-update-task";
import { useUpdateTaskStatus } from "@/hooks/mutations/task/use-update-task-status";
import { useRegisterShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { cn } from "@/lib/cn";
import { toast } from "@/lib/toast";
import useBacklogBulkSelectionStore from "@/store/backlog-bulk-selection";
import useProjectStore from "@/store/project";
import type { ProjectWithTasks } from "@/types/project";
import type Task from "@/types/task";
import BacklogBulkToolbar from "../bulk-selection/backlog-bulk-toolbar";
import CreateTaskModal from "../shared/modals/create-task-modal";
import BacklogTaskRow from "./backlog-task-row";

type BacklogListViewProps = {
  project?: ProjectWithTasks;
  disableDragDrop?: boolean;
};

function BacklogListView({
  project,
  disableDragDrop = false,
}: BacklogListViewProps) {
  const { t } = useTranslation();
  const { mutate: updateTask } = useUpdateTask();
  const { mutateAsync: setArchived } = useArchiveTask();
  const { mutateAsync: updateTaskStatus } = useUpdateTaskStatus();
  const { setProject } = useProjectStore();
  const {
    setAvailableTasks,
    focusNext,
    focusPrevious,
    focusedTaskId,
    clearFocus,
  } = useBacklogBulkSelectionStore();
  const navigate = useNavigate();
  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null);
  const [overColumnId, setOverColumnId] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<
    Record<string, boolean>
  >({
    planned: true,
    archived: true,
  });
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [activeColumn, setActiveColumn] = useState<string | null>(null);

  useEffect(() => {
    if (project) {
      const visibleTaskIds: string[] = [];
      if (expandedSections.planned) {
        visibleTaskIds.push(
          ...(project.plannedTasks || []).map((task) => task.id),
        );
      }
      if (expandedSections.archived) {
        visibleTaskIds.push(
          ...(project.archivedTasks || []).map((task) => task.id),
        );
      }
      setAvailableTasks(visibleTaskIds);
    }
  }, [project, expandedSections, setAvailableTasks]);

  useEffect(() => {
    clearFocus();
  }, [clearFocus]);

  useRegisterShortcuts({
    shortcuts: {
      j: () => {
        focusNext();
        const state = useBacklogBulkSelectionStore.getState();
        if (state.focusedTaskId) {
          navigate({ to: ".", search: { taskId: state.focusedTaskId } });
        }
      },
      k: () => {
        focusPrevious();
        const state = useBacklogBulkSelectionStore.getState();
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

    if (over.id === "planned" || over.id === "archived") {
      setOverColumnId(over.id.toString());
      return;
    }

    const taskId = over.id.toString();
    const plannedTasks = project?.plannedTasks || [];
    const archivedTasks = project?.archivedTasks || [];

    if (plannedTasks.some((task) => task.id === taskId)) {
      setOverColumnId("planned");
    } else if (archivedTasks.some((task) => task.id === taskId)) {
      setOverColumnId("archived");
    } else {
      setOverColumnId(null);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    setOverColumnId(null);

    if (!over || !project) return;

    const activeTaskId = active.id.toString();
    const overId = over.id.toString();

    const plannedTasks = project.plannedTasks || [];
    const archivedTasks = project.archivedTasks || [];
    // Archived tasks keep their column (D7): the section a task sits in, not
    // its status, says where it comes from.
    const sourceSection = archivedTasks.some((task) => task.id === activeTaskId)
      ? "archived"
      : "planned";
    const activeTask = [...plannedTasks, ...archivedTasks].find(
      (task) => task.id === activeTaskId,
    );

    if (!activeTask) return;

    let targetSection = overId;
    if (overId !== "planned" && overId !== "archived") {
      if (plannedTasks.some((task) => task.id === overId)) {
        targetSection = "planned";
      } else if (archivedTasks.some((task) => task.id === overId)) {
        targetSection = "archived";
      } else {
        return;
      }
    }

    if (sourceSection === targetSection) {
      const updatedProject = produce(project, (draft) => {
        const list =
          sourceSection === "planned"
            ? (draft.plannedTasks ?? [])
            : (draft.archivedTasks ?? []);
        const sourceIndex = list.findIndex((task) => task.id === activeTaskId);
        const task = list[sourceIndex];
        if (!task) return;
        list.splice(sourceIndex, 1);
        let destinationIndex = list.findIndex((t) => t.id === overId);
        if (destinationIndex === -1) destinationIndex = list.length;
        else if (sourceIndex <= destinationIndex) destinationIndex += 1;
        list.splice(destinationIndex, 0, task);
        list.forEach((t, index) => {
          updateTask({ ...t, position: index });
        });
      });
      setProject(updatedProject);
      return;
    }

    const toArchived = targetSection === "archived";
    const updatedProject = produce(project, (draft) => {
      draft.plannedTasks = (draft.plannedTasks ?? []).filter(
        (task) => task.id !== activeTaskId,
      );
      draft.archivedTasks = (draft.archivedTasks ?? []).filter(
        (task) => task.id !== activeTaskId,
      );
      if (toArchived) {
        draft.archivedTasks.push({
          ...activeTask,
          archivedAt: new Date().toISOString(),
        });
      } else {
        draft.plannedTasks.push({
          ...activeTask,
          status: "planned",
          archivedAt: null,
        });
      }
    });
    setProject(updatedProject);

    const move = async () => {
      if (toArchived) {
        await setArchived({
          taskId: activeTask.id,
          projectId: project.id,
          archived: true,
        });
        return;
      }
      // Out of the archive: restore, then move to planned if it sat in a
      // column.
      if (activeTask.status === "planned") {
        await setArchived({
          taskId: activeTask.id,
          projectId: project.id,
          archived: false,
        });
      } else {
        await updateTaskStatus({ ...activeTask, status: "planned" });
      }
    };
    move()
      .then(() =>
        toast.success(
          t(toArchived ? "tasks:archive.archived" : "tasks:archive.restored"),
        ),
      )
      .catch(() => {
        setProject(project);
        toast.error(
          t(toArchived ? "tasks:archive.error" : "tasks:archive.restoreError"),
        );
      });
  };

  const toggleSection = (sectionId: string) => {
    setExpandedSections((prev) => ({
      ...prev,
      [sectionId]: !prev[sectionId],
    }));
  };

  function BacklogSection({
    sectionId,
    title,
    icon: IconComponent,
    tasks,
    showAddButton = false,
    headerAction,
  }: {
    sectionId: string;
    title: string;
    icon: typeof Clock;
    tasks: Task[];
    showAddButton?: boolean;
    headerAction?: React.ReactNode;
  }) {
    const { setNodeRef } = useDroppable({
      id: sectionId,
      data: {
        type: "column",
        column: { id: sectionId, name: title },
      },
    });

    const showDropIndicator = activeId && overColumnId === sectionId;

    return (
      <div
        className={cn(
          "border-b border-border/50 transition-colors duration-150 overflow-auto",
          showDropIndicator &&
            "bg-accent/35 outline-2 outline-primary/60 outline-dashed -outline-offset-2",
        )}
      >
        <div
          className={cn(
            "flex h-8 items-center justify-between border-border/50 border-b px-2 md:px-3",
            sectionId === "planned"
              ? "bg-(--status-backlog-tint) shadow-[inset_3px_0_0_var(--status-backlog)]"
              : "bg-muted/80",
          )}
        >
          <button
            type="button"
            onClick={() => toggleSection(sectionId)}
            className="flex items-center gap-1.5 font-medium text-[13px] text-foreground transition-colors"
          >
            <ChevronRight
              className={cn(
                "w-3 h-3 transition-transform",
                expandedSections[sectionId] && "rotate-90",
              )}
            />
            <div className="flex items-center gap-2 h-4">
              <IconComponent
                className={cn(
                  "w-4 h-4 flex-shrink-0",
                  sectionId === "planned"
                    ? "text-(--status-backlog-fg)"
                    : "text-muted-foreground",
                )}
              />
              <div className="flex items-center gap-1">
                <span className="mt-1 mr-1">
                  {t(`tasks:backlog.sections.${sectionId}`, {
                    defaultValue: title,
                  })}
                </span>
                <span className="rounded-full bg-card px-1.5 font-medium text-[11px] text-muted-foreground tabular-nums leading-4 ring-1 ring-border">
                  {tasks.length}
                </span>
              </div>
            </div>
          </button>

          <div className="flex items-center gap-1">
            {headerAction}
            {showAddButton && (
              <button
                type="button"
                onClick={() => {
                  setIsTaskModalOpen(true);
                  setActiveColumn("planned");
                }}
                className="p-1 hover:bg-accent rounded text-muted-foreground hover:text-foreground transition-colors"
                title={t("tasks:backlog.addTask")}
              >
                <Plus className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        {expandedSections[sectionId] && (
          <div
            ref={setNodeRef}
            className="bg-card transition-[translate,opacity] duration-150 ease-out starting:-translate-y-1 starting:opacity-0 motion-reduce:starting:translate-y-0"
          >
            <SortableContext
              items={tasks}
              strategy={verticalListSortingStrategy}
            >
              <AnimatePresence initial={false} mode="popLayout">
                {tasks.map((task) => (
                  <motion.div
                    key={task.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15, ease: [0.23, 1, 0.32, 1] }}
                  >
                    <BacklogTaskRow task={task} />
                  </motion.div>
                ))}
              </AnimatePresence>
            </SortableContext>

            {tasks.length === 0 && (
              <div className="py-6 px-4 text-center text-xs text-muted-foreground">
                {t("tasks:backlog.noTasksInSection", {
                  section: t(`tasks:backlog.sections.${sectionId}`, {
                    defaultValue: title,
                  }).toLowerCase(),
                })}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  if (!project) {
    return null;
  }

  const plannedTasks = project.plannedTasks || [];
  const archivedTasks = project.archivedTasks || [];

  const activeTask =
    project.plannedTasks.find((task) => task.id === activeId) ||
    project.archivedTasks.find((task) => task.id === activeId);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      modifiers={[snapCenterToCursor]}
    >
      <div className="h-full w-full overflow-auto bg-background pb-24">
        <div className="divide-y divide-border/50">
          <BacklogSection
            sectionId="planned"
            title={t("tasks:backlog.sections.planned")}
            icon={Clock}
            tasks={plannedTasks}
            showAddButton={true}
          />

          <BacklogSection
            sectionId="archived"
            title={t("tasks:backlog.sections.archived")}
            icon={Archive}
            tasks={archivedTasks}
            headerAction={
              <button
                type="button"
                onClick={() =>
                  navigate({
                    to: "/dashboard/workspace/$workspaceId/project/$projectId/archives",
                    params: {
                      workspaceId: project.workspaceId,
                      projectId: project.id,
                    },
                  })
                }
                className="rounded px-1.5 py-0.5 text-muted-foreground text-xs transition-colors hover:bg-accent hover:text-foreground"
              >
                {t("workspace:archives.viewAll")}
              </button>
            }
          />
        </div>
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
        projectId={project?.id}
        onClose={() => setIsTaskModalOpen(false)}
        status={activeColumn ?? "planned"}
      />

      <BacklogBulkToolbar />
    </DndContext>
  );
}

export default BacklogListView;
