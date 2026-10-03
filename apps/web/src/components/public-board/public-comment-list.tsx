import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useTogglePublicBoardReaction } from "@/hooks/mutations/public-board/use-public-board-reactions";
import { usePublicBoardComments } from "@/hooks/queries/public-board/use-public-board-task";
import { participationState } from "@/lib/public-board/participation";
import type { PublicBoard } from "@/types/public-board";
import PublicCommentCard from "./public-comment-card";
import PublicCommentComposer from "./public-comment-composer";

type PublicCommentListProps = {
  token: string;
  number: number;
  board: PublicBoard;
  commentCount: number;
};

/** The peek's public comments, oldest first, then the composer or prompt. */
export default function PublicCommentList({
  token,
  number,
  board,
  commentCount,
}: PublicCommentListProps) {
  const { t } = useTranslation();
  const comments = usePublicBoardComments(token, number, board.board.comments);
  const { toggle } = useTogglePublicBoardReaction(token, number);
  const canReact = participationState(board, "react").prompt === "allowed";
  const items = comments.data?.pages.flatMap((page) => page.items) ?? [];
  const count = Math.max(commentCount, items.length);

  return (
    <section
      aria-labelledby={`public-comments-${number}`}
      className="space-y-3 border-border/50 border-t pt-4"
    >
      <h3
        id={`public-comments-${number}`}
        className="font-medium text-foreground text-sm"
      >
        {t("publicProject:comments.title", { count })}
      </h3>

      {comments.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : comments.isError ? (
        <p role="alert" className="text-muted-foreground text-sm">
          {t("publicProject:comments.loadError")}{" "}
          <button
            type="button"
            className="underline"
            onClick={() => void comments.refetch()}
          >
            {t("settings:projectPublish.retry")}
          </button>
        </p>
      ) : items.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {t("publicProject:comments.empty")}
        </p>
      ) : (
        <div className="space-y-2">
          {items.map((comment) => (
            <PublicCommentCard
              key={comment.id}
              token={token}
              number={number}
              comment={comment}
              showReactions={board.board.reactions}
              canReact={canReact}
              onToggleReaction={(commentId, emoji, reacted) =>
                toggle({
                  target: { kind: "comment", commentId },
                  emoji,
                  reacted,
                })
              }
            />
          ))}
          {comments.hasNextPage && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full"
              disabled={comments.isFetchingNextPage}
              onClick={() => void comments.fetchNextPage()}
            >
              {t("publicProject:comments.showMore")}
            </Button>
          )}
        </div>
      )}

      <PublicCommentComposer token={token} number={number} board={board} />
    </section>
  );
}
