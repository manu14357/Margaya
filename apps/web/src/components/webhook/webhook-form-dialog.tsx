import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCreateWebhook } from "@/hooks/mutations/webhook/use-create-webhook";
import { HttpError } from "@/lib/http-error";
import { toast } from "@/lib/toast";
import { ALL_EVENTS_PATTERN } from "@/lib/webhook/patterns";
import {
  isValidWebhookUrl,
  type WebhookFormValues,
} from "@/lib/webhook/webhook";
import type { WebhookWithSecret } from "@/types/webhook";
import { WebhookEndpointFields } from "./webhook-endpoint-fields";

const EMPTY_VALUES: WebhookFormValues = {
  name: "",
  url: "",
  events: [ALL_EVENTS_PATTERN],
  isActive: true,
};

type WebhookFormDialogProps = {
  workspaceId: string;
  onClose: () => void;
  onCreated: (webhook: WebhookWithSecret) => void;
};

/** "Create webhook": the server's URL checks answer under the URL field. */
export function WebhookFormDialog({
  workspaceId,
  onClose,
  onCreated,
}: WebhookFormDialogProps) {
  const { t } = useTranslation();
  const createWebhook = useCreateWebhook();
  const [values, setValues] = useState(EMPTY_VALUES);
  const [submitted, setSubmitted] = useState(false);
  const [serverUrlError, setServerUrlError] = useState<string | null>(null);
  const isPending = createWebhook.isPending;

  const urlInvalid = !isValidWebhookUrl(values.url);
  const urlError =
    serverUrlError ??
    (submitted && urlInvalid
      ? t("settings:workspaceWebhooks.form.urlInvalid")
      : null);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (isPending) return;
    setSubmitted(true);
    if (urlInvalid || values.events.length === 0) return;

    createWebhook.mutate(
      {
        workspaceId,
        name: values.name.trim() || null,
        url: values.url.trim(),
        events: values.events,
        isActive: values.isActive,
      },
      {
        onSuccess: (webhook) => {
          toast.success(t("settings:workspaceWebhooks.toast.created"));
          onCreated(webhook);
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
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !isPending) onClose();
      }}
    >
      <DialogContent className="gap-0 p-0 sm:max-w-xl">
        <DialogHeader className="border-border border-b px-6 py-5">
          <DialogTitle>
            {t("settings:workspaceWebhooks.form.createTitle")}
          </DialogTitle>
          <DialogDescription>
            {t("settings:workspaceWebhooks.form.createDescription")}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} noValidate>
          <div className="max-h-[65vh] overflow-y-auto px-6 py-5">
            <WebhookEndpointFields
              values={values}
              onChange={setValues}
              urlError={urlError}
              onUrlEdited={() => setServerUrlError(null)}
              showErrors={submitted}
              disabled={isPending}
            />
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isPending}
            >
              {t("common:actions.cancel")}
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending
                ? t("settings:workspaceWebhooks.form.creating")
                : t("settings:workspaceWebhooks.form.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default WebhookFormDialog;
