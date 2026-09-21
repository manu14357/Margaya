// Webhook subscriptions are patterns: "*" (every event, including future
// ones), "<family>.*" (a whole family) or exact event names. The picker edits
// a selection; these helpers convert between the two shapes.

export const ALL_EVENTS_PATTERN = "*";

export type CatalogLike = {
  families: { key: string; events: { name: string }[] }[];
};

/** "all" stores family.*; a set stores hand-picked event names. */
export type FamilySelection = "all" | ReadonlySet<string>;

export type EventSelection = {
  mode: "all" | "custom";
  families: ReadonlyMap<string, FamilySelection>;
  /** Patterns the catalog does not know; kept so a save never drops them. */
  unknown: readonly string[];
};

export type FamilyState = "checked" | "indeterminate" | "unchecked";

const familyPattern = (family: string) => `${family}.*`;

function sortedUnique(values: Iterable<string>) {
  return [...new Set(values)].sort();
}

export function selectionFromPatterns(
  patterns: readonly string[],
  catalog: CatalogLike,
): EventSelection {
  if (patterns.includes(ALL_EVENTS_PATTERN)) {
    return { mode: "all", families: new Map(), unknown: [] };
  }

  const families = new Map<string, FamilySelection>();
  const unknown: string[] = [];
  const familyOfEvent = new Map<string, string>();
  for (const family of catalog.families) {
    for (const event of family.events)
      familyOfEvent.set(event.name, family.key);
  }
  const familyKeys = new Set(catalog.families.map((family) => family.key));

  for (const pattern of patterns) {
    if (pattern.endsWith(".*") && familyKeys.has(pattern.slice(0, -2))) {
      families.set(pattern.slice(0, -2), "all");
      continue;
    }
    const family = familyOfEvent.get(pattern);
    if (!family) {
      unknown.push(pattern);
      continue;
    }
    const current = families.get(family);
    if (current === "all") continue;
    families.set(family, new Set([...(current ?? []), pattern]));
  }

  return { mode: "custom", families, unknown: sortedUnique(unknown) };
}

/**
 * The patterns a selection saves: a fully checked family collapses to
 * family.*, and every family checked collapses to "*".
 */
export function patternsFromSelection(
  selection: EventSelection,
  catalog: CatalogLike,
): string[] {
  if (selection.mode === "all") return [ALL_EVENTS_PATTERN];

  const patterns: string[] = [];
  let everyFamilyFull = catalog.families.length > 0;
  for (const family of catalog.families) {
    const state = familyState(selection, family);
    if (state === "checked") {
      patterns.push(familyPattern(family.key));
      continue;
    }
    everyFamilyFull = false;
    const picked = selection.families.get(family.key);
    if (picked && picked !== "all") patterns.push(...picked);
  }
  if (everyFamilyFull) return [ALL_EVENTS_PATTERN];

  return sortedUnique([...patterns, ...selection.unknown]);
}

/** A custom selection with every family fully checked (what "*" shows). */
export function allFamiliesSelection(catalog: CatalogLike): EventSelection {
  return {
    mode: "custom",
    families: new Map(
      catalog.families.map((family) => [family.key, "all" as const]),
    ),
    unknown: [],
  };
}

export function familyState(
  selection: EventSelection,
  family: CatalogLike["families"][number],
): FamilyState {
  if (selection.mode === "all") return "checked";
  const picked = selection.families.get(family.key);
  if (!picked) return "unchecked";
  if (picked === "all") return "checked";
  const count = family.events.filter((event) => picked.has(event.name)).length;
  if (count === 0) return "unchecked";
  return count === family.events.length ? "checked" : "indeterminate";
}

export function isEventSelected(
  selection: EventSelection,
  familyKey: string,
  eventName: string,
) {
  if (selection.mode === "all") return true;
  const picked = selection.families.get(familyKey);
  return picked === "all" || Boolean(picked?.has(eventName));
}

export function toggleFamily(
  selection: EventSelection,
  familyKey: string,
  checked: boolean,
): EventSelection {
  const families = new Map(selection.families);
  if (checked) families.set(familyKey, "all");
  else families.delete(familyKey);
  return { ...selection, mode: "custom", families };
}

export function toggleEvent(
  selection: EventSelection,
  family: CatalogLike["families"][number],
  eventName: string,
  checked: boolean,
): EventSelection {
  const families = new Map(selection.families);
  const current = families.get(family.key);
  const names = new Set(
    current === "all" || selection.mode === "all"
      ? family.events.map((event) => event.name)
      : (current ?? []),
  );
  if (checked) names.add(eventName);
  else names.delete(eventName);

  if (names.size === 0) families.delete(family.key);
  else if (names.size === family.events.length) families.set(family.key, "all");
  else families.set(family.key, names);
  return { ...selection, mode: "custom", families };
}

/** Whether a custom selection subscribes to anything at all. */
export function hasAnySelection(selection: EventSelection) {
  return (
    selection.mode === "all" ||
    selection.families.size > 0 ||
    selection.unknown.length > 0
  );
}

export type PatternsDescription =
  | { kind: "all" }
  | { kind: "count"; count: number };

/**
 * "All events" or how many events the patterns cover. Without the catalog,
 * each pattern counts as one.
 */
export function describePatterns(
  patterns: readonly string[],
  catalog?: CatalogLike,
): PatternsDescription {
  if (patterns.includes(ALL_EVENTS_PATTERN)) return { kind: "all" };
  if (!catalog) return { kind: "count", count: patterns.length };

  const matched = new Set<string>();
  let unknown = 0;
  for (const pattern of patterns) {
    let found = false;
    for (const family of catalog.families) {
      if (pattern === familyPattern(family.key)) {
        for (const event of family.events) matched.add(event.name);
        found = true;
      } else if (family.events.some((event) => event.name === pattern)) {
        matched.add(pattern);
        found = true;
      }
    }
    if (!found) unknown += 1;
  }
  return { kind: "count", count: matched.size + unknown };
}

/** Patterns as the server stores them, for change detection. */
export function samePatterns(a: readonly string[], b: readonly string[]) {
  const left = sortedUnique(a);
  const right = sortedUnique(b);
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}
