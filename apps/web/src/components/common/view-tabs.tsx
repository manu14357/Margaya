import { ChevronDown, type LucideIcon } from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type WheelEvent,
} from "react";
import { useTranslation } from "react-i18next";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import { Tabs, TabsList, TabsTab } from "@/components/ui/tabs";
import { cn } from "@/lib/cn";
import { overflowingTabs } from "./view-tabs-fit";

/** The "More" button's width before it has been measured. */
const MORE_WIDTH_GUESS = 84;

export type ViewTab = {
  /** Unique within the row; matched against `value`. */
  value: string;
  label: ReactNode;
  icon?: LucideIcon;
  /** A count or chip after the label (e.g. an intake badge). */
  badge?: ReactNode;
  onSelect: () => void;
  /** Draws a divider before this tab (e.g. between layouts and sections). */
  separated?: boolean;
};

export type ViewTabsProps = {
  tabs: readonly ViewTab[];
  /** The selected tab's value; null selects none. */
  value: string | null;
  /** The row's accessible name, e.g. "Project views". */
  label: string;
  /** Right-aligned controls on the same row (e.g. Display, Share). */
  trailing?: ReactNode;
  className?: string;
};

/**
 * The underline tab row under the top bar: a page's views or sections.
 * When the tabs run out of room (many project features, narrow windows,
 * phones) the last ones move into a "More" menu at the row's end, so no tab
 * is ever cut off at the edge; the selected tab always stays in the row. On
 * touch screens the tabs and the row grow to a 44px target.
 */
export function ViewTabs({
  tabs,
  value,
  label,
  trailing,
  className,
}: ViewTabsProps) {
  const { t } = useTranslation();
  const scroller = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  // Each tab's width (separator included), kept while the tab is in "More".
  const widths = useRef(new Map<string, number>());
  const [hidden, setHidden] = useState<readonly string[]>([]);
  const hiddenKey = hidden.join(" ");

  const fitTabs = useCallback(() => {
    const row = scroller.current;
    if (!row) return;
    for (const element of row.querySelectorAll<HTMLElement>(
      "[data-view-tab]",
    )) {
      const key = element.dataset.viewTab;
      if (key && element.offsetWidth > 0) {
        // The list's gap (0.125rem) sits between tabs.
        widths.current.set(key, element.offsetWidth + 2);
      }
    }
    const measured = tabs.map((tab) => widths.current.get(tab.value));
    let next: string[];
    if (measured.some((width) => width === undefined)) {
      // A tab that has never been on screen: show them all once to measure.
      next = [];
    } else {
      const moreWidth = moreRef.current?.offsetWidth
        ? moreRef.current.offsetWidth + 4
        : MORE_WIDTH_GUESS;
      next = overflowingTabs({
        widths: measured as number[],
        // The row's own padding is outside the tabs.
        available: row.clientWidth - 4,
        moreWidth,
        activeIndex: tabs.findIndex((tab) => tab.value === value),
      }).map((index) => tabs[index].value);
    }
    setHidden((current) =>
      current.join(" ") === next.join(" ") ? current : next,
    );
  }, [tabs, value]);

  // Every render may have changed the labels (language) or the tabs.
  useLayoutEffect(() => {
    fitTabs();
  });

  // One observer for the row's life; it always runs the latest fit (the
  // tab list is a new array on every render).
  const latestFit = useRef(fitTabs);
  latestFit.current = fitTabs;
  useLayoutEffect(() => {
    const row = scroller.current;
    if (!row || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => latestFit.current());
    observer.observe(row);
    return () => observer.disconnect();
  }, []);

  const overflow = tabs.filter((tab) => hidden.includes(tab.value));
  const moreLabel = t("navigation:shell.moreTabs");

  // The row hides its scrollbar, so the selected tab must never start out of
  // sight (Analytics in a narrow window). Sections can arrive after the
  // first render (project features load), so the tab list is a dependency.
  const tabKeys = tabs.map((tab) => tab.value).join(" ");
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run when tabs arrive
  useLayoutEffect(() => {
    const row = scroller.current;
    const active = row?.querySelector<HTMLElement>(
      '[role="tab"][aria-selected="true"]',
    );
    if (!row || !active || value === null) return;
    const box = row.getBoundingClientRect();
    const tab = active.getBoundingClientRect();
    const room = 16;
    if (tab.right > box.right) row.scrollLeft += tab.right - box.right + room;
    else if (tab.left < box.left) row.scrollLeft -= box.left - tab.left + room;
  }, [value, tabKeys, hiddenKey]);

  // A mouse wheel only scrolls vertically; with no scrollbar to drag, it
  // moves the row sideways instead. Touchpads already scroll sideways.
  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    const row = event.currentTarget;
    if (row.scrollWidth <= row.clientWidth) return;
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    row.scrollLeft += event.deltaY;
  };

  return (
    <nav
      aria-label={label}
      className={cn(
        "flex h-10 shrink-0 items-center gap-2 border-border/80 border-b bg-background px-2 pointer-coarse:h-11 md:px-3",
        className,
      )}
      data-slot="view-tabs"
    >
      <div
        ref={scroller}
        onWheel={onWheel}
        className="-mb-px flex min-w-0 flex-1 items-center overflow-x-auto [scrollbar-width:none]"
        data-slot="view-tabs-scroller"
      >
        <Tabs value={value} className="shrink-0">
          <TabsList
            variant="underline"
            className="h-10 gap-0.5 py-0 pointer-coarse:h-11"
          >
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <span
                  key={tab.value}
                  className={cn(
                    "flex items-center",
                    hidden.includes(tab.value) && "hidden",
                  )}
                  data-view-tab={tab.value}
                >
                  {tab.separated && (
                    <span
                      aria-hidden
                      className="mx-1.5 h-4 w-px shrink-0 bg-border"
                    />
                  )}
                  <TabsTab
                    value={tab.value}
                    onClick={tab.onSelect}
                    className="h-7 grow-0 gap-1.5 px-2 text-[13px] text-muted-foreground pointer-coarse:h-11 data-active:text-foreground sm:h-7 sm:text-[13px] data-active:[&_svg]:text-primary"
                  >
                    {Icon && <Icon className="size-3.5" />}
                    {tab.label}
                    {tab.badge}
                  </TabsTab>
                </span>
              );
            })}
          </TabsList>
        </Tabs>
        {overflow.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger
              ref={moreRef}
              aria-label={moreLabel}
              title={moreLabel}
              className="relative ms-0.5 flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-md px-2 font-medium text-[13px] text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-accent data-popup-open:text-foreground pointer-coarse:h-11 pointer-coarse:min-w-11"
              data-slot="view-tabs-more"
            >
              {t("navigation:sidebar.more")}
              <ChevronDown aria-hidden className="size-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-44">
              {overflow.map((tab) => {
                const Icon = tab.icon;
                return (
                  <DropdownMenuItem
                    key={tab.value}
                    onClick={tab.onSelect}
                    data-view-tab-item={tab.value}
                  >
                    {Icon && <Icon aria-hidden />}
                    {tab.label}
                    {tab.badge}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {trailing && (
        <div className="flex shrink-0 items-center gap-1.5">{trailing}</div>
      )}
    </nav>
  );
}
