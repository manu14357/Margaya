import {
  type Announcements,
  type CollisionDetection,
  closestCenter,
  DndContext,
  type DragEndEvent,
  type DragMoveEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  MouseSensor,
  pointerWithin,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import {
  type KeyboardEvent,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useStoredState } from "@/components/planning/use-stored-state";
import { Button } from "@/components/ui/button";
import { SidebarGroup, SidebarGroupLabel } from "@/components/ui/sidebar";
import { useCreatePage } from "@/hooks/mutations/page/use-create-page";
import { useMovePageInTree } from "@/hooks/mutations/page/use-move-page-in-tree";
import { useGetPages } from "@/hooks/queries/page/use-get-pages";
import useGetProject from "@/hooks/queries/project/use-get-project";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import {
  buildPageTree,
  flattenPageTree,
  indexPages,
  pageAncestors,
} from "@/lib/pages/build-page-tree";
import { pageErrorMessage } from "@/lib/pages/page-errors";
import {
  type DropIntent,
  dropZoneAt,
  NEST_OFFSET_PX,
  resolvePageDrop,
} from "@/lib/pages/page-tree-drop";
import { toast } from "@/lib/toast";
import PageLogo from "../page-logo";
import PageTreeItem from "./page-tree-item";

export function pagesTreeStorageKey(projectId: string) {
  return `margaya:pages-tree:${projectId}`;
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

// Pointer drags hit-test where the pointer is; keyboard drags fall back to
// the nearest row.
const collisionDetection: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length > 0 ? hits : closestCenter(args);
};

type PageTreePanelProps = {
  workspaceId: string;
  projectId: string;
  activePageId?: string;
  userId: string | undefined;
};

type DropState = DropIntent & { invalid: boolean };

/**
 * The project's page tree (§1.6). It lives in the shell's context panel
 * (Pages destination), under the projects, and scrolls with the panel.
 */
export default function PageTreePanel({
  workspaceId,
  projectId,
  activePageId,
  userId,
}: PageTreePanelProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: allPages = [] } = useGetPages(projectId);
  const { data: project } = useGetProject({ id: projectId, workspaceId });
  const { canCreatePages, isCheckingPermissions } = useWorkspacePermission();
  const createPage = useCreatePage();
  const movePage = useMovePageInTree();
  const [stored, setStored] = useStoredState<string[]>(
    pagesTreeStorageKey(projectId),
    [],
    isStringArray,
  );
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [drop, setDrop] = useState<DropState | null>(null);
  const rowRefs = useRef(new Map<string, HTMLElement>());
  const untitled = t("pages:list.untitled");

  const pages = useMemo(
    () => allPages.filter((page) => !page.archivedAt),
    [allPages],
  );
  const byId = useMemo(() => indexPages(pages), [pages]);
  const tree = useMemo(() => buildPageTree(pages), [pages]);

  const expanded = useMemo(() => {
    const ids = new Set(stored);
    const active = activePageId ? byId.get(activePageId) : undefined;
    if (active) {
      for (const ancestor of pageAncestors(byId, active)) ids.add(ancestor.id);
    }
    return ids;
  }, [activePageId, byId, stored]);

  const rows = useMemo(
    () => flattenPageTree(tree, (id) => expanded.has(id)),
    [expanded, tree],
  );

  const setExpanded = useCallback(
    (id: string, open: boolean) => {
      const next = new Set(expanded);
      if (open) next.add(id);
      else next.delete(id);
      setStored([...next].filter((pageId) => byId.has(pageId)));
    },
    [byId, expanded, setStored],
  );

  const titleOf = (id: string | null | undefined) => {
    const page = id ? byId.get(id) : undefined;
    return page?.title.trim() || untitled;
  };

  const openPage = (pageId: string) =>
    navigate({
      to: "/dashboard/workspace/$workspaceId/project/$projectId/pages/$pageId",
      params: { workspaceId, projectId, pageId },
    });

  const focusRow = (id: string | undefined) => {
    if (!id) return;
    setFocusedId(id);
    rowRefs.current.get(id)?.focus();
  };

  const handleRowKeyDown = (
    event: KeyboardEvent<HTMLElement>,
    index: number,
  ): boolean => {
    if (draggingId) return false;
    const row = rows[index];
    if (!row) return false;
    const id = row.page.id;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusRow(rows[index + 1]?.page.id);
        return true;
      case "ArrowUp":
        event.preventDefault();
        focusRow(rows[index - 1]?.page.id);
        return true;
      case "ArrowRight":
        event.preventDefault();
        if (row.children.length === 0) return true;
        if (!expanded.has(id)) setExpanded(id, true);
        else focusRow(row.children[0]?.page.id);
        return true;
      case "ArrowLeft":
        event.preventDefault();
        if (row.children.length > 0 && expanded.has(id)) {
          setExpanded(id, false);
        } else {
          focusRow(row.path.at(-1)?.id);
        }
        return true;
      case "Enter":
        event.preventDefault();
        openPage(id);
        return true;
      default:
        return false;
    }
  };

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, {
      keyboardCodes: {
        start: ["Space"],
        cancel: ["Escape"],
        end: ["Space"],
      },
    }),
  );

  const intentFor = (event: DragMoveEvent | DragEndEvent): DropState | null => {
    const { active, over, delta } = event;
    const rect = active.rect.current.translated;
    if (!over || !rect) return null;
    const centerY = rect.top + rect.height / 2;
    const intent: DropIntent = {
      overId: String(over.id),
      zone: dropZoneAt(centerY - over.rect.top, over.rect.height),
      nest: delta.x >= NEST_OFFSET_PX,
    };
    const result = resolvePageDrop(pages, String(active.id), intent, userId);
    return { ...intent, invalid: result === "invalid" };
  };

  const endDrag = () => {
    document.body.classList.remove("margaya-dragging");
    setDraggingId(null);
    setDrop(null);
  };

  const handleDragStart = (event: DragStartEvent) => {
    document.body.classList.add("margaya-dragging");
    setDraggingId(String(event.active.id));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const state = intentFor(event);
    endDrag();
    if (!state) return;
    const pageId = String(event.active.id);
    const target = resolvePageDrop(pages, pageId, state, userId);
    if (!target || target === "invalid") return;
    if (target.parentId) setExpanded(target.parentId, true);
    movePage.mutate(
      { pageId, projectId, ...target },
      {
        onError: (error) =>
          toast.error(pageErrorMessage(error) ?? t("pages:toasts.moveError")),
      },
    );
  };

  const announcements: Announcements = {
    onDragStart: ({ active }) =>
      t("pages:tree.dnd.pickedUp", { title: titleOf(String(active.id)) }),
    onDragOver: ({ active, over }) =>
      over
        ? t("pages:tree.dnd.over", {
            title: titleOf(String(active.id)),
            target: titleOf(String(over.id)),
          })
        : undefined,
    onDragEnd: ({ active, over }) =>
      over && drop && !drop.invalid
        ? t("pages:tree.dnd.dropped", { title: titleOf(String(active.id)) })
        : t("pages:tree.dnd.invalid", { title: titleOf(String(active.id)) }),
    onDragCancel: () => t("pages:tree.dnd.cancelled"),
  };

  const canCreate = !isCheckingPermissions && canCreatePages();
  const createRoot = () =>
    createPage.mutate(
      { projectId },
      {
        onSuccess: (page) => openPage(page.id),
        onError: (error) =>
          toast.error(pageErrorMessage(error) ?? t("pages:toasts.createError")),
      },
    );

  const dragging = draggingId ? byId.get(draggingId) : undefined;
  const tabStop =
    focusedId && rows.some((row) => row.page.id === focusedId)
      ? focusedId
      : (activePageId ?? rows[0]?.page.id);

  return (
    <SidebarGroup className="gap-0.5 px-2 py-1" data-slot="page-tree">
      <div className="flex items-center justify-between gap-1">
        <SidebarGroupLabel className="min-w-0 flex-1">
          <span className="truncate">
            {project?.name ?? t("pages:tree.title")}
          </span>
        </SidebarGroupLabel>
        {canCreate && (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={t("pages:tree.newPage")}
            disabled={createPage.isPending}
            onClick={createRoot}
            className="text-sidebar-foreground"
          >
            <Plus className="size-3.5" />
          </Button>
        )}
      </div>
      <div>
        {rows.length === 0 ? (
          <p className="px-2 py-1.5 text-muted-foreground text-xs">
            {t("pages:tree.empty")}
          </p>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={collisionDetection}
            accessibility={{ announcements }}
            onDragStart={handleDragStart}
            onDragMove={(event) => setDrop(intentFor(event))}
            onDragEnd={handleDragEnd}
            onDragCancel={endDrag}
          >
            <div
              role="tree"
              aria-label={t("pages:tree.title")}
              className="flex flex-col gap-px"
            >
              {rows.map((row, index) => (
                <PageTreeItem
                  key={row.page.id}
                  page={row.page}
                  workspaceId={workspaceId}
                  depth={row.depth}
                  hasChildren={row.children.length > 0}
                  isExpanded={expanded.has(row.page.id)}
                  isActive={row.page.id === activePageId}
                  isFocused={row.page.id === tabStop}
                  isDragging={row.page.id === draggingId}
                  dropZone={drop?.overId === row.page.id ? drop.zone : null}
                  dropInvalid={Boolean(drop?.invalid)}
                  onToggle={() =>
                    setExpanded(row.page.id, !expanded.has(row.page.id))
                  }
                  onFocus={() => setFocusedId(row.page.id)}
                  onKeyDown={(event) => handleRowKeyDown(event, index)}
                  registerRef={(element) => {
                    if (element) rowRefs.current.set(row.page.id, element);
                    else rowRefs.current.delete(row.page.id);
                  }}
                />
              ))}
            </div>
            {createPortal(
              <DragOverlay dropAnimation={null}>
                {dragging ? (
                  <div
                    className={
                      drop?.invalid
                        ? "flex h-7 w-60 cursor-not-allowed items-center gap-2 rounded-md border bg-popover px-2 text-sm opacity-80 shadow-lg/5"
                        : "flex h-7 w-60 items-center gap-2 rounded-md border bg-popover px-2 text-sm shadow-lg/5"
                    }
                  >
                    <PageLogo
                      logoKind={dragging.logoKind}
                      logoValue={dragging.logoValue}
                      className="size-3.5"
                    />
                    <span className="truncate">{titleOf(dragging.id)}</span>
                  </div>
                ) : null}
              </DragOverlay>,
              document.body,
            )}
          </DndContext>
        )}
      </div>
    </SidebarGroup>
  );
}
