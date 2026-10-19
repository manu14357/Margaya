import { createId } from "@paralleldrive/cuid2";
import { and, eq, inArray } from "drizzle-orm";
import db from "../../database";
import {
  pageTable,
  projectTable,
  taskTable,
  webhookDeliveryTable,
  workspaceTable,
  workspaceWebhookTable,
} from "../../database/schema";
import { triageTaskIds } from "../../intake/guards";
import { isTriageStatus } from "../../plugins/registry";
import {
  type Locator,
  type MappedSource,
  matchesPatterns,
  type Payload,
  type ProjectRef,
  webhookSourceFor,
} from "../catalog";
import {
  type ActorRef,
  deliverySummary,
  privateData,
  serializeEnvelope,
  type WorkspaceRef,
} from "../envelope";
import { actorOf, loadSnapshot, type Snapshot } from "../snapshots";
import { COALESCE_DELAY_MS, DEFAULT_MAX_ATTEMPTS } from "../types";
import { kickWebhookDispatcher } from "./dispatcher";

// Turns one internal bus event into deliveries (B13a §3.4). Runs in an
// in-process subscriber after the mutation and never throws into the
// publisher. Nothing beyond the webhook lookup runs for a workspace without
// a matching active webhook.

type Target = { id: string; events: string[] };

type ProjectContext = ProjectRef & { timeTrackingEnabled: boolean };

type Context = {
  workspace: WorkspaceRef;
  project: ProjectContext | null;
};

/** The workspace's active webhooks, found from whatever the event carries. */
async function activeWebhooks(
  locator: Locator,
): Promise<{ workspaceId: string; targets: Target[] } | null> {
  const columns = {
    id: workspaceWebhookTable.id,
    events: workspaceWebhookTable.events,
    workspaceId: workspaceWebhookTable.workspaceId,
  };
  const active = eq(workspaceWebhookTable.isActive, true);
  let rows: { id: string; events: string[]; workspaceId: string }[] = [];
  if (locator.workspaceId) {
    rows = await db
      .select(columns)
      .from(workspaceWebhookTable)
      .where(
        and(eq(workspaceWebhookTable.workspaceId, locator.workspaceId), active),
      );
  } else if (locator.projectId) {
    rows = await db
      .select(columns)
      .from(workspaceWebhookTable)
      .innerJoin(
        projectTable,
        eq(projectTable.workspaceId, workspaceWebhookTable.workspaceId),
      )
      .where(and(eq(projectTable.id, locator.projectId), active));
  } else if (locator.taskId) {
    rows = await db
      .select(columns)
      .from(workspaceWebhookTable)
      .innerJoin(
        projectTable,
        eq(projectTable.workspaceId, workspaceWebhookTable.workspaceId),
      )
      .innerJoin(taskTable, eq(taskTable.projectId, projectTable.id))
      .where(and(eq(taskTable.id, locator.taskId), active));
  }
  const first = rows[0];
  if (!first) return null;
  return {
    workspaceId: first.workspaceId,
    targets: rows.map((row) => ({ id: row.id, events: row.events })),
  };
}

async function loadContext(
  workspaceId: string,
  locator: Locator,
  source: MappedSource,
  payload: Payload,
): Promise<Context | null> {
  const [row] = await db
    .select({
      id: workspaceTable.id,
      name: workspaceTable.name,
      slug: workspaceTable.slug,
      deletionDueAt: workspaceTable.deletionDueAt,
    })
    .from(workspaceTable)
    .where(eq(workspaceTable.id, workspaceId))
    .limit(1);
  // Webhooks are paused while the workspace is pending deletion.
  if (!row || row.deletionDueAt) return null;
  const workspace = { id: row.id, name: row.name, slug: row.slug };

  const projectColumns = {
    id: projectTable.id,
    name: projectTable.name,
    slug: projectTable.slug,
    timeTrackingEnabled: projectTable.timeTrackingEnabled,
  };
  let project: ProjectContext | null = null;
  if (locator.projectId) {
    [project = null] = await db
      .select(projectColumns)
      .from(projectTable)
      .where(
        and(
          eq(projectTable.id, locator.projectId),
          eq(projectTable.workspaceId, workspaceId),
        ),
      )
      .limit(1);
  } else if (locator.taskId) {
    [project = null] = await db
      .select(projectColumns)
      .from(taskTable)
      .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
      .where(
        and(
          eq(taskTable.id, locator.taskId),
          eq(projectTable.workspaceId, workspaceId),
        ),
      )
      .limit(1);
  }
  if (!project) {
    const gone = source.projectFromPayload?.(payload);
    if (gone) project = { ...gone, timeTrackingEnabled: false };
  }
  return { workspace, project };
}

/** Public pages among `ids` (P1). */
async function publicPageIds(ids: readonly string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({ id: pageTable.id })
    .from(pageTable)
    .where(
      and(inArray(pageTable.id, [...ids]), eq(pageTable.access, "public")),
    );
  const found = new Set(rows.map((row) => row.id));
  return ids.filter((id) => found.has(id));
}

