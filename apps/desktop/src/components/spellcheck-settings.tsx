import { useEffect, useId, useState } from "react";
import { errorMessage } from "../lib/errors";
import { useT } from "../lib/i18n";
import { api, type SpellcheckSettings as Settings } from "../lib/ipc";

/** A language's name in that language, so people find their own. */
export function languageName(tag: string): string {
  try {
    const name = new Intl.DisplayNames([tag], { type: "language" }).of(tag);
    return name ? name.charAt(0).toLocaleUpperCase(tag) + name.slice(1) : tag;
  } catch {
    return tag;
  }
}

/**
 * The settings row for the spell checker's language in server windows: the
 * system's, or one of the app's languages. Hidden where the system's own
 * spelling settings apply (macOS) and with an older core.
 */
export function SpellcheckSettings() {
  const t = useT();
  const ids = { select: useId(), hint: useId() };
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api
      .getSpellcheck()
      .then(setSettings)
      // An older core has no such setting: no row.
      .catch(() => {});
  }, []);

  if (!settings?.supported) return null;

  const change = async (language: string) => {
    setError(null);
    try {
      setSettings(await api.setSpellcheck(language));
    } catch (caught) {
      setError(caught);
    }
  };

  const system = settings.systemLanguage
    ? t("settings.spellcheckSystemNamed", {
        language: languageName(settings.systemLanguage),
      })
    : t("settings.spellcheckSystem");

  return (
    <div className="settings-row">
      <div className="settings-text">
        <label htmlFor={ids.select} className="settings-label">
          {t("settings.spellcheckLabel")}
        </label>
        <p id={ids.hint} className="settings-hint">
          {t("settings.spellcheckHint")}
        </p>
        {settings.restartNeeded ? (
          <p className="settings-hint" role="status">
            {t("settings.spellcheckRestart")}
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
        value={settings.language}
        onChange={(event) => void change(event.target.value)}
      >
        <option value="system">{system}</option>
        {settings.languages.map((language) => (
          <option key={language} value={language} lang={language}>
            {languageName(language)}
          </option>
        ))}
      </select>
    </div>
  );
}
