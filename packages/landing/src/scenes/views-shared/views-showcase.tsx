"use client";

import type { LucideIcon } from "lucide-react";
import {
  CalendarRange,
  ChartGantt,
  Rows3,
  Sheet,
  SquareKanban,
} from "lucide-react";
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLandingCopy } from "../../copy";
import { DemoStage, useReducedMotion } from "../../demo";
import { cn } from "../../lib/cn";
import { LazyMount } from "../../lib/lazy-mount";
import { createBoardViewScene } from "../view-board/view-board-scene";
import { createCalendarViewScene } from "../view-calendar/view-calendar-scene";
import { createGanttViewScene } from "../view-gantt/view-gantt-scene";
import { createListViewScene } from "../view-list/view-list-scene";
import { createSpreadsheetViewScene } from "../view-spreadsheet/view-spreadsheet-scene";
import { VIEW_STAGE_COMPACT, VIEW_STAGE_SIZE } from "./data";
import { withEndSignal } from "./end-signal";

export type ViewId = "board" | "list" | "spreadsheet" | "calendar" | "gantt";

export const VIEW_IDS: readonly ViewId[] = [
  "board",
  "list",
  "spreadsheet",
  "calendar",
  "gantt",
];

const ICONS: Record<ViewId, LucideIcon> = {
  board: SquareKanban,
  list: Rows3,
  spreadsheet: Sheet,
  calendar: CalendarRange,
  gantt: ChartGantt,
};

const SCENE_COPY = {
  board: "viewBoard",
  list: "viewList",
  spreadsheet: "viewSpreadsheet",
  calendar: "viewCalendar",
  gantt: "viewGantt",
} as const;

/**
 * Layout tabs over one demo stage. The tabs advance on their own when a
 * scene's script ends, until the visitor picks a tab (click or arrow keys);
 * from then on the chosen scene loops. Reduced motion shows each scene's
 * still frame and never advances.
 */
export function ViewsShowcase({
  views = VIEW_IDS,
  className,
}: {
  /** The tabs to show, in order. */
  views?: readonly ViewId[];
  className?: string;
}) {
  const copy = useLandingCopy();
  const baseId = useId();
  const reduced = useReducedMotion();
  const [active, setActive] = useState<ViewId>(views[0] ?? "board");
  const [auto, setAuto] = useState(true);
  const tabRefs = useRef(new Map<ViewId, HTMLButtonElement>());

  // The end signal fires from inside the stage; read the latest values.
  const latest = useRef({ auto, reduced, views, active });
  useEffect(() => {
    latest.current = { auto, reduced, views, active };
  });
  const advance = useCallback(() => {
    const current = latest.current;
    if (!current.auto || current.reduced) return;
    const index = current.views.indexOf(current.active);
    const next = current.views[(index + 1) % current.views.length];
    if (next) setActive(next);
  }, []);

  const scenes = useMemo(
    () => ({
      board: withEndSignal(createBoardViewScene(copy.demo), advance),
      list: withEndSignal(createListViewScene(copy.demo), advance),
      spreadsheet: withEndSignal(
        createSpreadsheetViewScene(copy.demo),
        advance,
      ),
      calendar: withEndSignal(createCalendarViewScene(copy.demo), advance),
      gantt: withEndSignal(createGanttViewScene(copy.demo), advance),
    }),
    [copy.demo, advance],
  );

  const choose = (id: ViewId, focus = false) => {
    setAuto(false);
    setActive(id);
    if (focus) tabRefs.current.get(id)?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = views.indexOf(active);
    const last = views.length - 1;
    const target =
      event.key === "ArrowRight"
        ? views[index === last ? 0 : index + 1]
        : event.key === "ArrowLeft"
          ? views[index === 0 ? last : index - 1]
          : event.key === "Home"
            ? views[0]
            : event.key === "End"
              ? views[last]
              : undefined;
    if (!target) return;
    event.preventDefault();
    choose(target, true);
  };

  const sceneCopy = copy.scenes[SCENE_COPY[active]];
  const stageProps = {
    caption: sceneCopy.caption,
    description: sceneCopy.description,
    size: VIEW_STAGE_SIZE,
    compactSize: VIEW_STAGE_COMPACT,
  };
  const stage =
    active === "board" ? (
      <DemoStage key="board" scene={scenes.board} {...stageProps} />
    ) : active === "list" ? (
      <DemoStage key="list" scene={scenes.list} {...stageProps} />
    ) : active === "spreadsheet" ? (
      <DemoStage key="spreadsheet" scene={scenes.spreadsheet} {...stageProps} />
    ) : active === "calendar" ? (
      <DemoStage key="calendar" scene={scenes.calendar} {...stageProps} />
    ) : (
      <DemoStage key="gantt" scene={scenes.gantt} {...stageProps} />
    );

  return (
    <div className={cn("w-full", className)}>
      <div className="flex justify-center">
        <div
          role="tablist"
          aria-label={copy.home.views.tabsLabel}
          className="flex max-w-full items-center gap-1 overflow-x-auto rounded-xl border border-border bg-muted/50 p-1 [scrollbar-width:none]"
        >
          {views.map((id) => {
            const Icon = ICONS[id];
            const selected = id === active;
            return (
              <button
                key={id}
                ref={(element) => {
                  if (element) tabRefs.current.set(id, element);
                  else tabRefs.current.delete(id);
                }}
                type="button"
                role="tab"
                id={`${baseId}-tab-${id}`}
                aria-selected={selected}
                aria-controls={`${baseId}-panel`}
                tabIndex={selected ? 0 : -1}
                onClick={() => choose(id)}
                onKeyDown={onKeyDown}
                className={cn(
                  "inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-3 font-medium text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                  selected
                    ? "bg-background text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon aria-hidden className="hidden size-4 sm:block" />
                {copy.home.views.tabs[id]}
              </button>
            );
          })}
        </div>
      </div>
      <div
        role="tabpanel"
        id={`${baseId}-panel`}
        aria-labelledby={`${baseId}-tab-${active}`}
        className="mt-6"
      >
        <LazyMount className="aspect-[1280/760]">{stage}</LazyMount>
      </div>
    </div>
  );
}

/** Every layout, auto-advancing: the home page's views demo. */
export function ViewsDemo({ className }: { className?: string }) {
  return <ViewsShowcase className={className} />;
}

/** Calendar and Gantt only, for the dates section of the views page. */
export function TimelineViewsDemo({ className }: { className?: string }) {
  return <ViewsShowcase views={TIMELINE_VIEWS} className={className} />;
}

const TIMELINE_VIEWS: readonly ViewId[] = ["calendar", "gantt"];
