import { useDraggable, useDroppable } from "@dnd-kit/core";
import { Link } from "@tanstack/react-router";
import { ChevronRight, Lock, Plus } from "lucide-react";
import type { KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import { cn } from "@/lib/cn";
import type { DropZone } from "@/lib/pages/page-tree-drop";
import type { PageSummary } from "@/types/page";
import PageLogo from "../page-logo";
import PageRowActions, { PageContextMenuContent } from "../page-row-actions";
import { usePageActions } from "../use-page-actions";

type PageTreeItemProps = {
  page: PageSummary;
  workspaceId: string;
  depth: number;
  hasChildren: boolean;
  isExpanded: boolean;
  isActive: boolean;
  isFocused: boolean;
  /** Where a drag would drop relative to this row, while one hovers it. */
  dropZone: DropZone | null;
  dropInvalid: boolean;
  isDragging: boolean;
  onToggle: () => void;
  onFocus: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => boolean;
  registerRef: (element: HTMLElement | null) => void;
};

/** One row of the page tree: a treeitem, a drag source and a drop target. */
export default function PageTreeItem({
  page,
  workspaceId,
  depth,
  hasChildren,
  isExpanded,
  isActive,
  isFocused,
  dropZone,
  dropInvalid,
  isDragging,
  onToggle,
  onFocus,
  onKeyDown,
  registerRef,
}: PageTreeItemProps) {
  const { t } = useTranslation();
  const actions = usePageActions({ page, workspaceId });
  const title = page.title.trim() || t("pages:list.untitled");
  const canDrag = page.capabilities.canEdit && !page.isLocked;
  const draggable = useDraggable({ id: page.id, disabled: !canDrag });
  const droppable = useDroppable({ id: page.id });

  const setRefs = (element: HTMLElement | null) => {
    draggable.setNodeRef(element);
    droppable.setNodeRef(element);
    registerRef(element);
  };

  return (
    <div role="none">
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            ref={setRefs}
            role="treeitem"
            aria-level={depth}
            aria-expanded={hasChildren ? isExpanded : undefined}
            aria-selected={isActive}
            aria-label={title}
            tabIndex={isFocused ? 0 : -1}
            onFocus={onFocus}
            {...(canDrag ? draggable.listeners : {})}
            onKeyDown={(event) => {
              if (onKeyDown(event)) return;
              if (canDrag) draggable.listeners?.onKeyDown?.(event);
            }}
            className={cn(
              "group/tree-row relative flex h-7.5 items-center gap-1 rounded-md pe-1 text-[13px] text-sidebar-foreground outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring",
              isActive &&
                "bg-sidebar-accent font-medium text-sidebar-accent-foreground before:absolute before:inset-y-1.5 before:start-0 before:w-0.5 before:rounded-full before:bg-sidebar-primary",
              isDragging && "opacity-40",
              dropZone === "inside" &&
                (dropInvalid
                  ? "ring-1 ring-destructive/60"
                  : "bg-primary/10 ring-1 ring-primary/50"),
            )}
            style={{ paddingInlineStart: `${(depth - 1) * 12 + 4}px` }}
          >
            {dropZone === "before" && (
              <span
                aria-hidden="true"
                className={cn(
                  "-top-px pointer-events-none absolute inset-x-1 h-0.5 rounded-full",
                  dropInvalid ? "bg-destructive/60" : "bg-primary",
                )}
              />
            )}
            {dropZone === "after" && (
              <span
                aria-hidden="true"
                className={cn(
                  "-bottom-px pointer-events-none absolute inset-x-1 h-0.5 rounded-full",
                  dropInvalid ? "bg-destructive/60" : "bg-primary",
                )}
              />
            )}
            <button
              type="button"
              tabIndex={-1}
              aria-label={
                isExpanded
                  ? t("pages:tree.collapse", { title })
                  : t("pages:tree.expand", { title })
              }
              onPointerDown={(event) => event.stopPropagation()}
              onClick={onToggle}
              className={cn(
                "flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-sidebar-accent",
                !hasChildren && "invisible",
              )}
            >
              <ChevronRight
                className={cn(
                  "size-3.5 transition-transform",
                  isExpanded && "rotate-90",
                )}
              />
            </button>
            <PageLogo
              logoKind={page.logoKind}
              logoValue={page.logoValue}
              className="size-3.5"
            />
            <Link
              to="/dashboard/workspace/$workspaceId/project/$projectId/pages/$pageId"
              params={{
                workspaceId,
                projectId: page.projectId ?? "",
                pageId: page.id,
              }}
              tabIndex={-1}
              draggable={false}
              className="min-w-0 flex-1 truncate"
            >
              {title}
            </Link>
            {page.access === "private" && (
              <Lock
                className="size-3 shrink-0 text-muted-foreground"
                aria-label={t("pages:list.access.private")}
              />
            )}
            {/*
              With a mouse the actions float over the end of the row, so
              titles use the whole width until the row is hovered.
            */}
            <span className="flex shrink-0 items-center opacity-0 group-focus-within/tree-row:opacity-100 group-hover/tree-row:opacity-100 pointer-fine:absolute pointer-fine:inset-y-0 pointer-fine:end-0 pointer-fine:rounded-e-md pointer-fine:bg-sidebar-accent pointer-fine:pe-1 pointer-fine:ps-0.5 pointer-coarse:opacity-100">
              {page.capabilities.canCreateSubpage && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  tabIndex={-1}
                  aria-label={t("pages:actions.newSubpage")}
                  disabled={actions.isCreatingSubpage}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={actions.newSubpage}
                  className="size-5 text-muted-foreground"
                >
                  <Plus className="size-3.5" />
                </Button>
              )}
              <PageRowActions
                page={page}
                workspaceId={workspaceId}
                actions={actions}
                withNewSubpage
                withFavorite
                className="size-5"
              />
            </span>
          </div>
        </ContextMenuTrigger>
        <PageContextMenuContent page={page} actions={actions} withNewSubpage />
      </ContextMenu>
      {actions.dialogs}
    </div>
  );
}
