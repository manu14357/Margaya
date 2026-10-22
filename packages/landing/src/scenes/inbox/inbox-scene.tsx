"use client";

import type { LucideIcon } from "lucide-react";
import {
  AlarmClock,
  Archive,
  AtSign,
  Bell,
  CalendarClock,
  CheckCheck,
  CircleDot,
  Inbox,
  Mail,
  MailOpen,
  MessageSquare,
  RefreshCw,
  UserRoundPlus,
} from "lucide-react";
import { type ReactNode, useMemo } from "react";
import { type LandingCopy, useLandingCopy } from "../../copy";
import {
  type DemoScene,
  DemoStage,
  type SceneRenderProps,
  step,
} from "../../demo";
import { cn } from "../../lib/cn";
import {
  Avatar,
  IconRail,
  ReplicaShell,
  ReplicaToast,
  TopBar,
} from "../../replica";
import {
  type InboxAction,
  type InboxItem,
  type InboxState,
  inboxReducer,
  unreadCount,
  visibleItems,
} from "./state";

type Demo = LandingCopy["demo"];

export const SNOOZED_ID = "assigned";
export const READ_ID = "mention";

const PRESETS = ["oneDay", "threeDays", "oneWeek", "twoWeeks"] as const;

/**
 * Each notification's type icon and hue, as the app's `notification-kind`
 * maps them: people (work), talk (pages), state and time (status), mentions.
 */
const KINDS: Record<string, { icon: LucideIcon; color: string }> = {
  mention: { icon: AtSign, color: "var(--area-analytics)" },
  assigned: { icon: UserRoundPlus, color: "var(--area-work)" },
  due: { icon: AlarmClock, color: "var(--status-started-fg)" },
  moved: { icon: CircleDot, color: "var(--status-started-fg)" },
  commented: { icon: MessageSquare, color: "var(--area-pages)" },
};
const FALLBACK_KIND = { icon: Bell, color: "var(--area-inbox)" };

/** The actor's face with a type badge, or the type icon on its own tint. */
function LeadingVisual({ item }: { item: InboxItem }) {
  const kind = KINDS[item.id] ?? FALLBACK_KIND;
  const KindIcon = kind.icon;
  if (item.actor) {
    return (
      <span className="relative size-8 shrink-0" data-kind={item.id}>
        <Avatar name={item.actor} size="lg" />
        <span
          aria-hidden
          className="absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-full bg-card ring-2 ring-card"
          style={{ color: kind.color }}
        >
          <KindIcon className="size-3" strokeWidth={2.25} />
        </span>
      </span>
    );
  }
  return (
    <span
      data-kind={item.id}
      className="flex size-8 shrink-0 items-center justify-center rounded-full"
      style={{
        backgroundColor: `color-mix(in srgb, ${kind.color} 14%, var(--card))`,
        color: kind.color,
      }}
    >
      <KindIcon aria-hidden className="size-3.5" />
    </span>
  );
}

function initialItems(demo: Demo): InboxItem[] {
  const { verbs, items } = demo.inbox;
  const { people } = demo;
  const key = (number: number) => `${demo.hero.projectKey}-${number}`;
  return [
    {
      id: "mention",
      actor: people.mira.name,
      verb: verbs.mention,
      taskKey: key(15),
      ...items.mention,
      unread: true,
      snoozed: false,
    },
    {
      id: "assigned",
      actor: people.jonas.name,
      verb: verbs.assigned,
      taskKey: key(31),
      ...items.assigned,
      unread: true,
      snoozed: false,
    },
    {
      id: "due",
      actor: null,
      verb: verbs.due,
      taskKey: key(24),
      ...items.due,
      unread: true,
      snoozed: false,
    },
    {
      id: "moved",
      actor: people.sam.name,
      verb: verbs.moved,
      taskKey: key(19),
      ...items.moved,
      unread: false,
      snoozed: false,
    },
    {
      id: "commented",
      actor: people.priya.name,
      verb: verbs.commented,
      taskKey: key(21),
      ...items.commented,
      unread: false,
      snoozed: false,
    },
  ];
}

