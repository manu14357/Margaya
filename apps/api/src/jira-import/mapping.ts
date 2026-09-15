import type { ColumnGroup } from "../column/groups";

// Suggested matches shown in the mapping step. The import uses the user's
// final choices and falls back to these for values left unmapped.

export const PLANNED = "planned";

export type ImportColumn = { slug: string; name: string; group: ColumnGroup };

function normalize(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Jira status categories → the column groups that fit them, best first. */
const CATEGORY_GROUPS: Record<string, ColumnGroup[]> = {
  "to do": ["unstarted", "backlog"],
  new: ["unstarted", "backlog"],
  "in progress": ["started"],
  indeterminate: ["started"],
  done: ["completed"],
  complete: ["completed"],
};

/** Common status names whose category the export may leave out. */
const STATUS_GROUPS: Record<string, ColumnGroup[]> = {
  backlog: ["backlog", "unstarted"],
  open: ["unstarted", "backlog"],
  reopened: ["unstarted"],
  selected: ["unstarted"],
  "selected for development": ["unstarted"],
  "to do": ["unstarted", "backlog"],
  todo: ["unstarted", "backlog"],
  "in progress": ["started"],
  "in review": ["started"],
  "code review": ["started"],
  review: ["started"],
  testing: ["started"],
  qa: ["started"],
  blocked: ["started"],
  resolved: ["completed"],
  closed: ["completed"],
  done: ["completed"],
  "won't do": ["cancelled", "completed"],
  "won't fix": ["cancelled", "completed"],
  cancelled: ["cancelled", "completed"],
  canceled: ["cancelled", "completed"],
  rejected: ["cancelled", "completed"],
};

/**
 * The column a Jira status should land in: a column with the same name,
 * else the first column of the group its category (or a well-known status
 * name) suggests, else the planned backlog.
 */
export function suggestStatus(
  status: string,
  category: string,
  columns: readonly ImportColumn[],
): string {
  const name = normalize(status);
  const byName = columns.find((column) => normalize(column.name) === name);
  if (byName) return byName.slug;
  const bySlug = columns.find((column) => column.slug === name);
  if (bySlug) return bySlug.slug;
  const groups =
    STATUS_GROUPS[name] ?? CATEGORY_GROUPS[normalize(category)] ?? [];
  for (const group of groups) {
    const column = columns.find((candidate) => candidate.group === group);
    if (column) return column.slug;
  }
  return PLANNED;
}

export const MARGAYA_PRIORITIES = [
  "no-priority",
  "low",
  "medium",
  "high",
  "urgent",
] as const;
export type MargayaPriority = (typeof MARGAYA_PRIORITIES)[number];

const PRIORITY_NAMES: Record<string, MargayaPriority> = {
  highest: "urgent",
  blocker: "urgent",
  critical: "urgent",
  urgent: "urgent",
  high: "high",
  major: "high",
  medium: "medium",
  normal: "medium",
  low: "low",
  minor: "low",
  lowest: "low",
  trivial: "low",
};

export function suggestPriority(priority: string): MargayaPriority {
  return PRIORITY_NAMES[normalize(priority)] ?? "no-priority";
}

export type ImportMember = { id: string; name: string; email: string };

/**
 * Finds the member a Jira person value names: an email matches the member's
 * email, anything else a unique member name; both are case-insensitive.
 * Ambiguous names stay unmatched rather than guessing.
 */
export function createMemberMatcher(members: readonly ImportMember[]) {
  const byEmail = new Map<string, ImportMember>();
  const byName = new Map<string, ImportMember | null>();
  for (const member of members) {
    if (member.email) byEmail.set(normalize(member.email), member);
    const name = normalize(member.name);
    if (!name) continue;
    byName.set(name, byName.has(name) ? null : member);
  }
  return (value: string): ImportMember | null => {
    const key = normalize(value);
    if (!key) return null;
    const email = byEmail.get(key);
    if (email) return email;
    const named = byName.get(key);
    if (named) return named;
    // "Ada Lovelace <ada@example.com>" style values.
    const embedded = /<([^>]+@[^>]+)>/.exec(value)?.[1];
    return embedded ? (byEmail.get(normalize(embedded)) ?? null) : null;
  };
}
