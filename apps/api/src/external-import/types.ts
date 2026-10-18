import { createHash } from "node:crypto";
import { parseJiraDate } from "../jira-import/dates";

// What every importer reads its export into. Text is Markdown by then; the
// shared pipeline (plan → write) is source-agnostic from here on.

export const EXTERNAL_SOURCES = ["trello", "linear", "asana"] as const;
export type ExternalSource = (typeof EXTERNAL_SOURCES)[number];

export const SOURCE_LABELS: Record<ExternalSource, string> = {
  trello: "Trello",
  linear: "Linear",
  asana: "Asana",
};

export type ExternalComment = {
  /** Stable across exports of the same comment: dedups re-imports. */
  hash: string;
  createdAt: Date | null;
  author: string;
  body: string;
};

export type ExternalChecklist = {
  name: string;
  items: Array<{ name: string; done: boolean }>;
};

export type ExternalItem = {
  /** 1-based CSV row, or the card's position in a Trello export. */
  line: number;
  /** The source's own id (card short link, issue identifier, task id). */
  key: string;
  title: string;
  /** Markdown. */
  description: string;
  status: string;
  /** A workflow state type when the export has one (done, started…). */
  statusCategory: string;
  priority: string;
  /** People as the export writes them: emails or display names. */
  assignees: string[];
  creator: string;
  labels: string[];
  dueDate: Date | null;
  startDate: Date | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  completedAt: Date | null;
  /** The parent item's key, when it is in the same file. */
  parentKey: string;
  /** Keys of items in the file this one blocks. */
  blocks: string[];
  related: string[];
  comments: ExternalComment[];
  checklists: ExternalChecklist[];
  /** Unreadable date values, by column name. */
  badDates: string[];
};

export type ParsedExport = {
  items: ExternalItem[];
  /** Columns (CSV) or sections (Trello) read, with how often each repeats. */
  columns: Array<{ name: string; count: number }>;
  /** Cards or rows left out on purpose, e.g. archived ones. */
  skipped: Array<{ message: string; count: number }>;
};

export function commentHash(parts: readonly string[]) {
  return createHash("sha256")
    .update(parts.join("\n"))
    .digest("hex")
    .slice(0, 32);
}

/**
 * ISO 8601 (with or without a time or offset), Jira-style day/month names,
 * and JavaScript's Date#toString form ("Mon Jan 15 2024 10:00:00 GMT+0000
 * (Coordinated Universal Time)") that some CSV exports write.
 */
export function parseExportDate(raw: string, timeZone: string): Date | null {
  const value = raw.trim();
  if (!value) return null;
  const parsed = parseJiraDate(value, timeZone);
  if (parsed) return parsed.date;
  const jsForm =
    /^[A-Za-z]{3} [A-Za-z]{3} \d{1,2} \d{4} \d{2}:\d{2}:\d{2} GMT[+-]\d{4}/.exec(
      value,
    );
  if (jsForm) {
    const time = Date.parse(jsForm[0]);
    return Number.isNaN(time) ? null : new Date(time);
  }
  return null;
}

/** "a, b , c" → ["a", "b", "c"]. */
export function splitList(value: string, separator: RegExp = /,/): string[] {
  return value
    .split(separator)
    .map((part) => part.trim())
    .filter(Boolean);
}
