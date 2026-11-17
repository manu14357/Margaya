import { Link, useNavigate } from "@tanstack/react-router";
import {
  ExternalLink,
  MoreHorizontal,
  Pause,
  Play,
  Send,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  SettingsTable,
  SettingsTableBody,
  SettingsTableCell,
  SettingsTableHead,
  SettingsTableHeader,
  SettingsTableMeta,
  SettingsTableRow,
} from "@/components/settings/settings-table";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { TruncatedText } from "@/components/ui/truncated-text";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import { type CatalogLike, describePatterns } from "@/lib/webhook/patterns";
import { lastDelivery, webhookDisplayName } from "@/lib/webhook/webhook";
import type { Webhook } from "@/types/webhook";
import { useSendWebhookTest, useSetWebhookActive } from "./use-webhook-actions";
import { WebhookStatusBadge } from "./webhook-status-badge";

type WebhookTableProps = {
  webhooks: Webhook[];
  catalog: CatalogLike | undefined;
  onDelete: (webhook: Webhook) => void;
};

function EventsCell({
  patterns,
  catalog,
}: {
  patterns: string[];
  catalog: CatalogLike | undefined;
}) {
  const { t } = useTranslation();
  const description = describePatterns(patterns, catalog);
  return (
    <span className="text-muted-foreground">
      {description.kind === "all"
        ? t("settings:workspaceWebhooks.events.all")
        : t("settings:workspaceWebhooks.events.count", {
            count: description.count,
          })}
    </span>
  );
}

function LastDeliveryCell({ webhook }: { webhook: Webhook }) {
  const { t } = useTranslation();
  const last = lastDelivery(webhook.health);
  if (!last) {
    return (
      <span className="text-muted-foreground">
        {t("settings:workspaceWebhooks.table.never")}
      </span>
    );
  }
  const time = formatRelativeTime(last.at);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <time
            dateTime={last.at}
            className={
              last.result === "failed"
                ? "cursor-default whitespace-nowrap text-destructive-foreground"
                : "cursor-default whitespace-nowrap text-muted-foreground"
            }
          />
        }
      >
        {last.result === "succeeded"
          ? t("settings:workspaceWebhooks.table.lastSucceeded", { time })
          : t("settings:workspaceWebhooks.table.lastFailed", { time })}
      </TooltipTrigger>
      <TooltipContent>{formatDateTime(last.at)}</TooltipContent>
    </Tooltip>
  );
}

/** The workspace's webhooks; a row opens its detail page. */
export function WebhookTable({
  webhooks,
  catalog,
  onDelete,
}: WebhookTableProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const test = useSendWebhookTest();
  const activation = useSetWebhookActive();

  const open = (webhookId: string) =>
    navigate({
      to: "/dashboard/settings/workspace/webhooks/$webhookId",
      params: { webhookId },
    });

  return (
    <SettingsTable>
      <SettingsTableHeader>
        <SettingsTableRow>
          <SettingsTableHead>
            {t("settings:workspaceWebhooks.table.name")}
          </SettingsTableHead>
          <SettingsTableHead className="w-36" hideBelow="md">
            {t("settings:workspaceWebhooks.table.events")}
          </SettingsTableHead>
          <SettingsTableHead className="w-32">
            {t("settings:workspaceWebhooks.table.status")}
          </SettingsTableHead>
          <SettingsTableHead className="w-44" hideBelow="md">
            {t("settings:workspaceWebhooks.table.lastDelivery")}
          </SettingsTableHead>
          <SettingsTableHead className="w-14">
            <span className="sr-only">
              {t("settings:workspaceWebhooks.table.actions")}
            </span>
          </SettingsTableHead>
        </SettingsTableRow>
      </SettingsTableHeader>
      <SettingsTableBody>
        {webhooks.map((webhook) => (
          <SettingsTableRow
            key={webhook.id}
            className="cursor-pointer"
            onClick={() => void open(webhook.id)}
          >
            <SettingsTableCell kind="primary">
              <Link
                to="/dashboard/settings/workspace/webhooks/$webhookId"
                params={{ webhookId: webhook.id }}
                className="block truncate font-medium hover:underline pointer-coarse:-my-1.5 pointer-coarse:py-1.5"
                onClick={(event) => event.stopPropagation()}
              >
                {webhookDisplayName(webhook)}
              </Link>
              <TruncatedText
                text={webhook.url}
                className="font-mono text-muted-foreground text-xs"
              />
              <SettingsTableMeta hideAbove="md">
                <EventsCell patterns={webhook.events} catalog={catalog} />
                <LastDeliveryCell webhook={webhook} />
              </SettingsTableMeta>
            </SettingsTableCell>
            <SettingsTableCell hideBelow="md">
              <EventsCell patterns={webhook.events} catalog={catalog} />
            </SettingsTableCell>
            <SettingsTableCell
              label={t("settings:workspaceWebhooks.table.status")}
            >
              <WebhookStatusBadge webhook={webhook} />
            </SettingsTableCell>
            <SettingsTableCell hideBelow="md">
              <LastDeliveryCell webhook={webhook} />
            </SettingsTableCell>
            <SettingsTableCell
              kind="actions"
              onClick={(event) => event.stopPropagation()}
            >
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={t("settings:workspaceWebhooks.actionsMenu")}
                    />
                  }
                >
                  <MoreHorizontal className="size-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem onClick={() => void open(webhook.id)}>
                    <ExternalLink />
                    {t("settings:workspaceWebhooks.table.open")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={test.pendingId === webhook.id}
                    onClick={() => test.send(webhook.id)}
                  >
                    <Send />
                    {t("settings:workspaceWebhooks.test.button")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={activation.isPending}
                    onClick={() =>
                      activation.setActive(webhook.id, !webhook.isActive)
                    }
                  >
                    {webhook.isActive ? <Pause /> : <Play />}
                    {webhook.isActive
                      ? t("settings:workspaceWebhooks.pause")
                      : t("settings:workspaceWebhooks.enable")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => onDelete(webhook)}
                  >
                    <Trash2 />
                    {t("settings:workspaceWebhooks.danger.delete")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </SettingsTableCell>
          </SettingsTableRow>
        ))}
      </SettingsTableBody>
    </SettingsTable>
  );
}

export default WebhookTable;
