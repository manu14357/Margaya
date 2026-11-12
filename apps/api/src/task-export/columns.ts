import type { AiProvenance } from "../ai/provenance-types";
import type { EstimateType } from "../estimate/types";
import type { ExportCustomField, ExportTask } from "./collect";
import type { CellValue } from "./encoders/cell";
import { MAX_CUSTOM_FIELD_COLUMNS } from "./types";

// The exported columns. CSV and XLSX headers are fixed English strings so
// files read the same for everyone and scripts can rely on them; JSON uses
// structured values under stable keys instead.

type Column = { header: string; value: (task: ExportTask) => CellValue };

const names = (people: readonly { name: string }[]) =>
  people.map((person) => person.name);

/** "1h 30m", "2h" or "45m" for a number of minutes. */
export function formatMinutes(total: number): string {
  const whole = Math.max(0, Math.round(total));
  const hours = Math.floor(whole / 60);
  const minutes = whole % 60;
  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
}

/** An estimate as the app shows it: durations for time, numbers for points. */
export function formatEstimate(
  estimate: { value: string; type: EstimateType } | null,
): string {
  if (!estimate) return "";
  if (estimate.type === "categories") return estimate.value;
  const number = Number(estimate.value);
  if (!Number.isFinite(number)) return estimate.value;
  if (estimate.type === "time") return formatMinutes(number);
  return String(Math.round(number * 100) / 100);
}

/**
 * The AI label as one cell: "agent: Triage bot (model)" or
 * "assist: editor_assist (model)", plus "; edited by Ada" after a person's
 * change. Empty for human-written text.
 */
export function formatAiProvenance(
  provenance: AiProvenance | null | undefined,
): string {
  if (!provenance) return "";
  const who =
    provenance.source === "agent"
      ? `agent: ${provenance.agentName ?? provenance.agentId ?? ""}`
      : `assist: ${provenance.feature ?? ""}`;
  const model = provenance.model ? ` (${provenance.model})` : "";
  const edited = provenance.editedById
    ? `; edited by ${provenance.editedByName ?? provenance.editedById}`
    : "";
  return `${who}${model}${edited}`;
}

const FIXED_COLUMNS: readonly Column[] = [
  { header: "Project", value: (task) => task.project.name },
  { header: "Key", value: (task) => task.key },
  { header: "Number", value: (task) => task.number },
  { header: "Parent", value: (task) => task.parent?.key ?? null },
  { header: "Title", value: (task) => task.title },
  { header: "Description", value: (task) => task.description },
  { header: "Status", value: (task) => task.status.name },
  { header: "Status group", value: (task) => task.group },
  { header: "Priority", value: (task) => task.priority },
  { header: "Assignees", value: (task) => names(task.assignees) },
  {
    header: "Assignee emails",
    value: (task) => task.assignees.map((user) => user.email),
  },
  { header: "Subscribers", value: (task) => names(task.subscribers) },
  { header: "Created by", value: (task) => task.createdBy?.name ?? null },
  { header: "Start date", value: (task) => task.startDate },
  { header: "Due date", value: (task) => task.dueDate },
  { header: "Completed at", value: (task) => task.completedAt },
  { header: "Created at", value: (task) => task.createdAt },
  { header: "Updated at", value: (task) => task.updatedAt },
  { header: "Archived at", value: (task) => task.archivedAt },
  { header: "Estimate", value: (task) => formatEstimate(task.estimate) },
  { header: "Labels", value: (task) => names(task.labels) },
  { header: "Cycle", value: (task) => task.cycle?.name ?? null },
  { header: "Modules", value: (task) => names(task.modules) },
  { header: "Links", value: (task) => task.links },
  { header: "Relations", value: (task) => task.relations },
  {
    header: "Comments",
    value: (task) =>
      task.comments.map((comment) => ({
        author: comment.author,
        createdAt: comment.createdAt.toISOString(),
        text: comment.text,
        ...(comment.aiProvenance ? { aiGenerated: true } : {}),
      })),
  },
  { header: "Sub-tasks", value: (task) => task.subTaskCount },
  { header: "Link count", value: (task) => task.linkCount },
  { header: "Attachment count", value: (task) => task.attachmentCount },
  {
    header: "Time logged (minutes)",
    value: (task) => task.timeLoggedMinutes,
  },
  {
    header: "AI generated",
    value: (task) => formatAiProvenance(task.aiProvenance),
  },
];

export const FIXED_HEADERS: readonly string[] = FIXED_COLUMNS.map(
  (column) => column.header,
);

const CUSTOM_PREFIX = "Custom: ";

/**
 * One column per distinct field name, in project order then field position
 * (fields with the same name share a column), at most 50.
 */
export function customFieldColumns(
  fields: readonly ExportCustomField[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const field of fields) {
    if (seen.has(field.name)) continue;
    seen.add(field.name);
    out.push(field.name);
    if (out.length === MAX_CUSTOM_FIELD_COLUMNS) break;
  }
  return out;
}

export function exportHeader(customColumns: readonly string[]): string[] {
  return [
    ...FIXED_HEADERS,
    ...customColumns.map((name) => `${CUSTOM_PREFIX}${name}`),
  ];
}

/** A custom-field value as a cell: numbers and booleans keep their type. */
export function customFieldCell(
  field: { type: string; value: string } | undefined,
): CellValue {
  if (!field) return null;
  if (field.type === "number" && field.value.trim() !== "") {
    const number = Number(field.value);
    if (Number.isFinite(number)) return number;
  }
  if (field.type === "boolean") {
    if (field.value === "true") return true;
    if (field.value === "false") return false;
  }
  return field.value;
}

export function exportRow(
  task: ExportTask,
  customColumns: readonly string[],
): CellValue[] {
  const fixed = FIXED_COLUMNS.map((column) => column.value(task));
  const custom = customColumns.map((name) =>
    customFieldCell(task.customFields.find((field) => field.name === name)),
  );
  return [...fixed, ...custom];
}

/** The JSON form of a task in the v1 export format. */
export function taskJson(task: ExportTask): Record<string, unknown> {
  return {
    id: task.id,
    project: {
      id: task.project.id,
      name: task.project.name,
      slug: task.project.slug,
    },
    key: task.key,
    number: task.number,
    parent: task.parent,
    title: task.title,
    description: task.description,
    status: task.status,
    group: task.group,
    priority: task.priority,
    assignees: task.assignees,
    subscribers: task.subscribers,
    createdBy: task.createdBy,
    startDate: task.startDate,
    dueDate: task.dueDate,
    completedAt: task.completedAt,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    archivedAt: task.archivedAt,
    estimate: task.estimate,
    labels: task.labels,
    cycle: task.cycle,
    modules: task.modules,
    links: task.links,
    relations: task.relations,
    comments: task.comments,
    ...(task.commentsTruncated ? { commentsTruncated: true } : {}),
    subTaskCount: task.subTaskCount,
    linkCount: task.linkCount,
    attachmentCount: task.attachmentCount,
    timeLoggedMinutes: task.timeLoggedMinutes,
    customFields: task.customFields,
    aiProvenance: task.aiProvenance ?? null,
  };
}
