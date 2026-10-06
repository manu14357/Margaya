import { CircleAlert, KeyRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";
import { webhookState } from "@/lib/webhook/webhook";
import type { Webhook } from "@/types/webhook";

type WebhookStatusAlertProps = {
  webhook: Webhook;
  isEnabling: boolean;
  onEnable: () => void;
  onRotate: () => void;
};

/** Disabled after failures, or a secret this instance can't read. */
export function WebhookStatusAlert({
  webhook,
  isEnabling,
  onEnable,
  onRotate,
}: WebhookStatusAlertProps) {
  const { t } = useTranslation();
  const disabled = webhookState(webhook) === "disabled";
  const unreadable = webhook.secretStatus === "unreadable";
  if (!disabled && !unreadable) return null;

  return (
    <div className="space-y-3">
      {disabled && (
        <Alert variant="error">
          <CircleAlert />
          <AlertDescription>
            {t("settings:workspaceWebhooks.disabledAlert", {
              date: webhook.disabledAt
                ? formatDateTime(webhook.disabledAt)
                : "",
            })}
          </AlertDescription>
          <AlertAction>
            <Button
              variant="outline"
              size="xs"
              loading={isEnabling}
              onClick={onEnable}
            >
              {t("settings:workspaceWebhooks.enable")}
            </Button>
          </AlertAction>
        </Alert>
      )}
      {unreadable && (
        <Alert variant="warning">
          <KeyRound />
          <AlertDescription>
            {t("settings:workspaceWebhooks.secret.unreadable")}
          </AlertDescription>
          <AlertAction>
            <Button variant="outline" size="xs" onClick={onRotate}>
              {t("settings:workspaceWebhooks.secret.rotate")}
            </Button>
          </AlertAction>
        </Alert>
      )}
    </div>
  );
}

export default WebhookStatusAlert;
