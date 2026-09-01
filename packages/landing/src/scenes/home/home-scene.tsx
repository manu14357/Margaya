"use client";

import type { LucideIcon } from "lucide-react";
import {
  ArrowRight,
  FileText,
  FolderKanban,
  House,
  Inbox,
  Link2,
  Palette,
  Plus,
  SlidersHorizontal,
  SquareCheck,
  StickyNote,
  Sun,
  Trash2,
  UserRoundCheck,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef } from "react";
import { fill, type LandingCopy, useLandingCopy } from "../../copy";
import {
  type DemoScene,
  DemoStage,
  type SceneRenderProps,
  step,
  useReducedMotion,
} from "../../demo";
import { cn } from "../../lib/cn";
import {
  Avatar,
  IconRail,
  PriorityIcon,
  ReplicaButton,
  ReplicaShell,
  StatusIcon,
  TopBar,
} from "../../replica";
import {
  type HomeAction,
  type HomeState,
  homeReducer,
  NEW_STICKY_ID,
  type StickyColor,
} from "./state";

type Demo = LandingCopy["demo"];

// The app's sticky backgrounds: palette colours with opacity, no tokens.
const STICKY_CLASSES: Record<StickyColor, string> = {
  yellow: "border-amber-500/25 bg-amber-500/12 dark:bg-amber-500/18",
  teal: "border-emerald-500/25 bg-emerald-500/10 dark:bg-emerald-500/18",
  purple: "border-violet-500/25 bg-violet-500/10 dark:bg-violet-500/18",
};

/**
 * The Home page: greeting, the jump-back-in strip, quick links, recents
 * and stickies. The cursor adds a sticky and types a note.
 */
export function createHomeScene(demo: Demo): DemoScene<HomeState, HomeAction> {
  return {
    id: "home",
    initialState: {
      stickies: [
        { id: "standup", color: "teal", text: demo.home.notes.standup },
        { id: "reading", color: "purple", text: demo.home.notes.reading },
      ],
      editing: null,
      saving: false,
      reveal: "top",
    },
    reducer: homeReducer,
    script: [
      step.wait(1200),
      step.set({ type: "reveal", to: "stickies" }),
      step.wait(900),
      step.click("add-sticky", { type: "addSticky" }),
      step.wait(350),
      step.click(`sticky-${NEW_STICKY_ID}`, {
        type: "focus",
        id: NEW_STICKY_ID,
      }),
      step.type(
        `sticky-${NEW_STICKY_ID}`,
        demo.home.typed,
        (value) => ({ type: "input", id: NEW_STICKY_ID, value }),
        22,
      ),
      step.wait(700),
      step.set({ type: "blur" }),
      step.wait(3000),
    ],
    render: (props) => <HomeView {...props} />,
  };
}

function WidgetHeader({
  title,
  children,
}: {
  title: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-h-7 items-center justify-between gap-2">
      <h2 className="font-medium text-muted-foreground text-sm">{title}</h2>
      {children && <div className="flex items-center gap-1">{children}</div>}
    </div>
  );
}

function FocusTile({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card px-3 py-2.5 shadow-xs/5">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Icon aria-hidden className="size-4" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium text-sm">{title}</span>
        <span className="flex min-h-4 items-center gap-1.5 truncate text-muted-foreground text-xs">
          {children}
        </span>
      </span>
      <ArrowRight
        aria-hidden
        className="size-4 shrink-0 text-muted-foreground/60"
      />
    </div>
  );
}

