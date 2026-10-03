import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import CommentEditor from "@/components/activity/comment-editor";
import { Button } from "@/components/ui/button";
import { usePublicBoardCommentMutations } from "@/hooks/mutations/public-board/use-public-board-comments";
import { participationState } from "@/lib/public-board/participation";
import { toast } from "@/lib/toast";
import type { PublicBoard } from "@/types/public-board";
import ParticipationPrompt from "./participation-prompt";

type PublicCommentComposerProps = {
  token: string;
  number: number;
  board: PublicBoard;
};

/**
 * The comment box (markdown, no uploads; ⌘/Ctrl+Enter posts), or the
 * participation prompt for people who can't comment.
 */
export default function PublicCommentComposer({
  token,
  number,
  board,
}: PublicCommentComposerProps) {
  const { t } = useTranslation();
  const state = participationState(board, "comment");
  const { create } = usePublicBoardCommentMutations(token, number);
  const [content, setContent] = useState("");
  const { mutate, isPending } = create;

  const submit = useCallback(() => {
    if (!content.trim() || isPending) return;
    mutate(content, {
      onSuccess: () => {
        setContent("");
        toast.success(t("publicProject:comments.posted"));
      },
      onError: (error) =>
        toast.error(error.message || t("publicProject:comments.error")),
    });
  }, [content, isPending, mutate, t]);

  if (state.prompt === "hidden") return null;
  if (state.prompt !== "allowed") {
    return <ParticipationPrompt token={token} state={state} />;
  }

  return (
    <div className="rounded-xl border border-border/80 bg-card/70 transition-colors focus-within:border-ring/60">
      <CommentEditor
        value={content}
        onChange={setContent}
        placeholder={t("publicProject:comments.placeholder")}
        allowFileUploads={false}
        showQuickAttachButton={false}
        onSubmitShortcut={submit}
        className="[&_.margaya-comment-editor-content_.ProseMirror]:min-h-[3rem] [&_.margaya-comment-editor-content_.ProseMirror]:px-3 [&_.margaya-comment-editor-content_.ProseMirror]:pt-3 [&_.margaya-comment-editor-content_.ProseMirror]:pb-2"
      />
      <div className="flex items-center justify-end border-border/70 border-t px-2 py-2">
        <Button
          size="sm"
          onClick={submit}
          loading={isPending}
          disabled={!content.trim()}
          aria-label={t("publicProject:comments.submit")}
        >
          {isPending
            ? t("publicProject:comments.submitting")
            : t("publicProject:comments.submit")}
        </Button>
      </div>
    </div>
  );
}
