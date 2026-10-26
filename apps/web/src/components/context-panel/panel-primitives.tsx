import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import projectIcons from "@/constants/project-icons";
import { cn } from "@/lib/cn";
import { identityColor } from "@/lib/identity-color";

/** The hover-revealed action button at a panel row's right edge. */
export const panelRowActionClass =
  "absolute top-1 right-1 flex size-5.5 items-center justify-center rounded-md p-0 text-sidebar-foreground outline-hidden ring-sidebar-ring transition-opacity hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:opacity-100 group-focus-within/menu-item:opacity-100 group-hover/menu-item:opacity-100 data-popup-open:opacity-100 md:opacity-0 [&>svg]:size-4";

/**
 * A project's icon on a small squircle tile, tinted with the project's stable
 * identity hue (hashed from `seed`, the project id) or the projects area hue.
 */
export function ProjectTile({
  icon,
  seed,
  className,
}: {
  icon?: string | null;
  seed?: string | null;
  className?: string;
}) {
  const Icon =
    icon && Object.hasOwn(projectIcons, icon)
      ? projectIcons[icon as keyof typeof projectIcons]
      : projectIcons.Layout;
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

/** A group of panel rows under an optional overline label. */
export function PanelSection({
  label,
  action,
  children,
  className,
}: {
  label?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <SidebarGroup className={cn("gap-0.5 px-2 py-1", className)}>
      {(label || action) && (
        <div className="flex items-center justify-between">
          {label ? <SidebarGroupLabel>{label}</SidebarGroupLabel> : <span />}
          {action}
        </div>
      )}
      <SidebarGroupContent>
        <SidebarMenu>{children}</SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

/** A count on a panel row. */
export function PanelCount({
  count,
  label,
}: {
  count: number | string;
  label?: string;
}) {
  const className =
    "ms-auto shrink-0 rounded-full bg-sidebar-accent px-1.5 font-medium text-[11px] text-sidebar-accent-foreground tabular-nums";
  if (!label) return <span className={className}>{count}</span>;
  return (
    <span role="img" aria-label={label} className={className}>
      {count}
    </span>
  );
}

/** One navigational row in the context panel. */
export function PanelLink({
  label,
  icon: Icon,
  leading,
  active = false,
  disabled = false,
  trailing,
  onSelect,
}: {
  label: string;
  icon?: LucideIcon;
  /** Replaces the icon, e.g. a project tile. */
  leading?: ReactNode;
  active?: boolean;
  disabled?: boolean;
  /** A count or chip at the row's end. */
  trailing?: ReactNode;
  onSelect: () => void;
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={active}
        disabled={disabled}
        onClick={onSelect}
      >
        {leading ??
          (Icon ? (
            <Icon
              className={cn(
                "size-4",
                active ? "text-sidebar-primary" : "opacity-75",
              )}
            />
          ) : null)}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {trailing}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

/** Quiet guidance text inside a PanelSection (an empty group). */
export function PanelHint({ children }: { children: ReactNode }) {
  return (
    <li className="px-2 py-1.5 text-muted-foreground text-xs leading-relaxed">
      {children}
    </li>
  );
}
