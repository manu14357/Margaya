"use client";

import { Clock, CornerDownLeft, FileText, Hash, Search, X } from "lucide-react";
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { DocsSearchEntry } from "@/lib/docs/search";

const MAX_PAGES = 8;
const MAX_SECTIONS_PER_PAGE = 3;
const MAX_RECENT = 5;
const RECENT_KEY = "margaya-docs-recent-searches";

const QUICK_LINKS = [
  { title: "Install", href: "/docs/core/installation" },
  { title: "API introduction", href: "/docs/api-reference/introduction" },
  {
    title: "Keyboard shortcuts",
    href: "/docs/core/functional/keyboard-shortcuts",
  },
];

type Row = {
  kind: "page" | "section";
  href: string;
  title: string;
  /** The page title for a section row; `Tab › Group` for a page row. */
  context: string;
  /** Null for suggestions, which are not from the index. */
  entry: DocsSearchEntry | null;
};

type Recent = { title: string; href: string };

let indexRequest: Promise<DocsSearchEntry[]> | null = null;

/** Fetches the prebuilt index once per page view; failures can be retried. */
function loadIndex(): Promise<DocsSearchEntry[]> {
  indexRequest ??= fetch("/docs/search-index.json")
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json() as Promise<DocsSearchEntry[]>;
    })
    .catch((error: unknown) => {
      indexRequest = null;
      throw error;
    });
  return indexRequest;
}

function searchTerms(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * Ranks pages (title hits first, then headings, description and keywords)
 * and lists, under each page, the headings that contain every term.
 */
export function rankDocs(entries: DocsSearchEntry[], query: string): Row[] {
  const terms = searchTerms(query);
  if (terms.length === 0) return [];
  const phrase = terms.join(" ");
  const scored: { entry: DocsSearchEntry; score: number }[] = [];
  for (const entry of entries) {
    const title = entry.title.toLowerCase();
    const headings = entry.sections
      .map((section) => section.text)
      .join(" ")
      .toLowerCase();
    const description = entry.description.toLowerCase();
    const extra =
      `${entry.section} ${entry.method ?? ""} ${entry.path ?? ""} ${entry.keywords}`.toLowerCase();
    let score = 0;
    let matchesAll = true;
    for (const term of terms) {
      let termScore = 0;
      if (title.includes(term)) termScore += title.startsWith(term) ? 12 : 8;
      if (headings.includes(term)) termScore += 4;
      if (description.includes(term)) termScore += 3;
      if (extra.includes(term)) termScore += 2;
      if (termScore === 0) {
        matchesAll = false;
        break;
      }
      score += termScore;
    }
    if (!matchesAll) continue;
    if (title.includes(phrase)) score += 10;
    else if (description.includes(phrase) || headings.includes(phrase))
      score += 5;
    // Guides before endpoint pages when they match equally well.
    if (!entry.method) score += 1;
    scored.push({ entry, score });
  }

  const rows: Row[] = [];
  for (const { entry } of scored
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_PAGES)) {
    rows.push({
      kind: "page",
      href: entry.href,
      title: entry.title,
      context: entry.section,
      entry,
    });
    const sections = entry.sections
      .filter((section) => {
        const text = section.text.toLowerCase();
        return terms.every((term) => text.includes(term));
      })
      .slice(0, MAX_SECTIONS_PER_PAGE);
    for (const section of sections) {
      rows.push({
        kind: "section",
        href: `${entry.href}#${section.id}`,
        title: section.text,
        context: entry.title,
        entry,
      });
    }
  }
  return rows;
}

