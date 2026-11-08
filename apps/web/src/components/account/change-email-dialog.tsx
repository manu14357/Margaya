import { type FormEvent, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import useAuth from "@/components/providers/auth-provider/hooks/use-auth";
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
import { withPushKeptOnThisDevice } from "@/hooks/mutations/notification-preferences/use-push-subscription";
import { authClient } from "@/lib/auth-client";
import { isValidEmail } from "@/lib/instance-settings";
import { toast } from "@/lib/toast";

type Step = "address" | "code";

const CODE_ERRORS = new Set([
  "INVALID_OTP",
  "OTP_EXPIRED",
  "TOO_MANY_ATTEMPTS",
]);

type ChangeEmailDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Moves the account to a new address. A code goes to the new address, and
 * the email changes only once it is entered (Better Auth's email-code
 * change flow); the server then signs out other sessions and tells the old
 * address.
 */
export function ChangeEmailDialog({
  open,
  onOpenChange,
}: ChangeEmailDialogProps) {
  const { t } = useTranslation();
  const { user, refetchUser } = useAuth();
  const emailId = useId();
  const codeId = useId();
  const [step, setStep] = useState<Step>("address");
  const [newEmail, setNewEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  const current = user?.email?.toLowerCase() ?? "";
  const trimmed = newEmail.trim();
  const sameAsCurrent = trimmed.toLowerCase() === current;
  const validEmail = isValidEmail(trimmed) && !sameAsCurrent;

  const reset = () => {
    setStep("address");
    setNewEmail("");
    setCode("");
    setError(null);
  };

  const close = (next: boolean) => {
    onOpenChange(next);
    if (!next) reset();
  };

  const describe = (failure: { code?: string; message?: string } | null) => {
    if (failure?.code === "SESSION_EXPIRED") {
      return t("accountSecurity:emailChange.sessionTooOld");
    }
    if (failure?.code && CODE_ERRORS.has(failure.code)) {
      return t("accountSecurity:emailChange.invalidCode");
    }
    return failure?.message || t("accountSecurity:emailChange.error");
  };

  const sendCode = async (event: FormEvent) => {
    event.preventDefault();
    if (!validEmail) return;
    setIsPending(true);
    setError(null);
    try {
      const { error: failure } = await authClient.emailOtp.requestEmailChange({
        newEmail: trimmed,
      });
      if (failure) {
        setError(describe(failure));
        return;
      }
      setStep("code");
      setCode("");
    } catch {
      setError(t("accountSecurity:emailChange.error"));
    } finally {
      setIsPending(false);
    }
  };

  const confirm = async (event: FormEvent) => {
    event.preventDefault();
    if (code.length !== 6) return;
    setIsPending(true);
    setError(null);
    try {
      const { error: failure } = await withPushKeptOnThisDevice(() =>
        authClient.emailOtp.changeEmail({ newEmail: trimmed, otp: code }),
      );
      if (failure) {
        setError(describe(failure));
        return;
      }
      await refetchUser();
      toast.success(
        t("accountSecurity:emailChange.success", { email: trimmed }),
      );
      close(false);
    } catch {
      setError(t("accountSecurity:emailChange.error"));
    } finally {
      setIsPending(false);
    }
  };

  const formId =
    step === "address" ? "change-email-address" : "change-email-code";

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("accountSecurity:emailChange.title")}</DialogTitle>
          <DialogDescription>
            {step === "address"
              ? t("accountSecurity:emailChange.description")
              : t("accountSecurity:emailChange.codeSent", { email: trimmed })}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          {step === "address" ? (
            <form
              id={formId}
              className="space-y-1.5"
              onSubmit={sendCode}
              noValidate
            >
              <Label htmlFor={emailId}>
                {t("accountSecurity:emailChange.newEmail")}
              </Label>
              <Input
                id={emailId}
                type="email"
                autoComplete="email"
                autoFocus
                placeholder={t(
                  "accountSecurity:emailChange.newEmailPlaceholder",
                )}
                value={newEmail}
                aria-invalid={(trimmed !== "" && !validEmail) || undefined}
                onChange={(event) => setNewEmail(event.target.value)}
              />
              {trimmed !== "" && !validEmail ? (
                <p className="text-xs text-destructive-foreground">
                  {sameAsCurrent
                    ? t("accountSecurity:emailChange.sameEmail")
                    : t("accountSecurity:emailChange.invalidEmail")}
                </p>
              ) : null}
            </form>
          ) : (
            <form
              id={formId}
              className="space-y-1.5"
              onSubmit={confirm}
              noValidate
            >
              <Label htmlFor={codeId}>
                {t("accountSecurity:emailChange.code")}
              </Label>
              <Input
                id={codeId}
                value={code}
                autoFocus
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                onChange={(event) =>
                  setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                }
              />
              <button
                type="button"
                className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                onClick={() => {
                  setStep("address");
                  setError(null);
                }}
              >
                {t("accountSecurity:emailChange.back")}
              </button>
            </form>
          )}
          {error ? (
            <p
              role="alert"
              className="mt-2 text-xs text-destructive-foreground"
            >
              {error}
            </p>
          ) : null}
        </DialogPanel>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => close(false)}>
            {t("common:actions.cancel")}
          </Button>
          <Button
            type="submit"
            form={formId}
            disabled={step === "address" ? !validEmail : code.length !== 6}
            loading={isPending}
          >
            {step === "address"
              ? t("accountSecurity:emailChange.sendCode")
              : t("accountSecurity:emailChange.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
