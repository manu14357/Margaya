import { createFileRoute } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  HealthActivity,
  HealthChecks,
  HealthFailures,
  HealthJobs,
  HealthSummary,
} from "@/components/instance-admin/instance-health";
import {
  InstanceLoadState,
  InstancePage,
  InstanceSection,
} from "@/components/instance-admin/instance-page";
import { SettingSwitchRow } from "@/components/instance-admin/setting-row";
import { UpdateStatusLine } from "@/components/instance-admin/update-notice";
import { Button } from "@/components/ui/button";
import {
  useInstanceHealth,
  useInstanceSettings,
  useInstanceUpdateStatus,
} from "@/hooks/queries/instance-admin/use-instance-admin";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/instance/health",
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { t } = useTranslation();
  const health = useInstanceHealth();
  const settings = useInstanceSettings();
  const update = useInstanceUpdateStatus(true);

  const loadState = (rows: number) => (
    <InstanceLoadState
      isLoading={health.isLoading}
      isError={health.isError}
      onRetry={() => void health.refetch()}
      rows={rows}
    />
  );

  return (
    <InstancePage
      title={t("instanceAdmin:health.title")}
      subtitle={t("instanceAdmin:health.subtitle")}
      locked={settings.data?.locked}
      actions={
        <Button
          size="sm"
          variant="outline"
          onClick={() => void health.refetch()}
          loading={health.isFetching}
          disabled={health.isFetching}
        >
          <RefreshCw aria-hidden="true" />
          {t("instanceAdmin:health.recheck")}
        </Button>
      }
    >
      <InstanceSection title={t("instanceAdmin:health.summary")} boxed={false}>
        {health.data ? <HealthSummary health={health.data} /> : loadState(2)}
      </InstanceSection>

      <InstanceSection
        title={t("instanceAdmin:health.checks.title")}
        description={t("instanceAdmin:health.checks.description")}
        boxed={false}
      >
        {health.data ? (
          <HealthChecks checks={health.data.checks} />
        ) : (
          loadState(5)
        )}
      </InstanceSection>

      <InstanceSection title={t("instanceAdmin:update.title")}>
        {settings.data ? (
          <div className="space-y-2">
            <SettingSwitchRow
              settings={settings.data}
              settingKey="general.updateCheck"
              label={t("instanceAdmin:update.label")}
              hint={t("instanceAdmin:update.hint")}
            />
            <UpdateStatusLine status={update.data} />
          </div>
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
        title={t("instanceAdmin:health.activity.title")}
        description={t("instanceAdmin:health.activity.description")}
        boxed={false}
      >
        {health.data ? <HealthActivity health={health.data} /> : loadState(2)}
      </InstanceSection>

      {health.data ? (
        <>
          <HealthJobs jobs={health.data.jobs} />
          <HealthFailures failures={health.data.failures} />
        </>
      ) : null}
    </InstancePage>
  );
}
