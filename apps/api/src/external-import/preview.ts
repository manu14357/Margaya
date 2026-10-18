import {
  loadColumns,
  loadImportedKeys,
  loadJiraProject,
  loadMembers,
} from "../jira-import/context";
import {
  createMemberMatcher,
  suggestPriority,
  suggestStatus,
} from "../jira-import/mapping";
import { WarningLog } from "../jira-import/warnings";
import { parseExternalExport } from "./parse";
import { planRelations } from "./plan";
import type { ExternalItem, ExternalSource } from "./types";

export type ExternalPermissions = { update: boolean; comments: boolean };

function countBy(
  items: readonly ExternalItem[],
  keyOf: (item: ExternalItem) => string[],
) {
  const counts = new Map<string, number>();
  for (const item of items) {
    for (const key of keyOf(item)) {
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export async function previewExternalImport({
  source,
  projectId,
  content,
  timeZone,
  permissions,
}: {
  source: ExternalSource;
  projectId: string;
  content: string;
  timeZone?: string;
  permissions: ExternalPermissions;
}) {
  const project = await loadJiraProject(projectId);
  const parsed = parseExternalExport(source, content, timeZone);
  const { items } = parsed;
  const [columns, members, imported] = await Promise.all([
    loadColumns(project.id),
    loadMembers(project.workspaceId),
    loadImportedKeys(
      project.id,
      items.map((item) => item.key),
      source,
    ),
  ]);
  const match = createMemberMatcher(members);
  const warnings = new WarningLog();
  for (const skipped of parsed.skipped) {
    for (let index = 0; index < skipped.count; index += 1) {
      warnings.add(skipped.message);
    }
  }

  const categoryOf = new Map<string, string>();
  for (const item of items) {
    if (!item.title) warnings.add("Items without a title are skipped");
    if (!item.key) {
      warnings.add("Items without an id can't be matched on a later re-import");
    }
    for (const bad of item.badDates) {
      warnings.add("Unreadable dates are skipped", bad);
    }
    if (item.status && item.statusCategory && !categoryOf.has(item.status)) {
      categoryOf.set(item.status, item.statusCategory);
    }
  }

  const relations = planRelations(items);
  return {
    source,
    itemCount: items.length,
    columns: parsed.columns,
    statuses: countBy(items, (item) => [item.status]).map(
      ({ name, count }) => ({
        name,
        count,
        category: categoryOf.get(name) ?? null,
        suggestedStatus: suggestStatus(
          name,
          categoryOf.get(name) ?? "",
          columns,
        ),
      }),
    ),
    priorities: countBy(items, (item) => [item.priority]).map(
      ({ name, count }) => ({
        name,
        count,
        suggestedPriority: suggestPriority(name),
      }),
    ),
    // Only the member's id and name: the preview never reveals emails.
    people: countBy(items, (item) => [
      ...new Set([...item.assignees, item.creator]),
    ]).map(({ name, count }) => {
      const member = match(name);
      return {
        name,
        count,
        member: member ? { id: member.id, name: member.name } : null,
      };
    }),
    totals: {
      comments: items.reduce((sum, item) => sum + item.comments.length, 0),
      checklists: items.reduce((sum, item) => sum + item.checklists.length, 0),
      subtasks: relations.filter((r) => r.relationType === "subtask").length,
      links: relations.filter((r) => r.relationType !== "subtask").length,
      alreadyImported: items.filter((item) => imported.has(item.key)).length,
    },
    permissions,
    warnings: warnings.list(),
  };
}
