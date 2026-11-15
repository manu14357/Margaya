import { Link } from "@tanstack/react-router";
import { Globe, Lock, MoreHorizontal, PenTool } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import { formatRelativeTime } from "@/lib/format";
import { whiteboardPreviewUrl } from "@/lib/whiteboards/whiteboard-paths";
import type {
  WhiteboardCapabilities,
  WhiteboardSummary,
} from "@/types/whiteboard";
import { useWhiteboardActions } from "./use-whiteboard-actions";
import WhiteboardIcon from "./whiteboard-icon";
import WhiteboardMenuItems from "./whiteboard-menu-items";

type WhiteboardCardProps = {
  board: WhiteboardSummary;
  capabilities: WhiteboardCapabilities;
  workspaceId: string;
};

/**
 * One board in the grid: its preview, title, who edited it last and when,
 * and lock or publish badges. The whole card opens the board; the menu sits
 * above the link.
 */
export default function WhiteboardCard({
  board,
  capabilities,
  workspaceId,
}: WhiteboardCardProps) {
  const { t } = useTranslation();
  const actions = useWhiteboardActions({ board, capabilities, workspaceId });
  const [previewFailed, setPreviewFailed] = useState(false);
  const title = board.title.trim() || t("whiteboards:list.untitled");
  const time = formatRelativeTime(board.updatedAt);
  const edited = board.updatedBy?.name
    ? t("whiteboards:list.editedBy", { time, name: board.updatedBy.name })
    : t("whiteboards:list.edited", { time });

  return (
    <article className="group/board-card relative flex flex-col overflow-hidden rounded-lg border border-border/80 bg-card shadow-xs/5 transition-shadow duration-150 focus-within:shadow-sm hover:shadow-sm">
      <Link
        to="/dashboard/workspace/$workspaceId/project/$projectId/whiteboards/$whiteboardId"
        params={{
          workspaceId,
          projectId: board.projectId,
          whiteboardId: board.id,
        }}
        aria-label={title}
        className="absolute inset-0 z-0 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      />
      <div className="pointer-events-none flex aspect-[16/10] items-center justify-center overflow-hidden border-border/60 border-b bg-muted/40">
        {board.elementCount > 0 && !previewFailed ? (
          <img
            src={whiteboardPreviewUrl(board.id, board.contentVersion)}
            alt=""
            loading="lazy"
            decoding="async"
            // The preview is drawn in the light theme; dark mode flips its
            // lightness the way the canvas does, keeping the hues. A full
            // flip would turn its white paper pure black; 91% lands it on the
            // card's dark surface instead.
            className="size-full object-contain p-3 dark:hue-rotate-180 dark:invert-[0.91]"
            onError={() => setPreviewFailed(true)}
          />
        ) : (
          <PenTool
            aria-hidden="true"
            className="size-6 text-muted-foreground/50"
          />
        )}
      </div>
      <div className="pointer-events-none flex min-w-0 items-start gap-2 px-3 py-2.5">
        <WhiteboardIcon icon={board.icon} className="mt-0.5" />
        <div className="min-w-0 flex-1 space-y-1">
          <h3 className="truncate font-medium text-[13px] leading-[18px]">
            {title}
          </h3>
          <p className="truncate text-muted-foreground text-xs tabular-nums">
            {edited}
          </p>
          {(board.isLocked || board.publicToken) && (
            <div className="flex flex-wrap gap-1 pt-0.5">
              {board.isLocked && (
                <Badge variant="outline" size="sm" className="gap-1">
                  <Lock aria-hidden="true" className="size-3" />
                  {t("whiteboards:list.locked")}
                </Badge>
              )}
              {board.publicToken && (
                <Badge variant="info" size="sm" className="gap-1">
                  <Globe aria-hidden="true" className="size-3" />
                  {t("whiteboards:list.published")}
                </Badge>
              )}
            </div>
          )}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={t("whiteboards:list.cardActions", { title })}
                className="-me-1 pointer-events-auto relative z-10 shrink-0 text-muted-foreground opacity-0 transition-opacity duration-150 focus-visible:opacity-100 group-focus-within/board-card:opacity-100 group-hover/board-card:opacity-100 data-popup-open:opacity-100 pointer-coarse:opacity-100"
              />
            }
          >
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <WhiteboardMenuItems
              board={board}
              capabilities={capabilities}
              actions={actions}
              withOpen
            />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {actions.dialogs}
    </article>
  );
}
