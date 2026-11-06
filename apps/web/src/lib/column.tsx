import { CheckCircle2, Circle } from "lucide-react";
import columnIcons, {
  DEFAULT_COLUMN_ICON_NAMES,
} from "@/constants/column-icons";
import { COLUMN_GROUP_META, isColumnGroup } from "@/lib/column-groups";

// Resolution order: the column's own icon, then the default for its slug,
// then its group's icon, then the legacy final/open fallback.
// `neutral` drops the status hue; the board stays colourless apart from its
// header status dot. `hue` is the colour the board gives this column, for
// callers that know it (a later started column takes the review hue, which the
// group alone cannot tell).
export const getColumnIcon = (
  columnId: string,
  isFinal?: boolean,
  iconName?: string | null,
  group?: string | null,
  { neutral = false, hue }: { neutral?: boolean; hue?: string } = {},
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
  // The default review column is recognisable by its slug, so surfaces with no
  // column list still match the board.
  const tone = neutral
    ? "text-muted-foreground"
    : columnId === "in-review" && group === "started"
      ? "text-(--status-review)"
      : isColumnGroup(group)
        ? COLUMN_GROUP_META[group].iconClassName
        : isFinal
          ? COLUMN_GROUP_META.completed.iconClassName
          : "text-muted-foreground";
  const style = hue && !neutral ? { color: hue } : undefined;
  const Icon =
    typeof resolvedIconName === "string" &&
    Object.hasOwn(columnIcons, resolvedIconName) &&
    columnIcons[resolvedIconName as keyof typeof columnIcons];

  if (Icon) {
    return <Icon className={`w-4 h-4 ${tone}`} style={style} />;
  }

  if (isColumnGroup(group)) {
    const GroupIcon = COLUMN_GROUP_META[group].icon;
    return <GroupIcon className={`w-4 h-4 ${tone}`} style={style} />;
  }

  return isFinal ? (
    <CheckCircle2 className={`w-4 h-4 ${tone}`} style={style} />
  ) : (
    <Circle className={`w-4 h-4 ${tone}`} style={style} />
  );
};
