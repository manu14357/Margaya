import { useQueryClient } from "@tanstack/react-query";
import { MailCheck } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import useAuth from "@/components/providers/auth-provider/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import useGetConfig from "@/hooks/queries/config/use-get-config";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/cn";
import { toast } from "@/lib/toast";

type Variant = "invitations" | "settings";

/**
 * Whether the signed-in user can verify their address here: a real (not
 * guest) account, still unverified, on a server that can send the code.
 */
export function useNeedsEmailVerification() {
  const { user } = useAuth();
  const { data: config } = useGetConfig();
  const isGuest = Boolean(
    (user as { isAnonymous?: boolean | null } | null)?.isAnonymous,
  );
  return Boolean(
    user?.email && !user.emailVerified && !isGuest && config?.hasSmtp,
  );
}

/**
 * Verifies the user's email with a 6-digit code (Better Auth's email-code
 * plugin). Invitations to an unverified address stay hidden, so this is how
 * a password account gets to see them.
 */
export function EmailVerificationPrompt({
  variant,
  className,
}: {
  variant: Variant;
  className?: string;
}) {
  const { t } = useTranslation();
  const { user, refetchUser } = useAuth();
  const queryClient = useQueryClient();
  const needsVerification = useNeedsEmailVerification();
  const codeId = useId();
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);

  if (!needsVerification || !user) return null;
  const email = user.email;

  const sendCode = async () => {
    setIsSending(true);
    try {
      const { error } = await authClient.emailOtp.sendVerificationOtp({
        email,
        type: "email-verification",
      });
      if (error) {
        toast.error(error.message || t("auth:emailVerification.sendFailed"));
        return;
      }
      setCodeSent(true);
      setCode("");
    } catch {
      toast.error(t("auth:emailVerification.sendFailed"));
    } finally {
      setIsSending(false);
    }
  };

  const verify = async (event: FormEvent) => {
    event.preventDefault();
    if (code.length !== 6) return;
    setIsVerifying(true);
    try {
      const { error } = await authClient.emailOtp.verifyEmail({
        email,
        otp: code,
      });
      if (error) {
        toast.error(t("auth:emailVerification.verifyFailed"));
        return;
      }
      toast.success(t("auth:emailVerification.success"));
      await refetchUser();
      await queryClient.invalidateQueries({
        queryKey: ["invitations", "pending"],
      });
    } catch {
      toast.error(t("auth:emailVerification.verifyFailed"));
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border border-border bg-card p-4",
        className,
      )}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <MailCheck className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1 space-y-3">
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">
            {t("auth:emailVerification.title")}
          </p>
          <p className="text-sm text-muted-foreground">
            {codeSent
              ? t("auth:emailVerification.codeSent", { email })
              : variant === "invitations"
                ? t("auth:emailVerification.invitationsDescription", { email })
                : t("auth:emailVerification.settingsDescription", { email })}
          </p>
        </div>
        {codeSent ? (
          <form
            onSubmit={verify}
            className="flex flex-wrap items-end gap-2"
            noValidate
          >
            <div className="space-y-1.5">
              <Label htmlFor={codeId} className="text-xs font-medium">
                {t("auth:emailVerification.codeLabel")}
              </Label>
              <Input
                id={codeId}
                value={code}
                onChange={(event) =>
                  setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                }
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                className="w-32 font-mono tracking-widest"
                placeholder="000000"
              />
            </div>
            <Button
              type="submit"
              size="sm"
              disabled={code.length !== 6 || isVerifying}
            >
              {isVerifying
                ? t("auth:emailVerification.verifying")
                : t("auth:emailVerification.verify")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={isSending}
              onClick={sendCode}
            >
              {t("auth:emailVerification.resend")}
            </Button>
          </form>
        ) : (
          <Button size="sm" disabled={isSending} onClick={sendCode}>
            {isSending
              ? t("auth:emailVerification.sending")
              : t("auth:emailVerification.sendCode")}
          </Button>
        )}
      </div>
    </div>
  );
}
