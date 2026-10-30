import { useQueryClient } from "@tanstack/react-query";
import { ArrowUp } from "lucide-react";
import {
  type FocusEvent,
  type ReactNode,
  useCallback,
  useId,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import CommentEditor from "@/components/activity/comment-editor";
import { useAuth } from "@/components/providers/auth-provider/hooks/use-auth";
import CommentVisibilitySwitch from "@/components/publication/comment-visibility-switch";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { KbdSequence } from "@/components/ui/kbd";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import useCreateComment from "@/hooks/mutations/comment/use-create-comment";
import { getModifierKeyText } from "@/hooks/use-keyboard-shortcuts";
import { getInitials } from "@/lib/get-initials";
import { toast } from "@/lib/toast";
import type { CommentVisibility } from "@/types/publication";

/** A thread shows this many of its newest replies until it is expanded. */
export const COLLAPSED_REPLY_COUNT = 3;

/**
 * Whether a comment's reply composer is open, shared by the card's Reply
 * actions and the thread that shows the composer. Closing it returns focus
 * to the card's Reply button.
 */
export function useReplyComposer() {
  const [composing, setComposing] = useState(false);
  const replyButtonRef = useRef<HTMLButtonElement>(null);
  const open = useCallback(() => setComposing(true), []);
  const close = useCallback(() => {
    setComposing(false);
    // Back to where the reply started, for keyboard and screen readers.
    requestAnimationFrame(() => replyButtonRef.current?.focus());
  }, []);
  // Focus already moved somewhere else: leave it there.
  const collapse = useCallback(() => setComposing(false), []);
  return { composing, open, close, collapse, replyButtonRef };
}

export type ReplyComposerControl = ReturnType<typeof useReplyComposer>;

type CommentThreadProps<T extends { id: string }> = {
  taskId: string;
  /** The top-level comment the replies belong to. */
  parentId: string;
  /** The composer's accessible name, such as "Reply to Mia". */
  replyLabel: string;
  /** The replies, oldest first. */
  replies: readonly T[];
  renderReply: (reply: T) => ReactNode;
  /** The viewer may comment: offers the reply composer. */
  canReply: boolean;
  /**
   * The board is published with comments on and the parent is public:
   * offers Public next to Internal, as the main composer does.
   */
  publicReplies?: boolean;
  composer: ReplyComposerControl;
};

function hiddenCountOf(total: number, expanded: boolean) {
  return expanded ? 0 : Math.max(0, total - COLLAPSED_REPLY_COUNT);
}

/**
 * The replies inside a top-level comment's card, under a divider, and the
 * compact composer that adds one. Threads are one level deep; long ones
 * show their newest replies until expanded.
 */
export default function CommentThread<T extends { id: string }>({
  taskId,
  parentId,
  replyLabel,
  replies,
  renderReply,
  canReply,
  publicReplies = false,
  composer,
}: CommentThreadProps<T>) {
  const { t } = useTranslation();
  // A link to a reply that would start hidden opens the thread instead.
  const [expanded, setExpanded] = useState(() =>
    replies
      .slice(0, hiddenCountOf(replies.length, false))
      .some((reply) => window.location.hash === `#comment-${reply.id}`),
  );
  const composerId = useId();
  const repliesId = useId();

  const hiddenCount = hiddenCountOf(replies.length, expanded);
  const shown = hiddenCount > 0 ? replies.slice(hiddenCount) : replies;
  const hasReplies = replies.length > 0;
  // With replies, the composer row always shows, so replying is one click.
  const showComposer = canReply && (composer.composing || hasReplies);

  if (!hasReplies && !showComposer) return null;

  return (
    <div
      className="flex flex-col border-border/70 border-t py-1"
      data-testid={`comment-thread-${parentId}`}
    >
      {replies.length > COLLAPSED_REPLY_COUNT && (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="ms-2 mt-1 self-start text-muted-foreground"
          aria-expanded={expanded}
          aria-controls={repliesId}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded
            ? t("activity:comment.thread.showFewer")
            : t("activity:comment.thread.showMore", { count: hiddenCount })}
        </Button>
      )}

      {/* Collapsed replies keep an anchor, so a notification that points
          at one still scrolls to its thread. */}
      {replies.slice(0, hiddenCount).map((reply) => (
        <span key={reply.id} id={`comment-${reply.id}`} className="sr-only" />
      ))}

      {shown.length > 0 && (
        <ol
          id={repliesId}
          aria-label={t("activity:comment.thread.replies")}
          className="flex flex-col"
        >
          {shown.map((reply) => (
            <li key={reply.id}>{renderReply(reply)}</li>
          ))}
        </ol>
      )}

      {showComposer && (
        <div className="px-3 pt-1 pb-1.5">
          {composer.composing ? (
            <ReplyComposer
              id={composerId}
              taskId={taskId}
              parentId={parentId}
              label={replyLabel}
              publicReplies={publicReplies}
              onDone={composer.close}
              onCollapse={composer.collapse}
            />
          ) : (
            <ReplyPrompt onOpen={composer.open} />
          )}
        </div>
      )}
    </div>
  );
}

