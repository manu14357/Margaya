import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Copy, MonitorDown } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AuthLayout } from "@/components/auth/layout";
import PageTitle from "@/components/page-title";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuthorizeDesktopSignIn } from "@/hooks/mutations/desktop/use-authorize-desktop-sign-in";
import { authClient } from "@/lib/auth-client";
import { copyToClipboard } from "@/lib/copy-to-clipboard";
import {
  desktopAuthorizeReturnPath,
  isDesktopCallbackUrl,
  parseDesktopAuthorizeRequest,
} from "@/lib/desktop-authorize";
import { HttpError } from "@/lib/http-error";
import { toast } from "@/lib/toast";

// No validateSearch: the router's search parser turns digit-only values into
// numbers, and the PKCE values must reach the API exactly as the app sent them.
export const Route = createFileRoute("/desktop/authorize")({
  component: DesktopAuthorizePage,
});

function readRequest() {
  const query = new URLSearchParams(window.location.search);
  return {
    request: parseDesktopAuthorizeRequest({
      state: query.get("state") ?? undefined,
      code_challenge: query.get("code_challenge") ?? undefined,
      code_challenge_method: query.get("code_challenge_method") ?? undefined,
    }),
    display: query.get("display") === "code" ? ("code" as const) : undefined,
  };
}

const ERROR_KEYS = {
  400: "auth:desktop.expired",
  404: "auth:desktop.disabled",
  429: "auth:desktop.rateLimited",
} as const;

function errorKey(error: unknown) {
  const status = error instanceof HttpError ? error.status : 0;
  return status in ERROR_KEYS
    ? ERROR_KEYS[status as keyof typeof ERROR_KEYS]
    : "auth:desktop.failed";
}

/**
 * Where the API sends the system browser when the desktop app asks to sign
 * in: the person confirms here, with this browser's session, and the app gets
 * a one-time code through its callback link (or to paste, with display=code).
 */
function DesktopAuthorizePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [{ request, display }] = useState(readRequest);
  const { data: session, isPending: isSessionPending } =
    authClient.useSession();
  const authorize = useAuthorizeDesktopSignIn();
  const [cancelled, setCancelled] = useState(false);
  const signedOut = !isSessionPending && !session?.user;

  useEffect(() => {
    if (!request || !signedOut) return;
    void navigate({
      to: "/auth/sign-in",
      search: { redirect: desktopAuthorizeReturnPath(request, display) },
      replace: true,
    });
  }, [request, display, signedOut, navigate]);

  const page = (title: string, children: ReactNode, subtitle?: string) => (
    <>
      <PageTitle title={t("auth:desktop.pageTitle")} />
      <AuthLayout title={title} subtitle={subtitle}>
        {children}
      </AuthLayout>
    </>
  );

  if (!request) {
    return page(
      t("auth:desktop.invalidTitle"),
      <p className="text-sm text-muted-foreground">
        {t("auth:desktop.invalidHint")}
      </p>,
    );
  }

  if (isSessionPending || signedOut) {
    return page(
      t("auth:desktop.title"),
      <div className="space-y-3" aria-busy="true">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>,
    );
  }

  if (cancelled) {
    return page(
      t("auth:desktop.cancelledTitle"),
      <p className="text-sm text-muted-foreground">
        {t("auth:desktop.cancelledHint")}
      </p>,
    );
  }

  const result = authorize.data;
  if (result && display === "code") {
    const copy = async () => {
      if (await copyToClipboard(result.code)) {
        toast.success(t("auth:desktop.copied"));
      } else {
        toast.error(t("auth:desktop.copyFailed"));
      }
    };
    return page(
      t("auth:desktop.codeTitle"),
      <div className="space-y-4">
        <output
          aria-label={t("auth:desktop.codeTitle")}
          className="block select-all break-all rounded-lg border border-border bg-card p-4 text-center font-mono text-2xl tracking-wider text-foreground"
        >
          {result.code}
        </output>
        <Button type="button" className="w-full" onClick={() => void copy()}>
          <Copy className="size-4" />
          {t("auth:desktop.copy")}
        </Button>
      </div>,
      t("auth:desktop.codeHint"),
    );
  }

  if (result && isDesktopCallbackUrl(result.redirectTo)) {
    return page(
      t("auth:desktop.doneTitle"),
      <div className="space-y-4">
        <p role="status" className="text-sm text-muted-foreground">
          {t("auth:desktop.doneHint")}
        </p>
        <Button
          variant="outline"
          className="w-full"
          render={<a href={result.redirectTo} />}
        >
          <MonitorDown className="size-4" />
          {t("auth:desktop.openAgain")}
        </Button>
      </div>,
    );
  }

  const allow = () =>
    authorize.mutate(request, {
      onSuccess: ({ redirectTo }) => {
        // Only the app's own link; anything else would leave this page.
        if (display !== "code" && isDesktopCallbackUrl(redirectTo)) {
          window.location.href = redirectTo;
        }
      },
    });

  const user = session?.user;
  const account = user?.name ? `${user.name} (${user.email})` : user?.email;

  return page(
    t("auth:desktop.title"),
    <div className="space-y-4">
      <p className="text-sm text-foreground">
        {t("auth:desktop.confirm", {
          account,
          server: window.location.host,
        })}
      </p>
      <Alert variant="warning">
        <AlertDescription>{t("auth:desktop.warning")}</AlertDescription>
      </Alert>
      {authorize.isError ||
      (result && !isDesktopCallbackUrl(result.redirectTo)) ? (
        <Alert variant="error">
          <AlertDescription>{t(errorKey(authorize.error))}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex gap-2">
        <Button
          type="button"
          className="flex-1"
          loading={authorize.isPending}
          disabled={authorize.isPending}
          onClick={allow}
        >
          {authorize.isError
            ? t("auth:desktop.tryAgain")
            : t("auth:desktop.allow")}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={authorize.isPending}
          onClick={() => setCancelled(true)}
        >
          {t("auth:desktop.cancel")}
        </Button>
      </div>
    </div>,
  );
}
