import { createFileRoute } from "@tanstack/react-router";
import {
  ChevronDown,
  FolderGit,
  MessageCircle,
  Radio,
  Send,
  Server,
  Webhook,
} from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { GithubIcon } from "@/components/icons/github-icon";
import { DiscordIntegrationSettings } from "@/components/project/discord-integration-settings";
import { GenericWebhookIntegrationSettings } from "@/components/project/generic-webhook-integration-settings";
import { GiteaIntegrationSettings } from "@/components/project/gitea-integration-settings";
import { GitHubIntegrationSettings } from "@/components/project/github-integration-settings";
import { MattermostIntegrationSettings } from "@/components/project/mattermost-integration-settings";
import { SlackIntegrationSettings } from "@/components/project/slack-integration-settings";
import { TelegramIntegrationSettings } from "@/components/project/telegram-integration-settings";
import {
  SettingsGroup,
  SettingsPage,
  SettingsSection,
} from "@/components/settings-layout";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/projects/$projectId/integrations",
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { t } = useTranslation();
  const { projectId } = Route.useParams();

  return (
    <SettingsPage
      title={t("settings:projectIntegrations.title")}
      documentTitle={t("settings:projectIntegrations.pageTitle")}
      description={t("settings:projectIntegrations.subtitle")}
    >
      <SettingsSection title={t("settings:projectIntegrations.codeGroupTitle")}>
        <SettingsGroup>
          <IntegrationSection
            icon={<GithubIcon className="size-4" />}
            subtitle={t("settings:projectIntegrations.githubSectionSubtitle")}
            title={t("settings:projectIntegrations.githubSectionTitle")}
          >
            <GitHubIntegrationSettings projectId={projectId} />
          </IntegrationSection>

          <IntegrationSection
            icon={<FolderGit className="size-4" />}
            subtitle={t("settings:projectIntegrations.giteaSectionSubtitle")}
            title={t("settings:projectIntegrations.giteaSectionTitle")}
          >
            <GiteaIntegrationSettings projectId={projectId} />
          </IntegrationSection>
        </SettingsGroup>
      </SettingsSection>

      <SettingsSection title={t("settings:projectIntegrations.chatGroupTitle")}>
        <SettingsGroup>
          <IntegrationSection
            icon={<MessageCircle className="size-4" />}
            subtitle={t("settings:projectIntegrations.discordSectionSubtitle")}
            title={t("settings:projectIntegrations.discordSectionTitle")}
          >
            <DiscordIntegrationSettings projectId={projectId} />
          </IntegrationSection>

          <IntegrationSection
            icon={<Radio className="size-4" />}
            subtitle={t(
              "settings:projectIntegrations.genericWebhookSectionSubtitle",
            )}
            title={t("settings:projectIntegrations.genericWebhookSectionTitle")}
          >
            <GenericWebhookIntegrationSettings projectId={projectId} />
          </IntegrationSection>

          <IntegrationSection
            icon={<Webhook className="size-4" />}
            subtitle={t("settings:projectIntegrations.slackSectionSubtitle")}
            title={t("settings:projectIntegrations.slackSectionTitle")}
          >
            <SlackIntegrationSettings projectId={projectId} />
          </IntegrationSection>

          <IntegrationSection
            icon={<Server className="size-4" />}
            subtitle={t(
              "settings:projectIntegrations.mattermostSectionSubtitle",
            )}
            title={t("settings:projectIntegrations.mattermostSectionTitle")}
          >
            <MattermostIntegrationSettings projectId={projectId} />
          </IntegrationSection>

          <IntegrationSection
            icon={<Send className="size-4" />}
            subtitle={t("settings:projectIntegrations.telegramSectionSubtitle")}
            title={t("settings:projectIntegrations.telegramSectionTitle")}
          >
            <TelegramIntegrationSettings projectId={projectId} />
          </IntegrationSection>
        </SettingsGroup>
      </SettingsSection>
    </SettingsPage>
  );
}

function IntegrationSection({
  title,
  subtitle,
  icon,
  defaultOpen = false,
  children,
}: {
  title: string;
  subtitle: string;
  icon: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <Collapsible defaultOpen={defaultOpen}>
      <CollapsibleTrigger className="group flex w-full items-center justify-between gap-4 rounded-lg px-4 py-3 text-left outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground">
            {icon}
          </div>
          <div className="min-w-0">
            <h3 className="font-medium text-sm">{title}</h3>
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          </div>
        </div>

        <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[panel-open]:rotate-180" />
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="border-t border-border p-4">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}
