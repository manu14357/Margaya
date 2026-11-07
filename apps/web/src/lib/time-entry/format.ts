import type { useTranslation } from "react-i18next";
import { splitDuration } from "./duration";

type Translate = ReturnType<typeof useTranslation>["t"];

/** Seconds as people read them: "1h 30m", "2h", "45m". */
export function formatLoggedTime(seconds: number, t: Translate) {
  const { hours, minutes } = splitDuration(seconds);
  if (hours && minutes) {
    return t("tasks:timeTracking.hoursMinutes", { hours, minutes });
  }
  if (hours) return t("tasks:timeTracking.hours", { hours });
  return t("tasks:timeTracking.minutes", { minutes });
}
