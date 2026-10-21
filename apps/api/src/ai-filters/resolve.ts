import { DATE_PRESETS, DATE_UNITS } from "../task-query/dates";
import {
  type FilterCondition,
  type FilterGroup,
  MAX_CONDITION_VALUES,
  MAX_GROUP_CHILDREN,
} from "../task-query/schema";
import { DATE_OPERATORS, validateFilterTree } from "../task-query/validate";

// Natural-language filters, the pure half: the model answers with
// conditions over references from a vocabulary (S1 for a status, L2 for a
// label, P3 for a person…), and this maps them back to the ids the task
// query engine runs on. Anything unknown is dropped and reported, never
// guessed; the result always passes the engine's own validation.

export const NL_SET_KEYS = [
  "status",
  "group",
  "priority",
  "assignee",
  "createdBy",
  "label",
  "cycle",
  "module",
  "project",
] as const;
export const NL_DATE_KEYS = [
  "dueDate",
  "startDate",
  "createdAt",
  "updatedAt",
  "completedAt",
] as const;

type SetKey = (typeof NL_SET_KEYS)[number];

export type VocabularyEntry = { ref: string; id: string; name: string };

/** What the person can filter on in this scope, by reference. */
export type FilterVocabulary = {
  /** Keys the scope supports (status and module need one project). */
  keys: ReadonlySet<string>;
  statuses: VocabularyEntry[];
  labels: VocabularyEntry[];
  people: VocabularyEntry[];
  cycles: VocabularyEntry[];
  modules: VocabularyEntry[];
  projects: VocabularyEntry[];
};

const LITERAL_VALUES: Partial<Record<SetKey, readonly string[]>> = {
  group: ["backlog", "unstarted", "started", "completed", "cancelled"],
  priority: ["no-priority", "low", "medium", "high", "urgent"],
};

const TOKENS: Partial<Record<SetKey, readonly string[]>> = {
  status: ["planned", "none"],
  assignee: ["me", "none"],
  createdBy: ["me"],
  label: ["none"],
  cycle: ["current", "none"],
  module: ["none"],
};

function entriesFor(
  key: SetKey,
  vocabulary: FilterVocabulary,
): VocabularyEntry[] {
  switch (key) {
    case "status":
      return vocabulary.statuses;
    case "label":
      return vocabulary.labels;
    case "assignee":
    case "createdBy":
      return vocabulary.people;
    case "cycle":
      return vocabulary.cycles;
    case "module":
      return vocabulary.modules;
    case "project":
      return vocabulary.projects;
    default:
      return [];
  }
}

/** One value of a set key: a known reference, token or literal, else null. */
export function resolveSetValue(
  key: SetKey,
  raw: string,
  vocabulary: FilterVocabulary,
): string | null {
  const value = raw.trim();
  if (!value) return null;
  const literal = LITERAL_VALUES[key];
  if (literal) {
    const lower = value.toLowerCase();
    return literal.includes(lower) ? lower : null;
  }
  if (TOKENS[key]?.includes(value.toLowerCase())) return value.toLowerCase();
  const ref = value.toUpperCase();
  return (
    entriesFor(key, vocabulary).find((entry) => entry.ref === ref)?.id ?? null
  );
}

type Raw = Record<string, unknown>;

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function isSetKey(key: string): key is SetKey {
  return (NL_SET_KEYS as readonly string[]).includes(key);
}

function isDateKey(key: string): boolean {
  return (NL_DATE_KEYS as readonly string[]).includes(key);
}

