import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

type TwoFactorChallengeProps = {
  onSuccess: () => void;
  onBack: () => void;
};

/**
 * The second sign-in step for accounts with two-factor on: a code from the
 * authenticator app, or one of the recovery codes. Better Auth keeps the
 * half-finished sign-in in a short-lived cookie (10 minutes).
 */
export function TwoFactorChallenge({
  onSuccess,
  onBack,
}: TwoFactorChallengeProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<"totp" | "recovery">("totp");
  const [code, setCode] = useState("");
  const [trustDevice, setTrustDevice] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const codeId = useId();
  const trustId = useId();

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const result =
        mode === "totp"
          ? await authClient.twoFactor.verifyTotp({
              code: code.trim(),
              trustDevice,
            })
          : await authClient.twoFactor.verifyBackupCode({
              code: code.trim(),
              trustDevice,
            });
      if (result.error) {
        setError(t("accountSecurity:platform.challenge.invalid"));
        return;
      }
      onSuccess();
    } catch {
      setError(t("accountSecurity:platform.challenge.invalid"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="space-y-1">
        <h2 className="text-base font-semibold">
          {t("accountSecurity:platform.challenge.title")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {mode === "totp"
            ? t("accountSecurity:platform.challenge.totpHint")
            : t("accountSecurity:platform.challenge.recoveryHint")}
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={codeId}>
          {mode === "totp"
            ? t("accountSecurity:platform.twoFactor.code")
            : t("accountSecurity:platform.challenge.recoveryCode")}
        </Label>
        <Input
          id={codeId}
          autoFocus
          autoComplete="one-time-code"
          inputMode={mode === "totp" ? "numeric" : "text"}
          maxLength={mode === "totp" ? 6 : 32}
          className="font-mono tracking-widest"
          value={code}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${codeId}-error` : undefined}
          onChange={(event) =>
            setCode(
              mode === "totp"
                ? event.target.value.replace(/\D/g, "")
                : event.target.value,
            )
          }
        />
        {error && (
          <p
            id={`${codeId}-error`}
            role="alert"
            className="text-xs text-destructive-foreground"
          >
            {error}
          </p>
        )}
      </div>
      <Label htmlFor={trustId} className="flex items-center gap-2 font-normal">
        <Checkbox
          id={trustId}
          checked={trustDevice}
          onCheckedChange={(checked) => setTrustDevice(checked === true)}
        />
        {t("accountSecurity:platform.challenge.trustDevice")}
      </Label>
      <Button
        type="submit"
        className="w-full"
        loading={busy}
        disabled={mode === "totp" ? code.length !== 6 : code.trim().length < 4}
      >
        {t("accountSecurity:platform.twoFactor.verify")}
      </Button>
      <div className="flex flex-wrap justify-between gap-2 text-xs">
        <button
          type="button"
          className="text-muted-foreground underline-offset-4 hover:text-primary hover:underline"
          onClick={() => {
            setMode(mode === "totp" ? "recovery" : "totp");
            setCode("");
            setError(null);
          }}
        >
          {mode === "totp"
            ? t("accountSecurity:platform.challenge.useRecovery")
            : t("accountSecurity:platform.challenge.useApp")}
        </button>
        <button
          type="button"
          className="text-muted-foreground underline-offset-4 hover:text-primary hover:underline"
          onClick={onBack}
        >
          {t("accountSecurity:platform.challenge.back")}
        </button>
      </div>
    </form>
  );
}
