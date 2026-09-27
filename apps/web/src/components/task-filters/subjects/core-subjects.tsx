import {
  AtSign,
  Bell,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  CalendarPlus,
  CircleDashed,
  Columns3,
  Flag,
  FolderKanban,
  History,
  Layers3,
  ListTree,
  Tag,
  UserPen,
  Users,
} from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import useAuth from "@/components/providers/auth-provider/hooks/use-auth";
import { useGetColumns } from "@/hooks/queries/column/use-get-columns";
import useGetLabelsByWorkspace from "@/hooks/queries/label/use-get-labels-by-workspace";
import { useGetActiveWorkspaceUsers } from "@/hooks/queries/workspace-users/use-get-active-workspace-users";
import { getColumnIcon } from "@/lib/column";
import {
  COLUMN_GROUP_META,
  CREATABLE_COLUMN_GROUPS,
} from "@/lib/column-groups";
import { getPriorityLabel } from "@/lib/i18n/domain";
import { resolveLabelColor } from "@/lib/label-color";
import { getPriorityIcon } from "@/lib/priority";
import { type LabelRow, labelValues } from "@/lib/task-query/labels";
import { ME_VALUE, NONE_VALUE } from "@/lib/task-query/model";
import { UnassignedCircle } from "../filter-primitives";
import { MemberAvatar } from "./member-avatar";
import { makeParentSearchHook, ParentTaskLabel } from "./parent-options";
import type {
  FilterOption,
  FilterSubject,
  FilterSubjectContext,
} from "./registry";
import { registerFilterSubject } from "./registry";

export const PRIORITY_VALUES = [
  "urgent",
  "high",
  "medium",
  "low",
  "no-priority",
] as const;

type Member = {
  userId: string;
  user?: { name?: string | null; image?: string | null } | null;
};

/** Me first, then the workspace members; optionally a "none" row. */
function useMemberOptions(
  workspaceId: string,
  enabled: boolean,
  noneLabel?: string,
): { options: FilterOption[]; isLoading: boolean } {
  const { t } = useTranslation();
  const currentUserId = useAuth().user?.id;
  const { data, isLoading } = useGetActiveWorkspaceUsers(
    enabled ? workspaceId : "",
  );
  const members = (data as { members?: Member[] } | undefined)?.members;
  const options = useMemo(() => {
    const list: FilterOption[] = [
      {
        value: ME_VALUE,
        label: t("tasks:filters.values.me"),
        icon: <MemberAvatar name={t("tasks:filters.values.me")} />,
      },
    ];
    if (noneLabel) {
      list.push({
        value: NONE_VALUE,
        label: noneLabel,
        icon: <UnassignedCircle />,
      });
    }
    const sorted = [...(members ?? [])].sort(
      (a, b) =>
        Number(b.userId === currentUserId) - Number(a.userId === currentUserId),
    );
    for (const member of sorted) {
      list.push({
        value: member.userId,
        label: member.user?.name || t("common:people.unknown"),
        icon: (
          <MemberAvatar name={member.user?.name} image={member.user?.image} />
        ),
      });
    }
    return list;
  }, [members, currentUserId, noneLabel, t]);
  return { options, isLoading: enabled && isLoading };
}

function singleProjectId(context: FilterSubjectContext): string | null {
  return context.scope.kind === "project" ? context.scope.projectId : null;
}

function useStatusSubjects(context: FilterSubjectContext): FilterSubject[] {
  const { t } = useTranslation();
  const projectId = singleProjectId(context);
  const { data: columns = [], isLoading } = useGetColumns(
    projectId && context.isActive("status") ? projectId : "",
  );
  return useMemo(() => {
    // Status is a column slug, so it needs one project (B4 §2.3).
    if (!projectId) return [];
    const options: FilterOption[] = [
      {
        value: "planned",
        label: t("tasks:groups.planned"),
        icon: <CircleDashed className="text-muted-foreground" />,
      },
      ...columns
        .filter((column) => column.group !== "triage")
        .map((column) => ({
          value: column.slug,
          label: column.name,
          icon: getColumnIcon(
            column.slug,
            column.isFinal,
            column.icon,
            column.group,
          ),
        })),
    ];
    return [
      {
        id: "status",
        key: "status",
        label: t("tasks:boardFilters.subjects.status"),
        icon: Columns3,
        kind: "set",
        options,
        isLoading,
      },
    ];
  }, [projectId, columns, isLoading, t]);
}

