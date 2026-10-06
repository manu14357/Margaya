import {
  createFileRoute,
  useNavigate,
  useSearch,
} from "@tanstack/react-router";
import { MonitorSmartphone } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod/v4";
import { AuthLayout } from "@/components/auth/layout";
import PageTitle from "@/components/page-title";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { authClient } from "@/lib/auth-client";
import { toast } from "@/lib/toast";

const approveSearchSchema = z.object({
  user_code: z.string().optional(),
});

export const Route = createFileRoute("/device/approve")({
  component: DeviceApprovePage,
  validateSearch: approveSearchSchema,
});

function DeviceApprovePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const search = useSearch({ from: "/device/approve" });
  const { data: session, isPending } = authClient.useSession();
  const [processing, setProcessing] = useState(false);

  const normalizedCode =
    search.user_code?.trim().replace(/-/g, "").toUpperCase() ?? "";

  const pageTitle = <PageTitle title={t("auth:device.approveTitle")} />;

  if (isPending) {
    return (
      <>
        {pageTitle}
        <AuthLayout
          title={t("auth:device.approveTitle")}
          subtitle={t("auth:device.checkingSession")}
        >
          <div className="space-y-3" aria-busy="true">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        </AuthLayout>
      </>
    );
  }

  if (!normalizedCode) {
    return (
      <>
        {pageTitle}
        <AuthLayout
          title={t("auth:device.approveTitle")}
          subtitle={t("auth:device.noCode")}
        >
          <Button
            className="w-full"
            variant="secondary"
            onClick={() => void navigate({ to: "/device" })}
          >
            {t("auth:device.enterCode")}
          </Button>
        </AuthLayout>
      </>
    );
  }

  if (!session?.user) {
    const redirectTarget = `/device/approve?user_code=${encodeURIComponent(normalizedCode)}`;
    return (
      <>
        {pageTitle}
        <AuthLayout
          title={t("auth:device.signInTitle")}
          subtitle={t("auth:device.signInSubtitle")}
        >
          <Button
            className="w-full"
            onClick={() =>
              void navigate({
                to: "/auth/sign-in",
                search: { redirect: redirectTarget },
              })
            }
          >
            {t("auth:device.signIn")}
          </Button>
        </AuthLayout>
      </>
    );
  }

  const handleApprove = async () => {
    setProcessing(true);
    try {
      // better-auth >= 1.6.11 requires the signed-in user to claim the code
      // (GET /device) before it can be approved. No-op if already claimed.
      await authClient.device({ query: { user_code: normalizedCode } });
      const res = await authClient.device.approve({
        userCode: normalizedCode,
      });
      if (res.error) {
        toast.error(
          res.error.error_description ?? t("auth:device.approveFailed"),
        );
        return;
      }
      toast.success(t("auth:device.connected"));
      void navigate({ to: "/dashboard" });
    } catch {
      toast.error(t("auth:device.approveFailed"));
    } finally {
      setProcessing(false);
    }
  };

  const handleDeny = async () => {
    setProcessing(true);
    try {
      // Claim the code first (see handleApprove) so deny is authorized in
      // better-auth >= 1.6.11.
      await authClient.device({ query: { user_code: normalizedCode } });
      const res = await authClient.device.deny({
        userCode: normalizedCode,
      });
      if (res.error) {
        toast.error(res.error.error_description ?? t("auth:device.denyFailed"));
        return;
      }
      toast.message(t("auth:device.cancelled"));
      void navigate({ to: "/dashboard" });
    } catch {
      toast.error(t("auth:device.denyFailed"));
    } finally {
      setProcessing(false);
    }
  };

  return (
    <>
      {pageTitle}
      <AuthLayout
        title={t("auth:device.approveTitle")}
        subtitle={t("auth:device.approveSubtitle")}
      >
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-foreground">
              <MonitorSmartphone className="size-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">
                {t("auth:device.codeLabel")}
              </p>
              <p className="font-mono text-sm tracking-widest text-foreground">
                {normalizedCode}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              className="flex-1"
              disabled={processing}
              onClick={() => void handleApprove()}
            >
              {t("auth:device.approve")}
            </Button>
            <Button
              variant="outline"
              disabled={processing}
              onClick={() => void handleDeny()}
            >
              {t("auth:device.deny")}
            </Button>
          </div>
        </div>
      </AuthLayout>
    </>
  );
}
