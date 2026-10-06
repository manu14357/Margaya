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
import { Button } from "@/components/ui/button";
import { Frame } from "@/components/ui/frame";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
    <span className="whitespace-nowrap text-muted-foreground">
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
    <Frame>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("settings:workspaceWebhooks.table.name")}</TableHead>
            <TableHead className="hidden md:table-cell">
              {t("settings:workspaceWebhooks.table.events")}
            </TableHead>
            <TableHead>
              {t("settings:workspaceWebhooks.table.status")}
            </TableHead>
            <TableHead className="hidden md:table-cell">
              {t("settings:workspaceWebhooks.table.lastDelivery")}
            </TableHead>
            <TableHead className="w-[60px] text-right">
              <span className="sr-only">
                {t("settings:workspaceWebhooks.table.actions")}
              </span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {webhooks.map((webhook) => (
            <TableRow
              key={webhook.id}
              className="cursor-pointer"
              onClick={() => void open(webhook.id)}
            >
              <TableCell className="max-w-72">
                <Link
                  to="/dashboard/settings/workspace/webhooks/$webhookId"
                  params={{ webhookId: webhook.id }}
                  className="block truncate font-medium hover:underline"
                  onClick={(event) => event.stopPropagation()}
                >
                  {webhookDisplayName(webhook)}
                </Link>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <span className="block cursor-default truncate font-mono text-muted-foreground text-xs" />
                    }
                  >
                    {webhook.url}
                  </TooltipTrigger>
                  <TooltipContent className="max-w-96 break-all font-mono">
                    {webhook.url}
                  </TooltipContent>
                </Tooltip>
              </TableCell>
              <TableCell className="hidden md:table-cell">
                <EventsCell patterns={webhook.events} catalog={catalog} />
              </TableCell>
              <TableCell>
                <WebhookStatusBadge webhook={webhook} />
              </TableCell>
              <TableCell className="hidden md:table-cell">
                <LastDeliveryCell webhook={webhook} />
              </TableCell>
              <TableCell
                className="text-right"
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
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Frame>
  );
}

export default WebhookTable;
