import { Link } from "@tanstack/react-router";
import {
  ChevronRight,
  Inbox,
  type LucideIcon,
  StickyNote,
  UserRoundCheck,
} from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import useInboxCounts from "@/hooks/queries/notification/use-inbox-counts";
import { useMyWorkSummary } from "@/hooks/queries/task-query/use-my-work-summary";

type FocusPath =
  | "/dashboard/workspace/$workspaceId/inbox"
  | "/dashboard/workspace/$workspaceId/my-work"
  | "/dashboard/workspace/$workspaceId/stickies";

function FocusCard({
  workspaceId,
  to,
  icon: Icon,
  title,
  children,
}: {
  workspaceId: string;
  to: FocusPath;
  icon: LucideIcon;
  title: string;
  children: ReactNode;
}) {
  return (
    <Card
      render={<Link to={to} params={{ workspaceId }} />}
      className="group flex-row items-center gap-3 rounded-xl px-3 py-2.5 outline-none transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground group-hover:text-foreground">
        <Icon className="size-4" aria-hidden />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium text-sm">{title}</span>
        <span className="flex min-h-4 items-center gap-1.5 truncate text-muted-foreground text-xs">
          {children}
        </span>
      </span>
      <ChevronRight
        className="size-4 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5"
        aria-hidden
      />
    </Card>
  );
}

/**
 * Home's "jump back in" strip: what waits in the inbox, the open and late
 * work assigned to you, and your private notes. Each card opens its page.
 */
export default function HomeFocus({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation();
  const inbox = useInboxCounts(workspaceId);
  const work = useMyWorkSummary(workspaceId);
  const unread = inbox.data?.unread ?? 0;
  const { assignedOpen, overdue } = work.summary.counts;

  return (
    <section
      aria-label={t("home:focus.label")}
      className="grid grid-cols-1 gap-2 sm:grid-cols-3"
    >
      <FocusCard
        workspaceId={workspaceId}
        to="/dashboard/workspace/$workspaceId/inbox"
        icon={Inbox}
        title={t("home:focus.inbox")}
      >
        {inbox.isLoading ? (
          <Skeleton className="h-3 w-16" />
        ) : unread > 0 ? (
          <span className="font-medium text-foreground">
            {t("home:focus.unread", { count: unread })}
          </span>
        ) : (
          t("home:focus.caughtUp")
        )}
      </FocusCard>
      <FocusCard
        workspaceId={workspaceId}
        to="/dashboard/workspace/$workspaceId/my-work"
        icon={UserRoundCheck}
        title={t("home:focus.myWork")}
      >
        {work.isLoading ? (
          <Skeleton className="h-3 w-20" />
        ) : (
          <>
            <span>{t("home:focus.open", { count: assignedOpen })}</span>
            {overdue > 0 && (
              <span className="text-destructive-foreground">
                {t("home:focus.overdue", { count: overdue })}
              </span>
            )}
          </>
        )}
      </FocusCard>
      <FocusCard
        workspaceId={workspaceId}
        to="/dashboard/workspace/$workspaceId/stickies"
        icon={StickyNote}
        title={t("home:focus.stickies")}
      >
        {t("home:focus.stickiesHint")}
      </FocusCard>
    </section>
  );
}
