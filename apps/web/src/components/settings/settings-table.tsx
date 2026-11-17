import { MoreHorizontal } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "@/components/ui/menu";
import { cn } from "@/lib/cn";

/*
 * The data table of settings pages (users, workspaces, audit trails, keys,
 * webhooks…). It fits its column instead of scrolling sideways:
 *
 * - fixed layout: a column with a width class keeps it, the others share the
 *   rest; text wraps, ids and emails truncate (TruncatedText);
 * - a column with `hideBelow` disappears when the table is narrower than
 *   48rem ("md") or 64rem ("lg"); repeat its value under the primary cell
 *   with <SettingsTableMeta hideAbove=…>;
 * - below 40rem the rows become cards: the primary cell with the actions at
 *   its right, then one labelled line per remaining cell.
 *
 * The breakpoints are container queries on the table itself, so the same page
 * adapts to the context panel opening as well as to the window.
 *
 *   <SettingsTable label=…>
 *     <SettingsTableHeader>
 *       <SettingsTableRow>
 *         <SettingsTableHead>Name</SettingsTableHead>
 *         <SettingsTableHead className="w-24" align="end" hideBelow="md">…
 *         <SettingsTableHead className="w-20"><span className="sr-only">…
 *       </SettingsTableRow>
 *     </SettingsTableHeader>
 *     <SettingsTableBody>
 *       <SettingsTableRow>
 *         <SettingsTableCell kind="primary">… <SettingsTableMeta hideAbove="md">…
 *         <SettingsTableCell label="Members" align="end" hideBelow="md">…
 *         <SettingsTableCell kind="actions">…
 *
 * The explicit ARIA roles keep the table semantics while the card layout
 * changes the elements' display, which some browsers treat as "not a table".
 */

type Breakpoint = "md" | "lg";
type Align = "start" | "end";

const HIDE_BELOW: Record<Breakpoint, string> = {
  md: "@max-[48rem]/settings-table:hidden",
  lg: "@max-[64rem]/settings-table:hidden",
};

const SHOW_BELOW: Record<Breakpoint, string> = {
  md: "hidden @max-[48rem]/settings-table:flex",
  lg: "hidden @max-[64rem]/settings-table:flex",
};

type SettingsTableProps = ComponentProps<"table"> & {
  /** Classes for the bordered frame around the table. */
  frameClassName?: string;
};

export function SettingsTable({
  className,
  frameClassName,
  ...props
}: SettingsTableProps) {
  return (
    <div
      className={cn(
        "@container/settings-table w-full min-w-0 overflow-hidden rounded-lg border bg-card",
        frameClassName,
      )}
      data-slot="settings-table"
    >
      <table
        // biome-ignore lint/a11y/noRedundantRoles: kept while the card layout changes the display
        role="table"
        className={cn(
          "w-full table-fixed border-collapse text-sm @max-[40rem]/settings-table:block",
          className,
        )}
        {...props}
      />
    </div>
  );
}

export function SettingsTableHeader({
  className,
  ...props
}: ComponentProps<"thead">) {
  return (
    <thead
      // biome-ignore lint/a11y/noRedundantRoles: kept while the card layout changes the display
      role="rowgroup"
      className={cn(
        "border-b bg-muted/40 @max-[40rem]/settings-table:sr-only",
        className,
      )}
      {...props}
    />
  );
}

export function SettingsTableBody({
  className,
  ...props
}: ComponentProps<"tbody">) {
  return (
    <tbody
      // biome-ignore lint/a11y/noRedundantRoles: kept while the card layout changes the display
      role="rowgroup"
      className={cn("@max-[40rem]/settings-table:block", className)}
      {...props}
    />
  );
}

export function SettingsTableRow({
  className,
  ...props
}: ComponentProps<"tr">) {
  return (
    <tr
      // biome-ignore lint/a11y/noRedundantRoles: kept while the card layout changes the display
      role="row"
      className={cn(
        "border-b transition-colors last:border-b-0 [tbody>&]:hover:bg-muted/40",
        "@max-[40rem]/settings-table:grid @max-[40rem]/settings-table:grid-cols-[minmax(0,1fr)_auto] @max-[40rem]/settings-table:items-start @max-[40rem]/settings-table:gap-x-3 @max-[40rem]/settings-table:gap-y-1.5 @max-[40rem]/settings-table:px-3 @max-[40rem]/settings-table:py-3",
        className,
      )}
      data-slot="settings-table-row"
      {...props}
    />
  );
}

