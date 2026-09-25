import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
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
 * It scrolls sideways when it runs out of room (phones).
 */
export function ViewTabs({
  tabs,
  value,
  label,
  trailing,
  className,
}: ViewTabsProps) {
  return (
    <nav
      aria-label={label}
      className={cn(
        "flex h-10 shrink-0 items-center gap-2 border-border/80 border-b bg-background px-2 md:px-3",
        className,
      )}
      data-slot="view-tabs"
    >
      <div className="-mb-px min-w-0 flex-1 overflow-x-auto [scrollbar-width:none]">
        <Tabs value={value}>
          <TabsList variant="underline" className="h-10 gap-0.5 py-0">
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
                    className="h-7 grow-0 gap-1.5 px-2 text-[13px] text-muted-foreground sm:h-7 sm:text-[13px]"
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
