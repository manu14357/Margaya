import type { Context } from "hono";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { getAiInstanceConfig } from "../ai/instance-config";
import { authenticateMcpRequest } from "../mcp";
import { publicApiOrigin } from "../mcp/metadata";
import { apiRouter } from "../openapi";
import { boundedRequestBody } from "../utils/bounded-request-body";
import { a2aApi } from "./api";
import {
  a2aTenantsOf,
  anyWorkspaceAllowsA2a,
  type BrokerContext,
  cancelTask,
  describeTask,
  getTask,
  isAgentUser,
  listTasks,
  readA2aRow,
  resolveTenant,
  sendMessage,
  waitForTask,
} from "./broker";
import { buildAgentCard } from "./card";
import {
  A2A_ERRORS,
  A2A_PROTOCOL_VERSION,
  A2aError,
  type A2aTask,
  isTerminal,
  jsonRpcRequest,
  listTasksParams,
  parseParams,
  sendMessageParams,
  taskIdParams,
  tenantParams,
  versionSupported,
} from "./protocol";
import {
  createPushConfig,
  createPushConfigParams,
  deletePushConfig,
  getPushConfig,
  listPushConfigParams,
  listPushConfigs,
  pushConfigIdParams,
} from "./push";
import { AGENT_CARD_JWKS_PATH, agentCardJwks, signAgentCard } from "./signing";

// Margaya as an A2A server (A2A 1.0, JSON-RPC binding). Off until a
// workspace turns it on; the card is not served before any workspace does.
// Authentication is the MCP endpoint's (an API key or an OAuth access
// token), and every action is an in-process call to the API's own routes
// with that credential (api.ts), so scopes, permissions, restricted
// projects and the audit log apply exactly as they do anywhere else.

/** How long a stream stays open waiting for a task to finish. */
const STREAM_WINDOW_MS = 2 * 60 * 1000;
const MAX_BODY_BYTES = 256 * 1024;

const PUSH_METHODS = new Set([
  "CreateTaskPushNotificationConfig",
  "GetTaskPushNotificationConfig",
  "ListTaskPushNotificationConfigs",
  "DeleteTaskPushNotificationConfig",
]);

type RpcId = string | number | null;

function rpcResult(id: RpcId, result: unknown) {
  return { jsonrpc: "2.0" as const, id, result };
}

function rpcError(id: RpcId, error: A2aError) {
  return {
    jsonrpc: "2.0" as const,
    id,
    error: {
      code: error.code,
      message: error.message,
      ...(error.data ? { data: error.data } : {}),
    },
  };
}

/** A card signed with the instance's key (JWS over its JCS form). */
function signedCard(card: ReturnType<typeof buildAgentCard>) {
  return signAgentCard(card, `${publicApiOrigin()}/api${AGENT_CARD_JWKS_PATH}`);
}

async function agentCard(c: Context) {
  if (!(await anyWorkspaceAllowsA2a())) {
    return c.json({ error: "not_found" }, 404);
  }
  c.header("Cache-Control", "public, max-age=60");
  return c.json(
    signedCard(
      buildAgentCard({
        baseUrl: publicApiOrigin(),
        aiEnabled: getAiInstanceConfig().enabled,
      }),
    ),
  );
}

/** The public key set that verifies card signatures. */
async function agentCardKeys(c: Context) {
  if (!(await anyWorkspaceAllowsA2a())) {
    return c.json({ error: "not_found" }, 404);
  }
  c.header("Cache-Control", "public, max-age=300");
  return c.json(agentCardJwks());
}

/** The card at the domain root, for deployments that serve the API there. */
export function a2aWellKnownRoutes() {
  const wellKnown = new Hono();
  wellKnown.get("/.well-known/agent-card.json", agentCard);
  wellKnown.get(AGENT_CARD_JWKS_PATH, agentCardKeys);
  return wellKnown;
}

function streamTask(
  c: Context,
  id: RpcId,
  ctx: BrokerContext,
  start: { task: A2aTask; row: Parameters<typeof describeTask>[1] },
) {
  c.header("Cache-Control", "no-store");
  c.header("X-Accel-Buffering", "no");
  c.header("A2A-Version", A2A_PROTOCOL_VERSION);
  return streamSSE(c, async (sse) => {
    const abort = new AbortController();
    sse.onAbort(() => abort.abort());
    const send = (result: unknown) =>
      sse.writeSSE({ data: JSON.stringify(rpcResult(id, result)) });
    await send({ task: start.task });
    if (isTerminal(start.task.status.state)) return;
    try {
      await waitForTask(
        ctx,
        start.row,
        Date.now() + STREAM_WINDOW_MS,
        async (task) => {
          if (isTerminal(task.status.state)) {
            for (const artifact of task.artifacts ?? []) {
              await send({
                artifactUpdate: {
                  taskId: task.id,
                  contextId: task.contextId,
                  artifact,
                  lastChunk: true,
                },
              });
            }
          }
          await send({
            statusUpdate: {
              taskId: task.id,
              contextId: task.contextId,
              status: task.status,
            },
          });
        },
        abort.signal,
      );
    } catch (error) {
      const failure =
        error instanceof A2aError
          ? error
          : new A2aError(A2A_ERRORS.internal, "Margaya could not do that");
      await sse.writeSSE({ data: JSON.stringify(rpcError(id, failure)) });
    }
  });
}

const a2a = apiRouter();

a2a.get("/.well-known/agent-card.json", agentCard);
a2a.get(AGENT_CARD_JWKS_PATH, agentCardKeys);

a2a.use("/a2a", boundedRequestBody(MAX_BODY_BYTES));

