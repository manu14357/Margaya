import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type {
  CalendarFeed,
  CreatedCalendarFeed,
} from "@/fetchers/calendar-feed/calendar-feeds";
import { useRevokeCalendarFeed } from "@/hooks/mutations/calendar-feed/use-calendar-feed-mutations";
import { formatDateMedium, formatRelativeTime } from "@/lib/format";
import { toast } from "@/lib/toast";
import { CalendarFeedLinkDialog } from "./calendar-feed-link-dialog";

/** One line on a feed's current state: none, or when it was made and used. */
export function CalendarFeedStatus({
  feed,
}: {
  feed: CalendarFeed | undefined;
}) {
  const { t } = useTranslation();
  if (!feed) {
    return (
      <span className="text-muted-foreground">
        {t("settings:calendarFeed.status.none")}
      </span>
    );
  }
  return (
    <span className="text-muted-foreground">
      {t("settings:calendarFeed.status.active", {
        start: feed.tokenStart,
        date: formatDateMedium(feed.createdAt),
      })}
      {" · "}
      {feed.lastUsedAt
        ? t("settings:calendarFeed.status.lastUsed", {
            when: formatRelativeTime(new Date(feed.lastUsedAt)),
          })
        : t("settings:calendarFeed.status.neverUsed")}
    </span>
  );
}

type CalendarFeedActionsProps = {
  feed: CalendarFeed | undefined;
  /** What the feed is, for the buttons' accessible names. */
  label: string;
  /** Creates the feed, or gives the existing one a new URL. */
  create: () => Promise<CreatedCalendarFeed>;
  disabled?: boolean;
  /** False for a feed whose project the owner can no longer see. */
  canRegenerate?: boolean;
};

/**
 * Create, regenerate and revoke for one feed. A new URL is shown once in
 * the link dialog; regenerating and revoking ask first, since the current
 * URL stops working at once.
 */
export function CalendarFeedActions({
  feed,
  label,
  create,
  disabled = false,
  canRegenerate = true,
}: CalendarFeedActionsProps) {
  const { t } = useTranslation();
  const [link, setLink] = useState<{
    url: string;
    webcalUrl: string;
    name: string;
  } | null>(null);
  const [confirm, setConfirm] = useState<"regenerate" | "revoke" | null>(null);
  const [creating, setCreating] = useState(false);
  const revoke = useRevokeCalendarFeed();

  const runCreate = async () => {
    setCreating(true);
    try {
      const created = await create();
      setLink({
        url: created.url,
        webcalUrl: created.webcalUrl,
        name: created.name,
      });
      toast.success(t("settings:calendarFeed.toast.created"));
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : t("settings:calendarFeed.toast.error"),
      );
    } finally {
      setCreating(false);
    }
  };

  const runRevoke = async () => {
    if (!feed) return;
    try {
      await revoke.mutateAsync(feed.id);
      toast.success(t("settings:calendarFeed.toast.revoked"));
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : t("settings:calendarFeed.toast.error"),
      );
    }
  };

  const busy = disabled || creating || revoke.isPending;

  return (
    <>
      {feed ? (
        <>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !canRegenerate}
            aria-label={t("settings:calendarFeed.actions.regenerateFor", {
              name: label,
            })}
            onClick={() => setConfirm("regenerate")}
          >
            {t("settings:calendarFeed.actions.regenerate")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            aria-label={t("settings:calendarFeed.actions.revokeFor", {
              name: label,
            })}
            onClick={() => setConfirm("revoke")}
          >
            {t("settings:calendarFeed.actions.revoke")}
          </Button>
        </>
      ) : (
        <Button
          size="sm"
          disabled={busy}
          aria-label={t("settings:calendarFeed.actions.createFor", {
            name: label,
          })}
          onClick={runCreate}
        >
          {t("settings:calendarFeed.actions.create")}
        </Button>
      )}

      <AlertDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === "revoke"
                ? t("settings:calendarFeed.revokeConfirm.title")
                : t("settings:calendarFeed.regenerateConfirm.title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "revoke"
                ? t("settings:calendarFeed.revokeConfirm.description")
                : t("settings:calendarFeed.regenerateConfirm.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" size="sm" />}>
              {t("common:actions.cancel")}
            </AlertDialogClose>
            <AlertDialogClose
              render={
                <Button
                  size="sm"
                  variant={confirm === "revoke" ? "destructive" : "default"}
                  onClick={() => {
                    const action = confirm;
                    setConfirm(null);
                    void (action === "revoke" ? runRevoke() : runCreate());
                  }}
                />
              }
            >
              {confirm === "revoke"
                ? t("settings:calendarFeed.revokeConfirm.confirm")
                : t("settings:calendarFeed.regenerateConfirm.confirm")}
            </AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <CalendarFeedLinkDialog link={link} onClose={() => setLink(null)} />
    </>
  );
}
