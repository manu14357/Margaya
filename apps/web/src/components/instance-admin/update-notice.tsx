import { ArrowUpCircle } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useInstanceUpdateStatus } from "@/hooks/queries/instance-admin/use-instance-admin";
import { authClient } from "@/lib/auth-client";
import { formatDateTime } from "@/lib/format";
import type { InstanceUpdateStatus } from "@/types/instance-admin";

// The opt-in update notice (instance setting general.updateCheck). The server
// does the check; this only shows its answer to instance admins.

const DISMISSED_KEY = "margaya:update-notice-dismissed";

function readDismissed(): string | null {
  try {
    return window.localStorage.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
}

function writeDismissed(version: string): void {
  try {
    window.localStorage.setItem(DISMISSED_KEY, version);
  } catch {
    // Private windows may refuse storage; the banner then shows again.
  }
}

/** Whether the banner should show: a newer release the admin hasn't dismissed. */
export function shouldShowUpdateBanner(
  status: InstanceUpdateStatus | undefined,
  dismissedVersion: string | null,
): boolean {
  return Boolean(
    status?.enabled &&
      status.updateAvailable &&
      status.latestVersion &&
      status.latestVersion !== dismissedVersion,
  );
}

/** Across the app, for instance admins only, once per new version. */
export function UpdateBanner() {
  const { t } = useTranslation();
  const { data: session } = authClient.useSession();
  // The API refuses everyone else; this only avoids asking.
  const isInstanceAdmin = session?.user?.role === "admin";
  const status = useInstanceUpdateStatus(isInstanceAdmin);
  const [dismissed, setDismissed] = useState(readDismissed);

  if (!isInstanceAdmin || !shouldShowUpdateBanner(status.data, dismissed)) {
    return null;
  }
  const data = status.data as InstanceUpdateStatus;
  const latest = data.latestVersion ?? "";

  return (
    <div className="shrink-0 px-3 pt-3 print:hidden">
      <Alert variant="info">
        <ArrowUpCircle />
        <AlertTitle>
          {t("instanceAdmin:update.bannerTitle", { version: latest })}
        </AlertTitle>
        <AlertDescription>
          {t("instanceAdmin:update.bannerDescription", {
            current: data.currentVersion,
          })}
        </AlertDescription>
        <AlertAction>
          {data.releaseUrl && (
            <Button
              size="xs"
              variant="outline"
              render={
                <a href={data.releaseUrl} target="_blank" rel="noreferrer" />
              }
            >
              {t("instanceAdmin:update.releaseNotes")}
            </Button>
          )}
          <Button
            size="xs"
            variant="ghost"
            onClick={() => {
              writeDismissed(latest);
              setDismissed(latest);
            }}
          >
            {t("instanceAdmin:update.dismiss")}
          </Button>
        </AlertAction>
      </Alert>
    </div>
  );
}

/** The line under the switch on the health page. */
export function UpdateStatusLine({
  status,
}: {
  status: InstanceUpdateStatus | undefined;
}) {
  const { t } = useTranslation();
  if (!status?.enabled) {
    return (
      <p className="text-xs text-muted-foreground">
        {t("instanceAdmin:update.off")}
      </p>
    );
  }
  if (status.error) {
    return (
      <p className="text-xs text-warning-foreground">
        {status.error === "unreachable"
          ? t("instanceAdmin:update.errorUnreachable")
          : t("instanceAdmin:update.errorInvalid")}
      </p>
    );
  }
  if (!status.latestVersion) {
    return (
      <p className="text-xs text-muted-foreground">
        {t("instanceAdmin:update.notChecked")}
      </p>
    );
  }
  return (
    <p className="text-xs text-muted-foreground">
      {status.updateAvailable
        ? t("instanceAdmin:update.available", {
            latest: status.latestVersion,
            current: status.currentVersion,
          })
        : t("instanceAdmin:update.upToDate", {
            current: status.currentVersion,
          })}
      {status.checkedAt && (
        <>
          {" "}
          {t("instanceAdmin:update.checkedAt", {
            time: formatDateTime(status.checkedAt),
          })}
        </>
      )}
      {status.updateAvailable && status.releaseUrl && (
        <>
          {" "}
          <a
            href={status.releaseUrl}
            target="_blank"
            rel="noreferrer"
            className="text-primary underline-offset-2 hover:underline focus-visible:underline"
          >
            {t("instanceAdmin:update.releaseNotes")}
          </a>
        </>
      )}
    </p>
  );
}
