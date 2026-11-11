import { useEffect, useState } from "react";
import { errorMessage } from "../lib/errors";
import { useT } from "../lib/i18n";
import { api, events, type Settings } from "../lib/ipc";

type UpdateState = "idle" | "checking" | "upToDate" | "installing";

export function SettingsPanel() {
  const t = useT();
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
    <section className="card" aria-labelledby="settings-heading">
      <h2 id="settings-heading">{t("settings.heading")}</h2>
      <label className="toggle">
        <input
          type="checkbox"
          checked={settings?.autostart ?? false}
          disabled={!settings}
          onChange={(event) => void toggleAutostart(event.target.checked)}
        />
        <span>{t("settings.openAtLogin")}</span>
      </label>
      {update ? (
        <div className="message success row">
          <span className="grow">
            {selfUpdate
              ? t("settings.updateAvailable", { version: update })
              : t("settings.updatePackage", { version: update })}
          </span>
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
      <div className="row">
        <button
          type="button"
          className="button"
          onClick={() => void copyDiagnostics()}
        >
          {t("settings.copyDiagnostics")}
        </button>
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
        <span className="muted grow end-text">
          {settings
            ? t("settings.version", { version: settings.version })
            : null}
        </span>
      </div>
      {updateState === "upToDate" ? (
        <p className="muted">{t("settings.upToDate")}</p>
      ) : null}
      {notice ? (
        <p className="muted" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="message error" role="alert">
          {errorMessage(t, error)}
        </p>
      ) : null}
    </section>
  );
}
