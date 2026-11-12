import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { IncomingMessage } from "node:http";
import { createRequire } from "node:module";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { serve } from "../../apps/api/node_modules/@hono/node-server";
import type { NodeWebSocket } from "../../apps/api/node_modules/@hono/node-ws";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import createNotification from "../../apps/api/src/notification/controllers/create-notification";
import { resetRateLimitMemory } from "../../apps/api/src/utils/rate-limit";
import {
  resetInstanceState,
  signUpWithSession,
} from "./helpers/instance-admin";

// What Margaya Desktop's Rust core does with its bearer session token: the
// user socket, the alert text a NOTIFICATION_CREATED hint points at, and
// discovery through /api/config. Real sessions throughout, no mocks.

type App = ReturnType<typeof createApp>["app"];
type Socket = NodeWebSocket["wss"]["clients"] extends Set<infer S> ? S : never;

const apiRequire = createRequire(
  new URL("../../apps/api/package.json", import.meta.url),
);
const nodeWsRequire = createRequire(apiRequire.resolve("@hono/node-ws"));
const WebSocket: new (
  url: string,
  options: { headers: Record<string, string> },
) => Socket = nodeWsRequire("ws").WebSocket;

type Person = { id: string; cookie: string; token: string };

let app: App;
let pat: Person;
let sam: Person;
let workspaceId: string;

async function person(email: string): Promise<Person> {
  const { cookie, user } = await signUpWithSession(app, email);
  const [session] = await db
    .select({ token: schema.sessionTable.token })
    .from(schema.sessionTable)
    .where(eq(schema.sessionTable.userId, user.id));
  if (!session) throw new Error("No session");
  return { id: user.id, cookie, token: session.token };
}

async function workspaceOf(userId: string) {
  const id = `workspace-${randomUUID()}`;
  await db.insert(schema.workspaceTable).values({
    id,
    createdAt: new Date(),
    name: "Desktop Workspace",
    slug: id,
  });
  await db.insert(schema.workspaceUserTable).values({
    workspaceId: id,
    userId,
    role: "member",
    joinedAt: new Date(),
  });
  return id;
}

function notify(userId: string, resourceId = workspaceId) {
  return createNotification({
    userId,
    title: "Workspace news",
    content: "a private note someone wrote",
    type: "info",
    resourceId,
    resourceType: "workspace",
  });
}

function alertFor(id: string, headers: Record<string, string>) {
  return app.request(`/api/notification/${id}/desktop`, { headers });
}

beforeEach(async () => {
  await resetInstanceState();
  resetRateLimitMemory();
  app = createApp().app;
  pat = await person("pat@example.com");
  sam = await person("sam@example.com");
  workspaceId = await workspaceOf(pat.id);
});

