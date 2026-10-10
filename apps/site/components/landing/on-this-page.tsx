"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * A sticky "On this page" list that marks the section being read. Below
 * `lg` it is a plain list at the top of the page.
 */
export function OnThisPage({
  title,
  items,
  className,
}: {
  title: string;
  items: { id: string; label: string }[];
  className?: string;
}) {
  const [active, setActive] = useState(items[0]?.id);

  useEffect(() => {
    const sections = items
      .map((item) => document.getElementById(item.id))
      .filter((section): section is HTMLElement => section !== null);
    if (sections.length === 0) return;

    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        const first = items.find((item) => visible.has(item.id));
        if (first) setActive(first.id);
      },
      // A band across the upper part of the viewport, below the navbar.
      { rootMargin: "-80px 0px -55% 0px" },
    );
    for (const section of sections) observer.observe(section);
    return () => observer.disconnect();
  }, [items]);

  return (
    <nav
      aria-label={title}
      className={cn("lg:sticky lg:top-24 lg:self-start", className)}
    >
      <p className="font-medium text-muted-foreground text-xs uppercase tracking-[0.08em]">
        {title}
      </p>
      <ol className="mt-3 flex flex-col border-border border-l">
        {items.map((item) => {
          const current = item.id === active;
          return (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                aria-current={current ? "location" : undefined}
                className={cn(
                  "-ml-px block border-l py-1.5 pl-3 text-sm leading-snug outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                  current
                    ? "border-foreground font-medium text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {item.label}
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