type HeadProps = Omit<ComponentProps<"th">, "align"> & {
  align?: Align;
  hideBelow?: Breakpoint;
};

export function SettingsTableHead({
  className,
  align = "start",
  hideBelow,
  ...props
}: HeadProps) {
  return (
    <th
      // biome-ignore lint/a11y/noRedundantRoles: kept while the card layout changes the display
      role="columnheader"
      scope="col"
      className={cn(
        "h-9 px-3 py-2 align-middle font-medium text-muted-foreground text-xs leading-4 wrap-break-word",
        align === "end" ? "text-end" : "text-start",
        hideBelow && HIDE_BELOW[hideBelow],
        className,
      )}
      {...props}
    />
  );
}

type CellProps = Omit<ComponentProps<"td">, "align"> & {
  /**
   * primary: the row's subject (first, top left of a card); actions: the row's
   * buttons or "…" menu (last, top right of a card).
   */
  kind?: "primary" | "actions";
  /** The column name, shown before the value in the card layout. */
  label?: ReactNode;
  align?: Align;
  hideBelow?: Breakpoint;
};

export function SettingsTableCell({
  className,
  kind,
  label,
  align = "start",
  hideBelow,
  children,
  ...props
}: CellProps) {
  const labelled = !kind && !hideBelow && label !== undefined;
  return (
    <td
      // biome-ignore lint/a11y/noRedundantRoles: kept while the card layout changes the display
      role="cell"
      className={cn(
        "min-w-0 px-3 py-2.5 align-middle wrap-break-word",
        align === "end" ? "text-end tabular-nums" : "text-start",
        "@max-[40rem]/settings-table:p-0 @max-[40rem]/settings-table:text-start",
        kind === "primary" &&
          "@max-[40rem]/settings-table:col-start-1 @max-[40rem]/settings-table:row-start-1 @max-[40rem]/settings-table:block",
        kind === "actions" &&
          "text-end @max-[40rem]/settings-table:col-start-2 @max-[40rem]/settings-table:row-start-1 @max-[40rem]/settings-table:block",
        !kind && "@max-[40rem]/settings-table:col-span-2",
        labelled
          ? "@max-[40rem]/settings-table:flex @max-[40rem]/settings-table:items-baseline @max-[40rem]/settings-table:gap-3"
          : !kind && !hideBelow && "@max-[40rem]/settings-table:block",
        hideBelow && HIDE_BELOW[hideBelow],
        className,
      )}
      data-kind={kind}
      {...props}
    >
      {labelled ? (
        <>
          <span
            aria-hidden
            className="hidden w-24 shrink-0 text-muted-foreground text-xs @max-[40rem]/settings-table:block"
          >
            {label}
          </span>
          <div className="min-w-0 @max-[40rem]/settings-table:flex-1">
            {children}
          </div>
        </>
      ) : (
        children
      )}
    </td>
  );
}

/**
 * The values of the columns hidden at this width, as one line of dot-separated
 * items under the primary cell: <SettingsTableMeta hideAbove="md"> shows only
 * while the "md" columns are hidden (and in the card layout).
 */
export function SettingsTableMeta({
  hideAbove,
  className,
  children,
}: {
  hideAbove: Breakpoint;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "mt-0.5 flex-wrap items-center gap-x-1.5 text-muted-foreground text-xs [&>*:not(:first-child)]:before:me-1.5 [&>*:not(:first-child)]:before:content-['·']",
        SHOW_BELOW[hideAbove],
        className,
      )}
      data-slot="settings-table-meta"
    >
      {children}
    </span>
  );
}

type RowAction = {
  label: string;
  onClick: () => void;
  icon?: ReactNode;
  destructive?: boolean;
  disabled?: boolean;
};

/**
 * A row's actions as one "…" menu, the pattern of every settings table with
 * more than one action: text buttons side by side would not fit the actions
 * column in every language. Put it in a `w-14` actions column.
 */
export function SettingsRowActions({
  actions,
  name,
}: {
  actions: RowAction[];
  /** The row's subject, for the menu's accessible name. */
  name: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex justify-end">
      <Menu>
        <MenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("settings:table.actionsFor", { name })}
            />
          }
        >
          <MoreHorizontal />
        </MenuTrigger>
        <MenuPopup align="end">
          {actions.map((action) => (
            <MenuItem
              key={action.label}
              variant={action.destructive ? "destructive" : undefined}
              disabled={action.disabled}
              onClick={action.onClick}
            >
              {action.icon}
              {action.label}
            </MenuItem>
          ))}
        </MenuPopup>
      </Menu>
    </div>
  );
}
