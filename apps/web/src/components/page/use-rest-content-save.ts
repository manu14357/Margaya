import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import getPage from "@/fetchers/page/get-page";
import replacePageContent from "@/fetchers/page/replace-page-content";
import { pageQueryKeys } from "@/hooks/queries/page/page-query-keys";
import { pageErrorMessage } from "@/lib/pages/page-errors";
import { toast } from "@/lib/toast";
import type { Page } from "@/types/page";

export const REST_SAVE_DEBOUNCE_MS = 1000;

type Options = {
  page: Pick<Page, "id" | "contentVersion">;
  /** Saving is on only while the stored copy is edited. */
  enabled: boolean;
};

/**
 * Saves the stored copy over REST while live sync is unavailable. A save
 * goes through only if nobody changed the content since it was loaded
 * (compared by content version); otherwise the latest content reloads
 * instead of overwriting someone else's work.
 */
export function useRestContentSave({ page, enabled }: Options) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const baseVersionRef = useRef(page.contentVersion);
  const pendingRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [hasPending, setHasPending] = useState(false);
  const pageId = page.id;

  const flush = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const markdown = pendingRef.current;
    if (markdown === null || inFlightRef.current) return;
    pendingRef.current = null;
    inFlightRef.current = true;
    try {
      const latest = await getPage(pageId);
      if (latest.contentVersion !== baseVersionRef.current) {
        baseVersionRef.current = latest.contentVersion;
        queryClient.setQueryData(pageQueryKeys.detail(pageId), latest);
        setReloadKey((key) => key + 1);
        toast.error(t("pages:toasts.contentConflict"));
        return;
      }
      const saved = await replacePageContent(pageId, markdown);
      baseVersionRef.current = saved.contentVersion;
      queryClient.setQueryData(pageQueryKeys.detail(pageId), saved);
    } catch (error) {
      toast.error(
        pageErrorMessage(error) ?? t("pages:toasts.contentSaveError"),
      );
    } finally {
      inFlightRef.current = false;
      setHasPending(pendingRef.current !== null);
      if (pendingRef.current !== null) void flush();
    }
  }, [pageId, queryClient, t]);

  const schedule = useCallback(
    (markdown: string) => {
      if (!enabled) return;
      pendingRef.current = markdown;
      setHasPending(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => void flush(), REST_SAVE_DEBOUNCE_MS);
    },
    [enabled, flush],
  );

  // Leaving the stored copy (live sync is back, or another page) saves what
  // is pending rather than dropping it.
  useEffect(() => () => void flush(), [flush]);

  useEffect(() => {
    if (!hasPending) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [hasPending]);

  return { schedule, flush, reloadKey };
}
