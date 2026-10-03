import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import { ErrorView } from "@/components/public-project/error-view";
import {
  BoardCanvasSkeleton,
  LoadingSkeleton,
} from "@/components/public-project/loading-skeleton";
import { MargayaBranding } from "@/components/public-project/margaya-branding";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { usePublicBoard } from "@/hooks/queries/public-board/use-public-board";
import { usePublicBoardTasks } from "@/hooks/queries/public-board/use-public-board-tasks";
import { isReadOnlyBoard } from "@/lib/public-board/participation";
import {
  type BoardSearch,
  type BoardView,
  hasActiveFilters,
  resolveBoardView,
  serializeBoardView,
  toTaskListQuery,
} from "@/lib/public-board/search-params";
import MyRequestsSheet from "./my-requests-sheet";
import PublicBoardColumns from "./public-board-columns";
import PublicBoardHeader from "./public-board-header";
import PublicBoardList from "./public-board-list";
import PublicBoardToolbar from "./public-board-toolbar";
import { CLEARED_FILTERS } from "./public-filter-popover";
import PublicTaskPeek from "./public-task-peek";
import RequestDialog from "./request-dialog";

type PublicBoardPageProps = {
  token: string;
  search: BoardSearch;
  onSearchChange: (search: BoardSearch) => void;
};

/**
 * The public board: a slim top bar (the place and the one action), the
 * view tabs and lens bar, then a full-bleed canvas that scrolls on its own
 * so the chrome stays put. The task peek is a right sheet over the canvas.
 */
export default function PublicBoardPage({
  token,
  search,
  onSearchChange,
}: PublicBoardPageProps) {
  const { t } = useTranslation();
  const boardQuery = usePublicBoard(token);
  const board = boardQuery.data;
  const [requestOpen, setRequestOpen] = useState(false);
  const [myRequestsOpen, setMyRequestsOpen] = useState(false);

  const view = useMemo(
    () => (board ? resolveBoardView(search, board) : null),
    [board, search],
  );
  const listQuery = useMemo(() => (view ? toTaskListQuery(view) : {}), [view]);
  const tasks = usePublicBoardTasks(token, listQuery, {
    enabled: Boolean(board),
  });

  // Search engines don't index public boards.
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex";
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);

  if (boardQuery.isLoading) return <LoadingSkeleton />;
  if (!board || !view) return <ErrorView />;

  const change = (patch: Partial<BoardView>) =>
    onSearchChange(
      serializeBoardView({ ...view, ...patch }, board.board.defaultLayout),
    );
  const openTask = (number: number) => change({ task: number });
  const page = tasks.data;
  const isAccount = board.viewer.kind === "account";
  const noMatches =
    page !== undefined && page.totalCount === 0 && hasActiveFilters(view);
  const layoutProps = page && {
    board,
    page,
    onOpenTask: openTask,
    onLoadMore: tasks.loadMore,
    isLoadingMore: tasks.isLoadingMore,
  };

  return (
    <>
      <PageTitle
        title={board.project.name}
        suffix={board.instance.name || "Margaya"}
      />
      <div className="flex h-dvh w-full flex-col overflow-hidden bg-background">
        <PublicBoardHeader
          token={token}
          board={board}
          view={view}
          onChange={change}
          onOpenRequest={() => setRequestOpen(true)}
          onOpenMyRequests={() => setMyRequestsOpen(true)}
        />
        <PublicBoardToolbar board={board} view={view} onChange={change} />

        <main className="flex min-h-0 flex-1 flex-col">
          {tasks.isLoading ? (
            <BoardCanvasSkeleton layout={view.layout} />
          ) : tasks.isError && !page ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>{t("publicProject:board.loadError")}</EmptyTitle>
              </EmptyHeader>
              <EmptyContent>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void tasks.refetch()}
                >
                  {t("settings:projectPublish.retry")}
                </Button>
              </EmptyContent>
            </Empty>
          ) : noMatches ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>{t("publicProject:board.noMatches")}</EmptyTitle>
              </EmptyHeader>
              <EmptyContent>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => change({ ...CLEARED_FILTERS, q: "" })}
                >
                  {t("publicProject:board.clearFilters")}
                </Button>
              </EmptyContent>
            </Empty>
          ) : layoutProps ? (
            view.layout === "list" ? (
              <PublicBoardList token={token} {...layoutProps} />
            ) : (
              <PublicBoardColumns {...layoutProps} />
            )
          ) : null}
        </main>

        <footer className="flex shrink-0 items-center justify-between gap-3 border-border border-t px-3 pt-2 pb-[max(--spacing(2),env(safe-area-inset-bottom))] text-muted-foreground text-xs md:px-4">
          <MargayaBranding />
          {isReadOnlyBoard(board) && <span>{t("publicProject:readOnly")}</span>}
        </footer>

        <PublicTaskPeek
          token={token}
          board={board}
          number={view.task}
          onClose={() => change({ task: null })}
        />
        {board.board.requests && (
          <RequestDialog
            token={token}
            board={board}
            open={requestOpen}
            onOpenChange={setRequestOpen}
            onOpenMyRequests={() => setMyRequestsOpen(true)}
          />
        )}
        {isAccount && board.board.requests && (
          <MyRequestsSheet
            token={token}
            enabled={isAccount}
            open={myRequestsOpen}
            onOpenChange={setMyRequestsOpen}
            onViewTask={openTask}
          />
        )}
      </div>
    </>
  );
}
