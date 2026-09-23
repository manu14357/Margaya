import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { ArrowLeft, MailCheck } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import { Button } from "@/components/ui/button";
import { AuthLayout } from "../../components/auth/layout";

export const Route = createFileRoute("/auth/check-email")({
  component: CheckEmail,
  validateSearch: (search: Record<string, unknown>) => ({
    email: search.email as string | undefined,
  }),
});

function CheckEmail() {
  const { t } = useTranslation();
  const { email } = useSearch({ from: "/auth/check-email" });

  return (
    <>
      <PageTitle title={t("auth:checkEmail.pageTitle")} />
      <AuthLayout title={t("auth:checkEmail.title")}>
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-lg border border-border bg-card p-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-foreground">
              <MailCheck className="size-4" aria-hidden />
            </span>
            <p className="text-sm text-muted-foreground leading-relaxed">
              <Trans
                i18nKey="auth:checkEmail.inboxMessage"
                values={{
                  email: email || t("auth:checkEmail.emailFallback"),
                }}
                components={{
                  email: <span className="text-foreground font-medium" />,
                }}
              />
            </p>
          </div>

          <Button
            variant="outline"
            render={<Link to="/auth/sign-in" />}
            className="w-full"
          >
            <ArrowLeft className="size-4" />
            {t("auth:checkEmail.backToLogin")}
          </Button>
        </div>
      </AuthLayout>
    </>
  );
}
