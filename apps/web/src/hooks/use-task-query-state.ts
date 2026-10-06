import { useCallback, useEffect, useMemo, useState } from "react";
import useGetLabelsByWorkspace from "@/hooks/queries/label/use-get-labels-by-workspace";
import {
  DEFAULT_DISPLAY_PROPERTIES,
  type DisplayScope,
  defaultDisplay,
  isArchivedFilter,
  isMirroredProperty,
  normalizeDisplay,
  normalizeDisplayProperties,
  PREFERENCE_FOR_PROPERTY,
  withPreferences,
} from "@/lib/task-query/display";
import {
  countConditions,
  isSameValue,
  stableHash,
} from "@/lib/task-query/filter-tree";
import {
  convertLegacyBoardFilters,
  convertLegacySort,
  type LegacyLabel,
  legacyFiltersNeedLabels,
} from "@/lib/task-query/legacy-board-filters";
import type {
  ArchivedFilter,
  DisplayPropertyKey,
  FilterNode,
  TaskDisplay,
  TaskLayout,
  TaskQueryState,
} from "@/lib/task-query/model";
import { useUserPreferencesStore } from "@/store/user-preferences";

// The filters, display and display properties of one task list, persisted
// per scope in localStorage (margaya:task-filters:v2:{scope}).
//
// - Without a baseline (the Tasks section, cycle and module pages) every
//   change is stored, display properties that have a global toggle read and
//   write it (B4 K13), and the old board filters and sort are converted once.
// - With a baseline (a saved or built-in view) only unsaved changes are
//   stored, per view, until they are saved or reset.

export const TASK_FILTERS_STORAGE_PREFIX = "margaya:task-filters:v2:";
const LEGACY_FILTERS_PREFIX = "margaya:board-filters:";
const LEGACY_SORT_PREFIX = "margaya:board-sort:";

type StoredState = TaskQueryState & { version: 2 };

type UseTaskQueryStateOptions = {
  /** The storage scope: a project id, `cycle:{id}`, `view:{id}`; null for none. */
  storageScope: string | null;
  scope: DisplayScope;
  workspaceId: string;
  /** A view's saved state; unsaved changes are kept apart from it. */
  baseline?: TaskQueryState | null;
  /** Old board storage to convert once (no baseline only). */
  legacy?: { filtersScope?: string; sortProjectId?: string };
  allowedLayouts?: readonly TaskLayout[];
  /** Read the stored state without ever writing it (a peek from elsewhere). */
  readOnly?: boolean;
};

export function defaultTaskQueryState(scope: DisplayScope): TaskQueryState {
  return {
    filters: null,
    archived: "exclude",
    display: defaultDisplay(scope),
    displayProperties: { ...DEFAULT_DISPLAY_PROPERTIES, customFields: [] },
  };
}

function readJson(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage may be unavailable or full; the state keeps working in memory.
  }
}

function removeKey(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Best effort, like writes.
  }
}

function isFilterNodeLike(value: unknown): value is FilterNode {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** A stored state with every part normalized, or null when absent. */
export function normalizeStoredState(
  raw: unknown,
  scope: DisplayScope,
  allowedLayouts?: readonly TaskLayout[],
): TaskQueryState | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as Record<string, unknown>;
  if (candidate.version !== 2) return null;
  return {
    filters: isFilterNodeLike(candidate.filters) ? candidate.filters : null,
    archived: isArchivedFilter(candidate.archived)
      ? candidate.archived
      : "exclude",
    display: normalizeDisplay(candidate.display, scope, allowedLayouts),
    displayProperties: normalizeDisplayProperties(candidate.displayProperties),
  };
}

type Loaded = {
  key: string;
  value: TaskQueryState;
  /** Old label filters waiting for the workspace labels to convert. */
  pendingLegacyFilters: unknown;
  /** Saved as the view's content: nothing to store until it reloads. */
  committed?: boolean;
};

function load(
  storageScope: string | null,
  options: UseTaskQueryStateOptions,
  fallback: TaskQueryState,
): Omit<Loaded, "key"> {
  if (!storageScope || typeof window === "undefined") {
    return { value: fallback, pendingLegacyFilters: null };
  }
  const stored = normalizeStoredState(
    readJson(`${TASK_FILTERS_STORAGE_PREFIX}${storageScope}`),
    options.scope,
    options.allowedLayouts,
  );
  if (stored) return { value: stored, pendingLegacyFilters: null };
  if (options.baseline || !options.legacy) {
    return { value: fallback, pendingLegacyFilters: null };
  }

  const { filtersScope, sortProjectId } = options.legacy;
  const legacySort = sortProjectId
    ? convertLegacySort(readJson(`${LEGACY_SORT_PREFIX}${sortProjectId}`))
    : null;
  const legacyFilters = filtersScope
    ? readJson(`${LEGACY_FILTERS_PREFIX}${filtersScope}`)
    : null;
  const value: TaskQueryState = {
    ...fallback,
    display: legacySort
      ? { ...fallback.display, orderBy: legacySort }
      : fallback.display,
  };
  if (legacyFiltersNeedLabels(legacyFilters)) {
    return { value, pendingLegacyFilters: legacyFilters };
  }
  return {
    value: { ...value, filters: convertLegacyBoardFilters(legacyFilters) },
    pendingLegacyFilters: null,
  };
}

