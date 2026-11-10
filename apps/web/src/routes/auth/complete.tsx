import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { takeDesktopHandoffSecret } from "@/lib/desktop";
import { AuthLayout } from "../../components/auth/layout";

export const Route = createFileRoute("/auth/complete")({
  component: CompleteSignIn,
});

// One redemption per page load: a token works once, and a second effect run
// (React's development double run included) must not spend it again.
let redemption: Promise<string | null> | null = null;

/** Takes the token out of the address, so history and screenshots never hold it. */
function takeToken() {
  const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
  if (window.location.hash) {
    window.history.replaceState(
      window.history.state,
      "",
      window.location.pathname + window.location.search,
    );
  }
  return token;
}

/** Only somewhere in this app; anything else goes to the dashboard. */
function destination(redirectTo: unknown) {
  if (typeof redirectTo === "string") {
    try {
      const url = new URL(redirectTo, window.location.origin);
      if (url.origin === window.location.origin) {
        return url.pathname + url.search + url.hash;
      }
    } catch {}
  }
  return "/dashboard";
}

async function redeem(): Promise<string | null> {
  const token = takeToken();
  if (!token) return null;
  try {
    // Inside the desktop app, the token only works with the app's secret.
    const desktopSecret = await takeDesktopHandoffSecret();
    const { data, error } = await authClient.$fetch<{ redirectTo?: unknown }>(
      "/handoff/redeem",
      {
        method: "POST",
        body: desktopSecret ? { token, desktopSecret } : { token },
      },
    );
    return error || !data ? null : destination(data.redirectTo);
  } catch {
    return null;
  }
}

/**
 * Where sign-in through a provider lands when the app and API are on different
 * sites: the API sends the session over as a one-time token in the address's
 * fragment, and redeeming it here sets the session cookie for this app.
 */
function CompleteSignIn() {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    redemption ??= redeem();
    void redemption.then((next) => {
      if (!active) return;
      // A full load, so everything starts with the new session.
      if (next) window.location.replace(next);
      else setFailed(true);
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <>
      <PageTitle title={t("auth:complete.pageTitle")} />
      <AuthLayout
        title={
          failed ? t("auth:complete.failedTitle") : t("auth:complete.title")
        }
      >
        {failed ? (
          <div className="space-y-4">
            <p role="alert" className="text-sm text-muted-foreground">
              {t("auth:complete.failed")}
            </p>
            <Button
              variant="outline"
              render={<Link to="/auth/sign-in" />}
              className="w-full"
            >
              <ArrowLeft className="size-4" />
              {t("auth:complete.backToSignIn")}
            </Button>
          </div>
        ) : (
          <p
            role="status"
            className="flex items-center gap-2 text-sm text-muted-foreground"
          >
            <Loader2 className="size-4 animate-spin" aria-hidden />
            {t("auth:complete.working")}
          </p>
        )}
      </AuthLayout>
    </>
  );
}
