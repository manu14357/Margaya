import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { useId, useMemo } from "react";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod/v4";
import { PasswordInput } from "@/components/auth/password-input";
import { SettingsGroup, SettingsSection } from "@/components/settings-layout";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import useChangePassword, {
  ChangePasswordError,
  INVALID_PASSWORD,
} from "@/hooks/mutations/use-change-password";
import { newPasswordField } from "@/lib/password-rules";
import { toast } from "@/lib/toast";

type ChangePasswordValues = {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
  revokeOtherSessions: boolean;
};

const EMPTY: ChangePasswordValues = {
  currentPassword: "",
  newPassword: "",
  confirmPassword: "",
  revokeOtherSessions: true,
};

/** Changes the password of an account that has one. */
export function ChangePasswordSection() {
  const { t } = useTranslation();
  const revokeId = useId();
  const { mutateAsync: changePassword, isPending } = useChangePassword();

  const schema = useMemo(
    () =>
      z
        .object({
          currentPassword: z.string().min(1, {
            message: t("settings:securityPage.password.currentRequired"),
          }),
          newPassword: newPasswordField(t),
          confirmPassword: z.string(),
          revokeOtherSessions: z.boolean(),
        })
        .refine((values) => values.newPassword === values.confirmPassword, {
          message: t("auth:forms.passwordsDoNotMatch"),
          path: ["confirmPassword"],
        }),
    [t],
  );

  const form = useForm<ChangePasswordValues>({
    resolver: standardSchemaResolver(schema),
    defaultValues: EMPTY,
  });

  const onSubmit = async (values: ChangePasswordValues) => {
    try {
      await changePassword({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
        revokeOtherSessions: values.revokeOtherSessions,
      });
      toast.success(t("settings:securityPage.password.success"));
      form.reset(EMPTY);
    } catch (error) {
      if (
        error instanceof ChangePasswordError &&
        error.code === INVALID_PASSWORD
      ) {
        form.setError("currentPassword", {
          message: t("settings:securityPage.password.wrongCurrent"),
        });
        return;
      }
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : t("settings:securityPage.password.error"),
      );
    }
  };

  const passwordField = (
    name: "currentPassword" | "newPassword" | "confirmPassword",
    label: string,
    autoComplete: string,
  ) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel className="text-sm font-medium">{label}</FormLabel>
          <FormControl>
            <PasswordInput autoComplete={autoComplete} {...field} />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );

  return (
    <SettingsSection
      title={t("settings:securityPage.password.title")}
      description={t("settings:securityPage.password.subtitle")}
    >
      <SettingsGroup>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-3 px-4 py-4 sm:max-w-sm"
          >
            {passwordField(
              "currentPassword",
              t("settings:securityPage.password.current"),
              "current-password",
            )}
            {passwordField(
              "newPassword",
              t("settings:securityPage.password.new"),
              "new-password",
            )}
            {passwordField(
              "confirmPassword",
              t("settings:securityPage.password.confirm"),
              "new-password",
            )}
            <Controller
              control={form.control}
              name="revokeOtherSessions"
              render={({ field }) => (
                <label htmlFor={revokeId} className="flex items-start gap-3">
                  <Checkbox
                    id={revokeId}
                    checked={field.value}
                    onCheckedChange={(value) => field.onChange(Boolean(value))}
                    className="mt-0.5"
                  />
                  <span className="space-y-0.5">
                    <span className="block text-sm font-medium">
                      {t("settings:securityPage.password.signOutOthers")}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {t("settings:securityPage.password.signOutOthersHint")}
                    </span>
                  </span>
                </label>
              )}
            />
            <Button type="submit" size="sm" disabled={isPending}>
              {isPending
                ? t("settings:securityPage.password.saving")
                : t("settings:securityPage.password.submit")}
            </Button>
          </form>
        </Form>
      </SettingsGroup>
    </SettingsSection>
  );
}