function useGroupSubjects(): FilterSubject[] {
  const { t } = useTranslation();
  return useMemo(
    () => [
      {
        id: "group",
        key: "group",
        label: t("tasks:filters.subjects.group"),
        icon: Layers3,
        kind: "set",
        options: CREATABLE_COLUMN_GROUPS.map((group) => {
          const meta = COLUMN_GROUP_META[group];
          const Icon = meta.icon;
          return {
            value: group,
            label: t(meta.labelKey),
            icon: <Icon className={meta.iconClassName} />,
          };
        }),
      },
    ],
    [t],
  );
}

function usePrioritySubjects(): FilterSubject[] {
  const { t } = useTranslation();
  return useMemo(
    () => [
      {
        id: "priority",
        key: "priority",
        label: t("tasks:boardFilters.subjects.priority"),
        icon: Flag,
        kind: "set",
        options: PRIORITY_VALUES.map((priority) => ({
          value: priority,
          label: getPriorityLabel(priority),
          icon: getPriorityIcon(priority),
        })),
      },
    ],
    [t],
  );
}

function useAssigneeSubjects(context: FilterSubjectContext): FilterSubject[] {
  const { t } = useTranslation();
  const assignees = useMemberOptions(
    context.workspaceId,
    context.isActive("assignee") ||
      context.isActive("createdBy") ||
      context.isActive("mention"),
    t("tasks:filters.values.noAssignee"),
  );
  const creators = useMemberOptions(
    context.workspaceId,
    context.isActive("assignee") ||
      context.isActive("createdBy") ||
      context.isActive("mention"),
    t("tasks:filters.values.noCreator"),
  );
  return useMemo(
    () => [
      {
        id: "assignee",
        key: "assignee",
        label: t("tasks:boardFilters.subjects.assignee"),
        icon: Users,
        kind: "set",
        options: assignees.options,
        isLoading: assignees.isLoading,
      },
      {
        id: "createdBy",
        key: "createdBy",
        label: t("tasks:filters.subjects.createdBy"),
        icon: UserPen,
        kind: "set",
        options: creators.options,
        isLoading: creators.isLoading,
      },
    ],
    [assignees, creators, t],
  );
}

/** Label options by name (B4 K5). */
export function labelOptionsOf(labels: readonly LabelRow[]): FilterOption[] {
  return labelValues(labels).map((label) => ({
    value: label.value,
    label: label.name,
    icon: (
      <span
        className="size-2.5 rounded-full"
        style={{ backgroundColor: resolveLabelColor(label.color) }}
      />
    ),
  }));
}

function useLabelSubjects(context: FilterSubjectContext): FilterSubject[] {
  const { t } = useTranslation();
  const { data = [], isLoading } = useGetLabelsByWorkspace(
    context.isActive("label") ? context.workspaceId : "",
  );
  return useMemo(
    () => [
      {
        id: "label",
        key: "label",
        label: t("tasks:boardFilters.subjects.labels"),
        icon: Tag,
        kind: "set",
        options: [
          {
            value: NONE_VALUE,
            label: t("tasks:filters.values.noLabel"),
          },
          ...labelOptionsOf(data as LabelRow[]),
        ],
        isLoading,
      },
    ],
    [data, isLoading, t],
  );
}

