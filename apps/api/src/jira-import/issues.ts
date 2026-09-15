import { createHash } from "node:crypto";
import { JiraColumns, type JiraCsvTable } from "./csv";
import { type ParsedJiraDate, parseJiraDate } from "./dates";

// One Jira issue read from a CSV row. Text stays as exported (wiki markup);
// conversion to Markdown happens when the task is written.

export type JiraLinkKind = "blocks" | "related" | "duplicate";

export type JiraLink = {
  kind: JiraLinkKind;
  /** outward: this issue → other (blocks, duplicates); inward: other → this. */
  direction: "outward" | "inward";
  key: string;
};

export type JiraComment = {
  /** Stable across exports of the same comment: dedups re-imports. */
  hash: string;
  createdAt: Date | null;
  author: string;
  body: string;
};

export type JiraAttachment = { name: string; url: string | null };

export type JiraIssue = {
  /** 1-based file line of the row. */
  line: number;
  key: string;
  id: string;
  summary: string;
  description: string;
  issueType: string;
  status: string;
  statusCategory: string;
  priority: string;
  assignee: string;
  reporter: string;
  labels: string[];
  created: ParsedJiraDate | null;
  updated: ParsedJiraDate | null;
  resolved: ParsedJiraDate | null;
  dueDate: ParsedJiraDate | null;
  /** Unreadable date values, by column name. */
  badDates: string[];
  storyPoints: number | null;
  originalEstimateSeconds: number | null;
  /** The parent's issue id or key, as the export writes it. */
  parent: string;
  links: JiraLink[];
  comments: JiraComment[];
  sprints: string[];
  components: string[];
  attachments: JiraAttachment[];
};

const LINK_HEADER = /^(outward|inward) issue link \((.+)\)$/i;

/** Jira link type names → Margaya relations; other types are not imported. */
export function linkKindOf(typeName: string): JiraLinkKind | null {
  const name = typeName.trim().toLowerCase();
  if (name === "blocks" || name === "blocker") return "blocks";
  if (name === "relates" || name === "relate") return "related";
  if (name === "duplicate" || name === "duplicates") return "duplicate";
  return null;
}

