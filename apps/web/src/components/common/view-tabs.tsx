import type { LucideIcon } from "lucide-react";
import {
  type ReactNode,
  useLayoutEffect,
  useRef,
  type WheelEvent,
} from "react";
import { Tabs, TabsList, TabsTab } from "@/components/ui/tabs";
import { cn } from "@/lib/cn";

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
 * It scrolls sideways when it runs out of room (phones, narrow windows), and
 * on touch screens the tabs and the row grow to a 44px target.
 */
export function ViewTabs({
  tabs,
  value,
  label,
  trailing,
  className,
}: ViewTabsProps) {
  const scroller = useRef<HTMLDivElement>(null);

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
  }, [value, tabKeys]);

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
        className="-mb-px min-w-0 flex-1 overflow-x-auto [scrollbar-width:none]"
        data-slot="view-tabs-scroller"
      >
        <Tabs value={value}>
          <TabsList
            variant="underline"
            className="h-10 gap-0.5 py-0 pointer-coarse:h-11"
          >
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <span key={tab.value} className="flex items-center">
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
      </div>
      {trailing && (
        <div className="flex shrink-0 items-center gap-1.5">{trailing}</div>
      )}
    </nav>
  );
}