function ViewerAvatar() {
  const { user } = useAuth();
  return (
    <Avatar className="mt-1 size-6">
      <AvatarImage src={user?.image ?? ""} alt="" />
      <AvatarFallback className="bg-muted font-medium text-[10px]">
        {getInitials(user?.name)}
      </AvatarFallback>
    </Avatar>
  );
}

/** The collapsed composer: one click, or focus, opens it. */
function ReplyPrompt({ onOpen }: { onOpen: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-start gap-2">
      <ViewerAvatar />
      <button
        type="button"
        onClick={onOpen}
        onFocus={onOpen}
        className="flex h-8 min-w-0 flex-1 cursor-text items-center rounded-lg border border-border/80 bg-background/60 px-2.5 text-start text-muted-foreground text-sm outline-none transition-colors hover:border-border focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="truncate">
          {t("activity:comment.thread.placeholder")}
        </span>
      </button>
    </div>
  );
}

function ReplyComposer({
  id,
  taskId,
  parentId,
  label,
  publicReplies,
  onDone,
  onCollapse,
}: {
  id: string;
  taskId: string;
  parentId: string;
  label: string;
  publicReplies: boolean;
  onDone: () => void;
  onCollapse: () => void;
}) {
  const { t } = useTranslation();
  const [content, setContent] = useState("");
  // Every reply starts internal, like a top-level comment.
  const [visibility, setVisibility] = useState<CommentVisibility>("internal");
  const { mutateAsync: createComment, isPending } = useCreateComment();
  const queryClient = useQueryClient();
  const hasContent = content.trim().length > 0;

  const handleSubmit = useCallback(async () => {
    if (!content.trim() || isPending) return;
    try {
      await createComment({
        taskId,
        comment: content,
        parentId,
        ...(publicReplies && visibility === "public" ? { visibility } : {}),
      });
      await queryClient.invalidateQueries({ queryKey: ["activities", taskId] });
      toast.success(t("activity:comment.thread.added"));
      setContent("");
      onDone();
    } catch {
      // The draft stays, so nothing typed is lost.
      toast.error(t("activity:comment.thread.failedToAdd"));
    }
  }, [
    content,
    createComment,
    isPending,
    onDone,
    parentId,
    publicReplies,
    queryClient,
    t,
    taskId,
    visibility,
  ]);

  // An empty composer folds back once focus leaves it.
  const handleBlur = (event: FocusEvent<HTMLElement>) => {
    const next = event.relatedTarget as Node | null;
    if (next && event.currentTarget.contains(next)) return;
    if (!hasContent && !isPending) onCollapse();
  };

  return (
    <section
      id={id}
      aria-label={label}
      aria-busy={isPending}
      className="flex items-start gap-2"
      onBlur={handleBlur}
    >
      <ViewerAvatar />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 flex-1 items-end gap-1 rounded-lg border border-border/80 bg-background/60 py-0.5 pe-1 transition-colors focus-within:border-ring/60 focus-within:shadow-[0_0_0_2px_color-mix(in_srgb,var(--ring)_20%,transparent)]">
          <CommentEditor
            value={content}
            onChange={setContent}
            placeholder={t("activity:comment.thread.placeholder")}
            taskId={taskId}
            uploadSurface="comment"
            showQuickAttachButton={false}
            autoFocus
            disabled={isPending}
            className={
              "min-w-0 flex-1 [&_.margaya-comment-editor-content_.ProseMirror]:min-h-7 [&_.margaya-comment-editor-content_.ProseMirror]:max-h-60 [&_.margaya-comment-editor-content_.ProseMirror]:px-2.5 [&_.margaya-comment-editor-content_.ProseMirror]:py-0.5"
            }
            onSubmitShortcut={handleSubmit}
            onCancelShortcut={onDone}
          />
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  size="icon-xs"
                  variant="default"
                  className="mb-0.5 rounded-full"
                  onClick={handleSubmit}
                  loading={isPending}
                  disabled={!hasContent}
                  aria-label={t("activity:comment.thread.send")}
                >
                  <ArrowUp className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <KbdSequence
                  keys={[getModifierKeyText(), "Enter"]}
                  description={t("activity:comment.thread.send")}
                />
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        {/* Below the compact box, so a narrow card keeps room to type. */}
        {publicReplies && (
          <div className="flex justify-end">
            <CommentVisibilitySwitch
              value={visibility}
              onChange={setVisibility}
              disabled={isPending}
            />
          </div>
        )}
      </div>
    </section>
  );
}
