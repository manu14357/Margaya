import { useNavigate } from "@tanstack/react-router";
import { Plus, Webhook as WebhookIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { SettingsSection } from "@/components/settings-layout";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { ErrorDisplay } from "@/components/ui/error-display";
import { Frame, FramePanel } from "@/components/ui/frame";
import { Skeleton } from "@/components/ui/skeleton";
import { useWebhookEvents } from "@/hooks/queries/webhook/use-webhook-events";
import { useWebhooks } from "@/hooks/queries/webhook/use-webhooks";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import type { Webhook, WebhookWithSecret } from "@/types/webhook";
import { DeleteWebhookDialog } from "./delete-webhook-dialog";
import { WebhookFormDialog } from "./webhook-form-dialog";
import { WebhookPageShell } from "./webhook-page-shell";
import { WebhookSecretModal } from "./webhook-secret-modal";
import { WebhookTable } from "./webhook-table";

/** Settings → Workspace → Webhooks (workspace:manage_settings). */
export function WebhooksPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { workspace, canManageWebhooks, isCheckingPermissions } =
    useWorkspacePermission();
  const workspaceId = workspace?.id;
  const allowed = !isCheckingPermissions && canManageWebhooks();
  const webhooks = useWebhooks(workspaceId, { enabled: allowed });
  const catalog = useWebhookEvents({ enabled: allowed });
  const [formOpen, setFormOpen] = useState(false);
  const [created, setCreated] = useState<WebhookWithSecret | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Webhook | null>(null);

  const openCreate = () => setFormOpen(true);

  const handleCreated = (webhook: WebhookWithSecret) => {
    setFormOpen(false);
    setCreated(webhook);
  };

  const handleSecretClosed = () => {
    const webhookId = created?.id;
    setCreated(null);
    if (webhookId) {
      void navigate({
        to: "/dashboard/settings/workspace/webhooks/$webhookId",
        params: { webhookId },
        search: { tab: "deliveries" },
      });
    }
  };

  let body: React.ReactNode;
  if (webhooks.isLoading) {
    body = (
      <Frame>
        <FramePanel className="space-y-3 p-4">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-8 w-full" />
          ))}
        </FramePanel>
      </Frame>
    );
  } else if (webhooks.isError) {
    body = (
      <ErrorDisplay
        error={webhooks.error}
        onRetry={() => void webhooks.refetch()}
      />
    );
  } else if (!webhooks.data?.length) {
    body = (
      <Empty className="rounded-lg border border-dashed py-10">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <WebhookIcon />
          </EmptyMedia>
          <EmptyTitle>{t("settings:workspaceWebhooks.empty.title")}</EmptyTitle>
          <EmptyDescription>
            {t("settings:workspaceWebhooks.empty.description")}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button onClick={openCreate}>
            <Plus />
            {t("settings:workspaceWebhooks.create")}
          </Button>
        </EmptyContent>
      </Empty>
    );
  } else {
    body = (
      <WebhookTable
        webhooks={webhooks.data}
        catalog={catalog.data}
        onDelete={setPendingDelete}
      />
    );
  }

  return (
    <>
      <WebhookPageShell
        allowed={allowed}
        isCheckingPermissions={isCheckingPermissions}
        actions={
          webhooks.data?.length ? (
            <Button size="sm" onClick={openCreate} disabled={!workspaceId}>
              <Plus />
              {t("settings:workspaceWebhooks.create")}
            </Button>
          ) : undefined
        }
      >
        <SettingsSection
          title={t("settings:workspaceWebhooks.listTitle")}
          description={t("settings:workspaceWebhooks.listDescription")}
        >
          {body}
        </SettingsSection>
      </WebhookPageShell>

      {formOpen && workspaceId && (
        <WebhookFormDialog
          workspaceId={workspaceId}
          onClose={() => setFormOpen(false)}
          onCreated={handleCreated}
        />
      )}
      {created && (
        <WebhookSecretModal
          secret={created.secret}
          onClose={handleSecretClosed}
        />
      )}
      <DeleteWebhookDialog
        webhookId={pendingDelete?.id ?? null}
        workspaceId={workspaceId}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      />
    </>
  );
}

export default WebhooksPage;
