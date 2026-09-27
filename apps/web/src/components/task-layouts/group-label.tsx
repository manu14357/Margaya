import { CircleDashed } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CycleStatusIcon } from "@/components/cycle/cycle-status";
import { ModuleStatusIcon } from "@/components/module/module-status";
import { UnassignedCircle } from "@/components/task-filters/filter-primitives";
import { MemberAvatar } from "@/components/task-filters/subjects/member-avatar";
import icons from "@/constants/project-icons";
import { getColumnIcon } from "@/lib/column";
import { COLUMN_GROUP_META, isColumnGroup } from "@/lib/column-groups";
import { formatEstimateValue } from "@/lib/estimate/format";
import { getPriorityLabel } from "@/lib/i18n/domain";
import { resolveLabelColor } from "@/lib/label-color";
import { getPriorityIcon } from "@/lib/priority";
import type { GroupByKey } from "@/lib/task-query/model";
import type { TaskQueryMeta } from "@/types/task-query";

export const NONE_GROUP = "none";
export const ALL_GROUP = "all";

export type GroupPresentation = { label: string; icon: ReactNode };

const NONE_LABEL_KEYS: Partial<Record<GroupByKey, string>> = {
  assignee: "tasks:groups.noAssignee",
  createdBy: "tasks:groups.noCreator",
  label: "tasks:groups.noLabel",
  cycle: "tasks:groups.noCycle",
  module: "tasks:groups.noModule",
  estimate: "tasks:groups.noEstimate",
};

/** How a group key reads in headers: its name and icon (B4 §6.6). */
export function useGroupPresentation() {
  const { t } = useTranslation();

  return (
    groupBy: GroupByKey | null,
    key: string,
    meta: TaskQueryMeta,
  ): GroupPresentation => {
    if (!groupBy || key === ALL_GROUP) {
      return { label: t("tasks:groups.all"), icon: null };
    }
    if (key === NONE_GROUP && NONE_LABEL_KEYS[groupBy]) {
      return {
        label: t(NONE_LABEL_KEYS[groupBy] as string),
        icon:
          groupBy === "assignee" || groupBy === "createdBy" ? (
            <UnassignedCircle />
          ) : (
            <CircleDashed className="size-3.5 text-muted-foreground" />
          ),
      };
    }
    switch (groupBy) {
      case "status": {
        if (key === "planned") {
          return {
            label: t("tasks:groups.planned"),
            icon: <CircleDashed className="size-3.5 text-muted-foreground" />,
          };
        }
        const column = meta.columns.find((candidate) => candidate.slug === key);
        return {
          label: column?.name ?? key,
          icon: getColumnIcon(
            key,
            column?.isFinal,
            column?.icon ?? undefined,
            column?.group,
          ),
        };
      }
      case "group": {
        if (!isColumnGroup(key)) return { label: key, icon: null };
        const groupMeta = COLUMN_GROUP_META[key];
        const Icon = groupMeta.icon;
        return {
          label: t(groupMeta.labelKey),
          icon: <Icon className={`size-3.5 ${groupMeta.iconClassName}`} />,
        };
      }
      case "priority":
        return { label: getPriorityLabel(key), icon: getPriorityIcon(key) };
      case "assignee":
      case "createdBy": {
        const user = meta.users.find((candidate) => candidate.id === key);
        return {
          label: user?.name ?? t("common:people.unknown"),
          icon: <MemberAvatar name={user?.name} image={user?.image} />,
        };
      }
      case "label": {
        const label = meta.labels.find((candidate) => candidate.key === key);
        const name = label?.name ?? key.replace(/^name:/, "");
        return {
          label: name,
          icon: (
            <span
              className="size-2.5 rounded-full"
              style={{
                backgroundColor: resolveLabelColor(label?.color ?? "gray"),
              }}
            />
          ),
        };
      }
      case "cycle": {
        const cycle = meta.cycles.find((candidate) => candidate.id === key);
        return {
          label: cycle?.name ?? key,
          icon: cycle ? (
            <CycleStatusIcon
              cycle={{ status: cycle.status, archivedAt: null }}
              className="size-3.5"
            />
          ) : null,
        };
      }
      case "module": {
        const module = meta.modules.find((candidate) => candidate.id === key);
        return {
          label: module?.name ?? key,
          icon: module ? (
            <ModuleStatusIcon status={module.status} className="size-3.5" />
          ) : null,
        };
      }
      case "estimate": {
        const point = meta.estimatePoints.find(
          (candidate) => candidate.id === key,
        );
        return {
          label: point ? formatEstimateValue(point.type, point.value) : key,
          icon: null,
        };
      }
      case "project": {
        const project = meta.projects.find((candidate) => candidate.id === key);
        const Icon =
          icons[(project?.icon ?? "Layout") as keyof typeof icons] ??
          icons.Layout;
        return {
          label: project?.name ?? key,
          icon: <Icon className="size-3.5 text-muted-foreground" />,
        };
      }
      default:
        return { label: key, icon: null };
    }
  };
}
