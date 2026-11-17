"use client";

import { Ellipsis, PanelLeftClose, PanelRightClose } from "lucide-react";
import {
  Fragment,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useDesktopFullHeightPanels } from "@/components/desktop/desktop-title-bar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import {
  SheetClose,
  SheetDescription,
  SheetTitle,
  useSheetContext,
} from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";

/** An entry of the panel's "…" menu. */
export type SheetHeaderMenuItem = {
  id: string;
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  destructive?: boolean;
  disabled?: boolean;
};

/** A toolbar action: inline while the row has room, in "…" once it does not. */
export type SheetHeaderAction = SheetHeaderMenuItem & {
  /** The inline control; a ghost icon button with a tooltip by default. */
  render?: ReactNode;
  /** Neighbouring actions of one group sit together; a divider parts groups. */
  group?: string;
  /** Higher stays inline longer: the lowest moves into "…" first. */
  priority?: number;
  /** Never moves into "…" (a primary action, or one with its own popover). */
  pinned?: boolean;
};

/** The panel's own "…" menu. It never collapses and lists collapsed actions. */
export type SheetHeaderMenu = {
  id: string;
  group?: string;
  menu: (collapsed: SheetHeaderMenuItem[]) => ReactNode;
};

type HeaderEntry = SheetHeaderAction | SheetHeaderMenu;

const isMenu = (entry: HeaderEntry): entry is SheetHeaderMenu =>
  "menu" in entry;

/** Close panel and "open full page" share this group, last in the row. */
export const SHEET_HEADER_PANEL_GROUP = "panel";
const DEFAULT_GROUP = "actions";
const MORE_ID = "sheet-header:more";
const CLOSE_ID = "sheet-header:close";
const SEPARATOR_ID = "sheet-header:separator";
/** What the identity keeps before the header splits into two rows. */
const IDENTITY_MIN_WIDTH = 176;

type PlanItem = {
  id: string;
  width: number;
  group: string;
  priority: number;
  /** The menu itself, or a pinned action: never collapses. */
  menu: boolean;
  pinned?: boolean;
};

export type SheetHeaderPlanInput = {
  /** The bar's content width. */
  width: number;
  /** Gap between the identity, the navigation and the actions. */
  gap: number;
  identity: number;
  /** Null when the panel has no navigation. */
  navigation: number | null;
  /** Gap between neighbouring actions. */
  actionGap: number;
  /** The close-panel button; 0 without one. */
  close: number;
  /** A default "…" for collapsed actions when the panel has none. */
  menu: number;
  separator: number;
  /** In display order. */
  items: PlanItem[];
  /** False in the desktop shell's full-height panels: always two rows. */
  singleRow: boolean;
};

export type SheetHeaderPlan = { rows: 1 | 2; collapsed: string[] };

type Slot = { id: string; group: string };

/**
 * The actions row in order: the inline entries, a default "…" before the
 * panel group when actions collapsed and the panel has no menu of its own,
 * then close panel. Shared by the layout plan and the render.
 */
export function headerSequence(
  inline: Slot[],
  { needsMenu, closable }: { needsMenu: boolean; closable: boolean },
): Slot[] {
  const sequence = [...inline];
  if (needsMenu) {
    let at = sequence.findIndex(
      (slot) => slot.group === SHEET_HEADER_PANEL_GROUP,
    );
    if (at === -1) at = sequence.length;
    sequence.splice(at, 0, {
      id: MORE_ID,
      group: sequence[at - 1]?.group ?? DEFAULT_GROUP,
    });
  }
  if (closable)
    sequence.push({ id: CLOSE_ID, group: SHEET_HEADER_PANEL_GROUP });
  return sequence;
}

const separators = (sequence: Slot[]) =>
  sequence.filter(
    (slot, index) => index > 0 && slot.group !== sequence[index - 1]?.group,
  ).length;

function actionsWidth(input: SheetHeaderPlanInput, collapsed: Set<string>) {
  const inline = input.items.filter((item) => !collapsed.has(item.id));
  const sequence = headerSequence(inline, {
    needsMenu: collapsed.size > 0 && !inline.some((item) => item.menu),
    closable: input.close > 0,
  });
  if (sequence.length === 0) return 0;
  const width = (slot: Slot) =>
    slot.id === CLOSE_ID
      ? input.close
      : slot.id === MORE_ID
        ? input.menu
        : (inline.find((item) => item.id === slot.id)?.width ?? 0);
  const count = sequence.length + separators(sequence);
  return (
    sequence.reduce((sum, slot) => sum + width(slot), 0) +
    separators(sequence) * input.separator +
    input.actionGap * (count - 1)
  );
}

