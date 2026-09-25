import { useLocation, useNavigate } from "@tanstack/react-router";
import {
  Archive,
  AtSign,
  BellDot,
  Clock,
  Inbox,
  ListFilter,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  PanelCount,
  PanelLink,
  PanelSection,
} from "@/components/context-panel/panel-primitives";
import useInboxCounts from "@/hooks/queries/notification/use-inbox-counts";
import {
  type InboxSearch,
  resolveInboxFilters,
  validateInboxSearch,
} from "@/lib/inbox-search";
import type { InboxTab, InboxView } from "@/types/notification";

const TAB_ICONS: Record<InboxTab, LucideIcon> = {
  all: Inbox,
  mentions: AtSign,
};

const VIEW_ICONS: Record<InboxView, LucideIcon> = {
  inbox: Inbox,
  snoozed: Clock,
  archived: Archive,
};

/**
 * Inbox: the tabs, the views and the unread filter. Every row writes the
 * inbox route's URL state, so the page and the panel never disagree.
 */
export function InboxPanel({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname, search } = useLocation({
    select: (location) => ({
      pathname: location.pathname,
      search: location.search as Record<string, unknown>,
    }),
  });
  const onInbox = pathname.startsWith(
    `/dashboard/workspace/${workspaceId}/inbox`,
  );
  const filters = resolveInboxFilters(
    onInbox ? validateInboxSearch(search) : {},
  );
  const { data: counts } = useInboxCounts(workspaceId);

  const go = (patch: Partial<InboxSearch>) => {
    const current = onInbox ? validateInboxSearch(search) : {};
    // A different list drops the open notification.
    const { notificationId: _drop, ...rest } = current;
    navigate({
      to: "/dashboard/workspace/$workspaceId/inbox",
      params: { workspaceId },
      search: { ...rest, ...patch },
    });
  };

  const tabCount = (tab: InboxTab) => {
    const count = tab === "all" ? counts?.unread : counts?.unreadMentions;
    return count ? (
      <PanelCount
        count={count > 99 ? "99+" : count}
        label={t("notifications:inbox.tabs.unreadAria", { count })}
      />
    ) : undefined;
  };

  return (
    <>
      <PanelSection>
        {(["all", "mentions"] as const).map((tab) => (
          <PanelLink
            key={tab}
            label={t(`notifications:inbox.tabs.${tab}`)}
            icon={TAB_ICONS[tab]}
            active={onInbox && filters.view === "inbox" && filters.tab === tab}
            trailing={tabCount(tab)}
            onSelect={() =>
              go({ tab: tab === "all" ? undefined : tab, view: undefined })
            }
          />
        ))}
      </PanelSection>

      <PanelSection label={t("notifications:inbox.views.label")}>
        {(["snoozed", "archived"] as const).map((view) => (
          <PanelLink
            key={view}
            label={t(`notifications:inbox.views.${view}`)}
            icon={VIEW_ICONS[view]}
            active={onInbox && filters.view === view}
            onSelect={() => go({ view })}
          />
        ))}
      </PanelSection>

      <PanelSection
        label={
          <span className="flex items-center gap-1.5">
            <ListFilter aria-hidden className="size-3" />
            {t("navigation:shell.filters")}
          </span>
        }
      >
        <PanelLink
          label={t("navigation:shell.unreadOnly")}
          icon={BellDot}
          active={onInbox && filters.unread}
          onSelect={() => go({ unread: filters.unread ? undefined : true })}
        />
      </PanelSection>
    </>
  );
}
