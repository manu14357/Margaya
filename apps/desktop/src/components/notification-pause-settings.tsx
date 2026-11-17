import { useEffect, useId, useState } from "react";
import { errorMessage } from "../lib/errors";
import { useT } from "../lib/i18n";
import {
  api,
  events,
  type NotificationPause,
  type NotificationPauseMode,
} from "../lib/ipc";

const MODES: NotificationPauseMode[] = ["off", "hour", "tomorrow", "forever"];

const LABELS: Record<NotificationPauseMode, string> = {
  off: "settings.pauseOff",
  hour: "settings.pauseHour",
  tomorrow: "settings.pauseTomorrow",
  forever: "settings.pauseForever",
};

/** When a pause ends: the time, with the day when it isn't today. */
export function pauseEndText(until: number, now = new Date()): string {
  const end = new Date(until);
  const sameDay = end.toDateString() === now.toDateString();
  return new Intl.DateTimeFormat(document.documentElement.lang || undefined, {
    ...(sameDay ? {} : { weekday: "short" }),
    hour: "numeric",
    minute: "2-digit",
  }).format(end);
}

/**
 * The settings row for "Pause notifications": off, for an hour, until
 * tomorrow morning, or until turned back on. The tray offers the same
 * choices; either place updates the other. Hidden with an older core.
 */
export function NotificationPauseSettings() {
  const t = useT();
  const ids = { select: useId(), hint: useId() };
  const [pause, setPause] = useState<NotificationPause | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api
      .getNotificationPause()
      .then(setPause)
      // An older core has no such setting: no row.
      .catch(() => {});
    const unlisten = events.notificationPauseChanged(setPause);
    return () => {
      void unlisten.then((stop) => stop());
    };
  }, []);

  if (!pause) return null;

  const change = async (mode: NotificationPauseMode) => {
    setError(null);
    try {
      setPause(await api.setNotificationPause(mode));
    } catch (caught) {
      setError(caught);
    }
  };

  const status =
    pause.mode === "off"
      ? null
      : pause.until === null
        ? t("settings.pausedForever")
        : t("settings.pausedUntil", { time: pauseEndText(pause.until) });

  return (
    <div className="settings-row">
      <div className="settings-text">
        <label htmlFor={ids.select} className="settings-label">
          {t("settings.pauseLabel")}
        </label>
        <p id={ids.hint} className="settings-hint">
          {t("settings.pauseHint")}
        </p>
        {status ? (
          <p className="settings-hint" role="status">
            {status}
          </p>
        ) : null}
        {error ? (
          <p className="message error" role="alert">
            {errorMessage(t, error)}
          </p>
        ) : null}
      </div>
      <select
        id={ids.select}
        aria-describedby={ids.hint}
        value={pause.mode}
        onChange={(event) =>
          void change(event.target.value as NotificationPauseMode)
        }
      >
        {MODES.map((mode) => (
          <option key={mode} value={mode}>
            {t(LABELS[mode])}
          </option>
        ))}
      </select>
    </div>
  );
}
