import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetA2aCaches } from "../../apps/api/src/a2a/broker";
import { verifyAgentCard } from "../../apps/api/src/a2a/signing";
import db, { schema } from "../../apps/api/src/database";
import {
  a2aPushConfigTable,
  a2aTaskTable,
} from "../../apps/api/src/database/schema";
import { resetRateLimitMemory } from "../../apps/api/src/utils/rate-limit";
import { createApiKey } from "./helpers/api-keys";
import { mockAnonymousSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { draftScene } from "./helpers/drafts";
import { setIntakeEnabled } from "./helpers/intake";

// A2A push notifications and the signed Agent Card, through the real app.

type Scene = Awaited<ReturnType<typeof draftScene>>;
type Received = { headers: IncomingMessage["headers"]; body: unknown };

let server: Server | null = null;
const received: Received[] = [];

async function receiver(): Promise<string> {
  server = createServer((req, res) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => {
      received.push({ headers: req.headers, body: JSON.parse(data || "null") });
      res.writeHead(200).end();
    });
  });
  await new Promise<void>((done) => server?.listen(0, "127.0.0.1", done));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}/hook`;
}

beforeEach(async () => {
  await resetTestDatabase();
  resetRateLimitMemory();
  resetA2aCaches();
  received.length = 0;
  // The receiver listens on loopback, which production refuses.
  process.env.MARGAYA_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS = "true";
});

afterEach(async () => {
  delete process.env.MARGAYA_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS;
  await new Promise<void>((done) =>
    server ? server.close(() => done()) : done(),
  );
  server = null;
});

async function scene() {
  const s = await draftScene();
  await db
    .update(schema.workspaceTable)
    .set({ allowA2a: true })
    .where(eq(schema.workspaceTable.id, s.workspaceId));
  await setIntakeEnabled(s.web.project.id, true);
  return s;
}

let rpcId = 0;
async function rpc(
  s: Scene,
  headers: Record<string, string>,
  method: string,
  params: Record<string, unknown> = {},
) {
  mockAnonymousSession();
  rpcId += 1;
  const response = await s.app.request("/api/a2a", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "a2a-version": "1.0",
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: rpcId, method, params }),
  });
  expect(response.status).toBe(200);
  return (await response.json()) as {
    result?: Record<string, unknown>;
    error?: { code: number; message: string };
  };
}

const request = (
  s: Scene,
  headers: Record<string, string>,
  text: string,
  extra = {},
) =>
  rpc(s, headers, "SendMessage", {
    message: {
      messageId: `m-${rpcId + 1}`,
      role: "ROLE_USER",
      parts: [{ text }, { data: { project: "web" } }],
    },
    ...extra,
  });

async function until(check: () => boolean, ms = 8_000) {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) {
    await new Promise((done) => setTimeout(done, 50));
  }
}

describe("A2A push notifications", () => {
  it("pushes a triaged request's new state once, with the caller's token and auth", async () => {
    const s = await scene();
    const url = await receiver();
    const mia = await createApiKey(s.mia);
    const sent = await request(s, mia.headers, "Dark mode please");
    const taskId = (sent.result?.task as { id: string } | undefined)?.id ?? "";

    const created = await rpc(
      s,
      mia.headers,
      "CreateTaskPushNotificationConfig",
      {
        taskId,
        url,
        token: "tok-123",
        authentication: { scheme: "Bearer", credentials: "secret-cred" },
      },
    );
    expect(created.result).toMatchObject({
      taskId,
      url,
      authentication: { scheme: "Bearer" },
    });
    // Secrets are stored sealed and never echoed back.
    expect(JSON.stringify(created.result)).not.toContain("tok-123");
    expect(JSON.stringify(created.result)).not.toContain("secret-cred");
    const [stored] = await db.select().from(a2aPushConfigTable);
    expect(stored?.tokenSealed).not.toContain("tok-123");

    const [row] = await db
      .select()
      .from(a2aTaskTable)
      .where(eq(a2aTaskTable.id, taskId));
    await s.ok(s.ada, "POST", `/intake/item/${row?.refId}/decline`, {
      note: "Out of scope",
    });
    await until(() => received.length > 0);
    expect(received).toHaveLength(1);
    expect(received[0]?.headers["x-a2a-notification-token"]).toBe("tok-123");
    expect(received[0]?.headers.authorization).toBe("Bearer secret-cred");
    expect(received[0]?.headers["content-type"]).toBe("application/a2a+json");
    expect(received[0]?.body).toMatchObject({
      statusUpdate: { taskId, status: { state: "TASK_STATE_REJECTED" } },
    });
    // Only the state: no titles, notes or other task content.
    expect(JSON.stringify(received[0]?.body)).not.toContain("Out of scope");
    expect(JSON.stringify(received[0]?.body)).not.toContain("Dark mode");

    // Get, list and an idempotent delete.
    const id = (created.result as { id: string }).id;
    expect(
      (
        await rpc(s, mia.headers, "GetTaskPushNotificationConfig", {
          taskId,
          id,
        })
      ).result,
    ).toMatchObject({ id });
    expect(
      (await rpc(s, mia.headers, "ListTaskPushNotificationConfigs", { taskId }))
        .result,
    ).toMatchObject({ configs: [{ id }] });
    for (let i = 0; i < 2; i++) {
      expect(
        (
          await rpc(s, mia.headers, "DeleteTaskPushNotificationConfig", {
            taskId,
            id,
          })
        ).error,
      ).toBeUndefined();
    }
    expect(await db.select().from(a2aPushConfigTable)).toHaveLength(0);
  });

  it("accepts a config with SendMessage and keeps it to the caller's own tasks", async () => {
    const s = await scene();
    const url = await receiver();
    const mia = await createApiKey(s.mia);
    const sent = await request(s, mia.headers, "Export invoices", {
      configuration: { taskPushNotificationConfig: { url } },
    });
    const taskId = (sent.result?.task as { id: string } | undefined)?.id ?? "";
    expect(await db.select().from(a2aPushConfigTable)).toHaveLength(1);

    // Someone else can't read or add configs on Mia's task.
    const ada = await createApiKey(s.ada);
    expect(
      (await rpc(s, ada.headers, "ListTaskPushNotificationConfigs", { taskId }))
        .error?.code,
    ).toBe(-32001);
    expect(
      (
        await rpc(s, ada.headers, "CreateTaskPushNotificationConfig", {
          taskId,
          url,
        })
      ).error?.code,
    ).toBe(-32001);
  });

  it("refuses private destinations and finished tasks", async () => {
    const s = await scene();
    const mia = await createApiKey(s.mia);
    const sent = await request(s, mia.headers, "Something");
    const taskId = (sent.result?.task as { id: string } | undefined)?.id ?? "";
    delete process.env.MARGAYA_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS;
    for (const url of [
      "http://127.0.0.1:9/x",
      "https://127.0.0.1/x",
      "https://user:pw@example.com/x",
    ]) {
      const refused = await rpc(
        s,
        mia.headers,
        "CreateTaskPushNotificationConfig",
        { taskId, url },
      );
      expect(refused.error?.code).toBe(-32602);
    }
    // A bad URL in SendMessage creates nothing.
    const before = await db.select().from(a2aTaskTable);
    const bad = await request(s, mia.headers, "Other", {
      configuration: {
        taskPushNotificationConfig: { url: "http://10.0.0.1/x" },
      },
    });
    expect(bad.error?.code).toBe(-32602);
    expect(await db.select().from(a2aTaskTable)).toHaveLength(before.length);
  });
});

describe("Signed Agent Card", () => {
  it("is signed with the key the JWK Set publishes", async () => {
    const s = await scene();
    const card = (await (
      await s.app.request("/.well-known/agent-card.json")
    ).json()) as Record<string, unknown>;
    expect(card.capabilities).toMatchObject({ pushNotifications: true });
    const [signature] = card.signatures as Array<{ protected: string }>;
    const header = JSON.parse(
      Buffer.from(signature?.protected ?? "", "base64url").toString(),
    ) as { alg: string; kid: string; jku: string };
    expect(header).toMatchObject({ alg: "EdDSA", typ: "JOSE" });
    expect(header.jku).toBe(
      "http://localhost:1337/api/.well-known/agent-card-jwks.json",
    );
    const jwks = (await (
      await s.app.request("/api/.well-known/agent-card-jwks.json")
    ).json()) as {
      keys: Array<{ kid: string; kty: string; crv: string; x: string }>;
    };
    const key = jwks.keys.find((k) => k.kid === header.kid);
    expect(key).toBeDefined();
    expect(
      verifyAgentCard(card, key as { kty: string; crv: string; x: string }),
    ).toBe(true);
    // Any change to the card breaks the signature.
    expect(
      verifyAgentCard(
        { ...card, name: "Impostor" },
        key as { kty: string; crv: string; x: string },
      ),
    ).toBe(false);
  });
});
