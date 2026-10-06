import { KeyRound, Link2, TriangleAlert } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardPanel,
  CardTitle,
} from "@/components/ui/card";
import { useUpdateWebhook } from "@/hooks/mutations/webhook/use-update-webhook";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import { HttpError } from "@/lib/http-error";
import { toast } from "@/lib/toast";
import {
  isValidWebhookUrl,
  type WebhookFormValues,
  webhookChanges,
} from "@/lib/webhook/webhook";
import type { Webhook } from "@/types/webhook";
import { WebhookEndpointFields } from "./webhook-endpoint-fields";

type WebhookSettingsTabProps = {
  webhook: Webhook;
  onRotate: () => void;
  onDelete: () => void;
};

function valuesOf(webhook: Webhook): WebhookFormValues {
  return {
    name: webhook.name ?? "",
    url: webhook.url,
    events: webhook.events,
    isActive: webhook.isActive,
  };
}

function EndpointCard({ webhook }: { webhook: Webhook }) {
  const { t } = useTranslation();
  const update = useUpdateWebhook();
  const [values, setValues] = useState(() => valuesOf(webhook));
  const [submitted, setSubmitted] = useState(false);
  const [serverUrlError, setServerUrlError] = useState<string | null>(null);

  // Active is toggled from the header, so only the endpoint fields compare.
  const changes = webhookChanges(webhook, {
    ...values,
    isActive: webhook.isActive,
  });
  const dirty = Object.keys(changes).length > 0;
  const urlInvalid = !isValidWebhookUrl(values.url);
  const urlError =
    serverUrlError ??
    (submitted && urlInvalid
      ? t("settings:workspaceWebhooks.form.urlInvalid")
      : null);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (update.isPending || !dirty) return;
    setSubmitted(true);
    if (urlInvalid || values.events.length === 0) return;
    update.mutate(
      { id: webhook.id, input: changes },
      {
        onSuccess: (saved) => {
          toast.success(t("settings:workspaceWebhooks.toast.updated"));
          setValues(valuesOf(saved));
          setSubmitted(false);
        },
        onError: (error) => {
          if (
            error instanceof HttpError &&
            (error.status === 400 || error.status === 409) &&
            error.message
          ) {
            setServerUrlError(error.message);
            return;
          }
          toast.error(
            error.message || t("settings:workspaceWebhooks.toast.error"),
          );
        },
      },
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="inline-flex items-center gap-2 text-base">
          <Link2 className="size-4" />
          {t("settings:workspaceWebhooks.form.editTitle")}
        </CardTitle>
        <CardDescription>
          {t("settings:workspaceWebhooks.form.editDescription")}
        </CardDescription>
      </CardHeader>
      <CardPanel>
        <form onSubmit={handleSubmit} noValidate className="space-y-5">
          <WebhookEndpointFields
            values={values}
            onChange={setValues}
            urlError={urlError}
            onUrlEdited={() => setServerUrlError(null)}
            showErrors={submitted}
            disabled={update.isPending}
            showActive={false}
          />
          <div className="flex justify-end">
            <Button type="submit" disabled={!dirty || update.isPending}>
              {update.isPending
                ? t("settings:workspaceWebhooks.form.saving")
                : t("settings:workspaceWebhooks.form.save")}
            </Button>
          </div>
        </form>
      </CardPanel>
    </Card>
  );
}

function SecretCard({
  webhook,
  onRotate,
}: {
  webhook: Webhook;
  onRotate: () => void;
}) {
  const { t } = useTranslation();
  const graceActive =
    webhook.previousSecretExpiresAt &&
    new Date(webhook.previousSecretExpiresAt).getTime() > Date.now();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="inline-flex items-center gap-2 text-base">
          <KeyRound className="size-4" />
          {t("settings:workspaceWebhooks.secret.cardTitle")}
        </CardTitle>
        <CardDescription>
          {t("settings:workspaceWebhooks.secret.cardDescription")}
        </CardDescription>
      </CardHeader>
      <CardPanel className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <code className="font-mono text-sm">{webhook.secretHint}</code>
          {webhook.secretRotatedAt && (
            <p className="text-muted-foreground text-xs">
              <time
                dateTime={webhook.secretRotatedAt}
                title={formatDateTime(webhook.secretRotatedAt)}
              >
                {t("settings:workspaceWebhooks.secret.rotatedAt", {
                  time: formatRelativeTime(webhook.secretRotatedAt),
                })}
              </time>
            </p>
          )}
          {graceActive && webhook.previousSecretExpiresAt && (
            <p className="text-muted-foreground text-xs">
              {t("settings:workspaceWebhooks.secret.previousValidUntil", {
                time: formatDateTime(webhook.previousSecretExpiresAt),
              })}
            </p>
          )}
        </div>
        <Button variant="outline" onClick={onRotate}>
          {t("settings:workspaceWebhooks.secret.rotate")}
        </Button>
      </CardPanel>
    </Card>
  );
}

/** Endpoint, signing secret and danger zone. */
export function WebhookSettingsTab({
  webhook,
  onRotate,
  onDelete,
}: WebhookSettingsTabProps) {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <EndpointCard key={webhook.id} webhook={webhook} />
      <SecretCard webhook={webhook} onRotate={onRotate} />
      <Card className="border-destructive/32">
        <CardHeader>
          <CardTitle className="inline-flex items-center gap-2 text-base">
            <TriangleAlert className="size-4" />
            {t("settings:workspaceWebhooks.danger.title")}
          </CardTitle>
          <CardDescription>
            {t("settings:workspaceWebhooks.danger.description")}
          </CardDescription>
        </CardHeader>
        <CardPanel>
          <Button variant="destructive" onClick={onDelete}>
            {t("settings:workspaceWebhooks.danger.delete")}
          </Button>
        </CardPanel>
      </Card>
    </div>
  );
}

export default WebhookSettingsTab;
