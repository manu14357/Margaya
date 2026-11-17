import { useEffect, useId, useState } from "react";
import { errorMessage } from "../lib/errors";
import { useT } from "../lib/i18n";
import { api } from "../lib/ipc";

/**
 * Settings rows for offline reading: keep read-only copies of recently
 * opened tasks and pages (on by default; turning it off deletes them), and
 * delete every server's copies now.
 */
export function OfflineSettings() {
  const t = useT();
  const ids = { toggle: useId(), hint: useId() };
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api
      .getOfflineReading()
      .then((settings) =>
        setEnabled(
          typeof settings?.enabled === "boolean" ? settings.enabled : null,
        ),
      )
      // An older core: the row stays disabled rather than showing an error.
      .catch(() => {});
  }, []);

  const toggle = async (next: boolean) => {
    setError(null);
    setNotice(null);
    try {
      await api.setOfflineReading(next);
      setEnabled(next);
      if (!next) setNotice(t("settings.offlineCleared"));
    } catch (caught) {
      setError(caught);
    }
  };

  const clear = async () => {
    setError(null);
    setNotice(null);
    try {
      await api.clearOfflineCopies();
      setNotice(t("settings.offlineCleared"));
    } catch (caught) {
      setError(caught);
    }
  };

  return (
    <>
      <div className="settings-row">
        <div className="settings-text">
          <label htmlFor={ids.toggle} className="settings-label">
            {t("settings.offlineReading")}
          </label>
          <p id={ids.hint} className="settings-hint">
            {t("settings.offlineReadingHint")}
          </p>
        </div>
        <input
          id={ids.toggle}
          type="checkbox"
          role="switch"
          className="switch"
          aria-describedby={ids.hint}
          aria-checked={enabled ?? false}
          checked={enabled ?? false}
          disabled={enabled === null}
          onChange={(event) => void toggle(event.target.checked)}
        />
      </div>
      <div className="settings-row">
        <div className="settings-text">
          <span className="settings-label">
            {t("settings.offlineCopiesLabel")}
          </span>
          <p className="settings-hint">{t("settings.offlineCopiesHint")}</p>
          {notice ? (
            <p className="settings-hint success-text" role="status">
              {notice}
            </p>
          ) : null}
          {error ? (
            <p className="message error" role="alert">
              {errorMessage(t, error)}
            </p>
          ) : null}
        </div>
        <button type="button" className="button" onClick={() => void clear()}>
          {t("settings.offlineClear")}
        </button>
      </div>
    </>
  );
}
