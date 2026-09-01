"use client";

import { HandGrab } from "lucide-react";
import type { Ref } from "react";
import { cn } from "../lib/cn";

/*
 * The cursors are moved by the runner writing `transform` and the
 * `data-kind` / `data-pressed` / `data-visible` attributes straight to the
 * DOM, so a moving cursor never re-renders React.
 */

function PointerGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={cn("absolute -top-[3px] -left-[5px] size-6", className)}
    >
      <path
        d="M5.2 3.4c-.5-.3-1 .1-1 .6v15.3c0 .6.7.9 1.1.5l3.9-3.4 2.6 5.4c.2.4.7.6 1.1.4l1.9-.9c.4-.2.6-.7.4-1.1l-2.6-5.3 5.1-.4c.6 0 .8-.7.4-1.1Z"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TextGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="absolute -top-3 -left-3 hidden size-6 group-data-[kind=text]/cursor:block"
    >
      <path
        d="M9 4.5c1.5 0 2.4.5 3 1.3.6-.8 1.5-1.3 3-1.3M12 5.8v12.4M9 19.5c1.5 0 2.4-.5 3-1.3.6.8 1.5 1.3 3 1.3M10.2 12h3.6"
        fill="none"
        className="stroke-background"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <path
        d="M9 4.5c1.5 0 2.4.5 3 1.3.6-.8 1.5-1.3 3-1.3M12 5.8v12.4M9 19.5c1.5 0 2.4-.5 3-1.3.6.8 1.5 1.3 3 1.3M10.2 12h3.6"
        fill="none"
        className="stroke-foreground"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

const cursorShell =
  "group/cursor pointer-events-none absolute top-0 left-0 z-50 opacity-0 transition-opacity duration-200 will-change-transform data-[visible=true]:opacity-100";

/** The visitor's cursor: pointer, grab and text glyphs. */
export function DemoCursor({ ref }: { ref?: Ref<HTMLDivElement> }) {
  return (
    <div
      ref={ref}
      aria-hidden
      data-kind="pointer"
      data-visible="false"
      className={cursorShell}
    >
      <div className="relative transition-transform duration-100 ease-out group-data-[pressed=true]/cursor:scale-[0.86]">
        <PointerGlyph className="hidden fill-foreground stroke-background drop-shadow-sm group-data-[kind=pointer]/cursor:block" />
        <HandGrab
          aria-hidden
          strokeWidth={1.75}
          className="absolute -top-3 -left-3 hidden size-6 fill-background stroke-foreground drop-shadow-sm group-data-[kind=grab]/cursor:block"
        />
        <TextGlyph />
      </div>
    </div>
  );
}

/** A teammate's cursor with a name tag, for co-editing scenes. */
export function CollaboratorCursor({
  ref,
  name,
}: {
  ref?: Ref<HTMLDivElement>;
  name: string;
}) {
  return (
    <div
      ref={ref}
      aria-hidden
      data-kind="pointer"
      data-visible="false"
      className={cursorShell}
    >
      <div className="relative transition-transform duration-100 ease-out group-data-[pressed=true]/cursor:scale-[0.86]">
        <PointerGlyph className="fill-info stroke-background drop-shadow-sm" />
        <span className="absolute top-4 left-3 whitespace-nowrap rounded-md rounded-tl-sm bg-info px-1.5 py-0.5 font-medium text-[11px] text-white leading-4 shadow-sm">
          {name}
        </span>
      </div>
    </div>
  );
}
