import { createFileRoute, redirect } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { z } from "zod/v4";
import { TwoFactorSection } from "@/components/account/two-factor-section";
import { AuthLayout } from "@/components/auth/layout";
import PageTitle from "@/components/page-title";
import { Button } from "@/components/ui/button";
import getAccountSecurity from "@/fetchers/user/get-account-security";
import useSignOut from "@/hooks/mutations/use-sign-out";
import { authClient } from "@/lib/auth-client";
import { returnPathAfterSetup } from "@/lib/two-factor-required";

// Where an account lands when the server requires two-factor and it isn't set
// up yet. It sits outside /auth, which sends signed-in people to the dashboard,
// and outside the signed-in layout, whose requests would all be refused.

export const Route = createFileRoute("/two-factor-setup")({
  validateSearch: z.object({ redirect: z.string().optional() }),
  beforeLoad: async ({ search }) => {
    const { data: session } = await authClient
      .getSession()
      .catch(() => ({ data: null }));
    if (!session) {
      throw redirect({
        to: "/auth/sign-in",
        search: { redirect: search.redirect },
      });
    }
    // Nothing to do here (any more). When it can't tell, the screen still works.
    const security = await getAccountSecurity().catch(() => null);
    if (security?.twoFactorEnabled || security?.twoFactorRequired === false) {
      throw redirect({ href: returnPathAfterSetup(search.redirect) });
    }
  },
  component: TwoFactorSetup,
});

function TwoFactorSetup() {
  const { t } = useTranslation();
  const search = Route.useSearch();
  const signOut = useSignOut();

  return (
    <>
      <PageTitle
        title={t("accountSecurity:platform.twoFactor.setupRequiredTitle")}
      />
      <AuthLayout
        title={t("accountSecurity:platform.twoFactor.setupRequiredTitle")}
        subtitle={t("accountSecurity:platform.twoFactor.setupRequiredHint")}
      >
        <div className="space-y-4">
          <TwoFactorSection
            enabled={false}
            setupScreen
            // A full load: everything cached so far was refused.
            onFinished={() =>
              window.location.replace(returnPathAfterSetup(search.redirect))
            }
          />
          <Button
            variant="ghost"
            size="sm"
            className="w-full"
            loading={signOut.isPending}
            onClick={() => signOut.mutate()}
          >
            {t("accountSecurity:platform.twoFactor.signOutInstead")}
          </Button>
        </div>
      </AuthLayout>
    </>
  );
}
