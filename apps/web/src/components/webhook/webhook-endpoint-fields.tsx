import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useWebhookEvents } from "@/hooks/queries/webhook/use-webhook-events";
import {
  MAX_WEBHOOK_NAME_LENGTH,
  MAX_WEBHOOK_URL_LENGTH,
  type WebhookFormValues,
} from "@/lib/webhook/webhook";
import { WebhookEventsPicker } from "./webhook-events-picker";

type WebhookEndpointFieldsProps = {
  values: WebhookFormValues;
  onChange: (values: WebhookFormValues) => void;
  /** The client check's message, or the server's answer about the URL. */
  urlError: string | null;
  onUrlEdited: () => void;
  showErrors: boolean;
  disabled?: boolean;
  /** The settings tab toggles Active from the header instead. */
  showActive?: boolean;
};

/** Name, endpoint URL, events and Active: shared by create and edit. */
export function WebhookEndpointFields({
  values,
  onChange,
  urlError,
  onUrlEdited,
  showErrors,
  disabled,
  showActive = true,
}: WebhookEndpointFieldsProps) {
  const { t } = useTranslation();
  const nameId = useId();
  const urlId = useId();
  const activeId = useId();
  const urlErrorId = useId();
  const catalog = useWebhookEvents();

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor={nameId}>
          {t("settings:workspaceWebhooks.form.nameLabel")}
        </Label>
        <Input
          id={nameId}
          value={values.name}
          maxLength={MAX_WEBHOOK_NAME_LENGTH}
          placeholder={t("settings:workspaceWebhooks.form.namePlaceholder")}
          onChange={(event) =>
            onChange({ ...values, name: event.target.value })
          }
          disabled={disabled}
        />
        <p className="text-muted-foreground text-xs">
          {t("settings:workspaceWebhooks.form.nameHint")}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor={urlId}>
          {t("settings:workspaceWebhooks.form.urlLabel")}
        </Label>
        <Input
          id={urlId}
          type="url"
          inputMode="url"
          value={values.url}
          maxLength={MAX_WEBHOOK_URL_LENGTH}
          placeholder={t("settings:workspaceWebhooks.form.urlPlaceholder")}
          className="font-mono"
          aria-invalid={urlError ? true : undefined}
          aria-describedby={urlError ? urlErrorId : undefined}
          onChange={(event) => {
            onUrlEdited();
            onChange({ ...values, url: event.target.value });
          }}
          onBlur={() => {
            const trimmed = values.url.trim();
            if (trimmed !== values.url) onChange({ ...values, url: trimmed });
          }}
          disabled={disabled}
        />
        {urlError ? (
          <p id={urlErrorId} className="text-destructive-foreground text-xs">
            {urlError}
          </p>
        ) : (
          <p className="text-muted-foreground text-xs">
            {t("settings:workspaceWebhooks.form.urlHint")}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <p className="font-medium text-sm">
          {t("settings:workspaceWebhooks.form.eventsLabel")}
        </p>
        {catalog.data ? (
          <WebhookEventsPicker
            catalog={catalog.data}
            value={values.events}
            onChange={(events) => onChange({ ...values, events })}
            disabled={disabled}
            showErrors={showErrors}
          />
        ) : catalog.isError ? (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-destructive-foreground">
              {t("settings:workspaceWebhooks.form.eventsLoadError")}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void catalog.refetch()}
            >
              {t("settings:workspaceWebhooks.retry")}
            </Button>
          </div>
        ) : (
          <Skeleton className="h-16 w-full" />
        )}
      </div>

      {showActive && (
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <Label htmlFor={activeId}>
              {t("settings:workspaceWebhooks.form.activeLabel")}
            </Label>
            <p className="text-muted-foreground text-xs">
              {t("settings:workspaceWebhooks.form.activeHint")}
            </p>
          </div>
          <Switch
            id={activeId}
            checked={values.isActive}
            disabled={disabled}
            onCheckedChange={(checked) =>
              onChange({ ...values, isActive: checked })
            }
          />
        </div>
      )}
    </div>
  );
}

export default WebhookEndpointFields;
