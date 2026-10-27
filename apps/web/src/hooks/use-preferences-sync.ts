import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import getUserPreferences from "@/fetchers/user/get-user-preferences";
import updateUserPreferences from "@/fetchers/user/update-user-preferences";
import useUserTimezone from "@/hooks/queries/user/use-user-timezone";
import {
  applyServerPreferences,
  changedPreferences,
  chosenPreferences,
  currentPreferences,
  MAIN_KEYS,
  SCHEDULE_KEYS,
  type SyncedPreferences,
} from "@/lib/preferences-sync";
import { useScheduleViewPreferences } from "@/store/schedule-view-preferences";
import { useUserPreferencesStore } from "@/store/user-preferences";

export const userPreferencesQueryKey = ["user", "preferences"] as const;

const WRITE_DELAY_MS = 800;

/**
 * Keeps the signed-in user's preferences on the server. Local values stay
 * authoritative until the server answers (no theme flash), then server
 * values win except for local changes still being saved. Writes are
 * debounced and flushed when the tab is hidden.
 */
export function usePreferencesSync(enabled: boolean) {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: userPreferencesQueryKey,
    queryFn: getUserPreferences,
    enabled,
    staleTime: 60_000,
  });
  const { data: timezone } = useUserTimezone({ enabled });

  const pending = useRef<SyncedPreferences>({});
  const applying = useRef(false);
  const seeded = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useRef(async () => {});
  flush.current = async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const patch = pending.current;
    if (Object.keys(patch).length === 0) return;
    pending.current = {};
    try {
      const saved = await updateUserPreferences(patch);
      queryClient.setQueryData(userPreferencesQueryKey, saved);
    } catch {
      // The local cache keeps the choice; the next change retries.
    }
  };

  const queue = useRef((_changes: SyncedPreferences) => {});
  queue.current = (changes) => {
    if (!enabled || Object.keys(changes).length === 0) return;
    pending.current = { ...pending.current, ...changes };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush.current(), WRITE_DELAY_MS);
  };

  // Local changes go to the server.
  useEffect(() => {
    if (!enabled) return;
    const watch = (keys: readonly string[]) => (next: object, prev: object) => {
      if (applying.current) return;
      queue.current(
        changedPreferences(
          prev as Record<string, unknown>,
          next as Record<string, unknown>,
          keys,
        ),
      );
    };
    const stopMain = useUserPreferencesStore.subscribe(watch(MAIN_KEYS));
    const stopSchedule = useScheduleViewPreferences.subscribe(
      watch(SCHEDULE_KEYS),
    );
    const onHide = () => {
      if (document.visibilityState === "hidden") void flush.current();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      stopMain();
      stopSchedule();
      document.removeEventListener("visibilitychange", onHide);
      void flush.current();
    };
  }, [enabled]);

  // Server values come in.
  useEffect(() => {
    if (!data) return;
    if (data.preferences === null) {
      // Never saved: seed the server with what this browser chose.
      if (!seeded.current) {
        seeded.current = true;
        queue.current(chosenPreferences(currentPreferences()));
      }
      return;
    }
    applying.current = true;
    try {
      applyServerPreferences(
        data.preferences,
        new Set(Object.keys(pending.current)),
      );
    } finally {
      applying.current = false;
    }
  }, [data]);

  // The account time zone drives task-query dates (null: the browser's).
  useEffect(() => {
    if (timezone === undefined) return;
    const { timeZone, setTimeZone } = useUserPreferencesStore.getState();
    if (timezone.timezone !== timeZone) setTimeZone(timezone.timezone);
  }, [timezone]);
}
