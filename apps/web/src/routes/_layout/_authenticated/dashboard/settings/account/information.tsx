import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2, Pencil, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { ChangeEmailDialog } from "@/components/account/change-email-dialog";
import useAuth from "@/components/providers/auth-provider/hooks/use-auth";
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import useDeleteAccount, {
  SESSION_TOO_OLD,
} from "@/hooks/mutations/use-delete-account";
import useRemoveUserAvatar from "@/hooks/mutations/use-remove-user-avatar";
import useUpdateUserAvatar from "@/hooks/mutations/use-update-user-avatar";
import useUpdateUserProfile from "@/hooks/mutations/use-update-user-profile";
import useGetConfig from "@/hooks/queries/config/use-get-config";
import { createSaveEchoGuard, sameFormValues } from "@/lib/form-autosave";
import { getInitials } from "@/lib/get-initials";
import { ACCEPTED_AVATAR_TYPES } from "@/lib/prepare-avatar-image";
import { toast } from "@/lib/toast";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/account/information",
)({
  component: RouteComponent,
});

type ProfileFormValues = {
  name: string;
  email: string;
};

type NormalizedProfileValues = {
  name: string;
  email: string;
};

function normalizeProfileValues(
  data: ProfileFormValues,
): NormalizedProfileValues {
  return {
    name: data.name.trim(),
    email: data.email,
  };
}

