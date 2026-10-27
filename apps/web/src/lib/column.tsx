import { CheckCircle2, Circle } from "lucide-react";
import columnIcons, {
  DEFAULT_COLUMN_ICON_NAMES,
} from "@/constants/column-icons";
import { COLUMN_GROUP_META, isColumnGroup } from "@/lib/column-groups";

// Resolution order: the column's own icon, then the default for its slug,
// then its group's icon, then the legacy final/open fallback.
// `neutral` drops the status hue; the board stays colourless apart from its
// header status dot.
export const getColumnIcon = (
  columnId: string,
  isFinal?: boolean,
  iconName?: string | null,
  group?: string | null,
  { neutral = false }: { neutral?: boolean } = {},
) => {
  const resolvedIconName =
    iconName ||
    (Object.hasOwn(DEFAULT_COLUMN_ICON_NAMES, columnId)
      ? DEFAULT_COLUMN_ICON_NAMES[
          columnId as keyof typeof DEFAULT_COLUMN_ICON_NAMES
        ]
      : undefined);
  // The icon wears its group's status hue; without a group, a final column
  // reads as completed and anything else stays neutral.
  const tone = neutral
    ? "text-muted-foreground"
    : isColumnGroup(group)
      ? COLUMN_GROUP_META[group].iconClassName
      : isFinal
        ? COLUMN_GROUP_META.completed.iconClassName
        : "text-muted-foreground";
  const Icon =
    typeof resolvedIconName === "string" &&
    Object.hasOwn(columnIcons, resolvedIconName) &&
    columnIcons[resolvedIconName as keyof typeof columnIcons];

  if (Icon) {
    return <Icon className={`w-4 h-4 ${tone}`} />;
  }

  if (isColumnGroup(group)) {
    const GroupIcon = COLUMN_GROUP_META[group].icon;
    return <GroupIcon className={`w-4 h-4 ${tone}`} />;
  }

  return isFinal ? (
    <CheckCircle2 className={`w-4 h-4 ${tone}`} />
  ) : (
    <Circle className={`w-4 h-4 ${tone}`} />
  );
};
