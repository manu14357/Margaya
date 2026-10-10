"use client";

import { Search } from "lucide-react";
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type { DocsSearchEntry } from "@/lib/docs/search";

const MAX_RESULTS = 12;

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

function rank(entries: DocsSearchEntry[], query: string): DocsSearchEntry[] {
  const phrase = query.trim().toLowerCase();
  const terms = phrase.split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  const scored: { entry: DocsSearchEntry; score: number }[] = [];
  for (const entry of entries) {
    const title = entry.title.toLowerCase();
    const headings = entry.headings.join(" ").toLowerCase();
    const description = entry.description.toLowerCase();
    const extra =
      `${entry.section} ${entry.method ?? ""} ${entry.path ?? ""}`.toLowerCase();
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
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RESULTS)
    .map((item) => item.entry);
}

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

export function DocsSearch() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [query, setQuery] = useState("");
  const [entries, setEntries] = useState<DocsSearchEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(0);

  const results = useMemo(
    () => (entries ? rank(entries, query) : []),
    [entries, query],
  );

  const ensureIndex = useCallback(() => {
    setFailed(false);
    loadIndex().then(setEntries, () => setFailed(true));
  }, []);

  const open = useCallback(() => {
    ensureIndex();
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    setActive(0);
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [ensureIndex]);

  const close = useCallback(() => dialogRef.current?.close(), []);

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

  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => Math.min(index + 1, results.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      const target = results[active];
      if (target) {
        event.preventDefault();
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
      : query.trim() && results.length === 0
        ? `No pages match "${query.trim()}".`
        : "";

  return (
    <>
      <button
        type="button"
        onClick={open}
        aria-haspopup="dialog"
        className="flex h-9 w-full items-center gap-2 rounded-md border bg-background px-3 text-muted-foreground text-sm transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 sm:w-64"
      >
        <Search aria-hidden="true" className="size-4 shrink-0" />
        <span className="flex-1 text-left">Search docs</span>
        <kbd className="rounded border bg-muted px-1.5 font-mono text-[0.6875rem] text-foreground max-sm:hidden">
          Ctrl K
        </kbd>
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
          <div className="flex items-center gap-2 border-b px-4">
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
              aria-expanded={results.length > 0}
              aria-controls={listId}
              aria-activedescendant={
                results.length > 0 ? `${listId}-${active}` : undefined
              }
              autoComplete="off"
              spellCheck={false}
              placeholder="Search guides and API reference"
              className="h-12 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
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
              className="rounded border px-1.5 font-mono text-[0.6875rem] text-muted-foreground hover:text-foreground"
            >
              Esc
            </button>
          </div>
          <div
            id={listId}
            role="listbox"
            aria-label="Results"
            className="max-h-[min(28rem,60vh)] overflow-y-auto p-2"
          >
            {results.map((entry, index) => (
              <a
                key={entry.href}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === active}
                href={entry.href}
                onMouseMove={() => setActive(index)}
                className="docs-search-result"
              >
                <span className="flex items-center gap-2 font-medium text-foreground text-sm">
                  {entry.method ? (
                    <span
                      className={`docs-method docs-method-small docs-method-${entry.method.toLowerCase()}`}
                    >
                      {entry.method}
                    </span>
                  ) : null}
                  {entry.title}
                </span>
                <span className="block text-muted-foreground text-xs">
                  {entry.section}
                </span>
                {entry.description ? (
                  <span className="mt-0.5 line-clamp-1 block text-muted-foreground text-xs">
                    {entry.description}
                  </span>
                ) : null}
              </a>
            ))}
          </div>
          <p
            aria-live="polite"
            className="px-4 pb-3 text-muted-foreground text-sm empty:hidden"
          >
            {status}
          </p>
        </div>
      </dialog>
    </>
  );
}
