import {
  loadColumns,
  loadEstimateLookup,
  loadImportedKeys,
  loadJiraProject,
  loadMembers,
  parseJiraExport,
} from "./context";
import type { JiraIssue } from "./issues";
import { createMemberMatcher, suggestPriority, suggestStatus } from "./mapping";
import { WarningLog } from "./warnings";

export type JiraPermissions = {
  update: boolean;
  comments: boolean;
  cycles: boolean;
  modules: boolean;
};

function countBy<T>(items: readonly T[], keyOf: (item: T) => string[]) {
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

/** Parent and link references that point at issues in the same file. */
export function countInFileReferences(issues: readonly JiraIssue[]) {
  const refs = new Set<string>();
  for (const issue of issues) {
    if (issue.key) refs.add(issue.key);
    if (issue.id) refs.add(issue.id);
  }
  let subtasks = 0;
  let links = 0;
  for (const issue of issues) {
    if (issue.parent && refs.has(issue.parent)) subtasks += 1;
    links += issue.links.filter((link) => refs.has(link.key)).length;
  }
  // Each link appears on both of its issues (outward and inward columns).
  return { subtasks, links: Math.ceil(links / 2) };
}

export async function previewJiraImport({
  projectId,
  content,
  timeZone,
  permissions,
}: {
  projectId: string;
  content: string;
  timeZone?: string;
  permissions: JiraPermissions;
}) {
  const project = await loadJiraProject(projectId);
  const parsed = parseJiraExport(content, timeZone);
  const { issues } = parsed;
  const [columns, members, imported, estimate] = await Promise.all([
    loadColumns(project.id),
    loadMembers(project.workspaceId),
    loadImportedKeys(
      project.id,
      issues.map((issue) => issue.key),
    ),
    loadEstimateLookup(project),
  ]);
  const match = createMemberMatcher(members);
  const warnings = new WarningLog();

  const categoryOf = new Map<string, string>();
  for (const issue of issues) {
    if (issue.status && issue.statusCategory && !categoryOf.has(issue.status))
      categoryOf.set(issue.status, issue.statusCategory);
  }
  for (const issue of issues) {
    if (!issue.summary) warnings.add("Rows without a Summary are skipped");
    if (!issue.key) {
      warnings.add(
        "Rows without an Issue key can't be matched on a later re-import",
      );
    }
    for (const bad of issue.badDates) {
      warnings.add("Unreadable dates are skipped", bad);
    }
  }
  for (const type of parsed.ignoredLinkTypes) {
    warnings.add(`"${type}" issue links aren't imported`);
  }

  const references = countInFileReferences(issues);
  return {
    issueCount: issues.length,
    columns: parsed.columns.distinct(),
    statuses: countBy(issues, (issue) => [issue.status]).map(
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
    priorities: countBy(issues, (issue) => [issue.priority]).map(
      ({ name, count }) => ({
        name,
        count,
        suggestedPriority: suggestPriority(name),
      }),
    ),
    people: countBy(issues, (issue) => [
      ...new Set([issue.assignee, issue.reporter]),
    ]).map(({ name, count }) => ({ name, count, member: match(name) })),
    issueTypes: countBy(issues, (issue) => [issue.issueType]),
    sprints: countBy(issues, (issue) => issue.sprints.slice(-1)),
    components: countBy(issues, (issue) => [...new Set(issue.components)]),
    totals: {
      comments: issues.reduce((sum, issue) => sum + issue.comments.length, 0),
      attachments: issues.reduce(
        (sum, issue) => sum + issue.attachments.length,
        0,
      ),
      subtasks: references.subtasks,
      links: references.links,
      alreadyImported: issues.filter((issue) => imported.has(issue.key)).length,
    },
    features: {
      cycles: project.cyclesEnabled,
      modules: project.modulesEnabled,
      estimates: estimate.reads !== null,
    },
    permissions,
    warnings: warnings.list(),
  };
}
