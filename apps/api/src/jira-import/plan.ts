import type { JiraIssue } from "./issues";
import {
  type ImportColumn,
  type ImportMember,
  type MargayaPriority,
  PLANNED,
  suggestPriority,
  suggestStatus,
} from "./mapping";
import type { JiraImportOptions } from "./schema";
import type { WarningLog } from "./warnings";
import { jiraWikiToMarkdown } from "./wiki-markup";

// The pure half of the import: what one Jira issue becomes, before any write.

const MAX_LABEL_NAME = 50;
const MAX_EXTERNAL_NAME = 120;

export type PlanContext = {
  columns: readonly ImportColumn[];
  options: JiraImportOptions;
  matchMember: (value: string) => ImportMember | null;
  /** The estimate point for an issue, or null when none fits. */
  estimate: {
    enabled: boolean;
    reads: "points" | "time" | null;
    pointFor: (issue: JiraIssue) => string | null;
  };
  cyclesOn: boolean;
  modulesOn: boolean;
  commentsAllowed: boolean;
};

export type PlannedComment = {
  hash: string;
  createdAt: Date | null;
  author: string;
  content: string;
};

export type PlannedTask = {
  title: string;
  description: string;
  status: string;
  priority: MargayaPriority;
  assigneeId: string | null;
  reporterId: string | null;
  labels: string[];
  dueDate: Date | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  resolvedAt: Date | null;
  estimatePointId: string | null;
  cycleName: string | null;
  moduleNames: string[];
  comments: PlannedComment[];
};

/** The attachment note appended to the description: files stay in Jira. */
export function attachmentNote(issue: JiraIssue): string {
  if (issue.attachments.length === 0) return "";
  const items = issue.attachments.map((attachment) => {
    const name = attachment.name.replace(/([[\]])/g, "\\$1");
    return attachment.url ? `- [${name}](${attachment.url})` : `- ${name}`;
  });
  return `**Attachments in Jira (not imported)**\n\n${items.join("\n")}`;
}

export function statusFor(issue: JiraIssue, context: PlanContext): string {
  const chosen = context.options.statusMap?.[issue.status];
  if (chosen) return chosen;
  return issue.status
    ? suggestStatus(issue.status, issue.statusCategory, context.columns)
    : PLANNED;
}

export function priorityFor(
  issue: JiraIssue,
  options: JiraImportOptions,
): MargayaPriority {
  return (
    options.priorityMap?.[issue.priority] ?? suggestPriority(issue.priority)
  );
}

function labelsFor(issue: JiraIssue, options: JiraImportOptions) {
  const names = [...issue.labels];
  if (options.issueTypeAsLabel && issue.issueType) names.push(issue.issueType);
  return names
    .map((name) => name.trim())
    .filter((name) => name.length > 0)
    .map((name) => name.slice(0, MAX_LABEL_NAME));
}

function estimateFor(
  issue: JiraIssue,
  context: PlanContext,
  warnings: WarningLog,
): string | null {
  const hasPoints = issue.storyPoints !== null;
  const hasTime = issue.originalEstimateSeconds !== null;
  if (!hasPoints && !hasTime) return null;
  const { estimate } = context;
  if (!estimate.enabled) {
    warnings.add("Estimates skipped: the project's Estimates feature is off");
    return null;
  }
  if (!estimate.reads) {
    warnings.add(
      "Estimates skipped: the active estimate system takes neither story points nor time",
    );
    return null;
  }
  const relevant = estimate.reads === "time" ? hasTime : hasPoints;
  if (!relevant) return null;
  const point = estimate.pointFor(issue);
  if (!point) {
    const value =
      estimate.reads === "time"
        ? `${Math.round((issue.originalEstimateSeconds ?? 0) / 60)} min`
        : String(issue.storyPoints);
    warnings.add(
      "Estimates skipped: no value of the active estimate system matches",
      value,
    );
  }
  return point;
}