function numberOf(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

/** Account ids in comments → display names, from the person columns. */
function accountNames(columns: JiraColumns, table: JiraCsvTable) {
  const names = new Map<string, string>();
  const pairs = [
    ["Assignee", "Assignee Id"],
    ["Reporter", "Reporter Id"],
    ["Creator", "Creator Id"],
  ] as const;
  for (const { cells } of table.rows) {
    for (const [nameColumn, idColumn] of pairs) {
      const id = columns.one(cells, idColumn);
      const name = columns.one(cells, nameColumn);
      if (!id || !name) continue;
      // Prefer a display name over an email for the same account.
      const known = names.get(id);
      if (!known || (known.includes("@") && !name.includes("@"))) {
        names.set(id, name);
      }
    }
  }
  return names;
}

/** "date;author;body": the body keeps any further semicolons. */
export function parseCommentCell(
  cell: string,
  timeZone: string,
  names: ReadonlyMap<string, string> = new Map(),
): JiraComment | null {
  const value = cell.trim();
  if (!value) return null;
  const first = value.indexOf(";");
  const second = first < 0 ? -1 : value.indexOf(";", first + 1);
  const date =
    first < 0 ? null : parseJiraDate(value.slice(0, first), timeZone);
  let author = "";
  let body = value;
  if (date && second > first) {
    author = value.slice(first + 1, second).trim();
    body = value.slice(second + 1);
  }
  body = body.trim();
  if (!body) return null;
  const hash = createHash("sha256")
    .update(`${date?.date.toISOString() ?? ""}\n${author}\n${body}`)
    .digest("hex")
    .slice(0, 32);
  return {
    hash,
    createdAt: date?.date ?? null,
    author: names.get(author) ?? author,
    body,
  };
}

/** "date;author;file name;url" (older exports: just the URL). */
export function parseAttachmentCell(cell: string): JiraAttachment | null {
  const value = cell.trim();
  if (!value) return null;
  const parts = value.split(";");
  if (parts.length >= 4) {
    const url = parts.slice(3).join(";").trim();
    return { name: parts[2]?.trim() || url, url: url || null };
  }
  if (/^https?:\/\//i.test(value)) {
    const name = decodeURIComponent(value.split("/").pop() || value);
    return { name, url: value };
  }
  return { name: value, url: null };
}

export type ReadIssues = {
  issues: JiraIssue[];
  columns: JiraColumns;
  /** Link columns whose type isn't imported, e.g. "Cloners". */
  ignoredLinkTypes: string[];
};

export function readIssues(table: JiraCsvTable, timeZone: string): ReadIssues {
  const columns = new JiraColumns(table.headers);
  const names = accountNames(columns, table);
  const linkColumns = columns.matching(LINK_HEADER).map(({ name, index }) => {
    const match = LINK_HEADER.exec(name);
    return {
      index,
      typeName: match?.[2] ?? "",
      kind: linkKindOf(match?.[2] ?? ""),
      direction: (match?.[1]?.toLowerCase() === "inward"
        ? "inward"
        : "outward") as JiraLink["direction"],
    };
  });
  const ignoredLinkTypes = [
    ...new Set(
      linkColumns.filter((column) => !column.kind).map((c) => c.typeName),
    ),
  ];

  const issues = table.rows.map(({ line, cells }): JiraIssue => {
    const badDates: string[] = [];
    const dateOf = (...names: string[]) => {
      const raw = columns.one(cells, ...names);
      if (!raw) return null;
      const parsed = parseJiraDate(raw, timeZone);
      if (!parsed) badDates.push(`${names[0]} "${raw}"`);
      return parsed;
    };
    const links: JiraLink[] = [];
    for (const column of linkColumns) {
      const value = (cells[column.index] ?? "").trim();
      if (!value || !column.kind) continue;
      // Some exports put several keys in one cell.
      for (const key of value.split(/[\s,]+/).filter(Boolean)) {
        links.push({ kind: column.kind, direction: column.direction, key });
      }
    }
    return {
      line,
      key: columns.one(cells, "Issue key", "Key"),
      id: columns.one(cells, "Issue id", "Id"),
      summary: columns.one(cells, "Summary"),
      description: columns.all(cells, "Description")[0] ?? "",
      issueType: columns.one(cells, "Issue Type", "Issuetype"),
      status: columns.one(cells, "Status"),
      statusCategory: columns.one(cells, "Status Category"),
      priority: columns.one(cells, "Priority"),
      assignee: columns.one(cells, "Assignee"),
      reporter: columns.one(cells, "Reporter"),
      labels: columns
        .all(cells, "Labels")
        .flatMap((value) => value.split(/\s+/))
        .filter(Boolean),
      created: dateOf("Created"),
      updated: dateOf("Updated"),
      resolved: dateOf("Resolved"),
      dueDate: dateOf("Due date", "Due"),
      badDates,
      storyPoints: numberOf(
        columns.one(
          cells,
          "Custom field (Story Points)",
          "Custom field (Story point estimate)",
          "Story Points",
          "Story point estimate",
        ),
      ),
      originalEstimateSeconds: numberOf(
        columns.one(cells, "Original estimate", "Original Estimate"),
      ),
      parent: columns.one(cells, "Parent id", "Parent", "Parent key"),
      links,
      comments: columns
        .all(cells, "Comment", "Comments")
        .map((cell) => parseCommentCell(cell, timeZone, names))
        .filter((comment): comment is JiraComment => comment !== null),
      sprints: columns.all(cells, "Sprint"),
      components: columns.all(cells, "Component/s", "Components", "Component"),
      attachments: columns
        .all(cells, "Attachment", "Attachments")
        .map(parseAttachmentCell)
        .filter((item): item is JiraAttachment => item !== null),
    };
  });

  return { issues, columns, ignoredLinkTypes };
}
