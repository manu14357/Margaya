import {
  createDecipheriv,
  createECDH,
  type ECDH,
  hkdfSync,
  randomUUID,
} from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { deliverNotification } from "../../apps/api/src/notification-preferences/delivery";
import { generateVapidKeys } from "../../apps/api/src/notification-preferences/web-push";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

const ENDPOINT = "https://push.example.com/send/device-1";

type Device = {
  ecdh: ECDH;
  auth: Buffer;
  keys: { p256dh: string; auth: string };
};

function newDevice(): Device {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = Buffer.alloc(16, randomUUID().slice(0, 16));
  return {
    ecdh,
    auth,
    keys: {
      p256dh: ecdh.getPublicKey("base64url"),
      auth: auth.toString("base64url"),
    },
  };
}

// What the browser does on arrival, so the tests read the real payload.
function decryptPush(device: Device, body: Uint8Array) {
  const data = Buffer.from(body);
  const salt = data.subarray(0, 16);
  const senderKey = data.subarray(21, 86);
  const record = data.subarray(86);
  const secret = Buffer.from(
    hkdfSync(
      "sha256",
      device.ecdh.computeSecret(senderKey),
      device.auth,
      Buffer.concat([
        Buffer.from("WebPush: info\0"),
        device.ecdh.getPublicKey(),
        senderKey,
      ]),
      32,
    ),
  );
  const decipher = createDecipheriv(
    "aes-128-gcm",
    Buffer.from(
      hkdfSync("sha256", secret, salt, "Content-Encoding: aes128gcm\0", 16),
    ),
    Buffer.from(
      hkdfSync("sha256", secret, salt, "Content-Encoding: nonce\0", 12),
    ),
  );
  decipher.setAuthTag(record.subarray(record.length - 16));
  const plain = Buffer.concat([
    decipher.update(record.subarray(0, record.length - 16)),
    decipher.final(),
  ]);
  return JSON.parse(plain.subarray(0, plain.length - 1).toString());
}

