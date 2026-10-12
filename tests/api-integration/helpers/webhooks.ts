import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq } from "drizzle-orm";
import db, { schema } from "../../../apps/api/src/database";
import { processDueDeliveries } from "../../../apps/api/src/webhook/dispatch/dispatcher";
import { settleWebhookEnqueues } from "../../../apps/api/src/webhook/dispatch/enqueue";
import { draftScene } from "./drafts";

type User = typeof schema.userTable.$inferSelect;

export type WebhookJson = {
  id: string;
  workspaceId: string;
  name: string | null;
  url: string;
  events: string[];
  isActive: boolean;
  disabledReason: "manual" | "failures" | null;
  disabledAt: string | null;
  secretHint: string;
  secretRotatedAt: string | null;
  previousSecretExpiresAt: string | null;
  secretStatus: "ok" | "unreadable";
  health: {
    lastSuccessAt: string | null;
    lastFailureAt: string | null;
    failureStreak: number;
    failingSince: string | null;
  };
  createdBy: { id: string; name: string; image: string | null } | null;
  createdAt: string;
  updatedAt: string;
  pendingDeliveries?: number;
  secret?: string;
};

export type DeliveryJson = {
  id: string;
  webhookId: string;
  event: string;
  entityType: string;
  entityId: string | null;
  projectId: string | null;
  summary: string | null;
  status: "pending" | "sending" | "succeeded" | "failed" | "cancelled";
  trigger: "event" | "redelivery" | "ping";
  redeliveryOf: string | null;
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: string | null;
  responseStatus: number | null;
  error: string | null;
  durationMs: number | null;
  createdAt: string;
  completedAt: string | null;
  attempts?: {
    at: string;
    responseStatus: number | null;
    error: string | null;
    durationMs: number | null;
  }[];
  responseSnippet?: string | null;
  requestHeaders?: Record<string, string>;
  requestBody?: Record<string, unknown>;
};

export type Received = {
  path: string;
  headers: IncomingHttpHeaders;
  body: string;
};

type Scripted = {
  status: number;
  headers?: Record<string, string>;
  body?: string;
  delayMs?: number;
};

/**
 * A local HTTP receiver on 127.0.0.1 that records every request and answers
 * with scripted responses (200 once the script runs out).
 */
export async function startReceiver() {
  const received: Received[] = [];
  const script: Scripted[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      received.push({
        path: req.url ?? "/",
        headers: req.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      });
      const next = script.shift() ?? { status: 200 };
      const answer = () => {
        if (res.destroyed) return;
        res.writeHead(next.status, next.headers);
        res.end(next.body ?? "ok");
      };
      if (next.delayMs) setTimeout(answer, next.delayMs);
      else answer();
    });
  });
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  const { port } = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${port}`;
  return {
    origin,
    url: (path = "/hook") => `${origin}${path}`,
    received,
    respond: (...responses: Scripted[]) => {
      script.push(...responses);
    },
    /** Forgets recorded requests and unused scripted responses. */
    reset: () => {
      received.length = 0;
      script.length = 0;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

export type Receiver = Awaited<ReturnType<typeof startReceiver>>;

export async function deliveryRows(webhookId?: string) {
  const query = db.select().from(schema.webhookDeliveryTable);
  const rows = webhookId
    ? await query.where(eq(schema.webhookDeliveryTable.webhookId, webhookId))
    : await query;
  return rows.sort(
    (a, b) =>
      a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
  );
}

export async function webhookRow(id: string) {
  const [row] = await db
    .select()
    .from(schema.workspaceWebhookTable)
    .where(eq(schema.workspaceWebhookTable.id, id));
  return row ?? null;
}

/** Waits for background enqueues, then runs the dispatcher once at `now`. */
export async function dispatch(now: Date = new Date()) {
  await settleWebhookEnqueues();
  return processDueDeliveries(now);
}

/**
 * The draft scene (Owen owner, Ada admin, Mia member, Vic viewer, an
 * outsider; projects "web" and "api") plus webhook calls.
 */
export async function webhookScene() {
  const s = await draftScene();

  const createWebhook = (
    user: User,
    body: Record<string, unknown>,
  ): Promise<WebhookJson> =>
    s.ok<WebhookJson>(user, "POST", "/webhook", {
      workspaceId: s.workspaceId,
      ...body,
    });

  const createTask = async (
    values: Partial<typeof schema.taskTable.$inferInsert> = {},
  ) => {
    const [task] = await db
      .insert(schema.taskTable)
      .values({
        projectId: s.web.project.id,
        title: "Fix login",
        number: 1,
        status: "to-do",
        priority: "medium",
        ...values,
      })
      .returning();
    if (!task) throw new Error("Failed to create task");
    return task;
  };

  return { ...s, createWebhook, createTask };
}

export type WebhookScene = Awaited<ReturnType<typeof webhookScene>>;
