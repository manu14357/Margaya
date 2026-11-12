import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import type { Editor } from "@tiptap/core";
import { FileText, PanelRight } from "lucide-react";
import {
  type MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { AiContentLabel } from "@/components/ai/ai-content-label";
import { AiSummaryButton } from "@/components/ai/ai-summary";
import DescriptionTranslation from "@/components/ai/translate/description-translation";
import ProjectLayout from "@/components/common/project-layout";
import { ContextPanelSlot } from "@/components/context-panel/panel-slot";
import AiPageTitle from "@/components/editor/ai/ai-page-title";
import PageTitle from "@/components/page-title";
import ProjectFeatureGate from "@/components/project/project-feature-gate";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  useRecordVisit,
  visitArchiveState,
} from "@/hooks/mutations/recent-visit/use-record-visit";
import { pageQueryKeys } from "@/hooks/queries/page/page-query-keys";
import { useGetPage } from "@/hooks/queries/page/use-get-page";
import { useGetPages } from "@/hooks/queries/page/use-get-pages";
import { useProjectFeatures } from "@/hooks/use-project-features";
import { provenanceOf } from "@/lib/ai/provenance";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/cn";
import { HttpError } from "@/lib/http-error";
import { indexPages, pageAncestors } from "@/lib/pages/build-page-tree";
import { onPageDeleted } from "@/lib/pages/page-events";
import { toast } from "@/lib/toast";
import { useUserPreferencesStore } from "@/store/user-preferences";
import type { PagePanel } from "@/types/page";
import { usePageCollaboration } from "./collab/use-page-collaboration";
import PageBanners from "./page-banners";
import PageBody, { PageBodySkeleton } from "./page-body";
import PageCrumbSelect from "./page-crumb-select";
import PageFormatToolbar, {
  isFormatToolbarAvailable,
} from "./page-format-toolbar";
import PageLogoPicker from "./page-logo-picker";
import PageOutlineMinimap from "./page-outline-minimap";
import PageSidePanel from "./page-side-panel";
import PageTitleInput from "./page-title-input";
import PageHeaderActions, { PageCollabStatus } from "./page-toolbar";
import PageTreePanel from "./page-tree/page-tree-panel";
import PageVersionPreview from "./page-version-preview";
import { usePageActions } from "./use-page-actions";
import { jumpToHeading, usePageHeadings } from "./use-page-headings";
import { usePageMembers } from "./use-page-members";

type PageScreenProps = {
  workspaceId: string;
  projectId: string;
  pageId: string;
  panel?: PagePanel;
  versionId?: string;
  onSearchChange: (search: { panel?: PagePanel; version?: string }) => void;
};

function PageNotFound({
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
          <FileText />
        </EmptyMedia>
        <EmptyTitle>{t("pages:state.notFound.title")}</EmptyTitle>
        <EmptyDescription>
          {t("pages:state.notFound.description")}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button
          variant="outline"
          size="sm"
          render={
            <Link
              to="/dashboard/workspace/$workspaceId/project/$projectId/pages"
              params={{ workspaceId, projectId }}
            />
          }
        >
          {t("pages:state.notFound.back")}
        </Button>
      </EmptyContent>
    </Empty>
  );
}

/** Puts focus back on the visible side panel toggle (after Close). */
function focusPanelToggle() {
  window.requestAnimationFrame(() => {
    const toggles = document.querySelectorAll<HTMLElement>(
      "[data-page-panel-toggle]",
    );
    for (const toggle of toggles) {
      if (toggle.offsetParent !== null && !toggle.closest("[inert]")) {
        toggle.focus();
        return;
      }
    }
  });
}

function PanelToggle({
  isOpen,
  onToggle,
  className,
}: {
  isOpen: boolean;
  onToggle: () => void;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("pages:header.togglePanel")}
              aria-pressed={isOpen}
              data-page-panel-toggle=""
              className={cn(
                "shrink-0 text-muted-foreground aria-pressed:bg-accent aria-pressed:text-foreground",
                className,
              )}
              onClick={onToggle}
            />
          }
        >
          <PanelRight className="size-4" />
        </TooltipTrigger>
        <TooltipContent>{t("pages:header.togglePanel")}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** The floating outline, with its own heading subscription. */