function RouteComponent() {
  const { t } = useTranslation();
  const { user, refetchUser } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { mutateAsync: updateProfile } = useUpdateUserProfile();
  const { mutateAsync: updateAvatar, isPending: isUploadingAvatar } =
    useUpdateUserAvatar();
  const { mutateAsync: removeAvatar, isPending: isRemovingAvatar } =
    useRemoveUserAvatar();
  const { mutateAsync: deleteAccount, isPending: isDeletingAccount } =
    useDeleteAccount();
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isChangeEmailOpen, setIsChangeEmailOpen] = useState(false);
  const { data: config } = useGetConfig();
  const isGuest = Boolean(
    (user as { isAnonymous?: boolean | null } | null)?.isAnonymous,
  );
  // The change is confirmed by a code sent to the new address.
  const canChangeEmail = !isGuest && Boolean(config?.hasSmtp);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const canConfirmDelete =
    Boolean(user?.email) &&
    deleteConfirmation.trim().toLowerCase() === user?.email.toLowerCase();
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isSavingRef = useRef(false);
  const queuedSaveRef = useRef<ProfileFormValues | null>(null);
  const lastSavedRef = useRef<NormalizedProfileValues | null>(null);
  const [echoGuard] = useState(() =>
    createSaveEchoGuard<NormalizedProfileValues>(),
  );
  const profileSchema = z.object({
    name: z
      .string()
      .min(1, t("settings:informationPage.validation.nameRequired"))
      .min(2, t("settings:informationPage.validation.nameShort")),
    email: z
      .string()
      .email(t("settings:informationPage.validation.invalidEmail")),
  });

  const profileForm = useForm<ProfileFormValues>({
    resolver: standardSchemaResolver(profileSchema),
    mode: "onChange",
    defaultValues: {
      name: user?.name || "",
      email: user?.email || "",
    },
  });

  useEffect(() => {
    if (!user) return;

    const serverValues = normalizeProfileValues({
      name: user.name || "",
      email: user.email || "",
    });
    // A session response requested before the last save can arrive after it.
    if (!echoGuard.accepts(serverValues)) return;

    const previous = lastSavedRef.current;
    lastSavedRef.current = serverValues;

    // Keep edits that haven't been saved yet.
    const current = normalizeProfileValues(profileForm.getValues());
    if (previous && !sameFormValues(current, previous)) return;

    profileForm.reset(serverValues);
  }, [user, profileForm, echoGuard]);

  const saveProfile = useCallback(
    async (data: ProfileFormValues) => {
      const normalizedData = normalizeProfileValues(data);

      if (lastSavedRef.current?.name === normalizedData.name) {
        return;
      }

      if (isSavingRef.current) {
        queuedSaveRef.current = data;
        return;
      }

      isSavingRef.current = true;

      try {
        await updateProfile({
          name: normalizedData.name,
        });

        lastSavedRef.current = normalizedData;
        echoGuard.expect(normalizedData);
        queuedSaveRef.current = null;

        // Leave anything typed while the request was in flight alone.
        const current = normalizeProfileValues(profileForm.getValues());
        if (sameFormValues(current, normalizedData)) {
          profileForm.reset(normalizedData, { keepDirty: false });
        }

        await refetchUser();
        toast.success(t("settings:informationPage.updateSuccess"));
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : t("settings:informationPage.updateError"),
        );
      } finally {
        isSavingRef.current = false;

        if (queuedSaveRef.current) {
          const queuedData = queuedSaveRef.current;
          queuedSaveRef.current = null;
          await saveProfile(queuedData);
        }
      }
    },
    [t, updateProfile, refetchUser, profileForm, echoGuard],
  );

  const handleAvatarSelected = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";

      if (!file) return;

      try {
        await updateAvatar(file);
        await refetchUser();
        toast.success(t("settings:informationPage.avatar.updateSuccess"));
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : t("settings:informationPage.avatar.updateError"),
        );
      }
    },
    [updateAvatar, refetchUser, t],
  );

  const handleAvatarRemoved = useCallback(async () => {
    try {
      await removeAvatar();
      await refetchUser();
      toast.success(t("settings:informationPage.avatar.removeSuccess"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("settings:informationPage.avatar.removeError"),
      );
    }
  }, [removeAvatar, refetchUser, t]);

  const handleDeleteAccount = useCallback(async () => {
    try {
      await deleteAccount();
      setIsDeleteModalOpen(false);
      queryClient.clear();
      toast.success(t("settings:informationPage.deleteAccount.success"));
      navigate({ to: "/auth/sign-in" });
    } catch (error) {
      if (error instanceof Error && error.message === SESSION_TOO_OLD) {
        toast.error(t("settings:informationPage.deleteAccount.sessionTooOld"));
        return;
      }

      toast.error(
        error instanceof Error
          ? error.message
          : t("settings:informationPage.deleteAccount.error"),
      );
    }
  }, [deleteAccount, queryClient, navigate, t]);

  const debouncedSave = useCallback(() => {
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }

    debounceTimeoutRef.current = setTimeout(async () => {
      if (await profileForm.trigger()) {
        saveProfile(profileForm.getValues());
      }
    }, 1000);
  }, [profileForm, saveProfile]);

  useEffect(() => {
    // Don't gate on formState.isDirty/isValid here: the watch callback runs
    // before react-hook-form updates them, which drops one-step edits (paste).
    // saveProfile skips values that match the last save.
    const subscription = profileForm.watch(() => {
      debouncedSave();
    });

    return () => subscription.unsubscribe();
  }, [profileForm, debouncedSave]);

  useEffect(() => {
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, []);

  return (
    <SettingsPage
      title={t("settings:informationPage.title")}
      documentTitle={t("settings:informationPage.pageTitle")}
      description={t("settings:informationPage.subtitle")}
    >
      <SettingsSection
        title={t("settings:informationPage.sectionTitle")}
        description={t("settings:informationPage.sectionSubtitle")}
      >
        <SettingsGroup>
          <SettingsRow
            label={t("settings:informationPage.profilePicture")}
            description={t("settings:informationPage.avatar.hint")}
          >
            <input
              ref={avatarInputRef}
              type="file"
              accept={ACCEPTED_AVATAR_TYPES}
              className="hidden"
              onChange={handleAvatarSelected}
            />
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <button
                    type="button"
                    aria-label={t("settings:informationPage.avatar.edit")}
                    disabled={isUploadingAvatar || isRemovingAvatar}
                    className="group relative rounded-full outline-none transition-transform duration-150 ease-out active:scale-97 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
                  />
                }
              >
                <Avatar className="h-10 w-10">
                  <AvatarImage src={user?.image ?? ""} alt={user?.name || ""} />
                  <AvatarFallback className="text-xs font-medium border border-border/30">
                    {getInitials(user?.name)}
                  </AvatarFallback>
                </Avatar>
                <span className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-full bg-black/55 text-white opacity-0 transition-opacity duration-150 ease-out group-hover:opacity-100 group-focus-visible:opacity-100 group-data-[popup-open]:opacity-100 group-disabled:opacity-100">
                  {isUploadingAvatar || isRemovingAvatar ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Pencil className="size-3.5" />
                  )}
                </span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" side="bottom">
                <DropdownMenuItem
                  onClick={() => avatarInputRef.current?.click()}
                >
                  <Pencil />
                  {t("settings:informationPage.avatar.change")}
                </DropdownMenuItem>
                {user?.image ? (
                  <DropdownMenuItem onClick={handleAvatarRemoved}>
                    <X />
                    {t("settings:informationPage.avatar.remove")}
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </SettingsRow>

          <Form {...profileForm}>
            <form
              className="flex flex-col divide-y divide-border"
              onSubmit={(event) => event.preventDefault()}
            >
              <FormField
                control={profileForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem className="space-y-0">
                    <SettingsRow
                      label={
                        <FormLabel className="text-sm font-medium">
                          {t("settings:informationPage.fullName")}
                        </FormLabel>
                      }
                    >
                      <div className="w-full space-y-1.5 sm:w-64">
                        <FormControl>
                          <Input
                            placeholder={t(
                              "settings:informationPage.fullNamePlaceholder",
                            )}
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
                control={profileForm.control}
                name="email"
                render={({ field }) => (
                  <FormItem className="space-y-0">
                    <SettingsRow
                      label={
                        <FormLabel className="text-sm font-medium">
                          {t("settings:informationPage.email")}
                        </FormLabel>
                      }
                    >
                      <div className="w-full space-y-1.5 sm:w-64">
                        <FormControl>
                          <Input
                            placeholder={t(
                              "settings:informationPage.emailPlaceholder",
                            )}
                            {...field}
                            disabled
                            value={user?.email || ""}
                          />
                        </FormControl>
                        <FormMessage />
                        {canChangeEmail ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="xs"
                            onClick={() => setIsChangeEmailOpen(true)}
                          >
                            {t("accountSecurity:emailChange.action")}
                          </Button>
                        ) : isGuest ? null : (
                          <p className="text-xs text-muted-foreground">
                            {t("accountSecurity:emailChange.unavailable")}
                          </p>
                        )}
                      </div>
                    </SettingsRow>
                  </FormItem>
                )}
              />
            </form>
          </Form>
        </SettingsGroup>
      </SettingsSection>

      <ChangeEmailDialog
        open={isChangeEmailOpen}
        onOpenChange={setIsChangeEmailOpen}
      />

      <SettingsDangerZone
        title={t("settings:informationPage.deleteAccount.sectionTitle")}
        description={t(
          "settings:informationPage.deleteAccount.sectionSubtitle",
        )}
      >
        <SettingsRow
          label={t("settings:informationPage.deleteAccount.title")}
          description={t("settings:informationPage.deleteAccount.description")}
        >
          <Button
            variant="destructive-outline"
            size="sm"
            type="button"
            onClick={() => setIsDeleteModalOpen(true)}
          >
            {t("settings:informationPage.deleteAccount.title")}
          </Button>
        </SettingsRow>
      </SettingsDangerZone>

      <AlertDialog
        open={isDeleteModalOpen}
        onOpenChange={(open) => {
          setIsDeleteModalOpen(open);
          if (!open) setDeleteConfirmation("");
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("settings:informationPage.deleteAccount.modalTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("settings:informationPage.deleteAccount.modalDescription", {
                email: user?.email ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2 px-6 pb-5">
            <Label htmlFor="delete-account-confirmation">
              {t("settings:informationPage.deleteAccount.confirmLabel", {
                email: user?.email ?? "",
              })}
            </Label>
            <Input
              id="delete-account-confirmation"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              disabled={isDeletingAccount}
              value={deleteConfirmation}
              onChange={(event) => setDeleteConfirmation(event.target.value)}
              placeholder={user?.email ?? ""}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogClose
              render={
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isDeletingAccount}
                />
              }
            >
              {t("common:actions.cancel")}
            </AlertDialogClose>
            <Button
              variant="destructive"
              size="sm"
              type="button"
              disabled={isDeletingAccount || !canConfirmDelete}
              onClick={handleDeleteAccount}
            >
              {isDeletingAccount
                ? t("common:actions.deleting")
                : t("settings:informationPage.deleteAccount.confirm")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsPage>
  );
}
