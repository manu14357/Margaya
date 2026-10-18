import { type CsvReadError, readCsvTable } from "./csv-table";
import {
  type ExternalItem,
  type ParsedExport,
  parseExportDate,
  splitList,
} from "./types";

// Asana's project CSV export (project menu → Export/Print → CSV): one row
// per task and sub-task, with its section, assignee (and their email),
// dates, tags, plain-text notes and parent. Comments aren't exported.

const REQUIRED = ["Task ID", "Name"] as const;

/** Completed tasks keep their section in Asana; here they land in Done. */
export const ASANA_COMPLETED_STATUS = "Completed";

export function readAsanaCsv(
  content: string,
  timeZone: string,
): { ok: true; parsed: ParsedExport } | { ok: false; error: CsvReadError } {
  const read = readCsvTable(content, REQUIRED);
  if (!read.ok) return read;
  const { columns, rows } = read.table;

  const items: ExternalItem[] = [];
  // Parent and dependency cells name tasks; resolved once all rows exist.
  const references = new Map<
    ExternalItem,
    { parent: string; blockedBy: string[]; blocking: string[] }
  >();
  for (const { line, cells } of rows) {
    const one = (...names: string[]) => columns.one(cells, ...names);
    const badDates: string[] = [];
    const dateOf = (...names: string[]) => {
      const raw = one(...names);
      if (!raw) return null;
      const date = parseExportDate(raw, timeZone);
      if (!date) badDates.push(`${names[0]} "${raw}"`);
      return date;
    };
    const completedAt = dateOf("Completed At");
    const assignee = one("Assignee Email") || one("Assignee");
    const item: ExternalItem = {
      line,
      key: one("Task ID"),
      title: one("Name"),
      description: columns.all(cells, "Notes")[0] ?? "",
      status: completedAt
        ? ASANA_COMPLETED_STATUS
        : one("Section/Column", "Section"),
      statusCategory: completedAt ? "completed" : "",
      priority: one("Priority"),
      assignees: assignee ? [assignee] : [],
      creator: "",
      labels: splitList(one("Tags")),
      dueDate: dateOf("Due Date"),
      startDate: dateOf("Start Date"),
      createdAt: dateOf("Created At"),
      updatedAt: dateOf("Last Modified"),
      completedAt,
      parentKey: "",
      blocks: [],
      related: [],
      comments: [],
      checklists: [],
      badDates,
    };
    items.push(item);
    references.set(item, {
      parent: one("Parent task", "Parent Task"),
      blockedBy: splitList(one("Blocked By (Dependencies)", "Blocked By")),
      blocking: splitList(one("Blocking (Dependencies)", "Blocking")),
    });
  }

  // A reference is a task id, or else the name of exactly one task.
  const ids = new Set(items.map((item) => item.key).filter(Boolean));
  const byName = new Map<string, string | null>();
  for (const item of items) {
    const name = item.title.trim().toLowerCase();
    if (name && item.key) byName.set(name, byName.has(name) ? null : item.key);
  }
  const resolve = (reference: string) => {
    if (ids.has(reference)) return reference;
    return byName.get(reference.trim().toLowerCase()) ?? null;
  };
  const byKey = new Map(items.map((item) => [item.key, item]));
  for (const [item, refs] of references) {
    item.parentKey = refs.parent ? (resolve(refs.parent) ?? "") : "";
    for (const target of refs.blocking) {
      const key = resolve(target);
      if (key && !item.blocks.includes(key)) item.blocks.push(key);
    }
    for (const blocker of refs.blockedBy) {
      const source = byKey.get(resolve(blocker) ?? "");
      if (source && !source.blocks.includes(item.key)) {
        source.blocks.push(item.key);
      }
    }
  }

  return {
    ok: true,
    parsed: { items, columns: columns.distinct(), skipped: [] },
  };
}