/** A date condition with only the fields its operator takes, else null. */
function dateCondition(key: string, raw: Raw): FilterCondition | null {
  const operator = typeof raw.operator === "string" ? raw.operator : "";
  if (!(DATE_OPERATORS as readonly string[]).includes(operator)) return null;
  let condition: FilterCondition;
  if (
    operator === "on" ||
    operator === "onOrBefore" ||
    operator === "onOrAfter"
  ) {
    if (typeof raw.date !== "string") return null;
    condition = { key, operator, date: raw.date };
  } else if (operator === "between") {
    if (typeof raw.from !== "string" || typeof raw.to !== "string") return null;
    condition = { key, operator, from: raw.from, to: raw.to };
  } else if (operator === "in") {
    const values = strings(raw.values).filter((value) =>
      (DATE_PRESETS as readonly string[]).includes(value),
    );
    if (values.length === 0) return null;
    condition = { key, operator, values: [...new Set(values)] };
  } else if (operator === "empty" || operator === "notEmpty") {
    condition = { key, operator };
  } else {
    const amount = typeof raw.amount === "number" ? Math.round(raw.amount) : 0;
    const unit = (DATE_UNITS as readonly string[]).includes(String(raw.unit))
      ? (raw.unit as (typeof DATE_UNITS)[number])
      : null;
    if (!unit) return null;
    condition = { key, operator, amount, unit };
  }
  try {
    validateFilterTree(condition);
  } catch {
    return null;
  }
  return condition;
}

export type ResolvedFilter = {
  filters: FilterGroup | null;
  /** What could not be used: the model's unmatched phrases and bad parts. */
  dropped: string[];
};

/**
 * The model's answer as a flat filter group the toolbar can edit: one
 * condition per key (a repeated key with the same operator merges its
 * values), unknown keys, values and malformed dates dropped.
 */
export function resolveFilterAnswer(
  raw: unknown,
  vocabulary: FilterVocabulary,
): ResolvedFilter {
  const answer = (raw && typeof raw === "object" ? raw : {}) as Raw;
  const dropped = strings(answer.unmatched)
    .map((text) => text.replace(/\s+/g, " ").trim().slice(0, 80))
    .filter(Boolean);
  const op = answer.op === "or" ? "or" : "and";
  const byKey = new Map<string, FilterCondition>();
  const list = Array.isArray(answer.conditions) ? answer.conditions : [];

  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Raw;
    const key = typeof item.key === "string" ? item.key.trim() : "";
    if (!key) continue;
    if (!vocabulary.keys.has(key)) {
      dropped.push(key);
      continue;
    }
    if (isSetKey(key)) {
      const operator = item.operator === "notIn" ? "notIn" : "in";
      const values: string[] = [];
      for (const value of strings(item.values)) {
        const resolved = resolveSetValue(key, value, vocabulary);
        if (resolved === null) dropped.push(value.slice(0, 80));
        else if (!values.includes(resolved)) values.push(resolved);
      }
      if (values.length === 0) continue;
      const existing = byKey.get(key);
      if (existing) {
        if (existing.operator === operator && existing.values) {
          existing.values = [...new Set([...existing.values, ...values])].slice(
            0,
            MAX_CONDITION_VALUES,
          );
        }
        continue;
      }
      byKey.set(key, {
        key,
        operator,
        values: values.slice(0, MAX_CONDITION_VALUES),
      });
      continue;
    }
    if (isDateKey(key)) {
      if (byKey.has(key)) continue;
      const condition = dateCondition(key, item);
      if (condition) byKey.set(key, condition);
      else dropped.push(key);
      continue;
    }
    dropped.push(key);
  }

  const children = [...byKey.values()].slice(0, MAX_GROUP_CHILDREN);
  if (children.length === 0) return { filters: null, dropped: unique(dropped) };
  const filters: FilterGroup = { op, children };
  // The engine's own rules are the last word.
  validateFilterTree(filters);
  return { filters, dropped: unique(dropped) };
}

function unique(values: string[]): string[] {
  return [...new Set(values)].slice(0, 10);
}

/** The vocabulary as prompt lines (names are untrusted; wrap them). */
export function vocabularyLines(vocabulary: FilterVocabulary): string {
  const section = (title: string, entries: VocabularyEntry[]) =>
    entries.length
      ? `${title}:\n${entries.map((entry) => `${entry.ref}: ${entry.name}`).join("\n")}`
      : null;
  return [
    section("Statuses (key status)", vocabulary.statuses),
    section("Labels (key label)", vocabulary.labels),
    section("People (keys assignee, createdBy)", vocabulary.people),
    section("Cycles (key cycle)", vocabulary.cycles),
    section("Modules (key module)", vocabulary.modules),
    section("Projects (key project)", vocabulary.projects),
  ]
    .filter(Boolean)
    .join("\n\n");
}
