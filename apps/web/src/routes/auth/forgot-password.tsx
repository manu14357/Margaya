import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod/v4";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { AuthLayout } from "@/components/auth/layout";
import { SignInFormSkeleton } from "@/components/auth/sign-in-form-skeleton";
import { Turnstile } from "@/components/auth/turnstile";
import PageTitle from "@/components/page-title";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import useGetConfig from "@/hooks/queries/config/use-get-config";

const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as
  | string
  | undefined;

export const Route = createFileRoute("/auth/forgot-password")({
  component: ForgotPassword,
  validateSearch: z.object({ email: z.string().optional() }),
});

function ForgotPassword() {
  const { t } = useTranslation();
  const { email } = useSearch({ from: "/auth/forgot-password" });
  const { data: config, isLoading } = useGetConfig();
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [captchaKey, setCaptchaKey] = useState(0);
  const resetCaptcha = useCallback(() => {
    setTurnstileToken(null);
    setCaptchaKey((key) => key + 1);
  }, []);

  return (
    <>
      <PageTitle
        title={t("auth:forgotPassword.pageTitle")}
        suffix={config?.instanceName || undefined}
      />
      <AuthLayout
        title={t("auth:forgotPassword.title")}
        subtitle={t("auth:forgotPassword.subtitle")}
      >
        <div className="space-y-4">
          {isLoading ? (
            <SignInFormSkeleton />
          ) : config?.passwordResetEnabled ? (
            <>
              {TURNSTILE_SITE_KEY && (
                <Turnstile
                  key={captchaKey}
                  siteKey={TURNSTILE_SITE_KEY}
                  onVerify={setTurnstileToken}
                  onExpire={() => setTurnstileToken(null)}
                  onError={() => setTurnstileToken(null)}
                />
              )}
              <ForgotPasswordForm
                defaultEmail={email}
                turnstileToken={TURNSTILE_SITE_KEY ? turnstileToken : undefined}
                onAttemptComplete={
                  TURNSTILE_SITE_KEY ? resetCaptcha : undefined
                }
              />
            </>
          ) : (
            <Alert>
              <AlertDescription>
                {t("auth:forgotPassword.unavailable")}
              </AlertDescription>
            </Alert>
          )}
          <Button
            variant="ghost"
            render={<Link to="/auth/sign-in" />}
            className="w-full"
          >
            <ArrowLeft className="size-4" />
            {t("auth:forgotPassword.backToSignIn")}
          </Button>
        </div>
      </AuthLayout>
    </>
  );
}
