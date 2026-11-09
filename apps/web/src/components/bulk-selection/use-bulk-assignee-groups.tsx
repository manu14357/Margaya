import { X } from "lucide-react";
import { type ReactNode, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useBulkOperations } from "@/hooks/mutations/task/use-bulk-operations";
import { useAssigneePeople } from "@/hooks/use-task-assignees";
import { getInitials } from "@/lib/get-initials";
import { HttpError } from "@/lib/http-error";
import {
  assigneeDisplayName,
  assigneeUnion,
  resolveAssignees,
  type TaskAssignee,
} from "@/lib/task-assignees";
import { toast } from "@/lib/toast";
import type { ProjectWithTasks } from "@/types/project";
import type Task from "@/types/task";

export type BulkAssigneeItem = {
  value: string;
  label: string;
  icon?: ReactNode;
  onRun: () => void;
};

export type BulkAssigneeGroup = {
  value: string;
  label: string;
  items: BulkAssigneeItem[];
};

type Options = {
  project: ProjectWithTasks | undefined;
  workspaceId: string;
  selectedTaskIds: ReadonlySet<string>;
  /** Without the assign permission there are no groups. */
  enabled: boolean;
  /** Runs after a successful change, e.g. to clear the selection. */
  onDone: () => void;
};

function PersonAvatar({ person }: { person: TaskAssignee }) {
  return (
    <Avatar className="h-5 w-5">
      <AvatarImage src={person.image ?? ""} alt="" />
      <AvatarFallback className="text-xs font-medium border border-border/30">
        {getInitials(person.name)}
      </AvatarFallback>
    </Avatar>
  );
}

function selectedTasksOf(
  project: ProjectWithTasks | undefined,
  selectedTaskIds: ReadonlySet<string>,
): Task[] {
  if (!project) return [];
  return [
    ...project.columns.flatMap((column) => column.tasks),
    ...project.plannedTasks,
    ...project.archivedTasks,
  ].filter((task) => selectedTaskIds.has(task.id));
}

/**
 * The bulk bar's assignee groups: "Add assignee" lists every member;
 * "Remove assignee" lists whoever is on any selected task, then "Clear
 * assignees". Each item is one request for all selected tasks.
 */
export function useBulkAssigneeGroups({
  project,
  workspaceId,
  selectedTaskIds,
  enabled,
  onDone,
}: Options): BulkAssigneeGroup[] {
  const { t } = useTranslation();
  const { people, audience } = useAssigneePeople(workspaceId);
  const { bulkAddAssignee, bulkRemoveAssignee, bulkClearAssignees } =
    useBulkOperations();

  return useMemo(() => {
    if (!enabled) return [];
    const taskIds = [...selectedTaskIds];
    const selectedTasks = selectedTasksOf(project, selectedTaskIds);
    const assigned = resolveAssignees(
      assigneeUnion(selectedTasks),
      people,
      selectedTasks.flatMap((task) => task.assignees ?? []),
      { audience },
    );

    const run = async (
      save: () => Promise<{ updatedCount: number }>,
      success: (count: number) => string,
    ) => {
      try {
        const { updatedCount } = await save();
        toast.success(success(updatedCount));
        onDone();
      } catch (error) {
        // The server explains a refusal, such as the 20-assignee limit.
        toast.error(
          error instanceof HttpError && error.message
            ? error.message
            : t("tasks:bulk.assigneesError"),
        );
      }
    };

    const addItems = (people ?? []).map((person) => {
      const name = assigneeDisplayName(person, t);
      return {
        value: `add-assignee-${person.id}`,
        label: name,
        icon: <PersonAvatar person={person} />,
        onRun: () =>
          void run(
            () => bulkAddAssignee({ taskIds, userId: person.id }),
            (count) => t("tasks:bulk.addAssigneeSuccess", { name, count }),
          ),
      };
    });

    const removeItems = assigned.map((person) => {
      const name = assigneeDisplayName(person, t);
      return {
        value: `remove-assignee-${person.id}`,
        label: name,
        icon: <PersonAvatar person={person} />,
        onRun: () =>
          void run(
            () => bulkRemoveAssignee({ taskIds, userId: person.id }),
            (count) => t("tasks:bulk.removeAssigneeSuccess", { name, count }),
          ),
      };
    });

    return [
      {
        value: "add-assignee",
        label: t("tasks:bulk.addAssignee"),
        items: addItems,
      },
      {
        value: "remove-assignee",
        label: t("tasks:bulk.removeAssignee"),
        items: [
          ...removeItems,
          {
            value: "clear-assignees",
            label: t("tasks:bulk.clearAssignees"),
            icon: <X className="h-4 w-4 text-muted-foreground" />,
            onRun: () =>
              void run(
                () => bulkClearAssignees(taskIds),
                (count) => t("tasks:bulk.clearAssigneesSuccess", { count }),
              ),
          },
        ],
      },
    ];
  }, [
    enabled,
    selectedTaskIds,
    project,
    people,
    audience,
    onDone,
    t,
    bulkAddAssignee,
    bulkRemoveAssignee,
    bulkClearAssignees,
  ]);
}
