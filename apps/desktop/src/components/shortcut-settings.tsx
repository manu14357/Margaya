import { useEffect, useId, useRef, useState } from "react";
import { errorMessage } from "../lib/errors";
import { useT } from "../lib/i18n";
import {
  api,
  type Settings,
  type ShortcutAction,
  type ShortcutView,
} from "../lib/ipc";
import { formatAccelerator, recordKey } from "../lib/shortcuts";

const LABEL_KEYS: Record<ShortcutAction, string> = {
  quickAdd: "settings.shortcutQuickAdd",
  search: "settings.shortcutSearch",
  screenshot: "settings.shortcutScreenshot",
  today: "settings.shortcutToday",
  files: "settings.shortcutFiles",
};

type RowError = { action: ShortcutAction; error: unknown };

/**
 * "Keyboard shortcuts": one row per action with a recorder (press the new
 * keys), Clear and Reset. The core validates the combination and registers
 * it with the system; when another app holds it, the previous one stays.
 */
export function ShortcutSettings({
  platform,
}: {
  platform: Settings["platform"];
}) {
  const t = useT();
  const headingId = useId();
  const [shortcuts, setShortcuts] = useState<ShortcutView[] | null>(null);
  const [recording, setRecording] = useState<ShortcutAction | null>(null);
  const [error, setError] = useState<RowError | null>(null);
  const [saved, setSaved] = useState<ShortcutAction | null>(null);
  const recordingRef = useRef<ShortcutAction | null>(null);
  // The latest stop/record handlers, for the listeners below.
  const handlersRef = useRef<{
    stop: () => Promise<void>;
    record: (action: ShortcutAction, event: globalThis.KeyboardEvent) => void;
  } | null>(null);

  // While recording, keys are read on the whole window, not on the button:
  // on macOS WebKit never focuses a clicked button, so its own keydown and
  // blur never fire and the keys went nowhere. A click elsewhere or leaving
  // the window ends the recording.
  useEffect(() => {
    if (!recording) return;
    const action = recording;
    const button = document.querySelector<HTMLButtonElement>(
      `[data-recorder="${action}"]`,
    );
    button?.focus();
    const onKey = (event: globalThis.KeyboardEvent) => {
      handlersRef.current?.record(action, event);
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest(`[data-recorder="${action}"]`)
      ) {
        return;
      }
      void handlersRef.current?.stop();
    };
    const onWindowBlur = () => void handlersRef.current?.stop();
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("blur", onWindowBlur);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("blur", onWindowBlur);
    };
  }, [recording]);

  useEffect(() => {
    api
      .getShortcuts()
      .then(setShortcuts)
      // An older core has no such setting: no section.
      .catch(() => {});
    return () => {
      // Never leave the shortcuts released when the panel goes away.
      if (recordingRef.current) void api.pauseShortcuts(false).catch(() => {});
    };
  }, []);

  if (!shortcuts) return null;

  const begin = async (action: ShortcutAction) => {
    setError(null);
    setSaved(null);
    setRecording(action);
    recordingRef.current = action;
    // Let go of the global shortcuts so the keys reach the recorder.
    await api.pauseShortcuts(true).catch(() => {});
  };

  const stop = async () => {
    setRecording(null);
    recordingRef.current = null;
    try {
      setShortcuts(await api.pauseShortcuts(false));
    } catch {
      // The core keeps what it had.
    }
  };

  const apply = async (
    action: ShortcutAction,
    run: () => Promise<ShortcutView[]>,
  ) => {
    setError(null);
    setSaved(null);
    try {
      setShortcuts(await run());
      setSaved(action);
    } catch (caught) {
      setError({ action, error: caught });
      // Validation failed before anything was registered again.
      await stop();
      return;
    }
    setRecording(null);
    recordingRef.current = null;
  };

  const record = (action: ShortcutAction, event: globalThis.KeyboardEvent) => {
    if (recordingRef.current !== action) return;
    event.preventDefault();
    event.stopPropagation();
    const key = recordKey(event);
    if (key.kind === "cancel") void stop();
    else if (key.kind === "done")
      void apply(action, () => api.setShortcut(action, key.accelerator));
  };
  handlersRef.current = { stop, record };

  return (
    <section aria-labelledby={headingId} className="shortcut-settings">
      <h3 id={headingId} className="section-title">
        {t("settings.shortcutsHeading")}
      </h3>
      <p className="settings-hint shortcut-intro">
        {t("settings.shortcutsHint")}
      </p>
      <div className="settings-group">
        {shortcuts.map((shortcut) => {
          const label = t(LABEL_KEYS[shortcut.action]);
          const isRecording = recording === shortcut.action;
          const rowError =
            error?.action === shortcut.action ? error.error : null;
          return (
            <div
              key={shortcut.action}
              className="settings-row"
              data-action={shortcut.action}
            >
              <div className="settings-text">
                <span className="settings-label">{label}</span>
                <p className="settings-hint">
                  {shortcut.accelerator ? (
                    <kbd className="shortcut-keys">
                      {formatAccelerator(shortcut.accelerator, platform)}
                    </kbd>
                  ) : (
                    t("settings.shortcutNone")
                  )}
                </p>
                {shortcut.accelerator && !shortcut.active ? (
                  <p className="settings-hint warning-text">
                    {t("settings.shortcutInactive")}
                  </p>
                ) : null}
                {isRecording ? (
                  <p className="settings-hint" aria-live="polite">
                    {t("settings.shortcutRecordingHint")}
                  </p>
                ) : null}
                {saved === shortcut.action ? (
                  <p className="settings-hint success-text" role="status">
                    {t("settings.shortcutSaved")}
                  </p>
                ) : null}
                {rowError ? (
                  <p className="message error" role="alert">
                    {errorMessage(t, rowError)}
                  </p>
                ) : null}
              </div>
              <div className="shortcut-actions">
                <button
                  type="button"
                  className={isRecording ? "button primary" : "button"}
                  aria-label={
                    isRecording
                      ? t("settings.shortcutRecording")
                      : `${t("settings.shortcutChange")}: ${label}`
                  }
                  aria-pressed={isRecording}
                  disabled={recording !== null && !isRecording}
                  onClick={() => {
                    if (!isRecording) void begin(shortcut.action);
                  }}
                  data-recorder={shortcut.action}
                >
                  {isRecording
                    ? t("settings.shortcutRecording")
                    : t("settings.shortcutChange")}
                </button>
                <button
                  type="button"
                  className="button ghost"
                  aria-label={`${t("settings.shortcutClear")}: ${label}`}
                  disabled={recording !== null || !shortcut.accelerator}
                  onClick={() =>
                    void apply(shortcut.action, () =>
                      api.setShortcut(shortcut.action, null),
                    )
                  }
                >
                  {t("settings.shortcutClear")}
                </button>
                <button
                  type="button"
                  className="button ghost"
                  aria-label={`${t("settings.shortcutReset")}: ${label}`}
                  disabled={
                    recording !== null ||
                    shortcut.accelerator === shortcut.defaultAccelerator
                  }
                  onClick={() =>
                    void apply(shortcut.action, () =>
                      api.resetShortcut(shortcut.action),
                    )
                  }
                >
                  {t("settings.shortcutReset")}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
