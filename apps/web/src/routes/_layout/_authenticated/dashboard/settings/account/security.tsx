import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ActiveSessionsSection } from "@/components/account/active-sessions-section";
import { ChangePasswordSection } from "@/components/account/change-password-section";
import {
  EmailVerificationPrompt,
  useNeedsEmailVerification,
} from "@/components/account/email-verification-prompt";
import useAuth from "@/components/providers/auth-provider/hooks/use-auth";
import {
  SettingsGroup,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from "@/components/settings-layout";
import { Badge } from "@/components/ui/badge";
import useAccountSecurity from "@/hooks/queries/user/use-account-security";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/account/security",
)({
  component: SecurityPage,
});

function SecurityPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const needsVerification = useNeedsEmailVerification();
  const { data, isLoading, isError } = useAccountSecurity();

  return (
    <SettingsPage
      title={t("settings:securityPage.title")}
      documentTitle={t("settings:securityPage.pageTitle")}
      description={t("settings:securityPage.subtitle")}
    >
      {user?.emailVerified || needsVerification ? (
        <SettingsSection
          title={t("settings:securityPage.emailTitle")}
          description={t("settings:securityPage.emailSubtitle")}
        >
          {needsVerification ? (
            <EmailVerificationPrompt variant="settings" />
          ) : (
            <SettingsGroup>
              <SettingsRow
                label={user?.email ?? ""}
                badge={
                  <Badge variant="success" size="sm">
                    {t("auth:emailVerification.verifiedBadge")}
                  </Badge>
                }
              />
            </SettingsGroup>
          )}
        </SettingsSection>
      ) : null}

      {data?.hasPassword ? <ChangePasswordSection /> : null}

      <ActiveSessionsSection
        sessions={data?.sessions}
        isLoading={isLoading}
        isError={isError}
      />
    </SettingsPage>
  );
}
