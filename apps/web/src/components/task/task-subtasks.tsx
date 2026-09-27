import { useNavigate } from "@tanstack/react-router";
import { AnimatePresence } from "framer-motion";
import { ChevronDown, ChevronRight, ListTree, Plus } from "lucide-react";
import {
  type Ref,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import CircularProgress from "@/components/ui/circular-progress";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import useCreateTask from "@/hooks/mutations/task/use-create-task";
import { useDeleteTask } from "@/hooks/mutations/task/use-delete-task";
import { useUpdateTaskStatus } from "@/hooks/mutations/task/use-update-task-status";
import useCreateTaskRelation from "@/hooks/mutations/task-relation/use-create-task-relation";
import { useGetColumns } from "@/hooks/queries/column/use-get-columns";
import useGetTaskRelations from "@/hooks/queries/task-relation/use-get-task-relations";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useAssigneePeople } from "@/hooks/use-task-assignees";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { getCompletedColumn, getEntryColumn } from "@/lib/column-groups";
import {
  assigneesOfTask,
  embeddedAssignees,
  resolveAssignees,
} from "@/lib/task-assignees";
import { toast } from "@/lib/toast";
import queryClient from "@/query-client";
import type Task from "@/types/task";
import AddExistingSubtaskDialog from "./add-existing-subtask-dialog";
import SubtaskRow from "./subtask-row";

export type TaskSubtasksHandle = {
  /** Expands the section and focuses the new sub-task input. */
  openCreate: () => void;
};

type TaskSubtasksProps = {
  taskId: string;
  projectId: string;
  workspaceId: string;
  parentStatus: string;
  ref?: Ref<TaskSubtasksHandle>;
};

