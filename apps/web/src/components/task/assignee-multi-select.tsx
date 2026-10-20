import { Check, Minus, Search, X } from "lucide-react";
import {
  type KeyboardEvent,
  type UIEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { AgentBadgeFor } from "@/components/ai/agents/agent-badge";
import useAuth from "@/components/providers/auth-provider/hooks/use-auth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ShortcutNumber } from "@/components/ui/shortcut-number";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useNumberedShortcuts } from "@/hooks/use-numbered-shortcuts";
import { useAssigneePeople } from "@/hooks/use-task-assignees";
import { cn } from "@/lib/cn";
import { getInitials } from "@/lib/get-initials";
import {
  type AssigneeEntry,
  assigneeDisplayName,
  MAX_TASK_ASSIGNEES,
  pickerOrder,
  resolveAssignees,
  type TaskAssignee,
} from "@/lib/task-assignees";

const INITIAL_VISIBLE_USERS = 40;
const VISIBLE_USERS_STEP = 40;
/** Up to this many people, number keys pick rows; above it, a search field. */
const SEARCH_THRESHOLD = 8;
const NO_IDS: readonly string[] = [];
const ROW_SELECTOR = '[role="menuitemcheckbox"]:not(:disabled)';

type AssigneeMultiSelectProps = {
  workspaceId: string;
  /** Assigned people (to every task, for several tasks), assignee order. */
  selectedIds: readonly string[];
  /** Assigned to only some of several tasks; shown with a dash. */
  mixedIds?: readonly string[];
  /** People whose change is in flight; their rows wait. */
  pendingIds?: ReadonlySet<string>;
  /** The task's own assignee data, for people the member list lacks. */
  embedded?: readonly TaskAssignee[];
  onToggle: (userId: string, nextChecked: boolean) => void;
  /** Shown as "Clear assignees" while anyone is assigned. */
  onClear?: () => void;
  disabled?: boolean;
  limit?: number;
  /** The count held against `limit`; defaults to the selection's size. */
  assignedCount?: number;
};

type Row = AssigneeEntry & {
  checked: boolean;
  mixed: boolean;
  pending: boolean;
  isMe: boolean;
};

/**
 * The assignee list shared by the task picker, the create-task modal and the
 * subtask picker. Rows keep the order they had when the list opened, so they
 * never jump under the cursor; every toggle is reported at once.
 */
export default function AssigneeMultiSelect({
  workspaceId,
  selectedIds,
  mixedIds = NO_IDS,
  pendingIds,
  embedded,
  onToggle,
  onClear,
  disabled = false,
  limit = MAX_TASK_ASSIGNEES,
  assignedCount,
}: AssigneeMultiSelectProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const currentUserId = user?.id ?? null;
  const { people, isLoading } = useAssigneePeople(workspaceId);
  const [query, setQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_USERS);
  const searchRef = useRef<HTMLInputElement>(null);

  const liveOrder = useMemo(
    () =>
      pickerOrder([...selectedIds, ...mixedIds], people ?? [], currentUserId),
    [selectedIds, mixedIds, people, currentUserId],
  );
  // The order is captured once the member list is known and then kept;
  // people who appear later go last, people no longer listable drop out
  // (a former member, once unassigned).
  const [frozenOrder, setFrozenOrder] = useState<readonly string[] | null>(
    null,
  );
  if (people && frozenOrder === null) setFrozenOrder(liveOrder);
  const order = useMemo(() => {
    if (!frozenOrder) return liveOrder;
    const live = new Set(liveOrder);
    const frozen = new Set(frozenOrder);
    return [
      ...frozenOrder.filter((id) => live.has(id)),
      ...liveOrder.filter((id) => !frozen.has(id)),
    ];
  }, [frozenOrder, liveOrder]);

  const rows = useMemo<Row[]>(() => {
    const selected = new Set(selectedIds);
    const mixed = new Set(mixedIds);
    return resolveAssignees(order, people, embedded ?? []).map((entry) => ({
      ...entry,
      checked: selected.has(entry.id),
      mixed: !selected.has(entry.id) && mixed.has(entry.id),
      pending: pendingIds?.has(entry.id) ?? false,
      isMe: entry.id === currentUserId,
    }));
  }, [
    order,
    people,
    embedded,
    selectedIds,
    mixedIds,
    pendingIds,
    currentUserId,
  ]);

  const showSearch = rows.length > SEARCH_THRESHOLD;
  const needle = query.trim().toLowerCase();
  const matching = needle
    ? rows.filter((row) =>
        assigneeDisplayName(row, t).toLowerCase().includes(needle),
      )
    : rows;
  const visible = matching.slice(0, visibleCount);
  const atLimit = (assignedCount ?? selectedIds.length) >= limit;
  const isBlockedByLimit = (row: Row) => atLimit && !row.checked && !row.mixed;
  const isRowDisabled = (row: Row) =>
    disabled || row.pending || isBlockedByLimit(row);

  const toggle = (row: Row) => {
    if (!isRowDisabled(row)) onToggle(row.id, !row.checked);
  };

  useNumberedShortcuts(
    !showSearch,
    (showSearch ? [] : visible.slice(0, 9)).map((row) => ({
      onSelect: () => toggle(row),
    })),
  );

  useEffect(() => {
    if (!showSearch) return;
    const timer = setTimeout(() => searchRef.current?.focus(), 100);
    return () => clearTimeout(timer);
  }, [showSearch]);

  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    const target = event.currentTarget;
    if (target.scrollHeight - target.scrollTop - target.clientHeight >= 48) {
      return;
    }
    setVisibleCount((current) =>
      Math.min(
        current + VISIBLE_USERS_STEP,
        Math.max(matching.length, current),
      ),
    );
  };

  const handleListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(ROW_SELECTOR),
    );
    if (items.length === 0) return;
    event.preventDefault();
    const index = items.indexOf(document.activeElement as HTMLElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    const next =
      index === -1 ? 0 : (index + step + items.length) % items.length;
    items[next]?.focus();
  };

  const listRef = useRef<HTMLDivElement>(null);
  const focusFirstRow = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "ArrowDown") return;
    event.preventDefault();
    listRef.current?.querySelector<HTMLElement>(ROW_SELECTOR)?.focus();
  };

  const renderRow = (row: Row, index: number) => {
    const name = assigneeDisplayName(row, t);
    const blocked = isBlockedByLimit(row);
    const button = (
      <Button
        key={row.id}
        type="button"
        variant="ghost"
        size="sm"
        role="menuitemcheckbox"
        aria-checked={row.mixed ? "mixed" : row.checked}
        // A saving row stays focusable: disabling the focused button drops
        // focus to <body>, and Escape then closes the whole task sheet.
        disabled={disabled || blocked}
        aria-disabled={row.pending || undefined}
        aria-busy={row.pending || undefined}
        className={cn(
          "w-full justify-start gap-2 px-2",
          row.isFormerMember ? "h-auto min-h-8 py-1" : "h-8",
        )}
        onClick={() => toggle(row)}
      >
        <span className="flex w-3 shrink-0 justify-center">
          {row.pending ? (
            <Spinner className="size-3" />
          ) : row.checked ? (
            <Check className="size-3" />
          ) : row.mixed ? (
            <Minus className="size-3" />
          ) : null}
        </span>
        <Avatar className="size-6 shrink-0">
          <AvatarImage src={row.image ?? ""} alt="" />
          <AvatarFallback className="border border-border/30 font-medium text-xs">
            {getInitials(row.name)}
          </AvatarFallback>
        </Avatar>
        <span className="flex min-w-0 flex-1 flex-col items-start">
          <span
            className={cn(
              "w-full truncate text-left text-sm",
              row.isFormerMember && "text-muted-foreground",
            )}
          >
            {row.isMe ? t("tasks:assignees.you", { name }) : name}
          </span>
          {row.isFormerMember && (
            <span className="text-[11px] text-muted-foreground">
              {t("tasks:assignees.formerMember")}
            </span>
          )}
        </span>
        <AgentBadgeFor userId={row.id} />
        {!showSearch && index < 9 && <ShortcutNumber number={index + 1} />}
      </Button>
    );
    if (!blocked) return button;
    // A disabled button gets no pointer events, so a wrapper holds the hint.
    return (
      <Tooltip key={row.id}>
        <TooltipTrigger render={<span className="block" />}>
          {button}
        </TooltipTrigger>
        <TooltipContent>
          {t("tasks:assignees.limitReached", { count: limit })}
        </TooltipContent>
      </Tooltip>
    );
  };

  const hasAnyone = selectedIds.length > 0 || mixedIds.length > 0;

  return (
    <div className="flex w-full flex-col">
      {showSearch && (
        <div className="flex items-center gap-2 border-b border-border p-2">
          <Search className="size-3 text-muted-foreground" />
          <Input
            ref={searchRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setVisibleCount(INITIAL_VISIBLE_USERS);
            }}
            onKeyDown={focusFirstRow}
            placeholder={t("tasks:assignees.searchPlaceholder")}
            aria-label={t("tasks:assignees.searchPlaceholder")}
            className="border-none p-0 h-auto focus-visible:ring-0 shadow-none !bg-transparent"
          />
        </div>
      )}
      <div
        ref={listRef}
        role="menu"
        aria-label={t("tasks:assignees.label")}
        className="max-h-80 space-y-0.5 overflow-y-auto p-1"
        onScroll={handleScroll}
        onKeyDown={handleListKeyDown}
        tabIndex={-1}
      >
        {visible.map(renderRow)}
        {isLoading &&
          ["first", "second", "third"].map((key) => (
            <Skeleton key={key} className="h-8 w-full" />
          ))}
        {!isLoading && needle && matching.length === 0 && (
          <p className="px-2 py-1.5 text-muted-foreground text-xs">
            {t("tasks:assignees.noMatches")}
          </p>
        )}
        {!isLoading && !needle && rows.length === 0 && (
          <p className="px-2 py-1.5 text-muted-foreground text-xs">
            {t("tasks:assignees.noMembers")}
          </p>
        )}
      </div>
      {onClear && hasAnyone && (
        <div className="border-t border-border p-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 w-full justify-start gap-2 px-2 text-muted-foreground"
            disabled={disabled}
            onClick={onClear}
          >
            <X className="size-3.5" />
            {t("tasks:assignees.clear")}
          </Button>
        </div>
      )}
    </div>
  );
}