describe("GET /api/notification/{id}/desktop", () => {
  it("answers the owner's alert with the push text, by bearer or cookie", async () => {
    const created = await notify(pat.id);
    if (!created) throw new Error("Notification muted");

    const byBearer = await alertFor(created.id, {
      authorization: `Bearer ${pat.token}`,
    });
    expect(byBearer.status, await byBearer.clone().text()).toBe(200);
    const alert = (await byBearer.json()) as Record<string, string>;
    expect(Object.keys(alert).sort()).toEqual([
      "body",
      "held",
      "id",
      "sound",
      "soundName",
      "tag",
      "title",
      "url",
      "volume",
    ]);
    expect(alert.id).toBe(created.id);
    expect(alert.tag).toBe(created.id);
    expect(alert.url).toBe(
      `http://localhost:5173/dashboard/workspace/${workspaceId}/inbox`,
    );
    expect(alert.title.length).toBeGreaterThan(0);
    expect(alert.body.length).toBeGreaterThan(0);
    // What someone wrote never leaves through an alert.
    expect(JSON.stringify(alert)).not.toContain("private note");

    const byCookie = await alertFor(created.id, { cookie: pat.cookie });
    expect(byCookie.status).toBe(200);
    expect(await byCookie.json()).toEqual(alert);
  });

  it("says whether the user's sound settings call for a sound", async () => {
    const created = await notify(pat.id);
    if (!created) throw new Error("Notification muted");
    const sound = async (query = "") => {
      const response = await app.request(
        `/api/notification/${created.id}/desktop${query}`,
        { headers: { authorization: `Bearer ${pat.token}` } },
      );
      expect(response.status).toBe(200);
      const alert = (await response.json()) as {
        sound: boolean;
        soundName: string | null;
        volume: number;
      };
      // The old flag stays in step for desktop apps that predate soundName.
      expect(alert.sound).toBe(alert.soundName !== null);
      return alert.sound;
    };
    const named = async () => {
      const response = await app.request(
        `/api/notification/${created.id}/desktop`,
        { headers: { authorization: `Bearer ${pat.token}` } },
      );
      const { soundName, volume } = (await response.json()) as {
        soundName: string | null;
        volume: number;
      };
      return { soundName, volume };
    };
    // Defaults: "everything else" has no sound.
    expect(await sound()).toBe(false);
    expect(await named()).toEqual({ soundName: null, volume: 70 });

    const setSound = (notificationSound: Record<string, unknown>) =>
      db
        .update(schema.userTable)
        .set({
          preferences: {
            notificationSound: {
              enabled: true,
              volume: 70,
              mentions: "chime",
              agents: "knock",
              replies: "pop",
              other: "bell",
              quietHours: false,
              quietStart: "22:00",
              quietEnd: "08:00",
              ...notificationSound,
            },
          },
        })
        .where(eq(schema.userTable.id, pat.id));
    await setSound({});
    expect(await sound()).toBe(true);
    expect(await named()).toEqual({ soundName: "bell", volume: 70 });
    await setSound({ other: "marimba", volume: 40 });
    expect(await named()).toEqual({ soundName: "marimba", volume: 40 });
    await setSound({ volume: 0 });
    expect(await named()).toEqual({ soundName: null, volume: 0 });
    await setSound({ enabled: false });
    expect(await sound()).toBe(false);
    expect((await named()).soundName).toBeNull();

    // Equal times mean no quiet hours. A window around now is quiet in the
    // device's zone when the account has none, else in the account's zone.
    const hour = new Date().getUTCHours();
    const pad = (n: number) => String(n).padStart(2, "0");
    await setSound({
      quietHours: true,
      quietStart: `${pad((hour + 1) % 24)}:00`,
      quietEnd: `${pad((hour + 1) % 24)}:00`,
    });
    expect(await sound()).toBe(true);
    await setSound({
      quietHours: true,
      quietStart: `${pad(hour)}:00`,
      quietEnd: `${pad((hour + 2) % 24)}:00`,
    });
    expect(await sound("?timeZone=UTC")).toBe(false);
    expect(await sound("?timeZone=Not%2FAZone")).toBe(false);
    await db
      .update(schema.userTable)
      .set({ timezone: "Asia/Kathmandu" })
      .where(eq(schema.userTable.id, pat.id));
    // Kathmandu is UTC+5:45, outside that two-hour window.
    expect(await sound("?timeZone=UTC")).toBe(true);
  });

  it("holds the alert during focus mode unless the notification bypasses it", async () => {
    const until = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const setPreferences = (preferences: Record<string, unknown>) =>
      db
        .update(schema.userTable)
        .set({ preferences })
        .where(eq(schema.userTable.id, pat.id));
    const alertOf = async (id: string) => {
      const response = await alertFor(id, {
        authorization: `Bearer ${pat.token}`,
      });
      expect(response.status).toBe(200);
      return (await response.json()) as { held: boolean; sound: boolean };
    };
    const created = await notify(pat.id);
    if (!created) throw new Error("Notification muted");
    expect((await alertOf(created.id)).held).toBe(false);

    await setPreferences({ focusUntil: until });
    expect(await alertOf(created.id)).toMatchObject({
      held: true,
      sound: false,
    });

    // Desktop not among the held channels: shown, but still silent.
    await setPreferences({
      focusUntil: until,
      quietDelivery: { channels: ["push"], bypass: [] },
    });
    expect(await alertOf(created.id)).toMatchObject({
      held: false,
      sound: false,
    });

    // An expired focus session holds nothing.
    await setPreferences({
      focusUntil: new Date(Date.now() - 1000).toISOString(),
    });
    expect((await alertOf(created.id)).held).toBe(false);
  });

  it("answers 404 for someone else's notification, an unknown one and signed out 401", async () => {
    const created = await notify(pat.id);
    if (!created) throw new Error("Notification muted");
    expect(
      (await alertFor(created.id, { authorization: `Bearer ${sam.token}` }))
        .status,
    ).toBe(404);
    expect((await alertFor(created.id, { cookie: sam.cookie })).status).toBe(
      404,
    );
    expect(
      (await alertFor("no-such-id", { authorization: `Bearer ${pat.token}` }))
        .status,
    ).toBe(404);
    expect((await alertFor(created.id, {})).status).toBe(401);
  });

  it("answers 404 once the notification's workspace is no longer the user's", async () => {
    const created = await notify(pat.id);
    if (!created) throw new Error("Notification muted");
    await db
      .delete(schema.workspaceUserTable)
      .where(eq(schema.workspaceUserTable.userId, pat.id));
    expect(
      (await alertFor(created.id, { authorization: `Bearer ${pat.token}` }))
        .status,
    ).toBe(404);
  });
});