function fits(
  input: SheetHeaderPlanInput,
  collapsed: Set<string>,
  rows: 1 | 2,
) {
  const blocks = [actionsWidth(input, collapsed)];
  if (input.navigation !== null) blocks.push(input.navigation);
  if (rows === 1) blocks.push(input.identity);
  const total =
    blocks.reduce((sum, width) => sum + width, 0) +
    input.gap * (blocks.length - 1);
  return total <= input.width;
}

/**
 * Which layout the header takes at a width: one row when the identity, the
 * navigation and every action fit side by side (never in the desktop
 * shell's full-height panels), else two rows, the actions on the second.
 * Actions that still do not fit move into "…", lowest priority first; the
 * "…" menu, the navigation and close panel never move.
 */
export function planSheetHeader(input: SheetHeaderPlanInput): SheetHeaderPlan {
  const none = new Set<string>();
  if (input.singleRow && fits(input, none, 1))
    return { rows: 1, collapsed: [] };
  const order = input.items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => !item.menu && !item.pinned)
    // Lowest priority first; of equals, the one further right.
    .sort((a, b) => a.item.priority - b.item.priority || b.index - a.index)
    .map(({ item }) => item.id);
  const collapsed = new Set<string>();
  for (const id of order) {
    if (fits(input, collapsed, 2)) break;
    collapsed.add(id);
  }
  return { rows: 2, collapsed: [...collapsed] };
}

const px = (value: string) => Number.parseFloat(value) || 0;

