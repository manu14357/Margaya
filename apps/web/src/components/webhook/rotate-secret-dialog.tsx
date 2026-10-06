import { useId, useState } from "react";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useRotateWebhookSecret } from "@/hooks/mutations/webhook/use-rotate-webhook-secret";
import { toast } from "@/lib/toast";
import { DEFAULT_GRACE_HOURS, GRACE_HOUR_OPTIONS } from "@/lib/webhook/webhook";
import type { WebhookWithSecret } from "@/types/webhook";

type GraceHours = (typeof GRACE_HOUR_OPTIONS)[number];

const GRACE_LABEL_KEYS = {
  0: "settings:workspaceWebhooks.secret.grace0",
  1: "settings:workspaceWebhooks.secret.grace1",
  24: "settings:workspaceWebhooks.secret.grace24",
  72: "settings:workspaceWebhooks.secret.grace72",
} as const satisfies Record<GraceHours, string>;

type RotateSecretDialogProps = {
  webhookId: string;
  onClose: () => void;
  onRotated: (webhook: WebhookWithSecret) => void;
};

/** Rotate with a grace period; the new secret opens in the secret modal. */
export function RotateSecretDialog({
  webhookId,
  onClose,
  onRotated,
}: RotateSecretDialogProps) {
  const { t } = useTranslation();
  const graceId = useId();
  const rotate = useRotateWebhookSecret();
  const [graceHours, setGraceHours] = useState<GraceHours>(DEFAULT_GRACE_HOURS);

  const handleRotate = () =>
    rotate.mutate(
      { id: webhookId, graceHours },
      {
        onSuccess: (webhook) => {
          toast.success(t("settings:workspaceWebhooks.toast.rotated"));
          onRotated(webhook);
        },
        onError: (error) =>
          toast.error(
            error.message || t("settings:workspaceWebhooks.toast.error"),
          ),
      },
    );

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !rotate.isPending) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t("settings:workspaceWebhooks.secret.rotateTitle")}
          </DialogTitle>
          <DialogDescription>
            {t("settings:workspaceWebhooks.secret.rotateDescription")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 px-6 py-4">
          <Label htmlFor={graceId}>
            {t("settings:workspaceWebhooks.secret.graceLabel")}
          </Label>
          <Select
            value={String(graceHours)}
            onValueChange={(value) => {
              const hours = Number(value);
              if (GRACE_HOUR_OPTIONS.includes(hours as GraceHours)) {
                setGraceHours(hours as GraceHours);
              }
            }}
            disabled={rotate.isPending}
          >
            <SelectTrigger id={graceId}>
              <SelectValue>{t(GRACE_LABEL_KEYS[graceHours])}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {GRACE_HOUR_OPTIONS.map((hours) => (
                <SelectItem key={hours} value={String(hours)}>
                  {t(GRACE_LABEL_KEYS[hours])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={rotate.isPending}
          >
            {t("common:actions.cancel")}
          </Button>
          <Button onClick={handleRotate} disabled={rotate.isPending}>
            {rotate.isPending
              ? t("settings:workspaceWebhooks.secret.rotating")
              : t("settings:workspaceWebhooks.secret.rotateConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default RotateSecretDialog;
