import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { InstanceOverviewCard } from "@/components/instance-admin/instance-overview-card";
import {
  InstanceLoadState,
  InstancePage,
  InstanceSection,
} from "@/components/instance-admin/instance-page";
import { SettingSwitchRow } from "@/components/instance-admin/setting-row";
import { SourceBadge } from "@/components/instance-admin/source-badge";
import { useSaveInstanceSettings } from "@/components/instance-admin/use-save-instance-settings";
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
  useInstanceOverview,
  useInstanceSettings,
} from "@/hooks/queries/instance-admin/use-instance-admin";
import {
  indexSettings,
  isSettingLocked,
  settingText,
} from "@/lib/instance-settings";
import type { InstanceSettings } from "@/types/instance-admin";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/instance/general",
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { t } = useTranslation();
  const settings = useInstanceSettings();
  const overview = useInstanceOverview();

  return (
    <InstancePage
      title={t("instanceAdmin:general.title")}
      subtitle={t("instanceAdmin:general.subtitle")}
      locked={settings.data?.locked}
    >
      <InstanceSection title={t("instanceAdmin:general.instanceName")}>
        {settings.data ? (
          <InstanceNameForm settings={settings.data} />
        ) : (
          <InstanceLoadState
            isLoading={settings.isLoading}
            isError={settings.isError}
            onRetry={() => void settings.refetch()}
            rows={1}
          />
        )}
      </InstanceSection>

      <InstanceSection title={t("instanceAdmin:general.homePage")}>
        {settings.data ? (
          <SettingSwitchRow
            settings={settings.data}
            settingKey="general.publicLanding"
            label={t("instanceAdmin:general.publicLanding")}
            hint={t("instanceAdmin:general.publicLandingHint")}
          />
        ) : (
          <InstanceLoadState
            isLoading={settings.isLoading}
            isError={settings.isError}
            onRetry={() => void settings.refetch()}
            rows={1}
          />
        )}
      </InstanceSection>

      <InstanceSection
        title={t("instanceAdmin:general.overview")}
        boxed={false}
      >
        {overview.data ? (
          <InstanceOverviewCard overview={overview.data} />
        ) : (
          <InstanceLoadState
            isLoading={overview.isLoading}
            isError={overview.isError}
            onRetry={() => void overview.refetch()}
          />
        )}
      </InstanceSection>
    </InstancePage>
  );
}

function InstanceNameForm({ settings }: { settings: InstanceSettings }) {
  const { t } = useTranslation();
  const index = indexSettings(settings);
  const entry = index.get("general.instanceName");
  const current = settingText(index, "general.instanceName");
  const locked = isSettingLocked(settings, entry);
  const { save, isPending } = useSaveInstanceSettings();

  const schema = useMemo(
    () =>
      z.object({
        name: z
          .string()
          .trim()
          .min(1, t("instanceAdmin:general.instanceNameRequired"))
          .max(80, t("instanceAdmin:general.instanceNameTooLong")),
      }),
    [t],
  );
  const form = useForm<{ name: string }>({
    resolver: standardSchemaResolver(schema),
    mode: "onChange",
    defaultValues: { name: current },
  });

  useEffect(() => {
    form.reset({ name: current });
  }, [current, form]);

  const onSubmit = async ({ name }: { name: string }) => {
    if (name.trim() === current) return;
    await save({ "general.instanceName": name.trim() });
  };

  const dirty = form.watch("name").trim() !== current;

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-2">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <FormLabel className="text-sm font-medium">
                      {t("instanceAdmin:general.instanceName")}
                    </FormLabel>
                    {entry && <SourceBadge entry={entry} />}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t("instanceAdmin:general.instanceNameHint")}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <FormControl>
                    <Input
                      className="w-full sm:w-56"
                      maxLength={80}
                      disabled={locked}
                      {...field}
                    />
                  </FormControl>
                  <Button
                    type="submit"
                    size="sm"
                    disabled={locked || !dirty || !form.formState.isValid}
                    loading={isPending}
                  >
                    {t("instanceAdmin:save")}
                  </Button>
                </div>
              </div>
              <FormMessage />
            </FormItem>
          )}
        />
      </form>
    </Form>
  );
}
