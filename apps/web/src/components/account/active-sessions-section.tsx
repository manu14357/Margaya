import { Monitor, Smartphone } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  SettingsGroup,
  SettingsGroupMessage,
  SettingsRow,
  SettingsSection,
} from "@/components/settings-layout";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { UserSession } from "@/fetchers/user/get-account-security";
import useRevokeOtherSessions from "@/hooks/mutations/user/use-revoke-other-sessions";
import useRevokeSession from "@/hooks/mutations/user/use-revoke-session";
import { isDesktopApp } from "@/lib/desktop";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import { toast } from "@/lib/toast";
import { isDesktopAppUserAgent, summarizeUserAgent } from "@/lib/user-agent";

// Longer lists fold, so the page doesn't become a wall of old sessions.
const VISIBLE_SESSIONS = 5;

type ActiveSessionsSectionProps = {
  sessions: UserSession[] | undefined;
  isLoading: boolean;
  isError: boolean;
};

/** The user's signed-in devices, with sign-out for all but this one. */
export function ActiveSessionsSection({
  sessions,
  isLoading,
  isError,
}: ActiveSessionsSectionProps) {
  const { t } = useTranslation();
  const [confirmOthers, setConfirmOthers] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const revokeSession = useRevokeSession();
  const revokeOthers = useRevokeOtherSessions();
  const otherCount = sessions?.filter((session) => !session.current).length;

  // This device first, then the most recently used.
  const ordered = useMemo(
    () =>
      sessions
        ? [...sessions].sort((a, b) => {
            if (a.current !== b.current) return a.current ? -1 : 1;
            return (
              new Date(b.lastActiveAt ?? 0).getTime() -
              new Date(a.lastActiveAt ?? 0).getTime()
            );
          })
        : undefined,
    [sessions],
  );
  const visible =
    ordered && !showAll ? ordered.slice(0, VISIBLE_SESSIONS) : ordered;
  const hidden = (ordered?.length ?? 0) - VISIBLE_SESSIONS;

  const deviceLabel = (session: UserSession) => {
    const summary = summarizeUserAgent(session.userAgent);
    const { os } = summary;
    // The app's own sign-in, and this window when it runs inside the app.
    const browser =
      isDesktopAppUserAgent(session.userAgent) ||
      (session.current && isDesktopApp())
        ? t("settings:securityPage.sessions.desktopApp")
        : summary.browser;
    if (browser && os)
      return t("settings:securityPage.sessions.deviceLabel", { browser, os });
    return browser ?? os ?? t("settings:securityPage.sessions.unknownDevice");
  };

  const signOut = async (session: UserSession) => {
    try {
      await revokeSession.mutateAsync(session.id);
      toast.success(t("settings:securityPage.sessions.signedOut"));
    } catch {
      toast.error(t("settings:securityPage.sessions.error"));
    }
  };

  const signOutOthers = async () => {
    try {
      await revokeOthers.mutateAsync();
      toast.success(t("settings:securityPage.sessions.signedOutOthers"));
    } catch {
      toast.error(t("settings:securityPage.sessions.error"));
    }
  };

  return (
    <SettingsSection
      title={t("settings:securityPage.sessions.title")}
      description={t("settings:securityPage.sessions.subtitle")}
      actions={
        otherCount ? (
          <Button
            variant="outline"
            size="sm"
            disabled={revokeOthers.isPending}
            onClick={() => setConfirmOthers(true)}
          >
            {t("settings:securityPage.sessions.signOutOthers")}
          </Button>
        ) : null
      }
    >
      <SettingsGroup>
        {isLoading ? (
          <div className="space-y-2 p-4" aria-busy="true">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : isError || !visible ? (
          <SettingsGroupMessage tone="error">
            {t("settings:securityPage.sessions.loadError")}
          </SettingsGroupMessage>
        ) : (
          visible.map((session) => {
            const { mobile } = summarizeUserAgent(session.userAgent);
            const Icon = mobile ? Smartphone : Monitor;
            const label = deviceLabel(session);
            const lastActive = formatRelativeTime(session.lastActiveAt);
            const details = [
              t("settings:securityPage.sessions.lastActive", {
                date: lastActive,
              }),
              t("settings:securityPage.sessions.started", {
                date: formatDateTime(session.createdAt),
              }),
              session.ipAddress
                ? t("settings:securityPage.sessions.ip", {
                    ip: session.ipAddress,
                  })
                : null,
            ].filter(Boolean);

            return (
              <SettingsRow
                key={session.id}
                label={
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <Icon
                      className="size-4 text-muted-foreground"
                      aria-hidden
                    />
                    {label}
                  </span>
                }
                badge={
                  session.current ? (
                    <Badge variant="success" size="sm">
                      {t("settings:securityPage.sessions.thisDevice")}
                    </Badge>
                  ) : undefined
                }
                description={details.join(" · ")}
              >
                {session.current ? null : (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={
                      revokeSession.isPending &&
                      revokeSession.variables === session.id
                    }
                    aria-label={t(
                      "settings:securityPage.sessions.signOutAria",
                      {
                        device: label,
                        date: lastActive,
                      },
                    )}
                    onClick={() => signOut(session)}
                  >
                    {t("settings:securityPage.sessions.signOut")}
                  </Button>
                )}
              </SettingsRow>
            );
          })
        )}
      </SettingsGroup>
      {hidden > 0 && (
        <div>
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={showAll}
            onClick={() => setShowAll((value) => !value)}
          >
            {showAll
              ? t("settings:securityPage.sessions.showFewer")
              : t("settings:securityPage.sessions.showAll", {
                  count: ordered?.length ?? 0,
                })}
          </Button>
        </div>
      )}

      <AlertDialog open={confirmOthers} onOpenChange={setConfirmOthers}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("settings:securityPage.sessions.confirmOthersTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("settings:securityPage.sessions.confirmOthersDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" size="sm" />}>
              {t("common:actions.cancel")}
            </AlertDialogClose>
            <AlertDialogClose
              render={
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={signOutOthers}
                />
              }
            >
              {t("settings:securityPage.sessions.signOutOthers")}
            </AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsSection>
  );
}
