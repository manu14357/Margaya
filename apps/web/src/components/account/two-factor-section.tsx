import { useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { PasswordInput } from "@/components/auth/password-input";
import {
  SettingsGroup,
  SettingsRow,
  SettingsSection,
} from "@/components/settings-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import useGetConfig from "@/hooks/queries/config/use-get-config";
import { accountSecurityQueryKey } from "@/hooks/queries/user/use-account-security";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/cn";
import { toast } from "@/lib/toast";

// TOTP two-factor for password sign-in: confirm the password, add the setup
// key to an authenticator app, check one code, keep the recovery codes.

type Step =
  | { kind: "idle" }
  | { kind: "password"; purpose: "enable" | "disable" | "codes" }
  | { kind: "setup"; totpURI: string; backupCodes: string[] }
  | { kind: "codes"; backupCodes: string[] };

/** The base32 setup key of an otpauth:// URI, in groups of four. */
export function setupKeyOf(totpURI: string): string {
  try {
    const secret = new URL(totpURI).searchParams.get("secret") ?? "";
    return secret.replace(/(.{4})/g, "$1 ").trim();
  } catch {
    return "";
  }
}

export function TwoFactorSection({
  enabled,
  setupScreen = false,
  onFinished,
}: {
  enabled: boolean;
  /**
   * The screen for an account that must set this up: a narrow column, where
   * asking for the password is the only thing to do.
   */
  setupScreen?: boolean;
  /** Called when the person is done with their new recovery codes. */
  onFinished?: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: config } = useGetConfig();
  const [step, setStep] = useState<Step>(
    setupScreen ? { kind: "password", purpose: "enable" } : { kind: "idle" },
  );
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const passwordId = useId();
  const codeId = useId();

  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: accountSecurityQueryKey });

  const reset = () => {
    setStep({ kind: "idle" });
    setPassword("");
    setCode("");
  };

  const fail = (message?: string) =>
    toast.error(message || t("accountSecurity:platform.twoFactor.error"));

  const submitPassword = async (purpose: "enable" | "disable" | "codes") => {
    setBusy(true);
    try {
      if (purpose === "enable") {
        const result = await authClient.twoFactor.enable({
          password,
          issuer: config?.instanceName || "Margaya",
        });
        if (result.error || !result.data) return fail(result.error?.message);
        setStep({
          kind: "setup",
          totpURI: result.data.totpURI,
          backupCodes: result.data.backupCodes,
        });
      } else if (purpose === "disable") {
        const result = await authClient.twoFactor.disable({ password });
        if (result.error) return fail(result.error.message);
        toast.success(t("accountSecurity:platform.twoFactor.disabled"));
        reset();
        refresh();
      } else {
        const result = await authClient.twoFactor.generateBackupCodes({
          password,
        });
        if (result.error || !result.data) return fail(result.error?.message);
        setStep({ kind: "codes", backupCodes: result.data.backupCodes });
      }
      setPassword("");
    } finally {
      setBusy(false);
    }
  };

  const verify = async (backupCodes: string[]) => {
    setBusy(true);
    try {
      const result = await authClient.twoFactor.verifyTotp({
        code: code.trim(),
      });
      if (result.error) {
        return fail(t("accountSecurity:platform.twoFactor.invalidCode"));
      }
      toast.success(t("accountSecurity:platform.twoFactor.enabled"));
      setCode("");
      setStep({ kind: "codes", backupCodes });
      refresh();
    } finally {
      setBusy(false);
    }
  };

  const copyCodes = async (codes: string[]) => {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      toast.success(t("accountSecurity:platform.twoFactor.copied"));
    } catch {
      fail();
    }
  };

  return (
    <SettingsSection
      title={t("accountSecurity:platform.twoFactor.title")}
      description={t("accountSecurity:platform.twoFactor.description")}
    >
      <SettingsGroup>
        <SettingsRow
          label={t("accountSecurity:platform.twoFactor.authenticator")}
          description={
            enabled && config?.requireTwoFactor
              ? t("accountSecurity:platform.twoFactor.requiredHint")
              : undefined
          }
          badge={
            <Badge
              variant={enabled || step.kind === "codes" ? "success" : "outline"}
              size="sm"
            >
              {enabled || step.kind === "codes"
                ? t("accountSecurity:platform.twoFactor.on")
                : t("accountSecurity:platform.twoFactor.off")}
            </Badge>
          }
        >
          {step.kind === "idle" &&
            (enabled ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setStep({ kind: "password", purpose: "codes" })
                  }
                >
                  {t("accountSecurity:platform.twoFactor.newCodes")}
                </Button>
                {!config?.requireTwoFactor && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setStep({ kind: "password", purpose: "disable" })
                    }
                  >
                    {t("accountSecurity:platform.twoFactor.turnOff")}
                  </Button>
                )}
              </div>
            ) : (
              <Button
                size="sm"
                onClick={() => setStep({ kind: "password", purpose: "enable" })}
              >
                {t("accountSecurity:platform.twoFactor.turnOn")}
              </Button>
            ))}
        </SettingsRow>

        {step.kind === "password" && (
          <SettingsRow
            stacked
            label={t("accountSecurity:platform.twoFactor.confirmPassword")}
            htmlFor={passwordId}
          >
            <form
              className={
                setupScreen
                  ? "flex flex-col gap-2"
                  : "flex flex-col gap-2 sm:flex-row"
              }
              onSubmit={(event) => {
                event.preventDefault();
                void submitPassword(step.purpose);
              }}
            >
              <PasswordInput
                id={passwordId}
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="sm:max-w-xs"
              />
              <div className="flex gap-2">
                <Button
                  type="submit"
                  size="sm"
                  loading={busy}
                  disabled={!password}
                >
                  {t("accountSecurity:platform.twoFactor.continue")}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={reset}>
                  {t("common:actions.cancel")}
                </Button>
              </div>
            </form>
          </SettingsRow>
        )}

        {step.kind === "setup" && (
          <SettingsRow
            stacked
            label={t("accountSecurity:platform.twoFactor.setupTitle")}
            description={t("accountSecurity:platform.twoFactor.setupHint")}
          >
            <div className="space-y-3">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">
                  {t("accountSecurity:platform.twoFactor.setupKey")}
                </p>
                <code className="block break-all rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-sm tracking-wide select-all">
                  {setupKeyOf(step.totpURI)}
                </code>
                <a
                  href={step.totpURI}
                  className="text-xs text-primary underline-offset-2 hover:underline"
                >
                  {t("accountSecurity:platform.twoFactor.openApp")}
                </a>
              </div>
              <form
                className={
                  setupScreen
                    ? "flex flex-col gap-2"
                    : "flex flex-col gap-2 sm:flex-row sm:items-end"
                }
                onSubmit={(event) => {
                  event.preventDefault();
                  void verify(step.backupCodes);
                }}
              >
                <div className="space-y-1">
                  <Label htmlFor={codeId}>
                    {t("accountSecurity:platform.twoFactor.code")}
                  </Label>
                  <Input
                    id={codeId}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    className="w-32 font-mono tracking-widest"
                    value={code}
                    onChange={(event) =>
                      setCode(event.target.value.replace(/\D/g, ""))
                    }
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    type="submit"
                    size="sm"
                    loading={busy}
                    disabled={code.length !== 6}
                  >
                    {t("accountSecurity:platform.twoFactor.verify")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={reset}
                  >
                    {t("common:actions.cancel")}
                  </Button>
                </div>
              </form>
            </div>
          </SettingsRow>
        )}

        {step.kind === "codes" && (
          <SettingsRow
            stacked
            label={t("accountSecurity:platform.twoFactor.codesTitle")}
            description={t("accountSecurity:platform.twoFactor.codesHint")}
          >
            <div className="space-y-3">
              <ul
                className={cn(
                  "grid grid-cols-2 gap-1 rounded-md border border-border bg-muted/40 p-3 font-mono text-sm",
                  !setupScreen && "sm:grid-cols-5",
                )}
              >
                {step.backupCodes.map((backupCode) => (
                  <li key={backupCode}>{backupCode}</li>
                ))}
              </ul>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void copyCodes(step.backupCodes)}
                >
                  {t("accountSecurity:platform.twoFactor.copyCodes")}
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    reset();
                    onFinished?.();
                  }}
                >
                  {t("accountSecurity:platform.twoFactor.done")}
                </Button>
              </div>
            </div>
          </SettingsRow>
        )}
      </SettingsGroup>
    </SettingsSection>
  );
}
