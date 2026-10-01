import type { ReactNode } from "react";
import { UnassignedCircle } from "@/components/task-filters/filter-primitives";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import icons from "@/constants/project-icons";
import { NONE_KEY } from "@/lib/analytics/labels";
import { COLUMN_GROUP_META, isColumnGroup } from "@/lib/column-groups";
import { getInitials } from "@/lib/get-initials";
import { resolveLabelColor } from "@/lib/label-color";
import { getPriorityIcon } from "@/lib/priority";
import { resolveAvatarSrc } from "@/lib/resolve-avatar-src";
import type { AnalyticsDimension, AnalyticsMeta } from "@/types/analytics";

type ProjectIconName = keyof typeof icons;

export function ProjectIcon({ icon }: { icon: string | null | undefined }) {
  const Icon = icons[(icon ?? "Layout") as ProjectIconName] ?? icons.Layout;
  return <Icon aria-hidden className="size-3.5 shrink-0 text-foreground/70" />;
}

export function UserAvatar({
  name,
  image,
}: {
  name: string;
  image?: string | null;
}) {
  return (
    <Avatar className="size-4 text-[8px]">
      <AvatarImage src={resolveAvatarSrc(image ?? undefined)} alt="" />
      <AvatarFallback className="text-[8px]">
        {getInitials(name)}
      </AvatarFallback>
    </Avatar>
  );
}

function leadingOf(
  dimension: AnalyticsDimension,
  key: string,
  name: string,
  meta?: Partial<AnalyticsMeta>,
): ReactNode {
  switch (dimension) {
    case "assignee":
    case "createdBy": {
      if (key === NONE_KEY) return <UnassignedCircle />;
      const user = meta?.users?.find((entry) => entry.id === key);
      return <UserAvatar name={name} image={user?.image} />;
    }
    case "project": {
      const project = meta?.projects?.find((entry) => entry.id === key);
      return <ProjectIcon icon={project?.icon} />;
    }
    case "label": {
      if (key === NONE_KEY) return null;
      const label = meta?.labels?.find((entry) => entry.key === key);
      return (
        <span
          aria-hidden
          className="size-2 shrink-0 rounded-full"
          style={{ backgroundColor: resolveLabelColor(label?.color ?? "gray") }}
        />
      );
    }
    case "group": {
      if (!isColumnGroup(key)) return null;
      const { icon: Icon, iconClassName } = COLUMN_GROUP_META[key];
      return (
        <Icon aria-hidden className={`size-3.5 shrink-0 ${iconClassName}`} />
      );
    }
    case "priority":
      return (
        <span aria-hidden className="inline-flex shrink-0">
          {getPriorityIcon(key)}
        </span>
      );
    default:
      return null;
  }
}

/**
 * A bucket's name with its identity mark (avatar, project icon, label
 * color, group or priority icon). Inline, so it truncates in chart rows.
 */
export default function CategoryLabel({
  dimension,
  bucketKey,
  name,
  meta,
}: {
  dimension: AnalyticsDimension;
  bucketKey: string;
  name: string;
  meta?: Partial<AnalyticsMeta>;
}) {
  const leading = leadingOf(dimension, bucketKey, name, meta);
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1.5">
      {leading}
      <span className="truncate" title={name}>
        {name}
      </span>
    </span>
  );
}
