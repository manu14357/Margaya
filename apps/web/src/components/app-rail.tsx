import { CircleQuestionMark, Plus } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useShell } from "@/components/common/shell-context";
import {
  DESTINATION_META,
  type ShellDestination,
} from "@/components/common/shell-destinations";
import {
  CreateMenu,
  HelpMenu,
  ShellUserAvatar,
  UserMenu,
} from "@/components/common/shell-menus";
import { useInboxBadge } from "@/components/common/use-shell-badges";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import { shortcuts } from "@/constants/shortcuts";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { cn } from "@/lib/cn";

/** The destinations on the rail, top to bottom (Settings sits at the foot). */
export function useRailDestinations(): ShellDestination[] {
  const { canReadAnalytics, isCheckingPermissions } = useWorkspacePermission();
  // Shown once the permission check settles, so it never flashes.
  const showAnalytics = !isCheckingPermissions && canReadAnalytics();
  return [
    "home",
    "inbox",
    "my-work",
    "projects",
    "pages",
    ...(showAnalytics ? (["analytics"] as const) : []),
  ];
}

export function RailBadge({
  count,
  label,
  className,
}: {
  count: number;
  label: string;
  className?: string;
}) {
  if (count <= 0) return null;
  return (
    <span
      role="img"
      aria-label={label}
      className={cn(
        "absolute -top-1 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 font-semibold text-[10px] text-primary-foreground tabular-nums leading-none ring-2 ring-sidebar",
        className,
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

const railButton =
  "group/rail relative flex w-14 cursor-pointer flex-col items-center gap-0.5 rounded-lg py-1 font-medium text-[11px] text-sidebar-foreground leading-3 outline-hidden transition-colors hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring aria-[current=page]:text-sidebar-accent-foreground";

const railIcon =
  "relative flex h-7 w-9 items-center justify-center rounded-full transition-colors group-hover/rail:bg-sidebar-accent group-aria-[current=page]/rail:bg-sidebar-accent [&>svg]:size-[18px]";

function RailItem({
  destination,
  active,
  badge,
  onSelect,
}: {
  destination: ShellDestination;
  active: boolean;
  badge?: ReactNode;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  const meta = DESTINATION_META[destination];
  const Icon = meta.icon;

  return (
    <button
      type="button"
      className={railButton}
      aria-current={active ? "page" : undefined}
      onClick={onSelect}
      data-destination={destination}
    >
      {active && (
        <span
          aria-hidden
          className="absolute top-2 -left-1 h-5 w-[3px] rounded-r-full bg-sidebar-primary"
        />
      )}
      <span className={railIcon}>
        <Icon strokeWidth={1.75} />
        {badge}
      </span>
      <span className="max-w-full truncate px-0.5">{t(meta.labelKey)}</span>
    </button>
  );
}

function RailIconButton(props: ComponentProps<"button">) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "group/rail flex size-10 cursor-pointer items-center justify-center rounded-lg text-sidebar-foreground outline-hidden transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring data-popup-open:bg-sidebar-accent [&>svg]:size-[18px]",
        props.className,
      )}
    />
  );
}

/**
 * The 64px rail: the workspace, the global destinations, then Create, Help,
 * Settings and the avatar. Hidden under 768px, where the bottom tab bar and
 * the panel drawer take over.
 */
export function AppRail() {
  const { t } = useTranslation();
  const shell = useShell();
  const destinations = useRailDestinations();
  const inbox = useInboxBadge();

  if (!shell) return null;
  const { destination, selectDestination } = shell;

  return (
    <nav
      aria-label={t("navigation:shell.primary")}
      className="hidden w-16 shrink-0 flex-col items-center gap-1 border-sidebar-border border-r bg-sidebar py-2.5 text-sidebar-foreground md:flex"
      data-slot="app-rail"
    >
      <div className="mb-2">
        <WorkspaceSwitcher />
      </div>

      {destinations.map((id) => (
        <RailItem
          key={id}
          destination={id}
          active={destination === id}
          onSelect={() => selectDestination(id)}
          badge={
            id === "inbox" ? (
              <RailBadge count={inbox.count} label={inbox.label} />
            ) : undefined
          }
        />
      ))}

      <span className="flex-1" />

      <CreateMenu
        trigger={
          <button
            type="button"
            aria-label={t("navigation:shell.create")}
            title={`${t("navigation:shell.create")} (${shortcuts.task.prefix} ${shortcuts.task.create})`}
            className="mb-1 flex size-10 cursor-pointer items-center justify-center rounded-xl bg-primary text-primary-foreground outline-hidden transition-transform hover:-translate-y-px focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar active:translate-y-0"
          >
            <Plus className="size-5" />
          </button>
        }
      />
      <HelpMenu
        trigger={
          <RailIconButton
            aria-label={t("navigation:shell.help")}
            title={t("navigation:shell.help")}
          >
            <CircleQuestionMark strokeWidth={1.75} />
          </RailIconButton>
        }
      />
      <RailItem
        destination="settings"
        active={destination === "settings"}
        onSelect={() => selectDestination("settings")}
      />
      <UserMenu
        trigger={
          <button
            type="button"
            aria-label={t("navigation:shell.account")}
            className="mt-1 cursor-pointer rounded-full outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ShellUserAvatar />
          </button>
        }
      />
    </nav>
  );
}
