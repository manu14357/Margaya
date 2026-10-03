import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { CollabStatus } from "./use-page-collaboration";

export const SAVED_BADGE_MS = 2000;

export type SyncBadgeState =
  | "none"
  | "saved"
  | "notSaved"
  | "offline"
  | "cantConnect";

/** Which badge a connection state shows (§1.13). */
export function syncBadgeState({
  status,
  hasSynced,
  saveError,
  cantConnect,
  recentlySaved,
}: {
  status: CollabStatus;
  hasSynced: boolean;
  saveError: boolean;
  cantConnect: boolean;
  recentlySaved: boolean;
}): SyncBadgeState {
  if (cantConnect) return "cantConnect";
  if (!hasSynced) return "none";
  if (status !== "connected") return "offline";
  if (saveError) return "notSaved";
  return recentlySaved ? "saved" : "none";
}

type PageSyncBadgeProps = {
  status: CollabStatus;
  hasSynced: boolean;
  saveError: boolean;
  /** The stored copy shows, a room-full or protocol close, or 5 failures. */
  cantConnect: boolean;
  lastSavedAt: number | null;
  onRetry: () => void;
};

/** The header's connection badge: Saved, Not saved yet, Offline, or Retry. */
export default function PageSyncBadge({
  status,
  hasSynced,
  saveError,
  cantConnect,
  lastSavedAt,
  onRetry,
}: PageSyncBadgeProps) {
  const { t } = useTranslation();
  const [recentlySaved, setRecentlySaved] = useState(false);

  useEffect(() => {
    if (!lastSavedAt) return;
    setRecentlySaved(true);
    const timer = setTimeout(() => setRecentlySaved(false), SAVED_BADGE_MS);
    return () => clearTimeout(timer);
  }, [lastSavedAt]);

  const state = syncBadgeState({
    status,
    hasSynced,
    saveError,
    cantConnect,
    recentlySaved,
  });

  return (
    <span role="status" aria-live="polite" className="inline-flex">
      {state === "saved" && (
        <span className="px-1 text-muted-foreground text-xs">
          {t("pages:sync.saved")}
        </span>
      )}
      {(state === "notSaved" || state === "offline") && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger render={<Badge variant="warning" />}>
              {state === "notSaved"
                ? t("pages:sync.notSaved")
                : t("pages:sync.offline")}
            </TooltipTrigger>
            <TooltipContent>
              {state === "notSaved"
                ? t("pages:sync.notSavedHint")
                : t("pages:sync.offlineHint")}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
      {state === "cantConnect" && (
        <span className="inline-flex items-center gap-1">
          <Badge variant="error">{t("pages:sync.cantConnect")}</Badge>
          <Button variant="ghost" size="xs" onClick={onRetry}>
            {t("pages:sync.retry")}
          </Button>
        </span>
      )}
    </span>
  );
}
