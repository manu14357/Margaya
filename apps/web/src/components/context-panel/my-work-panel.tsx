import { useLocation, useNavigate } from "@tanstack/react-router";
import {
  Bell,
  Bot,
  FilePen,
  LayoutDashboard,
  type LucideIcon,
  PenLine,
  UserRoundCheck,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  PanelCount,
  PanelLink,
  PanelSection,
} from "@/components/context-panel/panel-primitives";
import { useTaskDraftCount } from "@/hooks/queries/task-draft/use-task-draft-count";
import { useAgentDeskNav } from "@/hooks/use-agent-desk-nav";
import {
  isMyWorkTab,
  type MyWorkTab,
  visibleMyWorkTabs,
} from "@/lib/task-query/my-work";

const TAB_ICONS: Record<MyWorkTab, LucideIcon> = {
  summary: LayoutDashboard,
  assigned: UserRoundCheck,
  created: PenLine,
  subscribed: Bell,
};

/**
 * Your work: its tabs, then Drafts. Drafts shows with a count while the
 * person has any, or while its page is open, so people who never draft see
 * nothing new.
 */
export function MyWorkPanel({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname, tab } = useLocation({
    select: (location) => ({
      pathname: location.pathname,
      tab: (location.search as Record<string, unknown>).tab,
    }),
  });
  const { data: draftCount = 0 } = useTaskDraftCount(workspaceId);
  const base = `/dashboard/workspace/${workspaceId}`;
  const onMyWork = pathname.startsWith(`${base}/my-work`);
  const activeTab: MyWorkTab = isMyWorkTab(tab) ? tab : "summary";
  const draftsActive = pathname.startsWith(`${base}/drafts`);
  const deskActive = pathname.startsWith(`${base}/agents`);
  const { show: showDesk, waiting } = useAgentDeskNav(workspaceId, deskActive);

  return (
    <PanelSection>
      {visibleMyWorkTabs().map((key) => (
        <PanelLink
          key={key}
          label={t(`myWork:tabs.${key}`)}
          icon={TAB_ICONS[key]}
          active={onMyWork && activeTab === key}
          onSelect={() =>
            navigate({
              to: "/dashboard/workspace/$workspaceId/my-work",
              params: { workspaceId },
              search: { tab: key === "summary" ? undefined : key },
            })
          }
        />
      ))}
      {(draftCount > 0 || draftsActive) && (
        <PanelLink
          label={t("navigation:sidebar.drafts")}
          icon={FilePen}
          active={draftsActive}
          trailing={
            draftCount > 0 ? (
              <PanelCount count={draftCount > 99 ? "99+" : draftCount} />
            ) : undefined
          }
          onSelect={() => navigate({ to: `${base}/drafts` })}
        />
      )}
      {showDesk && (
        <PanelLink
          label={t("ai:agents.desk.nav")}
          icon={Bot}
          active={deskActive}
          trailing={
            waiting > 0 ? (
              <PanelCount count={waiting > 99 ? "99+" : waiting} />
            ) : undefined
          }
          onSelect={() => navigate({ to: `${base}/agents` })}
        />
      )}
    </PanelSection>
  );
}
