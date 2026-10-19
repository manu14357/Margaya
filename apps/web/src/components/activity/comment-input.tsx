import { useQueryClient } from "@tanstack/react-query";
import { ArrowUp, Paperclip } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import CommentEditor from "@/components/activity/comment-editor";
import {
  CommentAiButton,
  CommentAiPreview,
  useCommentAi,
} from "@/components/editor/ai/comment-ai";
import CommentVisibilitySwitch from "@/components/publication/comment-visibility-switch";
import { Button } from "@/components/ui/button";
import { KbdSequence } from "@/components/ui/kbd";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import useCreateComment from "@/hooks/mutations/comment/use-create-comment";
import { useAiAvailability } from "@/hooks/queries/ai/use-ai";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { getModifierKeyText } from "@/hooks/use-keyboard-shortcuts";
import { cn } from "@/lib/cn";
import { toast } from "@/lib/toast";
import type { CommentVisibility } from "@/types/publication";

type CommentInputProps = {
  taskId: string;
  /** The project's board is published with comments on: offer Public. */
  publicCommentsOpen?: boolean;
  /** The task's project: offers AI help on the draft when AI is on there. */
  projectId?: string;
};

export default function CommentInput({
  taskId,
  publicCommentsOpen = false,
  projectId,
}: CommentInputProps) {
  const { t } = useTranslation();
  const [content, setContent] = useState("");
  const [visibility, setVisibility] = useState<CommentVisibility>("internal");
  const [attachAction, setAttachAction] = useState<(() => void) | null>(null);
  const { mutateAsync: createComment, isPending } = useCreateComment();
  const queryClient = useQueryClient();
  const { data: workspace } = useActiveWorkspace();
  const { available: aiAvailable } = useAiAvailability(projectId ?? null);
  const contentRef = useRef(content);
  contentRef.current = content;
  const commentAi = useCommentAi({
    workspaceId: workspace?.id ?? "",
    taskId,
    getDraft: () => contentRef.current,
    onApply: setContent,
  });
  const showAi = Boolean(projectId && aiAvailable && workspace?.id);

  const handleSubmit = useCallback(async () => {
    if (!content.trim()) {
      toast.error(t("activity:comment.cannotBeEmpty"));
      return;
    }

    try {
      await createComment({
        taskId,
        comment: content,
        ...(publicCommentsOpen && visibility === "public"
          ? { visibility }
          : {}),
      });

      setContent("");
      // Every comment starts internal again.
      setVisibility("internal");
      await queryClient.invalidateQueries({ queryKey: ["activities", taskId] });

      toast.success(t("activity:comment.added"));
    } catch (error) {
      console.error("Failed to create comment:", error);
      toast.error(t("activity:comment.failedToAdd"));
    }
  }, [
    content,
    createComment,
    publicCommentsOpen,
    queryClient,
    t,
    taskId,
    visibility,
  ]);

  const handleAttachActionChange = useCallback(
    (nextAttachAction: (() => void) | null) => {
      setAttachAction(() => nextAttachAction);
    },
    [],
  );

  return (
    <div className="w-full">
      <div className="rounded-xl border border-border/80 bg-card/70 transition-colors focus-within:border-ring/60 focus-within:shadow-[0_0_0_2px_color-mix(in_srgb,var(--ring)_20%,transparent)]">
        <CommentEditor
          value={content}
          onChange={setContent}
          placeholder={t("activity:comment.leavePlaceholder")}
          taskId={taskId}
          uploadSurface="comment"
          showQuickAttachButton={false}
          onAttachActionChange={handleAttachActionChange}
          className="[&_.margaya-comment-editor-content_.ProseMirror]:min-h-[3rem] [&_.margaya-comment-editor-content_.ProseMirror]:max-h-none [&_.margaya-comment-editor-content_.ProseMirror]:overflow-visible [&_.margaya-comment-editor-content_.ProseMirror]:px-3 [&_.margaya-comment-editor-content_.ProseMirror]:pt-3 [&_.margaya-comment-editor-content_.ProseMirror]:pb-2"
          onSubmitShortcut={handleSubmit}
        />
        <div className="flex items-center justify-end gap-2 border-border/70 border-t px-2 py-2">
          {showAi && (
            <CommentAiButton ai={commentAi} disabled={!content.trim()} />
          )}
          <Button
            size="xs"
            variant="ghost"
            onClick={() => attachAction?.()}
            disabled={!attachAction}
            className="text-muted-foreground"
            aria-label={t("activity:comment.attachFile")}
          >
            <Paperclip className="size-3.5" />
          </Button>
          {publicCommentsOpen && (
            <CommentVisibilitySwitch
              value={visibility}
              onChange={setVisibility}
              disabled={isPending}
            />
          )}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="xs"
                  variant="default"
                  onClick={handleSubmit}
                  disabled={isPending || !content.trim()}
                  aria-label={t("activity:comment.submitShortcut")}
                  className={cn(
                    isPending ||
                      (!content.trim() && "opacity-50 cursor-not-allowed"),
                    content.trim().length > 0 &&
                      "bg-primary text-primary-foreground",
                  )}
                >
                  <ArrowUp className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <KbdSequence
                  keys={[getModifierKeyText(), "Enter"]}
                  description={t("activity:comment.submitShortcut")}
                />
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>
      {showAi && <CommentAiPreview ai={commentAi} />}
    </div>
  );
}
