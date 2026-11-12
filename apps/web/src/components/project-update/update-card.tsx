import { Link } from "@tanstack/react-router";
import { MessageSquare, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { AiContentLabel } from "@/components/ai/ai-content-label";
import { useAuth } from "@/components/providers/auth-provider/hooks/use-auth";
import ReactionChip from "@/components/reaction/reaction-chip";
import ReactionPicker from "@/components/reaction/reaction-picker";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { TooltipProvider } from "@/components/ui/tooltip";
import type {
  ProjectUpdate,
  ProjectUpdateFacts,
} from "@/fetchers/project-update/project-update";
import {
  useAddProjectUpdateComment,
  useDeleteProjectUpdate,
  useDeleteProjectUpdateComment,
  useToggleProjectUpdateReaction,
} from "@/hooks/mutations/project-update/use-project-update-mutations";
import { useProjectUpdate } from "@/hooks/queries/project-update/use-project-updates";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import { getInitials } from "@/lib/get-initials";
import { toast } from "@/lib/toast";
import HealthBadge from "./health-badge";
import UpdateComposer from "./update-composer";

type UpdateCardProps = {
  update: ProjectUpdate;
  workspaceId: string;
  projectId: string;
  canComment: boolean;
};

function Person({
  person,
  size = "size-7",
}: {
  person: ProjectUpdate["author"];
  size?: string;
}) {
  return (
    <Avatar className={size}>
      {person?.image ? <AvatarImage src={person.image} alt="" /> : null}
      <AvatarFallback className="text-[10px]">
        {getInitials(person?.name)}
      </AvatarFallback>
    </Avatar>
  );
}

function Section({ title, text }: { title: string; text: string | null }) {
  if (!text) return null;
  return (
    <div className="space-y-1">
      <h4 className="font-medium text-muted-foreground text-xs">{title}</h4>
      <p className="whitespace-pre-wrap break-words text-sm">{text}</p>
    </div>
  );
}

/** The numbers kept with the update, with links to the tasks behind them. */
function Facts({
  facts,
  workspaceId,
  projectId,
}: {
  facts: ProjectUpdateFacts;
  workspaceId: string;
  projectId: string;
}) {
  const { t } = useTranslation();
  const lists = [
    { label: t("projectUpdates:facts.overdue"), list: facts.overdue },
    { label: t("projectUpdates:facts.blocked"), list: facts.blocked },
    { label: t("projectUpdates:facts.completed"), list: facts.completed },
  ].filter((entry) => entry.list.tasks.length > 0);
  return (
    <details className="rounded-lg border border-dashed px-3 py-2 text-xs">
      <summary className="cursor-pointer text-muted-foreground">
        {t("projectUpdates:facts.summary", {
          percent: facts.counts.percent,
          completed: facts.completed.total,
          moved: facts.moved.total,
          overdue: facts.overdue.total,
          blocked: facts.blocked.total,
        })}
      </summary>
      <div className="mt-2 space-y-2">
        {facts.cycles.map((cycle) => (
          <p key={cycle.id}>
            {t("projectUpdates:facts.cycle", {
              name: cycle.name,
              percent: cycle.percent,
              completed: cycle.completed,
              total: cycle.total,
            })}
          </p>
        ))}
        {facts.forecastP85 && (
          <p>
            {t("projectUpdates:facts.forecast", { date: facts.forecastP85 })}
          </p>
        )}
        {lists.map((entry) => (
          <div key={entry.label}>
            <p className="font-medium">
              {entry.label} ({entry.list.total})
            </p>
            <ul className="mt-0.5 space-y-0.5">
              {entry.list.tasks.map((task) => (
                <li key={task.id}>
                  <Link
                    to="/dashboard/workspace/$workspaceId/project/$projectId/task/$taskId"
                    params={{ workspaceId, projectId, taskId: task.id }}
                    className="underline-offset-2 hover:underline focus-visible:underline"
                  >
                    <span className="font-mono text-muted-foreground">
                      {task.key}
                    </span>{" "}
                    {task.title}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </details>
  );
}

function Comments({
  update,
  projectId,
  canComment,
}: {
  update: ProjectUpdate;
  projectId: string;
  canComment: boolean;
}) {
  const { t } = useTranslation();
  const formId = useId();
  const detail = useProjectUpdate(projectId, update.id);
  const add = useAddProjectUpdateComment(projectId);
  const remove = useDeleteProjectUpdateComment(projectId);
  const [text, setText] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const content = text.trim();
    if (!content) return;
    add.mutate(
      { id: update.id, content },
      {
        onSuccess: () => setText(""),
        onError: () => toast.error(t("projectUpdates:comments.error")),
      },
    );
  };

  return (
    <div className="space-y-3 border-t pt-3">
      {detail.isPending ? (
        <Skeleton className="h-12 rounded-lg" />
      ) : detail.isError ? (
        <p className="text-muted-foreground text-sm">
          {t("projectUpdates:comments.loadError")}
        </p>
      ) : (
        <ul className="space-y-3">
          {detail.data.comments.map((comment) => (
            <li key={comment.id} className="flex gap-2">
              <Person person={comment.author} size="size-6" />
              <div className="min-w-0 flex-1">
                <p className="text-xs">
                  <span className="font-medium">
                    {comment.author?.name ?? t("projectUpdates:deletedUser")}
                  </span>{" "}
                  <time
                    className="text-muted-foreground"
                    dateTime={String(comment.createdAt)}
                    title={formatDateTime(comment.createdAt)}
                  >
                    {formatRelativeTime(comment.createdAt)}
                  </time>
                </p>
                <p className="whitespace-pre-wrap break-words text-sm">
                  {comment.content}
                </p>
              </div>
              {comment.canDelete && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t("projectUpdates:comments.delete")}
                  onClick={() => remove.mutate(comment.id)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canComment && (
        <form onSubmit={submit} className="space-y-2">
          <label htmlFor={`${formId}-comment`} className="sr-only">
            {t("projectUpdates:comments.label")}
          </label>
          <Textarea
            id={`${formId}-comment`}
            size="sm"
            maxLength={5000}
            value={text}
            placeholder={t("projectUpdates:comments.placeholder")}
            onChange={(event) => setText(event.target.value)}
          />
          <div className="flex justify-end">
            <Button
              type="submit"
              size="xs"
              loading={add.isPending}
              disabled={!text.trim()}
            >
              {t("projectUpdates:comments.send")}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

/** One update on the timeline: health, text, facts, reactions, comments. */
export default function UpdateCard({
  update,
  workspaceId,
  projectId,
  canComment,
}: UpdateCardProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const react = useToggleProjectUpdateReaction(projectId);
  const remove = useDeleteProjectUpdate(projectId);
  const reactions = update.reactions.filter((group) => group.count > 0);

  if (editing) {
    return (
      <UpdateComposer
        projectId={projectId}
        editing={update}
        onDone={() => setEditing(false)}
      />
    );
  }

  return (
    <article
      className="space-y-3 rounded-xl border bg-card p-3 shadow-xs sm:p-4"
      aria-label={t("projectUpdates:cardLabel", {
        name: update.author?.name ?? t("projectUpdates:deletedUser"),
      })}
    >
      <header className="flex flex-wrap items-center gap-2">
        <Person person={update.author} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-sm">
            {update.author?.name ?? t("projectUpdates:deletedUser")}
          </p>
          <p className="text-muted-foreground text-xs">
            <time
              dateTime={String(update.createdAt)}
              title={formatDateTime(update.createdAt)}
            >
              {formatRelativeTime(update.createdAt)}
            </time>
            {update.editedAt ? ` · ${t("projectUpdates:edited")}` : null}
          </p>
        </div>
        <AiContentLabel provenance={update.aiProvenance} />
        <HealthBadge health={update.health} />
        {update.canEdit && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t("projectUpdates:actions")}
                />
              }
            >
              <MoreHorizontal className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setEditing(true)}>
                <Pencil />
                {t("projectUpdates:edit")}
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 />
                {t("projectUpdates:delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </header>

      <p className="whitespace-pre-wrap break-words text-sm">
        {update.summary}
      </p>
      <Section
        title={t("projectUpdates:fields.highlights")}
        text={update.highlights}
      />
      <Section
        title={t("projectUpdates:fields.blockers")}
        text={update.blockers}
      />
      <Section
        title={t("projectUpdates:fields.nextSteps")}
        text={update.nextSteps}
      />
      {update.facts && (
        <Facts
          facts={update.facts}
          workspaceId={workspaceId}
          projectId={projectId}
        />
      )}

      <TooltipProvider>
        <div className="flex flex-wrap items-center gap-1.5">
          {reactions.map((group) => (
            <ReactionChip
              key={group.emoji}
              group={group}
              meId={user?.id}
              onToggle={() =>
                react.mutate({
                  id: update.id,
                  emoji: group.emoji,
                  reacted: group.reacted,
                })
              }
            />
          ))}
          <ReactionPicker
            groups={reactions}
            onPick={(emoji, reacted) =>
              react.mutate({ id: update.id, emoji, reacted })
            }
          />
          <Button
            variant="ghost"
            size="xs"
            className="ms-auto gap-1"
            aria-expanded={showComments}
            onClick={() => setShowComments((open) => !open)}
          >
            <MessageSquare aria-hidden className="size-3.5" />
            {t("projectUpdates:comments.toggle", {
              count: update.commentCount,
            })}
          </Button>
        </div>
      </TooltipProvider>

      {showComments && (
        <Comments
          update={update}
          projectId={projectId}
          canComment={canComment}
        />
      )}

      <AlertDialog
        open={confirmDelete}
        onOpenChange={(open) => !remove.isPending && setConfirmDelete(open)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("projectUpdates:deleteDialog.title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("projectUpdates:deleteDialog.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button
              variant="outline"
              disabled={remove.isPending}
              onClick={() => setConfirmDelete(false)}
            >
              {t("projectUpdates:composer.cancel")}
            </Button>
            <Button
              variant="destructive"
              loading={remove.isPending}
              onClick={() =>
                remove.mutate(update.id, {
                  onSuccess: () => {
                    setConfirmDelete(false);
                    toast.success(t("projectUpdates:deleted"));
                  },
                  onError: () =>
                    toast.error(t("projectUpdates:deleteDialog.error")),
                })
              }
            >
              {t("projectUpdates:delete")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </article>
  );
}
