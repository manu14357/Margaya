import { useNavigate } from "@tanstack/react-router";
import {
  Bell,
  Bot,
  LayoutDashboard,
  type LucideIcon,
  PenLine,
  UserRoundCheck,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import Layout from "@/components/common/layout";
import type { ViewTab } from "@/components/common/view-tabs";
import { PanelCount } from "@/components/context-panel/panel-primitives";
import { useAgentDeskNav } from "@/hooks/use-agent-desk-nav";
import {
  type MyWorkTab,
  myWorkTabSearch,
  visibleMyWorkTabs,
} from "@/lib/task-query/my-work";

const TAB_ICONS: Record<MyWorkTab, LucideIcon> = {
  summary: LayoutDashboard,
  assigned: UserRoundCheck,
  created: PenLine,
  subscribed: Bell,
};

/**
 * The Your work tab row, shared by its tabs and the Agent Desk so both show
 * the same destinations as the side panel.
 */
export function MyWorkTabs({
  workspaceId,
  value,
  onSelectTab,
}: {
  workspaceId: string;
  value: MyWorkTab | "agents";
  onSelectTab?: (tab: MyWorkTab) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const desk = useAgentDeskNav(workspaceId, value === "agents");
  const openTab = (key: MyWorkTab) =>
    onSelectTab
      ? onSelectTab(key)
      : navigate({
          to: "/dashboard/workspace/$workspaceId/my-work",
          params: { workspaceId },
          search: { tab: myWorkTabSearch(key) },
        });

  const tabs: ViewTab[] = visibleMyWorkTabs().map((key) => ({
    value: key,
    label: t(`myWork:tabs.${key}`),
    icon: TAB_ICONS[key],
    onSelect: () => openTab(key),
  }));
  if (desk.show) {
    tabs.push({
      value: "agents",
      label: t("ai:agents.desk.nav"),
      icon: Bot,
      badge:
        desk.waiting > 0 ? (
          <PanelCount count={desk.waiting > 99 ? "99+" : desk.waiting} />
        ) : undefined,
      onSelect: () =>
        navigate({
          to: "/dashboard/workspace/$workspaceId/agents",
          params: { workspaceId },
        }),
    });
  }

  return (
    <Layout.ViewTabs label={t("myWork:viewsLabel")} tabs={tabs} value={value} />
  );
}
