import { and, count, eq, isNull, ne, or } from "drizzle-orm";
import { z } from "zod";
import db from "../database";
import {
  a2aPushConfigTable,
  a2aTaskTable,
  aiRunTable,
  intakeItemTable,
  workspaceTable,
  workspaceUserTable,
} from "../database/schema";
import { subscribeToEvent } from "../events";
import { INTAKE_ITEM_UPDATED } from "../intake/events";
import { assertPublicDestination } from "../utils/assert-public-destination";
import {
  OutboundRequestError,
  sendOutboundRequest,
} from "../utils/outbound-request";
import { openSecret, sealSecret } from "../utils/secret-box";
import type { A2aRow, BrokerContext } from "./broker";
import {
  A2A_ERRORS,
  A2aError,
  intakeState,
  runState,
  type TaskState,
} from "./protocol";

// A2A push notifications. A caller registers an HTTPS endpoint for one of
// its own tasks; when the work behind the task changes state (an agent run
// finishes, a request is triaged), Margaya POSTs a StreamResponse carrying
// only the new status to that endpoint. The body holds no task content:
// the receiver calls GetTask, with its own credential, for artifacts.
// Endpoints pass the same outbound checks as webhooks (no private or
// loopback destinations, no redirects), and the caller's token and
// credentials are sealed at rest and never returned.

export const MAX_CONFIGS_PER_TASK = 5;
const SECRET_PURPOSE = "a2a-push";
const DELIVERY_TIMEOUT_MS = 15_000;
const RETRY_DELAYS_MS = [1_000, 4_000];

const tenant = z.string().min(1).max(128).optional();

