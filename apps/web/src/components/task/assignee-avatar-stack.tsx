import { useTranslation } from "react-i18next";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { getInitials } from "@/lib/get-initials";
import {
  type AssigneeEntry,
  assigneeDisplayName,
  overflowCount,
  type TaskAssignee,
} from "@/lib/task-assignees";

type StackPerson = TaskAssignee &
  Partial<Pick<AssigneeEntry, "isFormerMember" | "isUnknown">>;

const SIZES = {
  xs: { face: "size-4", text: "text-[9px]" },
  sm: { face: "size-5", text: "text-[10px]" },
  md: { face: "size-6", text: "text-xs" },
} as const;

export type AssigneeStackSize = keyof typeof SIZES;

type AssigneeAvatarStackProps = {
  /** Ordered people: resolved entries, or a task's embedded assignees. */
  assignees: readonly StackPerson[];
  /** Faces shown before the "+N" chip. */
  max?: number;
  size?: AssigneeStackSize;
  /** Without assignees, show the muted "?" circle instead of nothing. */
  showEmpty?: boolean;
  /** The surface behind the stack, so the overlap rings blend in. */
  ring?: "card" | "background";
  /**
   * Inside a control that already names the task (a calendar or timeline
   * bar): no tooltip, hidden from assistive technology.
   */
  decorative?: boolean;
  className?: string;
};

/** Overlapping assignee faces with a "+N" overflow and a names tooltip. */
export default function AssigneeAvatarStack({
  assignees,
  max = 2,
  size = "sm",
  showEmpty = false,
  ring = "card",
  decorative = false,
  className,
}: AssigneeAvatarStackProps) {
  const { t } = useTranslation();
  const { face, text } = SIZES[size];
  const a11y = (label: string) =>
    decorative
      ? { "aria-hidden": true as const }
      : { role: "img" as const, "aria-label": label };

  if (assignees.length === 0) {
    if (!showEmpty) return null;
    const unassigned = t("tasks:assignee.unassigned");
    return (
      <span
        {...a11y(unassigned)}
        title={unassigned}
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-full border border-border bg-muted",
          face,
          className,
        )}
      >
        <span
          aria-hidden="true"
          className={cn("font-medium text-muted-foreground", text)}
        >
          ?
        </span>
      </span>
    );
  }

  const names = assignees.map((person) => {
    const name = assigneeDisplayName(person, t);
    return person.isFormerMember
      ? t("tasks:assignees.formerMemberSuffix", { name })
      : name;
  });
  const extra = overflowCount(assignees.length, max);
  const ringClass = ring === "card" ? "ring-card" : "ring-background";

  const stack = (
    <span
      {...a11y(t("tasks:assignees.stackAria", { names: names.join(", ") }))}
      className={cn(
        "inline-flex shrink-0 items-center -space-x-1.5",
        className,
      )}
    >
      {assignees.slice(0, Math.max(0, max)).map((person) => (
        <Avatar key={person.id} className={cn(face, "ring-2", ringClass)}>
          <AvatarImage src={person.image ?? ""} alt="" />
          <AvatarFallback
            className={cn("border border-border/30 font-medium", text)}
          >
            {getInitials(person.name)}
          </AvatarFallback>
        </Avatar>
      ))}
      {extra > 0 && (
        <span
          className={cn(
            "relative inline-flex shrink-0 items-center justify-center rounded-full border border-border bg-muted font-medium text-muted-foreground ring-2",
            face,
            text,
            ringClass,
          )}
        >
          {t("tasks:assignees.more", { count: extra })}
        </span>
      )}
    </span>
  );

  if (decorative) return stack;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{stack}</TooltipTrigger>
      <TooltipContent>
        <span className="flex flex-col">
          {names.map((name, index) => (
            <span key={assignees[index]?.id ?? index}>{name}</span>
          ))}
        </span>
      </TooltipContent>
    </Tooltip>
  );
}