a2a.post("/a2a", async (c) => {
  const credential = await authenticateMcpRequest(c.req.raw);
  if (!credential) {
    const metadataUrl = `${publicApiOrigin()}/api/.well-known/oauth-protected-resource/api/a2a`;
    c.header("WWW-Authenticate", `Bearer resource_metadata="${metadataUrl}"`);
    return c.json(
      { error: "invalid_token", error_description: "Missing or invalid token" },
      401,
    );
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      rpcError(null, new A2aError(A2A_ERRORS.parse, "Parse error")),
    );
  }
  const envelope = jsonRpcRequest.safeParse(body);
  if (!envelope.success) {
    return c.json(
      rpcError(
        null,
        new A2aError(A2A_ERRORS.invalidRequest, "Invalid JSON-RPC request"),
      ),
    );
  }
  const { method, params } = envelope.data;
  const id = envelope.data.id ?? null;

  c.header("A2A-Version", A2A_PROTOCOL_VERSION);
  try {
    const header =
      c.req.header("a2a-version") ?? c.req.query("A2A-Version") ?? undefined;
    if (!versionSupported(header, method)) {
      throw new A2aError(
        A2A_ERRORS.versionNotSupported,
        `Unsupported A2A version; this server speaks ${A2A_PROTOCOL_VERSION}`,
        { supportedVersions: [A2A_PROTOCOL_VERSION] },
      );
    }
    // Agents never delegate onwards over A2A (no loops).
    if (await isAgentUser(credential.userId)) {
      throw new A2aError(
        A2A_ERRORS.invalidRequest,
        "Margaya agents can't use A2A",
      );
    }

    const baseUrl = publicApiOrigin();
    if (method === "GetExtendedAgentCard") {
      const tenants = await a2aTenantsOf(credential.userId);
      if (tenants.length === 0) {
        throw new A2aError(
          A2A_ERRORS.invalidRequest,
          "A2A is off for your workspaces",
        );
      }
      return c.json(
        rpcResult(
          id,
          signedCard(
            buildAgentCard({
              baseUrl,
              aiEnabled: getAiInstanceConfig().enabled,
              tenants: tenants.map((tenant) => tenant.slug),
            }),
          ),
        ),
      );
    }

    const known = [
      "SendMessage",
      "SendStreamingMessage",
      "GetTask",
      "ListTasks",
      "CancelTask",
      "SubscribeToTask",
      ...PUSH_METHODS,
    ];
    if (!known.includes(method)) {
      throw new A2aError(A2A_ERRORS.methodNotFound, "Method not found");
    }

    const { tenant } = parseParams(tenantParams, params);
    const workspace = await resolveTenant(credential.userId, tenant);
    const ctx: BrokerContext = {
      api: a2aApi(credential.token, {
        userAgent: c.req.header("user-agent"),
        forwardedFor: c.req.header("x-forwarded-for"),
        language: c.req.header("accept-language"),
      }),
      userId: credential.userId,
      apiKeyId: credential.apiKeyId ?? null,
      workspace,
    };

    switch (method) {
      case "SendMessage": {
        const { task } = await sendMessage(
          ctx,
          parseParams(sendMessageParams, params),
        );
        return c.json(rpcResult(id, { task }));
      }
      case "SendStreamingMessage": {
        const input = parseParams(sendMessageParams, params);
        const started = await sendMessage(ctx, {
          ...input,
          configuration: { ...input.configuration, returnImmediately: true },
        });
        return streamTask(c, id, ctx, started);
      }
      case "GetTask": {
        const { id: taskId } = parseParams(taskIdParams, params);
        return c.json(rpcResult(id, await getTask(ctx, taskId)));
      }
      case "CancelTask": {
        const { id: taskId } = parseParams(taskIdParams, params);
        return c.json(rpcResult(id, await cancelTask(ctx, taskId)));
      }
      case "ListTasks": {
        return c.json(
          rpcResult(
            id,
            await listTasks(ctx, parseParams(listTasksParams, params)),
          ),
        );
      }
      case "CreateTaskPushNotificationConfig": {
        const input = parseParams(createPushConfigParams, params);
        const row = await readA2aRow(ctx, input.taskId);
        return c.json(
          rpcResult(id, {
            ...(await createPushConfig(ctx, row, input.config)),
            ...(tenant ? { tenant } : {}),
          }),
        );
      }
      case "GetTaskPushNotificationConfig": {
        const input = parseParams(pushConfigIdParams, params);
        const row = await readA2aRow(ctx, input.taskId);
        return c.json(rpcResult(id, await getPushConfig(row, input.id)));
      }
      case "ListTaskPushNotificationConfigs": {
        const input = parseParams(listPushConfigParams, params);
        const row = await readA2aRow(ctx, input.taskId);
        return c.json(rpcResult(id, await listPushConfigs(row)));
      }
      case "DeleteTaskPushNotificationConfig": {
        const input = parseParams(pushConfigIdParams, params);
        const row = await readA2aRow(ctx, input.taskId);
        return c.json(rpcResult(id, await deletePushConfig(row, input.id)));
      }
      case "SubscribeToTask": {
        const { id: taskId } = parseParams(taskIdParams, params);
        const row = await readA2aRow(ctx, taskId);
        const task = await describeTask(ctx, row);
        if (isTerminal(task.status.state)) {
          throw new A2aError(
            A2A_ERRORS.unsupportedOperation,
            "The task has already finished",
          );
        }
        return streamTask(c, id, ctx, { task, row });
      }
    }
    throw new A2aError(A2A_ERRORS.methodNotFound, "Method not found");
  } catch (error) {
    if (error instanceof A2aError) return c.json(rpcError(id, error));
    console.error("a2a: request failed", {
      method,
      error: error instanceof Error ? error.name : "unknown",
    });
    return c.json(
      rpcError(id, new A2aError(A2A_ERRORS.internal, "Internal error")),
    );
  }
});

export default a2a;
