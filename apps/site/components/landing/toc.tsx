"use client";

import { ArrowUp, ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export type TocEntry = {
  id: string;
  text: string;
  depth: number;
};

function useActiveHeading(entries: TocEntry[]) {
  const [activeId, setActiveId] = useState(entries[0]?.id ?? "");

  useEffect(() => {
    const elements = entries
      .map((entry) => document.getElementById(entry.id))
      .filter((element): element is HTMLElement => element !== null);
    let frame = 0;

    // The active heading is the last one that has scrolled past a line just
    // below the sticky navbar, so a jump straight to any point is right too.
    const update = () => {
      frame = 0;
      const line = 120;
      let current = elements[0]?.id ?? "";
      for (const element of elements) {
        if (element.getBoundingClientRect().top <= line) current = element.id;
        else break;
      }
      setActiveId(current);
    };

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [entries]);

  return activeId;
}

function TocList({
  entries,
  activeId,
}: {
  entries: TocEntry[];
  activeId?: string;
}) {
  return (
    <ol className="space-y-px">
      {entries.map((entry) => {
        const active = activeId === entry.id;
        return (
          <li key={entry.id}>
            <a
              aria-current={active ? "location" : undefined}
              className={cn(
                "block rounded-md py-1.5 pr-2 leading-snug transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                entry.depth === 3 ? "pl-6 text-[0.8125rem]" : "pl-3",
                active
                  ? "bg-accent font-medium text-foreground"
                  : "text-foreground/60 hover:text-foreground",
              )}
              href={`#${entry.id}`}
            >
              {entry.text}
            </a>
          </li>
        );
      })}
    </ol>
  );
}

/** The sticky outline beside the article on wide screens. */
export function Toc({
  entries,
  label = "On this page",
}: {
  entries: TocEntry[];
  label?: string;
}) {
  const activeId = useActiveHeading(entries);
  if (entries.length < 2) return null;

  return (
    <nav aria-label={label} className="text-sm">
      <p className="px-3 font-medium text-foreground/50 text-xs uppercase tracking-wider">
        {label}
      </p>
      <div className="mt-3 max-h-[calc(100vh-12rem)] overflow-y-auto pr-1">
        <TocList activeId={activeId} entries={entries} />
      </div>
      <a
        className="mt-4 inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-foreground/55 text-xs transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        href="#top"
      >
        <ArrowUp aria-hidden="true" className="size-3.5" />
        Back to top
      </a>
    </nav>
  );
}

/** The same outline, folded into a disclosure above the article on small screens. */
export function TocDisclosure({
  entries,
  label = "On this page",
}: {
  entries: TocEntry[];
  label?: string;
}) {
  if (entries.length < 2) return null;

  return (
    <details className="group rounded-xl border border-border/80 bg-card text-sm">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 font-medium [&::-webkit-details-marker]:hidden">
        {label}
        <ChevronDown
          aria-hidden="true"
          className="size-4 text-muted-foreground transition-transform group-open:rotate-180"
        />
      </summary>
      <nav aria-label={label} className="border-border/70 border-t px-1 py-2">
        <TocList entries={entries} />
      </nav>
    </details>
  );
}
