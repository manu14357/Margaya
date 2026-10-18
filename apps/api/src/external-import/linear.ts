import { type CsvReadError, readCsvTable } from "./csv-table";
import {
  type ExternalItem,
  type ParsedExport,
  parseExportDate,
  splitList,
} from "./types";

// Linear's CSV export (Settings → Import / Export → Export CSV): one row per
// issue with its identifier (ENG-12), title, Markdown description, status,
// priority, people, labels, dates and parent. Comments aren't exported.

const REQUIRED = ["ID", "Title", "Status"] as const;

const ISSUE_LIST = /[\s,]+/;

export function readLinearCsv(
  content: string,
  timeZone: string,
): { ok: true; parsed: ParsedExport } | { ok: false; error: CsvReadError } {
  const read = readCsvTable(content, REQUIRED);
  if (!read.ok) return read;
  const { columns, rows } = read.table;

  let archived = 0;
  const items: ExternalItem[] = [];
  // "Blocked by" names the blockers: recorded on them once all rows exist.
  const blockedBy = new Map<string, string[]>();
  for (const { line, cells } of rows) {
    const one = (...names: string[]) => columns.one(cells, ...names);
    if (one("Archived")) {
      archived += 1;
      continue;
    }
    const badDates: string[] = [];
    const dateOf = (...names: string[]) => {
      const raw = one(...names);
      if (!raw) return null;
      const date = parseExportDate(raw, timeZone);
      if (!date) badDates.push(`${names[0]} "${raw}"`);
      return date;
    };
    const completedAt = dateOf("Completed");
    const canceledAt = dateOf("Canceled", "Cancelled");
    const startedAt = dateOf("Started");
    const assignee = one("Assignee");
    const key = one("ID", "Identifier");
    blockedBy.set(key, splitList(one("Blocked by"), ISSUE_LIST));
    items.push({
      line,
      key,
      title: one("Title"),
      description: columns.all(cells, "Description")[0] ?? "",
      status: one("Status"),
      statusCategory: canceledAt
        ? "canceled"
        : completedAt
          ? "completed"
          : startedAt
            ? "started"
            : "",
      priority: one("Priority"),
      assignees: assignee ? [assignee] : [],
      creator: one("Creator"),
      labels: splitList(one("Labels")),
      dueDate: dateOf("Due Date", "Due"),
      startDate: startedAt,
      createdAt: dateOf("Created"),
      updatedAt: dateOf("Updated"),
      completedAt: completedAt ?? canceledAt,
      parentKey: one("Parent issue", "Parent"),
      blocks: splitList(one("Blocking", "Blocks"), ISSUE_LIST),
      related: splitList(
        one("Related to", "Related issues", "Related"),
        ISSUE_LIST,
      ),
      comments: [],
      checklists: [],
      badDates,
    });
  }

  const byKey = new Map(items.map((item) => [item.key, item]));
  for (const item of items) {
    for (const blocker of blockedBy.get(item.key) ?? []) {
      const source = byKey.get(blocker);
      if (source && !source.blocks.includes(item.key)) {
        source.blocks.push(item.key);
      }
    }
  }

  if (items.length === 0) return { ok: false, error: "empty" };
  return {
    ok: true,
    parsed: {
      items,
      columns: columns.distinct(),
      skipped:
        archived > 0
          ? [{ message: "Archived issues aren't imported", count: archived }]
          : [],
    },
  };
}