/**
 * The notification inbox: snooze an assignment until tomorrow, then mark
 * a mention read.
 */
export function createInboxScene(
  demo: Demo,
): DemoScene<InboxState, InboxAction> {
  return {
    id: "inbox",
    initialState: {
      items: initialItems(demo),
      hover: null,
      menuFor: null,
      toast: false,
    },
    reducer: inboxReducer,
    script: [
      step.wait(700),
      step.move(`row-${SNOOZED_ID}`, { anchor: { x: 0.6 } }),
      step.set({ type: "hover", id: SNOOZED_ID }),
      step.click(`snooze-${SNOOZED_ID}`, {
        type: "openSnooze",
        id: SNOOZED_ID,
      }),
      step.wait(500),
      step.click("option-oneDay", { type: "snooze", id: SNOOZED_ID }),
      step.wait(1300),
      step.move(`row-${READ_ID}`, { anchor: { x: 0.6 } }),
      step.set({ type: "hover", id: READ_ID }),
      step.click(`read-${READ_ID}`, { type: "read", id: READ_ID }),
      step.wait(3000),
    ],
    render: (props) => <InboxView {...props} />,
  };
}

function RowAction({
  label,
  onClick,
  children,
  "data-demo": target,
}: {
  label: string;
  onClick?: () => void;
  children: ReactNode;
  "data-demo"?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-demo={target}
      onClick={onClick}
      className="flex size-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3.5"
    >
      {children}
    </button>
  );
}

