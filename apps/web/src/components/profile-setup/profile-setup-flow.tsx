import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod/v4";
import {
  SetupHeading,
  SetupLayout,
} from "@/components/onboarding/setup-layout";
import PageTitle from "@/components/page-title";
import useAuth from "@/components/providers/auth-provider/hooks/use-auth";
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
import useUpdateUserProfile from "@/hooks/mutations/use-update-user-profile";
import { toast } from "@/lib/toast";

export type ProfileFormValues = {
  name: string;
};

export function ProfileSetupFlow() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { mutateAsync: updateProfile, isPending } = useUpdateUserProfile();
  const { user } = useAuth();

  const profileSchema = useMemo(
    () =>
      z.object({
        name: z
          .string()
          .min(1, t("auth:profileSetup.validation.nameRequired"))
          .min(2, t("auth:profileSetup.validation.nameShort")),
      }),
    [t],
  );

  const form = useForm<ProfileFormValues>({
    resolver: standardSchemaResolver(profileSchema),
    defaultValues: {
      name: user?.name || "",
    },
  });

  const onSubmit = async (data: ProfileFormValues) => {
    try {
      await updateProfile({
        name: data.name.trim(),
      });

      await queryClient.invalidateQueries({ queryKey: ["session"] });
      toast.success(t("auth:profileSetup.toast.updateSuccess"));
      // The dashboard index routes on: pending invitations, onboarding, or
      // the active workspace.
      navigate({ to: "/dashboard", replace: true });
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("auth:profileSetup.toast.updateFailed"),
      );
    }
  };

  return (
    <>
      <PageTitle title={t("auth:profileSetup.pageTitle")} />
      <SetupLayout width="sm">
        <div className="space-y-6">
          <SetupHeading
            title={t("auth:profileSetup.completeTitle")}
            description={t("auth:profileSetup.subtitle")}
          />
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium">
                      {t("auth:profileSetup.yourName")}
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder={t("auth:profileSetup.namePlaceholder")}
                        autoComplete="name"
                        autoFocus
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button type="submit" disabled={isPending} className="w-full">
                {isPending
                  ? t("auth:profileSetup.saving")
                  : t("auth:profileSetup.continue")}
              </Button>
            </form>
          </Form>
        </div>
      </SetupLayout>
    </>
  );
}
