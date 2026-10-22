"use client";

import type { LucideIcon } from "lucide-react";
import {
  Bell,
  CalendarDays,
  CalendarRange,
  ChartLine,
  CircleQuestionMark,
  FileText,
  FolderKanban,
  House,
  Inbox,
  PanelLeft,
  PanelLeftClose,
  Plus,
  Search,
  Settings,
  Sheet,
  SquareKanban,
  SquircleDashed,
  UserRoundCheck,
} from "lucide-react";
import type { ComponentProps, CSSProperties, ReactNode } from "react";
import { useLandingCopy } from "../copy";
import { cn } from "../lib/cn";
import { Avatar, identityColor, initials } from "./avatar";
import { Kbd } from "./chips";

/*
 * A mini app shell, modelled on the real one (apps/web components/common):
 *
 *   rail (64px) | context panel (248px) | top bar (48px)
 *                                       | view tabs (40px)
 *                                       | filter bar (40px)
 *                                       | content
 *
 * Purely presentational. Chrome text comes from `landing.demo.shell`.
 */

/** The shell frame. Pass `rail` and `panel` (both optional) and the page. */
export function ReplicaShell({
  rail,
  panel,
  children,
  className,
}: {
  rail?: ReactNode;
  panel?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-full w-full overflow-hidden bg-background font-sans text-foreground text-sm antialiased",
        className,
      )}
    >
      {rail}
      {panel}
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}

export type RailDestination =
  | "home"
  | "inbox"
  | "myWork"
  | "projects"
  | "pages"
  | "analytics"
  | "settings";

/** Each destination's area hue (`--area-*`): the icon wears it. */
const AREA: Record<RailDestination, string> = {
  home: "var(--area-home)",
  inbox: "var(--area-inbox)",
  myWork: "var(--area-work)",
  projects: "var(--area-projects)",
  pages: "var(--area-pages)",
  analytics: "var(--area-analytics)",
  settings: "var(--area-settings)",
};

const RAIL: { id: Exclude<RailDestination, "settings">; icon: LucideIcon }[] = [
  { id: "home", icon: House },
  { id: "inbox", icon: Inbox },
  { id: "myWork", icon: UserRoundCheck },
  { id: "projects", icon: FolderKanban },
  { id: "pages", icon: FileText },
  { id: "analytics", icon: ChartLine },
];

function RailItem({
  id,
  icon: Icon,
  label,
  active,
  badge,
}: {
  id: RailDestination;
  icon: LucideIcon;
  label: string;
  active: boolean;
  badge?: number;
}) {
  return (
    <span
      data-demo={`rail-${id}`}
      aria-current={active ? "page" : undefined}
      style={{ "--rail-area": AREA[id] } as CSSProperties}
      className={cn(
        "relative flex w-14 flex-col items-center gap-0.5 rounded-lg py-1 font-medium text-[11px] leading-3",
        active ? "text-sidebar-accent-foreground" : "text-sidebar-foreground",
      )}
    >
      {active && (
        <span
          aria-hidden
          className="absolute top-2 -left-1 h-5 w-[3px] rounded-r-full bg-sidebar-primary"
        />
      )}
      <span
        className={cn(
          "relative flex h-7 w-9 items-center justify-center rounded-full text-(--rail-area)",
          active && "bg-[color-mix(in_oklab,var(--rail-area)_16%,transparent)]",
        )}
      >
        <Icon
          aria-hidden
          strokeWidth={active ? 2 : 1.75}
          className="size-[18px]"
        />
        {badge ? (
          <span className="absolute -top-1 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 font-semibold text-[10px] text-background tabular-nums leading-none ring-2 ring-sidebar">
            {badge}
          </span>
        ) : null}
      </span>
      <span className="max-w-full truncate px-0.5">{label}</span>
    </span>
  );
}

/** A workspace's initials on the app's squircle tile. */
export function WorkspaceTile({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-[28%] border border-border/80 bg-primary font-semibold text-primary-foreground text-sm",
        className,
      )}
    >
      {initials(name).slice(0, 2)}
    </span>
  );
}

