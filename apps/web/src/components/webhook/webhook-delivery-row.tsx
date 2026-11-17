import { useTranslation } from "react-i18next";
import {
  SettingsTableCell,
  SettingsTableMeta,
  SettingsTableRow,
} from "@/components/settings/settings-table";
import { CompactDate } from "@/components/ui/compact-date";
import { TruncatedText } from "@/components/ui/truncated-text";
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
  const attempts = t("settings:workspaceWebhooks.deliveries.attemptsValue", {
    attempts: delivery.attemptCount,
    max: delivery.maxAttempts,
  });
  const duration =
    delivery.durationMs === null
      ? "—"
      : t("settings:workspaceWebhooks.deliveries.durationValue", {
          ms: delivery.durationMs,
        });
  return (
    <SettingsTableRow
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
      <SettingsTableCell
        label={t("settings:workspaceWebhooks.deliveries.columns.status")}
      >
        <DeliveryStatusBadge status={delivery.status} />
      </SettingsTableCell>
      <SettingsTableCell kind="primary">
        <code className="font-mono text-xs wrap-anywhere">
          {delivery.event}
        </code>
        {delivery.summary && (
          <SettingsTableMeta hideAbove="lg">
            <span className="min-w-0 wrap-break-word">{delivery.summary}</span>
          </SettingsTableMeta>
        )}
        <SettingsTableMeta hideAbove="md">
          <span>{attempts}</span>
          <span>{duration}</span>
        </SettingsTableMeta>
      </SettingsTableCell>
      <SettingsTableCell hideBelow="lg">
        <TruncatedText
          text={delivery.summary ?? "—"}
          className="text-muted-foreground"
        />
      </SettingsTableCell>
      <SettingsTableCell
        label={t("settings:workspaceWebhooks.deliveries.columns.response")}
      >
        <DeliveryResponse delivery={delivery} />
      </SettingsTableCell>
      <SettingsTableCell hideBelow="md" className="tabular-nums">
        {attempts}
      </SettingsTableCell>
      <SettingsTableCell
        label={t("settings:workspaceWebhooks.deliveries.columns.created")}
        className="text-muted-foreground"
      >
        <CompactDate value={delivery.createdAt} />
      </SettingsTableCell>
      <SettingsTableCell
        hideBelow="md"
        align="end"
        className="whitespace-nowrap text-muted-foreground"
      >
        {duration}
      </SettingsTableCell>
    </SettingsTableRow>
  );
}

export default WebhookDeliveryRow;
