import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { z } from "zod/v4";
import { AuthLayout } from "@/components/auth/layout";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import PageTitle from "@/components/page-title";

// The reset email links here with ?token=…; Better Auth's own callback can
// also send ?error=INVALID_TOKEN, which shows the same expired-link notice.
export const Route = createFileRoute("/auth/reset-password")({
  component: ResetPassword,
  validateSearch: z.object({
    token: z.string().optional(),
    error: z.string().optional(),
  }),
});

function ResetPassword() {
  const { t } = useTranslation();
  const { token, error } = useSearch({ from: "/auth/reset-password" });

  return (
    <>
      <PageTitle title={t("auth:resetPassword.pageTitle")} />
      <AuthLayout
        title={t("auth:resetPassword.title")}
        subtitle={t("auth:resetPassword.subtitle")}
      >
        <ResetPasswordForm token={error ? undefined : token} />
      </AuthLayout>
    </>
  );
}
