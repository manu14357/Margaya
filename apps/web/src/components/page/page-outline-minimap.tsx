import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import type { OutlineHeading } from "@/lib/pages/editor-document";
import { OutlineRows } from "./page-outline";

const BAR_WIDTH: Record<OutlineHeading["level"], string> = {
  1: "w-5",
  2: "w-4",
  3: "w-3",
};

type PageOutlineMinimapProps = {
  headings: OutlineHeading[];
  activePos: number | null;
  onOpenPanel: () => void;
  onJump: (heading: OutlineHeading) => void;
};

/**
 * Short heading bars pinned to the right of the canvas while the side pane
 * is closed. Hovering or focusing them shows the outline as a card; a click
 * on the bars opens the Outline pane. Hidden on narrow canvases (CSS) and
 * for documents with fewer than two headings.
 */
export default function PageOutlineMinimap({
  headings,
  activePos,
  onOpenPanel,
  onJump,
}: PageOutlineMinimapProps) {
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  if (headings.length < 2) return null;

  return (
    <div
      className="margaya-page-minimap pointer-events-none sticky top-0 z-10 h-0 print:hidden"
      data-slot="page-minimap"
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: Escape closes the hover card around the focused rows */}
      <div
        className="group/minimap pointer-events-auto absolute top-18 right-5 flex flex-col items-end"
        onMouseLeave={() => setDismissed(false)}
        onFocus={() => setFocusWithin(true)}
        onBlur={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node)) return;
          setFocusWithin(false);
          setDismissed(false);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.stopPropagation();
          setDismissed(true);
          buttonRef.current?.focus();
        }}
      >
        <button
          ref={buttonRef}
          type="button"
          aria-label={t("pages:detail.openOutline")}
          onClick={onOpenPanel}
          className="flex max-h-[50vh] flex-col items-end gap-2 overflow-hidden rounded-sm p-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {headings.map((heading) => (
            <span
              key={heading.pos}
              aria-hidden="true"
              data-level={heading.level}
              data-active={heading.pos === activePos || undefined}
              className={cn(
                "block h-0.5 shrink-0 rounded-[1px]",
                BAR_WIDTH[heading.level],
                heading.pos === activePos
                  ? "bg-foreground"
                  : "bg-foreground/20",
              )}
            />
          ))}
        </button>
        <div
          className={cn(
            "margaya-page-minimap-card invisible absolute top-0 right-0 max-h-[70vh] w-52 translate-x-2 overflow-y-auto rounded-lg border bg-popover p-3 opacity-0 shadow-lg/5 transition-[opacity,translate,visibility] duration-200 ease-out",
            !dismissed &&
              "group-hover/minimap:visible group-hover/minimap:translate-x-0 group-hover/minimap:opacity-100",
            !dismissed && focusWithin && "visible translate-x-0 opacity-100",
          )}
          data-slot="page-minimap-card"
        >
          <nav aria-label={t("pages:panel.outline")}>
            <OutlineRows
              headings={headings}
              activePos={activePos}
              onJump={onJump}
            />
          </nav>
        </div>
      </div>
    </div>
  );
}
