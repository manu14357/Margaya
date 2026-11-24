import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ChevronLeft,
  Expand,
  Globe,
  History,
  Lock,
  LockOpen,
  MonitorUp,
  MoreHorizontal,
  PenTool,
  Presentation,
  Scan,
  Upload,
} from "lucide-react";
import {
  type ChangeEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import {
  TopBarOverflowMenuItems,
  useTopBarOverflowHost,
} from "@/components/common/header/top-bar-overflow";
import ProjectLayout from "@/components/common/project-layout";
import PageSyncBadge from "@/components/page/collab/page-sync-badge";
import { usePageMembers } from "@/components/page/use-page-members";
import PageTitle from "@/components/page-title";
import ProjectFeatureGate from "@/components/project/project-feature-gate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAiAvailability } from "@/hooks/queries/ai/use-ai";
import { useWhiteboard } from "@/hooks/queries/whiteboard/use-whiteboard";
import { whiteboardQueryKeys } from "@/hooks/queries/whiteboard/whiteboard-query-keys";
import { useProjectFeatures } from "@/hooks/use-project-features";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/cn";
import { isDesktopApp } from "@/lib/desktop";
import { HttpError } from "@/lib/http-error";
import { toast } from "@/lib/toast";
import { boardColorFor } from "@/lib/whiteboards/board-presence";
import { uploadWhiteboardImage } from "@/lib/whiteboards/upload-whiteboard-image";
import { whiteboardAssetUrl } from "@/lib/whiteboards/whiteboard-paths";
import type { Whiteboard } from "@/types/whiteboard";
import { presentUrl } from "./editor/present";
import type {
  CollaboratorIdentity,
  WhiteboardEditorHandle,
} from "./editor/types";
import { WhiteboardEditor } from "./editor/whiteboard-editor";
import { useBoardTheme } from "./use-board-theme";
import { useWhiteboardActions } from "./use-whiteboard-actions";
import { useWhiteboardCollaboration } from "./use-whiteboard-collaboration";
import WhiteboardBanners from "./whiteboard-banners";
import WhiteboardExportMenu from "./whiteboard-export-menu";
import WhiteboardHistorySheet from "./whiteboard-history-sheet";
import WhiteboardIcon from "./whiteboard-icon";
import WhiteboardMenuItems from "./whiteboard-menu-items";
import WhiteboardTitleInput from "./whiteboard-title-input";

type WhiteboardScreenProps = {
  workspaceId: string;
  projectId: string;
  whiteboardId: string;
  /** `?element=`: scroll to and select it once the board loads. */
  elementId?: string;
  /** `?present=1`: open straight into present mode (a presenter window). */
  present?: boolean;
};

const BOARD_FILE_ACCEPT = ".margaya-board,application/json,image/png";

function HeaderIconButton({
  label,
  pressed,
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={label}
              aria-pressed={pressed}
              className="text-muted-foreground aria-pressed:bg-accent aria-pressed:text-foreground"
              onClick={onClick}
            />
          }
        >
          {children}
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * The board's "…" menu. In a crowded top bar it also lists what the bar
 * moved out of the row (Ask, Summarize), so the bar shows one "…", not two.
 */
function BoardMoreMenu({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const overflow = useTopBarOverflowHost();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            title={label}
            className="text-muted-foreground"
          />
        }
      >
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <TopBarOverflowMenuItems items={overflow} />
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function BoardNotFound({
  workspaceId,
  projectId,
}: {
  workspaceId: string;
  projectId: string;
}) {
  const { t } = useTranslation();
  return (
    <Empty className="h-full">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <PenTool />
        </EmptyMedia>
        <EmptyTitle>{t("whiteboards:screen.notFound.title")}</EmptyTitle>
        <EmptyDescription>
          {t("whiteboards:screen.notFound.description")}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button
          variant="outline"
          size="sm"
          render={
            <Link
              to="/dashboard/workspace/$workspaceId/project/$projectId/whiteboards"
              params={{ workspaceId, projectId }}
            />
          }
        >
          {t("whiteboards:screen.notFound.back")}
        </Button>
      </EmptyContent>
    </Empty>
  );
}

function CanvasSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="flex h-full items-center justify-center bg-muted/30"
    >
      <Skeleton className="h-2/3 w-2/3 max-w-3xl rounded-xl" />
    </div>
  );
}

/**
 * One board, full height: a slim header (back to the list, icon, name,
 * lock state), the read-only notices, then the live canvas. The top bar
 * holds who is here, whether edits are saved, the lock, sharing, export and
 * the board's menu.
 */
export default function WhiteboardScreen({
  workspaceId,
  projectId,
  whiteboardId,
  elementId,
  present = false,
}: WhiteboardScreenProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: session } = authClient.useSession();
  const sessionUser = session?.user;
  const features = useProjectFeatures({ projectId, workspaceId });
  const enabled = features.isEnabled("whiteboards");
  const boardQuery = useWhiteboard(enabled ? whiteboardId : "");
  const board = boardQuery.data;
  const ai = useAiAvailability(board?.projectId ?? projectId);
  const { getMember } = usePageMembers(workspaceId);
  const theme = useBoardTheme();
  const [ready, setReady] = useState<{
    guid: string;
    handle: WhiteboardEditorHandle;
  } | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const goneHandledRef = useRef(false);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [presenting, setPresenting] = useState(present);
  // Whether present mode took the canvas full screen, so leaving full
  // screen (Esc in the browser) also leaves present mode.
  const presentFullScreenRef = useRef(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const user = useMemo<CollaboratorIdentity | null>(
    () =>
      sessionUser
        ? {
            id: sessionUser.id,
            name: sessionUser.name || sessionUser.email || "",
            color: boardColorFor(sessionUser.id),
            image: sessionUser.image ?? null,
          }
        : null,
    [sessionUser],
  );
  const memberOf = useCallback(
    (id: string) => {
      const member = getMember(id);
      return member ? { name: member.name, image: member.image } : null;
    },
    [getMember],
  );
  const collab = useWhiteboardCollaboration({
    whiteboardId: board ? whiteboardId : "",
    user,
    getMember: memberOf,
  });

  // A new document remounts the editor; the old handle goes with it.
  const docGuid = collab.doc?.guid;
  const editor = ready && ready.guid === docGuid ? ready.handle : null;
  const onEditorReady = useCallback(
    (handle: WhiteboardEditorHandle) =>
      setReady(docGuid ? { guid: docGuid, handle } : null),
    [docGuid],
  );

  const goToList = useCallback(
    () =>
      navigate({
        to: "/dashboard/workspace/$workspaceId/project/$projectId/whiteboards",
        params: { workspaceId, projectId },
      }),
    [navigate, projectId, workspaceId],
  );

  const actions = useWhiteboardActions({
    board: board ?? PLACEHOLDER_BOARD,
    capabilities: board?.capabilities ?? PLACEHOLDER_BOARD.capabilities,
    workspaceId,
    onDeleted: goToList,
  });

  // Links to a board keep working if they name the wrong project.
  useEffect(() => {
    if (!board?.projectId || board.projectId === projectId) return;
    navigate({
      to: "/dashboard/workspace/$workspaceId/project/$projectId/whiteboards/$whiteboardId",
      params: { workspaceId, projectId: board.projectId, whiteboardId },
      search: (previous: Record<string, unknown>) => previous,
      replace: true,
    });
  }, [board?.projectId, navigate, projectId, whiteboardId, workspaceId]);

  const handleGone = useCallback(async () => {
    if (goneHandledRef.current) return;
    goneHandledRef.current = true;
    const refreshed = await features.refetch();
    if (refreshed.data?.whiteboardsEnabled !== false) {
      toast.info(t("whiteboards:collab.deleted"));
      goToList();
    }
  }, [features, goToList, t]);

  const terminalKind = collab.terminal?.kind;
  useEffect(() => {
    if (!terminalKind) return;
    if (terminalKind === "signedOut") {
      toast.error(t("whiteboards:collab.signedOut"));
    }
    if (terminalKind === "roomFull") {
      toast.error(t("whiteboards:collab.roomFull"));
    }
    if (terminalKind === "gone") void handleGone();
    if (terminalKind === "notVisible") {
      void queryClient.invalidateQueries({
        queryKey: whiteboardQueryKeys.detail(whiteboardId),
        exact: true,
      });
    }
  }, [handleGone, queryClient, t, terminalKind, whiteboardId]);

  useEffect(() => {
    const onChange = () => {
      const full =
        Boolean(canvasRef.current) &&
        document.fullscreenElement === canvasRef.current;
      setIsFullScreen(full);
      if (!full && presentFullScreenRef.current) {
        presentFullScreenRef.current = false;
        setPresenting(false);
      }
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const isNotFound =
    terminalKind === "notVisible" ||
    (boardQuery.error instanceof HttpError &&
      [400, 403, 404].includes(boardQuery.error.status));

  const capabilities = board?.capabilities;
  const isArchived = Boolean(board?.archivedAt);
  const isLocked = Boolean(board?.isLocked);
  const cantConnect =
    collab.fallback ||
    terminalKind === "roomFull" ||
    terminalKind === "protocol" ||
    collab.failedAttempts >= 5;
  const readOnly =
    !capabilities?.canEdit ||
    !collab.canWrite ||
    Boolean(collab.terminal) ||
    collab.fallback ||
    collab.tooLarge;
  const untitled = t("whiteboards:list.untitled");
  const title = board ? board.title.trim() || untitled : "";

  // The editor reports a failed upload, so a file never gets two messages.
  const uploadImage = useCallback(
    (file: File) => uploadWhiteboardImage(whiteboardId, file),
    [whiteboardId],
  );
  const imageUrl = useCallback(
    (assetId: string) => whiteboardAssetUrl(whiteboardId, assetId),
    [whiteboardId],
  );

  const startPresenting = () => {
    setPresenting(true);
    const element = canvasRef.current;
    if (!element || document.fullscreenElement) return;
    // Without full screen (refused, or not offered) the canvas still covers
    // the window, so present mode works either way.
    void element
      .requestFullscreen?.()
      .then(() => {
        presentFullScreenRef.current = true;
      })
      .catch(() => undefined);
  };

  const stopPresenting = () => {
    setPresenting(false);
    if (presentFullScreenRef.current) {
      presentFullScreenRef.current = false;
      if (document.fullscreenElement) void document.exitFullscreen?.();
    }
    // A presenter window opened with ?present=1 becomes the plain board.
    if (present) {
      void navigate({
        to: "/dashboard/workspace/$workspaceId/project/$projectId/whiteboards/$whiteboardId",
        params: { workspaceId, projectId, whiteboardId },
        search: (previous: Record<string, unknown>) => ({
          ...previous,
          present: undefined,
        }),
        replace: true,
      });
    }
  };

  // The desktop app opens a same-origin window.open as its own window,
  // which can go to a second display.
  const presentInNewWindow = () => {
    window.open(presentUrl(window.location.href), "_blank");
  };

  const toggleFullScreen = () => {
    const element = canvasRef.current;
    if (!element) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen?.();
    } else {
      void element.requestFullscreen?.().catch(() => undefined);
    }
  };

  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !editor) return;
    // The editor's import is quiet; the screen confirms it or says it failed.
    try {
      await editor.importFile(file);
      toast.success(t("whiteboards:toasts.imported"));
    } catch {
      toast.error(t("whiteboards:toasts.importError"));
    }
  };

  const renderCanvas = () => {
    if (!board) {
      if (boardQuery.isError) {
        return (
          <Empty className="h-full">
            <EmptyHeader>
              <EmptyTitle>{t("whiteboards:screen.loadError")}</EmptyTitle>
            </EmptyHeader>
            <EmptyContent>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void boardQuery.refetch()}
              >
                {t("whiteboards:list.retry")}
              </Button>
            </EmptyContent>
          </Empty>
        );
      }
      return <CanvasSkeleton />;
    }
    if (collab.fallback && collab.storedCopy.isError) {
      return (
        <Empty className="h-full">
          <EmptyHeader>
            <EmptyTitle>{t("whiteboards:screen.storedCopyError")}</EmptyTitle>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" size="sm" onClick={collab.retry}>
              {t("whiteboards:list.retry")}
            </Button>
          </EmptyContent>
        </Empty>
      );
    }
    if (!collab.doc) return <CanvasSkeleton />;
    return (
      <WhiteboardEditor
        // A new document (the stored copy, then the live one) remounts it.
        key={collab.doc.guid}
        doc={collab.doc}
        awareness={collab.awareness}
        readOnly={readOnly}
        user={user}
        workspaceId={workspaceId}
        projectId={board.projectId}
        whiteboardId={board.id}
        theme={theme}
        uploadImage={readOnly ? undefined : uploadImage}
        imageUrl={imageUrl}
        onReady={onEditorReady}
        initialElementId={elementId ?? null}
        presenting={presenting}
        onExitPresent={stopPresenting}
        synced={collab.fallback || collab.hasSynced}
        aiEnabled={ai.available}
      />
    );
  };

  const header =
    board && !isNotFound ? (
      <div className="flex items-center gap-0.5">
        <PageSyncBadge
          status={collab.status}
          hasSynced={collab.hasSynced}
          saveError={collab.saveError}
          cantConnect={cantConnect}
          lastSavedAt={collab.lastSavedAt}
          onRetry={collab.retry}
        />
        {board.capabilities.canManage && !isArchived ? (
          <HeaderIconButton
            label={
              isLocked
                ? t("whiteboards:actions.unlock")
                : t("whiteboards:actions.lock")
            }
            pressed={isLocked}
            onClick={actions.toggleLock}
          >
            {isLocked ? (
              <Lock className="size-4" />
            ) : (
              <LockOpen className="size-4" />
            )}
          </HeaderIconButton>
        ) : null}
        {board.capabilities.canPublish && (
          <HeaderIconButton
            label={t("whiteboards:actions.share")}
            pressed={Boolean(board.publicToken)}
            onClick={actions.openShare}
          >
            <Globe className="size-4" />
          </HeaderIconButton>
        )}
        <WhiteboardExportMenu editor={editor} title={title} theme={theme} />
        <BoardMoreMenu label={t("whiteboards:actions.more")}>
          <DropdownMenuItem
            disabled={!editor}
            onClick={() => editor?.zoomToFit()}
          >
            <Scan />
            {t("whiteboards:actions.zoomToFit")}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!editor} onClick={startPresenting}>
            <Presentation />
            {t("whiteboards:present.start")}
          </DropdownMenuItem>
          {isDesktopApp() && (
            <DropdownMenuItem onClick={presentInNewWindow}>
              <MonitorUp />
              {t("whiteboards:present.newWindow")}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={toggleFullScreen}>
            <Expand />
            {isFullScreen
              ? t("whiteboards:actions.exitFullScreen")
              : t("whiteboards:actions.fullScreen")}
          </DropdownMenuItem>
          {!readOnly && (
            <DropdownMenuItem
              disabled={!editor}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload />
              {t("whiteboards:actions.importFile")}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => setHistoryOpen(true)}>
            <History />
            {t("whiteboards:actions.history")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <WhiteboardMenuItems
            board={board}
            capabilities={board.capabilities}
            actions={actions}
          />
        </BoardMoreMenu>
      </div>
    ) : null;

  return (
    <ProjectLayout
      projectId={projectId}
      workspaceId={workspaceId}
      activeSection="whiteboards"
      extraCrumbs={
        isNotFound ? null : board ? (
          <span className="flex min-w-0 items-center gap-1.5 text-sm">
            <WhiteboardIcon icon={board.icon} />
            <span className="truncate">{title}</span>
          </span>
        ) : (
          <Skeleton className="h-7 w-40" />
        )
      }
      headerActions={header}
    >
      <PageTitle
        title={`${features.project?.name ?? ""} · ${board ? title : t("whiteboards:section.title")}`}
        hideAppName
      />
      <ProjectFeatureGate
        projectId={projectId}
        workspaceId={workspaceId}
        feature="whiteboards"
      >
        {isNotFound ? (
          <BoardNotFound workspaceId={workspaceId} projectId={projectId} />
        ) : (
          <div className="flex h-full min-h-0 flex-col">
            <div className="flex h-11 shrink-0 items-center gap-1 border-border/80 border-b px-2 pointer-coarse:h-12">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("whiteboards:screen.backToList")}
                title={t("whiteboards:screen.backToList")}
                className="text-muted-foreground pointer-coarse:size-11"
                render={
                  <Link
                    to="/dashboard/workspace/$workspaceId/project/$projectId/whiteboards"
                    params={{ workspaceId, projectId }}
                  />
                }
              >
                <ChevronLeft className="size-4" />
              </Button>
              {board ? (
                <>
                  {board.capabilities.canEdit ? (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("whiteboards:actions.changeIcon")}
                      title={t("whiteboards:actions.changeIcon")}
                      onClick={actions.openIcon}
                    >
                      <WhiteboardIcon icon={board.icon} />
                    </Button>
                  ) : (
                    <span className="inline-flex size-8 items-center justify-center">
                      <WhiteboardIcon icon={board.icon} />
                    </span>
                  )}
                  <WhiteboardTitleInput
                    key={board.id}
                    whiteboardId={board.id}
                    projectId={board.projectId}
                    title={board.title}
                    canEdit={board.capabilities.canEdit}
                    className="w-full max-w-md"
                  />
                  {isLocked && (
                    <Badge variant="warning" className="shrink-0 gap-1">
                      <Lock aria-hidden="true" className="size-3" />
                      {t("whiteboards:list.locked")}
                    </Badge>
                  )}
                  {readOnly && !isLocked && (
                    <Badge variant="outline" className="shrink-0">
                      {t("whiteboards:screen.readOnly")}
                    </Badge>
                  )}
                </>
              ) : (
                <Skeleton className="h-6 w-48" />
              )}
            </div>
            {board && (
              <WhiteboardBanners
                isLocked={isLocked}
                isArchived={isArchived}
                canManage={board.capabilities.canManage}
                readOnlyByRole={
                  !board.capabilities.canEdit && !isLocked && !isArchived
                }
                tooLarge={collab.tooLarge}
                storedCopy={collab.fallback}
                lockedByName={board.lockedBy?.name ?? null}
                onUnlock={actions.toggleLock}
                onRestore={actions.toggleArchive}
                onReload={() => window.location.reload()}
                onRetry={collab.retry}
              />
            )}
            <div
              ref={canvasRef}
              className={cn(
                "relative min-h-0 flex-1 overflow-hidden bg-background",
                // Present mode covers the window even without full screen.
                presenting && "fixed inset-0 z-60",
              )}
              data-slot="whiteboard-canvas"
            >
              {renderCanvas()}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept={BOARD_FILE_ACCEPT}
              className="hidden"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(event) => void importFile(event)}
            />
          </div>
        )}
      </ProjectFeatureGate>
      {board && actions.dialogs}
      {board && (
        <WhiteboardHistorySheet
          whiteboardId={board.id}
          open={historyOpen}
          onOpenChange={setHistoryOpen}
        />
      )}
    </ProjectLayout>
  );
}

// Lets the actions hook run before the board loads; nothing acts on it.
const PLACEHOLDER_BOARD: Whiteboard = {
  id: "",
  workspaceId: "",
  projectId: "",
  title: "",
  icon: null,
  isLocked: false,
  lockedBy: null,
  lockedAt: null,
  archivedAt: null,
  publicToken: null,
  publishedAt: null,
  elementCount: 0,
  contentVersion: 0,
  createdAt: "",
  updatedAt: "",
  createdBy: null,
  updatedBy: null,
  capabilities: {
    canEdit: false,
    canManage: false,
    canPublish: false,
    canDuplicate: false,
  },
};
