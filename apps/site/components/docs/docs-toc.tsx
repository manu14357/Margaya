"use client";

import { ArrowUp, TextAlignStart } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

export type TocHeading = { id: string; text: string; depth: number };

// A heading counts as current once it passes this line under the sticky header.
const ACTIVE_LINE = 96;

/** The id of the last heading whose top has passed the active line. */
function currentHeading(headings: TocHeading[]): string | null {
  const atBottom =
    window.innerHeight + window.scrollY >=
    document.documentElement.scrollHeight - 2;
  if (atBottom) return headings[headings.length - 1]?.id ?? null;
  let current: string | null = headings[0]?.id ?? null;
  for (const heading of headings) {
    const element = document.getElementById(heading.id);
    if (!element) continue;
    if (element.getBoundingClientRect().top <= ACTIVE_LINE)
      current = heading.id;
    else break;
  }
  return current;
}

/** Tracks which section is in view while the page scrolls. */
export function useActiveHeading(headings: TocHeading[]): string | null {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    if (headings.length === 0) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setActive(currentHeading(headings)));
    };
    // The observer wakes the update when headings cross the top band; the
    // scroll listener covers the end of the page, where the last short
    // sections never reach the band.
    const observer = new IntersectionObserver(update, {
      rootMargin: `-${ACTIVE_LINE - 32}px 0px -70% 0px`,
    });
    for (const heading of headings) {
      const element = document.getElementById(heading.id);
      if (element) observer.observe(element);
    }
    window.addEventListener("scroll", update, { passive: true });
    update();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("scroll", update);
    };
  }, [headings]);

  return active;
}

/** "On this page": the outline with scroll-spy and a sliding marker. */
export function DocsToc({ headings }: { headings: TocHeading[] }) {
  const active = useActiveHeading(headings);
  const listRef = useRef<HTMLUListElement>(null);
  const [marker, setMarker] = useState<{ top: number; height: number } | null>(
    null,
  );

  useLayoutEffect(() => {
    const link = [
      ...(listRef.current?.querySelectorAll<HTMLElement>("[data-toc-id]") ??
        []),
    ].find((element) => element.dataset.tocId === active);
    setMarker(link ? { top: link.offsetTop, height: link.offsetHeight } : null);
  }, [active]);

  return (
    <nav aria-labelledby="docs-toc-label" className="docs-toc-nav">
      <p id="docs-toc-label" className="docs-toc-label">
        <TextAlignStart aria-hidden="true" className="size-3.5" />
        On this page
      </p>
      <div className="docs-toc-rail">
        {marker ? (
          <span
            aria-hidden="true"
            className="docs-toc-marker"
            style={{
              transform: `translateY(${marker.top}px)`,
              height: marker.height,
            }}
          />
        ) : null}
        <ul ref={listRef} className="docs-toc-list">
          {headings.map((heading) => (
            <li key={heading.id}>
              <a
                href={`#${heading.id}`}
                data-toc-id={heading.id}
                aria-current={heading.id === active ? "location" : undefined}
                className={`docs-toc-link${heading.depth === 3 ? " docs-toc-link-nested" : ""}`}
              >
                {heading.text}
              </a>
            </li>
          ))}
        </ul>
      </div>
      <a href="#docs-main" className="docs-toc-top">
        Back to top
        <ArrowUp aria-hidden="true" className="size-3.5" />
      </a>
    </nav>
  );
}
