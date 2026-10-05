import { createFileRoute } from "@tanstack/react-router";
import { Mail } from "lucide-react";
import { useTranslation } from "react-i18next";
import { EmailVerificationPrompt } from "@/components/account/email-verification-prompt";
import Layout from "@/components/common/layout";
import { PendingInvitationList } from "@/components/invitation/pending-invitation-list";
import PageTitle from "@/components/page-title";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { usePendingInvitations } from "@/hooks/queries/invitation/use-pending-invitations";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/invitations",
)({
  component: InvitationsPage,
});

function InvitationsPage() {
  const { t } = useTranslation();
  const { data: invitations = [], isLoading } = usePendingInvitations();

  return (
    <>
      <PageTitle title={t("invitations:pageTitle")} />
      <Layout>
        <Layout.Header>
          <div className="flex items-center gap-1 w-full">
            <SidebarTrigger className="-ml-1 h-6 w-6" />
            <Separator
              orientation="vertical"
              className="mx-1.5 data-[orientation=vertical]:h-2.5"
            />
            <h1 className="text-xs text-card-foreground">
              {t("invitations:pendingInvitations")}
            </h1>
          </div>
        </Layout.Header>
        <Layout.Content>
          <div className="mx-auto w-full max-w-3xl space-y-4 p-4 sm:p-6">
            <p className="text-sm text-muted-foreground">
              {t("invitations:acceptSubtitle")}
            </p>
            <EmailVerificationPrompt variant="invitations" />
            {isLoading ? (
              <div className="space-y-2" aria-busy="true">
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
              </div>
            ) : invitations.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-muted">
                  <Mail className="size-5 text-muted-foreground" aria-hidden />
                </div>
                <h2 className="mb-1 text-base">
                  {t("invitations:noPendingTitle")}
                </h2>
                <p className="max-w-md text-sm text-muted-foreground">
                  {t("invitations:noPendingDescription")}
                </p>
              </div>
            ) : (
              <PendingInvitationList invitations={invitations} />
            )}
          </div>
        </Layout.Content>
      </Layout>
    </>
  );
}
