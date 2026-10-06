import { useTranslation } from "react-i18next";
import { TableCell, TableRow } from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import { type ResponseLabelKind, responseLabel } from "@/lib/webhook/delivery";
import type { WebhookDeliverySummary } from "@/types/webhook";
import { DeliveryStatusBadge } from "./delivery-status-badge";

const RESPONSE_KEYS = {
  timeout: "settings:workspaceWebhooks.deliveries.response.timeout",
  network: "settings:workspaceWebhooks.deliveries.response.network",
  destination: "settings:workspaceWebhooks.deliveries.response.destination",
  redirect: "settings:workspaceWebhooks.deliveries.response.redirect",
  secret: "settings:workspaceWebhooks.deliveries.response.secret",
  cancelled: "settings:workspaceWebhooks.deliveries.response.cancelled",
} as const satisfies Record<ResponseLabelKind, string>;

/** "200", "Timeout", "Blocked destination"…, or a dash before any attempt. */
export function DeliveryResponse({
  delivery,
}: {
  delivery: Pick<WebhookDeliverySummary, "responseStatus" | "error" | "status">;
}) {
  const { t } = useTranslation();
  const label = responseLabel(delivery);
  if (!label) return <span className="text-muted-foreground">—</span>;
  if (label.type === "http") {
    const ok = label.status >= 200 && label.status < 300;
    return (
      <span
        className={
          ok
            ? "font-mono tabular-nums"
            : "font-mono text-destructive-foreground tabular-nums"
        }
      >
        {label.status}
      </span>
    );
  }
  return (
    <span className="text-muted-foreground">
      {label.type === "label" ? t(RESPONSE_KEYS[label.kind]) : label.text}
    </span>
  );
}

type WebhookDeliveryRowProps = {
  delivery: WebhookDeliverySummary;
  onOpen: () => void;
};

export function WebhookDeliveryRow({
  delivery,
  onOpen,
}: WebhookDeliveryRowProps) {
  const { t } = useTranslation();
  return (
    <TableRow
      className="cursor-pointer"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      <TableCell>
        <DeliveryStatusBadge status={delivery.status} />
      </TableCell>
      <TableCell>
        <code className="font-mono text-xs">{delivery.event}</code>
      </TableCell>
      <TableCell className="hidden max-w-60 lg:table-cell">
        <span className="block truncate text-muted-foreground">
          {delivery.summary ?? "—"}
        </span>
      </TableCell>
      <TableCell>
        <DeliveryResponse delivery={delivery} />
      </TableCell>
      <TableCell className="hidden tabular-nums md:table-cell">
        {t("settings:workspaceWebhooks.deliveries.attemptsValue", {
          attempts: delivery.attemptCount,
          max: delivery.maxAttempts,
        })}
      </TableCell>
      <TableCell>
        <Tooltip>
          <TooltipTrigger
            render={
              <time
                dateTime={delivery.createdAt}
                className="cursor-default whitespace-nowrap text-muted-foreground"
              />
            }
          >
            {formatRelativeTime(delivery.createdAt)}
          </TooltipTrigger>
          <TooltipContent>{formatDateTime(delivery.createdAt)}</TooltipContent>
        </Tooltip>
      </TableCell>
      <TableCell className="hidden whitespace-nowrap text-right text-muted-foreground tabular-nums md:table-cell">
        {delivery.durationMs === null
          ? "—"
          : t("settings:workspaceWebhooks.deliveries.durationValue", {
              ms: delivery.durationMs,
            })}
      </TableCell>
    </TableRow>
  );
}

export default WebhookDeliveryRow;
