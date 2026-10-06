import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowRight, Mail } from "lucide-react";
import { useTranslation } from "react-i18next";
import { EmailVerificationPrompt } from "@/components/account/email-verification-prompt";
import { PendingInvitationList } from "@/components/invitation/pending-invitation-list";
import {
  SetupHeading,
  SetupLayout,
} from "@/components/onboarding/setup-layout";
import PageTitle from "@/components/page-title";
import useAuth from "@/components/providers/auth-provider/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { usePendingInvitations } from "@/hooks/queries/invitation/use-pending-invitations";

export const Route = createFileRoute("/_layout/_authenticated/invitations")({
  component: InvitationsPage,
});

function InvitationsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: invitations = [], isLoading } = usePendingInvitations();
  const { user } = useAuth();

  const handleSkip = () => {
    if (!user?.name) {
      navigate({ to: "/profile-setup" });
      return;
    }
    navigate({ to: "/onboarding" });
  };

  return (
    <>
      <PageTitle title={t("invitations:pageTitle")} />
      <SetupLayout>
        <div className="space-y-6">
          <SetupHeading
            title={t("invitations:pendingInvitations")}
            description={t("invitations:acceptSubtitle")}
          />

          <EmailVerificationPrompt variant="invitations" />

          {isLoading ? (
            <div className="space-y-2" aria-busy="true">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          ) : invitations.length === 0 ? (
            <div className="flex items-start gap-3 rounded-lg border border-border bg-card p-4">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <Mail className="size-4" aria-hidden />
              </span>
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">
                  {t("invitations:noPendingTitle")}
                </p>
                <p className="text-sm text-muted-foreground">
                  {t("invitations:noPendingDescription")}
                </p>
              </div>
            </div>
          ) : (
            <PendingInvitationList invitations={invitations} />
          )}

          <div className="flex justify-end">
            {invitations.length === 0 && !isLoading ? (
              <Button onClick={handleSkip}>
                {t("invitations:continueToSetup")}
                <ArrowRight className="size-4" />
              </Button>
            ) : (
              <Button
                variant="ghost"
                onClick={handleSkip}
                className="text-muted-foreground hover:text-foreground"
              >
                {t("invitations:skipForNow")}
              </Button>
            )}
          </div>
        </div>
      </SetupLayout>
    </>
  );
}
