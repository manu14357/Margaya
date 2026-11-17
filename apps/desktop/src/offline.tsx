import { useCallback, useEffect, useRef, useState } from "react";
import { OfflineReader, RecentList } from "./components/offline-reader";
import { errorMessage } from "./lib/errors";
import { useT } from "./lib/i18n";
import {
  api,
  type OfflineItem,
  type OfflineItemSummary,
  type OfflineState,
} from "./lib/ipc";

/**
 * Shown inside a server window (index.html#offline) when the server can't be
 * reached. Counts down to an automatic retry, which the Rust core checks
 * before leaving; "Try again" always reloads the server page. Below, the
 * server's recently opened tasks and pages, readable as saved copies.
 */
export function Offline() {
  const t = useT();
  const [state, setState] = useState<OfflineState | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [recent, setRecent] = useState<OfflineItemSummary[]>([]);
  const [reading, setReading] = useState<OfflineItem | null>(null);
  const [missing, setMissing] = useState(false);
  const busy = useRef(false);

  const retry = useCallback(async (manual: boolean) => {
    if (busy.current) return;
    busy.current = true;
    setRetrying(true);
    try {
      const next = await api.offlineRetry(manual);
      // null: the window is going back to the server.
      if (next) setState(next);
    } catch {
      // The window left the offline page, or the app refused: nothing to do.
    } finally {
      busy.current = false;
      setRetrying(false);
    }
  }, []);

  useEffect(() => {
    api
      .offlineState()
      .then(setState)
      .catch(() => {});
    // An older core has no saved copies: the list just stays empty.
    api
      .offlineItems()
      .then((items) => setRecent(Array.isArray(items) ? items : []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (state) document.title = state.serverName;
  }, [state]);

  useEffect(() => {
    if (!state) return;
    const due = Date.now() + state.retryInMs;
    const tick = () => {
      const left = Math.max(0, Math.ceil((due - Date.now()) / 1000));
      setSeconds(left);
      if (left === 0) void retry(false);
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [state, retry]);

  const open = useCallback(async (summary: OfflineItemSummary) => {
    setMissing(false);
    try {
      const item = await api.offlineItem(summary.kind, summary.id);
      if (item) setReading(item);
      else setMissing(true);
    } catch {
      setMissing(true);
    }
  }, []);

  if (!state) return null;

  if (reading) {
    return (
      <main className="offline offline-reading">
        <OfflineReader
          item={reading}
          retrying={retrying}
          onRetry={() => void retry(true)}
          onBack={() => setReading(null)}
        />
      </main>
    );
  }

  const reason = errorMessage(t, { kind: state.errorKind, message: "" });

  return (
    <main className="offline">
      <img src="./logo.svg" alt="" width={40} height={40} />
      <h1>{t("offline.title", { name: state.serverName })}</h1>
      <p className="muted">{t("offline.body")}</p>
      <p className="offline-url">{state.webUrl}</p>
      <p className="message error" aria-live="polite">
        {t("offline.lastError", { error: reason })}
      </p>
      <p className="muted" role="status">
        {retrying
          ? t("offline.retrying")
          : t("offline.retryIn", { count: seconds })}
      </p>
      <div className="row">
        <button
          type="button"
          className="button primary"
          disabled={retrying}
          onClick={() => void retry(true)}
        >
          {t("offline.retry")}
        </button>
        <button
          type="button"
          className="button"
          onClick={() => void api.showServers().catch(() => {})}
        >
          {t("offline.switchServer")}
        </button>
      </div>
      {missing ? (
        <p className="message error" role="alert">
          {t("offline.copyMissing")}
        </p>
      ) : null}
      <RecentList items={recent} onOpen={(item) => void open(item)} />
    </main>
  );
}