export default function TaskSubtasks({
  taskId,
  projectId,
  workspaceId,
  parentStatus,
  ref,
}: TaskSubtasksProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [isAddingExisting, setIsAddingExisting] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [deleteTaskId, setDeleteTaskId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useImperativeHandle(ref, () => ({
    openCreate: () => {
      setIsOpen(true);
      setIsAdding(true);
      // Already open: the input is mounted and only needs the focus back.
      requestAnimationFrame(() => inputRef.current?.focus());
    },
  }));

  const { data: relations = [] } = useGetTaskRelations(taskId);
  const { data: workspace } = useActiveWorkspace();
  const { people } = useAssigneePeople(workspace?.id ?? workspaceId);
  const createTask = useCreateTask();
  const createRelation = useCreateTaskRelation();
  const { mutateAsync: deleteTask } = useDeleteTask();
  const { mutateAsync: updateTaskStatus } = useUpdateTaskStatus();
  const { data: columns = [], isLoading: isLoadingColumns } =
    useGetColumns(projectId);
  const { canCreateTasks, canUpdateTasks } = useWorkspacePermission();
  const canEdit = canUpdateTasks();
  const canCreate = canCreateTasks();

  // Map the completion checkbox to the project's actual column slugs (the API
  // validates status against columns). Checking moves a subtask to the first
  // completed-group column, unchecking to the entry column. A subtask counts
  // as completed while its column is closed (completed or cancelled).
  const doneSlug = getCompletedColumn(columns)?.slug;
  const todoSlug = getEntryColumn(columns)?.slug;
  const completeDisabledReason =
    !isLoadingColumns && columns.length > 0 && !doneSlug
      ? t("tasks:subtasks.noCompletedColumn")
      : undefined;
  const canCreateSubtask =
    parentStatus === "planned" || (!isLoadingColumns && Boolean(todoSlug));
  const columnsPending = parentStatus !== "planned" && isLoadingColumns;
  // A submit made while the columns were still loading; sent once they load.
  const [submitQueued, setSubmitQueued] = useState(false);
  const isCompleted = (status: string) =>
    columns.length > 0
      ? (columns.find((c) => c.slug === status)?.isFinal ?? false)
      : status === "done";

  const subtasks = relations
    .filter(
      (rel) => rel.relationType === "subtask" && rel.sourceTaskId === taskId,
    )
    .map((rel) => ({ relation: rel, task: rel.targetTask }))
    .filter(
      (item): item is typeof item & { task: NonNullable<typeof item.task> } =>
        item.task !== null,
    );

  const completedCount = subtasks.filter((s) =>
    isCompleted(s.task.status),
  ).length;
  const totalCount = subtasks.length;
  const hasSelection = selectedIds.size > 0;

  const toggleSelection = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setFocusedIndex(-1);
  }, []);

  const buildTaskObject = (subtask: (typeof subtasks)[number]): Task => ({
    id: subtask.task.id,
    title: subtask.task.title,
    number: subtask.task.number,
    description: null,
    status: subtask.task.status,
    priority: subtask.task.priority,
    startDate: null,
    dueDate: null,
    position: null,
    createdAt: "",
    userId: subtask.task.userId,
    assigneeId: subtask.task.userId,
    assigneeName: subtask.task.assigneeName,
    assigneeIds: subtask.task.assigneeIds,
    projectId: subtask.task.projectId,
  });

  const getTargetTasks = (currentTask: Task): Task[] => {
    if (hasSelection && selectedIds.has(currentTask.id)) {
      return subtasks
        .filter((s) => selectedIds.has(s.task.id))
        .map(buildTaskObject);
    }
    return [currentTask];
  };

  const handleToggleComplete = async (taskObj: Task) => {
    const nextStatus = isCompleted(taskObj.status)
      ? (todoSlug ?? "to-do")
      : (doneSlug ?? (columns.length === 0 ? "done" : undefined));
    if (!nextStatus) return;
    try {
      await updateTaskStatus({
        ...taskObj,
        status: nextStatus,
      });
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("tasks:popover.status.updateError"),
      );
    }
  };

  // Relation summaries carry every assignee id but only the first one's
  // name; the member list names the rest.
  const getAssignees = (subtask: (typeof subtasks)[number]) =>
    resolveAssignees(
      assigneesOfTask(subtask.task),
      people,
      embeddedAssignees({
        userId: subtask.task.userId,
        assigneeName: subtask.task.assigneeName,
      }),
    );

  const getSelectionRadius = (index: number, isSelected: boolean) => {
    if (!isSelected) return "rounded-md";

    const prevSelected =
      index > 0 && selectedIds.has(subtasks[index - 1].task.id);
    const nextSelected =
      index < subtasks.length - 1 &&
      selectedIds.has(subtasks[index + 1].task.id);

    if (prevSelected && nextSelected) return "rounded-none";
    if (prevSelected) return "rounded-t-none rounded-b-md";
    if (nextSelected) return "rounded-t-md rounded-b-none";
    return "rounded-md";
  };

  // Keyboard navigation
  useEffect(() => {
    const container = containerRef.current;
    if (!container || totalCount === 0) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target?.closest(
          "input, textarea, [contenteditable='true'], .ProseMirror",
        )
      )
        return;

      if (!container.contains(document.activeElement) && focusedIndex === -1)
        return;

      switch (e.key) {
        case "ArrowDown":
        case "j": {
          e.preventDefault();
          setFocusedIndex((prev) => (prev < totalCount - 1 ? prev + 1 : prev));
          break;
        }
        case "ArrowUp":
        case "k": {
          e.preventDefault();
          setFocusedIndex((prev) => (prev > 0 ? prev - 1 : prev));
          break;
        }
        case " ": {
          if (focusedIndex >= 0 && focusedIndex < totalCount) {
            e.preventDefault();
            toggleSelection(subtasks[focusedIndex].task.id);
          }
          break;
        }
        case "Enter": {
          if (focusedIndex >= 0 && focusedIndex < totalCount) {
            e.preventDefault();
            navigate({
              to: "/dashboard/workspace/$workspaceId/project/$projectId/task/$taskId",
              params: {
                workspaceId,
                projectId: subtasks[focusedIndex].task.projectId,
                taskId: subtasks[focusedIndex].task.id,
              },
            });
          }
          break;
        }
        case "Escape": {
          if (hasSelection) {
            e.preventDefault();
            clearSelection();
          } else if (focusedIndex >= 0) {
            e.preventDefault();
            setFocusedIndex(-1);
          }
          break;
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [
    focusedIndex,
    totalCount,
    subtasks,
    hasSelection,
    clearSelection,
    navigate,
    workspaceId,
    toggleSelection,
  ]);

  const handleAddSubtask = async () => {
    if (!canCreate || !canEdit || !newTitle.trim()) return;
    if (createTask.isPending || createRelation.isPending) return;
    // The new sub-task starts in the entry column, so it cannot be sent
    // before the columns load: hold the submit (the form shows it pending)
    // and send it once they arrive, instead of dropping what was typed.
    if (columnsPending) {
      setSubmitQueued(true);
      return;
    }
    setSubmitQueued(false);
    const initialStatus = parentStatus === "planned" ? "planned" : todoSlug;
    if (!initialStatus) {
      // No entry column (or the columns failed to load): keep the title and
      // say why nothing was created.
      toast.error(t("tasks:subtasks.noEntryColumn"));
      return;
    }

    try {
      const newTask = await createTask.mutateAsync({
        title: newTitle.trim(),
        description: "",
        projectId,
        status: initialStatus,
        priority: "no-priority",
      });

      await createRelation.mutateAsync({
        sourceTaskId: taskId,
        targetTaskId: newTask.id,
        relationType: "subtask",
      });

      setNewTitle("");
      setIsAdding(false);
    } catch {
      toast.error(t("tasks:subtasks.createError"));
    }
  };

  const addSubtaskRef = useRef(handleAddSubtask);
  addSubtaskRef.current = handleAddSubtask;
  useEffect(() => {
    if (submitQueued && !columnsPending) void addSubtaskRef.current();
  }, [submitQueued, columnsPending]);

  const handleDeleteTask = async () => {
    if (!deleteTaskId) return;
    try {
      await deleteTask(deleteTaskId);
      queryClient.invalidateQueries({ queryKey: ["tasks", projectId] });
      queryClient.invalidateQueries({ queryKey: ["task-relations", taskId] });
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(deleteTaskId);
        return next;
      });
      toast.success(t("tasks:subtasks.deleteSuccess"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("tasks:subtasks.deleteError"),
      );
    } finally {
      setDeleteTaskId(null);
    }
  };

  return (
    <>
      <Collapsible open={isOpen} onOpenChange={setIsOpen} className="w-full">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                {isOpen ? (
                  <ChevronDown className="size-4" />
                ) : (
                  <ChevronRight className="size-4" />
                )}
                <span>{t("tasks:subtasks.title")}</span>
              </button>
            </CollapsibleTrigger>
            {totalCount > 0 && (
              <span className="flex items-center gap-1.5 ml-0.5">
                <CircularProgress
                  completed={completedCount}
                  total={totalCount}
                />
                <span className="text-xs text-muted-foreground">
                  {completedCount}/{totalCount}
                </span>
              </span>
            )}
          </div>
          <div className="flex items-center">
            {canEdit && (
              <Button
                variant="ghost"
                size="xs"
                className="text-muted-foreground"
                aria-label={t("tasks:subtasks.addExisting")}
                title={t("tasks:subtasks.addExistingTitle")}
                onClick={() => setIsAddingExisting(true)}
              >
                <ListTree className="size-3.5" />
                <span className="hidden sm:inline">
                  {t("tasks:subtasks.addExisting")}
                </span>
              </Button>
            )}
            {canEdit && canCreate && (
              <Button
                variant="ghost"
                size="xs"
                className="text-muted-foreground"
                aria-label={`${t("tasks:subtasks.addAction")} ${t("tasks:subtasks.title")}`}
                onClick={() => setIsAdding(true)}
                disabled={!canCreateSubtask}
              >
                <Plus className="size-3.5" />
              </Button>
            )}
          </div>
        </div>

        <CollapsibleContent>
          {/* biome-ignore lint/a11y/noStaticElementInteractions: keyboard nav managed via document listener */}
          <div
            ref={containerRef}
            className="flex flex-col mt-1"
            onMouseDown={() => {
              if (focusedIndex === -1 && !hasSelection) {
                setFocusedIndex(0);
              }
            }}
          >
            <AnimatePresence initial={false}>
              {subtasks.map((subtask, index) => {
                const taskObj = buildTaskObject(subtask);
                const isSelected = selectedIds.has(subtask.task.id);

                return (
                  <SubtaskRow
                    key={subtask.task.id}
                    task={taskObj}
                    tasks={getTargetTasks(taskObj)}
                    projectId={projectId}
                    workspaceId={workspace?.id ?? workspaceId}
                    isSelected={isSelected}
                    isFocused={focusedIndex === index}
                    isCompleted={isCompleted(subtask.task.status)}
                    canEdit={canEdit}
                    completeDisabledReason={completeDisabledReason}
                    selectionRadius={getSelectionRadius(index, isSelected)}
                    assignees={getAssignees(subtask)}
                    onToggleComplete={() => handleToggleComplete(taskObj)}
                    onNavigate={() =>
                      navigate({
                        to: "/dashboard/workspace/$workspaceId/project/$projectId/task/$taskId",
                        params: {
                          workspaceId,
                          projectId: subtask.task.projectId,
                          taskId: subtask.task.id,
                        },
                      })
                    }
                    onDeleteClick={() => setDeleteTaskId(subtask.task.id)}
                  />
                );
              })}
            </AnimatePresence>
          </div>

          {isAdding && canEdit && canCreate && (
            <div className="flex items-center gap-2 mt-2">
              <Input
                ref={inputRef}
                size="sm"
                placeholder={t("tasks:subtasks.inputPlaceholder")}
                value={newTitle}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setNewTitle(e.target.value)
                }
                onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                  if (e.key === "Enter") handleAddSubtask();
                  if (e.key === "Escape") {
                    setIsAdding(false);
                    setNewTitle("");
                    setSubmitQueued(false);
                  }
                }}
                readOnly={submitQueued}
                aria-busy={submitQueued || createTask.isPending}
                autoFocus
              />
              <Button
                size="xs"
                onClick={handleAddSubtask}
                disabled={
                  !newTitle.trim() ||
                  createTask.isPending ||
                  submitQueued ||
                  (!columnsPending && !canCreateSubtask)
                }
              >
                {submitQueued || createTask.isPending
                  ? t("tasks:subtasks.adding")
                  : t("tasks:subtasks.addAction")}
              </Button>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => {
                  setIsAdding(false);
                  setNewTitle("");
                  setSubmitQueued(false);
                }}
              >
                {t("common:actions.cancel")}
              </Button>
            </div>
          )}

          {!isAdding && totalCount === 0 && (
            <p className="text-xs text-muted-foreground px-2 py-1">
              {t("tasks:subtasks.empty")}
            </p>
          )}
        </CollapsibleContent>
      </Collapsible>

      {isAddingExisting && (
        <AddExistingSubtaskDialog
          open={isAddingExisting}
          onOpenChange={setIsAddingExisting}
          taskId={taskId}
          projectId={projectId}
        />
      )}

      <AlertDialog
        open={!!deleteTaskId}
        onOpenChange={(open) => !open && setDeleteTaskId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("tasks:subtasks.deleteDialogTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("tasks:subtasks.deleteDialogDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" size="sm" />}>
              {t("common:actions.cancel")}
            </AlertDialogClose>
            <AlertDialogClose
              render={
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleDeleteTask}
                />
              }
            >
              {t("tasks:subtasks.deleteAction")}
            </AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
