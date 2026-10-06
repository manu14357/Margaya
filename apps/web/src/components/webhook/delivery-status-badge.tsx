import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { isInFlight } from "@/lib/webhook/delivery";
import type { WebhookDeliveryStatus } from "@/types/webhook";

const VARIANTS = {
  succeeded: "success",
  failed: "error",
  pending: "secondary",
  sending: "secondary",
  cancelled: "outline",
} as const satisfies Record<WebhookDeliveryStatus, string>;

export const DELIVERY_STATUS_KEYS = {
  succeeded: "settings:workspaceWebhooks.deliveries.status.succeeded",
  failed: "settings:workspaceWebhooks.deliveries.status.failed",
  pending: "settings:workspaceWebhooks.deliveries.status.pending",
  sending: "settings:workspaceWebhooks.deliveries.status.sending",
  cancelled: "settings:workspaceWebhooks.deliveries.status.cancelled",
} as const satisfies Record<WebhookDeliveryStatus, string>;

export function DeliveryStatusBadge({
  status,
}: {
  status: WebhookDeliveryStatus;
}) {
  const { t } = useTranslation();
  return (
    <Badge variant={VARIANTS[status]}>
      {isInFlight(status) && <Spinner className="size-3" />}
      {t(DELIVERY_STATUS_KEYS[status])}
    </Badge>
  );
}

export default DeliveryStatusBadge;