/** The text with every term wrapped in `<mark>`. */
function Highlight({ text, terms }: { text: string; terms: string[] }) {
  if (terms.length === 0) return <>{text}</>;
  const pattern = new RegExp(
    `(${terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
    "gi",
  );
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const at = match.index ?? 0;
    if (at > last) parts.push(text.slice(last, at));
    parts.push(
      <mark key={at} className="docs-search-mark">
        {match[0]}
      </mark>,
    );
    last = at + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

function readRecent(): Recent[] {
  try {
    const value = JSON.parse(
      window.localStorage.getItem(RECENT_KEY) ?? "[]",
    ) as unknown;
    return Array.isArray(value)
      ? value
          .filter(
            (item): item is Recent =>
              typeof item?.title === "string" &&
              typeof item?.href === "string" &&
              item.href.startsWith("/docs"),
          )
          .slice(0, MAX_RECENT)
      : [];
  } catch {
    return [];
  }
}

function rememberRecent(item: Recent) {
  try {
    const next = [
      item,
      ...readRecent().filter((recent) => recent.href !== item.href),
    ].slice(0, MAX_RECENT);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable: recent searches are a convenience only.
  }
}

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

const noSubscribe = () => () => {};

/** "⌘" on Apple platforms, "Ctrl" elsewhere (and while rendering on the server). */
function useModifierLabel(): string {
  return useSyncExternalStore(
    noSubscribe,
    () =>
      /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent)
        ? "⌘"
        : "Ctrl",
    () => "Ctrl",
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="docs-kbd">{children}</kbd>;
}

export function DocsSearch() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const modifier = useModifierLabel();
  const [query, setQuery] = useState("");
  const [entries, setEntries] = useState<DocsSearchEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<Recent[]>([]);

  const terms = useMemo(() => searchTerms(query), [query]);
  const rows = useMemo(
    () => (entries ? rankDocs(entries, query) : []),
    [entries, query],
  );
  const suggestions: Row[] = useMemo(() => {
    if (terms.length > 0) return [];
    const seen = new Set<string>();
    return [...recent, ...QUICK_LINKS]
      .filter((item) => !seen.has(item.href) && seen.add(item.href))
      .map((item) => ({
        kind: "page" as const,
        href: item.href,
        title: item.title,
        context: "",
        entry: null,
      }));
  }, [recent, terms.length]);
  const visible = terms.length > 0 ? rows : suggestions;

  const ensureIndex = useCallback(() => {
    setFailed(false);
    loadIndex().then(setEntries, () => setFailed(true));
  }, []);

  const open = useCallback(() => {
    ensureIndex();
    setRecent(readRecent());
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    setActive(0);
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [ensureIndex]);

  const close = useCallback(() => dialogRef.current?.close(), []);

  const choose = useCallback(
    (row: Row) => {
      if (terms.length > 0)
        rememberRecent({ title: row.title, href: row.href });
      close();
    },
    [close, terms.length],
  );

  // Warm the index once the page is idle so the first search is instant.
  useEffect(() => {
    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(ensureIndex, { timeout: 4000 });
      return () => window.cancelIdleCallback(handle);
    }
    const handle = window.setTimeout(ensureIndex, 2000);
    return () => window.clearTimeout(handle);
  }, [ensureIndex]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const shortcut =
        (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) ||
        (event.key === "/" && !isTypingTarget(event.target));
      if (shortcut) {
        event.preventDefault();
        open();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    document
      .getElementById(`${listId}-${active}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active, listId]);

  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => Math.min(index + 1, visible.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      const target = visible[active];
      if (target) {
        event.preventDefault();
        choose(target);
        window.location.assign(target.href);
      }
    }
  };

  const status = failed
    ? "Search is unavailable right now. Try again in a moment."
    : entries === null
      ? query
        ? "Loading the search index…"
        : ""
      : terms.length > 0 && rows.length === 0
        ? `No pages match "${query.trim()}".`
        : "";

  return (
    <>
      <button
        type="button"
        onClick={open}
        aria-haspopup="dialog"
        className="docs-search-trigger max-md:hidden"
      >
        <Search aria-hidden="true" className="size-4 shrink-0" />
        <span className="flex-1 text-left">Search</span>
        <span className="docs-kbd" aria-hidden="true">
          {modifier} K
        </span>
      </button>
      <button
        type="button"
        onClick={open}
        aria-haspopup="dialog"
        aria-label="Search documentation"
        className="docs-icon-button md:hidden"
      >
        <Search aria-hidden="true" className="size-4" />
      </button>
      <dialog
        ref={dialogRef}
        aria-label="Search documentation"
        className="docs-search-dialog"
        onClose={() => setActive(0)}
        onClick={(event) => {
          // A click on the dialog itself, not its panel, is a backdrop click.
          if (event.target === event.currentTarget) close();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") close();
        }}
      >
        <div className="docs-search-panel">
          <div className="docs-search-input-row">
            <Search
              aria-hidden="true"
              className="size-4 shrink-0 text-muted-foreground"
            />
            <input
              ref={inputRef}
              type="text"
              role="combobox"
              aria-label="Search documentation"
              aria-autocomplete="list"
              aria-expanded={visible.length > 0}
              aria-controls={listId}
              aria-activedescendant={
                visible.length > 0 ? `${listId}-${active}` : undefined
              }
              autoComplete="off"
              spellCheck={false}
              placeholder="Search guides and API reference"
              className="h-full min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
              onKeyDown={onInputKeyDown}
            />
            <button
              type="button"
              onClick={close}
              aria-label="Close search"
              className="docs-icon-button sm:hidden"
            >
              <X aria-hidden="true" className="size-4" />
            </button>
            <button
              type="button"
              onClick={close}
              className="docs-kbd max-sm:hidden"
            >
              Esc
            </button>
          </div>
          <div
            id={listId}
            role="listbox"
            aria-label={terms.length > 0 ? "Results" : "Suggestions"}
            className="docs-search-results"
          >
            {terms.length === 0 && visible.length > 0 ? (
              <p className="docs-search-group-label" aria-hidden="true">
                {recent.length > 0 ? "Recent and suggested" : "Suggested"}
              </p>
            ) : null}
            {visible.map((row, index) => {
              const selected = index === active;
              const isRecent =
                terms.length === 0 &&
                recent.some((item) => item.href === row.href);
              return (
                <a
                  key={`${row.kind}-${row.href}`}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={selected}
                  href={row.href}
                  onMouseMove={() => setActive(index)}
                  onClick={() => choose(row)}
                  className={`docs-search-row docs-search-row-${row.kind}`}
                >
                  <span className="docs-search-row-icon" aria-hidden="true">
                    {row.kind === "section" ? (
                      <Hash className="size-4" />
                    ) : isRecent ? (
                      <Clock className="size-4" />
                    ) : row.entry?.method ? (
                      <span
                        className={`docs-method docs-method-small docs-method-${row.entry.method.toLowerCase()}`}
                      >
                        {row.entry.method}
                      </span>
                    ) : (
                      <FileText className="size-4" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-foreground text-sm">
                      <Highlight text={row.title} terms={terms} />
                    </span>
                    {row.context ? (
                      <span className="block truncate text-muted-foreground text-xs">
                        {row.context}
                      </span>
                    ) : null}
                  </span>
                  {selected ? (
                    <CornerDownLeft
                      aria-hidden="true"
                      className="size-4 shrink-0 text-muted-foreground"
                    />
                  ) : null}
                </a>
              );
            })}
            <p
              aria-live="polite"
              className="px-3 py-6 text-center text-muted-foreground text-sm empty:hidden"
            >
              {status}
            </p>
          </div>
          <div className="docs-search-footer" aria-hidden="true">
            <span>
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd> Navigate
            </span>
            <span>
              <Kbd>↵</Kbd> Open
            </span>
            <span>
              <Kbd>Esc</Kbd> Close
            </span>
          </div>
        </div>
      </dialog>
    </>
  );
}
