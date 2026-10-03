import type { Editor } from "@tiptap/core";
import { saveAs } from "file-saver";
import {
  Archive,
  ArchiveRestore,
  Check,
  ClipboardCopy,
  Copy,
  Download,
  FolderInput,
  Globe,
  History,
  Link2,
  Lock,
  MoreHorizontal,
  PanelRight,
  Printer,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import FavoriteButton from "@/components/favorite/favorite-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useUpdatePage } from "@/hooks/mutations/page/use-update-page";
import { copyToClipboard } from "@/lib/copy-to-clipboard";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import { generateLink } from "@/lib/generate-link";
import { pageErrorMessage } from "@/lib/pages/page-errors";
import { pagePath } from "@/lib/pages/page-paths";
import { printPage, useLightThemeWhilePrinting } from "@/lib/pages/print-page";
import "@/styles/page-print.css";
import { toast } from "@/lib/toast";
import type { Page } from "@/types/page";
import PageSyncBadge from "./collab/page-sync-badge";
import PresenceStack, { type PresenceMember } from "./collab/presence-stack";
import type { PageCollaboration } from "./collab/use-page-collaboration";
import PageCrumbSelect from "./page-crumb-select";
import type { PageActions } from "./use-page-actions";

function markdownFileName(title: string) {
  const base = title
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 80);
  return `${base || "page"}.md`;
}

type PageCollabStatusProps = {
  collab: PageCollaboration;
  /** The stored copy, or a close the socket won't recover from. */
  cantConnect: boolean;
  currentUserId: string | undefined;
  getMember: (userId: string) => PresenceMember | null;
};

/** The top bar's live state: who else is here, and whether edits are saved. */
export function PageCollabStatus({
  collab,
  cantConnect,
  currentUserId,
  getMember,
}: PageCollabStatusProps) {
  return (
    <div className="flex items-center gap-1">
      <PresenceStack
        presence={collab.presence}
        currentUserId={currentUserId}
        getMember={getMember}
      />
      <PageSyncBadge
        status={collab.status}
        hasSynced={collab.hasSynced}
        saveError={collab.saveError}
        cantConnect={cantConnect}
        lastSavedAt={collab.lastSavedAt}
        onRetry={collab.retry}
      />
    </div>
  );
}

type PageToolbarProps = {
  page: Page;
  workspaceId: string;
  actions: PageActions;
  editor: Editor | null;
  isPanelOpen: boolean;
  onTogglePanel: () => void;
  onOpenHistory: () => void;
};

/**
 * The 40px document bar under the project tabs: the page switcher, access
 * and last edit on the left (the edit opens History), then lock, favorite,
 * link, the side panel and the page menu.
 */