function HeaderIconButton({
  label,
  onClick,
  disabled,
  destructive,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
          className={cn(
            "text-foreground",
            destructive &&
              "text-destructive hover:bg-destructive/10 hover:text-destructive",
          )}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function DefaultMoreMenu({ items }: { items: SheetHeaderMenuItem[] }) {
  const { t } = useTranslation();
  const label = t("common:actions.moreActions");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-foreground"
            aria-label={label}
            title={label}
          />
        }
      >
        <Ellipsis className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <SheetHeaderMenuItems items={items} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Collapsed header actions as menu items, for a panel's own "…" menu. */
export function SheetHeaderMenuItems({
  items,
}: {
  items: SheetHeaderMenuItem[];
}) {
  return items.map((item) => (
    <DropdownMenuItem
      key={item.id}
      className="gap-2"
      variant={item.destructive ? "destructive" : undefined}
      disabled={item.disabled}
      onClick={item.onSelect}
    >
      {item.icon}
      {item.label}
    </DropdownMenuItem>
  ));
}

type SheetHeaderBarProps = {
  /** What the panel shows: a key and status, or a name. */
  identity?: ReactNode;
  /** Shorthand for an identity that is just the panel's name. */
  title?: ReactNode;
  /** A line under the header, read as the panel's description. */
  description?: ReactNode;
  /** Previous / next and "N of M"; it never moves into "…". */
  navigation?: ReactNode;
  actions?: HeaderEntry[];
  /** Outside a sheet (a docked panel): what close panel does. */
  onClose?: () => void;
  /** False for a panel that cannot be closed from here. */
  showClose?: boolean;
  /** Outside a sheet: the panel's side, for the close glyph. */
  side?: "left" | "right";
  className?: string;
};

/**
 * The top of a side panel. In a browser it is one row while everything
 * fits: the identity, the navigation, the actions and close panel. In the
 * desktop shell, where a side panel runs the window's full height, row 1
 * is the title bar's height and holds only the identity (its empty space
 * moves the window, and the window buttons own its far corner), and row 2
 * is the toolbar. Narrow panels take two rows as well, and actions that
 * still do not fit move into "…".
 *
 * Close panel is a panel glyph, never an X: an X closes dialogs and the
 * window. Escape closes the panel too.
 */
export function SheetHeaderBar({
  identity,
  title,
  description,
  navigation,
  actions = [],
  onClose,
  showClose = true,
  side: sideProp,
  className,
}: SheetHeaderBarProps) {
  const { t } = useTranslation();
  const sheet = useSheetContext();
  const side = sheet?.side === "left" ? "left" : (sideProp ?? "right");
  const fullHeight = useDesktopFullHeightPanels();
  // The title row exists only in a full-height side sheet of the shell.
  const titleRow =
    fullHeight && (sheet?.side === "left" || sheet?.side === "right");
  const closable = showClose && (sheet !== null || onClose !== undefined);
  // The sheet drops its own fallback close while this header shows.
  const registerHeaderBar = sheet?.registerHeaderBar;
  useLayoutEffect(() => registerHeaderBar?.(), [registerHeaderBar]);

  const barRef = useRef<HTMLDivElement>(null);
  const widths = useRef(new Map<string, number>());
  const [plan, setPlan] = useState<SheetHeaderPlan>({
    rows: titleRow ? 2 : 1,
    collapsed: [],
  });

  const measure = useCallback(() => {
    const bar = barRef.current;
    if (!bar) return;
    const barStyle = getComputedStyle(bar);
    const width =
      bar.clientWidth - px(barStyle.paddingLeft) - px(barStyle.paddingRight);
    // Not laid out (hidden, or a test DOM): keep the current layout.
    if (width <= 0) return;
    const find = (slot: string) =>
      bar.querySelector<HTMLElement>(`[data-slot="${slot}"]`);
    const actionsEl = find("sheet-header-actions");
    const closeEl = find("sheet-header-close");
    const navigationEl = find("sheet-header-navigation");
    for (const el of bar.querySelectorAll<HTMLElement>("[data-action-id]")) {
      const id = el.dataset.actionId;
      if (id) widths.current.set(id, el.getBoundingClientRect().width);
    }
    const separatorEl = find("sheet-header-separator");
    if (separatorEl) {
      const style = getComputedStyle(separatorEl);
      widths.current.set(
        SEPARATOR_ID,
        separatorEl.getBoundingClientRect().width +
          px(style.marginLeft) +
          px(style.marginRight),
      );
    }
    const close = closeEl?.getBoundingClientRect().width ?? 0;
    const fallback = close || 32;
    const next = planSheetHeader({
      width,
      gap: px(barStyle.columnGap),
      identity: IDENTITY_MIN_WIDTH,
      navigation: navigationEl
        ? navigationEl.getBoundingClientRect().width
        : null,
      actionGap: actionsEl ? px(getComputedStyle(actionsEl).columnGap) : 0,
      close,
      menu: fallback,
      separator: widths.current.get(SEPARATOR_ID) ?? 9,
      items: actions.map((entry, index) => ({
        id: entry.id,
        width: widths.current.get(entry.id) ?? fallback,
        group: entry.group ?? DEFAULT_GROUP,
        priority: isMenu(entry) ? 0 : (entry.priority ?? -index),
        menu: isMenu(entry),
        pinned: !isMenu(entry) && entry.pinned === true,
      })),
      singleRow: !titleRow,
    });
    setPlan((current) =>
      current.rows === next.rows &&
      current.collapsed.join() === next.collapsed.join()
        ? current
        : next,
    );
  }, [actions, titleRow]);

  // Before paint, so a crowded header never flashes overlapping.
  useLayoutEffect(() => {
    measure();
  });

  // Re-plan when the panel resizes, and when a part grows on its own: the
  // counter arrives with the board, a button replaces its skeleton.
  const latestMeasure = useRef(measure);
  latestMeasure.current = measure;
  const observer = useRef<ResizeObserver | null>(null);
  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    observer.current = new ResizeObserver(() => latestMeasure.current());
    return () => observer.current?.disconnect();
  }, []);
  useEffect(() => {
    const bar = barRef.current;
    const current = observer.current;
    if (!bar || !current) return;
    current.disconnect();
    current.observe(bar);
    for (const el of bar.querySelectorAll(
      "[data-slot=sheet-header-navigation],[data-action-id]",
    ))
      current.observe(el);
  });

  const rows = titleRow ? 2 : plan.rows;
  const collapsedIds = new Set(plan.collapsed);
  const collapsed: SheetHeaderMenuItem[] = actions
    .filter(
      (entry): entry is SheetHeaderAction =>
        !isMenu(entry) && collapsedIds.has(entry.id),
    )
    .map(({ id, label, icon, onSelect, destructive, disabled }) => ({
      id,
      label,
      icon,
      onSelect,
      destructive,
      disabled,
    }));
  const inline = actions.filter((entry) => !collapsedIds.has(entry.id));
  const sequence = headerSequence(
    inline.map((entry) => ({
      id: entry.id,
      group: entry.group ?? DEFAULT_GROUP,
    })),
    {
      needsMenu: collapsed.length > 0 && !inline.some(isMenu),
      closable,
    },
  );

  const closeLabel = t("common:actions.closePanel");
  const CloseIcon = side === "left" ? PanelLeftClose : PanelRightClose;
  const closeButton = (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={closeLabel}
      className="text-foreground"
      onClick={sheet ? undefined : onClose}
    />
  );

  const renderSlot = (slot: Slot) => {
    if (slot.id === CLOSE_ID) {
      return (
        <span
          className="flex shrink-0 items-center"
          data-slot="sheet-header-close"
        >
          <Tooltip>
            <TooltipTrigger
              render={sheet ? <SheetClose render={closeButton} /> : closeButton}
            >
              {/* Mirrored in right-to-left layouts, where the panel sits on
                  the other side. */}
              <CloseIcon className="size-4 rtl:-scale-x-100" />
            </TooltipTrigger>
            <TooltipContent>{closeLabel}</TooltipContent>
          </Tooltip>
        </span>
      );
    }
    if (slot.id === MORE_ID) {
      return (
        <span
          className="flex shrink-0 items-center"
          data-slot="sheet-header-more"
        >
          <DefaultMoreMenu items={collapsed} />
        </span>
      );
    }
    const entry = inline.find((candidate) => candidate.id === slot.id);
    if (!entry) return null;
    return (
      <span className="flex shrink-0 items-center" data-action-id={entry.id}>
        {isMenu(entry)
          ? entry.menu(collapsed)
          : (entry.render ?? (
              <HeaderIconButton
                label={entry.label}
                onClick={entry.onSelect}
                disabled={entry.disabled}
                destructive={entry.destructive}
              >
                {entry.icon}
              </HeaderIconButton>
            ))}
      </span>
    );
  };

  const identityNode =
    identity ??
    (title !== undefined && (
      <SheetTitleOrHeading inSheet={sheet !== null}>
        {title}
      </SheetTitleOrHeading>
    ));

  return (
    <TooltipProvider>
      <div
        ref={barRef}
        className={cn(
          "flex shrink-0 gap-x-2 border-border border-b bg-background",
          // A named panel lines its name up with a SheetPanel body (p-6);
          // icon buttons sit near the edge either way.
          title !== undefined && identity === undefined ? "ps-6 pe-3" : "px-3",
          rows === 1 ? "h-12 items-center" : "flex-col",
          className,
        )}
        data-slot="sheet-header-bar"
        data-layout={rows === 1 ? "one-row" : "two-rows"}
        data-title-row={titleRow ? "" : undefined}
      >
        <div
          className={cn(
            "flex min-w-0 items-center gap-2",
            rows === 1
              ? "shrink"
              : // Row 1: the title bar's height, clear of the window
                // buttons and the macOS traffic lights in the shell.
                "h-12 shrink-0 ps-(--sheet-start-inset) pe-(--sheet-controls-inset)",
          )}
          data-slot="sheet-header-identity"
        >
          {identityNode}
        </div>
        <div
          className={cn(
            rows === 1
              ? "contents"
              : "flex min-h-10 items-center gap-x-2 pointer-coarse:min-h-12",
          )}
          data-slot="sheet-header-toolbar"
        >
          {navigation && (
            <div
              className="flex shrink-0 items-center"
              data-slot="sheet-header-navigation"
            >
              {navigation}
            </div>
          )}
          <div
            className="ms-auto flex shrink-0 items-center gap-0.5 pointer-coarse:gap-3"
            data-slot="sheet-header-actions"
          >
            {sequence.map((slot, index) => (
              <Fragment key={slot.id}>
                {index > 0 && slot.group !== sequence[index - 1]?.group && (
                  <span
                    aria-hidden="true"
                    className="mx-1 h-4 w-px shrink-0 bg-border"
                    data-slot="sheet-header-separator"
                  />
                )}
                {renderSlot(slot)}
              </Fragment>
            ))}
          </div>
        </div>
      </div>
      {description !== undefined && (
        <SheetDescriptionOrText inSheet={sheet !== null}>
          {description}
        </SheetDescriptionOrText>
      )}
    </TooltipProvider>
  );
}

function SheetTitleOrHeading({
  inSheet,
  children,
}: {
  inSheet: boolean;
  children: ReactNode;
}) {
  const className = "truncate font-heading font-semibold text-base leading-6";
  if (inSheet) return <SheetTitle className={className}>{children}</SheetTitle>;
  return <h2 className={className}>{children}</h2>;
}

function SheetDescriptionOrText({
  inSheet,
  children,
}: {
  inSheet: boolean;
  children: ReactNode;
}) {
  const className = "shrink-0 px-6 pt-4 text-muted-foreground text-sm";
  if (inSheet)
    return (
      <SheetDescription className={className}>{children}</SheetDescription>
    );
  return <p className={className}>{children}</p>;
}