function useProjectSubjects(context: FilterSubjectContext): FilterSubject[] {
  const { t } = useTranslation();
  return useMemo(() => {
    if (context.scope.kind === "project") return [];
    return [
      {
        id: "project",
        key: "project",
        label: t("tasks:filters.subjects.project"),
        icon: FolderKanban,
        kind: "set",
        options: context.projects.map((project) => ({
          value: project.id,
          label: project.name,
          icon: (
            <span className="font-mono text-[9px] text-muted-foreground">
              {project.slug.slice(0, 3)}
            </span>
          ),
        })),
      },
    ];
  }, [context.scope.kind, context.projects, t]);
}

function useParentSubjects(context: FilterSubjectContext): FilterSubject[] {
  const { t } = useTranslation();
  const workspaceId = context.workspaceId;
  const projectIds = useMemo(
    () =>
      context.scope.kind === "project"
        ? [context.scope.projectId]
        : context.scope.projectIds,
    [context.scope],
  );
  return useMemo(
    () => [
      {
        id: "parent",
        key: "parent",
        label: t("tasks:filters.subjects.parent"),
        icon: ListTree,
        kind: "set",
        options: [
          { value: NONE_VALUE, label: t("tasks:filters.values.noParent") },
        ],
        useSearchOptions: makeParentSearchHook(workspaceId, projectIds),
        ValueLabel: ParentTaskLabel,
      },
    ],
    [workspaceId, projectIds, t],
  );
}

function usePeopleSubjects(context: FilterSubjectContext): FilterSubject[] {
  const { t } = useTranslation();
  const mentions = useMemberOptions(
    context.workspaceId,
    context.isActive("mention"),
  );
  return useMemo(
    () => [
      {
        id: "subscriber",
        key: "subscriber",
        label: t("tasks:filters.subjects.subscribed"),
        icon: Bell,
        kind: "set",
        // Subscriptions are personal: only your own can be filtered.
        options: [
          {
            value: ME_VALUE,
            label: t("tasks:filters.values.me"),
            icon: <MemberAvatar name={t("tasks:filters.values.me")} />,
          },
        ],
      },
      {
        id: "mention",
        key: "mention",
        label: t("tasks:filters.subjects.mentions"),
        icon: AtSign,
        kind: "set",
        options: mentions.options,
        isLoading: mentions.isLoading,
      },
    ],
    [mentions, t],
  );
}

function useDateSubjects(): FilterSubject[] {
  const { t } = useTranslation();
  return useMemo(
    () =>
      (
        [
          ["startDate", "tasks:filters.subjects.startDate", CalendarDays],
          ["dueDate", "tasks:boardFilters.subjects.dueDate", CalendarClock],
          ["createdAt", "tasks:filters.subjects.created", CalendarPlus],
          ["updatedAt", "tasks:filters.subjects.updated", History],
          ["completedAt", "tasks:filters.subjects.completed", CalendarCheck],
        ] as const
      ).map(([key, labelKey, icon]) => ({
        id: key,
        key,
        label: t(labelKey),
        icon,
        kind: "date" as const,
        options: [],
      })),
    [t],
  );
}

registerFilterSubject({
  id: "status",
  order: 10,
  useSubjects: useStatusSubjects,
});
registerFilterSubject({
  id: "group",
  order: 20,
  useSubjects: useGroupSubjects,
});
registerFilterSubject({
  id: "priority",
  order: 30,
  useSubjects: usePrioritySubjects,
});
registerFilterSubject({
  id: "people",
  order: 40,
  useSubjects: useAssigneeSubjects,
});
registerFilterSubject({
  id: "label",
  order: 50,
  useSubjects: useLabelSubjects,
});
registerFilterSubject({
  id: "dates",
  order: 100,
  useSubjects: useDateSubjects,
});
registerFilterSubject({
  id: "parent",
  order: 110,
  useSubjects: useParentSubjects,
});
registerFilterSubject({
  id: "project",
  order: 130,
  useSubjects: useProjectSubjects,
});
registerFilterSubject({
  id: "subscriptions",
  order: 140,
  useSubjects: usePeopleSubjects,
});
