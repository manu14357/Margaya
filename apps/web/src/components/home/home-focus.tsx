import { Link } from "@tanstack/react-router";
import {
  ChevronRight,
  CircleCheck,
  Inbox,
  type LucideIcon,
  StickyNote,
  UserRoundCheck,
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import useInboxCounts from "@/hooks/queries/notification/use-inbox-counts";
import {
  type MyWorkGroupCounts,
  useMyWorkSummary,
} from "@/hooks/queries/task-query/use-my-work-summary";
import { COLUMN_GROUP_META } from "@/lib/column-groups";

type FocusPath =
  | "/dashboard/workspace/$workspaceId/inbox"
  | "/dashboard/workspace/$workspaceId/my-work"
  | "/dashboard/workspace/$workspaceId/stickies";

function FocusCard({
  workspaceId,
  to,
  icon: Icon,
  tone,
  title,
  children,
}: {
  workspaceId: string;
  to: FocusPath;
  icon: LucideIcon;
  /** The tile's area hue, e.g. `var(--area-inbox)`. */
  tone: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <Card
      render={<Link to={to} params={{ workspaceId }} />}
      className="group relative gap-2 overflow-hidden rounded-xl px-3.5 py-3 shadow-xs outline-none transition-[background-color,box-shadow,translate] hover:-translate-y-px hover:shadow-sm focus-visible:ring-2 focus-visible:ring-ring motion-reduce:hover:translate-y-0"
      style={{ "--tile-tone": tone } as CSSProperties}
    >
      <span className="flex items-center gap-2">
        <span
          aria-hidden
          className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--tile-tone)_14%,transparent)] text-(--tile-tone)"
        >
          <Icon className="size-4" />
        </span>
        <span className="min-w-0 flex-1 truncate font-medium text-sm">
          {title}
        </span>
        <ChevronRight
          className="size-4 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5"
          aria-hidden
        />
      </span>
      <span className="flex min-h-8 flex-wrap items-end gap-x-2 gap-y-1 text-muted-foreground text-xs">
        {children}
      </span>
    </Card>
  );
}

/** A tile's headline number in its area hue (24px, so 3:1 is enough). */
function StatNumber({ value, caption }: { value: number; caption: string }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="font-semibold text-(--tile-tone) text-2xl tabular-nums leading-none">
        {value}
      </span>
      <span>{caption}</span>
    </span>
  );
}

const PROGRESS_GROUPS = [
  "completed",
  "started",
  "unstarted",
  "backlog",
] as const;

/** Your assigned work by status group, as one thin stacked bar. */
function GroupMiniBar({ groups }: { groups: MyWorkGroupCounts }) {
  const total = PROGRESS_GROUPS.reduce((sum, key) => sum + groups[key], 0);
  if (total === 0) return null;
  return (
    <span
      aria-hidden
      className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted"
    >
      {PROGRESS_GROUPS.map((key) =>
        groups[key] > 0 ? (
          <span
            key={key}
            className="h-full"
            style={{
              width: `${(groups[key] / total) * 100}%`,
              backgroundColor: COLUMN_GROUP_META[key].color,
            }}
          />
        ) : null,
      )}
    </span>
  );
}

/**
 * Home's "jump back in" strip: what waits in the inbox, the open and late
 * work assigned to you, and your private notes. Each tile opens its page.
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
      className="grid grid-cols-1 gap-3 sm:grid-cols-3"
    >
      <FocusCard
        workspaceId={workspaceId}
        to="/dashboard/workspace/$workspaceId/inbox"
        icon={Inbox}
        tone="var(--area-inbox)"
        title={t("home:focus.inbox")}
      >
        {inbox.isLoading ? (
          <Skeleton className="h-6 w-16" />
        ) : unread > 0 ? (
          <StatNumber value={unread} caption={t("home:focus.unreadCaption")} />
        ) : (
          <span className="flex items-center gap-1.5">
            <CircleCheck
              aria-hidden
              className="size-4 text-(--status-completed)"
            />
            {t("home:focus.caughtUp")}
          </span>
        )}
      </FocusCard>
      <FocusCard
        workspaceId={workspaceId}
        to="/dashboard/workspace/$workspaceId/my-work"
        icon={UserRoundCheck}
        tone="var(--area-work)"
        title={t("home:focus.myWork")}
      >
        {work.isLoading ? (
          <Skeleton className="h-6 w-20" />
        ) : (
          <>
            <StatNumber
              value={assignedOpen}
              caption={t("home:focus.openCaption")}
            />
            {overdue > 0 && (
              <span className="rounded-full bg-destructive/10 px-1.5 py-0.5 font-medium text-[11px] text-destructive-foreground">
                {t("home:focus.overdue", { count: overdue })}
              </span>
            )}
            <GroupMiniBar groups={work.summary.groups} />
          </>
        )}
      </FocusCard>
      <FocusCard
        workspaceId={workspaceId}
        to="/dashboard/workspace/$workspaceId/stickies"
        icon={StickyNote}
        tone="var(--area-projects)"
        title={t("home:focus.stickies")}
      >
        {t("home:focus.stickiesHint")}
      </FocusCard>
    </section>
  );
}
