import type { LucideIcon } from "lucide-react";
import {
  Boxes,
  Inbox,
  IterationCw,
  LayoutDashboard,
  ListChecks,
} from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ViewTabs } from "@/components/common/view-tabs";
import type { AnalyticsTab } from "@/lib/analytics/tabs";

const TAB_ICONS: Record<AnalyticsTab, LucideIcon> = {
  overview: LayoutDashboard,
  tasks: ListChecks,
  cycles: IterationCw,
  modules: Boxes,
  intake: Inbox,
};

type AnalyticsTabsProps = {
  tabs: readonly AnalyticsTab[];
  active: AnalyticsTab;
  onSelect: (tab: AnalyticsTab) => void;
  /** Right-aligned controls on the tab row (project filter, refresh). */
  trailing?: ReactNode;
};

/**
 * The report tabs: the shell's underline tab row under the top bar.
 * Unavailable tabs are not rendered.
 */
export default function AnalyticsTabs({
  tabs,
  active,
  onSelect,
  trailing,
}: AnalyticsTabsProps) {
  const { t } = useTranslation();
  return (
    <ViewTabs
      label={t("analytics:pageTitle")}
      value={active}
      trailing={trailing}
      tabs={tabs.map((tab) => ({
        value: tab,
        label: t(`analytics:tabs.${tab}`),
        icon: TAB_ICONS[tab],
        onSelect: () => onSelect(tab),
      }))}
    />
  );
}
