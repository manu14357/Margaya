import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ItemIcon } from "./components/item-icon";
import { type Translate, useT } from "./lib/i18n";
import { api, type ServerView } from "./lib/ipc";
import {
  onShown,
  type SearchItem,
  type SearchOutcome,
  searchApi,
} from "./lib/search-api";
import "./search.css";

/** Typing pauses this long before a search goes out. */
export const SEARCH_DEBOUNCE_MS = 200;

export function kindLabel(t: Translate, kind: string): string {
  switch (kind) {
    case "task":
      return t("search.kinds.task");
    case "project":
      return t("search.kinds.project");
    case "page":
      return t("search.kinds.page");
    case "cycle":
      return t("search.kinds.cycle");
    case "module":
      return t("search.kinds.module");
    case "view":
      return t("search.kinds.view");
    case "intake":
      return t("search.kinds.intake");
    case "comment":
      return t("search.kinds.comment");
    case "activity":
      return t("search.kinds.activity");
    case "workspace":
      return t("search.kinds.workspace");
    default:
      return t("search.kinds.other");
  }
}

type Entry = { serverId: string; item: SearchItem; optionId: string };

function optionId(serverId: string, workspaceId: string, item: SearchItem) {
  return `opt-${[serverId, workspaceId, item.kind, item.id].join("-").replace(/[^\w-]/g, "_")}`;
}

/** Every item in display order, for arrow keys. */
function flatten(outcome: SearchOutcome | null): Entry[] {
  return (outcome?.groups ?? []).flatMap((group) =>
    group.sections.flatMap((section) =>
      section.items.map((item) => ({
        serverId: group.serverId,
        item,
        optionId: optionId(group.serverId, group.workspaceId, item),
      })),
    ),
  );
}

