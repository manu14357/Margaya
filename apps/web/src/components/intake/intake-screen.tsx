import type { KeyboardEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { SplitView } from "@/components/common/split-view";
import { Kbd } from "@/components/ui/kbd";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useGetIntakeItems } from "@/hooks/queries/intake/use-get-intake-items";
import { useGetActiveWorkspaceUsers } from "@/hooks/queries/workspace-users/use-get-active-workspace-users";
import { useIsMobile } from "@/hooks/use-mobile";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { effectiveIntakeStatus, nextSelectionAfterRemoval } from "@/lib/intake";
import {
  type IntakeSearch,
  intakeEmptyKind,
  readStoredIntakeSort,
  resolveIntakeFilters,
  storeIntakeSort,
  toIntakeSearch,
} from "@/lib/intake-search";
import { shortcutKey } from "@/lib/shortcut-key";
import type { IntakeFilters, IntakeItem, IntakeTab } from "@/types/intake";
import IntakeDetail, {
  type IntakeTriageCommand,
  type IntakeTriageHandler,
} from "./intake-detail";
import IntakeEmptyState from "./intake-empty-state";
import IntakeList from "./intake-list";
import IntakeListToolbar from "./intake-list-toolbar";

type IntakeScreenProps = {
  projectId: string;
  workspaceId: string;
  search: IntakeSearch;
  /** Merges into the URL search, replacing the history entry. */
  onSearchChange: (patch: Partial<IntakeSearch>) => void;
  /** Opens "New request"; absent without intake:create. */
  onCreate?: () => void;
};

/** Typing in a field or an editor keeps its arrow keys. */
function isEditingTarget(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  if (!element) return false;
  return Boolean(
    element.closest(
      'input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"]',
    ),
  );
}

/** The shell's two-key sequences start with these (g h, v b, ...). */
const SEQUENCE_PREFIXES = new Set(["g", "v", "p", "w", "n", "t"]);

const TRIAGE_KEYS: Record<string, IntakeTriageCommand> = {
  a: "accept",
  d: "decline",
  s: "snooze",
  u: "duplicate",
  Enter: "open",
};

/** An open dialog, menu or popover keeps its own keys. */
function hasOpenOverlay() {
  return Boolean(
    document.querySelector(
      '[role="dialog"], [role="alertdialog"], [role="menu"], [data-slot="popover-popup"]',
    ),
  );
}

/**
 * The Intake section as a triage queue (section 7.3): the request list
 * beside the selected request, one pane at a time below 1024px and a sheet
 * on phones. J/K (or the arrows in the list) move; A accepts, D declines,
 * S snoozes, U marks a duplicate and Enter opens the task, through the
 * same dialogs as the header's buttons.
 */