function InboxView({
  state,
  dispatch,
  compact,
}: SceneRenderProps<InboxState, InboxAction>) {
  const demo = useLandingCopy().demo;
  const { inbox, shell } = demo;
  const unread = unreadCount(state);
  const items = visibleItems(state);

  return (
    <ReplicaShell
      rail={
        compact ? undefined : (
          <IconRail
            active="inbox"
            user={demo.people.adam.name}
            inboxCount={unread || undefined}
          />
        )
      }
    >
      <TopBar
        compact={compact}
        place={
          <>
            <Inbox aria-hidden className="size-4 text-muted-foreground" />
            <span>{shell.rail.inbox}</span>
          </>
        }
      />
      <div className="flex h-10 shrink-0 items-center gap-1 border-border border-b px-2">
        <div className="flex min-w-0 flex-1 items-center gap-1">
          {[
            { id: "all", label: inbox.all, count: unread, active: true },
            { id: "mentions", label: inbox.mentions, count: 0, active: false },
          ].map((tab) => (
            <span key={tab.id} className="relative flex h-10 items-center">
              <span
                className={cn(
                  "flex h-7 items-center gap-1.5 rounded-md px-2 font-medium text-[13px]",
                  tab.active ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {tab.id === "mentions" && (
                  <AtSign aria-hidden className="size-3.5" />
                )}
                {tab.label}
                {tab.count > 0 && (
                  <span
                    data-demo={`count-${tab.id}`}
                    className="flex h-5 min-w-5 items-center justify-center rounded-sm border border-border/60 px-1 font-medium text-[11px] text-muted-foreground tabular-nums"
                  >
                    {tab.count}
                  </span>
                )}
              </span>
              {tab.active && (
                <span
                  aria-hidden
                  className="absolute inset-x-1 -bottom-px h-0.5 rounded-full bg-primary"
                />
              )}
            </span>
          ))}
        </div>
        <RowAction
          label={inbox.markAllRead}
          data-demo="mark-all-read"
          onClick={() => dispatch({ type: "markAllRead" })}
        >
          <CheckCheck aria-hidden />
        </RowAction>
        <RowAction label={inbox.refresh}>
          <RefreshCw aria-hidden />
        </RowAction>
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden bg-card">
        {items.map((item) => {
          const showActions =
            state.hover === item.id || state.menuFor === item.id;
          return (
            // biome-ignore lint/a11y/noStaticElementInteractions: hover only reveals the row's buttons, which are reachable by keyboard.
            <div
              key={item.id}
              data-demo={`row-${item.id}`}
              onMouseEnter={() => dispatch({ type: "hover", id: item.id })}
              className={cn(
                "group relative flex gap-3 border-border/60 border-b px-3 py-2.5 transition-colors",
                showActions && "bg-accent/40",
                state.menuFor === item.id && "z-20",
              )}
            >
              {item.unread && (
                <span
                  aria-hidden
                  className="absolute top-1/2 left-1 size-1.5 -translate-y-1/2 rounded-full bg-info"
                />
              )}
              <LeadingVisual item={item} />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <p className="min-w-0 flex-1 truncate text-sm">
                    {item.actor && (
                      <span
                        className={
                          item.unread
                            ? "font-medium text-foreground"
                            : "text-muted-foreground"
                        }
                      >
                        {item.actor}{" "}
                      </span>
                    )}
                    <span
                      className={cn(
                        "text-muted-foreground",
                        !item.actor &&
                          item.unread &&
                          "font-medium text-foreground",
                      )}
                    >
                      {item.verb}
                    </span>
                  </p>
                  <span
                    className={cn(
                      "shrink-0 text-[11px] text-muted-foreground/70",
                      showActions && "invisible",
                    )}
                  >
                    {item.time}
                  </span>
                </div>
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="shrink-0 font-mono text-muted-foreground text-xs">
                    {item.taskKey}
                  </span>
                  <span className="truncate text-sm">{item.task}</span>
                </div>
                {item.preview && (
                  <p className="line-clamp-1 text-muted-foreground text-xs">
                    {item.preview}
                  </p>
                )}
              </div>
              <div
                className={cn(
                  "absolute top-1.5 right-2 flex items-center gap-0.5 rounded-md bg-card px-0.5 shadow-xs transition-opacity",
                  showActions
                    ? "opacity-100"
                    : "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100",
                )}
              >
                <RowAction
                  label={inbox.markRead}
                  data-demo={`read-${item.id}`}
                  onClick={() => dispatch({ type: "read", id: item.id })}
                >
                  {item.unread ? (
                    <MailOpen aria-hidden />
                  ) : (
                    <Mail aria-hidden />
                  )}
                </RowAction>
                <RowAction label={inbox.archive}>
                  <Archive aria-hidden />
                </RowAction>
                <RowAction
                  label={inbox.snooze}
                  data-demo={`snooze-${item.id}`}
                  onClick={() => dispatch({ type: "openSnooze", id: item.id })}
                >
                  <AlarmClock aria-hidden />
                </RowAction>
              </div>
              {state.menuFor === item.id && (
                <div
                  data-demo="snooze-menu"
                  className="absolute top-9 right-2 z-30 w-60 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg/5"
                >
                  {PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      data-demo={`option-${preset}`}
                      onClick={() => dispatch({ type: "snooze", id: item.id })}
                      className="flex h-8 w-full cursor-pointer items-center rounded-md px-2 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent"
                    >
                      {inbox.presets[preset]}
                      <span className="ms-auto ps-4 text-muted-foreground/72 text-xs">
                        {inbox.targets[preset]}
                      </span>
                    </button>
                  ))}
                  <div className="-mx-1 my-1 h-px bg-border" />
                  <span className="flex h-8 items-center gap-2 rounded-md px-2 text-sm">
                    <CalendarClock aria-hidden className="size-4 opacity-80" />
                    {inbox.custom}
                  </span>
                </div>
              )}
            </div>
          );
        })}
        {state.toast && (
          // Lifted clear of the stage's play button in the corner.
          <div className="pointer-events-none absolute inset-x-0 top-0 bottom-10">
            <ReplicaToast>{inbox.snoozedToast}</ReplicaToast>
          </div>
        )}
      </div>
    </ReplicaShell>
  );
}

/** The inbox demo, ready to drop into a section. */
export function InboxDemo({ className }: { className?: string }) {
  const copy = useLandingCopy();
  const scene = useMemo(() => createInboxScene(copy.demo), [copy.demo]);
  return (
    <DemoStage
      scene={scene}
      caption={copy.scenes.inbox.caption}
      description={copy.scenes.inbox.description}
      size={{ width: 800, height: 560 }}
      compactSize={{ width: 480, height: 600 }}
      className={className}
    />
  );
}