function HomeView({
  state,
  dispatch,
  compact,
}: SceneRenderProps<HomeState, HomeAction>) {
  const demo = useLandingCopy().demo;
  const { home, people } = demo;
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickiesRef = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();

  // The page scrolls to Stickies by state, so the still frame shows them too.
  useEffect(() => {
    const container = scrollRef.current;
    const target = stickiesRef.current;
    if (!container) return;
    const top =
      state.reveal === "stickies" && target ? target.offsetTop - 12 : 0;
    if (typeof container.scrollTo === "function") {
      container.scrollTo({ top, behavior: reduced ? "auto" : "smooth" });
    } else {
      container.scrollTop = top;
    }
  }, [state.reveal, reduced]);

  const links = Object.values(home.links).slice(0, compact ? 2 : 3);
  const recents: {
    id: string;
    icon: LucideIcon;
    keyLabel?: string;
    name: string;
    trailing: ReactNode;
    time: string;
  }[] = [
    {
      id: "task",
      icon: SquareCheck,
      keyLabel: `${demo.hero.projectKey}-24`,
      name: home.recentItems.task,
      trailing: (
        <>
          <StatusIcon status="inProgress" colored className="size-3.5" />
          <PriorityIcon priority="high" className="size-3.5" />
        </>
      ),
      time: home.recentTimes.task,
    },
    {
      id: "page",
      icon: FileText,
      name: home.recentItems.page,
      trailing: <Avatar name={people.mira.name} size="xs" />,
      time: home.recentTimes.page,
    },
    {
      id: "project",
      icon: FolderKanban,
      name: home.recentItems.project,
      trailing: null,
      time: home.recentTimes.project,
    },
  ];

  return (
    <ReplicaShell
      rail={
        compact ? undefined : (
          <IconRail active="home" user={people.adam.name} inboxCount={3} />
        )
      }
    >
      <TopBar
        compact={compact}
        place={
          <>
            <House aria-hidden className="size-4 text-muted-foreground" />
            <span>{demo.shell.rail.home}</span>
          </>
        }
        actions={
          <ReplicaButton icon={SlidersHorizontal}>
            {home.manageWidgets}
          </ReplicaButton>
        }
      />
      <div
        ref={scrollRef}
        data-demo-scroll=""
        className="relative min-h-0 flex-1 overflow-y-auto [scrollbar-width:none]"
      >
        <div className="mx-auto w-full max-w-3xl space-y-6 px-6 py-6">
          <div className="min-w-0 space-y-0.5">
            <h1 className="truncate font-semibold text-xl leading-7">
              {fill(home.greeting, { name: people.adam.name })}
            </h1>
            <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
              <Sun aria-hidden className="size-3.5" />
              <span>{home.date}</span>
            </p>
          </div>

          <div
            className={cn(
              "grid gap-2",
              compact ? "grid-cols-1" : "grid-cols-3",
            )}
          >
            <FocusTile icon={Inbox} title={home.focus.inbox}>
              <span className="font-medium text-foreground">
                {home.focus.unread}
              </span>
            </FocusTile>
            <FocusTile icon={UserRoundCheck} title={home.focus.myWork}>
              <span>{home.focus.open}</span>
              <span className="text-destructive-foreground">
                {home.focus.overdue}
              </span>
            </FocusTile>
            {!compact && (
              <FocusTile icon={StickyNote} title={home.focus.stickies}>
                {home.focus.stickiesHint}
              </FocusTile>
            )}
          </div>

          <section className="space-y-3">
            <WidgetHeader title={home.quickLinks}>
              <ReplicaButton variant="ghost" icon={Plus}>
                {home.addLink}
              </ReplicaButton>
            </WidgetHeader>
            <div
              className={cn(
                "grid gap-2",
                compact ? "grid-cols-1" : "grid-cols-3",
              )}
            >
              {links.map((link) => (
                <div
                  key={link.label}
                  className="flex h-14 items-center gap-3 rounded-lg border border-border bg-card ps-3 pe-3"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted">
                    <Link2
                      aria-hidden
                      className="size-4 text-muted-foreground"
                    />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-sm">
                      {link.label}
                    </span>
                    <span className="block truncate text-muted-foreground text-xs">
                      {link.host}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <WidgetHeader title={home.recents}>
              <span className="inline-flex items-center gap-0.5 rounded-md bg-muted p-0.5">
                {Object.entries(home.recentTabs).map(([id, label]) => (
                  <span
                    key={id}
                    className={cn(
                      "rounded px-2 py-0.5 font-medium text-xs",
                      id === "all"
                        ? "bg-background text-foreground shadow-xs"
                        : "text-muted-foreground",
                    )}
                  >
                    {label}
                  </span>
                ))}
              </span>
            </WidgetHeader>
            <ul className="space-y-0.5">
              {recents.map((recent) => (
                <li
                  key={recent.id}
                  className="flex h-11 items-center gap-3 rounded-md px-2"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
                    <recent.icon
                      aria-hidden
                      className="size-4 text-muted-foreground"
                    />
                  </span>
                  <span className="flex min-w-0 flex-1 items-baseline gap-2">
                    {recent.keyLabel && (
                      <span className="shrink-0 font-medium text-muted-foreground text-xs uppercase">
                        {recent.keyLabel}
                      </span>
                    )}
                    <span className="truncate text-sm">{recent.name}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    {recent.trailing}
                    <span className="text-muted-foreground text-xs">
                      {recent.time}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section ref={stickiesRef} className="space-y-3 pb-6">
            <WidgetHeader title={home.stickies}>
              <button
                type="button"
                data-demo="add-sticky"
                onClick={() => dispatch({ type: "addSticky" })}
                className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 font-medium text-foreground text-xs outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Plus aria-hidden className="size-3.5 opacity-80" />
                {home.addSticky}
              </button>
            </WidgetHeader>
            <div
              className={cn(
                "grid items-start gap-3",
                compact ? "grid-cols-1" : "grid-cols-3",
              )}
            >
              {state.stickies.slice(0, compact ? 2 : 3).map((sticky) => {
                const editing = state.editing === sticky.id;
                return (
                  <div
                    key={sticky.id}
                    className={cn(
                      "flex flex-col rounded-lg border text-foreground transition-[opacity,scale] duration-300 starting:scale-95 starting:opacity-0",
                      STICKY_CLASSES[sticky.color],
                      editing && "ring-2 ring-ring/40",
                    )}
                  >
                    <textarea
                      data-demo={`sticky-${sticky.id}`}
                      aria-label={home.stickies}
                      value={sticky.text}
                      placeholder={home.placeholder}
                      onFocus={() => dispatch({ type: "focus", id: sticky.id })}
                      onBlur={() => dispatch({ type: "blur" })}
                      onChange={(event) =>
                        dispatch({
                          type: "input",
                          id: sticky.id,
                          value: event.target.value,
                        })
                      }
                      className="min-h-28 w-full resize-none bg-transparent px-3 pt-3 pb-2 text-sm outline-none placeholder:text-muted-foreground"
                    />
                    <div className="flex h-9 items-center gap-1 px-2 text-muted-foreground">
                      <span
                        className={cn(
                          "flex size-6 items-center justify-center rounded-md transition-opacity",
                          editing ? "opacity-100" : "opacity-0",
                        )}
                      >
                        <Palette aria-hidden className="size-3.5" />
                      </span>
                      <span className="flex-1" />
                      {editing && state.saving && (
                        <span className="text-xs">{home.saving}</span>
                      )}
                      <span
                        className={cn(
                          "flex size-6 items-center justify-center rounded-md transition-opacity",
                          editing ? "opacity-100" : "opacity-0",
                        )}
                      >
                        <Trash2 aria-hidden className="size-3.5" />
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </div>
    </ReplicaShell>
  );
}

/** The Home demo, ready to drop into a section. */
export function HomeDemo({ className }: { className?: string }) {
  const copy = useLandingCopy();
  const scene = useMemo(() => createHomeScene(copy.demo), [copy.demo]);
  return (
    <DemoStage
      scene={scene}
      caption={copy.scenes.home.caption}
      description={copy.scenes.home.description}
      size={{ width: 960, height: 600 }}
      compactSize={{ width: 560, height: 760 }}
      className={className}
    />
  );
}
