import { CircleCheck, CircleX } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { useSendInstanceTestEmail } from "@/hooks/mutations/instance-admin/use-instance-admin-mutations";
import { isValidEmail } from "@/lib/instance-settings";
import type { SmtpTestCode } from "@/types/instance-admin";

const CODE_MESSAGES: Record<Exclude<SmtpTestCode, "ok">, string> = {
  auth: "instanceAdmin:testEmail.codes.auth",
  connection: "instanceAdmin:testEmail.codes.connection",
  timeout: "instanceAdmin:testEmail.codes.timeout",
  tls: "instanceAdmin:testEmail.codes.tls",
  sender: "instanceAdmin:testEmail.codes.sender",
  recipient: "instanceAdmin:testEmail.codes.recipient",
  unknown: "instanceAdmin:testEmail.codes.unknown",
};

type Step =
  | { kind: "form" }
  | { kind: "sending" }
  | { kind: "success"; address: string }
  | { kind: "failure"; message: string };

type TestEmailDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultRecipient: string;
};

/** Sends a test message with the saved settings and explains a failure. */
export function TestEmailDialog({
  open,
  onOpenChange,
  defaultRecipient,
}: TestEmailDialogProps) {
  const { t } = useTranslation();
  const [recipient, setRecipient] = useState(defaultRecipient);
  const [step, setStep] = useState<Step>({ kind: "form" });
  const { mutateAsync } = useSendInstanceTestEmail();
  const valid = isValidEmail(recipient);

  // The session can load after the page; default to my address on open.
  useEffect(() => {
    if (open) setRecipient((current) => current || defaultRecipient);
  }, [open, defaultRecipient]);

  const handleOpenChange = (next: boolean) => {
    if (step.kind === "sending") return;
    onOpenChange(next);
    if (!next) {
      setStep({ kind: "form" });
      setRecipient(defaultRecipient);
    }
  };

  const send = async () => {
    if (!valid) return;
    const address = recipient.trim();
    setStep({ kind: "sending" });
    try {
      const result = await mutateAsync(address);
      if (result.sent) {
        setStep({ kind: "success", address });
        return;
      }
      const key = result.code === "ok" ? null : CODE_MESSAGES[result.code];
      setStep({
        kind: "failure",
        message: key ? t(key) : result.message,
      });
    } catch (error) {
      // Not set up (409), too many tests (429), an invalid recipient (400).
      setStep({
        kind: "failure",
        message:
          error instanceof Error && error.message
            ? error.message
            : t("instanceAdmin:testEmail.codes.unknown"),
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("instanceAdmin:testEmail.title")}</DialogTitle>
          <DialogDescription>
            {t("instanceAdmin:testEmail.description")}
          </DialogDescription>
        </DialogHeader>

        <DialogPanel className="space-y-3">
          {(step.kind === "form" || step.kind === "sending") && (
            <form
              id="instance-test-email"
              className="space-y-1.5"
              onSubmit={(event) => {
                event.preventDefault();
                void send();
              }}
            >
              <Label htmlFor="test-email-recipient">
                {t("instanceAdmin:testEmail.recipient")}
              </Label>
              <Input
                id="test-email-recipient"
                type="email"
                value={recipient}
                disabled={step.kind === "sending"}
                aria-invalid={(recipient !== "" && !valid) || undefined}
                onChange={(event) => setRecipient(event.target.value)}
              />
              {recipient !== "" && !valid && (
                <p className="text-xs text-destructive-foreground">
                  {t("instanceAdmin:testEmail.recipientInvalid")}
                </p>
              )}
            </form>
          )}

          {step.kind === "sending" && (
            <p
              role="status"
              className="flex items-center gap-2 text-sm text-muted-foreground"
            >
              <Spinner className="size-4" aria-hidden />
              {t("instanceAdmin:testEmail.sending")}
            </p>
          )}

          {step.kind === "success" && (
            <p
              role="status"
              className="flex items-start gap-2 text-sm text-success-foreground"
            >
              <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
              {t("instanceAdmin:testEmail.success", {
                address: step.address,
              })}
            </p>
          )}

          {step.kind === "failure" && (
            <div role="alert" className="space-y-1">
              <p className="flex items-center gap-2 text-sm font-medium text-destructive-foreground">
                <CircleX className="size-4 shrink-0" aria-hidden />
                {t("instanceAdmin:testEmail.failure")}
              </p>
              <p className="text-sm text-muted-foreground">{step.message}</p>
            </div>
          )}
        </DialogPanel>

        <DialogFooter>
          {step.kind === "success" ? (
            <Button type="button" onClick={() => handleOpenChange(false)}>
              {t("instanceAdmin:testEmail.done")}
            </Button>
          ) : step.kind === "failure" ? (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
              >
                {t("common:actions.close")}
              </Button>
              <Button type="button" onClick={() => void send()}>
                {t("instanceAdmin:testEmail.tryAgain")}
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={step.kind === "sending"}
                onClick={() => handleOpenChange(false)}
              >
                {t("common:actions.cancel")}
              </Button>
              <Button
                type="submit"
                form="instance-test-email"
                disabled={!valid}
                loading={step.kind === "sending"}
              >
                {t("instanceAdmin:testEmail.send")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
