import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  InstanceLoadState,
  InstancePage,
  InstanceSection,
} from "@/components/instance-admin/instance-page";
import { SmtpForm } from "@/components/instance-admin/smtp-form";
import { TestEmailDialog } from "@/components/instance-admin/test-email-dialog";
import useAuth from "@/components/providers/auth-provider/hooks/use-auth";
import { Badge } from "@/components/ui/badge";
import { useInstanceSettings } from "@/hooks/queries/instance-admin/use-instance-admin";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/instance/email",
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const settings = useInstanceSettings();
  const [testOpen, setTestOpen] = useState(false);
  const configured = settings.data?.derived.smtpConfigured;

  return (
    <InstancePage
      title={t("instanceAdmin:email.title")}
      subtitle={t("instanceAdmin:email.subtitle")}
      locked={settings.data?.locked}
    >
      <InstanceSection
        title={t("instanceAdmin:email.smtpTitle")}
        boxed={false}
        actions={
          settings.data ? (
            <Badge
              variant={configured ? "success" : "outline"}
              className={configured ? undefined : "text-muted-foreground"}
            >
              {configured
                ? t("instanceAdmin:email.statusConfigured")
                : t("instanceAdmin:email.statusNotConfigured")}
            </Badge>
          ) : null
        }
      >
        {settings.data ? (
          <SmtpForm
            settings={settings.data}
            onSendTest={() => setTestOpen(true)}
          />
        ) : (
          <InstanceLoadState
            isLoading={settings.isLoading}
            isError={settings.isError}
            onRetry={() => void settings.refetch()}
            rows={4}
          />
        )}
      </InstanceSection>

      <TestEmailDialog
        open={testOpen}
        onOpenChange={setTestOpen}
        defaultRecipient={user?.email ?? ""}
      />
    </InstancePage>
  );
}
