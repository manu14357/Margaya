import { useTranslation } from "react-i18next";
import useInboxCounts from "@/hooks/queries/notification/use-inbox-counts";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";

/** The rail and tab bar's Inbox badge: unread items in the Inbox view. */
export function useInboxBadge() {
  const { t } = useTranslation();
  const { data: workspace } = useActiveWorkspace();
  const { data: counts } = useInboxCounts(workspace?.id);
  const count = counts?.unread ?? 0;
  return {
    count,
    label: t("navigation:shell.unreadAria", { count }),
  };
}
