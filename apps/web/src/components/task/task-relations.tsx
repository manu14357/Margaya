import { useNavigate } from "@tanstack/react-router";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { type Ref, useImperativeHandle, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import useDeleteTaskRelation from "@/hooks/mutations/task-relation/use-delete-task-relation";
import { useGetTasks } from "@/hooks/queries/task/use-get-tasks";
import useGetTaskRelations from "@/hooks/queries/task-relation/use-get-task-relations";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useAssigneePeople } from "@/hooks/use-task-assignees";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import {
  assigneesOfTask,
  embeddedAssignees,
  resolveAssignees,
} from "@/lib/task-assignees";
import { groupRelations, RELATION_META } from "@/lib/task-relations";
import { toast } from "@/lib/toast";
import TaskRelationPicker from "./task-relation-picker";
import TaskRelationRow, {
  type ColumnLook,
  type RelatedTaskSummary,
} from "./task-relation-row";

export type TaskRelationsHandle = { openAdd: () => void };

type TaskRelationsProps = {
  taskId: string;
  projectId: string;
  workspaceId: string;
  ref?: Ref<TaskRelationsHandle>;
};

/**
 * The task's relations, grouped as this task reads them ("Blocked by",
 * "Blocking", ...). Related tasks may live in other projects of the
 * workspace; they open in their own project.
 */
export default function TaskRelations({
  taskId,
  projectId,
  workspaceId,
  ref,
}: TaskRelationsProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);

  const { data: relations = [] } = useGetTaskRelations(taskId);
  const { data: board } = useGetTasks(projectId);
  const { data: workspace } = useActiveWorkspace();
  const { people } = useAssigneePeople(workspace?.id ?? workspaceId);
  const deleteRelation = useDeleteTaskRelation(taskId);
  const { canUpdateTasks } = useWorkspacePermission();
  const canEdit = canUpdateTasks();

  useImperativeHandle(
    ref,
    () => ({
      openAdd: () => {
        if (!canEdit) return;
        setIsOpen(true);
        setPickerOpen(true);
      },
    }),
    [canEdit],
  );

  const groups = useMemo(
    () => groupRelations(relations, taskId),
    [relations, taskId],
  );
  const totalCount = groups.reduce((sum, group) => sum + group.items.length, 0);

  const columns = useMemo(
    () =>
      new Map<string, ColumnLook>(
        (board?.columns ?? []).map((column) => [column.id, column]),
      ),
    [board],
  );

  // Summaries carry every assignee id but only the first one's name.
  const getAssignees = (task: RelatedTaskSummary) =>
    resolveAssignees(
      assigneesOfTask(task),
      people,
      embeddedAssignees({
        userId: task.userId,
        assigneeName: task.assigneeName,
      }),
    );

  const handleOpen = (task: RelatedTaskSummary) => {
    navigate({
      to: "/dashboard/workspace/$workspaceId/project/$projectId/task/$taskId",
      params: { workspaceId, projectId: task.projectId, taskId: task.id },
    });
  };

  const handleRemove = (relationId: string) => {
    deleteRelation.mutate(relationId, {
      onError: (error) =>
        toast.error(error.message || t("tasks:relations.removeError")),
    });
  };

  return (
    <>
      <Collapsible open={isOpen} onOpenChange={setIsOpen} className="w-full">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-1 text-muted-foreground text-sm transition-colors hover:text-foreground"
              >
                {isOpen ? (
                  <ChevronDown className="size-4" />
                ) : (
                  <ChevronRight className="size-4" />
                )}
                <span>{t("tasks:relations.title")}</span>
              </button>
            </CollapsibleTrigger>
            {totalCount > 0 && (
              <span className="text-muted-foreground text-xs">
                {totalCount}
              </span>
            )}
          </div>
          {canEdit && (
            <Button
              variant="ghost"
              size="xs"
              className="text-muted-foreground"
              aria-label={t("tasks:detailActions.addRelation")}
              title={t("tasks:detailActions.addRelation")}
              onClick={() => setPickerOpen(true)}
            >
              <Plus className="size-3.5" />
            </Button>
          )}
        </div>

        <CollapsibleContent>
          {groups.map((group) => {
            const Icon = RELATION_META[group.key].icon;
            return (
              <div
                key={group.key}
                className="mt-1.5"
                data-relation-group={group.key}
              >
                <span className="flex items-center gap-1 px-2 text-[11px] text-muted-foreground/70">
                  <Icon className="size-3" />
                  {t(RELATION_META[group.key].groupKey)}
                </span>
                <div className="mt-0.5 flex flex-col">
                  {group.items.map(({ relation, task }) => (
                    <TaskRelationRow
                      key={relation.id}
                      task={task}
                      currentProjectId={projectId}
                      workspaceId={workspaceId}
                      canEdit={canEdit}
                      columns={columns}
                      assignees={getAssignees(task)}
                      onOpen={() => handleOpen(task)}
                      onRemove={() => handleRemove(relation.id)}
                    />
                  ))}
                </div>
              </div>
            );
          })}

          {totalCount === 0 && (
            <p className="px-2 py-1 text-muted-foreground text-xs">
              {t("tasks:relations.empty")}
            </p>
          )}
        </CollapsibleContent>
      </Collapsible>

      {canEdit && (
        <TaskRelationPicker
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          taskId={taskId}
          projectId={projectId}
          workspaceId={workspaceId}
          relations={relations}
        />
      )}
    </>
  );
}