function PageMinimapSlot({
  editor,
  onOpenPanel,
}: {
  editor: Editor | null;
  onOpenPanel: () => void;
}) {
  const { headings, activePos } = usePageHeadings(editor);
  return (
    <PageOutlineMinimap
      headings={headings}
      activePos={activePos}
      onOpenPanel={onOpenPanel}
      onJump={(heading) => jumpToHeading(editor, heading)}
    />
  );
}

/**
 * A page (§1.5). The tree sits in the shell's context panel. The top bar
 * holds the page switcher after the project, then who is here, whether
 * edits are saved and the page's tools. An editable page gets the
 * formatting row; the canvas holds the notices, the icon row, the title
 * and the live body in one centred column. Outline / Info / History sit
 * beside it from 1024px, in a sheet below; while they are closed, a
 * floating outline marks the headings.
 */
export default function PageScreen({
  workspaceId,
  projectId,
  pageId,
  panel,
  versionId,
  onSearchChange,
}: PageScreenProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: session } = authClient.useSession();
  const userId = session?.user?.id;
  const features = useProjectFeatures({ projectId, workspaceId });
  const enabled = features.isEnabled("pages");
  const pageQuery = useGetPage(enabled ? pageId : "");
  const page = pageQuery.data;
  const { getMember } = usePageMembers(workspaceId);
  const [editor, setEditor] = useState<Editor | null>(null);
  const { data: projectPages } = useGetPages(enabled ? projectId : "");
  const formatToolbarPreference = useUserPreferencesStore(
    (state) => state.pagesFormatToolbar,
  );
  const goneHandledRef = useRef(false);

  const resolveName = useCallback(
    (id: string) => getMember(id)?.name ?? null,
    [getMember],
  );
  const collab = usePageCollaboration({
    pageId: page ? pageId : "",
    userId,
    resolveName,
  });

  useRecordVisit({
    workspaceId,
    entityType: "page",
    entityId: page ? pageId : undefined,
    archived: visitArchiveState(page, features.project),
  });

  const goToList = useCallback(
    (tab?: "archived") =>
      navigate({
        to: "/dashboard/workspace/$workspaceId/project/$projectId/pages",
        params: { workspaceId, projectId },
        search: tab ? { tab } : {},
      }),
    [navigate, projectId, workspaceId],
  );

  const actions = usePageActions({
    page: page ?? PLACEHOLDER_PAGE,
    workspaceId,
    onDeleted: () => goToList("archived"),
    onMoved: (targetProjectId) =>
      navigate({
        to: "/dashboard/workspace/$workspaceId/project/$projectId/pages/$pageId",
        params: { workspaceId, projectId: targetProjectId, pageId },
        replace: true,
      }),
  });

  // Links to a moved page keep working: follow it to its project.
  useEffect(() => {
    if (!page?.projectId || page.projectId === projectId) return;
    navigate({
      to: "/dashboard/workspace/$workspaceId/project/$projectId/pages/$pageId",
      params: { workspaceId, projectId: page.projectId, pageId },
      search: (previous: Record<string, unknown>) => previous,
      replace: true,
    });
  }, [navigate, page?.projectId, pageId, projectId, workspaceId]);

  const handleGone = useCallback(async () => {
    if (goneHandledRef.current) return;
    goneHandledRef.current = true;
    const refreshed = await features.refetch();
    const stillOn = refreshed.data?.pagesEnabled !== false;
    if (stillOn) {
      toast.info(t("pages:collab.deleted"));
      goToList();
    }
  }, [features, goToList, t]);

  // The project socket says the page was deleted (when this tab's page
  // socket did not already).
  useEffect(
    () =>
      onPageDeleted((deletedId) => {
        if (deletedId === pageId) void handleGone();
      }),
    [handleGone, pageId],
  );

  const terminalKind = collab.terminal?.kind;
  useEffect(() => {
    if (!terminalKind) return;
    if (terminalKind === "signedOut") toast.error(t("pages:collab.signedOut"));
    if (terminalKind === "roomFull") toast.error(t("pages:collab.roomFull"));
    if (terminalKind === "gone") void handleGone();
    if (terminalKind === "notVisible") {
      void queryClient.invalidateQueries({
        queryKey: pageQueryKeys.detail(pageId),
        exact: true,
      });
    }
  }, [handleGone, pageId, queryClient, t, terminalKind]);

  const isNotFound =
    terminalKind === "notVisible" ||
    (pageQuery.error instanceof HttpError &&
      [400, 403, 404].includes(pageQuery.error.status));

  const effectivePanel: PagePanel | undefined = versionId ? "history" : panel;
  const togglePanel = () =>
    onSearchChange({
      panel: effectivePanel ? undefined : "outline",
      version: undefined,
    });

  const capabilities = page?.capabilities;
  const cantConnect =
    collab.fallback ||
    terminalKind === "roomFull" ||
    terminalKind === "protocol" ||
    collab.failedAttempts >= 5;
  const editable = Boolean(
    capabilities?.canEdit && collab.canWrite && !collab.terminal,
  );
  const storedCopyEditable = Boolean(capabilities?.canEdit && !collab.terminal);
  const untitled = t("pages:list.untitled");

  const ancestors = useMemo(
    () =>
      page && projectPages
        ? pageAncestors(
            indexPages(projectPages.filter((entry) => !entry.archivedAt)),
            page,
          )
        : [],
    [page, projectPages],
  );

  // A click on the canvas below the text continues writing at the end.
  const focusEnd = (event: MouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    const blank =
      target === event.currentTarget || target.dataset.slot === "page-reading";
    if (!blank) return;
    if (!editor || editor.isDestroyed || !editor.isEditable) return;
    editor.commands.focus("end");
  };

  const hasLogo = Boolean(page?.logoKind && page?.logoValue);
  // The icon box grows open only when an icon is set while the page is
  // open, not when a page that already has one loads.
  const logoAtLoadRef = useRef<{ pageId: string; hadLogo: boolean } | null>(
    null,
  );
  if (page && logoAtLoadRef.current?.pageId !== page.id) {
    logoAtLoadRef.current = { pageId: page.id, hadLogo: hasLogo };
  }
  const growLogo = hasLogo && logoAtLoadRef.current?.hadLogo === false;

  // The formatting row: editable pages only, never in a version preview.
  const toolbarAvailable = Boolean(
    page &&
      isFormatToolbarAvailable({
        editable,
        isLocked: page.isLocked,
        isArchived: Boolean(page.archivedAt),
        isPreviewingVersion: Boolean(versionId),
      }),
  );
  const toolbarShown = toolbarAvailable && formatToolbarPreference;
  const isPanelOpen = Boolean(effectivePanel);
  const panelToggle = (className?: string) => (
    <PanelToggle
      isOpen={isPanelOpen}
      onToggle={togglePanel}
      className={className}
    />
  );
  const crumbSelect = (className?: string) =>
    page ? (
      <PageCrumbSelect
        workspaceId={workspaceId}
        projectId={page.projectId ?? projectId}
        pageId={page.id}
        title={page.title}
        logoKind={page.logoKind}
        logoValue={page.logoValue}
        className={className}
      />
    ) : null;

  return (
    <ProjectLayout
      projectId={projectId}
      workspaceId={workspaceId}
      activeSection="pages"
      extraCrumbs={
        isNotFound ? null : page ? (
          crumbSelect()
        ) : (
          <Skeleton className="h-7 w-40" />
        )
      }
      headerActions={
        page && !isNotFound ? (
          <div className="flex items-center gap-1">
            <AiSummaryButton
              kind="page"
              id={page.id}
              projectId={page.projectId ?? projectId}
              workspaceId={workspaceId}
              name={page.title.trim() || untitled}
            />
            <PageCollabStatus
              collab={collab}
              cantConnect={cantConnect}
              currentUserId={userId}
              getMember={getMember}
            />
            <PageHeaderActions
              page={page}
              workspaceId={workspaceId}
              actions={actions}
              editor={editor}
              onOpenHistory={() => onSearchChange({ panel: "history" })}
            />
          </div>
        ) : null
      }
      tabsTrailing={
        page && !isNotFound
          ? panelToggle(toolbarShown ? "md:hidden" : undefined)
          : null
      }
    >
      <PageTitle
        title={`${features.project?.name ?? ""} · ${page ? page.title.trim() || untitled : t("pages:section.title")}`}
        hideAppName
      />
      <ProjectFeatureGate
        projectId={projectId}
        workspaceId={workspaceId}
        feature="pages"
      >
        <ContextPanelSlot>
          <PageTreePanel
            workspaceId={workspaceId}
            projectId={projectId}
            activePageId={pageId}
            userId={userId}
          />
        </ContextPanelSlot>
        {isNotFound ? (
          <PageNotFound workspaceId={workspaceId} projectId={projectId} />
        ) : (
          <div className="flex h-full min-h-0 overflow-hidden">
            <div
              className="margaya-page-main flex min-w-0 flex-1 flex-col"
              data-full-width={page?.isFullWidth ? "true" : "false"}
            >
              {toolbarAvailable && (
                <PageFormatToolbar
                  editor={editor}
                  open={formatToolbarPreference}
                  trailing={panelToggle()}
                />
              )}
              {/* biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: a pointer shortcut below the text; the editor itself is keyboard reachable */}
              <div
                className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain"
                data-slot="page-canvas"
                onClick={focusEnd}
              >
                {page && !versionId && !isPanelOpen && (
                  <PageMinimapSlot
                    editor={editor}
                    onOpenPanel={() =>
                      onSearchChange({ panel: "outline", version: undefined })
                    }
                  />
                )}
                {page && versionId ? (
                  <PageVersionPreview
                    page={page}
                    workspaceId={workspaceId}
                    versionId={versionId}
                    onClose={() => onSearchChange({ panel: "history" })}
                  />
                ) : (
                  <div className="margaya-page-column" data-slot="page-reading">
                    {!page ? (
                      pageQuery.isError ? (
                        <div className="flex flex-col items-center gap-3 py-16 text-center">
                          <p className="text-muted-foreground text-sm">
                            {t("pages:list.loadError")}
                          </p>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void pageQuery.refetch()}
                          >
                            {t("pages:list.retry")}
                          </Button>
                        </div>
                      ) : (
                        <div aria-hidden="true">
                          <div className="h-12" />
                          <Skeleton className="my-3 h-9 w-3/5" />
                          <PageBodySkeleton />
                        </div>
                      )
                    ) : (
                      <>
                        <PageBanners
                          isLocked={page.isLocked}
                          isArchived={Boolean(page.archivedAt)}
                          canLock={page.capabilities.canLock}
                          canArchive={page.capabilities.canArchive}
                          readOnlyByRole={
                            !page.capabilities.canEdit &&
                            page.access === "public" &&
                            !page.isLocked &&
                            !page.archivedAt
                          }
                          tooLarge={collab.tooLarge}
                          storedCopy={collab.fallback}
                          onUnlock={actions.toggleLock}
                          onRestore={actions.toggleArchive}
                          onReload={() => window.location.reload()}
                          onRetry={collab.retry}
                        />
                        <header className="group/page-head">
                          <div className="flex h-12 min-w-0 items-end gap-2">
                            {crumbSelect("shrink md:hidden")}
                            {ancestors.length > 0 && (
                              <nav
                                aria-label={t("pages:header.ancestors")}
                                className="hidden min-w-0 items-center gap-x-1 pb-1.5 text-muted-foreground text-xs md:flex"
                              >
                                {ancestors.map((ancestor) => (
                                  <span
                                    key={ancestor.id}
                                    className="inline-flex min-w-0 items-center gap-1"
                                  >
                                    <Link
                                      to="/dashboard/workspace/$workspaceId/project/$projectId/pages/$pageId"
                                      params={{
                                        workspaceId,
                                        projectId,
                                        pageId: ancestor.id,
                                      }}
                                      className="max-w-48 truncate rounded-sm hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                                    >
                                      {ancestor.title.trim() || untitled}
                                    </Link>
                                    <span aria-hidden="true">/</span>
                                  </span>
                                ))}
                              </nav>
                            )}
                            {!hasLogo && (
                              <PageLogoPicker
                                page={page}
                                canEdit={page.capabilities.canEdit}
                                emphasizeAdd={!page.title.trim()}
                              />
                            )}
                          </div>
                          {hasLogo && (
                            <PageLogoPicker
                              page={page}
                              canEdit={page.capabilities.canEdit}
                              grow={growLogo}
                            />
                          )}
                          <PageTitleInput
                            key={page.id}
                            pageId={page.id}
                            projectId={page.projectId ?? projectId}
                            title={page.title}
                            canEdit={page.capabilities.canEdit}
                            autoFocus={!page.title.trim()}
                            onEnter={() => editor?.commands.focus("start")}
                          />
                          <AiPageTitle
                            pageId={page.id}
                            projectId={page.projectId ?? projectId}
                            workspaceId={workspaceId}
                            editor={editor}
                            canEdit={page.capabilities.canEdit}
                            className="-mt-2 mb-1"
                          />
                          <AiContentLabel
                            provenance={provenanceOf(page.aiProvenance)}
                            className="mb-2"
                          />
                        </header>
                        {page.contentMarkdown ? (
                          <DescriptionTranslation
                            kind="page"
                            id={page.id}
                            text={page.contentMarkdown}
                            projectId={page.projectId ?? projectId}
                            className="mb-3 print:hidden"
                          />
                        ) : null}
                        <PageBody
                          page={page}
                          workspaceId={workspaceId}
                          userId={userId}
                          collab={collab}
                          editable={editable}
                          storedCopyEditable={storedCopyEditable}
                          resolveName={(id) =>
                            getMember(id)?.name ??
                            t("pages:history.unknownUser")
                          }
                          onEditorChange={setEditor}
                        />
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
            {page && (
              <PageSidePanel
                page={page}
                workspaceId={workspaceId}
                editor={editor}
                panel={effectivePanel}
                onPanelChange={(next) =>
                  onSearchChange({ panel: next, version: undefined })
                }
                onClose={focusPanelToggle}
                versionId={versionId}
                onVersionSelect={(version) =>
                  onSearchChange({ panel: "history", version })
                }
                getMember={getMember}
              />
            )}
          </div>
        )}
      </ProjectFeatureGate>
      {page && actions.dialogs}
    </ProjectLayout>
  );
}

// Lets the actions hook run before the page has loaded; nothing acts on it.
const PLACEHOLDER_PAGE = {
  id: "",
  workspaceId: "",
  projectId: null,
  parentId: null,
  position: 0,
  title: "",
  logoKind: null,
  logoValue: null,
  access: "public",
  ownerId: null,
  isLocked: false,
  lockedById: null,
  lockedAt: null,
  archivedAt: null,
  isFullWidth: false,
  createdById: null,
  updatedById: null,
  createdAt: "",
  updatedAt: "",
  capabilities: {
    canEdit: false,
    canLock: false,
    canChangeAccess: false,
    canArchive: false,
    canDelete: false,
    canDuplicate: false,
    canMove: false,
    canCreateSubpage: false,
    canRestoreVersion: false,
    canComment: false,
  },
} as const;
