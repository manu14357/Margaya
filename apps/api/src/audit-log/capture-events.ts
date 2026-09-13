import { eq, inArray } from "drizzle-orm";
import db from "../database";
import { projectTable } from "../database/schema";
import { subscribeToEvent } from "../events";
import type { AuditAction } from "./actions";
import { type AuditRequestStore, auditContext } from "./context";
import { type AuditInput, recordAudit, trackAudit } from "./record";

// Audit entries for actions that already publish an internal event. Each
// entry of EVENT_ACTIONS maps one event to the entry it writes; the actor,
// IP and user agent come from the request the event was published in.

type EventData = Record<string, unknown> & {
  workspaceId?: string;
  projectId?: string;
  userId?: string | null;
  name?: string;
};

type Mapper = (data: EventData) => Promise<AuditInput | null>;

function str(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

async function projectInfo(projectId: string) {
  const [row] = await db
    .select({ workspaceId: projectTable.workspaceId, name: projectTable.name })
    .from(projectTable)
    .where(eq(projectTable.id, projectId))
    .limit(1);
  return row ?? null;
}

/** An entry about the event's project; metadata keys are explicit. */
function project(
  action: AuditAction,
  metadata?: (data: EventData) => Record<string, unknown>,
): Mapper {
  return async (data) => {
    const projectId = str(data.projectId);
    if (!projectId) return null;
    let workspaceId = str(data.workspaceId);
    let label = str(data.name);
    if (!workspaceId || !label) {
      const info = await projectInfo(projectId);
      workspaceId ??= info?.workspaceId ?? null;
      label ??= info?.name ?? null;
    }
    if (!workspaceId) return null;
    return {
      workspaceId,
      action,
      target: { type: "project", id: projectId, label },
      metadata: metadata?.(data) ?? null,
      actor: { userId: str(data.userId) },
    };
  };
}

const list = (value: unknown) =>
  Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];

export const EVENT_ACTIONS: Record<string, Mapper> = {
  "workspace.created": async (data) => {
    const workspaceId = str(data.workspaceId);
    if (!workspaceId) return null;
    return {
      workspaceId,
      action: "workspace.created",
      target: {
        type: "workspace",
        id: workspaceId,
        label: str(data.workspaceName),
      },
      actor: { userId: str(data.ownerId) },
    };
  },
  "project.created": project("project.created", (data) => ({
    slug: data.slug ?? null,
  })),
  // With the trash, deleting a project moves it there (taskCount tasks).
  "project.deleted": project("project.trashed", (data) => ({
    taskCount: data.taskCount ?? null,
  })),
  "project.restored": project("project.restored", (data) => ({
    taskCount: data.taskCount ?? null,
  })),
  "project.purged": project("project.purged"),
  "project.archived": project("project.archived"),
  "project.unarchived": project("project.unarchived"),
  "project.updated": project("project.settings_changed", (data) => ({
    changed: list(data.changed),
  })),
  "project.features_updated": project("project.feature_toggled", (data) => ({
    enabled: list(data.enabled),
    disabled: list(data.disabled),
  })),
  "project.automations_updated": project(
    "project.settings_changed",
    (data) => ({
      changed: ["automations", ...list(data.changed)],
    }),
  ),
  "publication.published": project("public_board.published"),
  "publication.unpublished": project("public_board.unpublished"),
  "publication.link_rotated": project("public_board.link_rotated"),
  "publication.updated": project("public_board.settings_changed", (data) => ({
    changed: list(data.changes),
  })),
};

for (const [eventName, map] of Object.entries(EVENT_ACTIONS)) {
  void subscribeToEvent<EventData>(eventName, async (data) => {
    if (typeof data !== "object" || data === null) return;
    await trackAudit(async () => recordAudit(await map(data)));
  });
}

// Permanent task deletes publish task.purged per task. Within a request they
// are collected and written as one entry per project when it ends (see
// flushPurgedTasks); background purges are not audited one by one.
void subscribeToEvent<EventData>("task.purged", async (data) => {
  const store = auditContext.getStore();
  const projectId = str(data?.projectId);
  if (!store || !projectId) return;
  store.purgedTasks ??= [];
  store.purgedTasks.push({ projectId, title: str(data.title) });
});

const MAX_TITLES = 10;

/** Writes the request's collected task purges as one entry per project. */
export async function flushPurgedTasks(
  store: AuditRequestStore,
  action: AuditAction,
): Promise<void> {
  const purged = store.purgedTasks ?? [];
  store.purgedTasks = [];
  if (purged.length === 0) return;
  const byProject = new Map<string, (string | null)[]>();
  for (const { projectId, title } of purged) {
    byProject.set(projectId, [...(byProject.get(projectId) ?? []), title]);
  }
  const projects = await db
    .select({
      id: projectTable.id,
      workspaceId: projectTable.workspaceId,
      name: projectTable.name,
    })
    .from(projectTable)
    .where(inArray(projectTable.id, [...byProject.keys()]));
  await recordAudit(
    projects.map((row) => {
      const titles = byProject.get(row.id) ?? [];
      return {
        workspaceId: row.workspaceId,
        action,
        target: { type: "project", id: row.id, label: row.name },
        metadata: {
          count: titles.length,
          tasks: titles.filter(Boolean).slice(0, MAX_TITLES),
        },
      };
    }),
  );
}