function pushFetch(status = 201) {
  const fetchMock = vi.fn(
    async (_url: string, _init: RequestInit) => new Response(null, { status }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function subscribe(
  userId: string,
  device: Device,
  endpoint = ENDPOINT,
  vapidPublicKey = process.env.VAPID_PUBLIC_KEY as string,
) {
  await db.insert(schema.pushSubscriptionTable).values({
    userId,
    endpoint,
    p256dh: device.keys.p256dh,
    auth: device.keys.auth,
    vapidPublicKey,
  });
}

async function devices(userId: string) {
  return db
    .select()
    .from(schema.pushSubscriptionTable)
    .where(eq(schema.pushSubscriptionTable.userId, userId));
}

async function mentionTask(
  userId: string,
  workspaceId: string,
  eventData: Record<string, unknown> = {},
) {
  const { project, columns } = await createProjectFixture({ workspaceId });
  const [task] = await db
    .insert(schema.taskTable)
    .values({
      projectId: project.id,
      title: "Ship the release",
      number: 1,
      status: columns.todo.slug,
      columnId: columns.todo.id,
    })
    .returning();
  if (!task) throw new Error("no task");
  const [notification] = await db
    .insert(schema.notificationTable)
    .values({
      id: randomUUID(),
      userId,
      type: "task_mention",
      resourceType: "task",
      resourceId: task.id,
      workspaceId,
      eventData: {
        taskTitle: "Ship the release",
        mentionerName: "Mina",
        ...eventData,
      },
    })
    .returning();
  if (!notification) throw new Error("no notification");
  return { notification, project, task };
}

async function rule(
  userId: string,
  workspaceId: string,
  values: Partial<
    typeof schema.userNotificationWorkspaceRuleTable.$inferInsert
  >,
) {
  await db
    .insert(schema.userNotificationWorkspaceRuleTable)
    .values({ userId, workspaceId, ...values });
}

describe("API integration: web push", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    const keys = generateVapidKeys();
    vi.stubEnv("VAPID_PUBLIC_KEY", keys.publicKey);
    vi.stubEnv("VAPID_PRIVATE_KEY", keys.privateKey);
    vi.stubEnv("VAPID_SUBJECT", "mailto:ops@example.com");
    vi.stubEnv("MARGAYA_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("routes", () => {
    async function api() {
      const member = await createWorkspaceMember();
      mockAuthenticatedSession(member.user);
      const { app } = createApp();
      const put = (body: unknown, userAgent = "Test browser") =>
        app.request("/api/notification-preferences/push/subscriptions", {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            "user-agent": userAgent,
          },
          body: JSON.stringify(body),
        });
      return { ...member, app, put };
    }

    it("reports push as off and refuses devices until the keys are set", async () => {
      vi.stubEnv("VAPID_PUBLIC_KEY", "");
      vi.stubEnv("VAPID_PRIVATE_KEY", "");
      const { app, put } = await api();

      const status = await app.request("/api/notification-preferences/push");
      expect(status.status).toBe(200);
      expect(await status.json()).toEqual({
        available: false,
        publicKey: null,
        subscriptions: [],
      });
      const refused = await put({ endpoint: ENDPOINT, keys: newDevice().keys });
      expect(refused.status).toBe(409);
    });

    it("saves a device, lists it without its keys, and removes it", async () => {
      const { app, put, user } = await api();
      const device = newDevice();

      const saved = await put({ endpoint: ENDPOINT, keys: device.keys });
      expect(saved.status, await saved.clone().text()).toBe(200);
      const status = (await saved.json()) as {
        publicKey: string;
        subscriptions: Array<Record<string, unknown> & { id: string }>;
      };
      expect(status.publicKey).toBe(process.env.VAPID_PUBLIC_KEY);
      expect(status.subscriptions).toHaveLength(1);
      expect(status.subscriptions[0]?.endpoint).toBe(ENDPOINT);
      expect(status.subscriptions[0]?.userAgent).toBe("Test browser");
      const raw = JSON.stringify(status);
      expect(raw).not.toContain(device.keys.auth);
      expect(raw).not.toContain(device.keys.p256dh);

      const removed = await app.request(
        `/api/notification-preferences/push/subscriptions/${status.subscriptions[0]?.id}`,
        { method: "DELETE" },
      );
      expect(removed.status).toBe(200);
      expect(await devices(user.id)).toHaveLength(0);
    });

    it("refuses malformed subscriptions", async () => {
      const { put } = await api();
      const { keys } = newDevice();
      for (const body of [
        { endpoint: "http://push.example.com/insecure", keys },
        { endpoint: "not-a-url", keys },
        { endpoint: ENDPOINT, keys: { ...keys, p256dh: "nope" } },
        { endpoint: ENDPOINT, keys: { ...keys, auth: "nope" } },
        { endpoint: ENDPOINT },
      ]) {
        expect((await put(body)).status).toBe(400);
      }
    });

    it("refuses an endpoint on a private address", async () => {
      vi.stubEnv("MARGAYA_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS", "");
      const { put, user } = await api();
      const response = await put({
        endpoint: "https://127.0.0.1/internal",
        keys: newDevice().keys,
      });
      expect(response.status).toBe(400);
      expect(await devices(user.id)).toHaveLength(0);
    });

    it("moves a device to whoever signs in on it, and can't touch another person's", async () => {
      const first = await createWorkspaceMember();
      const device = newDevice();
      await subscribe(first.user.id, device);
      const [row] = await devices(first.user.id);

      const { app, put, user } = await api();
      const hidden = await app.request(
        `/api/notification-preferences/push/subscriptions/${row?.id}`,
        { method: "DELETE" },
      );
      expect(hidden.status).toBe(404);
      expect(await devices(first.user.id)).toHaveLength(1);

      const moved = await put({ endpoint: ENDPOINT, keys: newDevice().keys });
      expect(moved.status).toBe(200);
      expect(await devices(first.user.id)).toHaveLength(0);
      expect(await devices(user.id)).toHaveLength(1);
    });

    it("keeps ten devices at most, dropping the oldest", async () => {
      const { put, user } = await api();
      for (let i = 0; i < 12; i++) {
        const response = await put({
          endpoint: `https://push.example.com/send/${i}`,
          keys: newDevice().keys,
        });
        expect(response.status).toBe(200);
      }
      const left = (await devices(user.id)).map((row) => row.endpoint);
      expect(left).toHaveLength(10);
      expect(left).toContain("https://push.example.com/send/11");
      expect(left).not.toContain("https://push.example.com/send/0");
    });

    it("keeps a rule's push choice when an older client leaves it out", async () => {
      const { app, user, workspace } = await api();
      const save = (pushEnabled?: boolean) =>
        app.request(
          `/api/notification-preferences/workspaces/${workspace.id}`,
          {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              isActive: true,
              emailEnabled: false,
              ntfyEnabled: false,
              gotifyEnabled: false,
              webhookEnabled: false,
              projectMode: "all",
              ...(pushEnabled === undefined ? {} : { pushEnabled }),
            }),
          },
        );
      const read = async () => {
        const [row] = await db
          .select()
          .from(schema.userNotificationWorkspaceRuleTable)
          .where(eq(schema.userNotificationWorkspaceRuleTable.userId, user.id));
        return row?.pushEnabled;
      };

      expect((await save()).status).toBe(200);
      expect(await read()).toBe(true);
      expect((await save(false)).status).toBe(200);
      expect(await read()).toBe(false);
      expect((await save()).status).toBe(200);
      expect(await read()).toBe(false);
    });
  });

  describe("delivery", () => {
    it("sends a mention to every device, encrypted, with only what the alert needs", async () => {
      const { user, workspace } = await createWorkspaceMember();
      const device = newDevice();
      await subscribe(user.id, device);
      const { notification, project, task } = await mentionTask(
        user.id,
        workspace.id,
        { source: "comment", commentPreview: "the private comment text" },
      );
      const fetchMock = pushFetch();

      await deliverNotification(notification.id);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(ENDPOINT);
      expect(init.redirect).toBe("error");
      const headers = init.headers as Record<string, string>;
      expect(headers["Content-Encoding"]).toBe("aes128gcm");
      expect(headers.Authorization).toContain(
        `k=${process.env.VAPID_PUBLIC_KEY}`,
      );
      expect(headers.Urgency).toBe("high");

      const message = decryptPush(device, init.body as Uint8Array);
      expect(Object.keys(message).sort()).toEqual([
        "body",
        "tag",
        "title",
        "url",
      ]);
      expect(message.title).toBe("Mina mentioned you");
      expect(message.body).toContain("Ship the release");
      expect(message.url).toBe(
        `/dashboard/workspace/${workspace.id}/project/${project.id}/task/${task.id}`,
      );
      expect(message.tag).toBe(notification.id);
      expect(JSON.stringify(message)).not.toContain("private comment");
    });

    describe("text someone wrote stays off the lock screen", () => {
      const SECRET = "salary of the new hire is 100k";

      async function pushOf(
        values: Partial<typeof schema.notificationTable.$inferInsert>,
        locale?: string,
      ) {
        const { user, workspace } = await createWorkspaceMember();
        if (locale) {
          await db
            .update(schema.userTable)
            .set({ locale })
            .where(eq(schema.userTable.id, user.id));
        }
        const device = newDevice();
        await subscribe(user.id, device);
        const { task } = await mentionTask(user.id, workspace.id);
        const [notification] = await db
          .insert(schema.notificationTable)
          .values({
            id: randomUUID(),
            userId: user.id,
            type: "info",
            resourceType: "task",
            resourceId: task.id,
            workspaceId: workspace.id,
            ...values,
          })
          .returning();
        const fetchMock = pushFetch();
        await deliverNotification(notification?.id as string);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        return decryptPush(device, init.body as Uint8Array) as {
          title: string;
          body: string;
          url: string;
          tag: string;
        };
      }

      const FIXED_LINE = "Open Margaya to see the details.";

      it("leaves out an agent's answer and says who answered", async () => {
        const message = await pushOf({
          type: "ai_agent_reply",
          title: "Ada answered your request",
          content: SECRET,
          eventData: { agentName: "Ada", runId: "r1" },
        });
        expect(message.title).toBe("Ada answered your request");
        expect(message.body).toBe(FIXED_LINE);
        expect(JSON.stringify(message)).not.toContain("salary");
        expect(message.url).toContain("/task/");
      });

      it("leaves out an agent's question", async () => {
        const message = await pushOf({
          type: "ai_agent_reply",
          title: "Ada has a question",
          content: SECRET,
          eventData: { agentName: "Ada", needsInput: true },
        });
        expect(message.title).toBe("Ada has a question");
        expect(message.body).toBe(FIXED_LINE);
      });

      it("leaves out an approval's description", async () => {
        const message = await pushOf({
          type: "ai_approval_requested",
          title: "Ada needs your approval",
          content: SECRET,
          eventData: { agentName: "Ada", approvalId: "a1" },
        });
        expect(message.title).toBe("Ada needs your approval");
        expect(message.body).toBe(FIXED_LINE);
      });

      it("names the task for an automation, without the rule's message", async () => {
        const message = await pushOf({
          type: "automation_notice",
          title: "Automation: Deploy check",
          content: SECRET,
          eventData: {
            ruleName: "Deploy check",
            taskKey: "WEB-1",
            taskTitle: "Ship the release",
            message: SECRET,
          },
        });
        expect(message.title).toBe("Automation: Deploy check");
        expect(message.body).toBe("WEB-1 Ship the release");
      });

      it("says a request was declined, without the reason", async () => {
        const message = await pushOf({
          type: "intake_declined",
          title: "Your request was declined",
          content: `"Ship the release" was declined. Reason: ${SECRET}`,
          eventData: { taskTitle: "Ship the release", note: SECRET },
        });
        expect(message.title).toBe("Your request was declined");
        expect(message.body).toContain("Ship the release");
        expect(message.body).not.toContain("salary");
      });

      it("keeps a comment's author and task, without its text", async () => {
        const message = await pushOf({
          type: "task_comment",
          eventData: {
            taskTitle: "Ship the release",
            commenterName: "Mina",
            commentPreview: SECRET,
          },
        });
        expect(message.title).toBe("Mina commented");
        expect(message.body).toContain("Ship the release");
        expect(message.body).not.toContain("salary");
      });

      it("keeps the fixed wording of a server notice", async () => {
        const message = await pushOf({
          type: "ai_budget_warning",
          title: "AI budget almost used",
          content: "This workspace has used 80% of its monthly AI budget.",
          eventData: { usedPercent: 80 },
        });
        expect(message.title).toBe("AI budget almost used");
        expect(message.body).toContain("80%");
      });

      it("holds in the reader's language too", async () => {
        const message = await pushOf(
          {
            type: "ai_agent_reply",
            title: "Ada answered your request",
            content: SECRET,
            eventData: { agentName: "Ada" },
          },
          "de-DE",
        );
        expect(message.title).not.toBe("Ada answered your request");
        expect(message.title).toContain("Ada");
        expect(JSON.stringify(message)).not.toContain("salary");
        expect(message.body.length).toBeGreaterThan(0);
      });

      it("sends the full text to the channels that always had it", async () => {
        const { user, workspace } = await createWorkspaceMember();
        await subscribe(user.id, newDevice());
        await rule(user.id, workspace.id, {
          isActive: true,
          webhookEnabled: true,
        });
        await db.insert(schema.userNotificationPreferenceTable).values({
          userId: user.id,
          webhookEnabled: true,
          webhookUrl: "https://hooks.example.com/margaya",
        });
        const { task } = await mentionTask(user.id, workspace.id);
        const [notification] = await db
          .insert(schema.notificationTable)
          .values({
            id: randomUUID(),
            userId: user.id,
            type: "ai_agent_reply",
            title: "Ada answered your request",
            content: SECRET,
            resourceType: "task",
            resourceId: task.id,
            workspaceId: workspace.id,
          })
          .returning();
        const fetchMock = pushFetch();

        await deliverNotification(notification?.id as string);

        const webhook = fetchMock.mock.calls.find(
          ([url]) => url === "https://hooks.example.com/margaya",
        );
        expect(String(webhook?.[1].body)).toContain("salary");
      });
    });

    it("needs no preference row or workspace rule", async () => {
      const { user, workspace } = await createWorkspaceMember();
      await subscribe(user.id, newDevice());
      const { notification } = await mentionTask(user.id, workspace.id);
      const fetchMock = pushFetch();

      await deliverNotification(notification.id);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("lets a workspace rule narrow push", async () => {
      const { user, workspace } = await createWorkspaceMember();
      await subscribe(user.id, newDevice());
      const { notification, project } = await mentionTask(
        user.id,
        workspace.id,
      );
      const fetchMock = pushFetch();

      await rule(user.id, workspace.id, { isActive: false });
      await deliverNotification(notification.id);
      expect(fetchMock).not.toHaveBeenCalled();

      await db
        .update(schema.userNotificationWorkspaceRuleTable)
        .set({ isActive: true, pushEnabled: false });
      await deliverNotification(notification.id);
      expect(fetchMock).not.toHaveBeenCalled();

      await db
        .update(schema.userNotificationWorkspaceRuleTable)
        .set({ pushEnabled: true, projectMode: "selected" });
      await deliverNotification(notification.id);
      expect(fetchMock).not.toHaveBeenCalled();

      const [saved] = await db
        .select()
        .from(schema.userNotificationWorkspaceRuleTable);
      await db.insert(schema.userNotificationWorkspaceProjectTable).values({
        workspaceId: workspace.id,
        workspaceRuleId: saved?.id as string,
        projectId: project.id,
      });
      await deliverNotification(notification.id);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("reaches a device of an active rule that existed before push did", async () => {
      const { user, workspace } = await createWorkspaceMember();
      await subscribe(user.id, newDevice());
      await db.execute(sql`
        INSERT INTO user_notification_workspace_rule (id, user_id, workspace_id)
        VALUES (${randomUUID()}, ${user.id}, ${workspace.id})
      `);
      const { notification } = await mentionTask(user.id, workspace.id);
      const fetchMock = pushFetch();

      await deliverNotification(notification.id);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it.each([404, 410])(
      "removes a device the push service answers %i for",
      async (status) => {
        const { user, workspace } = await createWorkspaceMember();
        await subscribe(user.id, newDevice());
        const { notification } = await mentionTask(user.id, workspace.id);
        pushFetch(status);

        await deliverNotification(notification.id);
        expect(await devices(user.id)).toHaveLength(0);
      },
    );

    it("keeps a device through other failures and logs no endpoint", async () => {
      const { user, workspace } = await createWorkspaceMember();
      await subscribe(user.id, newDevice());
      const { notification } = await mentionTask(user.id, workspace.id);
      pushFetch(500);
      const log = vi.spyOn(console, "error").mockImplementation(() => {});

      await deliverNotification(notification.id);

      expect(await devices(user.id)).toHaveLength(1);
      expect(log).toHaveBeenCalled();
      expect(JSON.stringify(log.mock.calls)).not.toContain("push.example.com");
    });

    it("drops devices made with an old key instead of sending to them", async () => {
      const { user, workspace } = await createWorkspaceMember();
      await subscribe(
        user.id,
        newDevice(),
        ENDPOINT,
        generateVapidKeys().publicKey,
      );
      const { notification } = await mentionTask(user.id, workspace.id);
      const fetchMock = pushFetch();

      await deliverNotification(notification.id);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(await devices(user.id)).toHaveLength(0);
    });

    it("keeps devices but sends nothing while push is off on the instance", async () => {
      const { user, workspace } = await createWorkspaceMember();
      await subscribe(user.id, newDevice());
      const { notification } = await mentionTask(user.id, workspace.id);
      vi.stubEnv("VAPID_PUBLIC_KEY", "");
      vi.stubEnv("VAPID_PRIVATE_KEY", "");
      const fetchMock = pushFetch();

      await deliverNotification(notification.id);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(await devices(user.id)).toHaveLength(1);
    });

    it("sends nothing to someone banned, or no longer in the workspace", async () => {
      const banned = await createWorkspaceMember();
      await subscribe(banned.user.id, newDevice());
      const first = await mentionTask(banned.user.id, banned.workspace.id);
      await db
        .update(schema.userTable)
        .set({ banned: true })
        .where(eq(schema.userTable.id, banned.user.id));

      const removed = await createWorkspaceMember();
      await subscribe(
        removed.user.id,
        newDevice(),
        "https://push.example.com/send/device-2",
      );
      const second = await mentionTask(removed.user.id, removed.workspace.id);
      await db
        .delete(schema.workspaceUserTable)
        .where(eq(schema.workspaceUserTable.userId, removed.user.id));

      const fetchMock = pushFetch();
      await deliverNotification(first.notification.id);
      await deliverNotification(second.notification.id);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("pushes a page mention without changing the other channels", async () => {
      const { user, workspace } = await createWorkspaceMember();
      const device = newDevice();
      await subscribe(user.id, device);
      const { project } = await createProjectFixture({
        workspaceId: workspace.id,
      });
      const [page] = await db
        .insert(schema.pageTable)
        .values({
          workspaceId: workspace.id,
          projectId: project.id,
          title: "Launch plan",
          access: "public",
          ownerId: user.id,
        })
        .returning();
      await rule(user.id, workspace.id, {
        isActive: true,
        webhookEnabled: true,
      });
      await db.insert(schema.userNotificationPreferenceTable).values({
        userId: user.id,
        webhookEnabled: true,
        webhookUrl: "https://hooks.example.com/margaya",
      });
      const [notification] = await db
        .insert(schema.notificationTable)
        .values({
          id: randomUUID(),
          userId: user.id,
          type: "page_mention",
          resourceType: "page",
          resourceId: page?.id,
          workspaceId: workspace.id,
          eventData: { pageTitle: "Launch plan", mentionerName: "Mina" },
        })
        .returning();
      const fetchMock = pushFetch();

      await deliverNotification(notification?.id as string);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(ENDPOINT);
      const message = decryptPush(device, init.body as Uint8Array);
      expect(message.url).toBe(
        `/dashboard/workspace/${workspace.id}/project/${project.id}/pages/${page?.id}`,
      );
      expect(message.body).toContain("Launch plan");
    });

    it("still reaches the other channels alongside push", async () => {
      const { user, workspace } = await createWorkspaceMember();
      await subscribe(user.id, newDevice());
      await rule(user.id, workspace.id, {
        isActive: true,
        webhookEnabled: true,
      });
      await db.insert(schema.userNotificationPreferenceTable).values({
        userId: user.id,
        webhookEnabled: true,
        webhookUrl: "https://hooks.example.com/margaya",
      });
      const { notification } = await mentionTask(user.id, workspace.id);
      const fetchMock = pushFetch();

      await deliverNotification(notification.id);

      const urls = fetchMock.mock.calls.map(([url]) => url).sort();
      expect(urls).toEqual(
        ["https://hooks.example.com/margaya", ENDPOINT].sort(),
      );
    });

    it("goes with the account when it is deleted", async () => {
      const { user } = await createWorkspaceMember();
      await subscribe(user.id, newDevice());
      await db.delete(schema.userTable).where(eq(schema.userTable.id, user.id));
      expect(await devices(user.id)).toHaveLength(0);
    });
  });
});
