import { Check, Copy, ExternalLink, Home, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FallenBranchIllustration } from "@/components/illustrations/fallen-branch";
import { OfflineCloudIllustration } from "@/components/illustrations/offline-cloud";
import { WanderingPathIllustration } from "@/components/illustrations/wandering-path";
import { DOCS_URL } from "@/constants/urls";
import { cn } from "@/lib/cn";
import {
  type ApiError,
  getCorsTroubleshootingSteps,
  getNetworkTroubleshootingSteps,
  parseApiError,
} from "../../lib/error-handler";
import { Button } from "./button";
import { EmptyState } from "./empty";

export type ErrorDisplayKind = "error" | "offline";

type ErrorDisplayProps = {
  error: unknown;
  onRetry?: () => void;
  title?: string;
  className?: string;
  /** Replaces the plain cause derived from the error. */
  description?: string;
  /** A reported event's ID (e.g. Sentry); shown and included in the copy. */
  errorId?: string;
  /** Forces a kind; otherwise a browser that reports no connection is offline. */
  kind?: ErrorDisplayKind;
};

function isBrowserOffline() {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/** A plain-text report for support. It is copied, never rendered. */
export function buildErrorDetails(
  error: unknown,
  parsed: Pick<ApiError, "type" | "status">,
  errorId?: string,
) {
  const raw = error instanceof Error ? error : undefined;
  const details = {
    errorId,
    time: new Date().toISOString(),
    url: typeof window === "undefined" ? undefined : window.location.href,
    type: parsed.type,
    status: parsed.status,
    name: raw?.name,
    message: raw?.message ?? (typeof error === "string" ? error : undefined),
    stack: raw?.stack?.split("\n").slice(0, 6).join("\n"),
    version: typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : undefined,
    online: typeof navigator === "undefined" ? undefined : navigator.onLine,
    userAgent:
      typeof navigator === "undefined" ? undefined : navigator.userAgent,
  };
  return JSON.stringify(details, null, 2);
}

/** "Copy details": copies a support report and confirms in place. */
export function CopyDetailsButton({
  getDetails,
}: {
  getDetails: () => string;
}) {
  const { t } = useTranslation();
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(getDetails());
      setState("copied");
    } catch {
      setState("failed");
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2000);
  };

  return (
    <Button onClick={() => void copy()} size="sm" variant="ghost">
      {state === "copied" ? <Check /> : <Copy />}
      <span aria-live="polite">
        {state === "copied"
          ? t("common:states.error.copied")
          : state === "failed"
            ? t("common:states.error.copyFailed")
            : t("common:states.error.copyDetails")}
      </span>
    </Button>
  );
}

/** "Go home": a full navigation, so it also clears a broken in-memory state. */
export function GoHomeButton({
  variant = "outline",
}: {
  variant?: "default" | "outline";
}) {
  const { t } = useTranslation();
  return (
    <Button render={<a href="/" />} size="sm" variant={variant}>
      <Home />
      {t("common:states.error.goHome")}
    </Button>
  );
}

export function ErrorDisplay({
  error,
  onRetry,
  title,
  className,
  description,
  errorId,
  kind,
}: ErrorDisplayProps) {
  const { t } = useTranslation();
  const parsedError = parseApiError(error);
  const resolvedKind = kind ?? (isBrowserOffline() ? "offline" : "error");
  const offline = resolvedKind === "offline";
  const connection =
    offline || parsedError.type === "network" || parsedError.type === "cors";

  const resolvedTitle =
    title ??
    (offline
      ? t("common:states.offline.title")
      : parsedError.type === "notFound"
        ? t("common:states.notFound.title")
        : t("common:states.error.title"));
  const resolvedDescription =
    description ??
    (offline
      ? t("common:states.offline.description")
      : parsedError.type === "unknown"
        ? t("common:states.error.description")
        : t(parsedError.message));

  const troubleshootingSteps = offline
    ? []
    : parsedError.type === "cors"
      ? getCorsTroubleshootingSteps()
      : parsedError.type === "network"
        ? getNetworkTroubleshootingSteps()
        : [];

  const Illustration = connection
    ? OfflineCloudIllustration
    : parsedError.type === "notFound"
      ? WanderingPathIllustration
      : FallenBranchIllustration;

  return (
    <EmptyState
      action={
        onRetry ? (
          <Button onClick={onRetry} size="sm">
            <RefreshCw />
            {t("common:states.error.tryAgain")}
          </Button>
        ) : (
          <Button onClick={() => window.location.reload()} size="sm">
            <RefreshCw />
            {t("common:states.error.reload")}
          </Button>
        )
      }
      className={cn("min-h-[400px]", className)}
      data-slot="error-display"
      description={resolvedDescription}
      footer={
        (troubleshootingSteps.length > 0 || errorId) && (
          <div className="flex w-full max-w-sm flex-col items-center gap-3">
            {troubleshootingSteps.length > 0 && (
              <details className="w-full rounded-lg border bg-card px-3 py-2 text-left text-sm">
                <summary className="cursor-pointer font-medium text-foreground">
                  {t("common:states.error.troubleshooting")}
                </summary>
                <ul className="mt-2 list-disc space-y-1 ps-5 text-muted-foreground text-xs">
                  {troubleshootingSteps.map((step) => (
                    <li key={step}>{t(step)}</li>
                  ))}
                </ul>
                {parsedError.type === "cors" && (
                  <Button
                    className="mt-2 px-0"
                    render={
                      <a
                        href={DOCS_URL}
                        rel="noopener noreferrer"
                        target="_blank"
                      />
                    }
                    size="xs"
                    variant="link"
                  >
                    {t("common:states.error.deploymentGuide")}
                    <ExternalLink />
                  </Button>
                )}
              </details>
            )}
            {errorId && (
              <code className="font-mono text-muted-foreground text-xs">
                {t("common:states.error.errorId", { id: errorId })}
              </code>
            )}
          </div>
        )
      }
      illustration={<Illustration />}
      role="alert"
      secondaryAction={
        <>
          <GoHomeButton />
          <CopyDetailsButton
            getDetails={() => buildErrorDetails(error, parsedError, errorId)}
          />
        </>
      }
      title={resolvedTitle}
    />
  );
}
