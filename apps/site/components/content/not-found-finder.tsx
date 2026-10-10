"use client";

import { CornerDownLeft, Search } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { cn } from "@/lib/utils";

export type FinderLink = {
  label: string;
  hint: string;
  href: string;
  group: string;
  /** Extra words people might type for this page. */
  keywords?: string;
};

function matches(link: FinderLink, query: string) {
  const haystack =
    `${link.label} ${link.hint} ${link.group} ${link.keywords ?? ""}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

/**
 * A small, command-bar-style list of places to go from the 404 page. Typing
 * filters it, the arrow keys move the highlight and Enter opens that page.
 * The results stay ordinary links, so Tab works and so does no JavaScript.
 */
export function NotFoundFinder({ links }: { links: FinderLink[] }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();
  const statusId = useId();

  const results = useMemo(
    () => (query.trim() ? links.filter((link) => matches(link, query)) : links),
    [links, query],
  );
  const current = Math.min(active, Math.max(results.length - 1, 0));

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((current + 1) % Math.max(results.length, 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current - 1 + results.length) % Math.max(results.length, 1));
    } else if (event.key === "Enter" && results[current]) {
      event.preventDefault();
      window.location.assign(results[current].href);
    }
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-[0_1px_2px_rgb(0_0_0/0.04),0_16px_40px_-20px_rgb(0_0_0/0.25)]">
      <div className="flex items-center gap-3 border-border/70 border-b px-4">
        <Search
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground"
        />
        <input
          aria-controls={listId}
          aria-describedby={statusId}
          aria-label="Filter pages"
          autoComplete="off"
          className="h-14 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          placeholder="Where were you heading?"
          spellCheck={false}
          type="search"
          value={query}
        />
        <kbd className="hidden rounded-md border border-border/80 bg-muted px-1.5 py-0.5 font-mono text-[0.6875rem] text-muted-foreground sm:inline-block">
          Enter
        </kbd>
      </div>

      <p aria-live="polite" className="sr-only" id={statusId}>
        {results.length === 1
          ? "1 page matches. Press Enter to open it."
          : `${results.length} pages match. Press Enter to open the highlighted one.`}
      </p>

      {results.length > 0 ? (
        <ul className="max-h-[22rem] overflow-y-auto p-2" id={listId}>
          {results.map((link, index) => (
            <li key={link.href}>
              <a
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                  index === current ? "bg-accent" : "hover:bg-accent/60",
                )}
                href={link.href}
                onMouseEnter={() => setActive(index)}
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{link.label}</span>
                  <span className="block truncate text-muted-foreground text-xs">
                    {link.hint}
                  </span>
                </span>
                <span className="hidden shrink-0 text-muted-foreground text-xs sm:inline">
                  {link.group}
                </span>
                <CornerDownLeft
                  aria-hidden="true"
                  className={cn(
                    "size-3.5 shrink-0 text-muted-foreground",
                    index === current ? "opacity-100" : "opacity-0",
                  )}
                />
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <div className="px-5 py-8 text-center text-sm">
          <p className="font-medium">Nothing here matches “{query}”.</p>
          <p className="mt-1 text-muted-foreground">
            Try a shorter word, or{" "}
            <a
              className="text-foreground underline decoration-border underline-offset-4 hover:decoration-current"
              href="/docs/core"
            >
              search the documentation
            </a>
            .
          </p>
        </div>
      )}
    </div>
  );
}
