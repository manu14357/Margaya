import {
  type ImportColumn,
  type ImportMember,
  PLANNED,
  suggestPriority,
  suggestStatus,
} from "../jira-import/mapping";
import type { PlannedRelation, PlannedTask } from "../jira-import/plan";
import type { WarningLog } from "../jira-import/warnings";
import type { ExternalImportOptions } from "./schema";
import type { ExternalChecklist, ExternalItem } from "./types";

// The pure half of an import: what one exported item becomes, before any
// write. Its output feeds the Jira importer's writer.

const MAX_TITLE = 500;
const MAX_LABEL_NAME = 50;
const MAX_EXTERNAL_NAME = 120;

export type ExternalPlanContext = {
  columns: readonly ImportColumn[];
  options: ExternalImportOptions;
  matchMember: (value: string) => ImportMember | null;
  commentsAllowed: boolean;
  /** "Trello", "Linear", "Asana". */
  sourceLabel: string;
};

function escapeMarkdown(value: string) {
  return value.replace(/([\\`*_[\]<>#])/g, "\\$1");
}

/** Checklists as Markdown task lists, which the editor shows as checkboxes. */
export function checklistMarkdown(checklists: readonly ExternalChecklist[]) {
  return checklists
    .filter((checklist) => checklist.items.length > 0)
    .map((checklist) => {
      const items = checklist.items.map(
        (item) => `- [${item.done ? "x" : " "}] ${escapeMarkdown(item.name)}`,
      );
      return `**${escapeMarkdown(checklist.name)}**\n\n${items.join("\n")}`;
    })
    .join("\n\n");
}

/** Names the people an item couldn't be assigned to, so nothing is lost. */
export function unassignedNote(names: readonly string[], sourceLabel: string) {
  if (names.length === 0) return "";
  return `_Assigned in ${sourceLabel} to ${names.map(escapeMarkdown).join(", ")} (no matching workspace member)._`;
}

export function statusFor(
  item: ExternalItem,
  context: ExternalPlanContext,
): string {
  const chosen = context.options.statusMap?.[item.status];
  if (chosen) return chosen;
  return item.status
    ? suggestStatus(item.status, item.statusCategory, context.columns)
    : PLANNED;
}

export function planItem(
  item: ExternalItem,
  context: ExternalPlanContext,
  warnings: WarningLog,
): PlannedTask & { unmatched: string[] } {
  const { options } = context;
  const assigneeIds: string[] = [];
  const unmatched: string[] = [];
  for (const person of item.assignees) {
    const member = context.matchMember(person);
    if (!member) unmatched.push(person);
    else if (!assigneeIds.includes(member.id)) assigneeIds.push(member.id);
  }
  if (unmatched.length > 0) {
    warnings.add(
      "People without a matching workspace member are left unassigned and named in the description",
    );
  }

  const description = [
    item.description.trim(),
    checklistMarkdown(item.checklists),
    unassignedNote(unmatched, context.sourceLabel),
  ]
    .filter(Boolean)
    .join("\n\n");

  let comments: PlannedTask["comments"] = [];
  if (item.comments.length > 0 && options.importComments) {
    if (!context.commentsAllowed) {
      warnings.add(
        "Comments skipped: importing comment authors needs the Manage workspace settings permission",
      );
    } else {
      comments = item.comments.map((comment) => ({
        hash: comment.hash,
        createdAt: comment.createdAt,
        author: (comment.author || `${context.sourceLabel} user`).slice(
          0,
          MAX_EXTERNAL_NAME,
        ),
        content: comment.body,
      }));
    }
  }

  return {
    title: item.title.slice(0, MAX_TITLE),
    description,
    status: statusFor(item, context),
    priority:
      options.priorityMap?.[item.priority] ?? suggestPriority(item.priority),
    assigneeId: assigneeIds[0] ?? null,
    assigneeIds,
    reporterId: item.creator
      ? (context.matchMember(item.creator)?.id ?? null)
      : null,
    labels: [
      ...new Set(
        item.labels
          .map((name) => name.trim().slice(0, MAX_LABEL_NAME))
          .filter(Boolean),
      ),
    ],
    dueDate: item.dueDate,
    startDate: item.startDate,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt ?? item.createdAt,
    resolvedAt: item.completedAt,
    estimatePointId: null,
    cycleName: null,
    moduleNames: [],
    comments,
    unmatched,
  };
}

/** Parent, blocking and related pairs between items of the file. */
export function planRelations(
  items: readonly ExternalItem[],
): PlannedRelation[] {
  const keys = new Set(items.map((item) => item.key).filter(Boolean));
  const seen = new Set<string>();
  const relations: PlannedRelation[] = [];
  const add = (relation: PlannedRelation) => {
    if (relation.sourceKey === relation.targetKey) return;
    if (!keys.has(relation.sourceKey) || !keys.has(relation.targetKey)) return;
    const pair =
      relation.relationType === "related"
        ? [relation.sourceKey, relation.targetKey].sort().join("\n")
        : `${relation.sourceKey}\n${relation.targetKey}`;
    const id = `${relation.relationType}\n${pair}`;
    if (seen.has(id)) return;
    seen.add(id);
    relations.push(relation);
  };
  // Parents first: a sub-task's parent link matters most.
  for (const item of items) {
    if (item.key && item.parentKey) {
      add({
        sourceKey: item.parentKey,
        targetKey: item.key,
        relationType: "subtask",
      });
    }
  }
  for (const item of items) {
    if (!item.key) continue;
    for (const target of item.blocks) {
      add({ sourceKey: item.key, targetKey: target, relationType: "blocks" });
    }
    for (const target of item.related) {
      add({ sourceKey: item.key, targetKey: target, relationType: "related" });
    }
  }
  return relations;
}