const authentication = z.looseObject({
  scheme: z
    .string()
    .regex(/^[A-Za-z][A-Za-z0-9!#$%&'*+.^_`|~-]{0,31}$/, "Invalid scheme"),
  credentials: z.string().min(1).max(4_096).optional(),
});

const configFields = z.looseObject({
  id: z.string().min(1).max(128).optional(),
  url: z.string().min(1).max(2_048),
  token: z.string().min(1).max(512).optional(),
  authentication: authentication.optional(),
});

/** CreateTaskPushNotificationConfig params (flat, or the older nested form). */
export const createPushConfigParams = z
  .looseObject({
    tenant,
    taskId: z.string().min(1).max(128),
    url: z.string().optional(),
    pushNotificationConfig: configFields.optional(),
  })
  .transform((params, ctx) => {
    const config = configFields.safeParse(
      params.pushNotificationConfig ?? params,
    );
    if (!config.success) {
      ctx.addIssue({ code: "custom", message: "Invalid push config" });
      return z.NEVER;
    }
    return {
      tenant: params.tenant,
      taskId: params.taskId,
      config: config.data,
    };
  });

export const pushConfigIdParams = z.looseObject({
  tenant,
  taskId: z.string().min(1).max(128),
  id: z.string().min(1).max(128),
});

export const listPushConfigParams = z.looseObject({
  tenant,
  taskId: z.string().min(1).max(128),
  pageSize: z.number().int().min(1).max(100).optional(),
  pageToken: z.string().max(512).optional(),
});

export type PushConfigInput = z.infer<typeof configFields>;

/** A push config from SendMessage's configuration (flat or nested). */
export function parsePushConfig(value: unknown): PushConfigInput {
  const nested =
    value && typeof value === "object" && "pushNotificationConfig" in value
      ? (value as { pushNotificationConfig: unknown }).pushNotificationConfig
      : value;
  const parsed = configFields.safeParse(nested);
  if (!parsed.success) {
    throw new A2aError(A2A_ERRORS.invalidParams, "Invalid push config");
  }
  return parsed.data;
}

function privateDestinationsAllowed(): boolean {
  const value = process.env.MARGAYA_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS;
  return value === "true" || value === "1";
}

/** Throws InvalidParams unless the URL may receive pushes. */
export async function assertPushUrl(value: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new A2aError(A2A_ERRORS.invalidParams, "Invalid push URL");
  }
  const httpsOnly = !privateDestinationsAllowed();
  if (
    url.username ||
    url.password ||
    url.hash ||
    (url.protocol !== "https:" && (httpsOnly || url.protocol !== "http:"))
  ) {
    throw new A2aError(
      A2A_ERRORS.invalidParams,
      "The push URL must be https, without credentials or a fragment",
    );
  }
  try {
    await assertPublicDestination(value, "Push notification");
  } catch {
    throw new A2aError(
      A2A_ERRORS.invalidParams,
      "The push URL must reach a public address",
    );
  }
}

type ConfigRow = typeof a2aPushConfigTable.$inferSelect;

/** A config as A2A shows it: secrets never leave the server. */
export function pushConfigView(row: ConfigRow) {
  return {
    id: row.id,
    taskId: row.a2aTaskId,
    url: row.url,
    ...(row.authScheme ? { authentication: { scheme: row.authScheme } } : {}),
  };
}

export function pushable(row: A2aRow): row is A2aRow & {
  refKind: "intake" | "ai_run";
  refId: string;
} {
  return (
    !row.finalState &&
    (row.refKind === "intake" || row.refKind === "ai_run") &&
    Boolean(row.refId)
  );
}

export async function createPushConfig(
  ctx: BrokerContext,
  row: A2aRow,
  input: PushConfigInput,
) {
  if (!pushable(row)) {
    throw new A2aError(
      A2A_ERRORS.unsupportedOperation,
      "This task is already complete; it will not change again",
    );
  }
  await assertPushUrl(input.url);
  const [existing] = await db
    .select({ value: count() })
    .from(a2aPushConfigTable)
    .where(eq(a2aPushConfigTable.a2aTaskId, row.id));
  if ((existing?.value ?? 0) >= MAX_CONFIGS_PER_TASK) {
    throw new A2aError(
      A2A_ERRORS.invalidParams,
      `A task takes at most ${MAX_CONFIGS_PER_TASK} push configs`,
    );
  }
  const [created] = await db
    .insert(a2aPushConfigTable)
    .values({
      a2aTaskId: row.id,
      workspaceId: ctx.workspace.id,
      userId: ctx.userId,
      refKind: row.refKind,
      refId: row.refId,
      url: input.url,
      tokenSealed: input.token ? sealSecret(SECRET_PURPOSE, input.token) : null,
      authScheme: input.authentication?.scheme ?? null,
      authCredentialsSealed: input.authentication?.credentials
        ? sealSecret(SECRET_PURPOSE, input.authentication.credentials)
        : null,
    })
    .returning();
  if (!created) throw new A2aError(A2A_ERRORS.internal, "Could not save");
  return pushConfigView(created);
}

async function configOf(row: A2aRow, id: string): Promise<ConfigRow> {
  const [config] = await db
    .select()
    .from(a2aPushConfigTable)
    .where(
      and(
        eq(a2aPushConfigTable.id, id),
        eq(a2aPushConfigTable.a2aTaskId, row.id),
      ),
    )
    .limit(1);
  if (!config) {
    throw new A2aError(A2A_ERRORS.invalidParams, "Push config not found");
  }
  return config;
}

export async function getPushConfig(row: A2aRow, id: string) {
  return pushConfigView(await configOf(row, id));
}

export async function listPushConfigs(row: A2aRow) {
  const rows = await db
    .select()
    .from(a2aPushConfigTable)
    .where(eq(a2aPushConfigTable.a2aTaskId, row.id))
    .orderBy(a2aPushConfigTable.createdAt);
  return { configs: rows.map(pushConfigView), nextPageToken: "" };
}

/** Idempotent: deleting a config that is gone succeeds. */
export async function deletePushConfig(row: A2aRow, id: string) {
  await db
    .delete(a2aPushConfigTable)
    .where(
      and(
        eq(a2aPushConfigTable.id, id),
        eq(a2aPushConfigTable.a2aTaskId, row.id),
      ),
    );
  return {};
}

/** The A2A state of the work behind a ref, read from the database. */
async function currentState(
  refKind: "intake" | "ai_run",
  refId: string,
): Promise<TaskState | null> {
  if (refKind === "ai_run") {
    const [run] = await db
      .select({ status: aiRunTable.status })
      .from(aiRunTable)
      .where(eq(aiRunTable.id, refId))
      .limit(1);
    return run ? runState(run.status) : null;
  }
  const [item] = await db
    .select({ status: intakeItemTable.status })
    .from(intakeItemTable)
    .where(eq(intakeItemTable.id, refId))
    .limit(1);
  return item ? intakeState(item.status) : null;
}

/** The StreamResponse body of a push: the new status, nothing else. */
export function pushBody(
  task: { id: string; contextId: string },
  state: TaskState,
  at: Date,
) {
  return {
    statusUpdate: {
      taskId: task.id,
      contextId: task.contextId,
      status: { state, timestamp: at.toISOString() },
    },
  };
}

function readSecret(sealed: string | null): string | null {
  if (!sealed) return null;
  try {
    return openSecret(SECRET_PURPOSE, sealed);
  } catch {
    return null;
  }
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

async function deliver(
  config: ConfigRow,
  task: { id: string; contextId: string },
  state: TaskState,
): Promise<void> {
  const headers: Record<string, string> = {
    "content-type": "application/a2a+json",
  };
  const token = readSecret(config.tokenSealed);
  if (token) headers["x-a2a-notification-token"] = token;
  const credentials = readSecret(config.authCredentialsSealed);
  if (config.authScheme && credentials) {
    headers.authorization = `${config.authScheme} ${credentials}`;
  }
  const body = JSON.stringify(pushBody(task, state, new Date()));
  let lastError: string | null = null;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      await sendOutboundRequest(
        config.url,
        { headers, body },
        { publicDestination: true, timeoutMs: DELIVERY_TIMEOUT_MS },
      );
      lastError = null;
      break;
    } catch (error) {
      lastError =
        error instanceof OutboundRequestError
          ? `${error.reason}${error.status ? ` ${error.status}` : ""}`
          : "failed";
      // A refused destination will not get better by retrying.
      if (
        error instanceof OutboundRequestError &&
        error.reason === "destination"
      ) {
        break;
      }
      const delay = RETRY_DELAYS_MS[attempt];
      if (delay !== undefined) await sleep(delay);
    }
  }
  await db
    .update(a2aPushConfigTable)
    .set({ lastDeliveredAt: new Date(), lastError })
    .where(eq(a2aPushConfigTable.id, config.id));
}

