import type { Editor } from "@tiptap/core";
import { saveAs } from "file-saver";
import {
  Archive,
  ArchiveRestore,
  Check,
  ClipboardCopy,
  Copy,
  Download,
  Earth,
  FolderInput,
  Globe,
  History,
  LayoutTemplate,
  Link2,
  Lock,
  MoreHorizontal,
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
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { copyToClipboard } from "@/lib/copy-to-clipboard";
import { formatRelativeTime } from "@/lib/format";
import { generateLink } from "@/lib/generate-link";
import { pageErrorMessage } from "@/lib/pages/page-errors";
import { pagePath } from "@/lib/pages/page-paths";
import { printPage, useLightThemeWhilePrinting } from "@/lib/pages/print-page";
import "@/styles/page-print.css";
import { toast } from "@/lib/toast";
import { useUserPreferencesStore } from "@/store/user-preferences";
import type { Page } from "@/types/page";
import PageSyncBadge from "./collab/page-sync-badge";
import PresenceStack, { type PresenceMember } from "./collab/presence-stack";
import type { PageCollaboration } from "./collab/use-page-collaboration";
import PageWatchButton from "./page-watch-button";
import PublishPageDialog from "./publish-page-dialog";
import SaveTemplateDialog from "./save-template-dialog";
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

type PageHeaderActionsProps = {
  page: Page;
  workspaceId: string;
  actions: PageActions;
  editor: Editor | null;
  onOpenHistory: () => void;
};

/** "Unlocked", shown for a moment after the page is unlocked. */
function useJustUnlocked(isLocked: boolean) {
  const previousRef = useRef(isLocked);
  const [key, setKey] = useState<number | null>(null);
  useEffect(() => {
    if (previousRef.current && !isLocked) setKey(Date.now());
    if (isLocked) setKey(null);
    previousRef.current = isLocked;
  }, [isLocked]);
  return { key, clear: () => setKey(null) };
}

/**
 * The page's tools at the right of the top bar, after presence and sync:
 * the archived badge, lock, favorite, copy link and the page menu.
 */
export default function PageHeaderActions({
  page,
  workspaceId,
  actions,
  editor,
  onOpenHistory,
}: PageHeaderActionsProps) {
  const { t } = useTranslation();
  const updatePage = useUpdatePage();
  const { canShareProjects } = useWorkspacePermission();
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const formatToolbar = useUserPreferencesStore(
    (state) => state.pagesFormatToolbar,
  );
  const setFormatToolbar = useUserPreferencesStore(
    (state) => state.setPagesFormatToolbar,
  );
  const { capabilities } = page;
  const title = page.title.trim() || t("pages:list.untitled");
  const isPrivate = page.access === "private";
  const justUnlocked = useJustUnlocked(page.isLocked);
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

  const lockedLabel = (
    <>
      <Lock />
      {t("pages:header.locked")}
    </>
  );

  return (
    <TooltipProvider>
      <div
        className="flex shrink-0 items-center gap-1"
        data-slot="page-actions"
      >
        {page.archivedAt && (
          <Badge variant="outline" className="hidden sm:inline-flex">
            {t("pages:list.tabs.archived")}
          </Badge>
        )}
        {page.isLocked &&
          (capabilities.canLock ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Badge
                    render={<button type="button" />}
                    variant="warning"
                    className="h-6 gap-1 sm:h-6"
                    onClick={actions.toggleLock}
                  />
                }
              >
                {lockedLabel}
              </TooltipTrigger>
              <TooltipContent>{t("pages:header.unlockHint")}</TooltipContent>
            </Tooltip>
          ) : (
            <Badge variant="warning" className="h-6 gap-1 sm:h-6">
              {lockedLabel}
            </Badge>
          ))}
        {!page.isLocked && justUnlocked.key !== null && (
          <span
            key={justUnlocked.key}
            role="status"
            className="margaya-page-unlocked px-1 text-muted-foreground text-xs"
            onAnimationEnd={justUnlocked.clear}
          >
            {t("pages:detail.unlocked")}
          </span>
        )}
        {!page.isLocked && capabilities.canLock && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
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
        )}
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
        <PageWatchButton pageId={page.id} />
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={
                  copied ? t("pages:header.copied") : t("pages:header.copyLink")
                }
                className="text-muted-foreground"
                onClick={() => void copyLink()}
              />
            }
          >
            {copied ? (
              <Check className="size-3.5 text-success-foreground" />
            ) : (
              <Link2 className="size-3.5" />
            )}
          </TooltipTrigger>
          <TooltipContent>
            {copied ? t("pages:header.copied") : t("pages:header.copyLink")}
          </TooltipContent>
        </Tooltip>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("pages:header.moreActions")}
                className="text-muted-foreground"
              />
            }
          >
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            {capabilities.canEdit && (
              <>
                <DropdownMenuCheckboxItem
                  variant="switch"
                  checked={page.isFullWidth}
                  onCheckedChange={toggleFullWidth}
                >
                  {t("pages:menu.fullWidth")}
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  variant="switch"
                  checked={formatToolbar}
                  onCheckedChange={(checked) => setFormatToolbar(checked)}
                >
                  {t("pages:toolbar.ariaLabel")}
                </DropdownMenuCheckboxItem>
                <DropdownMenuSeparator />
              </>
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
              {/* The last edit sits under the label: beside it, both got cut. */}
              <span className="flex min-w-0 flex-col">
                {t("pages:menu.versionHistory")}
                <span className="text-muted-foreground text-xs tabular-nums">
                  {t("pages:list.editedAgo", {
                    time: formatRelativeTime(page.updatedAt),
                  })}
                </span>
              </span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {capabilities.canDuplicate && (
              <DropdownMenuItem onClick={actions.duplicate}>
                <Copy />
                {t("pages:actions.duplicate")}
              </DropdownMenuItem>
            )}
            {capabilities.canDuplicate && (
              <DropdownMenuItem onClick={() => setSaveTemplateOpen(true)}>
                <LayoutTemplate />
                {t("pages:templates.saveAction")}
              </DropdownMenuItem>
            )}
            {canShareProjects() && !isPrivate && !page.archivedAt && (
              <DropdownMenuItem onClick={() => setPublishOpen(true)}>
                <Earth />
                {t("pages:publish.menuItem")}
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
      <SaveTemplateDialog
        pageId={page.id}
        pageTitle={page.title.trim()}
        open={saveTemplateOpen}
        onOpenChange={setSaveTemplateOpen}
      />
      <PublishPageDialog
        pageId={page.id}
        open={publishOpen}
        onOpenChange={setPublishOpen}
      />
    </TooltipProvider>
  );
}