function strings(payload: Payload, key: string): string[] {
  const value = payload[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

type Built = { data: Snapshot; changes: Record<string, unknown> | null };

/** Page events (P1): only public pages leave Margaya. */
async function pageEvent(
  source: MappedSource,
  payload: Payload,
  entityId: string | null,
  projectId: string | null,
): Promise<Built | null> {
  const changes = source.changes(payload);
  if (source.internal === "page.deleted") {
    if (payload.access !== "public") return null;
    return { data: source.payloadData?.(payload) ?? {}, changes };
  }
  if (
    source.internal === "page.access_changed" &&
    payload.access === "private"
  ) {
    // Tells consumers to drop the pages; nothing else about them.
    return {
      data: privateData(entityId, projectId, {
        affectedPageIds: strings(payload, "affectedPageIds"),
      }),
      changes,
    };
  }
  const data = await loadSnapshot("page", entityId);
  if (data?.access !== "public") return null;
  const subtree =
    source.internal === "page.moved"
      ? strings(payload, "pageIds")
      : strings(payload, "affectedPageIds");
  if (subtree.length > 0 && source.internal !== "page.access_changed") {
    return {
      data,
      changes: { ...changes, affectedPageIds: await publicPageIds(subtree) },
    };
  }
  return { data, changes };
}

/** View events (P2): only shared views leave Margaya. */
async function viewEvent(
  source: MappedSource,
  payload: Payload,
  entityId: string | null,
  projectId: string | null,
): Promise<Built | null> {
  const changes = source.changes(payload);
  if (payload.access === "private") {
    const madePrivate =
      source.internal === "view.updated" &&
      strings(payload, "changes").includes("access");
    return madePrivate
      ? { data: privateData(entityId, projectId), changes }
      : null;
  }
  if (source.payloadData) {
    return { data: source.payloadData(payload), changes };
  }
  const data = await loadSnapshot("view", entityId);
  if (data?.access !== "workspace") return null;
  return { data, changes };
}

async function buildData(
  source: MappedSource,
  payload: Payload,
  context: Context,
  actor: ActorRef | null,
): Promise<Built | null> {
  const entityId = source.entityId(payload);
  const projectId = context.project?.id ?? null;
  if (source.privacy.includes("page")) {
    return pageEvent(source, payload, entityId, projectId);
  }
  if (source.privacy.includes("view")) {
    return viewEvent(source, payload, entityId, projectId);
  }
  const changes = source.changes(payload);
  if (source.payloadData) {
    return { data: source.payloadData(payload), changes };
  }
  if (source.entity === "reaction") {
    return {
      data: {
        taskId: payload.taskId ?? null,
        commentId: payload.commentId ?? null,
        emoji: payload.emoji ?? null,
        user: actor,
      },
      changes,
    };
  }
  if (source.internal === "cycle.tasks_changed") {
    const cycleIds = strings(payload, "cycleIds");
    const cycles = await Promise.all(
      cycleIds.map((id) => loadSnapshot("cycle", id)),
    );
    return {
      data: {
        cycleIds,
        taskIds: strings(payload, "taskIds"),
        cycles: cycles.filter((cycle) => cycle !== null),
      },
      changes,
    };
  }
  // A row deleted before the event got here falls back to its identifiers.
  const data = (await loadSnapshot(source.entity, entityId)) ?? {
    id: entityId,
    projectId,
  };
  if (source.entity === "comment") {
    // Where the comment was written; the row does not store it (B12 K18).
    data.origin = payload.origin === "public_board" ? "public_board" : "app";
  }
  return { data, changes };
}

/** Whether a privacy or scope filter drops the event (P3, P4). */
async function filteredOut(
  source: MappedSource,
  payload: Payload,
  locator: Locator,
  context: Context,
): Promise<boolean> {
  if (source.privacy.includes("time_tracking")) {
    if (!context.project?.timeTrackingEnabled) return true;
  }
  if (source.privacy.includes("triage")) {
    const taskId =
      locator.taskId ??
      (typeof payload.taskId === "string" ? payload.taskId : null);
    // The row may be gone (or trashed): the payload's status tells.
    if (
      source.internal === "task.deleted" ||
      source.internal === "task.purged"
    ) {
      const status = typeof payload.status === "string" ? payload.status : null;
      const projectId = context.project?.id;
      return Boolean(
        status && projectId && (await isTriageStatus(projectId, status)),
      );
    }
    if (taskId && (await triageTaskIds([taskId])).length > 0) return true;
  }
  return false;
}

type DeliveryInsert = typeof webhookDeliveryTable.$inferInsert;

/**
 * Rewrites the waiting delivery of a coalescable event (K14), keeping its
 * id and schedule, or inserts a new one 60 s out. A concurrent insert of the
 * same key retries the rewrite once.
 */
async function upsertCoalesced(
  key: string,
  base: Omit<DeliveryInsert, "id" | "body">,
  bodyFor: (id: string) => string,
  now: Date,
): Promise<void> {
  const waiting = and(
    eq(webhookDeliveryTable.webhookId, base.webhookId),
    eq(webhookDeliveryTable.coalesceKey, key),
    eq(webhookDeliveryTable.status, "pending"),
    eq(webhookDeliveryTable.attemptCount, 0),
  );
  for (let round = 0; round < 2; round += 1) {
    const [existing] = await db
      .select({ id: webhookDeliveryTable.id })
      .from(webhookDeliveryTable)
      .where(waiting)
      .limit(1);
    if (existing) {
      const updated = await db
        .update(webhookDeliveryTable)
        .set({
          body: bodyFor(existing.id),
          summary: base.summary,
          entityId: base.entityId,
          projectId: base.projectId,
        })
        .where(and(eq(webhookDeliveryTable.id, existing.id), waiting))
        .returning({ id: webhookDeliveryTable.id });
      if (updated.length > 0) return;
    }
    const id = createId();
    try {
      await db.insert(webhookDeliveryTable).values({
        ...base,
        id,
        body: bodyFor(id),
        coalesceKey: key,
        nextAttemptAt: new Date(now.getTime() + COALESCE_DELAY_MS),
      });
      return;
    } catch (error) {
      if ((error as { code?: string }).code !== "23505" || round > 0) {
        throw error;
      }
    }
  }
}

/**
 * Queues one delivery per matching active webhook for an internal event.
 * Returns how many deliveries were written (coalesced rewrites included).
 */
export async function enqueueWebhookEvent(
  internalEvent: string,
  payload: Payload,
  occurredAt: Date = new Date(),
): Promise<number> {
  const source = webhookSourceFor(internalEvent);
  if (!source || source.skip?.(payload)) return 0;

  const locator = source.locate(payload);
  const found = await activeWebhooks(locator);
  if (!found) return 0;
  const targets = found.targets.filter((target) =>
    matchesPatterns(target.events, source.event),
  );
  if (targets.length === 0) return 0;

  const context = await loadContext(
    found.workspaceId,
    locator,
    source,
    payload,
  );
  if (!context) return 0;
  if (await filteredOut(source, payload, locator, context)) return 0;

  const actor = await actorOf(source.actor(payload));
  const built = await buildData(source, payload, context, actor);
  if (!built) return 0;

  const entityId = source.entityId(payload);
  const project = context.project
    ? {
        id: context.project.id,
        name: context.project.name,
        slug: context.project.slug,
      }
    : null;
  const bodyFor = (target: Target) => (id: string) =>
    serializeEnvelope({
      deliveryId: id,
      event: source.event,
      occurredAt,
      webhookId: target.id,
      workspace: context.workspace,
      project,
      actor,
      data: built.data,
      changes: built.changes,
    }).body;
  const base = (target: Target) => ({
    webhookId: target.id,
    workspaceId: context.workspace.id,
    event: source.event,
    entityType: source.entity,
    entityId,
    projectId: project?.id ?? null,
    summary: deliverySummary(source.event, entityId, built.data),
    status: "pending" as const,
    trigger: "event" as const,
    maxAttempts: DEFAULT_MAX_ATTEMPTS,
  });

  const coalesceKey = source.coalesceKey?.(payload) ?? null;
  if (coalesceKey) {
    for (const target of targets) {
      await upsertCoalesced(
        coalesceKey,
        base(target),
        bodyFor(target),
        occurredAt,
      );
    }
  } else {
    await db.insert(webhookDeliveryTable).values(
      targets.map((target) => {
        const id = createId();
        return {
          ...base(target),
          id,
          body: bodyFor(target)(id),
          nextAttemptAt: occurredAt,
        };
      }),
    );
  }

  void kickWebhookDispatcher();
  return targets.length;
}

const inFlight = new Set<Promise<unknown>>();

/**
 * Enqueues in the background for a bus subscriber: failures are logged
 * with the event name and entity id only, never thrown at the publisher.
 */
export function enqueueInBackground(
  internalEvent: string,
  payload: Payload,
): Promise<void> {
  const occurredAt = new Date();
  const run = enqueueWebhookEvent(internalEvent, payload, occurredAt)
    .then(() => undefined)
    .catch((error: unknown) => {
      const entityId = webhookSourceFor(internalEvent)?.entityId(payload);
      console.error(
        `webhooks: could not queue ${internalEvent} for ${entityId ?? "unknown"}: ${
          (error as { code?: string })?.code ?? "error"
        }`,
      );
    })
    .finally(() => {
      inFlight.delete(run);
    });
  inFlight.add(run);
  return run;
}

/** Resolves once every background enqueue started so far has finished. */
export async function settleWebhookEnqueues(): Promise<void> {
  while (inFlight.size > 0) {
    await Promise.all([...inFlight]);
  }
}
