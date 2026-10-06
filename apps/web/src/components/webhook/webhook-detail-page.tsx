import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  MoreHorizontal,
  Pause,
  Play,
  Send,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ErrorDisplay } from "@/components/ui/error-display";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@/components/ui/tabs";
import { useWebhook } from "@/hooks/queries/webhook/use-webhook";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { HttpError } from "@/lib/http-error";
import { webhookDisplayName } from "@/lib/webhook/webhook";
import type { WebhookWithSecret } from "@/types/webhook";
import { DeleteWebhookDialog } from "./delete-webhook-dialog";
import { RotateSecretDialog } from "./rotate-secret-dialog";
import { useSendWebhookTest, useSetWebhookActive } from "./use-webhook-actions";
import { WebhookDeliveriesTab } from "./webhook-deliveries-tab";
import { WebhookPageShell } from "./webhook-page-shell";
import { WebhookSecretModal } from "./webhook-secret-modal";
import { WebhookSettingsTab } from "./webhook-settings-tab";
import { WebhookStatusAlert } from "./webhook-status-alert";
import { WebhookStatusBadge } from "./webhook-status-badge";

export type WebhookDetailTab = "settings" | "deliveries";

type WebhookDetailPageProps = {
  webhookId: string;
  tab: WebhookDetailTab;
  onTabChange: (tab: WebhookDetailTab) => void;
};

function BackLink() {
  const { t } = useTranslation();
  return (
    <Link
      to="/dashboard/settings/workspace/webhooks"
      className="inline-flex items-center gap-1 text-muted-foreground text-sm hover:text-foreground"
    >
      <ArrowLeft className="size-4" />
      {t("settings:workspaceWebhooks.back")}
    </Link>
  );
}

/** Settings → Workspace → Webhooks → {webhook}: settings and delivery log. */
export function WebhookDetailPage({
  webhookId,
  tab,
  onTabChange,
}: WebhookDetailPageProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { workspace, canManageWebhooks, isCheckingPermissions } =
    useWorkspacePermission();
  const allowed = !isCheckingPermissions && canManageWebhooks();
  const query = useWebhook(webhookId, { enabled: allowed });
  const test = useSendWebhookTest();
  const activation = useSetWebhookActive();
  const [rotateOpen, setRotateOpen] = useState(false);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const webhook = query.data;

  const headerActions = webhook ? (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={test.isPending}
        onClick={() => test.send(webhook.id)}
      >
        {test.isPending ? (
          <Spinner className="size-4" />
        ) : (
          <Send className="size-4" />
        )}
        {test.isPending
          ? t("settings:workspaceWebhooks.test.sending")
          : t("settings:workspaceWebhooks.test.button")}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("settings:workspaceWebhooks.actionsMenu")}
            />
          }
        >
          <MoreHorizontal className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem
            disabled={activation.isPending}
            onClick={() => activation.setActive(webhook.id, !webhook.isActive)}
          >
            {webhook.isActive ? <Pause /> : <Play />}
            {webhook.isActive
              ? t("settings:workspaceWebhooks.pause")
              : t("settings:workspaceWebhooks.enable")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 />
            {t("settings:workspaceWebhooks.danger.delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  ) : undefined;

  let content: React.ReactNode;
  if (query.isLoading) {
    content = (
      <div className="space-y-4">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  } else if (query.error instanceof HttpError && query.error.status === 404) {
    content = (
      <div className="space-y-3 rounded-xl border p-8 text-center">
        <p className="font-medium">
          {t("settings:workspaceWebhooks.notFound")}
        </p>
        <BackLink />
      </div>
    );
  } else if (query.isError || !webhook) {
    content = (
      <ErrorDisplay error={query.error} onRetry={() => void query.refetch()} />
    );
  } else {
    content = (
      <div className="space-y-6">
        <WebhookStatusAlert
          webhook={webhook}
          isEnabling={activation.isPending}
          onEnable={() => activation.setActive(webhook.id, true)}
          onRotate={() => setRotateOpen(true)}
        />

        <Tabs
          value={tab}
          onValueChange={(value) => {
            if (value === "settings" || value === "deliveries") {
              onTabChange(value);
            }
          }}
        >
          <TabsList variant="underline">
            <TabsTab value="deliveries">
              {t("settings:workspaceWebhooks.tabs.deliveries")}
            </TabsTab>
            <TabsTab value="settings">
              {t("settings:workspaceWebhooks.tabs.settings")}
            </TabsTab>
          </TabsList>
          <TabsPanel value="deliveries" className="pt-4">
            <WebhookDeliveriesTab
              webhookId={webhook.id}
              webhookIsActive={webhook.isActive}
              onSendTest={() => test.send(webhook.id)}
              isSendingTest={test.isPending}
            />
          </TabsPanel>
          <TabsPanel value="settings" className="pt-4">
            <WebhookSettingsTab
              webhook={webhook}
              onRotate={() => setRotateOpen(true)}
              onDelete={() => setDeleteOpen(true)}
            />
          </TabsPanel>
        </Tabs>
      </div>
    );
  }

  return (
    <>
      <WebhookPageShell
        allowed={allowed}
        isCheckingPermissions={isCheckingPermissions}
        eyebrow={<BackLink />}
        title={webhook ? webhookDisplayName(webhook) : undefined}
        documentTitle={webhook ? webhookDisplayName(webhook) : undefined}
        description={
          webhook ? (
            <span className="flex flex-wrap items-center gap-2">
              <WebhookStatusBadge webhook={webhook} />
              <span className="break-all font-mono text-xs">{webhook.url}</span>
            </span>
          ) : undefined
        }
        actions={headerActions}
      >
        {content}
      </WebhookPageShell>

      {webhook && rotateOpen && (
        <RotateSecretDialog
          webhookId={webhook.id}
          onClose={() => setRotateOpen(false)}
          onRotated={(rotated: WebhookWithSecret) => {
            setRotateOpen(false);
            setNewSecret(rotated.secret);
          }}
        />
      )}
      {newSecret && (
        <WebhookSecretModal
          secret={newSecret}
          onClose={() => setNewSecret(null)}
        />
      )}
      <DeleteWebhookDialog
        webhookId={deleteOpen ? webhookId : null}
        workspaceId={workspace?.id}
        onOpenChange={setDeleteOpen}
        onDeleted={() =>
          void navigate({ to: "/dashboard/settings/workspace/webhooks" })
        }
      />
    </>
  );
}

export default WebhookDetailPage;