describe("the user socket with a bearer session", () => {
  let server: ReturnType<typeof serve>;
  let baseUrl: string;
  const sockets: Socket[] = [];

  beforeEach(async () => {
    const created = createApp();
    server = serve({
      fetch: created.app.fetch,
      hostname: "127.0.0.1",
      port: 0,
    });
    created.injectWebSocket(server);
    if (!server.listening) await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No port");
    baseUrl = `ws://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.terminate();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  async function connect(headers: Record<string, string>) {
    const socket = new WebSocket(`${baseUrl}/api/ws/user`, { headers });
    sockets.push(socket);
    socket.on("error", () => {});
    const status = await new Promise<number>((resolve) => {
      socket.once("open", () => resolve(101));
      socket.once(
        "unexpected-response",
        (_request: unknown, response: IncomingMessage) => {
          response.resume();
          resolve(response.statusCode ?? 0);
          socket.terminate();
        },
      );
    });
    return { socket, status };
  }

  it("upgrades with the Authorization header alone and delivers the notification id", async () => {
    const { socket, status } = await connect({
      authorization: `Bearer ${pat.token}`,
    });
    expect(status).toBe(101);

    const message = once(socket, "message");
    const created = await notify(pat.id);
    if (!created) throw new Error("Notification muted");
    const hint = JSON.parse((await message)[0].toString());
    expect(hint).toEqual({
      type: "NOTIFICATION_CREATED",
      notificationId: created.id,
      notificationType: "info",
      reply: false,
      needsInput: false,
      quiet: false,
    });

    const alert = await alertFor(hint.notificationId, {
      authorization: `Bearer ${pat.token}`,
    });
    expect(alert.status).toBe(200);
  });

  it("leaves the id out while focus mode holds desktop alerts", async () => {
    await db
      .update(schema.userTable)
      .set({
        preferences: {
          focusUntil: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        },
      })
      .where(eq(schema.userTable.id, pat.id));
    const { socket } = await connect({ authorization: `Bearer ${pat.token}` });
    const message = once(socket, "message");
    const created = await notify(pat.id);
    if (!created) throw new Error("Notification muted");
    expect(JSON.parse((await message)[0].toString())).toEqual({
      type: "NOTIFICATION_CREATED",
      notificationId: null,
      notificationType: "info",
      reply: false,
      needsInput: false,
      quiet: true,
    });
  });

  it("refuses a bearer token that is no session, and one sent from a foreign page", async () => {
    expect(
      (await connect({ authorization: "Bearer not-a-session" })).status,
    ).toBe(401);
    expect(
      (
        await connect({
          authorization: `Bearer ${pat.token}`,
          origin: "https://evil.example.test",
        })
      ).status,
    ).toBe(403);
  });
});

describe("GET /api/config", () => {
  it("tells the desktop app how to reach this server", async () => {
    const response = await app.request("/api/config");
    expect(response.status).toBe(200);
    const { desktop } = (await response.json()) as {
      desktop: Record<string, unknown>;
    };
    expect(desktop).toEqual({
      enabled: true,
      serverVersion: expect.stringMatching(/^\d+\.\d+\.\d+/),
      minDesktopVersion: "0.1.0",
      webUrl: "http://localhost:5173",
      apiUrl: "http://localhost:1337",
    });
  });
});
