import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { GithubAppForm } from "@/components/instance-admin/github-app-form";
import {
  InstanceLoadState,
  InstancePage,
  InstanceSection,
} from "@/components/instance-admin/instance-page";
import { Badge } from "@/components/ui/badge";
import { useInstanceSettings } from "@/hooks/queries/instance-admin/use-instance-admin";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/instance/integrations",
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { t } = useTranslation();
  const settings = useInstanceSettings();
  const configured = settings.data?.derived.githubApp.configured;

  return (
    <InstancePage
      title={t("instanceAdmin:integrations.title")}
      subtitle={t("instanceAdmin:integrations.subtitle")}
      locked={settings.data?.locked}
    >
      <InstanceSection
        title={t("instanceAdmin:githubApp.title")}
        boxed={false}
        actions={
          settings.data ? (
            <Badge
              variant={configured ? "success" : "outline"}
              className={configured ? undefined : "text-muted-foreground"}
            >
              {configured
                ? t("instanceAdmin:githubApp.statusConfigured")
                : t("instanceAdmin:githubApp.statusNotConfigured")}
            </Badge>
          ) : null
        }
      >
        {settings.data ? (
          <GithubAppForm settings={settings.data} />
        ) : (
          <InstanceLoadState
            isLoading={settings.isLoading}
            isError={settings.isError}
            onRetry={() => void settings.refetch()}
            rows={4}
          />
        )}
      </InstanceSection>
    </InstancePage>
  );
}
