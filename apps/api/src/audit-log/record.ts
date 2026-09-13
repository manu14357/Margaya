import { eq, inArray } from "drizzle-orm";
import db from "../database";
import {
  apikeyTable,
  auditLogTable,
  userTable,
  workspaceTable,
} from "../database/schema";
import type { AuditAction, AuditActorType, AuditTarget } from "./actions";
import { type AuditActorHint, auditContext, requestActor } from "./context";
import { redactMetadata } from "./redact";

export type AuditInput = {
  workspaceId: string;
  action: AuditAction;
  target?: AuditTarget | null;
  metadata?: Record<string, unknown> | null;
  /** Who acted when the request does not say (events, background work). */
  actor?: AuditActorHint | null;
};

type AuditRow = typeof auditLogTable.$inferInsert;

const MAX_LABEL = 200;

// Indirection so tests can make the write fail.
export const auditWriter = {
  async insert(rows: AuditRow[]) {
    await db.insert(auditLogTable).values(rows);
  },
};

const pending = new Set<Promise<void>>();

/** Waits for audit writes started so far (tests and graceful shutdown). */
export async function settleAuditWrites(): Promise<void> {
  while (pending.size > 0) await Promise.allSettled([...pending]);
}

async function actorOf(hint: AuditActorHint | null): Promise<{
  actorType: AuditActorType;
  actorUserId: string | null;
  apiKeyId: string | null;
  actorName: string | null;
}> {
  const userId = hint?.userId || null;
  const apiKeyId = hint?.apiKeyId || null;
  if (apiKeyId) {
    const [key] = await db
      .select({ name: apikeyTable.name })
      .from(apikeyTable)
      .where(eq(apikeyTable.id, apiKeyId))
      .limit(1);
    return {
      actorType: "api_key",
      actorUserId: userId,
      apiKeyId,
      actorName: key?.name ?? null,
    };
  }
  if (userId) {
    const [user] = await db
      .select({ name: userTable.name, email: userTable.email })
      .from(userTable)
      .where(eq(userTable.id, userId))
      .limit(1);
    return {
      actorType: "user",
      // A user deleted meanwhile keeps the name, not a dangling reference.
      actorUserId: user ? userId : null,
      apiKeyId: null,
      actorName: user?.name || user?.email || null,
    };
  }
  return {
    actorType: "system",
    actorUserId: null,
    apiKeyId: null,
    actorName: null,
  };
}

async function existingWorkspaceIds(ids: string[]) {
  const rows = await db
    .select({ id: workspaceTable.id })
    .from(workspaceTable)
    .where(inArray(workspaceTable.id, ids));
  return new Set(rows.map((row) => row.id));
}

async function write(inputs: AuditInput[]) {
  const store = auditContext.getStore();
  const fromRequest = requestActor(store);
  const workspaces = await existingWorkspaceIds([
    ...new Set(inputs.map((input) => input.workspaceId)),
  ]);
  const rows: AuditRow[] = [];
  const actors = new Map<string, Awaited<ReturnType<typeof actorOf>>>();
  for (const input of inputs) {
    // A workspace deleted in the same request has nowhere to log to.
    if (!workspaces.has(input.workspaceId)) continue;
    const hint = fromRequest ?? input.actor ?? null;
    const key = `${hint?.userId ?? ""}|${hint?.apiKeyId ?? ""}`;
    const actor = actors.get(key) ?? (await actorOf(hint));
    actors.set(key, actor);
    rows.push({
      workspaceId: input.workspaceId,
      ...actor,
      action: input.action,
      targetType: input.target?.type ?? null,
      targetId: input.target?.id ?? null,
      targetLabel: input.target?.label?.slice(0, MAX_LABEL) ?? null,
      metadata: redactMetadata(input.metadata),
      ipAddress: store?.ip ?? null,
      userAgent: store?.userAgent ?? null,
    });
  }
  if (rows.length > 0) await auditWriter.insert(rows);
}

/**
 * Runs audit work so settleAuditWrites can wait for it. Never throws: a
 * failure is logged and the action it describes stands.
 */
export async function trackAudit(work: () => Promise<void>): Promise<void> {
  const task = work().catch((error) => {
    console.error("Failed to write audit log entry:", error);
  });
  pending.add(task);
  try {
    await task;
  } finally {
    pending.delete(task);
  }
}

/** Appends audit entries; never throws. */
export async function recordAudit(
  input: AuditInput | AuditInput[] | null | undefined,
): Promise<void> {
  const inputs = (Array.isArray(input) ? input : input ? [input] : []).filter(
    (entry) => Boolean(entry.workspaceId),
  );
  if (inputs.length === 0) return;
  await trackAudit(() => write(inputs));
}
