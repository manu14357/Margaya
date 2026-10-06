import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { type WebhookState, webhookState } from "@/lib/webhook/webhook";
import type { Webhook } from "@/types/webhook";

const VARIANTS = {
  active: "success",
  paused: "secondary",
  disabled: "error",
} as const satisfies Record<WebhookState, string>;

const LABEL_KEYS = {
  active: "settings:workspaceWebhooks.status.active",
  paused: "settings:workspaceWebhooks.status.paused",
  disabled: "settings:workspaceWebhooks.status.disabled",
} as const satisfies Record<WebhookState, string>;

/** Active, Paused, or Disabled after failures. */
export function WebhookStatusBadge({
  webhook,
}: {
  webhook: Pick<Webhook, "isActive" | "disabledReason">;
}) {
  const { t } = useTranslation();
  const state = webhookState(webhook);
  return <Badge variant={VARIANTS[state]}>{t(LABEL_KEYS[state])}</Badge>;
}

export default WebhookStatusBadge;