export function Search() {
  const t = useT();
  const [servers, setServers] = useState<ServerView[] | null>(null);
  const [query, setQuery] = useState("");
  const [recent, setRecent] = useState<SearchOutcome | null>(null);
  const [results, setResults] = useState<SearchOutcome | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<"failed" | "openFailed" | null>(null);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  // Only the newest request may show its answer.
  const sequence = useRef(0);

  const loadRecent = useCallback(() => {
    api
      .listServers()
      .then((list) => {
        const signedIn = list.filter((server) => server.signedIn);
        setServers(signedIn);
        if (signedIn.length === 0) return;
        return searchApi.recent().then(setRecent);
      })
      .catch(() => setRecent({ groups: [], unavailable: [] }));
  }, []);

  useEffect(() => {
    loadRecent();
    input.current?.focus();
    const unlisten = onShown("search-shown", () => {
      input.current?.focus();
      input.current?.select();
      loadRecent();
    });
    return () => {
      void unlisten.then((stop) => stop());
    };
  }, [loadRecent]);

  useEffect(() => {
    const trimmed = query.trim();
    setActive(0);
    setError(null);
    const id = ++sequence.current;
    if (!trimmed) {
      setResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = window.setTimeout(() => {
      searchApi
        .query(trimmed)
        .then((outcome) => {
          if (id !== sequence.current) return;
          setResults(outcome);
        })
        .catch(() => {
          if (id !== sequence.current) return;
          setResults(null);
          setError("failed");
        })
        .finally(() => {
          if (id === sequence.current) setSearching(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  const showingRecent = !query.trim();
  const outcome = showingRecent ? recent : results;
  const entries = useMemo(() => flatten(outcome), [outcome]);
  const multipleServers = (servers?.length ?? 0) > 1;
  const activeEntry = entries[Math.min(active, entries.length - 1)];

  useEffect(() => {
    if (!activeEntry) return;
    document
      .getElementById(activeEntry.optionId)
      ?.scrollIntoView?.({ block: "nearest" });
  }, [activeEntry]);

  const open = (entry: Entry | undefined) => {
    if (!entry) return;
    setError(null);
    searchApi.open(entry.serverId, entry.item.path).catch(() => {
      setError("openFailed");
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      void searchApi.close();
    } else if (event.key === "ArrowDown" && entries.length > 0) {
      event.preventDefault();
      setActive((index) => (index + 1) % entries.length);
    } else if (event.key === "ArrowUp" && entries.length > 0) {
      event.preventDefault();
      setActive((index) => (index - 1 + entries.length) % entries.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      open(activeEntry);
    }
  };

  // Esc anywhere in the window closes it, not only in the field.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && event.target !== input.current)
        void searchApi.close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const signedOut = servers !== null && servers.length === 0;

  let status: string | null = null;
  if (signedOut) status = t("search.noServers");
  else if (error === "failed") status = t("search.failed");
  else if (showingRecent && recent === null) status = t("search.loading");
  else if (!showingRecent && searching && results === null)
    status = t("search.searching");
  else if (entries.length === 0)
    status = showingRecent
      ? t("search.noRecent")
      : searching
        ? t("search.searching")
        : t("search.noResults", { query: query.trim() });

  return (
    <main className="search">
      <h1 className="sr-only">{t("search.title")}</h1>
      <div className="search-field">
        <svg
          className="search-glyph"
          width="18"
          height="18"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M7 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM10.7 10.7 14 14" />
        </svg>
        <input
          ref={input}
          type="text"
          role="combobox"
          aria-label={t("search.label")}
          aria-expanded={entries.length > 0}
          aria-controls="search-results"
          aria-autocomplete="list"
          aria-activedescendant={activeEntry?.optionId}
          placeholder={t("search.placeholder")}
          disabled={signedOut}
          value={query}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
        />
        {searching ? (
          <span className="search-spinner" aria-hidden="true" />
        ) : null}
      </div>
      <div className="search-body">
        {showingRecent && entries.length > 0 ? (
          <p className="search-caption">{t("search.recent")}</p>
        ) : null}
        <div
          id="search-results"
          role="listbox"
          aria-label={showingRecent ? t("search.recent") : t("search.results")}
          className="search-results"
        >
          {outcome?.groups.map((group) => (
            // biome-ignore lint/a11y/useSemanticElements: an ARIA group inside a listbox; a fieldset is for form controls.
            <div
              key={`${group.serverId}/${group.workspaceId}`}
              role="group"
              aria-label={
                multipleServers
                  ? t("search.group", {
                      workspace: group.workspaceName,
                      server: group.serverLabel,
                    })
                  : group.workspaceName
              }
              className="search-group"
            >
              <p className="search-group-title" aria-hidden="true">
                {multipleServers
                  ? t("search.group", {
                      workspace: group.workspaceName,
                      server: group.serverLabel,
                    })
                  : group.workspaceName}
              </p>
              {group.sections.map((section) => (
                // biome-ignore lint/a11y/useSemanticElements: an ARIA group inside a listbox; a fieldset is for form controls.
                <div
                  key={section.kind}
                  role="group"
                  aria-label={kindLabel(t, section.kind)}
                >
                  <p className="search-kind" aria-hidden="true">
                    {kindLabel(t, section.kind)}
                  </p>
                  {section.items.map((item) => {
                    const id = optionId(
                      group.serverId,
                      group.workspaceId,
                      item,
                    );
                    const index = entries.findIndex(
                      (entry) => entry.optionId === id,
                    );
                    const selected = activeEntry?.optionId === id;
                    return (
                      // biome-ignore lint/a11y/useKeyWithClickEvents: the combobox field handles the keys (aria-activedescendant).
                      <div
                        key={id}
                        id={id}
                        role="option"
                        aria-selected={selected}
                        tabIndex={-1}
                        className={
                          selected ? "search-item active" : "search-item"
                        }
                        onMouseMove={() => {
                          if (!selected && index >= 0) setActive(index);
                        }}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() =>
                          open({ serverId: group.serverId, item, optionId: id })
                        }
                      >
                        <ItemIcon kind={item.kind} />
                        <span className="search-item-text">
                          <span className="search-item-title">
                            {item.key ? (
                              <span className="search-key">{item.key}</span>
                            ) : null}
                            {item.title}
                          </span>
                          {item.context ? (
                            <span className="search-item-context">
                              {item.context}
                            </span>
                          ) : null}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          ))}
        </div>
        {status ? (
          <p className="search-status" role="status">
            {status}
          </p>
        ) : null}
        {error === "openFailed" ? (
          <p className="message error search-message" role="alert">
            {t("search.openFailed")}
          </p>
        ) : null}
        {outcome && outcome.unavailable.length > 0 ? (
          <p className="message warning search-message" role="status">
            {t("search.unavailable", {
              servers: outcome.unavailable.join(", "),
            })}
          </p>
        ) : null}
      </div>
      <footer className="search-hint" aria-hidden="true">
        {t("search.hint")}
      </footer>
    </main>
  );
}
