import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import useAuth from "@/components/providers/auth-provider/hooks/use-auth";
import WorkspaceA2aSetting from "@/components/settings/workspace-a2a-setting";
import WorkspacePublicPagesSetting from "@/components/settings/workspace-public-pages-setting";
import WorkspaceTimezoneSetting from "@/components/settings/workspace-timezone-setting";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LeaveWorkspaceRow } from "@/components/workspace/leave-workspace-row";
import WorkspaceDeletionRow from "@/components/workspace/workspace-deletion-row";
import useTransferWorkspaceOwnership from "@/hooks/mutations/workspace/use-transfer-workspace-ownership";
import useUpdateWorkspace from "@/hooks/mutations/workspace/use-update-workspace";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import useGetFullWorkspace from "@/hooks/queries/workspace/use-get-full-workspace";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { createSaveEchoGuard, sameFormValues } from "@/lib/form-autosave";
import { toast } from "@/lib/toast";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/workspace/general",
)({
  component: RouteComponent,
});

type WorkspaceFormValues = {
  name: string;
  description?: string;
};

type NormalizedWorkspaceValues = {
  name: string;
  description: string;
};

function normalizeWorkspaceValues(
  data: WorkspaceFormValues,
): NormalizedWorkspaceValues {
  return {
    name: data.name.trim(),
    description: (data.description ?? "").trim(),
  };
}

/** Better Auth persists description as an organization additional field (DB column), not only inside metadata. */
function getWorkspaceDescription(
  workspace:
    | { description?: string | null; metadata?: unknown }
    | null
    | undefined,
): string {
  if (!workspace) return "";
  if (typeof workspace.description === "string") {
    return workspace.description;
  }
  if (
    typeof workspace.metadata === "object" &&
    workspace.metadata &&
    "description" in workspace.metadata
  ) {
    return String(
      (workspace.metadata as { description?: unknown }).description ?? "",
    );
  }
  return "";
}