/** The 64px rail: workspace, destinations, Create, Help, Settings, avatar. */
export function IconRail({
  active,
  user,
  inboxCount,
}: {
  active: RailDestination;
  /** The signed-in person's name, for the avatar at the foot. */
  user: string;
  inboxCount?: number;
}) {
  const shell = useLandingCopy().demo.shell;
  return (
    <nav
      aria-label={shell.rail.home}
      className="flex w-16 shrink-0 flex-col items-center gap-1 border-sidebar-border border-r bg-sidebar py-2.5 text-sidebar-foreground"
    >
      <div className="mb-2">
        <WorkspaceTile name={shell.workspace} />
      </div>
      {RAIL.map(({ id, icon }) => (
        <RailItem
          key={id}
          id={id}
          icon={icon}
          label={shell.rail[id]}
          active={active === id}
          badge={id === "inbox" ? inboxCount : undefined}
        />
      ))}
      <span className="flex-1" />
      <span
        data-demo="rail-create"
        className="mb-1 flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground"
      >
        <Plus aria-hidden className="size-5" />
      </span>
      <span className="flex size-10 items-center justify-center rounded-lg text-sidebar-foreground">
        <CircleQuestionMark
          aria-hidden
          strokeWidth={1.75}
          className="size-[18px]"
        />
      </span>
      <RailItem
        id="settings"
        icon={Settings}
        label={shell.rail.settings}
        active={active === "settings"}
      />
      <Avatar name={user} size="lg" className="mt-1" />
    </nav>
  );
}

/** The 248px context panel: a title row, then sections of rows. */
export function ContextPanel({
  title,
  children,
  footer,
}: {
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <aside className="flex w-62 shrink-0 flex-col border-border border-r bg-card text-sidebar-foreground">
      <div className="flex h-12 shrink-0 items-center gap-2 ps-4 pe-2">
        <h2 className="min-w-0 flex-1 truncate font-semibold text-[15px] text-foreground">
          {title}
        </h2>
        <span className="flex size-7 items-center justify-center rounded-md text-muted-foreground">
          <PanelLeftClose aria-hidden className="size-4" />
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden pb-3">{children}</div>
      {footer && <div className="shrink-0 p-2">{footer}</div>}
    </aside>
  );
}

/** A group of panel rows under an optional overline label. */
export function PanelSection({
  label,
  children,
}: {
  label?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5 px-2 py-1">
      {label && (
        <div className="flex h-7 items-center rounded-md px-2 font-medium text-[11px] text-sidebar-foreground uppercase tracking-wide">
          {label}
        </div>
      )}
      <ul className="flex flex-col gap-0.5">{children}</ul>
    </div>
  );
}

/** One 30px navigation row of the panel. */
export function PanelRow({
  label,
  icon: Icon,
  leading,
  active = false,
  trailing,
  ...props
}: Omit<ComponentProps<"li">, "children"> & {
  label: ReactNode;
  icon?: LucideIcon;
  leading?: ReactNode;
  active?: boolean;
  trailing?: ReactNode;
}) {
  return (
    <li {...props}>
      <span
        className={cn(
          "relative flex h-7.5 w-full items-center gap-2 overflow-hidden rounded-md px-2 text-[13px]",
          active
            ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-sidebar-primary"
            : "text-sidebar-foreground",
        )}
      >
        {leading ??
          (Icon ? (
            <Icon aria-hidden className="size-4 shrink-0 opacity-75" />
          ) : null)}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {trailing}
      </span>
    </li>
  );
}

/** A count at the end of a panel row. */
export function PanelCount({ count }: { count: number | string }) {
  return (
    <span className="ms-auto shrink-0 rounded-full bg-sidebar-accent px-1.5 font-medium text-[11px] text-sidebar-accent-foreground tabular-nums">
      {count}
    </span>
  );
}

/**
 * A project's icon on a small squircle tile, tinted with the project's
 * identity hue (hashed from `seed`) or the projects area hue, like the app.
 */
export function ProjectTile({
  icon: Icon = FolderKanban,
  seed,
  className,
}: {
  icon?: LucideIcon;
  seed?: string;
  className?: string;
}) {
  const color = seed ? identityColor(seed) : "var(--area-projects)";
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-4.5 shrink-0 items-center justify-center rounded-[28%] border [&>svg]:size-[66%]",
        className,
      )}
      style={{
        backgroundColor: `color-mix(in oklab, ${color} 14%, var(--card))`,
        borderColor: `color-mix(in oklab, ${color} 28%, transparent)`,
        color,
      }}
    >
      <Icon />
    </span>
  );
}

/** The top bar's Ctrl K field. */
export function CommandField({ className }: { className?: string }) {
  const shell = useLandingCopy().demo.shell;
  return (
    <span
      data-demo="command-field"
      className={cn(
        "flex h-8 w-96 min-w-0 items-center gap-2 rounded-full border border-input bg-card ps-3 pe-1.5 text-muted-foreground/80 text-sm",
        className,
      )}
    >
      <Search aria-hidden className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate text-left">
        {shell.commandField}
      </span>
      <Kbd className="h-5 border border-border px-1.5 font-mono text-[11px]">
        {shell.commandShortcut}
      </Kbd>
    </span>
  );
}