/** Whether the config's person still reaches the workspace over A2A. */
async function stillAllowed(config: ConfigRow): Promise<boolean> {
  const [member] = await db
    .select({ id: workspaceUserTable.id })
    .from(workspaceUserTable)
    .innerJoin(
      workspaceTable,
      eq(workspaceTable.id, workspaceUserTable.workspaceId),
    )
    .where(
      and(
        eq(workspaceUserTable.workspaceId, config.workspaceId),
        eq(workspaceUserTable.userId, config.userId),
        eq(workspaceTable.allowA2a, true),
      ),
    )
    .limit(1);
  return Boolean(member);
}

/**
 * Sends each config of a ref its new state, once per state change. Safe
 * to call for any event: refs without configs cost one indexed query.
 */
export async function pushStateChange(
  refKind: "intake" | "ai_run",
  refId: string,
): Promise<void> {
  const configs = await db
    .select({
      config: a2aPushConfigTable,
      task: { id: a2aTaskTable.id, contextId: a2aTaskTable.contextId },
    })
    .from(a2aPushConfigTable)
    .innerJoin(a2aTaskTable, eq(a2aTaskTable.id, a2aPushConfigTable.a2aTaskId))
    .where(
      and(
        eq(a2aPushConfigTable.refKind, refKind),
        eq(a2aPushConfigTable.refId, refId),
      ),
    );
  if (configs.length === 0) return;
  const state = await currentState(refKind, refId);
  if (!state) return;
  await Promise.all(
    configs.map(async ({ config, task }) => {
      if (!(await stillAllowed(config))) return;
      // Claim the state change; a concurrent event for the same state loses.
      const [claimed] = await db
        .update(a2aPushConfigTable)
        .set({ lastState: state })
        .where(
          and(
            eq(a2aPushConfigTable.id, config.id),
            or(
              isNull(a2aPushConfigTable.lastState),
              ne(a2aPushConfigTable.lastState, state),
            ),
          ),
        )
        .returning({ id: a2aPushConfigTable.id });
      if (!claimed) return;
      await deliver(config, task, state);
    }),
  );
}

subscribeToEvent<{ runId?: string }>("ai.run_updated", async (data) => {
  if (data.runId) await pushStateChange("ai_run", data.runId);
});

subscribeToEvent<{ intakeItemId?: string }>(
  INTAKE_ITEM_UPDATED,
  async (data) => {
    if (data.intakeItemId) await pushStateChange("intake", data.intakeItemId);
  },
);
