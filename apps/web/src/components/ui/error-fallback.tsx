import {
  type ErrorComponentProps,
  isNotFound,
  useRouter,
} from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { WanderingPathIllustration } from "@/components/illustrations/wandering-path";
import { cn } from "@/lib/cn";
import { Button } from "./button";
import { EmptyState } from "./empty";
import {
  buildErrorDetails,
  CopyDetailsButton,
  ErrorDisplay,
  GoHomeButton,
} from "./error-display";

type ErrorFallbackProps = {
  error: Error;
  resetError: () => void;
  errorId?: string;
};

/** A full-screen error for an error boundary. */
export function ErrorFallback({
  error,
  resetError,
  errorId,
}: ErrorFallbackProps) {
  return (
    <ErrorDisplay
      className="min-h-svh bg-background"
      error={error}
      errorId={errorId}
      onRetry={resetError}
    />
  );
}

/**
 * The app-level crash screen, outside the router: a reload is the only
 * reliable recovery, and the raw message is copied rather than shown.
 */
export function CrashFallback({
  error,
  errorId,
}: {
  error: Error;
  resetError: () => void;
  errorId?: string;
}) {
  const { t } = useTranslation();
  return (
    <ErrorDisplay
      className="min-h-svh bg-background"
      description={t("common:states.crash.description")}
      error={error}
      errorId={errorId}
      title={t("common:states.crash.title")}
    />
  );
}

/** "This page wandered off": an unknown URL or a missing record. */
export function NotFoundPage({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <EmptyState
      action={<GoHomeButton variant="default" />}
      className={cn("min-h-full w-full", className)}
      data-slot="not-found"
      description={t("common:states.notFound.description")}
      illustration={<WanderingPathIllustration />}
      secondaryAction={
        <>
          <Button
            onClick={() => window.location.reload()}
            size="sm"
            variant="outline"
          >
            <RefreshCw />
            {t("common:states.error.reload")}
          </Button>
          <CopyDetailsButton
            getDetails={() =>
              buildErrorDetails(
                new Error(`Not found: ${window.location.pathname}`),
                { type: "unknown", status: 404 },
              )
            }
          />
        </>
      }
      title={t("common:states.notFound.title")}
    />
  );
}

/** The router's error screen: retry re-runs the route's loaders. */
export function RouteErrorPage({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  if (isNotFound(error)) {
    return <NotFoundPage />;
  }
  return (
    <ErrorDisplay
      className="min-h-full w-full"
      error={error}
      onRetry={() => {
        reset();
        void router.invalidate();
      }}
    />
  );
}