/** The 48px bar: panel toggle, place, command field, bell, one action. */
export function TopBar({
  place,
  actions,
  compact = false,
}: {
  place: ReactNode;
  actions?: ReactNode;
  compact?: boolean;
}) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-border/80 border-b bg-background px-3">
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground">
          <PanelLeft aria-hidden className="size-4" />
        </span>
        <div className="flex min-w-0 items-center gap-1.5 px-1 font-semibold text-[15px] text-foreground">
          {place}
        </div>
      </div>
      {compact ? (
        <span className="flex size-8 items-center justify-center rounded-md text-muted-foreground">
          <Search aria-hidden className="size-4.5" />
        </span>
      ) : (
        <CommandField />
      )}
      <div className="flex min-w-0 flex-1 shrink-0 items-center justify-end gap-1.5">
        <span className="flex size-8 items-center justify-center rounded-md text-muted-foreground">
          <Bell aria-hidden className="size-4" />
        </span>
        {actions}
      </div>
    </header>
  );
}

export type ReplicaTab = { id: string; label: ReactNode; icon?: LucideIcon };

/** The underline tab row under the top bar. */
export function ViewTabs({
  tabs,
  active,
  trailing,
}: {
  tabs: readonly ReplicaTab[];
  active: string;
  trailing?: ReactNode;
}) {
  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-border/80 border-b bg-background px-3">
      <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden">
        {tabs.map(({ id, label, icon: Icon }) => (
          <span
            key={id}
            data-demo={`tab-${id}`}
            aria-current={id === active ? "page" : undefined}
            className="relative flex h-10 shrink-0 items-center"
          >
            <span
              className={cn(
                "flex h-7 items-center gap-1.5 rounded-md px-2 font-medium text-[13px]",
                id === active ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {Icon && <Icon aria-hidden className="size-3.5" />}
              {label}
            </span>
            {id === active && (
              <span
                aria-hidden
                className="absolute inset-x-1 -bottom-px h-0.5 rounded-full bg-primary"
              />
            )}
          </span>
        ))}
      </div>
      {trailing && (
        <div className="flex shrink-0 items-center gap-1.5">{trailing}</div>
      )}
    </div>
  );
}

export type ProjectView =
  | "backlog"
  | "board"
  | "spreadsheet"
  | "calendar"
  | "gantt";

const PROJECT_VIEW_ICONS: Record<ProjectView, LucideIcon> = {
  backlog: SquircleDashed,
  board: SquareKanban,
  spreadsheet: Sheet,
  calendar: CalendarRange,
  gantt: CalendarDays,
};

/** A project's five layout tabs (targets `tab-board`, `tab-gantt`, …). */
export function ProjectViewTabs({
  active,
  trailing,
}: {
  active: ProjectView;
  trailing?: ReactNode;
}) {
  const views = useLandingCopy().demo.shell.views;
  const tabs = (Object.keys(PROJECT_VIEW_ICONS) as ProjectView[]).map((id) => ({
    id,
    label: views[id],
    icon: PROJECT_VIEW_ICONS[id],
  }));
  return <ViewTabs tabs={tabs} active={active} trailing={trailing} />;
}

/** The lens bar: filter chips left, display controls right. */
export function FilterBar({
  children,
  trailing,
}: {
  children?: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <div className="flex min-h-10 shrink-0 items-center gap-1.5 border-border/80 border-b bg-background px-3 py-1.5">
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
        {children}
      </div>
      {trailing && (
        <div className="flex shrink-0 items-center gap-1.5">{trailing}</div>
      )}
    </div>
  );
}

const BUTTON_VARIANTS = {
  primary:
    "border-primary bg-primary text-primary-foreground shadow-primary/24 shadow-xs",
  outline:
    "border-input bg-popover text-foreground shadow-xs/5 dark:bg-input/32",
  ghost: "border-transparent text-foreground",
} as const;

/** A small button in the app's style (presentational: a span). */
export function ReplicaButton({
  variant = "outline",
  icon: Icon,
  children,
  className,
  ...props
}: ComponentProps<"span"> & {
  variant?: keyof typeof BUTTON_VARIANTS;
  icon?: LucideIcon;
}) {
  return (
    <span
      {...props}
      className={cn(
        "inline-flex h-7 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 font-medium text-xs",
        BUTTON_VARIANTS[variant],
        className,
      )}
    >
      {Icon && <Icon aria-hidden className="size-3.5 opacity-80" />}
      {children}
    </span>
  );
}