export default function PageToolbar({
  page,
  workspaceId,
  actions,
  editor,
  isPanelOpen,
  onTogglePanel,
  onOpenHistory,
}: PageToolbarProps) {
  const { t } = useTranslation();
  const updatePage = useUpdatePage();
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { capabilities } = page;
  const title = page.title.trim() || t("pages:list.untitled");
  const isPrivate = page.access === "private";
  const AccessIcon = isPrivate ? Lock : Globe;
  useLightThemeWhilePrinting();

  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    },
    [],
  );

  const copyLink = async () => {
    const ok = await copyToClipboard(
      generateLink(pagePath(workspaceId, page.projectId ?? "", page.id)),
    );
    if (!ok) return;
    setCopied(true);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 1000);
  };

  const markdown = () =>
    editor && !editor.isDestroyed ? editor.getMarkdown() : page.contentMarkdown;

  const toggleFullWidth = () => {
    if (!page.projectId) return;
    updatePage.mutate(
      {
        pageId: page.id,
        projectId: page.projectId,
        json: { isFullWidth: !page.isFullWidth },
      },
      {
        onError: (error) =>
          toast.error(
            pageErrorMessage(error) ?? t("pages:toasts.fullWidthError"),
          ),
      },
    );
  };

  return (
    <TooltipProvider>
      <div
        className="flex h-10 shrink-0 items-center gap-2 border-border/80 border-b bg-background px-2 md:px-3"
        data-slot="page-toolbar"
      >
        <div className="flex min-w-0 flex-1 items-center gap-1 text-muted-foreground text-xs">
          <PageCrumbSelect
            workspaceId={workspaceId}
            projectId={page.projectId ?? ""}
            pageId={page.id}
            title={page.title}
            logoKind={page.logoKind}
            logoValue={page.logoValue}
          />
          <span
            aria-hidden="true"
            className="hidden text-muted-foreground/60 sm:inline"
          >
            ·
          </span>
          <span className="hidden shrink-0 items-center gap-1 px-1 sm:inline-flex">
            <AccessIcon className="size-3.5" aria-hidden="true" />
            {isPrivate
              ? t("pages:list.access.private")
              : t("pages:list.access.public")}
          </span>
          <span
            aria-hidden="true"
            className="hidden text-muted-foreground/60 md:inline"
          >
            ·
          </span>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="xs"
                  className="hidden min-w-0 shrink px-1 font-normal text-muted-foreground text-xs md:inline-flex"
                  onClick={onOpenHistory}
                />
              }
            >
              <span className="truncate tabular-nums">
                {t("pages:list.editedAgo", {
                  time: formatRelativeTime(page.updatedAt),
                })}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {t("pages:menu.versionHistory")} ·{" "}
              {formatDateTime(page.updatedAt)}
            </TooltipContent>
          </Tooltip>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          {capabilities.canLock &&
            (page.isLocked ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Badge
                      render={<button type="button" />}
                      variant="warning"
                      className="me-1 gap-1"
                      onClick={actions.toggleLock}
                    />
                  }
                >
                  <Lock />
                  {t("pages:header.locked")}
                </TooltipTrigger>
                <TooltipContent>{t("pages:header.unlockHint")}</TooltipContent>
              </Tooltip>
            ) : (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={t("pages:header.lockPage")}
                      className="text-muted-foreground"
                      onClick={actions.toggleLock}
                    />
                  }
                >
                  <Lock className="size-3.5" />
                </TooltipTrigger>
                <TooltipContent>{t("pages:header.lockPage")}</TooltipContent>
              </Tooltip>
            ))}
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
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={
                    copied
                      ? t("pages:header.copied")
                      : t("pages:header.copyLink")
                  }
                  className="text-muted-foreground"
                  onClick={() => void copyLink()}
                />
              }
            >
              {copied ? (
                <Check className="size-3.5" />
              ) : (
                <Link2 className="size-3.5" />
              )}
            </TooltipTrigger>
            <TooltipContent>
              {copied ? t("pages:header.copied") : t("pages:header.copyLink")}
            </TooltipContent>
          </Tooltip>
          <span aria-hidden="true" className="mx-1 h-4 w-px bg-border" />
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t("pages:header.togglePanel")}
                  aria-pressed={isPanelOpen}
                  className="text-muted-foreground aria-pressed:bg-accent aria-pressed:text-foreground"
                  onClick={onTogglePanel}
                />
              }
            >
              <PanelRight className="size-3.5" />
            </TooltipTrigger>
            <TooltipContent>{t("pages:header.togglePanel")}</TooltipContent>
          </Tooltip>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t("pages:header.moreActions")}
                  className="text-muted-foreground"
                />
              }
            >
              <MoreHorizontal className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              {capabilities.canEdit && (
                <DropdownMenuCheckboxItem
                  variant="switch"
                  checked={page.isFullWidth}
                  onCheckedChange={toggleFullWidth}
                >
                  {t("pages:menu.fullWidth")}
                </DropdownMenuCheckboxItem>
              )}
              <DropdownMenuItem
                onClick={async () => {
                  if (await copyToClipboard(markdown())) {
                    toast.success(t("pages:menu.markdownCopied"));
                  }
                }}
              >
                <ClipboardCopy />
                {t("pages:menu.copyMarkdown")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  saveAs(
                    new Blob([markdown()], {
                      type: "text/markdown;charset=utf-8",
                    }),
                    markdownFileName(page.title),
                  )
                }
              >
                <Download />
                {t("pages:menu.downloadMarkdown")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={printPage}>
                <Printer />
                {t("pages:menu.print")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onOpenHistory}>
                <History />
                {t("pages:menu.versionHistory")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {capabilities.canDuplicate && (
                <DropdownMenuItem onClick={actions.duplicate}>
                  <Copy />
                  {t("pages:actions.duplicate")}
                </DropdownMenuItem>
              )}
              {capabilities.canChangeAccess && (
                <DropdownMenuItem onClick={actions.toggleAccess}>
                  {isPrivate ? <Globe /> : <Lock />}
                  {isPrivate
                    ? t("pages:actions.makePublic")
                    : t("pages:actions.makePrivate")}
                </DropdownMenuItem>
              )}
              {capabilities.canMove && (
                <DropdownMenuItem onClick={actions.openMove}>
                  <FolderInput />
                  {t("pages:actions.moveToProject")}
                </DropdownMenuItem>
              )}
              {capabilities.canArchive && (
                <DropdownMenuItem onClick={actions.toggleArchive}>
                  {page.archivedAt ? <ArchiveRestore /> : <Archive />}
                  {page.archivedAt
                    ? t("pages:actions.restore")
                    : t("pages:actions.archive")}
                </DropdownMenuItem>
              )}
              {capabilities.canDelete && page.archivedAt && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={actions.openDelete}
                  >
                    <Trash2 />
                    {t("pages:actions.delete")}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </TooltipProvider>
  );
}
