import { Link2, X } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { MarkdownRenderer } from "@/components/public-project/markdown-renderer";
import { PublicTaskLabels } from "@/components/public-project/public-task-labels";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useTogglePublicBoardReaction } from "@/hooks/mutations/public-board/use-public-board-reactions";
import {
  usePublicBoardTask,
  usePublicBoardTaskDescription,
} from "@/hooks/queries/public-board/use-public-board-task";
import { getColumnIcon } from "@/lib/column";
import { formatDateMedium } from "@/lib/format";
import { getInitials } from "@/lib/get-initials";
import { HttpError } from "@/lib/http-error";
import { getPriorityLabel } from "@/lib/i18n/domain";
import { getPriorityIcon } from "@/lib/priority";
import { participationState } from "@/lib/public-board/participation";
import { toast } from "@/lib/toast";
import type { PublicBoard, PublicTaskDetail } from "@/types/public-board";
import PublicCommentList from "./public-comment-list";
import PublicExternalLinks from "./public-external-links";
import PublicReactionBar from "./public-reaction-bar";
import { PublicDueDate, rowLabels } from "./public-task-meta";
import PublicVoteControl from "./public-vote-control";

type PublicTaskPeekProps = {
  token: string;
  board: PublicBoard;
  /** The `task` search param: the peek is open while it is set. */
  number: number | null;
  onClose: () => void;
};

function Property({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="flex h-7 items-center text-muted-foreground text-xs">
        {label}
      </dt>
      <dd className="flex min-h-7 min-w-0 flex-wrap items-center gap-1.5 text-foreground text-sm">
        {children}
      </dd>
    </>
  );
}

function columnName(task: PublicTaskDetail, backlog: string) {
  return task.column.group === "backlog" && task.status === "planned"
    ? backlog
    : task.column.name;
}

function PeekBody({
  token,
  board,
  task,
}: {
  token: string;
  board: PublicBoard;
  task: PublicTaskDetail;
}) {
  const { t } = useTranslation();
  const number = task.number ?? 0;
  const description = usePublicBoardTaskDescription(
    token,
    number,
    task.descriptionDeferred,
  );
  const { toggle } = useTogglePublicBoardReaction(token, number);
  const text = task.descriptionDeferred ? description.data : task.description;
  const labels = rowLabels(task);
  const assignees = task.assignees ?? [];
  const reactState = participationState(board, "react");
  const showEngagement = board.board.votes || board.board.reactions;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <div className="space-y-5 px-5 py-5">
        <div className="space-y-3">
          <SheetTitle className="font-heading font-semibold text-foreground text-xl leading-snug">
            {task.title}
          </SheetTitle>
          <SheetDescription className="sr-only">{task.key}</SheetDescription>

          {showEngagement && (
            <div className="flex flex-wrap items-center gap-3">
              {board.board.votes && (
                <PublicVoteControl
                  token={token}
                  number={number}
                  participation={participationState(board, "vote")}
                />
              )}
              {board.board.reactions && task.reactions && (
                <section aria-label={t("publicProject:reactions.title")}>
                  <PublicReactionBar
                    groups={task.reactions}
                    canReact={reactState.prompt === "allowed"}
                    onToggle={(emoji, reacted) =>
                      toggle({
                        target: { kind: "task", number },
                        emoji,
                        reacted,
                      })
                    }
                  />
                </section>
              )}
            </div>
          )}
        </div>

        <dl className="grid grid-cols-[minmax(6rem,8rem)_minmax(0,1fr)] gap-x-3 gap-y-1 border-border/60 border-y py-3">
          <Property label={t("publicProject:taskDetail.status")}>
            {getColumnIcon(
              task.status,
              task.column.isFinal,
              task.column.icon,
              task.column.group,
            )}
            <span>{columnName(task, t("publicProject:board.backlog"))}</span>
          </Property>
          {task.priority && task.priority !== "no-priority" && (
            <Property label={t("publicProject:taskDetail.priority")}>
              {getPriorityIcon(task.priority)}
              <span>{getPriorityLabel(task.priority)}</span>
            </Property>
          )}
          {assignees.length > 0 && (
            <Property label={t("publicProject:taskDetail.assignees")}>
              {assignees.map((person, index) => (
                <span
                  // biome-ignore lint/suspicious/noArrayIndexKey: public assignees carry no ids
                  key={`${index}:${person.name}`}
                  className="flex items-center gap-1.5"
                >
                  <Avatar className="size-5">
                    <AvatarImage src={person.image ?? ""} alt="" />
                    <AvatarFallback className="text-[9px]">
                      {getInitials(person.name)}
                    </AvatarFallback>
                  </Avatar>
                  {person.name}
                </span>
              ))}
            </Property>
          )}
          {task.dueDate && (
            <Property label={t("publicProject:taskDetail.dueDateLabel")}>
              <span title={formatDateMedium(task.dueDate)}>
                <PublicDueDate
                  dueDate={task.dueDate}
                  isCompleted={task.column.isFinal}
                />
              </span>
            </Property>
          )}
          <Property label={t("publicProject:taskDetail.created")}>
            <span className="tabular-nums">
              {formatDateMedium(task.createdAt)}
            </span>
          </Property>
          {labels.length > 0 && (
            <Property label={t("publicProject:taskDetail.labels")}>
              <PublicTaskLabels labels={labels} />
            </Property>
          )}
        </dl>

        {task.descriptionDeferred && description.isLoading && (
          <p role="status" className="text-muted-foreground text-sm">
            {t("tasks:descriptionLoading")}
          </p>
        )}
        {task.descriptionDeferred && description.isError && (
          <p role="alert" className="text-muted-foreground text-sm">
            {t("tasks:descriptionLoadError")}{" "}
            <button
              type="button"
              className="underline"
              onClick={() => void description.refetch()}
            >
              {t("tasks:descriptionRetry")}
            </button>
          </p>
        )}
        {text && <MarkdownRenderer content={text} />}

        <PublicExternalLinks links={task.externalLinks} />

        {board.board.comments && (
          <PublicCommentList
            token={token}
            number={number}
            board={board}
            commentCount={task.commentCount ?? 0}
          />
        )}
      </div>
    </div>
  );
}