export function planIssue(
  issue: JiraIssue,
  context: PlanContext,
  warnings: WarningLog,
): PlannedTask {
  const { options } = context;
  const note = attachmentNote(issue);
  if (note) {
    warnings.add(
      "Attachments aren't downloaded; their names and links are listed in the description",
    );
  }
  const description = [jiraWikiToMarkdown(issue.description), note]
    .filter(Boolean)
    .join("\n\n");

  const sprint = issue.sprints[issue.sprints.length - 1]?.trim() ?? "";
  let cycleName: string | null = null;
  if (options.sprintsAsCycles && sprint) {
    if (context.cyclesOn) cycleName = sprint.slice(0, 255);
    else
      warnings.add("Sprints skipped: cycles are turned off for this project");
  }
  let moduleNames: string[] = [];
  if (options.componentsAsModules && issue.components.length > 0) {
    if (context.modulesOn) {
      moduleNames = [
        ...new Set(issue.components.map((name) => name.trim().slice(0, 255))),
      ].filter(Boolean);
    } else {
      warnings.add(
        "Components skipped: modules are turned off for this project",
      );
    }
  }

  let comments: PlannedComment[] = [];
  if (issue.comments.length > 0) {
    if (!options.importComments) {
      // Left out on purpose: nothing to report.
    } else if (!context.commentsAllowed) {
      warnings.add(
        "Comments skipped: importing comment authors needs the Manage workspace settings permission",
      );
    } else {
      comments = issue.comments.map((comment) => ({
        hash: comment.hash,
        createdAt: comment.createdAt,
        author: (comment.author || "Jira user").slice(0, MAX_EXTERNAL_NAME),
        content: jiraWikiToMarkdown(comment.body) || comment.body,
      }));
    }
  }

  return {
    title: issue.summary,
    description,
    status: statusFor(issue, context),
    priority: priorityFor(issue, options),
    assigneeId: context.matchMember(issue.assignee)?.id ?? null,
    reporterId: context.matchMember(issue.reporter)?.id ?? null,
    labels: labelsFor(issue, options),
    dueDate: issue.dueDate?.date ?? null,
    createdAt: issue.created?.date ?? null,
    updatedAt: issue.updated?.date ?? issue.created?.date ?? null,
    resolvedAt: issue.resolved?.date ?? null,
    estimatePointId: estimateFor(issue, context, warnings),
    cycleName,
    moduleNames,
    comments,
  };
}

/** Parent and link pairs between issues of the file, as relation inputs. */
export type PlannedRelation = {
  sourceKey: string;
  targetKey: string;
  relationType: "subtask" | "blocks" | "related" | "duplicate";
};

export function planRelations(issues: readonly JiraIssue[]): PlannedRelation[] {
  const keyById = new Map<string, string>();
  const keys = new Set<string>();
  for (const issue of issues) {
    if (!issue.key) continue;
    keys.add(issue.key);
    if (issue.id) keyById.set(issue.id, issue.key);
  }
  const seen = new Set<string>();
  const relations: PlannedRelation[] = [];
  const add = (relation: PlannedRelation) => {
    if (relation.sourceKey === relation.targetKey) return;
    const pair =
      relation.relationType === "related"
        ? [relation.sourceKey, relation.targetKey].sort().join("\n")
        : `${relation.sourceKey}\n${relation.targetKey}`;
    const id = `${relation.relationType}\n${pair}`;
    if (seen.has(id)) return;
    seen.add(id);
    relations.push(relation);
  };

  // Parents first: a sub-task's parent link is the most important one.
  for (const issue of issues) {
    if (!issue.key || !issue.parent) continue;
    const parentKey =
      keyById.get(issue.parent) ??
      (keys.has(issue.parent) ? issue.parent : null);
    if (parentKey) {
      add({
        sourceKey: parentKey,
        targetKey: issue.key,
        relationType: "subtask",
      });
    }
  }
  for (const issue of issues) {
    if (!issue.key) continue;
    for (const link of issue.links) {
      if (!keys.has(link.key)) continue;
      const [sourceKey, targetKey] =
        link.direction === "outward"
          ? [issue.key, link.key]
          : [link.key, issue.key];
      add({
        sourceKey,
        targetKey,
        relationType: link.kind,
      });
    }
  }
  return relations;
}
