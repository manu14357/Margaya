import {
  createFileRoute,
  useNavigate,
  useSearch,
} from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { z } from "zod/v4";
import { AuthLayout } from "@/components/auth/layout";
import PageTitle from "@/components/page-title";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useMcpAuthorizationDecision } from "@/hooks/mutations/mcp/use-authorization-decision";
import { useMcpAuthorizationRequest } from "@/hooks/queries/mcp/use-authorization-request";
import { authClient } from "@/lib/auth-client";
import { isLoopbackRedirect } from "@/lib/mcp-redirect";

const authorizationSearchSchema = z.object({
  request_id: z.string().optional(),
});

export const Route = createFileRoute("/mcp/authorize")({
  component: McpAuthorizePage,
  validateSearch: authorizationSearchSchema,
});

function McpAuthorizePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const search = useSearch({ from: "/mcp/authorize" });
  const requestId = search.request_id ?? "";
  const request = useMcpAuthorizationRequest(requestId);
  const decision = useMcpAuthorizationDecision();
  const { data: session, isPending: isSessionPending } =
    authClient.useSession();
  const pageTitle = <PageTitle title={t("auth:mcp.title")} />;

  if (!requestId || request.isError) {
    return (
      <>
        {pageTitle}
        <AuthLayout
          title={t("auth:mcp.failedTitle")}
          subtitle={t("auth:mcp.failedSubtitle")}
        >
          <p className="text-sm text-muted-foreground">
            {t("auth:mcp.failedHint")}
          </p>
        </AuthLayout>
      </>
    );
  }

  if (request.isLoading || isSessionPending) {
    return (
      <>
        {pageTitle}
        <AuthLayout
          title={t("auth:mcp.title")}
          subtitle={t("auth:mcp.loadingSubtitle")}
        >
          <div className="space-y-3" aria-busy="true">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        </AuthLayout>
      </>
    );
  }

  if (!session?.user) {
    const redirectTarget = `/mcp/authorize?request_id=${encodeURIComponent(requestId)}`;
    return (
      <>
        {pageTitle}
        <AuthLayout
          title={t("auth:mcp.signInTitle")}
          subtitle={t("auth:mcp.signInSubtitle")}
        >
          <Button
            type="button"
            className="w-full"
            onClick={() =>
              void navigate({
                to: "/auth/sign-in",
                search: { redirect: redirectTarget },
              })
            }
          >
            {t("auth:mcp.signIn")}
          </Button>
        </AuthLayout>
      </>
    );
  }

  const submitDecision = (approved: boolean) => {
    decision.mutate(
      { requestId, approved },
      {
        onSuccess: (redirect) => window.location.assign(redirect),
      },
    );
  };

  return (
    <>
      {pageTitle}
      <AuthLayout title={t("auth:mcp.title")} subtitle={t("auth:mcp.subtitle")}>
        <div className="space-y-4">
          <dl className="divide-y divide-border rounded-lg border border-border bg-card">
            <div className="space-y-1 p-3">
              <dt className="text-xs font-medium text-muted-foreground">
                {t("auth:mcp.clientName")}
              </dt>
              <dd className="text-sm text-foreground">
                {request.data?.clientName ?? t("auth:mcp.clientFallback")}
              </dd>
            </div>
            {request.data?.metadataHost && (
              <div className="space-y-1 p-3">
                <dt className="text-xs font-medium text-muted-foreground">
                  {t("auth:mcp.metadataHost")}
                </dt>
                <dd className="break-all font-mono text-xs text-foreground">
                  {request.data.metadataHost}
                </dd>
              </div>
            )}
            <div className="space-y-1 p-3">
              <dt className="text-xs font-medium text-muted-foreground">
                {t("auth:mcp.redirectUri")}
              </dt>
              <dd className="break-all font-mono text-xs text-foreground">
                {request.data?.redirectUri}
              </dd>
            </div>
          </dl>
          <Alert variant="warning">
            <AlertDescription>{t("auth:mcp.warning")}</AlertDescription>
          </Alert>
          {isLoopbackRedirect(request.data?.redirectUri) && (
            <Alert variant="warning">
              <AlertDescription>{t("auth:mcp.localRedirect")}</AlertDescription>
            </Alert>
          )}
          <div className="flex gap-2">
            <Button
              type="button"
              className="flex-1"
              loading={decision.isPending && decision.variables?.approved}
              disabled={decision.isPending}
              onClick={() => submitDecision(true)}
            >
              {t("auth:mcp.approve")}
            </Button>
            <Button
              type="button"
              variant="outline"
              loading={decision.isPending && !decision.variables?.approved}
              disabled={decision.isPending}
              onClick={() => submitDecision(false)}
            >
              {t("auth:mcp.deny")}
            </Button>
          </div>
        </div>
      </AuthLayout>
    </>
  );
}
