import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "./lib/i18n";
import { api } from "./lib/ipc";
import {
  onHidden,
  onShown,
  type TodayOutcome,
  type TodayTask,
  todayApi,
} from "./lib/search-api";
import "./today.css";

/** The list refreshes this often while the window is open. */
export const TODAY_REFRESH_MS = 5 * 60 * 1000;

function taskKey(task: TodayTask) {
  return `${task.serverId}/${task.id}`;
}

/** A short due date in the page's locale, for overdue tasks. */
function dueLabel(dueDate: string | null): string | null {
  if (!dueDate) return null;
  const date = new Date(dueDate);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(document.documentElement.lang || undefined, {
    month: "short",
    day: "numeric",
  }).format(date);
}

export function Today() {
  const t = useT();
  const [signedIn, setSignedIn] = useState<number | null>(null);
  const [outcome, setOutcome] = useState<TodayOutcome | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<
    "completeFailed" | "openFailed" | null
  >(null);
  const loadingRef = useRef(false);

  const refresh = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      const servers = await api.listServers();
      const count = servers.filter((server) => server.signedIn).length;
      setSignedIn(count);
      if (count === 0) {
        setOutcome({ tasks: [], unavailable: [] });
        return;
      }
      setOutcome(await todayApi.tasks());
      setDone(new Set());
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // The timer runs only while the window shows; showing it again
    // refreshes once and starts the timer over.
    let timer: number | undefined;
    const start = () => {
      if (timer === undefined) {
        timer = window.setInterval(() => void refresh(), TODAY_REFRESH_MS);
      }
    };
    const pause = () => {
      window.clearInterval(timer);
      timer = undefined;
    };
    const shown = () => {
      pause();
      start();
      void refresh();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") pause();
      else shown();
    };
    void refresh();
    if (document.visibilityState !== "hidden") start();
    const onFocus = () => void refresh();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") void todayApi.close();
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("keydown", onKey);
    document.addEventListener("visibilitychange", onVisibility);
    const unlistenShown = onShown("today-refresh", shown);
    const unlistenHidden = onHidden("today-hidden", pause);
    return () => {
      pause();
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onVisibility);
      void unlistenShown.then((stop) => stop());
      void unlistenHidden.then((stop) => stop());
    };
  }, [refresh]);

  const complete = async (task: TodayTask) => {
    const key = taskKey(task);
    setMessage(null);
    setDone((current) => new Set(current).add(key));
    try {
      await todayApi.complete(task.serverId, task.id, task.projectId);
      setOutcome((current) =>
        current
          ? {
              ...current,
              tasks: current.tasks.filter((item) => taskKey(item) !== key),
            }
          : current,
      );
    } catch {
      setMessage("completeFailed");
    } finally {
      setDone((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  };

  const open = (task: TodayTask) => {
    setMessage(null);
    todayApi
      .open(task.serverId, task.path)
      .catch(() => setMessage("openFailed"));
  };

  const multipleServers = (signedIn ?? 0) > 1;
  const tasks = outcome?.tasks ?? [];
  const overdue = tasks.filter((task) => task.overdue);
  const dueToday = tasks.filter((task) => !task.overdue);

  const renderTask = (task: TodayTask) => {
    const key = taskKey(task);
    const pending = done.has(key);
    const due = task.overdue ? dueLabel(task.dueDate) : null;
    const where = [
      task.projectName,
      multipleServers
        ? t("search.group", {
            workspace: task.workspaceName,
            server: task.serverLabel,
          })
        : task.workspaceName,
    ]
      .filter(Boolean)
      .join(" · ");
    return (
      <li key={key} className="today-task">
        <input
          type="checkbox"
          className="today-check"
          checked={pending}
          disabled={pending}
          aria-label={t("today.markDone", { title: task.title })}
          onChange={() => void complete(task)}
        />
        <div className="today-text">
          <button
            type="button"
            className="today-title"
            onClick={() => open(task)}
          >
            {task.key ? <span className="today-key">{task.key}</span> : null}
            {task.title}
          </button>
          <span className="today-meta">
            {due ? <span className="today-due">{due}</span> : null}
            {where}
          </span>
        </div>
      </li>
    );
  };

  let status: string | null = null;
  if (signedIn === 0) status = t("today.noServers");
  else if (failed && outcome === null) status = t("today.failed");
  else if (outcome === null) status = t("today.loading");
  else if (tasks.length === 0) status = t("today.empty");

  return (
    <main className="today" aria-busy={loading}>
      <header className="today-header">
        <h1>{t("today.title")}</h1>
        <button
          type="button"
          className="button ghost today-refresh"
          aria-label={t("today.refresh")}
          title={t("today.refresh")}
          disabled={loading}
          onClick={() => void refresh()}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className={loading ? "spinning" : undefined}
          >
            <path d="M13 8a5 5 0 1 1-1.5-3.5M13 2.5V5h-2.5" />
          </svg>
        </button>
      </header>
      {message ? (
        <p className="message error today-message" role="alert">
          {message === "completeFailed"
            ? t("today.completeFailed")
            : t("today.openFailed")}
        </p>
      ) : null}
      {failed && outcome !== null ? (
        <p className="message warning today-message" role="status">
          {t("today.failed")}
        </p>
      ) : null}
      {outcome && outcome.unavailable.length > 0 ? (
        <p className="message warning today-message" role="status">
          {t("today.unavailable", { servers: outcome.unavailable.join(", ") })}
        </p>
      ) : null}
      {status ? (
        <p className="today-status" role="status">
          {status}
        </p>
      ) : null}
      {overdue.length > 0 ? (
        <section className="today-section" aria-labelledby="today-overdue">
          <h2 id="today-overdue" className="today-section-title overdue">
            {t("today.overdue")}
            <span className="today-count">{overdue.length}</span>
          </h2>
          <ul className="today-list">{overdue.map(renderTask)}</ul>
        </section>
      ) : null}
      {dueToday.length > 0 ? (
        <section className="today-section" aria-labelledby="today-due">
          <h2 id="today-due" className="today-section-title">
            {t("today.dueToday")}
            <span className="today-count">{dueToday.length}</span>
          </h2>
          <ul className="today-list">{dueToday.map(renderTask)}</ul>
        </section>
      ) : null}
    </main>
  );
}