function RouteComponent() {
  const { t } = useTranslation();
  const workspaceSchema = useMemo(
    () =>
      z.object({
        name: z
          .string()
          .min(1, t("settings:workspaceGeneral.validation.nameRequired"))
          .min(2, t("settings:workspaceGeneral.validation.nameShort")),
        description: z.string().optional(),
      }),
    [t],
  );

  const queryClient = useQueryClient();
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isSavingRef = useRef(false);
  const queuedSaveRef = useRef<WorkspaceFormValues | null>(null);
  const lastSavedRef = useRef<NormalizedWorkspaceValues | null>(null);
  const [echoGuard] = useState(() =>
    createSaveEchoGuard<NormalizedWorkspaceValues>(),
  );
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [selectedNewOwnerId, setSelectedNewOwnerId] = useState<string>("");

  const { user: currentUser } = useAuth();
  const { data: workspace } = useActiveWorkspace();
  const { data: fullWorkspace } = useGetFullWorkspace({
    workspaceId: workspace?.id,
  });
  const { mutateAsync: updateWorkspace } = useUpdateWorkspace();
  const { mutateAsync: transferOwnership, isPending: isTransferring } =
    useTransferWorkspaceOwnership();
  const { canManageWorkspace, canDeleteWorkspace, isOwner } =
    useWorkspacePermission();
  const canEdit = canManageWorkspace();
  const canDelete = canDeleteWorkspace();
  const workspaceDescription = getWorkspaceDescription(workspace);

  // Ownership transfer is owner-only. Eligible recipients are any current
  // member who isn't the owner themselves.
  const members = fullWorkspace?.members ?? [];
  const currentOwnerMember = members.find((m) => m.role === "owner");
  const eligibleNewOwners = members.filter(
    (m) => m.role !== "owner" && m.userId !== currentUser?.id,
  );
  const selectedMember = eligibleNewOwners.find(
    (m) => m.id === selectedNewOwnerId,
  );

  const workspaceForm = useForm<WorkspaceFormValues>({
    resolver: standardSchemaResolver(workspaceSchema),
    mode: "onChange",
    defaultValues: {
      name: workspace?.name || "",
      description: workspaceDescription,
    },
  });

  useEffect(() => {
    if (!workspace) return;

    const serverValues = normalizeWorkspaceValues({
      name: workspace.name || "",
      description: workspaceDescription,
    });
    // A response requested before the last save can arrive after it.
    if (!echoGuard.accepts(serverValues)) return;

    const previous = lastSavedRef.current;
    lastSavedRef.current = serverValues;

    // Keep edits that haven't been saved yet.
    const current = normalizeWorkspaceValues(workspaceForm.getValues());
    if (previous && !sameFormValues(current, previous)) return;

    workspaceForm.reset(serverValues);
  }, [workspace, workspaceDescription, workspaceForm, echoGuard]);

  const saveWorkspace = useCallback(
    async (data: WorkspaceFormValues) => {
      if (!workspace?.id) return;

      const normalizedData = normalizeWorkspaceValues(data);
      const nameChanged = lastSavedRef.current?.name !== normalizedData.name;
      const descriptionChanged =
        lastSavedRef.current?.description !== normalizedData.description;
      const hasChanges = nameChanged || descriptionChanged;

      if (!hasChanges) return;

      if (isSavingRef.current) {
        queuedSaveRef.current = data;
        return;
      }

      isSavingRef.current = true;

      try {
        const updatePayload: {
          workspaceId: string;
          name?: string;
          description?: string;
        } = {
          workspaceId: workspace.id,
        };

        if (nameChanged) {
          updatePayload.name = normalizedData.name;
        }

        if (descriptionChanged) {
          updatePayload.description = normalizedData.description;
        }

        await updateWorkspace(updatePayload);

        lastSavedRef.current = normalizedData;
        echoGuard.expect(normalizedData);
        queuedSaveRef.current = null;

        // Leave anything typed while the request was in flight alone.
        const current = normalizeWorkspaceValues(workspaceForm.getValues());
        if (sameFormValues(current, normalizedData)) {
          workspaceForm.reset(normalizedData, { keepDirty: false });
        }

        await queryClient.invalidateQueries({
          queryKey: ["active-organization"],
        });
        toast.success(t("settings:workspaceGeneral.toastUpdated"));
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : t("settings:workspaceGeneral.toastUpdateError"),
        );
      } finally {
        isSavingRef.current = false;

        if (queuedSaveRef.current) {
          const queuedData = queuedSaveRef.current;
          queuedSaveRef.current = null;
          await saveWorkspace(queuedData);
        }
      }
    },
    [workspace, updateWorkspace, queryClient, workspaceForm, echoGuard, t],
  );

  const handleTransferOwnership = useCallback(async () => {
    if (!workspace?.id || !currentOwnerMember || !selectedMember) return;

    try {
      await transferOwnership({
        workspaceId: workspace.id,
        newOwnerMemberId: selectedMember.id,
        currentOwnerMemberId: currentOwnerMember.id,
      });
      toast.success(
        t("settings:workspaceGeneral.transferOwnership.toastSuccess", {
          defaultValue: "Ownership transferred",
        }),
      );
      setIsTransferModalOpen(false);
      setSelectedNewOwnerId("");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("settings:workspaceGeneral.transferOwnership.toastError", {
              defaultValue: "Failed to transfer ownership",
            }),
      );
    }
  }, [workspace?.id, currentOwnerMember, selectedMember, transferOwnership, t]);

  const debouncedSave = useCallback(() => {
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }

    debounceTimeoutRef.current = setTimeout(async () => {
      if (await workspaceForm.trigger()) {
        saveWorkspace(workspaceForm.getValues());
      }
    }, 1000);
  }, [workspaceForm, saveWorkspace]);

  useEffect(() => {
    if (!canEdit) return;
    // Don't gate on formState.isDirty/isValid here: the watch callback runs
    // before react-hook-form updates them, which drops one-step edits (paste).
    // saveWorkspace skips values that match the last save.
    const subscription = workspaceForm.watch(() => {
      debouncedSave();
    });

    return () => subscription.unsubscribe();
  }, [workspaceForm, debouncedSave, canEdit]);

  useEffect(() => {
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, []);

  return (
    <SettingsPage
      title={t("settings:workspaceGeneral.title")}
      documentTitle={t("settings:workspaceGeneral.pageTitle")}
      description={t("settings:workspaceGeneral.subtitle")}
    >
      <SettingsSection
        title={t("settings:workspaceGeneral.workspaceInfoTitle")}
        description={t("settings:workspaceGeneral.workspaceInfoSubtitle")}
      >
        <Form {...workspaceForm}>
          <form onSubmit={(event) => event.preventDefault()}>
            <SettingsGroup>
              <FormField
                control={workspaceForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem className="space-y-0">
                    <SettingsRow
                      label={
                        <FormLabel className="text-sm font-medium">
                          {t("settings:workspaceGeneral.nameLabel")}
                        </FormLabel>
                      }
                      description={t("settings:workspaceGeneral.nameHint")}
                    >
                      <div className="w-full space-y-1.5 sm:w-64">
                        <FormControl>
                          <Input
                            placeholder={t(
                              "settings:workspaceGeneral.namePlaceholder",
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
                control={workspaceForm.control}
                name="description"
                render={({ field }) => (
                  <FormItem className="space-y-0">
                    <SettingsRow
                      label={
                        <FormLabel className="text-sm font-medium">
                          {t("settings:workspaceGeneral.descriptionLabel")}
                        </FormLabel>
                      }
                      description={t(
                        "settings:workspaceGeneral.descriptionHint",
                      )}
                    >
                      <div className="w-full space-y-1.5 sm:w-64">
                        <FormControl>
                          <Input
                            placeholder={t(
                              "settings:workspaceGeneral.descriptionPlaceholder",
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
              {workspace?.id && (
                <WorkspaceTimezoneSetting
                  workspaceId={workspace.id}
                  canEdit={canEdit}
                />
              )}
              {workspace?.id && (
                <WorkspacePublicPagesSetting
                  workspaceId={workspace.id}
                  canEdit={canEdit}
                />
              )}
              {workspace?.id && (
                <WorkspaceA2aSetting
                  workspaceId={workspace.id}
                  canEdit={canEdit}
                />
              )}
            </SettingsGroup>
          </form>
        </Form>
      </SettingsSection>

      {isOwner ? (
        <SettingsSection
          title={t("settings:workspaceGeneral.transferOwnership.title", {
            defaultValue: "Transfer ownership",
          })}
          description={t(
            "settings:workspaceGeneral.transferOwnership.subtitle",
            {
              defaultValue:
                "Hand this workspace over to another member. You'll be demoted to admin and lose owner-only abilities.",
            },
          )}
        >
          <SettingsGroup>
            <SettingsRow
              label={t(
                "settings:workspaceGeneral.transferOwnership.pickerLabel",
                { defaultValue: "New owner" },
              )}
              description={
                eligibleNewOwners.length === 0
                  ? t(
                      "settings:workspaceGeneral.transferOwnership.noEligibleMembers",
                      {
                        defaultValue:
                          "Invite at least one other member before you can transfer ownership.",
                      },
                    )
                  : t(
                      "settings:workspaceGeneral.transferOwnership.pickerHint",
                      {
                        defaultValue:
                          "They become the sole owner of this workspace.",
                      },
                    )
              }
            >
              <div className="flex w-full items-center gap-2 sm:w-auto">
                <Select
                  value={selectedNewOwnerId}
                  onValueChange={(value) => {
                    if (typeof value === "string") {
                      setSelectedNewOwnerId(value);
                    }
                  }}
                  disabled={eligibleNewOwners.length === 0}
                >
                  <SelectTrigger
                    size="sm"
                    className="w-full sm:w-56"
                    aria-label={t(
                      "settings:workspaceGeneral.transferOwnership.pickerLabel",
                      { defaultValue: "New owner" },
                    )}
                  >
                    <SelectValue
                      placeholder={t(
                        "settings:workspaceGeneral.transferOwnership.pickerPlaceholder",
                        { defaultValue: "Select a member" },
                      )}
                    >
                      {selectedMember
                        ? selectedMember.user.name || selectedMember.user.email
                        : null}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {eligibleNewOwners.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.user.name} ({m.user.email})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  disabled={!selectedNewOwnerId || isTransferring}
                  onClick={() => setIsTransferModalOpen(true)}
                >
                  {t("settings:workspaceGeneral.transferOwnership.button", {
                    defaultValue: "Transfer",
                  })}
                </Button>
              </div>
            </SettingsRow>
          </SettingsGroup>
        </SettingsSection>
      ) : null}

      {workspace?.id ? (
        <SettingsDangerZone
          title={t("settings:workspaceGeneral.dangerZone")}
          description={t("settings:workspaceGeneral.dangerZoneSubtitle")}
        >
          <LeaveWorkspaceRow
            workspaceId={workspace.id}
            workspaceName={workspace.name}
            currentUserId={currentUser?.id}
            members={members}
          />
          <WorkspaceDeletionRow
            workspaceId={workspace.id}
            workspaceName={workspace.name}
            canDelete={canDelete}
          />
        </SettingsDangerZone>
      ) : null}

      <AlertDialog
        open={isTransferModalOpen}
        onOpenChange={setIsTransferModalOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("settings:workspaceGeneral.transferOwnership.dialogTitle", {
                defaultValue: "Transfer ownership?",
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "settings:workspaceGeneral.transferOwnership.dialogDescription",
                {
                  defaultValue:
                    "{{name}} will become the sole owner of {{workspace}}. You'll keep admin access but lose owner-only abilities like deleting the workspace or transferring it again.",
                  name:
                    selectedMember?.user.name ||
                    selectedMember?.user.email ||
                    "",
                  workspace: workspace?.name ?? "",
                },
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose
              render={
                <Button variant="outline" size="sm" disabled={isTransferring} />
              }
            >
              {t("common:actions.cancel")}
            </AlertDialogClose>
            <AlertDialogClose
              render={
                <Button
                  size="sm"
                  disabled={isTransferring}
                  onClick={handleTransferOwnership}
                />
              }
            >
              {isTransferring
                ? t(
                    "settings:workspaceGeneral.transferOwnership.transferring",
                    { defaultValue: "Transferring…" },
                  )
                : t("settings:workspaceGeneral.transferOwnership.confirm", {
                    defaultValue: "Transfer ownership",
                  })}
            </AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsPage>
  );
}