/**
 * A task in a right sheet over the board (`?task=12`), linkable and
 * closable with Escape. It fills the screen below `md`.
 */
export default function PublicTaskPeek({
  token,
  board,
  number,
  onClose,
}: PublicTaskPeekProps) {
  const { t } = useTranslation();
  const query = usePublicBoardTask(token, number);
  const task = query.data;
  const notFound =
    query.error instanceof HttpError && query.error.status === 404;

  const copyLink = () => {
    navigator.clipboard
      .writeText(window.location.href)
      .then(() => toast.success(t("publicProject:peek.linkCopied")))
      .catch(() => toast.error(t("publicProject:copyUrl.errorToast")));
  };

  return (
    <Sheet
      open={number !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        side="right"
        showCloseButton={false}
        className="h-dvh w-full max-w-none md:w-[560px]"
      >
        <TooltipProvider>
          <div className="flex h-full min-h-0 flex-col">
            <div className="flex h-12 shrink-0 items-center gap-2 border-border border-b px-3 md:px-4">
              <span className="font-medium font-mono text-muted-foreground text-xs">
                {task?.key}
              </span>
              {task && (
                <span className="flex min-w-0 items-center gap-1.5 truncate rounded-md bg-muted px-2 py-0.5 text-muted-foreground text-xs">
                  {getColumnIcon(
                    task.status,
                    task.column.isFinal,
                    task.column.icon,
                    task.column.group,
                  )}
                  <span className="truncate">
                    {columnName(task, t("publicProject:board.backlog"))}
                  </span>
                </span>
              )}
              <div className="ml-auto flex shrink-0 items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1.5"
                  onClick={copyLink}
                  aria-label={t("publicProject:peek.copyLink")}
                >
                  <Link2 className="size-3.5" />
                  <span className="text-xs max-sm:hidden">
                    {t("publicProject:peek.copyLink")}
                  </span>
                </Button>
                <SheetClose
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("publicProject:peek.close")}
                    />
                  }
                >
                  <X className="size-4" />
                </SheetClose>
              </div>
            </div>

            {query.isLoading ? (
              <div className="space-y-3 px-5 py-5">
                <Skeleton className="h-7 w-2/3" />
                <Skeleton className="h-8 w-40" />
                <Skeleton className="h-28 w-full" />
                <Skeleton className="h-24 w-full" />
              </div>
            ) : notFound || (!task && query.isError) ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-4 px-5 py-10 text-center">
                <SheetTitle className="font-medium text-base text-foreground">
                  {t("publicProject:peek.notFound")}
                </SheetTitle>
                <Button variant="outline" size="sm" onClick={onClose}>
                  {t("publicProject:peek.back")}
                </Button>
              </div>
            ) : task ? (
              <PeekBody token={token} board={board} task={task} />
            ) : null}
          </div>
        </TooltipProvider>
      </SheetContent>
    </Sheet>
  );
}