export function useTaskQueryState(options: UseTaskQueryStateOptions) {
  const { storageScope, scope, workspaceId, baseline, readOnly } = options;
  const fallback = useMemo(
    () => baseline ?? defaultTaskQueryState(scope),
    [baseline, scope],
  );
  const loadKey = `${storageScope ?? ""}|${stableHash(baseline ?? null)}`;
  const [loaded, setLoaded] = useState<Loaded>(() => ({
    key: loadKey,
    ...load(storageScope, options, fallback),
  }));
  let current = loaded;
  if (loaded.key !== loadKey) {
    current = { key: loadKey, ...load(storageScope, options, fallback) };
    setLoaded(current);
  }
  const state = current.value;
  const pendingLegacyFilters = current.pendingLegacyFilters;
  const committed = Boolean(current.committed);

  // Old label filters stored label row ids: convert once labels load.
  const { data: workspaceLabels } = useGetLabelsByWorkspace(
    pendingLegacyFilters ? workspaceId : "",
  );
  useEffect(() => {
    if (!pendingLegacyFilters || !workspaceLabels) return;
    setLoaded((previous) =>
      previous.pendingLegacyFilters
        ? {
            ...previous,
            value: {
              ...previous.value,
              filters: convertLegacyBoardFilters(
                previous.pendingLegacyFilters,
                workspaceLabels as LegacyLabel[],
              ),
            },
            pendingLegacyFilters: null,
          }
        : previous,
    );
  }, [pendingLegacyFilters, workspaceLabels]);

  const isDirty = !committed && !isSameValue(state, fallback);

  useEffect(() => {
    if (!storageScope || readOnly || pendingLegacyFilters || committed) return;
    const key = `${TASK_FILTERS_STORAGE_PREFIX}${storageScope}`;
    if (baseline && !isDirty) {
      removeKey(key);
      return;
    }
    const stored: StoredState = { version: 2, ...state };
    writeJson(key, stored);
  }, [
    storageScope,
    readOnly,
    pendingLegacyFilters,
    committed,
    baseline,
    isDirty,
    state,
  ]);

  const update = useCallback(
    (updater: (previous: TaskQueryState) => TaskQueryState) => {
      setLoaded((previous) => ({
        ...previous,
        value: updater(previous.value),
        pendingLegacyFilters: null,
        committed: false,
      }));
    },
    [],
  );

  // Surfaces without a view mirror some properties to the global toggles.
  const preferences = useUserPreferencesStore();
  const usesPreferences = !baseline;
  const displayProperties = useMemo(
    () =>
      usesPreferences
        ? withPreferences(state.displayProperties, preferences)
        : state.displayProperties,
    [usesPreferences, state.displayProperties, preferences],
  );

  const setFilters = useCallback(
    (
      next:
        | FilterNode
        | null
        | ((previous: FilterNode | null) => FilterNode | null),
    ) =>
      update((previous) => ({
        ...previous,
        filters: typeof next === "function" ? next(previous.filters) : next,
      })),
    [update],
  );

  const setArchived = useCallback(
    (archived: ArchivedFilter) =>
      update((previous) => ({ ...previous, archived })),
    [update],
  );

  const updateDisplay = useCallback(
    (patch: Partial<TaskDisplay>) =>
      update((previous) => {
        const display = { ...previous.display, ...patch };
        if (!display.groupBy || display.subGroupBy === display.groupBy) {
          display.subGroupBy = null;
        }
        return { ...previous, display };
      }),
    [update],
  );

  const setDisplayProperty = useCallback(
    (key: DisplayPropertyKey, value: boolean) => {
      if (usesPreferences && isMirroredProperty(key)) {
        useUserPreferencesStore.setState({
          [PREFERENCE_FOR_PROPERTY[key]]: value,
        });
        return;
      }
      update((previous) => ({
        ...previous,
        displayProperties: { ...previous.displayProperties, [key]: value },
      }));
    },
    [update, usesPreferences],
  );

  const setCustomFieldColumns = useCallback(
    (customFields: string[]) =>
      update((previous) => ({
        ...previous,
        displayProperties: { ...previous.displayProperties, customFields },
      })),
    [update],
  );

  const replaceState = useCallback(
    (next: TaskQueryState) => update(() => next),
    [update],
  );

  const reset = useCallback(() => update(() => fallback), [update, fallback]);

  /** The state was saved (as the view's new content): nothing is unsaved. */
  const commit = useCallback(
    (saved: TaskQueryState) => {
      if (storageScope) {
        removeKey(`${TASK_FILTERS_STORAGE_PREFIX}${storageScope}`);
      }
      setLoaded((previous) => ({
        ...previous,
        value: saved,
        pendingLegacyFilters: null,
        committed: true,
      }));
    },
    [storageScope],
  );

  const clearFilters = useCallback(
    () =>
      update((previous) => ({
        ...previous,
        filters: null,
        archived: "exclude",
      })),
    [update],
  );

  const effective: TaskQueryState = useMemo(
    () => ({ ...state, displayProperties }),
    [state, displayProperties],
  );

  return {
    state: effective,
    filters: state.filters,
    archived: state.archived,
    display: state.display,
    displayProperties,
    setFilters,
    setArchived,
    updateDisplay,
    setDisplayProperty,
    setCustomFieldColumns,
    replaceState,
    reset,
    commit,
    clearFilters,
    isDirty,
    conditionCount: countConditions(state.filters),
    hasActiveFilters:
      countConditions(state.filters) > 0 || state.archived !== "exclude",
    isConverting: Boolean(pendingLegacyFilters),
  };
}

export type TaskQueryStateHandle = ReturnType<typeof useTaskQueryState>;

export default useTaskQueryState;
