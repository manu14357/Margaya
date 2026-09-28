import { CalendarIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import AssigneeAvatarStack from "@/components/task/assignee-avatar-stack";
import icons from "@/constants/project-icons";
import { cn } from "@/lib/cn";
import { formatDateShort, formatRelativeTime } from "@/lib/format";
import { getStatusLabel } from "@/lib/i18n/domain";
import { resolveLabelColor } from "@/lib/label-color";
import { getPriorityIcon } from "@/lib/priority";
import { resolveAssignees, type TaskAssignee } from "@/lib/task-assignees";
import type { TaskDraftSummary } from "@/types/task-draft";
import DraftRowActions from "./draft-row-actions";

type DraftRowProps = {
  draft: TaskDraftSummary;
  /** Workspace members; undefined while they load. */
  people: readonly TaskAssignee[] | undefined;
  canEdit: boolean;
  onOpen: () => void;
  onPublish: () => void;
  onDelete: () => void;
};

const MAX_LABELS = 2;

function ProjectChip({ draft }: { draft: TaskDraftSummary }) {
  const { t } = useTranslation();
  if (!draft.project) {
    return (
      <span className="shrink-0 text-muted-foreground text-xs">
        {t("tasks:drafts.noProject")}
      </span>
    );
  }
  const Icon =
    icons[(draft.project.icon ?? "Layout") as keyof typeof icons] ??
    icons.Layout;
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border/80 px-1.5 py-0.5 text-muted-foreground text-xs"
      title={draft.project.name}
    >
      <Icon className="size-3" />
      <span className="font-mono">{draft.project.slug.toUpperCase()}</span>
    </span>
  );
}

/** One draft in the Drafts list; the whole row opens the editor. */
export default function DraftRow({
  draft,
  people,
  canEdit,
  onOpen,
  onPublish,
  onDelete,
}: DraftRowProps) {
  const { t } = useTranslation();
  const assignees = resolveAssignees(draft.assigneeIds, people);
  const labels = draft.labels.slice(0, MAX_LABELS);

  return (
    // biome-ignore lint/a11y/useSemanticElements: a row with a nested menu
    <div
      role="button"
      tabIndex={0}
      aria-disabled={!canEdit}
      onClick={() => canEdit && onOpen()}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        if (canEdit) onOpen();
      }}
      className={cn(
        "group flex h-11 items-center gap-3 border-border/50 border-b px-4 text-sm outline-none transition-colors focus-visible:bg-accent/60",
        canEdit && "cursor-pointer hover:bg-accent/40",
      )}
    >
      <span className="flex-shrink-0 [&_svg]:h-4 [&_svg]:w-4">
        {getPriorityIcon(draft.priority)}
      </span>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span
          className={cn(
            "truncate",
            draft.title ? "text-foreground" : "text-muted-foreground italic",
          )}
        >
          {draft.title || t("tasks:drafts.untitled")}
        </span>
        <ProjectChip draft={draft} />
        {draft.status && (
          <span className="hidden shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-muted-foreground text-xs sm:inline">
            {getStatusLabel(draft.status)}
          </span>
        )}
        {labels.map((label) => (
          <span
            key={label.name}
            className="hidden max-w-28 shrink-0 items-center gap-1 rounded-md border border-border/80 px-1.5 py-0.5 text-muted-foreground text-xs md:inline-flex"
          >
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: resolveLabelColor(label.color) }}
            />
            <span className="truncate">{label.name}</span>
          </span>
        ))}
      </div>
      {draft.dueDate && (
        <span className="hidden shrink-0 items-center gap-1 text-muted-foreground text-xs sm:inline-flex">
          <CalendarIcon className="size-3" />
          {formatDateShort(draft.dueDate)}
        </span>
      )}
      {assignees.length > 0 && (
        <AssigneeAvatarStack assignees={assignees} max={2} size="sm" />
      )}
      <span className="hidden shrink-0 whitespace-nowrap text-right text-muted-foreground text-xs md:inline">
        {t("tasks:drafts.edited", {
          time: formatRelativeTime(draft.updatedAt),
        })}
      </span>
      <DraftRowActions
        canEdit={canEdit}
        onEdit={onOpen}
        onPublish={onPublish}
        onDelete={onDelete}
        className="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 data-popup-open:opacity-100"
      />
    </div>
  );
}
