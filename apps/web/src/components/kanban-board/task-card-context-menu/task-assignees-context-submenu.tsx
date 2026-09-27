import { useState } from "react";
import { useTranslation } from "react-i18next";
import useAuth from "@/components/providers/auth-provider/hooks/use-auth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  ContextMenuCheckboxItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import { useSetTaskAssignees } from "@/hooks/mutations/task/use-set-task-assignees";
import { useUpdateTaskAssignees } from "@/hooks/mutations/task/use-update-task-assignees";
import { useAssigneePeople } from "@/hooks/use-task-assignees";
import { getInitials } from "@/lib/get-initials";
import {
  assigneeDisplayName,
  assigneesOfTask,
  embeddedAssignees,
  MAX_TASK_ASSIGNEES,
  pickerOrder,
  resolveAssignees,
  type TaskAssignee,
} from "@/lib/task-assignees";
import { toast } from "@/lib/toast";
import type Task from "@/types/task";

type TaskAssigneesContextSubmenuProps = {
  task: Task;
  projectId: string;
  workspaceId: string;
};

function PersonAvatar({ person }: { person: TaskAssignee }) {
  return (
    <Avatar className="size-6">
      <AvatarImage src={person.image ?? ""} alt="" />
      <AvatarFallback className="border border-border/30 font-medium text-xs">
        {getInitials(person.name)}
      </AvatarFallback>
    </Avatar>
  );
}

/**
 * The "Assignees" submenu of the task card and row menu: "Unassigned", then
 * one checkable row per member (me first), then former members still
 * assigned. Each click saves at once; the menu stays open for more toggles.
 */
export default function TaskAssigneesContextSubmenu({
  task,
  projectId,
  workspaceId,
}: TaskAssigneesContextSubmenuProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { people } = useAssigneePeople(workspaceId);
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const { mutateAsync: updateAssignees } = useUpdateTaskAssignees();
  const { mutateAsync: setAssignees } = useSetTaskAssignees();

  if (!people) return null;

  const selectedIds = assigneesOfTask(task);
  const selected = new Set(selectedIds);
  const memberIds = new Set(people.map((person) => person.id));
  const members = resolveAssignees(pickerOrder([], people, user?.id), people);
  const formerMembers = resolveAssignees(
    selectedIds.filter((id) => !memberIds.has(id)),
    people,
    embeddedAssignees(task),
  );
  const atLimit = selectedIds.length >= MAX_TASK_ASSIGNEES;
  const target = { taskId: task.id, projectId, workspaceId };

  const markPending = (userIds: readonly string[], pending: boolean) =>
    setPendingIds((current) => {
      const next = new Set(current);
      for (const id of userIds) {
        if (pending) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  const run = async (
    userIds: readonly string[],
    save: () => Promise<unknown>,
  ) => {
    markPending(userIds, true);
    try {
      await save();
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : t("tasks:assignees.updateError"),
      );
    } finally {
      markPending(userIds, false);
    }
  };

  const toggle = (userId: string, checked: boolean) =>
    void run([userId], () =>
      updateAssignees({
        ...target,
        ...(checked ? { add: [userId] } : { remove: [userId] }),
      }),
    );

  const clear = () => {
    if (selectedIds.length === 0) return;
    void run(selectedIds, () => setAssignees({ ...target, assigneeIds: [] }));
  };

  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>
        <span>{t("tasks:assignee.label")}</span>
      </ContextMenuSubTrigger>
      <ContextMenuSubContent className="max-h-80 w-56 overflow-y-auto">
        <ContextMenuCheckboxItem
          checked={selectedIds.length === 0}
          onCheckedChange={clear}
          closeOnClick={false}
        >
          <span
            aria-hidden="true"
            className="flex size-6 items-center justify-center rounded-full border border-border bg-muted font-medium text-[10px] text-muted-foreground"
          >
            ?
          </span>
          <span>{t("tasks:assignee.unassigned")}</span>
        </ContextMenuCheckboxItem>
        {members.map((person) => {
          const name = assigneeDisplayName(person, t);
          const isSelected = selected.has(person.id);
          return (
            <ContextMenuCheckboxItem
              key={person.id}
              checked={isSelected}
              disabled={pendingIds.has(person.id) || (atLimit && !isSelected)}
              onCheckedChange={(checked) => toggle(person.id, checked)}
              closeOnClick={false}
            >
              <PersonAvatar person={person} />
              <span className="truncate">
                {person.id === user?.id
                  ? t("tasks:assignees.you", { name })
                  : name}
              </span>
            </ContextMenuCheckboxItem>
          );
        })}
        {formerMembers.map((person) => (
          <ContextMenuCheckboxItem
            key={person.id}
            checked
            disabled={pendingIds.has(person.id)}
            onCheckedChange={(checked) => toggle(person.id, checked)}
            closeOnClick={false}
          >
            <PersonAvatar person={person} />
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-muted-foreground">
                {assigneeDisplayName(person, t)}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {t("tasks:assignees.formerMember")}
              </span>
            </span>
          </ContextMenuCheckboxItem>
        ))}
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}
