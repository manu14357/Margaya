import { and, eq, inArray, isNull, or } from "drizzle-orm";
import type { AiScope } from "../ai/context";
import db from "../database";
import {
  pageTable,
  projectTable,
  taskTable,
  userTable,
  workspaceUserTable,
} from "../database/schema";
import { idCandidates, type KnownEntity, scrubIds } from "./scrub-ids";

// Resolves the ids an agent's text mentions to what people call them,
// within what the run could read: pages and tasks of its projects, those
// projects, and members of its workspace. Anything else stays unresolved.

export type ScrubScope = {
  workspaceId: string;
  principalUserId: string;
  scope: AiScope;
};

export function pagePath(
  workspaceId: string,
  projectId: string | null,
  pageId: string,
): string {
  return projectId
    ? `/dashboard/workspace/${workspaceId}/project/${projectId}/pages/${pageId}`
    : `/dashboard/workspace/${workspaceId}/pages/${pageId}`;
}

export async function knownEntities(
  run: ScrubScope,
  ids: string[],
): Promise<Map<string, KnownEntity>> {
  const known = new Map<string, KnownEntity>();
  if (ids.length === 0) return known;
  const projectIds = [...run.scope.projectIds];

  if (projectIds.length > 0) {
    const projects = await db
      .select({ id: projectTable.id, name: projectTable.name })
      .from(projectTable)
      .where(
        and(
          inArray(projectTable.id, ids),
          inArray(projectTable.id, projectIds),
        ),
      );
    for (const project of projects) {
      known.set(project.id, { kind: "project", label: project.name });
    }
  }

  const members = await db
    .select({ id: userTable.id, name: userTable.name })
    .from(workspaceUserTable)
    .innerJoin(userTable, eq(userTable.id, workspaceUserTable.userId))
    .where(
      and(
        eq(workspaceUserTable.workspaceId, run.workspaceId),
        inArray(workspaceUserTable.userId, ids),
      ),
    );
  for (const member of members) {
    known.set(member.id, { kind: "user", label: member.name });
  }

  if (projectIds.length > 0 && run.scope.can.readTasks) {
    const tasks = await db
      .select({
        id: taskTable.id,
        number: taskTable.number,
        slug: projectTable.slug,
      })
      .from(taskTable)
      .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
      .where(
        and(
          inArray(taskTable.id, ids),
          inArray(taskTable.projectId, projectIds),
          isNull(taskTable.deletedAt),
        ),
      );
    for (const task of tasks) {
      known.set(task.id, {
        kind: "task",
        label: `${task.slug.toUpperCase()}-${task.number ?? 0}`,
      });
    }
  }

  if (projectIds.length > 0 && run.scope.can.readPages) {
    const pages = await db
      .select({
        id: pageTable.id,
        title: pageTable.title,
        projectId: pageTable.projectId,
      })
      .from(pageTable)
      .where(
        and(
          inArray(pageTable.id, ids),
          eq(pageTable.workspaceId, run.workspaceId),
          inArray(pageTable.projectId, projectIds),
          isNull(pageTable.archivedAt),
          or(
            eq(pageTable.access, "public"),
            eq(pageTable.ownerId, run.principalUserId),
          ),
        ),
      );
    for (const page of pages) {
      known.set(page.id, {
        kind: "page",
        label: page.title || "Untitled",
        url: pagePath(run.workspaceId, page.projectId, page.id),
      });
    }
  }
  return known;
}

/** Text an agent wrote for people, with the ids it could resolve replaced. */
export async function scrubAgentText(
  run: ScrubScope,
  text: string,
): Promise<string> {
  const ids = idCandidates(text);
  if (ids.length === 0) return text;
  return scrubIds(text, await knownEntities(run, ids));
}
