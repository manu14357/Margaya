import {
  createFileRoute,
  Link,
  useNavigate,
  useParams,
} from "@tanstack/react-router";
import {
  AlertCircle,
  CheckCircle,
  Clock,
  Loader2,
  LogIn,
  type LucideIcon,
  UserPlus,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useGetInvitationDetails } from "@/hooks/queries/invitation/use-get-invitation-details";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/cn";
import { toast } from "@/lib/toast";
import { AuthLayout } from "../../components/auth/layout";

export const Route = createFileRoute("/invitation/accept/$inviteId")({
  component: AcceptInvitation,
});

function AcceptInvitation() {
  const { t } = useTranslation();
  const { inviteId } = useParams({
    from: "/invitation/accept/$inviteId",
  });
  const navigate = useNavigate();
  const [isAccepting, setIsAccepting] = useState(false);

  const { data: session, isPending: isSessionLoading } =
    authClient.useSession();
  const {
    data: invitationData,
    isLoading: isInvitationLoading,
    error: invitationError,
  } = useGetInvitationDetails(inviteId);

  const isLoading = isSessionLoading || isInvitationLoading;
  const isSignedIn = !!session?.user;

  const handleAcceptInvitation = async () => {
    setIsAccepting(true);
    try {
      const { data, error } = await authClient.organization.acceptInvitation({
        invitationId: inviteId,
      });

      if (error) {
        toast.error(error.message || t("auth:invitation.toast.acceptFailed"));
        return;
      }

      await authClient.organization.setActive({
        organizationId: data?.invitation.organizationId,
      });

      toast.success(t("auth:invitation.toast.acceptSuccess"));

      if (!session?.user?.name) {
        navigate({ to: "/profile-setup" });
        return;
      }

      navigate({
        to: "/dashboard/workspace/$workspaceId",
        params: { workspaceId: data?.invitation.organizationId || "" },
      });
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("auth:invitation.toast.acceptFailed"),
      );
    } finally {
      setIsAccepting(false);
    }
  };

  const handleSignIn = () => {
    const email = invitationData?.invitation?.email;
    navigate({
      to: "/auth/sign-in",
      search: { invitationId: inviteId, email },
    });
  };

  // Invitees without an account need the sign-up page: sign-in cannot create
  // one. Both flows forward the invitation id, which is what allows account
  // creation on instances running with DISABLE_REGISTRATION=true.
  const handleCreateAccount = () => {
    const email = invitationData?.invitation?.email;
    navigate({
      to: "/auth/sign-up",
      search: { invitationId: inviteId, email },
    });
  };

  if (isLoading) {
    return (
      <>
        <PageTitle title={t("auth:invitation.pageTitleAccept")} />
        <AuthLayout title={t("auth:invitation.loadingTitle")}>
          <div className="space-y-3" aria-busy="true">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        </AuthLayout>
      </>
    );
  }

  if (invitationError || !invitationData) {
    return (
      <>
        <PageTitle title={t("auth:invitation.pageTitleError")} />
        <AuthLayout title={t("auth:invitation.errorTitle")}>
          <div className="space-y-4">
            <Alert variant="error">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {t("auth:invitation.errorLoadDescription")}
              </AlertDescription>
            </Alert>
            <Button
              render={<Link to="/auth/sign-in" />}
              variant="outline"
              className="w-full"
            >
              {t("auth:invitation.goToSignIn")}
            </Button>
          </div>
        </AuthLayout>
      </>
    );
  }

  if (!invitationData.valid) {
    const expired = invitationData.invitation?.expired;
    return (
      <>
        <PageTitle title={t("auth:invitation.pageTitleInvalid")} />
        <AuthLayout
          title={
            expired
              ? t("auth:invitation.invitationExpired")
              : t("auth:invitation.invalidTitle")
          }
          subtitle={invitationData.error}
        >
          <div className="space-y-4">
            {invitationData.invitation && (
              <InvitationSummary
                workspaceName={invitationData.invitation.workspaceName}
                icon={expired ? Clock : XCircle}
                tone="destructive"
              />
            )}
            <Button
              render={<Link to="/auth/sign-in" />}
              variant="outline"
              className="w-full"
            >
              {t("auth:invitation.goToSignIn")}
            </Button>
          </div>
        </AuthLayout>
      </>
    );
  }

  const invitation = invitationData.invitation ?? null;

  if (!invitation) {
    return (
      <>
        <PageTitle title={t("auth:invitation.pageTitleInvalid")} />
        <AuthLayout title={t("auth:invitation.invalidTitle")}>
          <Button
            render={<Link to="/auth/sign-in" />}
            variant="outline"
            className="w-full"
          >
            {t("auth:invitation.goToSignIn")}
          </Button>
        </AuthLayout>
      </>
    );
  }

  if (isSignedIn) {
    return (
      <>
        <PageTitle title={t("auth:invitation.pageTitleAccept")} />
        <AuthLayout
          title={t("auth:invitation.joinWorkspace", {
            workspaceName: invitation.workspaceName,
          })}
          subtitle={
            <Trans
              i18nKey="auth:invitation.inviteBodySignedIn"
              values={{ inviterName: invitation.inviterName }}
              components={{ inviter: <strong className="text-foreground" /> }}
            />
          }
        >
          <div className="space-y-4">
            <InvitationSummary
              workspaceName={invitation.workspaceName}
              detail={
                <Trans
                  i18nKey="auth:invitation.signedInAs"
                  values={{ email: session.user.email }}
                  components={{ email: <span className="text-foreground" /> }}
                />
              }
            />

            <div className="space-y-2">
              <Button
                onClick={handleAcceptInvitation}
                disabled={isAccepting}
                className="w-full"
              >
                {isAccepting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    {t("auth:invitation.accepting")}
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-4 h-4 mr-2" />
                    {t("auth:invitation.acceptInvitation")}
                  </>
                )}
              </Button>

              <Button
                render={<Link to="/dashboard" />}
                variant="ghost"
                className="w-full"
              >
                {t("auth:invitation.goToDashboard")}
              </Button>
            </div>
          </div>
        </AuthLayout>
      </>
    );
  }

  return (
    <>
      <PageTitle title={t("auth:invitation.pageTitleAccept")} />
      <AuthLayout
        title={t("auth:invitation.youveBeenInvited")}
        subtitle={
          <Trans
            i18nKey="auth:invitation.inviteBodySignedOut"
            values={{ inviterName: invitation.inviterName }}
            components={{ inviter: <strong className="text-foreground" /> }}
          />
        }
      >
        <div className="space-y-4">
          <InvitationSummary
            workspaceName={invitation.workspaceName}
            detail={
              <Trans
                i18nKey="auth:invitation.invitationFor"
                values={{ email: invitation.email }}
                components={{ email: <span className="text-foreground" /> }}
              />
            }
          />

          <p className="text-sm text-muted-foreground">
            {t("auth:invitation.createAccountOrSignIn")}
          </p>

          <div className="space-y-2">
            <Button onClick={handleCreateAccount} className="w-full">
              <UserPlus className="w-4 h-4 mr-2" />
              {t("auth:invitation.createAccount")}
            </Button>

            <Button onClick={handleSignIn} variant="outline" className="w-full">
              <LogIn className="w-4 h-4 mr-2" />
              {t("auth:invitation.signIn")}
            </Button>
          </div>
        </div>
      </AuthLayout>
    </>
  );
}

/** The workspace being joined: an initial tile, its name and one detail line. */
function InvitationSummary({
  workspaceName,
  detail,
  icon: Icon,
  tone = "primary",
}: {
  workspaceName: string;
  detail?: React.ReactNode;
  icon?: LucideIcon;
  tone?: "primary" | "destructive";
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-3">
      <span
        aria-hidden
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-lg font-heading text-base font-semibold",
          tone === "destructive"
            ? "bg-destructive/10 text-destructive"
            : "bg-primary/10 text-foreground",
        )}
      >
        {Icon ? (
          <Icon className="size-5" />
        ) : (
          workspaceName.trim().charAt(0).toUpperCase()
        )}
      </span>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-foreground">
          {workspaceName}
        </p>
        {detail ? (
          <p className="truncate text-xs text-muted-foreground">{detail}</p>
        ) : null}
      </div>
    </div>
  );
}
