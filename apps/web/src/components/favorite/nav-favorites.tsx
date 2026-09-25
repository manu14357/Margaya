import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  restrictToFirstScrollableAncestor,
  restrictToVerticalAxis,
} from "@dnd-kit/modifiers";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { ChevronRight, MoreHorizontal, StarOff } from "lucide-react";
import { type CSSProperties, type ReactNode, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { panelRowActionClass } from "@/components/context-panel/panel-primitives";
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useOptionalSidebar,
} from "@/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import useReorderFavorites from "@/hooks/mutations/favorite/use-reorder-favorites";
import useToggleFavorite, {
  isOptimisticFavorite,
} from "@/hooks/mutations/favorite/use-toggle-favorite";
import useGetFavorites, {
  type Favorite,
} from "@/hooks/queries/favorite/use-get-favorites";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { getEntityIcon, getEntityPath } from "@/lib/entity-links";
import { moveFavorite } from "@/lib/favorites";
import { toast } from "@/lib/toast";

const OPEN_STORAGE_KEY = "margaya:sidebar:favorites-open";

function readOpenState(): boolean {
  try {
    return window.localStorage.getItem(OPEN_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

function writeOpenState(open: boolean) {
  try {
    window.localStorage.setItem(OPEN_STORAGE_KEY, String(open));
  } catch {
    // Storage can be unavailable (private mode); the default still works.
  }
}

function SortableFavoriteItem({
  id,
  canReorder,
  children,
}: {
  id: string;
  canReorder: boolean;
  children: ReactNode;
}) {
  const { listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({
      id,
      disabled: !canReorder,
      animateLayoutChanges: () => false,
      transition: { duration: 200, easing: "var(--ease-out)" },
    });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    // `listeners` without `attributes`, as in the projects list: the row
    // keeps its link and menu as the only tab stops.
    <SidebarMenuItem
      ref={setNodeRef}
      style={style}
      data-margaya-sortable=""
      className={isDragging ? "opacity-0" : undefined}
      {...(canReorder ? listeners : {})}
    >
      {children}
    </SidebarMenuItem>
  );
}

function FavoriteLabel({ favorite }: { favorite: Favorite }) {
  const Icon = getEntityIcon(favorite.entity);
  return (
    <>
      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate">{favorite.entity.name}</span>
    </>
  );
}

export function NavFavorites() {
  const { t } = useTranslation();
  const isMobile = useOptionalSidebar()?.isMobile ?? false;
  const navigate = useNavigate();
  const location = useLocation();
  const { data: workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id ?? "";
  const { data: favorites, isError } = useGetFavorites({ workspaceId });
  const reorderFavorites = useReorderFavorites();
  const { mutate: toggleFavorite } = useToggleFavorite();
  const [open, setOpen] = useState(readOpenState);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 8 },
    }),
  );

  if (!workspaceId || isError || !favorites || favorites.length === 0) {
    return null;
  }

  const draggingFavorite = favorites.find((item) => item.id === draggingId);

  const endDrag = () => {
    document.body.classList.remove("margaya-dragging");
    setDraggingId(null);
  };

  const handleDragStart = (event: DragStartEvent) => {
    document.body.classList.add("margaya-dragging");
    setDraggingId(String(event.active.id));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    endDrag();
    if (!over || active.id === over.id) return;

    const reordered = moveFavorite(
      favorites,
      String(active.id),
      String(over.id),
    );
    if (reordered.some(isOptimisticFavorite)) return;

    reorderFavorites(workspaceId, reordered, {
      onError: () => {
        toast.error(t("navigation:favorites.reorderError"));
      },
    });
  };

  const handleRemove = (favorite: Favorite) => {
    toggleFavorite(
      {
        workspaceId,
        entityType: favorite.entityType,
        entityId: favorite.entityId,
        isFavorite: true,
      },
      {
        onSuccess: () => toast.success(t("navigation:favorites.removed")),
        onError: () => toast.error(t("navigation:favorites.error")),
      },
    );
  };

  return (
    <Collapsible
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        writeOpenState(next);
      }}
      className="group/collapsible"
    >
      <SidebarGroup className="gap-0.5 px-2 py-1">
        <CollapsibleTrigger
          className="data-panel-open:[&_svg]:rotate-90"
          render={
            <SidebarGroupLabel className="cursor-pointer justify-between hover:text-sidebar-accent-foreground" />
          }
        >
          <span>{t("navigation:sidebar.favorites")}</span>
          <ChevronRight className="text-sidebar-foreground/60 transition-transform duration-200" />
        </CollapsibleTrigger>
        <CollapsiblePanel>
          <SidebarGroupContent>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              modifiers={[
                restrictToVerticalAxis,
                restrictToFirstScrollableAncestor,
              ]}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onDragCancel={endDrag}
            >
              <SidebarMenu>
                <SortableContext
                  items={favorites.map((favorite) => favorite.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {favorites.map((favorite) => {
                    const path = getEntityPath(favorite.entity, workspaceId);
                    const isActive =
                      path !== null &&
                      (location.pathname === path ||
                        location.pathname.startsWith(`${path}/`));
                    const button = (
                      <SidebarMenuButton
                        isActive={isActive}
                        size="default"
                        className="pe-7"
                        onClick={() => {
                          if (path) navigate({ to: path });
                        }}
                      >
                        <FavoriteLabel favorite={favorite} />
                      </SidebarMenuButton>
                    );

                    return (
                      <SortableFavoriteItem
                        key={favorite.id}
                        id={favorite.id}
                        canReorder={!isOptimisticFavorite(favorite)}
                      >
                        {favorite.entityType !== "project" &&
                        favorite.entity.projectName ? (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger render={button} />
                              <TooltipContent side="right">
                                {favorite.entity.projectName}
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        ) : (
                          button
                        )}

                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <button
                                type="button"
                                // The row is the drag source; this press
                                // must not reach it.
                                onPointerDown={(event) =>
                                  event.stopPropagation()
                                }
                                className={panelRowActionClass}
                              />
                            }
                          >
                            <MoreHorizontal />
                            <span className="sr-only">
                              {t("navigation:sidebar.more")}
                            </span>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent
                            className="min-w-44 rounded-lg"
                            side={isMobile ? "bottom" : "right"}
                            align={isMobile ? "end" : "start"}
                          >
                            <DropdownMenuItem
                              className="h-7 items-start cursor-pointer text-sm"
                              onClick={() => handleRemove(favorite)}
                            >
                              <StarOff className="text-muted-foreground" />
                              <span>{t("navigation:favorites.remove")}</span>
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </SortableFavoriteItem>
                    );
                  })}
                </SortableContext>
              </SidebarMenu>

              {/* Portalled: the panel body scrolls and would clip it. */}
              {createPortal(
                <DragOverlay dropAnimation={null}>
                  {draggingFavorite ? (
                    <div className="flex h-7.5 w-56 items-center gap-2 rounded-md border bg-card not-dark:bg-clip-padding ps-2 pe-2 text-[13px] text-sidebar-accent-foreground shadow-lg/5">
                      <FavoriteLabel favorite={draggingFavorite} />
                    </div>
                  ) : null}
                </DragOverlay>,
                document.body,
              )}
            </DndContext>
          </SidebarGroupContent>
        </CollapsiblePanel>
      </SidebarGroup>
    </Collapsible>
  );
}
