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
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate, useParams } from "@tanstack/react-router";
import {
  Archive,
  ChevronRight,
  Folder,
  Forward,
  Globe,
  MoreHorizontal,
  Plus,
  Settings,
  Trash2,
} from "lucide-react";
import { type CSSProperties, type ReactNode, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  ProjectTile,
  panelRowActionClass,
} from "@/components/context-panel/panel-primitives";
import FavoriteButton from "@/components/favorite/favorite-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
import { isProjectFeatureEnabled } from "@/constants/project-features";
import useDeleteProject from "@/hooks/mutations/project/use-delete-project";
import useReorderProjects from "@/hooks/mutations/project/use-reorder-projects";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { cn } from "@/lib/cn";
import {
  getVisibleProjectSections,
  type ProjectSection,
  projectSectionPath,
  resolveActiveSection,
} from "@/lib/project-sections";
import { toast } from "@/lib/toast";
import CreateProjectModal from "./shared/modals/create-project-modal";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { Button } from "./ui/button";

type ProjectListItem = {
  id: string;
  name: string;
  icon?: string | null;
  slug?: string | null;
};

function SortableProjectItem({
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
      // The reorder already moves the row; animating the index change too
      // replays the same move from a stale offset.
      animateLayoutChanges: () => false,
      // dnd-kit defaults to `ease`; this is the app's curve.
      transition: { duration: 200, easing: "var(--ease-out)" },
    });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    // `listeners` without `attributes`: the latter puts role="button" and a tab
    // stop on the row, wrapping the link and the dropdown inside it.
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

function SectionBadge({
  section,
  projectId,
  workspaceId,
}: {
  section: ProjectSection & {
    useBadge: NonNullable<ProjectSection["useBadge"]>;
  };
  projectId: string;
  workspaceId: string;
}) {
  const { t } = useTranslation();
  const count = section.useBadge({ projectId, workspaceId });
  if (!count) return null;
  const className =
    "ms-auto rounded-full bg-sidebar-accent px-1.5 font-medium text-[11px] text-sidebar-accent-foreground tabular-nums";
  if (!section.badgeAriaKey) return <span className={className}>{count}</span>;
  return (
    <span
      role="img"
      aria-label={t(section.badgeAriaKey, { count })}
      className={className}
    >
      {count}
    </span>
  );
}