export default function IntakeScreen({
  projectId,
  workspaceId,
  search,
  onSearchChange,
  onCreate,
}: IntakeScreenProps) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const { canReadIntake, canTriageIntake, isCheckingPermissions } =
    useWorkspacePermission();
  const canReadAll = !isCheckingPermissions && canReadIntake();
  const canTriage = !isCheckingPermissions && canTriageIntake();
  const commandRef = useRef<IntakeTriageHandler | null>(null);
  const lastKey = useRef<{ key: string; at: number } | null>(null);
  const filters = resolveIntakeFilters(search);
  const list = useGetIntakeItems(projectId, filters);
  const items = useMemo(
    () => list.data?.pages.flatMap((page) => page.items) ?? [],
    [list.data],
  );
  const counts = list.data?.pages[0]?.counts;
  const ids = items.map((item) => item.id);

  // The router applies a new `item` a moment after the URL changes (about
  // half a second on a busy page). Until then the screen shows the request
  // the user just chose, so a key pressed right after J or K acts on the
  // request on screen, never on the one before it. The choice is dropped
  // once the URL catches up, or when the URL moves elsewhere (back button,
  // a tab change).
  const urlSelectedId = search.item;
  const [pending, setPending] = useState<{ id: string | undefined } | null>(
    null,
  );
  const requested = useRef(new Set<string | undefined>());
  const [seenUrlId, setSeenUrlId] = useState(urlSelectedId);
  if (seenUrlId !== urlSelectedId) {
    setSeenUrlId(urlSelectedId);
    if (
      pending &&
      (pending.id === urlSelectedId || !requested.current.has(urlSelectedId))
    ) {
      setPending(null);
      requested.current.clear();
    }
  }
  const selectedId = pending ? pending.id : urlSelectedId;
  const { data: workspaceUsers } = useGetActiveWorkspaceUsers(
    canReadAll && filters.submittedBy ? workspaceId : "",
  );

  // The ids of the last list that held the selection: a row that just left
  // the list is still found there, so the next one can be selected.
  const idsWithSelection = useRef<string[]>([]);
  if (selectedId && ids.includes(selectedId)) {
    idsWithSelection.current = ids;
  }

  // A sort remembered in this browser applies when the URL names none.
  const appliedStoredSort = useRef(false);
  useEffect(() => {
    if (appliedStoredSort.current) return;
    appliedStoredSort.current = true;
    if (search.sortBy || search.sortOrder) return;
    const stored = readStoredIntakeSort(projectId);
    if (stored?.sortBy || stored?.sortOrder) onSearchChange(stored);
  }, [projectId, search.sortBy, search.sortOrder, onSearchChange]);

  const setFilters = (patch: Partial<IntakeFilters>) => {
    const next = { ...filters, ...patch };
    if (patch.sortBy || patch.sortOrder) {
      storeIntakeSort(projectId, {
        sortBy: next.sortBy,
        sortOrder: next.sortOrder,
      });
    }
    onSearchChange({ ...toIntakeSearch(next), item: selectedId });
  };

  // The selection as the user last set it. The URL catches up a render
  // later, so a key pressed right after a click must not read the old one.
  const latestSelection = useRef(selectedId);
  latestSelection.current = selectedId;
  const select = (id: string | undefined) => {
    latestSelection.current = id;
    requested.current.add(id);
    setPending({ id });
    onSearchChange({ item: id });
  };

  const setTab = (tab: IntakeTab) =>
    onSearchChange({
      ...toIntakeSearch({ ...filters, tab, statuses: [] }),
      item: undefined,
    });

  const clearFilters = () =>
    onSearchChange({
      ...toIntakeSearch({
        ...filters,
        statuses: [],
        priorities: [],
        submittedBy: undefined,
        q: undefined,
      }),
      item: selectedId,
    });

  const selectAfterRemoval = (removedId: string) => {
    const known = idsWithSelection.current.length
      ? idsWithSelection.current
      : ids;
    const next = nextSelectionAfterRemoval(known, removedId);
    select(next && next !== removedId ? next : undefined);
  };

  const handleChanged = (item: IntakeItem) => {
    const status = effectiveIntakeStatus(item);
    if (item.id === selectedId && !filters.statuses.includes(status)) {
      selectAfterRemoval(item.id);
    }
  };

  const index = selectedId ? ids.indexOf(selectedId) : -1;
  const previousId = index > 0 ? ids[index - 1] : undefined;
  const nextId = index >= 0 ? ids[index + 1] : undefined;

  // Until the list has loaded there is nothing to move to: a no-op.
  const moveSelection = (delta: 1 | -1) => {
    if (ids.length === 0) return;
    const current = latestSelection.current;
    const at = current ? ids.indexOf(current) : -1;
    const target =
      at === -1
        ? ids[0]
        : ids[Math.min(ids.length - 1, Math.max(0, at + delta))];
    if (!target || target === current) return;
    select(target);
    document
      .querySelector<HTMLElement>(
        `[data-intake-item-id="${CSS.escape(target)}"]`,
      )
      ?.focus();
  };

  // Once the list loads, the keyboard starts on its first request, unless
  // the user has already put focus somewhere.
  const firstId = ids[0];
  const focusedOnLoad = useRef(false);
  useEffect(() => {
    if (focusedOnLoad.current || !firstId) return;
    focusedOnLoad.current = true;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    document
      .querySelector<HTMLElement>(
        `[data-intake-item-id="${CSS.escape(selectedId ?? firstId)}"]`,
      )
      ?.focus({ preventScroll: true });
  }, [firstId, selectedId]);

  // The queue's single-key commands work anywhere on the page, except in
  // fields, editors and open overlays, or as the second key of a sequence.
  const moveRef = useRef(moveSelection);
  moveRef.current = moveSelection;
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const previous = lastKey.current;
      const key = shortcutKey(event);
      lastKey.current = { key, at: Date.now() };
      if (event.defaultPrevented || event.ctrlKey || event.metaKey) return;
      if (event.altKey || isEditingTarget(event.target) || hasOpenOverlay()) {
        return;
      }
      if (
        previous &&
        SEQUENCE_PREFIXES.has(previous.key) &&
        Date.now() - previous.at < 1000
      ) {
        return;
      }
      if (!event.shiftKey && (key === "j" || key === "k")) {
        event.preventDefault();
        moveRef.current(key === "j" ? 1 : -1);
        return;
      }
      const command = TRIAGE_KEYS[key];
      if (!command || event.shiftKey) return;
      // Enter on a focused button or link is that control's own click.
      if (
        command === "open" &&
        (event.target as HTMLElement | null)?.closest?.("button, a")
      ) {
        return;
      }
      if (commandRef.current?.(command)) event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const handleListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (isEditingTarget(event.target)) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveSelection(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Escape" && selectedId) {
      event.preventDefault();
      select(undefined);
    }
  };

  const submitterName = (id: string) => {
    if (id === "me") return t("intake:filters.me");
    const member = workspaceUsers?.members?.find(
      (candidate) => candidate.userId === id,
    );
    return member?.user?.name ?? id;
  };

  const emptyKind = intakeEmptyKind({ filters, counts, canReadAll });

  const detail = selectedId ? (
    <IntakeDetail
      key={selectedId}
      itemId={selectedId}
      workspaceId={workspaceId}
      onChanged={handleChanged}
      onDeleted={(item) => selectAfterRemoval(item.id)}
      onBack={() => select(undefined)}
      onPrevious={previousId ? () => select(previousId) : undefined}
      onNext={nextId ? () => select(nextId) : undefined}
      onClose={() => select(undefined)}
      commandRef={commandRef}
    />
  ) : null;

  const keyHints = canTriage && items.length > 0 && (
    <div className="hidden shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-border/80 border-t px-3 py-1.5 text-muted-foreground text-xs md:flex">
      <span className="inline-flex items-center gap-1">
        <Kbd>J</Kbd>
        <Kbd>K</Kbd>
        {t("intake:triage.hintMove")}
      </span>
      <span className="inline-flex items-center gap-1">
        <Kbd>A</Kbd>
        {t("intake:actions.accept")}
      </span>
      <span className="inline-flex items-center gap-1">
        <Kbd>D</Kbd>
        {t("intake:actions.decline")}
      </span>
      <span className="inline-flex items-center gap-1">
        <Kbd>S</Kbd>
        {t("intake:actions.snooze")}
      </span>
      <span className="inline-flex items-center gap-1">
        <Kbd>U</Kbd>
        {t("intake:triage.hintDuplicate")}
      </span>
      <span className="inline-flex items-center gap-1">
        <Kbd>↵</Kbd>
        {t("intake:triage.hintOpen")}
      </span>
    </div>
  );

  const listPane = (
    <div className="flex min-h-0 w-full flex-1 flex-col bg-card">
      <IntakeListToolbar
        workspaceId={workspaceId}
        filters={filters}
        counts={counts}
        canReadAll={canReadAll}
        submitterName={submitterName}
        onTabChange={setTab}
        onChange={setFilters}
        onClearFilters={clearFilters}
      />
      {/* biome-ignore lint/a11y/noStaticElementInteractions: arrow-key navigation of the list inside */}
      <div
        className="flex min-h-0 flex-1 flex-col"
        onKeyDown={handleListKeyDown}
      >
        <IntakeList
          items={items}
          selectedId={selectedId}
          isLoading={list.isLoading}
          isError={list.isError}
          hasNextPage={Boolean(list.hasNextPage)}
          isFetchingNextPage={list.isFetchingNextPage}
          onLoadMore={() => {
            if (!list.isFetchingNextPage) void list.fetchNextPage();
          }}
          onRetry={() => void list.refetch()}
          onSelect={(item) => select(item.id)}
          empty={
            <IntakeEmptyState
              variant={emptyKind}
              onCreate={onCreate}
              onClearFilters={clearFilters}
            />
          }
        />
      </div>
      {keyHints}
    </div>
  );

  if (!isMobile) {
    return (
      <div className="flex h-full min-h-0">
        <SplitView
          primaryWidth="md"
          showSecondary={Boolean(selectedId)}
          primaryLabel={t("intake:triage.queueLabel")}
          secondaryLabel={t("intake:triage.detailLabel")}
          primary={listPane}
          secondary={
            detail ?? (
              <IntakeEmptyState variant="selectPrompt" className="h-full" />
            )
          }
        />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      {listPane}
      <Sheet
        open={Boolean(selectedId)}
        onOpenChange={(open) => !open && select(undefined)}
      >
        <SheetContent
          side="right"
          showCloseButton={false}
          className="w-full max-w-full gap-0 p-0 sm:max-w-xl"
        >
          {detail}
        </SheetContent>
      </Sheet>
    </div>
  );
}
