import type { TaskToImport } from "@/fetchers/task/import-tasks";
import {
  type ImportDateFormat,
  parseImportDate,
  resolveDateOrder,
} from "./csv-dates";
import { isBlankRecord } from "./csv-parse";

export const IMPORT_FIELDS = [
  "title",
  "description",
  "status",
  "priority",
  "assignees",
  "labels",
  "startDate",
  "dueDate",
  "estimate",
  "cycle",
  "modules",
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

/** Fields shown only while the project has the matching feature on. */
export const FEATURE_FIELDS = {
  estimate: "estimates",
  cycle: "cycles",
  modules: "modules",
} as const satisfies Partial<Record<ImportField, string>>;

/** The CSV column index each field reads, or null for "Don't import". */
export type ColumnMapping = Record<ImportField, number | null>;

// Normalized header names, most specific first.
const HEADER_SYNONYMS: Record<ImportField, readonly string[]> = {
  title: ["title", "name", "summary", "task", "subject"],
  description: ["description", "details", "body", "notes"],
  status: ["status", "state", "column", "list"],
  priority: ["priority"],
  assignees: [
    "assignee emails",
    "assignees",
    "assignee",
    "owner",
    "assigned to",
  ],
  labels: ["labels", "label", "tags"],
  startDate: ["start date", "start"],
  dueDate: ["due date", "due", "deadline", "target date"],
  estimate: ["estimate", "points", "story points"],
  cycle: ["cycle", "sprint", "iteration"],
  modules: ["modules", "module", "epic", "component"],
};

const PRIORITIES = ["urgent", "high", "medium", "low", "no-priority"];

/** Lower case, punctuation as spaces, collapsed whitespace. */
export function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function emptyMapping(): ColumnMapping {
  return Object.fromEntries(
    IMPORT_FIELDS.map((field) => [field, null]),
  ) as ColumnMapping;
}

/** Maps each field to the first column with an accepted header name. */
export function autoMap(
  headers: readonly string[],
  fields: readonly ImportField[] = IMPORT_FIELDS,
): ColumnMapping {
  const mapping = emptyMapping();
  const normalized = headers.map(normalizeHeader);
  const taken = new Set<number>();

  for (const field of fields) {
    for (const synonym of HEADER_SYNONYMS[field]) {
      const column = normalized.findIndex(
        (header, index) => header === synonym && !taken.has(index),
      );
      if (column !== -1) {
        mapping[field] = column;
        taken.add(column);
        break;
      }
    }
  }

  return mapping;
}

export type ImportMember = { id: string; name: string; email: string };

export type ImportContext = {
  /** The project's columns (triage excluded). */
  columns: ReadonlyArray<{ slug: string; name: string }>;
  members: readonly ImportMember[];
  /** Workspace labels, to tell new names from known ones. */
  labels: ReadonlyArray<{ name: string }>;
  /** Cycles that still take tasks. */
  cycles: ReadonlyArray<{ id: string; name: string }>;
  /** Active modules. */
  modules: ReadonlyArray<{ id: string; name: string }>;
  /** Points of the active estimate system (empty when there is none). */
  estimatePoints: ReadonlyArray<{ id: string; value: string }>;
  dateFormat: ImportDateFormat;
};

export type UnmatchedField =
  | "status"
  | "assignees"
  | "cycle"
  | "modules"
  | "estimate"
  | "dates";

export type ResolvedTask = { row: number; task: TaskToImport };

export type ResolveResult = {
  tasks: ResolvedTask[];
  /** Row numbers of non-blank rows without a title. */
  skipped: number[];
  /** Distinct values per field that will be dropped or land in the backlog. */
  unmatched: Record<UnmatchedField, string[]>;
  /** Distinct label names no workspace label has yet. */
  newLabels: string[];
};

const key = (value: string) => value.trim().toLowerCase();

/** Splits a list cell on any of `separators`, trimmed, blanks removed. */
export function splitList(value: string, separators: RegExp): string[] {
  return value
    .split(separators)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Distinct values, keeping the first spelling of each case-insensitive key. */
class DistinctValues {
  private readonly byKey = new Map<string, string>();
  add(value: string) {
    const id = key(value);
    if (!this.byKey.has(id)) this.byKey.set(id, value.trim());
  }
  list() {
    return [...this.byKey.values()];
  }
}

function normalizePriority(value: string): string | undefined {
  const normalized = key(value).replace(/[\s_]+/g, "-");
  if (normalized === "" || normalized === "none") return "no-priority";
  if (PRIORITIES.includes(normalized)) return normalized;
  // Unknown values are sent as typed; the server reports them per task.
  return value.trim();
}

function memberResolver(members: readonly ImportMember[]) {
  const byEmail = new Map<string, string>();
  const byName = new Map<string, string[]>();
  for (const member of members) {
    if (member.email) byEmail.set(key(member.email), member.id);
    if (member.name) {
      const ids = byName.get(key(member.name)) ?? [];
      ids.push(member.id);
      byName.set(key(member.name), ids);
    }
  }
  // Email first, then an exact name shared by no other member.
  return (value: string): string | null => {
    const byMail = byEmail.get(key(value));
    if (byMail) return byMail;
    const named = byName.get(key(value));
    return named?.length === 1 ? (named[0] ?? null) : null;
  };
}

function lookupByName(items: ReadonlyArray<{ id: string; name: string }>) {
  const map = new Map<string, string>();
  for (const item of items) {
    if (!map.has(key(item.name))) map.set(key(item.name), item.id);
  }
  return (value: string) => map.get(key(value)) ?? null;
}

function estimateResolver(
  points: ReadonlyArray<{ id: string; value: string }>,
) {
  return (value: string): string | null => {
    const exact = points.find((point) => key(point.value) === key(value));
    if (exact) return exact.id;
    const number = Number(value.trim());
    if (value.trim() === "" || Number.isNaN(number)) return null;
    return (
      points.find(
        (point) => point.value.trim() !== "" && Number(point.value) === number,
      )?.id ?? null
    );
  };
}

/**
 * Turns mapped CSV rows into import tasks, resolving names to ids against
 * data the browser already has. Blank rows are ignored; rows without a title
 * are skipped and reported by row number.
 */
export function resolveRows(
  rows: readonly (readonly string[])[],
  mapping: ColumnMapping,
  context: ImportContext,
  firstRowNumber = 2,
): ResolveResult {
  const cell = (row: readonly string[], field: ImportField) => {
    const column = mapping[field];
    return column === null ? "" : (row[column] ?? "").trim();
  };

  const statusKeys = new Set(["planned", "archived"]);
  const statusNames = new Set<string>();
  for (const column of context.columns) {
    statusKeys.add(column.slug);
    statusNames.add(key(column.name));
  }
  const resolveMember = memberResolver(context.members);
  const resolveCycle = lookupByName(context.cycles);
  const resolveModule = lookupByName(context.modules);
  const resolveEstimate = estimateResolver(context.estimatePoints);
  const knownLabels = new Set(context.labels.map((label) => key(label.name)));

  const dateOrder = resolveDateOrder(
    context.dateFormat,
    rows.flatMap((row) => [cell(row, "startDate"), cell(row, "dueDate")]),
  );

  const tasks: ResolvedTask[] = [];
  const skipped: number[] = [];
  const unmatched = {
    status: new DistinctValues(),
    assignees: new DistinctValues(),
    cycle: new DistinctValues(),
    modules: new DistinctValues(),
    estimate: new DistinctValues(),
    dates: new DistinctValues(),
  } satisfies Record<UnmatchedField, DistinctValues>;
  const newLabels = new DistinctValues();

  rows.forEach((row, index) => {
    const rowNumber = firstRowNumber + index;
    if (isBlankRecord(row)) return;
    const title = cell(row, "title");
    if (!title) {
      skipped.push(rowNumber);
      return;
    }

    const status = cell(row, "status");
    if (status && !statusKeys.has(status) && !statusNames.has(key(status))) {
      unmatched.status.add(status);
    }
    const task: TaskToImport = { title, status: status || "planned" };

    const description = cell(row, "description");
    if (description) task.description = description;

    if (mapping.priority !== null) {
      task.priority = normalizePriority(cell(row, "priority"));
    }

    const assigneeIds: string[] = [];
    for (const person of splitList(cell(row, "assignees"), /[,;]/)) {
      const id = resolveMember(person);
      if (!id) unmatched.assignees.add(person);
      else if (!assigneeIds.includes(id)) assigneeIds.push(id);
    }
    if (assigneeIds.length > 0) task.assigneeIds = assigneeIds;

    const labelNames = new DistinctValues();
    for (const name of splitList(cell(row, "labels"), /,/)) {
      labelNames.add(name);
      if (!knownLabels.has(key(name))) newLabels.add(name);
    }
    if (labelNames.list().length > 0) task.labels = labelNames.list();

    for (const field of ["startDate", "dueDate"] as const) {
      const value = cell(row, field);
      if (!value) continue;
      const date = parseImportDate(value, dateOrder);
      if (date) task[field] = date;
      else unmatched.dates.add(value);
    }

    const estimate = cell(row, "estimate");
    if (estimate) {
      const pointId = resolveEstimate(estimate);
      if (pointId) task.estimatePointId = pointId;
      else unmatched.estimate.add(estimate);
    }

    const cycle = cell(row, "cycle");
    if (cycle) {
      const cycleId = resolveCycle(cycle);
      if (cycleId) task.cycleId = cycleId;
      else unmatched.cycle.add(cycle);
    }

    const moduleIds: string[] = [];
    for (const name of splitList(cell(row, "modules"), /,/)) {
      const moduleId = resolveModule(name);
      if (!moduleId) unmatched.modules.add(name);
      else if (!moduleIds.includes(moduleId)) moduleIds.push(moduleId);
    }
    if (moduleIds.length > 0) task.moduleIds = moduleIds;

    tasks.push({ row: rowNumber, task });
  });

  return {
    tasks,
    skipped,
    unmatched: {
      status: unmatched.status.list(),
      assignees: unmatched.assignees.list(),
      cycle: unmatched.cycle.list(),
      modules: unmatched.modules.list(),
      estimate: unmatched.estimate.list(),
      dates: unmatched.dates.list(),
    },
    newLabels: newLabels.list(),
  };
}
