import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { useQueryClient } from "@tanstack/react-query";
import {
  createFileRoute,
  useNavigate,
  useParams,
} from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import ArchiveProjectSetting from "@/components/archives/archive-project-setting";
import ProjectAccessSettings from "@/components/project/project-access-settings";
import ProjectPeopleSettings from "@/components/project/project-people-settings";
import { TasksImportExport } from "@/components/project/tasks-import-export.tsx";
import {
  SettingsDangerZone,
  SettingsGroup,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from "@/components/settings-layout";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import icons from "@/constants/project-icons";
import useDeleteProject from "@/hooks/mutations/project/use-delete-project";
import useUpdateProject from "@/hooks/mutations/project/use-update-project";
import { useGetTasks } from "@/hooks/queries/task/use-get-tasks";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { cn } from "@/lib/cn";
import { createSaveEchoGuard, sameFormValues } from "@/lib/form-autosave";
import { HttpError } from "@/lib/http-error";
import { toast } from "@/lib/toast";
import useProjectStore from "@/store/project.ts";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/projects/$projectId/general",
)({
  component: RouteComponent,
});

type ProjectFormValues = {
  name: string;
  slug: string;
  description?: string;
  icon: string;
};

type NormalizedProjectValues = {
  name: string;
  slug: string;
  description: string;
  icon: string;
};

function normalizeProjectValues(
  data: ProjectFormValues,
): NormalizedProjectValues {
  return {
    name: data.name.trim(),
    slug: data.slug.trim(),
    description: (data.description ?? "").trim(),
    icon: data.icon || "Layout",
  };
}

type ServerProject = {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  icon?: string | null;
  isPublic?: boolean | null;
};

function projectFormValues(project: ServerProject): NormalizedProjectValues {
  return normalizeProjectValues({
    name: project.name || "",
    slug: project.slug || "",
    description: project.description || "",
    icon: project.icon || "Layout",
  });
}

