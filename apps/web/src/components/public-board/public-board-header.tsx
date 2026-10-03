import { Layout, Send } from "lucide-react";
import { createElement } from "react";
import { useTranslation } from "react-i18next";
import { CopyUrlButton } from "@/components/public-project/copy-url-button";
import { PublicProjectDescription } from "@/components/public-project/project-description";
import { ThemeToggle } from "@/components/public-project/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import icons from "@/constants/project-icons";
import type { BoardView } from "@/lib/public-board/search-params";
import type { PublicBoard } from "@/types/public-board";
import PublicBoardSearch from "./public-board-search";
import type { BoardViewChange } from "./public-filter-sections";
import ViewerMenu from "./viewer-menu";

type PublicBoardHeaderProps = {
  token: string;
  board: PublicBoard;
  view: BoardView;
  onChange: BoardViewChange;
  onOpenRequest: () => void;
  onOpenMyRequests: () => void;
};

/**
 * The top bar: the place (project tile, name, description), a centred
 * search field from `md` up, then the one primary action (Submit a
 * request), sharing, theme and the viewer. Below `md` search moves into
 * the toolbar's Filters sheet.
 */
export default function PublicBoardHeader({
  token,
  board,
  view,
  onChange,
  onOpenRequest,
  onOpenMyRequests,
}: PublicBoardHeaderProps) {
  const { t } = useTranslation();
  const { project } = board;
  const showRequest = board.board.requests && board.participation;

  return (
    <header className="flex min-h-13 shrink-0 items-center gap-3 border-border border-b bg-background px-3 py-2 md:grid md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:px-4">
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-[28%] bg-muted">
          {createElement(icons[project.icon as keyof typeof icons] || Layout, {
            className: "size-4 text-muted-foreground",
            "aria-hidden": true,
          })}
        </div>
        <div className="flex min-w-0 flex-col">
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="truncate font-semibold text-[15px] text-foreground leading-5">
              {project.name}
            </h1>
            <Badge variant="outline" size="sm" className="shrink-0">
              {t("publicProject:badge")}
            </Badge>
          </div>
          <div className="min-w-0 max-md:hidden">
            <PublicProjectDescription
              project={{
                id: token,
                description: project.description,
                descriptionDeferred: project.descriptionDeferred,
              }}
            />
          </div>
        </div>
      </div>

      <PublicBoardSearch
        value={view.q}
        onChange={(q) => onChange({ q })}
        className="w-64 max-md:hidden lg:w-80"
      />

      <div className="flex shrink-0 items-center justify-end gap-1.5">
        {showRequest && (
          <Button
            size="sm"
            className="h-8 gap-1.5"
            onClick={onOpenRequest}
            aria-label={t("publicProject:requests.button")}
          >
            <Send className="size-3.5" />
            <span className="text-xs max-sm:hidden">
              {t("publicProject:requests.button")}
            </span>
          </Button>
        )}
        <div className="max-sm:hidden">
          <CopyUrlButton />
        </div>
        <ThemeToggle />
        <div className="mx-0.5 h-4 w-px bg-border" aria-hidden="true" />
        <ViewerMenu
          token={token}
          board={board}
          onOpenMyRequests={onOpenMyRequests}
        />
      </div>
    </header>
  );
}
