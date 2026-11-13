import { useLocation } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { checkFeedbackSurvey } from "@/fetchers/feedback/feedback";
import { useFeedbackConfig } from "@/hooks/queries/feedback/use-feedback";
import {
  isQuietMoment,
  isSurveyQuietPath,
  type SurveyFormat,
} from "@/lib/feedback";

// When the occasional survey may ask. The server decides whether someone is
// due (first week, interval, snooze, Don't ask again, triggers); this hook
// only picks a quiet moment to ask it: a while after the app opens, then at
// most every CHECK_INTERVAL_MS after moving to another page, and only while
// nothing is being typed and no dialog or menu is open.

export const FIRST_CHECK_DELAY_MS = 2 * 60 * 1000;
export const CHECK_INTERVAL_MS = 20 * 60 * 1000;
const SETTLE_MS = 4000;
const RETRY_MS = 30 * 1000;

export function useSurveyTrigger() {
  const { data: config } = useFeedbackConfig();
  const pathname = useLocation({ select: (location) => location.pathname });
  const [format, setFormat] = useState<SurveyFormat | null>(null);
  const lastCheck = useRef<number | null>(null);
  const openedAt = useRef(Date.now());
  const done = useRef(false);
  const pathRef = useRef(pathname);
  pathRef.current = pathname;

  const active = Boolean(
    config?.enabled && config.survey.enabled && !config.survey.optedOut,
  );

  // A new page (or the app opening) schedules a check once things settle.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a navigation is the trigger
  useEffect(() => {
    if (!active || done.current) return;
    const now = Date.now();
    const sinceOpen = now - openedAt.current;
    const sinceCheck =
      lastCheck.current === null
        ? Number.POSITIVE_INFINITY
        : now - lastCheck.current;
    const wait = Math.max(
      SETTLE_MS,
      FIRST_CHECK_DELAY_MS - sinceOpen,
      CHECK_INTERVAL_MS - sinceCheck,
    );
    let timer: ReturnType<typeof setTimeout>;
    const attempt = () => {
      if (done.current) return;
      if (isSurveyQuietPath(pathRef.current) || !isQuietMoment()) {
        timer = setTimeout(attempt, RETRY_MS);
        return;
      }
      lastCheck.current = Date.now();
      checkFeedbackSurvey()
        .then((result) => {
          if (result.show) {
            done.current = true;
            setFormat(result.format);
          }
        })
        .catch(() => {
          // A failed check simply waits for the next quiet moment.
        });
    };
    timer = setTimeout(attempt, wait);
    return () => clearTimeout(timer);
  }, [active, pathname]);

  const close = useCallback(() => setFormat(null), []);
  return { format: active ? format : null, close };
}
