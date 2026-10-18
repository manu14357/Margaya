import { Link } from "@tanstack/react-router";
import { Globe, Lock } from "lucide-react";
import { useTranslation } from "react-i18next";
import FavoriteButton from "@/components/favorite/favorite-button";
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatDateMedium, formatRelativeTime } from "@/lib/format";
import type { PageSummary } from "@/types/page";
import MemberAvatar from "./member-avatar";
import PageLogo from "./page-logo";
import PageRowActions, { PageContextMenuContent } from "./page-row-actions";
import { usePageActions } from "./use-page-actions";
import type { PageMember } from "./use-page-members";

type PageListRowProps = {
  page: PageSummary;
  workspaceId: string;
  /** Parent titles, root first ("in Onboarding / Setup"). */
  parentPath: string[];
  owner: PageMember | null;
};

/**
 * One 44px page row; the whole row opens the page. The parent path follows
 * the title; then the edited time, access, owner, favorite and the menu,
 * whose slot is reserved so nothing shifts when it fades in.
 */
export default function PageListRow({
  page,
  workspaceId,
  parentPath,
  owner,
}: PageListRowProps) {
  const { t } = useTranslation();
  const actions = usePageActions({ page, workspaceId });
  const title = page.title.trim() || t("pages:list.untitled");
  const isPrivate = page.access === "private";
  const AccessIcon = isPrivate ? Lock : Globe;
  const accessLabel = isPrivate
    ? t("pages:list.access.private")
    : t("pages:list.access.public");

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="group/page-row relative flex h-11 items-center gap-3 px-4 transition-colors duration-150 focus-within:bg-accent/60 hover:bg-accent/60">
            <Link
              to="/dashboard/workspace/$workspaceId/project/$projectId/pages/$pageId"
              params={{
                workspaceId,
                projectId: page.projectId ?? "",
                pageId: page.id,
              }}
              className="absolute inset-0 rounded-none outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
              aria-label={title}
            />
            <PageLogo logoKind={page.logoKind} logoValue={page.logoValue} />
            <div className="flex min-w-0 flex-1 items-baseline gap-2">
              <span className="truncate font-medium text-[13px]">{title}</span>
              {page.isLocked && (
                <Lock
                  className="size-3 shrink-0 self-center text-muted-foreground"
                  aria-label={t("pages:list.locked")}
                />
              )}
              {parentPath.length > 0 && (
                <span className="min-w-0 truncate text-muted-foreground text-xs">
                  {t("pages:list.inParent", { path: parentPath.join(" / ") })}
                </span>
              )}
            </div>
            <TooltipProvider>
              <span className="hidden max-w-36 shrink-0 truncate text-muted-foreground text-xs tabular-nums sm:block">
                {page.archivedAt
                  ? t("pages:list.archivedOn", {
                      date: formatDateMedium(page.archivedAt),
                    })
                  : t("pages:list.editedAgo", {
                      time: formatRelativeTime(page.updatedAt),
                    })}
              </span>
              <div className="relative flex shrink-0 items-center justify-end gap-3 text-muted-foreground text-xs">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <span
                        className="inline-flex"
                        role="img"
                        aria-label={accessLabel}
                      />
                    }
                  >
                    <AccessIcon className="size-3.5" />
                  </TooltipTrigger>
                  <TooltipContent>{accessLabel}</TooltipContent>
                </Tooltip>
                {owner && (
                  <span className="hidden min-[480px]:inline-flex">
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <span
                            className="inline-flex"
                            role="img"
                            aria-label={t("pages:list.ownedBy", {
                              name: owner.name,
                            })}
                          />
                        }
                      >
                        <MemberAvatar name={owner.name} image={owner.image} />
                      </TooltipTrigger>
                      <TooltipContent>
                        {t("pages:list.ownedBy", { name: owner.name })}
                      </TooltipContent>
                    </Tooltip>
                  </span>
                )}
                <span
                  aria-hidden="true"
                  className="hidden h-4 w-px bg-border min-[480px]:block"
                />
                <FavoriteButton
                  workspaceId={workspaceId}
                  entityType="page"
                  entityId={page.id}
                  placeholder={{
                    name: title,
                    projectId: page.projectId,
                    icon: page.logoValue,
                    feature: "pages",
                  }}
                />
                <span className="-mx-1 inline-flex size-7 items-center justify-center opacity-0 transition-opacity duration-150 group-focus-within/page-row:opacity-100 group-hover/page-row:opacity-100 has-data-popup-open:opacity-100 pointer-coarse:opacity-100">
                  <PageRowActions
                    page={page}
                    workspaceId={workspaceId}
                    actions={actions}
                  />
                </span>
              </div>
            </TooltipProvider>
          </div>
        </ContextMenuTrigger>
        <PageContextMenuContent page={page} actions={actions} />
      </ContextMenu>
      {actions.dialogs}
    </>
  );
}