/** A project's sections (feature-gated), nested under its row. */
function ProjectSectionRows({
  project,
  workspaceId,
  sections,
}: {
  project: ProjectListItem;
  workspaceId: string;
  sections: readonly ProjectSection[];
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const isCurrent = pathname.includes(`/project/${project.id}`);
  const activeSection = isCurrent ? resolveActiveSection(pathname) : null;

  return (
    <SidebarMenu className="pt-px pb-1">
      {sections.map((section) => {
        const Icon = section.icon;
        return (
          <SidebarMenuItem key={section.id}>
            <SidebarMenuButton
              isActive={activeSection === section.id}
              className="h-7 ps-7"
              onClick={() =>
                navigate({
                  to: projectSectionPath(section, workspaceId, project.id),
                })
              }
            >
              <Icon className="size-3.5 opacity-70" />
              <span>{t(section.labelKey)}</span>
              {section.useBadge && (
                <SectionBadge
                  section={{ ...section, useBadge: section.useBadge }}
                  projectId={project.id}
                  workspaceId={workspaceId}
                />
              )}
            </SidebarMenuButton>
          </SidebarMenuItem>
        );
      })}
    </SidebarMenu>
  );
}

type NavProjectsProps = {
  /** Shows only projects whose name contains this text. */
  filter?: string;
};

/**
 * The context panel's project tree: each project expands to its sections
 * (only the features turned on for it), and rows reorder by drag.
 */
export function NavProjects({ filter = "" }: NavProjectsProps) {
  const { t } = useTranslation();
  const isDrawer = useOptionalSidebar()?.isMobile ?? false;
  const { data: workspace } = useActiveWorkspace();
  const { data: projects } = useGetProjects({
    workspaceId: workspace?.id || "",
  });
  const queryClient = useQueryClient();
  const { mutateAsync: deleteProject } = useDeleteProject();
  const reorderProjects = useReorderProjects();
  const {
    canCreateProjects,
    canDeleteProjects,
    canUpdateProjects,
    canShareProjects,
    canReadAnalytics,
    isCheckingPermissions,
  } = useWorkspacePermission();
  const canCreate = canCreateProjects();
  const canDeleteProject = canDeleteProjects();
  // Hidden until the server check answers, so it never flashes.
  const canPublish = !isCheckingPermissions && canShareProjects();
  const canReadAnalyticsNow = !isCheckingPermissions && canReadAnalytics();
  // Matches the API, which gates /project/reorder on `project: ["update"]`
  // alone — not the create+update+delete bundle.
  const canReorder = canUpdateProjects() && !filter;
  const navigate = useNavigate();
  const { workspaceId: currentWorkspaceId, projectId: currentProjectId } =
    useParams({
      strict: false,
    });

  const [isCreateProjectModalOpen, setIsCreateProjectModalOpen] =
    useState(false);
  const [isDeleteProjectModalOpen, setIsDeleteProjectModalOpen] =
    useState(false);
  const [projectToDeleteId, setProjectToDeleteID] = useState<string | null>(
    null,
  );
  const [draggingProjectId, setDraggingProjectId] = useState<string | null>(
    null,
  );
  // Rows the person opened or closed by hand; the current project is open
  // unless closed.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});

  const draggingProject = projects?.find(
    (project) => project.id === draggingProjectId,
  );

  const isCurrentProject = (projectId: string) => {
    return (
      currentProjectId === projectId && currentWorkspaceId === workspace?.id
    );
  };

  const isExpanded = (projectId: string) =>
    toggled[projectId] ?? isCurrentProject(projectId);

  const handleProjectClick = (project: ProjectListItem) => {
    navigate({
      to: "/dashboard/workspace/$workspaceId/project/$projectId/board",
      params: {
        workspaceId: workspace?.id || "",
        projectId: project.id,
      },
    });
  };

  // Below these thresholds the row is still a link and the panel still
  // scrolls; above them the gesture becomes a drag.
  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 8 },
    }),
  );

  const handleDragStart = (event: DragStartEvent) => {
    document.body.classList.add("margaya-dragging");
    setDraggingProjectId(String(event.active.id));
  };

  const endDrag = () => {
    document.body.classList.remove("margaya-dragging");
    setDraggingProjectId(null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    endDrag();

    if (!over || active.id === over.id || !projects || !workspace) return;

    const oldIndex = projects.findIndex((project) => project.id === active.id);
    const newIndex = projects.findIndex((project) => project.id === over.id);

    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(projects, oldIndex, newIndex);

    reorderProjects(workspace.id, reordered, {
      onError: () => {
        toast.error(t("workspace:projects.reorderError"));
      },
    });
  };

  if (!workspace) return null;

  const needle = filter.trim().toLowerCase();
  const visibleProjects = (projects ?? []).filter(
    (project) => !needle || project.name.toLowerCase().includes(needle),
  );

  return (
    <>
      <SidebarGroup className="gap-0.5 px-2 py-1">
        <div className="flex items-center justify-between">
          <SidebarGroupLabel>
            {t("navigation:sidebar.projects")}
          </SidebarGroupLabel>
          {canCreate && (
            <button
              type="button"
              aria-label={t("navigation:projectList.addProject")}
              title={t("navigation:projectList.addProject")}
              onClick={() => setIsCreateProjectModalOpen(true)}
              className="flex size-6 items-center justify-center rounded-md text-sidebar-foreground outline-hidden hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
            >
              <Plus className="size-3.5" />
            </button>
          )}
        </div>
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
                items={visibleProjects.map((project) => project.id)}
                strategy={verticalListSortingStrategy}
              >
                {visibleProjects.map((project) => {
                  const expanded = isExpanded(project.id);
                  const sections = getVisibleProjectSections(
                    (feature) => isProjectFeatureEnabled(project, feature),
                    undefined,
                    (capability) =>
                      capability === "readAnalytics" && canReadAnalyticsNow,
                  );
                  return (
                    <SortableProjectItem
                      key={project.id}
                      id={project.id}
                      canReorder={canReorder}
                    >
                      <SidebarMenuButton
                        isActive={
                          isCurrentProject(project.id) &&
                          !(expanded && sections.length > 1)
                        }
                        className="ps-7 pe-7 font-medium"
                        onClick={() => handleProjectClick(project)}
                      >
                        <ProjectTile icon={project.icon} />
                        <span>{project.name}</span>
                      </SidebarMenuButton>
                      {sections.length > 1 && (
                        <button
                          type="button"
                          aria-expanded={expanded}
                          aria-label={t("navigation:projectNav.sections")}
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={() =>
                            setToggled((current) => ({
                              ...current,
                              [project.id]: !expanded,
                            }))
                          }
                          className="absolute top-1 left-1 flex size-5.5 items-center justify-center rounded-md text-sidebar-foreground/70 outline-hidden hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
                        >
                          <ChevronRight
                            className={cn(
                              "size-3.5 transition-transform duration-150",
                              expanded && "rotate-90",
                            )}
                          />
                        </button>
                      )}

                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <button
                              type="button"
                              // The row is the drag source; this press
                              // must not reach it.
                              onPointerDown={(event) => event.stopPropagation()}
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
                          side={isDrawer ? "bottom" : "right"}
                          align={isDrawer ? "end" : "start"}
                        >
                          <DropdownMenuItem
                            className="h-7 cursor-pointer items-start text-sm"
                            onClick={() => handleProjectClick(project)}
                          >
                            <Folder className="text-muted-foreground" />
                            <span>
                              {t("navigation:projectList.viewProject")}
                            </span>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="h-7 cursor-pointer items-start text-sm"
                            onClick={() => {
                              navigator.clipboard.writeText(
                                `${window.location.origin}/dashboard/workspace/${workspace?.id}/project/${project.id}`,
                              );
                              toast.success(
                                t("navigation:projectList.linkCopied"),
                              );
                            }}
                          >
                            <Forward className="text-muted-foreground" />
                            <span>
                              {t("navigation:projectList.shareProject")}
                            </span>
                          </DropdownMenuItem>
                          <FavoriteButton
                            variant="menu-item"
                            workspaceId={workspace.id}
                            entityType="project"
                            entityId={project.id}
                            placeholder={{
                              name: project.name,
                              icon: project.icon,
                              key: project.slug,
                            }}
                          />
                          <DropdownMenuItem
                            className="h-7 cursor-pointer items-start text-sm"
                            onClick={() => {
                              navigate({
                                to: "/dashboard/settings/projects/$projectId/general",
                                params: { projectId: project.id },
                              });
                            }}
                          >
                            <Settings className="text-muted-foreground" />
                            <span>
                              {t("navigation:projectList.projectSettings")}
                            </span>
                          </DropdownMenuItem>
                          {canPublish && (
                            <DropdownMenuItem
                              className="h-7 cursor-pointer items-start text-sm"
                              onClick={() => {
                                navigate({
                                  to: "/dashboard/settings/projects/$projectId/visibility",
                                  params: { projectId: project.id },
                                });
                              }}
                            >
                              <Globe className="text-muted-foreground" />
                              <span>{t("navigation:projectMenu.publish")}</span>
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            className="h-7 cursor-pointer items-start text-sm"
                            onClick={() => {
                              navigate({
                                to: "/dashboard/workspace/$workspaceId/project/$projectId/archives",
                                params: {
                                  workspaceId: workspace.id,
                                  projectId: project.id,
                                },
                              });
                            }}
                          >
                            <Archive className="text-muted-foreground" />
                            <span>{t("navigation:projectList.archives")}</span>
                          </DropdownMenuItem>
                          {canDeleteProject && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="h-7 cursor-pointer items-start text-destructive text-sm"
                                onClick={() => {
                                  setProjectToDeleteID(project.id);
                                  setIsDeleteProjectModalOpen(true);
                                }}
                              >
                                <Trash2 className="text-destructive" />
                                <span>
                                  {t("navigation:projectList.deleteProject")}
                                </span>
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>

                      {expanded && sections.length > 1 && (
                        <ProjectSectionRows
                          project={project}
                          workspaceId={workspace.id}
                          sections={sections}
                        />
                      )}
                    </SortableProjectItem>
                  );
                })}
              </SortableContext>

              {canCreate && !needle && (projects?.length ?? 0) === 0 && (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    onClick={() => setIsCreateProjectModalOpen(true)}
                  >
                    <Plus className="size-3.5" />
                    <span>{t("navigation:projectList.addProject")}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
            </SidebarMenu>

            {/* Portalled: the panel body scrolls and would clip it. */}
            {createPortal(
              <DragOverlay dropAnimation={null}>
                {draggingProject ? (
                  <div className="flex h-7.5 w-56 items-center gap-2 rounded-md border bg-card not-dark:bg-clip-padding ps-7 pe-2 text-[13px] text-sidebar-accent-foreground shadow-lg/5">
                    <ProjectTile icon={draggingProject.icon} />
                    <span className="truncate">{draggingProject.name}</span>
                  </div>
                ) : null}
              </DragOverlay>,
              document.body,
            )}
          </DndContext>
        </SidebarGroupContent>
      </SidebarGroup>

      <CreateProjectModal
        open={isCreateProjectModalOpen}
        onClose={() => setIsCreateProjectModalOpen(false)}
      />

      <AlertDialog
        open={isDeleteProjectModalOpen}
        onOpenChange={setIsDeleteProjectModalOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("navigation:projectList.deleteConfirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("navigation:projectList.deleteConfirmDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" size="sm" />}>
              {t("common:actions.cancel")}
            </AlertDialogClose>
            <AlertDialogClose
              render={
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={async () => {
                    await deleteProject({
                      id: projectToDeleteId || "",
                    });
                    toast.success(t("navigation:projectList.deletedToast"));
                    queryClient.invalidateQueries({
                      queryKey: ["projects"],
                    });
                    navigate({
                      to: "/dashboard/workspace/$workspaceId",
                      params: {
                        workspaceId: workspace?.id || "",
                      },
                    });
                  }}
                />
              }
            >
              {t("navigation:projectList.deleteProject")}
            </AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
