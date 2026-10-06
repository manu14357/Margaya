import { Check, Copy, ExternalLink } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { copyToClipboard } from "@/lib/copy-to-clipboard";
import { toast } from "@/lib/toast";
import { WEBHOOK_SIGNATURE_DOCS_URL } from "@/lib/webhook/webhook";

type WebhookSecretModalProps = {
  /** The secret from create or rotate; it is never fetched again. */
  secret: string;
  onClose: () => void;
};

/** Shows a new signing secret once; Done unlocks after it was copied. */
export function WebhookSecretModal({
  secret,
  onClose,
}: WebhookSecretModalProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (await copyToClipboard(secret)) {
      toast.success(t("settings:workspaceWebhooks.secret.toastCopied"));
    } else {
      toast.error(t("settings:workspaceWebhooks.secret.copyFailed"));
    }
    // A failed copy still unlocks Done: the secret can be selected by hand.
    setCopied(true);
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && copied) onClose();
      }}
    >
      <DialogContent className="max-w-[446px]" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>
            {t("settings:workspaceWebhooks.secret.modalTitle")}
          </DialogTitle>
          <DialogDescription>
            {t("settings:workspaceWebhooks.secret.modalDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-6 py-4">
          <div className="space-y-2">
            <div className="flex items-center justify-end">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCopy}
                className="h-7 gap-1.5 text-xs"
              >
                {copied ? (
                  <>
                    <Check className="h-3 w-3 text-success-foreground" />
                    {t("settings:workspaceWebhooks.secret.copied")}
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" />
                    {t("settings:workspaceWebhooks.secret.copy")}
                  </>
                )}
              </Button>
            </div>
            <input
              readOnly
              value={secret}
              aria-label={t("settings:workspaceWebhooks.secret.modalTitle")}
              onFocus={(event) => event.currentTarget.select()}
              className="w-full rounded-sm border border-border bg-sidebar p-2.5 font-mono text-foreground text-xs outline-none"
            />
          </div>

          <Alert variant="warning">
            <AlertDescription>
              {t("settings:workspaceWebhooks.secret.warning")}
            </AlertDescription>
          </Alert>

          <a
            href={WEBHOOK_SIGNATURE_DOCS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-primary text-sm hover:underline"
          >
            {t("settings:workspaceWebhooks.secret.docsLink")}
            <ExternalLink className="size-3.5" />
          </a>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            onClick={onClose}
            disabled={!copied}
            className="h-8 w-full text-xs sm:w-auto"
          >
            {copied
              ? t("settings:workspaceWebhooks.secret.done")
              : t("settings:workspaceWebhooks.secret.copyToContinue")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default WebhookSecretModal;
