import { useEffect, useId, useState } from "react";
import { errorMessage } from "../lib/errors";
import { useT } from "../lib/i18n";
import { api, events, type Settings } from "../lib/ipc";

type UpdateState = "idle" | "checking" | "upToDate" | "installing";

/**
 * The app's own settings, as rows like the web app's settings pages: what a
 * setting is on the left, its control on the right.
 */
export function SettingsPanel() {
  const t = useT();
  const ids = { autostart: useId(), autostartHint: useId() };
  const [settings, setSettings] = useState<Settings | null>(null);
  const [update, setUpdate] = useState<string | null>(null);
  const [updateState, setUpdateState] = useState<UpdateState>("idle");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api.getSettings().then(setSettings).catch(setError);
    const unlisten = events.updateAvailable(setUpdate);
    return () => {
      void unlisten.then((stop) => stop());
    };
  }, []);

  const toggleAutostart = async (enabled: boolean) => {
    setError(null);
    try {
      await api.setAutostart(enabled);
      setSettings((current) =>
        current ? { ...current, autostart: enabled } : current,
      );
    } catch (caught) {
      setError(caught);
    }
  };

  const copyDiagnostics = async () => {
    setError(null);
    setNotice(null);
    try {
      await api.copyDiagnostics();
      setNotice(t("settings.copied"));
    } catch (caught) {
      setError(caught);
    }
  };

  const checkForUpdate = async () => {
    setError(null);
    setUpdateState("checking");
    try {
      const version = await api.checkForUpdate();
      setUpdate(version);
      setUpdateState(version ? "idle" : "upToDate");
    } catch (caught) {
      setUpdateState("idle");
      setError(caught);
    }
  };

  // A Linux .deb or .rpm can't replace itself: install_update opens the
  // download page instead, and the app keeps running.
  const selfUpdate = settings?.selfUpdate !== false;

  const installUpdate = async () => {
    if (selfUpdate) setUpdateState("installing");
    try {
      await api.installUpdate();
    } catch (caught) {
      setUpdateState("idle");
      setError(caught);
    }
  };

  return (
    <section aria-labelledby="settings-heading">
      <h2 id="settings-heading" className="section-title">
        {t("settings.heading")}
      </h2>
      <div className="settings-group">
        <div className="settings-row">
          <div className="settings-text">
            <label htmlFor={ids.autostart} className="settings-label">
              {t("settings.openAtLogin")}
            </label>
            <p id={ids.autostartHint} className="settings-hint">
              {t("settings.openAtLoginHint")}
            </p>
          </div>
          <input
            id={ids.autostart}
            type="checkbox"
            role="switch"
            className="switch"
            aria-describedby={ids.autostartHint}
            aria-checked={settings?.autostart ?? false}
            checked={settings?.autostart ?? false}
            disabled={!settings}
            onChange={(event) => void toggleAutostart(event.target.checked)}
          />
        </div>

        <div className="settings-row">
          <div className="settings-text">
            <span className="settings-label">{t("settings.updatesLabel")}</span>
            <p className="settings-hint">
              {settings
                ? t("settings.version", { version: settings.version })
                : null}
            </p>
            {updateState === "upToDate" && !update ? (
              <p className="settings-hint success-text" role="status">
                {t("settings.upToDate")}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            className="button"
            disabled={updateState === "checking"}
            onClick={() => void checkForUpdate()}
          >
            {updateState === "checking"
              ? t("settings.checking")
              : t("settings.checkUpdates")}
          </button>
        </div>

        {update ? (
          <div className="settings-row highlight">
            <div className="settings-text">
              <span className="settings-label">
                {selfUpdate
                  ? t("settings.updateAvailable", { version: update })
                  : t("settings.updatePackage", { version: update })}
              </span>
            </div>
            <button
              type="button"
              className="button primary"
              disabled={updateState === "installing"}
              onClick={() => void installUpdate()}
            >
              {!selfUpdate
                ? t("settings.updateDownload")
                : updateState === "installing"
                  ? t("settings.updating")
                  : t("settings.updateInstall")}
            </button>
          </div>
        ) : null}

        <div className="settings-row">
          <div className="settings-text">
            <span className="settings-label">
              {t("settings.diagnosticsLabel")}
            </span>
            <p className="settings-hint">{t("settings.diagnosticsHint")}</p>
            {notice ? (
              <p className="settings-hint success-text" role="status">
                {notice}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            className="button"
            onClick={() => void copyDiagnostics()}
          >
            {t("settings.copyDiagnostics")}
          </button>
        </div>
      </div>
      {error ? (
        <p className="message error settings-error" role="alert">
          {errorMessage(t, error)}
        </p>
      ) : null}
    </section>
  );
}
