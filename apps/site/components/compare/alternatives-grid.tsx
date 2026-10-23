"use client";

import { ArrowRight } from "lucide-react";
import { useState } from "react";
import type { ComparisonCategory } from "@/lib/comparisons";
import { cn } from "@/lib/utils";

export type AlternativeCard = {
  slug: string;
  href: string;
  competitor: string;
  summary: string;
  hostingTag?: string;
  categories: ComparisonCategory[];
  categoryLabels: string[];
};

type Filter = ComparisonCategory | "all";

/**
 * The comparison index with category filters. Every card is in the server
 * HTML; filtering only hides cards, so crawlers and no-JS visitors see all.
 */
export function AlternativesGrid({
  cards,
  categories,
}: {
  cards: AlternativeCard[];
  categories: { id: ComparisonCategory; label: string }[];
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const visible = cards.filter(
    (card) => filter === "all" || card.categories.includes(filter),
  );
  const options: { id: Filter; label: string; count: number }[] = [
    { id: "all", label: "All", count: cards.length },
    ...categories.map((category) => ({
      ...category,
      count: cards.filter((card) => card.categories.includes(category.id))
        .length,
    })),
  ];

  return (
    <div>
      <fieldset>
        <legend className="sr-only">Filter comparisons by category</legend>
        <div className="flex flex-wrap gap-2">
          {options.map((option) => {
            const active = filter === option.id;
            return (
              <button
                key={option.id}
                type="button"
                aria-pressed={active}
                onClick={() => setFilter(option.id)}
                className={cn(
                  "inline-flex min-h-10 items-center gap-2 rounded-full border px-4 font-medium text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  active
                    ? "border-foreground/25 bg-muted text-foreground"
                    : "border-border text-muted-foreground hover:border-foreground/25 hover:text-foreground",
                )}
              >
                {option.label}
                <span
                  className={cn(
                    "tabular-nums text-xs",
                    active
                      ? "text-muted-foreground"
                      : "text-muted-foreground/80",
                  )}
                >
                  {option.count}
                </span>
              </button>
            );
          })}
        </div>
      </fieldset>

      <p aria-live="polite" className="sr-only">
        {visible.length} comparisons shown
      </p>

      <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => {
          const shown = visible.includes(card);
          return (
            <li key={card.slug} hidden={!shown}>
              <a
                href={card.href}
                className="group flex h-full flex-col rounded-xl border border-border bg-card p-5 outline-none transition-colors hover:border-foreground/25 focus-visible:ring-2 focus-visible:ring-ring md:p-6"
              >
                <span className="flex items-start justify-between gap-3">
                  <span
                    aria-hidden="true"
                    className="flex size-10 items-center justify-center rounded-lg border border-border bg-muted font-medium text-sm"
                  >
                    {card.competitor.slice(0, 1).toUpperCase()}
                  </span>
                  <ArrowRight
                    aria-hidden="true"
                    className="mt-1 size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground motion-reduce:transition-none"
                  />
                </span>
                <span className="mt-5 font-medium text-lg leading-snug">
                  Margaya vs {card.competitor}
                </span>
                <span className="mt-2 text-muted-foreground text-sm leading-relaxed">
                  {card.summary}
                </span>
                <span className="mt-auto flex flex-wrap gap-1.5 pt-5">
                  {card.categoryLabels.map((label) => (
                    <span
                      key={label}
                      className="rounded-md bg-muted px-2 py-0.5 text-muted-foreground text-xs"
                    >
                      {label}
                    </span>
                  ))}
                  {card.hostingTag ? (
                    <span className="rounded-md border border-border px-2 py-0.5 text-muted-foreground text-xs">
                      {card.hostingTag}
                    </span>
                  ) : null}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