function RouteComponent() {
  const { t } = useTranslation();
  const projectSchema = useMemo(
    () =>
      z.object({
        name: z
          .string()
          .trim()
          .min(1, t("settings:projectGeneral.validation.nameRequired")),
        slug: z
          .string()
          .trim()
          .min(1, t("settings:projectGeneral.validation.keyRequired"))
          .max(8, t("settings:projectGeneral.validation.keyMax")),
        description: z.string().optional(),
        icon: z
          .string()
          .min(1, t("settings:projectGeneral.validation.iconRequired")),
      }),
    [t],
  );

  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isSavingRef = useRef(false);
  const queuedSaveRef = useRef<ProjectFormValues | null>(null);
  const lastSavedRef = useRef<NormalizedProjectValues | null>(null);
  // The latest project state the server returned; every save starts from it.
  const serverProjectRef = useRef<ServerProject | null>(null);
  const [echoGuard] = useState(() =>
    createSaveEchoGuard<NormalizedProjectValues>(),
  );
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [iconPopoverOpen, setIconPopoverOpen] = useState(false);
  const [iconSearch, setIconSearch] = useState("");

  const { data: workspace } = useActiveWorkspace();
  const { projectId: rawProjectId } = useParams({ strict: false });
  const projectId = rawProjectId ?? "";
  const { data: fetchedProject } = useGetTasks(projectId);
  const { project: storedProject, setProject } = useProjectStore();
  // The store can still hold the previously opened project.
  const project =
    fetchedProject ??
    (storedProject?.id === projectId ? storedProject : undefined);

  useEffect(() => {
    if (fetchedProject) {
      setProject(fetchedProject);
    }
  }, [fetchedProject, setProject]);

  const { mutateAsync: updateProject } = useUpdateProject();
  const { mutateAsync: deleteProject, isPending: isDeleting } =
    useDeleteProject();
  const { canManageProjects, canDeleteProjects, canUpdateProjects } =
    useWorkspacePermission();
  const canEdit = canManageProjects();
  const canDelete = canDeleteProjects();
  const canArchive = canUpdateProjects();

  const projectForm = useForm<ProjectFormValues>({
    resolver: standardSchemaResolver(projectSchema),
    mode: "onChange",
    defaultValues: {
      name: project?.name || "",
      slug: project?.slug || "",
      description: project?.description || "",
      icon: project?.icon || "Layout",
    },
  });

  useEffect(() => {
    if (!project) return;

    const serverValues = projectFormValues(project);
    if (!echoGuard.accepts(serverValues)) return;

    serverProjectRef.current = project;
    const previous = lastSavedRef.current;
    lastSavedRef.current = serverValues;

    // Keep edits that haven't been saved yet.
    const current = normalizeProjectValues(projectForm.getValues());
    if (previous && !sameFormValues(current, previous)) return;

    projectForm.reset(serverValues, {
      keepDirty: false,
      keepTouched: false,
      keepIsValid: true,
    });
  }, [project, projectForm, echoGuard]);

  const saveProject = useCallback(
    async (data: ProjectFormValues) => {
      const server = serverProjectRef.current;
      if (!server || server.id !== projectId) return;

      const normalizedData = normalizeProjectValues(data);
      const nameChanged = lastSavedRef.current?.name !== normalizedData.name;
      const slugChanged = lastSavedRef.current?.slug !== normalizedData.slug;
      const descriptionChanged =
        lastSavedRef.current?.description !== normalizedData.description;
      const iconChanged = lastSavedRef.current?.icon !== normalizedData.icon;
      const hasChanges =
        nameChanged || slugChanged || descriptionChanged || iconChanged;

      if (!hasChanges) return;

      if (isSavingRef.current) {
        queuedSaveRef.current = data;
        return;
      }

      isSavingRef.current = true;

      try {
        const updatePayload = {
          id: server.id,
          name: nameChanged ? normalizedData.name : server.name,
          slug: slugChanged ? normalizedData.slug : server.slug,
          description: descriptionChanged
            ? normalizedData.description
            : (server.description ?? ""),
          icon: iconChanged ? normalizedData.icon : (server.icon ?? "Layout"),
          isPublic: !!server.isPublic,
        };

        const saved = await updateProject(updatePayload);
        const savedValues = projectFormValues(saved);
        serverProjectRef.current = saved;
        lastSavedRef.current = savedValues;
        echoGuard.expect(savedValues);
        queuedSaveRef.current = null;

        // Leave anything typed while the request was in flight alone.
        const current = normalizeProjectValues(projectForm.getValues());
        if (sameFormValues(current, normalizedData)) {
          projectForm.reset(savedValues, { keepDirty: false });
        }

        toast.success(t("settings:projectGeneral.toastUpdated"));
      } catch (error) {
        // Keys are unique per workspace; show the conflict on the field.
        if (error instanceof HttpError && error.status === 409) {
          projectForm.setError("slug", {
            type: "server",
            message: t("settings:projectGeneral.validation.keyTaken", {
              key: normalizedData.slug.toUpperCase(),
            }),
          });
          return;
        }
        toast.error(
          error instanceof Error
            ? error.message
            : t("settings:projectGeneral.toastUpdateError"),
        );
      } finally {
        isSavingRef.current = false;

        if (queuedSaveRef.current) {
          const queuedData = queuedSaveRef.current;
          queuedSaveRef.current = null;
          await saveProject(queuedData);
        }
      }
    },
    [projectId, updateProject, projectForm, echoGuard, t],
  );

  const saveProjectRef = useRef(saveProject);
  const projectFormRef = useRef(projectForm);
  saveProjectRef.current = saveProject;
  projectFormRef.current = projectForm;

  const debouncedSave = useCallback(() => {
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }

    debounceTimeoutRef.current = setTimeout(async () => {
      const isValid = await projectForm.trigger();
      if (isValid) {
        // Always save latest values to avoid staleness while typing
        const latest = projectForm.getValues();
        saveProject(latest as ProjectFormValues);
      }
    }, 800);
  }, [projectForm, saveProject]);

  useEffect(() => {
    if (!canEdit) return;
    // Do not gate on formState.isDirty here: after setValue (e.g. icon pick), the
    // watch callback can run before RHF updates isDirty, so the debounced save never runs.
    const subscription = projectForm.watch(() => {
      debouncedSave();
    });

    return () => subscription.unsubscribe();
  }, [projectForm, debouncedSave, canEdit]);

  useEffect(() => {
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
        debounceTimeoutRef.current = null;
      }
      // Flush pending edits if the user navigates away before the debounce fires.
      void (async () => {
        const latest = projectFormRef.current.getValues() as ProjectFormValues;
        const normalized = normalizeProjectValues(latest);
        const last = lastSavedRef.current;
        const hasPendingChanges =
          !last ||
          last.name !== normalized.name ||
          last.slug !== normalized.slug ||
          last.description !== normalized.description ||
          last.icon !== normalized.icon;
        if (!hasPendingChanges) return;

        const isValid = await projectFormRef.current.trigger();
        if (isValid) {
          await saveProjectRef.current(latest);
        }
      })();
    };
  }, []);

  const handleDeleteProject = useCallback(async () => {
    if (!project?.id) return;

    try {
      await deleteProject({ id: project.id });
      toast.success(t("settings:projectGeneral.toastDeleted"));

      await queryClient.invalidateQueries({ queryKey: ["projects"] });

      navigate({
        to: "/dashboard/workspace/$workspaceId",
        params: { workspaceId: workspace?.id || "" },
      });
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("settings:projectGeneral.toastDeleteError"),
      );
    }
  }, [project?.id, deleteProject, queryClient, navigate, workspace?.id, t]);

  return (
    <SettingsPage
      title={t("settings:projectGeneral.title")}
      documentTitle={
        project?.name
          ? `${t("settings:projectGeneral.pageTitle")} · ${project.name}`
          : t("settings:projectGeneral.pageTitle")
      }
      description={t("settings:projectGeneral.subtitle")}
    >
      <SettingsSection
        title={t("settings:projectGeneral.projectInfoTitle")}
        description={t("settings:projectGeneral.projectInfoSubtitle")}
      >
        <Form {...projectForm}>
          <form onSubmit={(event) => event.preventDefault()}>
            <SettingsGroup>
              <SettingsRow
                label={t("settings:projectGeneral.iconLabel")}
                description={t("settings:projectGeneral.iconHint")}
              >
                <Popover
                  open={iconPopoverOpen}
                  onOpenChange={(open) => {
                    setIconPopoverOpen(open);
                    if (!open) setIconSearch("");
                  }}
                  modal={true}
                >
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 w-auto justify-start gap-2 font-normal"
                      title={t("settings:projectGeneral.pickIconTitle")}
                      disabled={!canEdit}
                    >
                      {(() => {
                        const selectedKey =
                          (projectForm.watch("icon") as keyof typeof icons) ||
                          "Layout";
                        const SelectedIcon = icons[selectedKey] || icons.Layout;
                        return <SelectedIcon className="h-4 w-4" />;
                      })()}
                      <span className="truncate text-xs">
                        {projectForm.watch("icon") || "Layout"}
                      </span>
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-80" align="end">
                    <div className="space-y-2">
                      <Input
                        value={iconSearch}
                        onChange={(e) => setIconSearch(e.target.value)}
                        placeholder={t(
                          "settings:projectGeneral.searchIconsPlaceholder",
                        )}
                        className="h-8 text-xs"
                      />
                      <div className="max-h-[280px] overflow-y-auto pr-1">
                        <div className="grid grid-cols-6 gap-1.5">
                          {Object.entries(icons)
                            .filter(([iconName]) =>
                              iconName
                                .toLowerCase()
                                .includes(iconSearch.trim().toLowerCase()),
                            )
                            .map(([iconName, Icon]) => {
                              const isSelected =
                                projectForm.getValues("icon") === iconName;
                              return (
                                <Button
                                  key={iconName}
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    projectForm.setValue("icon", iconName, {
                                      shouldDirty: true,
                                      shouldValidate: true,
                                    });
                                    setIconPopoverOpen(false);
                                    setIconSearch("");
                                  }}
                                  className={cn(
                                    "h-10 items-center justify-center rounded-md p-0",
                                    isSelected &&
                                      "bg-sidebar-accent text-sidebar-accent-foreground",
                                  )}
                                  title={iconName}
                                >
                                  <Icon className="h-4 w-4" />
                                </Button>
                              );
                            })}
                        </div>
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
              </SettingsRow>
              <FormField
                control={projectForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem className="space-y-0">
                    <SettingsRow
                      label={
                        <FormLabel className="text-sm font-medium">
                          {t("settings:projectGeneral.projectNameLabel")}
                        </FormLabel>
                      }
                      description={t("settings:projectGeneral.projectNameHint")}
                    >
                      <div className="w-full space-y-1.5 sm:w-64">
                        <FormControl>
                          <Input
                            placeholder={t(
                              "settings:projectGeneral.projectNamePlaceholder",
                            )}
                            disabled={!canEdit}
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </div>
                    </SettingsRow>
                  </FormItem>
                )}
              />

              <FormField
                control={projectForm.control}
                name="slug"
                render={({ field }) => (
                  <FormItem className="space-y-0">
                    <SettingsRow
                      label={
                        <FormLabel className="text-sm font-medium">
                          {t("settings:projectGeneral.keyLabel")}
                        </FormLabel>
                      }
                      description={t("settings:projectGeneral.keyHint", {
                        slug: projectForm.watch("slug") || "ABC",
                      })}
                    >
                      <div className="w-full space-y-1.5 sm:w-64">
                        <FormControl>
                          <Input
                            placeholder={t(
                              "settings:projectGeneral.keyPlaceholder",
                            )}
                            disabled={!canEdit}
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </div>
                    </SettingsRow>
                  </FormItem>
                )}
              />

              <FormField
                control={projectForm.control}
                name="description"
                render={({ field }) => (
                  <FormItem className="space-y-0">
                    <SettingsRow
                      label={
                        <FormLabel className="text-sm font-medium">
                          {t("settings:projectGeneral.descriptionLabel")}
                        </FormLabel>
                      }
                      description={t("settings:projectGeneral.descriptionHint")}
                    >
                      <div className="w-full space-y-1.5 sm:w-64">
                        <FormControl>
                          <Input
                            placeholder={t(
                              "settings:projectGeneral.descriptionPlaceholder",
                            )}
                            disabled={!canEdit}
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </div>
                    </SettingsRow>
                  </FormItem>
                )}
              />
            </SettingsGroup>
          </form>
        </Form>
      </SettingsSection>

      {workspace?.id && (
        <ProjectPeopleSettings
          workspaceId={workspace.id}
          projectId={projectId}
          canEdit={canEdit}
        />
      )}

      {workspace?.id && (
        <ProjectAccessSettings
          workspaceId={workspace.id}
          projectId={projectId}
        />
      )}

      <SettingsSection title={t("settings:projectGeneral.dataTitle")}>
        <SettingsGroup>
          <SettingsRow
            label={t("settings:projectGeneral.importExportTasks")}
            description={t(
              "settings:projectGeneral.importExportTasksDescription",
            )}
          >
            {project && <TasksImportExport project={project} />}
          </SettingsRow>
        </SettingsGroup>
      </SettingsSection>

      {(canDelete || canArchive) && (
        <SettingsDangerZone
          title={t("settings:projectGeneral.dangerZone")}
          description={t("settings:projectGeneral.dangerZoneSubtitle")}
        >
          {canArchive && workspace?.id && (
            <div className="px-4 py-3">
              <ArchiveProjectSetting
                projectId={projectId}
                workspaceId={workspace.id}
              />
            </div>
          )}
          {canDelete && (
            <SettingsRow
              label={t("settings:projectGeneral.deleteProject")}
              description={t(
                "settings:projectGeneral.deleteProjectDescription",
              )}
            >
              <Button
                variant="destructive-outline"
                size="sm"
                type="button"
                onClick={() => setIsDeleteModalOpen(true)}
                disabled={!project}
              >
                {t("settings:projectGeneral.deleteProject")}
              </Button>
            </SettingsRow>
          )}
        </SettingsDangerZone>
      )}

      <AlertDialog open={isDeleteModalOpen} onOpenChange={setIsDeleteModalOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("settings:projectGeneral.deleteModalTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("settings:projectGeneral.deleteModalDescription", {
                name: project?.name ?? "",
              })}
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
                  disabled={isDeleting}
                  onClick={handleDeleteProject}
                />
              }
            >
              {isDeleting
                ? t("common:actions.deleting")
                : t("settings:projectGeneral.deleteModalConfirm")}
            </AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsPage>
  );
}
