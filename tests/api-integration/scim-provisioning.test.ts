import { and, eq, sql } from "drizzle-orm";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { scimProviderTable } from "../../apps/api/src/database/schema";
import { subscribeToEvent } from "../../apps/api/src/events";
import { hashScimSecret } from "../../apps/api/src/identity/scim-token";
import { createApp } from "../../apps/api/src/index";
import { refreshInstanceSettings } from "../../apps/api/src/instance-settings/snapshot";
import { resetRateLimitMemory } from "../../apps/api/src/utils/rate-limit";
import { createWorkspaceMember } from "./helpers/fixtures";
import {
  adminRequest,
  authPost,
  ORIGIN,
  resetInstanceState,
  signUpWithSession,
  unlockSignUpSettings,
} from "./helpers/instance-admin";

// These tests play the identity provider: they send the requests SCIM 2.0
// (RFC 7644) defines, in the shapes real providers are documented to use. No real
// identity provider was involved.

type App = ReturnType<typeof createApp>["app"];

const SCIM = "/api/auth/scim/v2";
const JSON_TYPE = "application/scim+json";
const PATCH_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:PatchOp";
const ERROR_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:Error";

let app: App;
let admin: Awaited<ReturnType<typeof signUpWithSession>>;
let workspaceId: string;

function scimWith(
  authorization: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  return Promise.resolve(
    app.request(`${SCIM}${path}`, {
      method,
      headers: {
        authorization,
        ...(body === undefined ? {} : { "content-type": JSON_TYPE }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

function scim(
  method: string,
  path: string,
  token: string,
  body?: unknown,
): Promise<Response> {
  return scimWith(`Bearer ${token}`, method, path, body);
}

const patch = (...Operations: unknown[]) => ({
  schemas: [PATCH_SCHEMA],
  Operations,
});

/**
 * An error exactly as RFC 7644 (3.12) defines it: these members and no others,
 * which strict clients check. Returns the body for further checks.
 */
async function scimError(
  response: Response,
  status: number,
  scimType?: string,
) {
  expect(response.status).toBe(status);
  const body = (await response.json()) as Record<string, unknown>;
  expect(body).toEqual({
    schemas: [ERROR_SCHEMA],
    status: String(status),
    detail: expect.any(String),
    ...(scimType ? { scimType } : {}),
  });
  return body;
}

async function connect(
  targetWorkspaceId = workspaceId,
  name = "Company directory",
) {
  const response = await adminRequest(
    app,
    "POST",
    "/identity/scim",
    admin.cookie,
    { name, workspaceId: targetWorkspaceId },
  );
  expect(response.status, await response.clone().text()).toBe(200);
  return (await response.json()) as {
    token: string;
    baseUrl: string;
    connection: { id: string; provisionedUsers: number };
  };
}

function withoutWorkspace(token: string) {
  const [secret, providerId] = Buffer.from(token, "base64url")
    .toString()
    .split(":");
  return Buffer.from(`${secret}:${providerId}`).toString("base64url");
}

function person(email: string, extra: Record<string, unknown> = {}) {
  return {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
    userName: email,
    name: { givenName: "Pat", familyName: "Lee" },
    emails: [{ primary: true, value: email, type: "work" }],
    active: true,
    ...extra,
  };
}

// An empty address isn't "no change": the plugin would store it, which ends email
// sign-in and password reset for the account.
const BLANK_ADDRESSES = [
  ["an empty patch value", "PATCH", ""],
  ["a patch value of spaces", "PATCH", "  "],
  ["an empty full update", "PUT", ""],
  ["a full update of spaces", "PUT", "  "],
] as const;

const blankAddressBody = (method: "PATCH" | "PUT", value: string) =>
  method === "PATCH"
    ? patch({ op: "replace", path: "userName", value })
    : person("x", { userName: value, emails: undefined });

async function provision(token: string, email: string) {
  const response = await scim("POST", "/Users", token, person(email));
  expect(response.status, await response.clone().text()).toBe(201);
  return (await response.json()) as {
    id: string;
    userName: string;
    active: boolean;
  };
}

async function userRow(email: string) {
  const [row] = await db
    .select()
    .from(schema.userTable)
    .where(eq(schema.userTable.email, email))
    .limit(1);
  return row;
}

async function membership(userId: string, inWorkspace = workspaceId) {
  const [row] = await db
    .select()
    .from(schema.workspaceUserTable)
    .where(
      and(
        eq(schema.workspaceUserTable.userId, userId),
        eq(schema.workspaceUserTable.workspaceId, inWorkspace),
      ),
    )
    .limit(1);
  return row;
}

async function markPendingDeletion() {
  const now = new Date();
  await db
    .update(schema.workspaceTable)
    .set({
      deletionScheduledAt: now,
      deletionDueAt: new Date(now.getTime() + 86_400_000),
    })
    .where(eq(schema.workspaceTable.id, workspaceId));
}

const memberEvents: Array<Record<string, unknown>> = [];

beforeAll(async () => {
  await subscribeToEvent<Record<string, unknown>>(
    "workspace.members_changed",
    async (data) => {
      memberEvents.push(data);
    },
  );
});

beforeEach(async () => {
  await resetInstanceState();
  resetRateLimitMemory();
  memberEvents.length = 0;
  app = createApp().app;
  admin = await signUpWithSession(app, "admin@example.com");
  unlockSignUpSettings();
  await refreshInstanceSettings();
  const seeded = await createWorkspaceMember({ workspaceName: "Acme" });
  workspaceId = seeded.workspace.id;
});

afterEach(() => vi.unstubAllEnvs());

describe("managing connections", () => {
  it("is for instance admins with a session only", async () => {
    const someone = await signUpWithSession(app, "someone@example.com");
    for (const [method, path, body] of [
      ["GET", "/identity/scim"],
      ["POST", "/identity/scim", { name: "x", workspaceId }],
      ["POST", "/identity/scim/any/rotate"],
      ["DELETE", "/identity/scim/any"],
    ] as const) {
      const response = await adminRequest(
        app,
        method,
        path,
        someone.cookie,
        body,
      );
      expect(response.status, `${method} ${path}`).toBe(403);
    }
    const anonymous = await app.request("/api/instance-admin/identity/scim");
    expect(anonymous.status).toBe(401);
  });

  it("returns the token once and stores only its hash", async () => {
    const { token, baseUrl, connection } = await connect();
    expect(baseUrl).toBe("http://localhost:1337/api/auth/scim/v2");

    const [row] = await db
      .select()
      .from(scimProviderTable)
      .where(eq(scimProviderTable.id, connection.id));
    const secret = Buffer.from(token, "base64url").toString().split(":")[0];
    expect(row?.scimToken).toBe(hashScimSecret(secret ?? ""));
    expect(row?.scimToken).not.toContain(secret);

    const list = await adminRequest(app, "GET", "/identity/scim", admin.cookie);
    const text = await list.text();
    expect(list.status).toBe(200);
    expect(text).not.toContain(token);
    expect(text).not.toContain(row?.scimToken);
    expect(text).not.toContain(secret);
    expect(JSON.parse(text).items).toEqual([
      expect.objectContaining({
        id: connection.id,
        workspaceId,
        workspaceName: "Acme",
        provisionedUsers: 0,
      }),
    ]);
  });

  it("refuses an unknown workspace and one pending deletion", async () => {
    const unknown = await adminRequest(
      app,
      "POST",
      "/identity/scim",
      admin.cookie,
      { name: "x", workspaceId: "nope" },
    );
    expect(unknown.status).toBe(404);

    await markPendingDeletion();
    const locked = await adminRequest(
      app,
      "POST",
      "/identity/scim",
      admin.cookie,
      { name: "x", workspaceId },
    );
    expect(locked.status).toBe(409);
  });

  it("writes to the instance audit trail without the token", async () => {
    const { token } = await connect();
    const audit = await adminRequest(
      app,
      "GET",
      "/audit-log?action=scim.connection_created",
      admin.cookie,
    );
    const text = await audit.text();
    expect(audit.status).toBe(200);
    expect(text).toContain("scim.connection_created");
    expect(text).not.toContain(token);
  });

  it("keeps the plugin's own management endpoints closed", async () => {
    const signedIn = {
      cookie: admin.cookie,
      "content-type": "application/json",
      Origin: ORIGIN,
    };
    for (const [method, path, body] of [
      ["POST", "/scim/generate-token", { providerId: "mine" }],
      ["GET", "/scim/list-provider-connections"],
      ["GET", "/scim/get-provider-connection?providerId=x"],
      ["POST", "/scim/delete-provider-connection", { providerId: "x" }],
    ] as const) {
      const response = await app.request(`/api/auth${path}`, {
        method,
        headers: signedIn,
        body: body ? JSON.stringify(body) : undefined,
      });
      expect(response.status, path).toBe(404);
    }
    const [{ value } = { value: 1 }] = await db
      .select({ value: sql<number>`count(*)::int` })
      .from(scimProviderTable);
    expect(value).toBe(0);
  });
});

describe("the token", () => {
  it("is refused when missing, wrong or forged", async () => {
    const { token } = await connect();
    await scimError(await app.request(`${SCIM}/Users`), 401);
    for (const bad of [
      "not-a-token",
      Buffer.from("a:b:c").toString("base64url"),
      // Right connection, wrong secret.
      Buffer.from(
        [
          "wrong",
          ...Buffer.from(token, "base64url").toString().split(":").slice(1),
        ].join(":"),
      ).toString("base64url"),
    ]) {
      await scimError(await scim("GET", "/Users", bad), 401);
    }
  });

  // The plugin reads these shapes too. Reaching it that way would skip every rule
  // in scim-hooks.ts and the audit trail, so they must not reach it at all.
  it.each([
    ["without the Bearer prefix", (token: string) => token],
    [
      "without its workspace",
      (token: string) => `Bearer ${withoutWorkspace(token)}`,
    ],
    ["without either", (token: string) => withoutWorkspace(token)],
  ])("is refused %s, before it can change anything", async (_, header) => {
    const { token } = await connect();
    const created = await provision(token, "pat@acme.example");
    await db
      .update(schema.userTable)
      .set({ role: "admin" })
      .where(eq(schema.userTable.id, created.id));
    const authorization = header(token);

    for (const [method, path, body] of [
      [
        "PATCH",
        `/Users/${created.id}`,
        patch({
          op: "replace",
          path: "userName",
          value: "attacker@evil.example",
        }),
      ],
      ["PUT", `/Users/${created.id}`, person("attacker@evil.example")],
      ["POST", "/Users", person("sam@acme.example")],
      ["DELETE", `/Users/${created.id}`],
      ["GET", "/Users"],
      ["GET", `/Users/${created.id}`],
    ] as const) {
      await scimError(await scimWith(authorization, method, path, body), 401);
    }
    expect(await userRow("pat@acme.example")).toMatchObject({ id: created.id });
    expect(await userRow("attacker@evil.example")).toBeUndefined();
    expect(await userRow("sam@acme.example")).toBeUndefined();
    expect(await membership(created.id)).toBeTruthy();
  });

  it("stops working when rotated, and people stay linked", async () => {
    const { token, connection } = await connect();
    const user = await provision(token, "pat@acme.example");

    const rotated = await adminRequest(
      app,
      "POST",
      `/identity/scim/${connection.id}/rotate`,
      admin.cookie,
    );
    expect(rotated.status).toBe(200);
    const next = ((await rotated.json()) as { token: string }).token;
    expect(next).not.toBe(token);

    expect((await scim("GET", "/Users", token)).status).toBe(401);
    expect((await scim("GET", `/Users/${user.id}`, next)).status).toBe(200);
  });

  it("stops working when the connection is removed, and people stay", async () => {
    const { token, connection } = await connect();
    const user = await provision(token, "pat@acme.example");

    const removed = await adminRequest(
      app,
      "DELETE",
      `/identity/scim/${connection.id}`,
      admin.cookie,
    );
    expect(removed.status).toBe(200);

    expect((await scim("GET", "/Users", token)).status).toBe(401);
    expect(await membership(user.id)).toBeTruthy();
    const links = await db
      .select()
      .from(schema.accountTable)
      .where(eq(schema.accountTable.userId, user.id));
    expect(links).toEqual([]);
  });

  it("goes away with its workspace", async () => {
    const { token } = await connect();
    await db
      .delete(schema.workspaceTable)
      .where(eq(schema.workspaceTable.id, workspaceId));
    expect((await scim("GET", "/Users", token)).status).toBe(401);
  });

  it("is not treated as an API key or a session", async () => {
    const { token } = await connect();
    const session = await app.request("/api/auth/get-session", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(session.status).toBe(401);

    const rest = await app.request("/api/workspace", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(rest.status).toBe(401);
  });
});

describe("adding people", () => {
  it("creates an account and a membership, with follow-ups", async () => {
    const { token } = await connect();
    const created = await provision(token, "pat@acme.example");

    expect(created).toMatchObject({
      userName: "pat@acme.example",
      active: true,
    });
    const user = await userRow("pat@acme.example");
    expect(user).toMatchObject({
      id: created.id,
      name: "Pat Lee",
      // The identity provider vouches, and provider sign-in needs it.
      emailVerified: true,
      role: "user",
    });
    expect(await membership(created.id)).toMatchObject({ role: "member" });
    await vi.waitFor(() =>
      expect(memberEvents).toContainEqual(
        expect.objectContaining({ workspaceId }),
      ),
    );
    const accounts = await db
      .select()
      .from(schema.accountTable)
      .where(eq(schema.accountTable.userId, created.id));
    expect(accounts).toHaveLength(1);
    expect(accounts[0]?.password).toBeNull();

    const audit = await adminRequest(
      app,
      "GET",
      "/audit-log?action=scim.user_provisioned",
      admin.cookie,
    );
    await expect(audit.text()).resolves.toContain("pat@acme.example");
  });

  it("works while sign-up is closed, as an admin's connection is the invitation", async () => {
    const { token } = await connect();
    await adminRequest(app, "PATCH", "/settings", admin.cookie, {
      values: { "auth.inviteOnly": true, "auth.emailSignUp": false },
    });
    await refreshInstanceSettings();
    await provision(token, "pat@acme.example");
  });

  it("still applies the instance's allowed email domains", async () => {
    const { token } = await connect();
    const saved = await adminRequest(app, "PATCH", "/settings", admin.cookie, {
      values: { "auth.allowedEmailDomains": "acme.example" },
    });
    expect(saved.status, await saved.clone().text()).toBe(200);
    await refreshInstanceSettings();
    await provision(token, "pat@acme.example");
    const outside = await scim(
      "POST",
      "/Users",
      token,
      person("pat@elsewhere.example"),
    );
    expect(outside.status).toBeGreaterThanOrEqual(400);
    expect(await userRow("pat@elsewhere.example")).toBeUndefined();
  });

  it("accepts capitals in a userName, which the plugin alone would refuse", async () => {
    const { token } = await connect();
    const response = await scim("POST", "/Users", token, {
      ...person("x"),
      userName: "Pat.Lee@Acme.Example",
      emails: undefined,
    });
    expect(response.status, await response.clone().text()).toBe(201);
    expect(await userRow("pat.lee@acme.example")).toBeTruthy();
  });

  it("reads a name from displayName, and primary as a string", async () => {
    const { token } = await connect();
    const response = await scim("POST", "/Users", token, {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
      userName: "pat@acme.example",
      displayName: "Pat from the directory",
      emails: [{ value: "pat@acme.example", primary: "True", type: "work" }],
      active: "True",
    });
    expect(response.status, await response.clone().text()).toBe(201);
    expect(await userRow("pat@acme.example")).toMatchObject({
      name: "Pat from the directory",
      banned: false,
    });
  });

  it("refuses a resource with no email, and agent addresses", async () => {
    const { token } = await connect();
    const noEmail = await scim("POST", "/Users", token, {
      ...person("x"),
      userName: "patlee",
      emails: undefined,
    });
    await scimError(noEmail, 400, "invalidValue");
    const agent = await scim(
      "POST",
      "/Users",
      token,
      person("bot@agents.margaya.invalid"),
    );
    await scimError(agent, 400, "invalidValue");
  });

  it("answers 409 for the same person twice", async () => {
    const { token } = await connect();
    await provision(token, "pat@acme.example");
    const again = await scim(
      "POST",
      "/Users",
      token,
      person("pat@acme.example"),
    );
    expect(again.status).toBe(409);
    await expect(again.json()).resolves.toMatchObject({
      scimType: "uniqueness",
    });
  });

  it("can create someone already deactivated, and they can't sign in", async () => {
    const { token } = await connect();
    const response = await scim(
      "POST",
      "/Users",
      token,
      person("pat@acme.example", { active: false }),
    );
    expect(response.status, await response.clone().text()).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ active: false });
    expect(await userRow("pat@acme.example")).toMatchObject({ banned: true });
  });

  it("refuses a workspace pending deletion", async () => {
    const { token } = await connect();
    await markPendingDeletion();
    const response = await scim(
      "POST",
      "/Users",
      token,
      person("pat@acme.example"),
    );
    await scimError(response, 423);
    expect(await userRow("pat@acme.example")).toBeUndefined();
  });
});

describe("existing accounts", () => {
  it("links someone already in this workspace", async () => {
    const { token } = await connect();
    const existing = await signUpWithSession(app, "pat@acme.example");
    await db.insert(schema.workspaceUserTable).values({
      workspaceId,
      userId: existing.user.id,
      role: "member",
      joinedAt: new Date(),
    });
    const created = await provision(token, "pat@acme.example");
    expect(created.id).toBe(existing.user.id);
  });

  it("links someone in no workspace", async () => {
    const { token } = await connect();
    const existing = await signUpWithSession(app, "pat@acme.example");
    const created = await provision(token, "pat@acme.example");
    expect(created.id).toBe(existing.user.id);
    expect(await membership(existing.user.id)).toBeTruthy();
  });

  it("won't touch someone in another workspace", async () => {
    const { token } = await connect();
    const other = await createWorkspaceMember({ workspaceName: "Other" });
    const email = other.user.email;
    const response = await scim("POST", "/Users", token, person(email));
    expect(response.status).toBe(409);
    expect(await membership(other.user.id)).toBeUndefined();
  });

  it("won't touch an instance admin", async () => {
    const { token } = await connect();
    const response = await scim(
      "POST",
      "/Users",
      token,
      person("admin@example.com"),
    );
    expect(response.status).toBe(409);
    expect(await membership(admin.user.id)).toBeUndefined();
  });

  it("won't touch an account the connection doesn't manage", async () => {
    const { token } = await connect();
    const seeded = await createWorkspaceMember({ workspaceName: "Other" });
    for (const [method, body] of [
      ["GET"],
      ["PUT", person("taken@acme.example")],
      [
        "PATCH",
        {
          schemas: [PATCH_SCHEMA],
          Operations: [{ op: "replace", path: "active", value: false }],
        },
      ],
      ["DELETE"],
    ] as const) {
      const response = await scim(
        method,
        `/Users/${seeded.user.id}`,
        token,
        body,
      );
      expect(response.status, method).toBe(404);
    }
    expect(await userRow(seeded.user.email)).toMatchObject({
      id: seeded.user.id,
    });
    const [row] = await db
      .select({ banned: schema.userTable.banned })
      .from(schema.userTable)
      .where(eq(schema.userTable.id, seeded.user.id));
    expect(row?.banned).not.toBe(true);
    expect(await membership(seeded.user.id, seeded.workspace.id)).toBeTruthy();
  });

  it("won't link someone who is also in another workspace", async () => {
    const { token } = await connect();
    const other = await createWorkspaceMember({ workspaceName: "Other" });
    await db.insert(schema.workspaceUserTable).values({
      workspaceId,
      userId: other.user.id,
      role: "member",
      joinedAt: new Date(),
    });

    const response = await scim(
      "POST",
      "/Users",
      token,
      person(other.user.email),
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      schemas: [ERROR_SCHEMA],
      scimType: "uniqueness",
    });
    expect((await scim("GET", `/Users/${other.user.id}`, token)).status).toBe(
      404,
    );
  });

  it("won't link an account an instance admin banned", async () => {
    const { token } = await connect();
    const existing = await signUpWithSession(app, "pat@acme.example");
    const banned = await adminRequest(
      app,
      "POST",
      `/users/${existing.user.id}/ban`,
      admin.cookie,
      { reason: "Left the company" },
    );
    expect(banned.status, await banned.clone().text()).toBe(200);

    // Linking with active:false would rewrite the ban as the plugin's own, which
    // the connection could then lift.
    const response = await scim(
      "POST",
      "/Users",
      token,
      person("pat@acme.example", { active: false }),
    );
    expect(response.status).toBe(409);
    expect(await userRow("pat@acme.example")).toMatchObject({
      banned: true,
      banReason: "Left the company",
    });
  });
});

// Their account is shared with another workspace, so its address and whether it
// can sign in at all aren't this connection's to change.
describe("someone who also belongs to another workspace", () => {
  async function shared(token: string) {
    const created = await provision(token, "pat@acme.example");
    const other = await createWorkspaceMember({ workspaceName: "Other" });
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: other.workspace.id,
      userId: created.id,
      role: "owner",
      joinedAt: new Date(),
    });
    return { created, otherWorkspaceId: other.workspace.id };
  }

  it.each([
    [
      "patch",
      "PATCH",
      patch({
        op: "replace",
        path: "userName",
        value: "attacker@evil.example",
      }),
    ],
    ["full update", "PUT", person("attacker@evil.example")],
  ])("won't have their address changed by a %s", async (_, method, body) => {
    const { token } = await connect();
    const { created } = await shared(token);

    const response = await scim(method, `/Users/${created.id}`, token, body);
    expect((await scimError(response, 409, "mutability")).detail).toContain(
      "another workspace",
    );
    expect(await userRow("pat@acme.example")).toMatchObject({
      id: created.id,
      emailVerified: true,
    });
    expect(await userRow("attacker@evil.example")).toBeUndefined();
  });

  it.each(BLANK_ADDRESSES)(
    "won't have their address blanked by %s",
    async (_, method, value) => {
      const { token } = await connect();
      const { created } = await shared(token);

      const response = await scim(
        method,
        `/Users/${created.id}`,
        token,
        blankAddressBody(method, value),
      );
      await scimError(response, 400, "invalidValue");
      expect(await userRow("pat@acme.example")).toMatchObject({
        id: created.id,
        emailVerified: true,
      });
    },
  );

  it.each([
    ["patch", "PATCH", patch({ op: "replace", path: "active", value: false })],
    ["full update", "PUT", person("pat@acme.example", { active: false })],
  ])("won't be deactivated by a %s", async (_, method, body) => {
    const { token } = await connect();
    const { created } = await shared(token);

    const response = await scim(method, `/Users/${created.id}`, token, body);
    expect((await scimError(response, 409, "mutability")).detail).toContain(
      "another workspace",
    );
    expect(await userRow("pat@acme.example")).toMatchObject({ banned: false });
  });

  // A name is the account's, shown in every workspace it belongs to.
  it.each([
    [
      "a patch of displayName",
      "PATCH",
      patch({ op: "replace", path: "displayName", value: "Pat Jones" }),
    ],
    [
      "a patch of name.formatted",
      "PATCH",
      patch({ op: "replace", path: "/name/formatted", value: "Pat Jones" }),
    ],
    [
      "a patch without a path",
      "PATCH",
      patch({ op: "replace", value: { displayName: "Pat Jones" } }),
    ],
    [
      "a nested patch value",
      "PATCH",
      patch({ op: "add", value: { name: { formatted: "Pat Jones" } } }),
    ],
    [
      "a patch of the given name",
      "PATCH",
      patch({ op: "replace", path: "name.givenName", value: "Sam" }),
    ],
    [
      "a patch of the family name",
      "PATCH",
      patch({ op: "replace", path: "name.familyName", value: "Jones" }),
    ],
    [
      "a full update",
      "PUT",
      person("pat@acme.example", { name: { formatted: "Pat Jones" } }),
    ],
    // With no name, the plugin names the account after its address.
    [
      "a full update without a name",
      "PUT",
      person("pat@acme.example", { name: undefined }),
    ],
  ])("won't be renamed by %s", async (_, method, body) => {
    const { token } = await connect();
    const { created } = await shared(token);

    const response = await scim(method, `/Users/${created.id}`, token, body);
    expect((await scimError(response, 409, "mutability")).detail).toContain(
      "another workspace",
    );
    expect(await userRow("pat@acme.example")).toMatchObject({
      name: "Pat Lee",
    });
  });

  it("still takes a routine sync that keeps their name", async () => {
    const { token } = await connect();
    const { created } = await shared(token);

    for (const [method, body] of [
      ["PUT", person("pat@acme.example")],
      [
        "PUT",
        person("pat@acme.example", {
          name: undefined,
          displayName: "Pat Lee",
        }),
      ],
      [
        "PATCH",
        patch({ op: "replace", path: "displayName", value: "Pat Lee" }),
      ],
      [
        "PATCH",
        patch(
          { op: "replace", path: "name.givenName", value: "Pat" },
          { op: "replace", path: "name.familyName", value: "Lee" },
        ),
      ],
      [
        "PATCH",
        patch(
          { op: "replace", path: "name.formatted", value: "Pat Jones" },
          { op: "replace", path: "name.formatted", value: "Pat Lee" },
        ),
      ],
      // The plugin skips an "add" of the current value without undoing an
      // earlier change, which would leave the name changed. Read as a replace,
      // the patch ends where it started.
      [
        "PATCH",
        patch(
          { op: "replace", path: "name.formatted", value: "Pat Jones" },
          { op: "add", path: "displayName", value: "Pat Lee" },
        ),
      ],
      ["PATCH", patch({ op: "replace", path: "externalId", value: "e-1" })],
    ] as const) {
      const response = await scim(method, `/Users/${created.id}`, token, body);
      expect(response.status, await response.clone().text()).toBeLessThan(300);
      expect(await userRow("pat@acme.example")).toMatchObject({
        name: "Pat Lee",
        banned: false,
      });
    }
  });

  it("refuses a name that isn't text", async () => {
    const { token } = await connect();
    const { created } = await shared(token);
    const response = await scim(
      "PATCH",
      `/Users/${created.id}`,
      token,
      patch({ op: "replace", path: "name.formatted", value: 7 }),
    );
    await scimError(response, 400, "invalidValue");
    expect(await userRow("pat@acme.example")).toMatchObject({
      name: "Pat Lee",
    });
  });

  it("can be removed from this workspace, and stays in the other", async () => {
    const { token } = await connect();
    const { created, otherWorkspaceId } = await shared(token);

    const removed = await scim("DELETE", `/Users/${created.id}`, token);
    expect(removed.status, await removed.clone().text()).toBe(204);
    expect(await membership(created.id)).toBeUndefined();
    expect(await membership(created.id, otherWorkspaceId)).toBeTruthy();
  });

  it("can have a deactivation from before they joined repeated or lifted", async () => {
    const { token } = await connect();
    const created = await provision(token, "pat@acme.example");
    const deactivated = await scim(
      "PATCH",
      `/Users/${created.id}`,
      token,
      patch({ op: "replace", path: "active", value: false }),
    );
    expect(deactivated.status).toBe(204);
    const other = await createWorkspaceMember({ workspaceName: "Other" });
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: other.workspace.id,
      userId: created.id,
      role: "member",
      joinedAt: new Date(),
    });

    const repeated = await scim(
      "PATCH",
      `/Users/${created.id}`,
      token,
      patch({ op: "replace", path: "active", value: false }),
    );
    expect(repeated.status, await repeated.clone().text()).toBe(204);
    const lifted = await scim(
      "PATCH",
      `/Users/${created.id}`,
      token,
      patch({ op: "replace", path: "active", value: true }),
    );
    expect(lifted.status, await lifted.clone().text()).toBe(204);
    expect(await userRow("pat@acme.example")).toMatchObject({ banned: false });
  });

  it("reads as not found once they've left this workspace", async () => {
    const { token } = await connect();
    const { created } = await shared(token);
    await db
      .delete(schema.workspaceUserTable)
      .where(
        and(
          eq(schema.workspaceUserTable.userId, created.id),
          eq(schema.workspaceUserTable.workspaceId, workspaceId),
        ),
      );

    // The account link outlives the membership. Answering 409 here would tell the
    // token holder about a workspace this person has nothing to do with any more.
    const response = await scim(
      "PATCH",
      `/Users/${created.id}`,
      token,
      patch({ op: "replace", path: "active", value: false }),
    );
    expect(response.status).toBe(404);
  });
});

describe("reading people", () => {
  it("lists and filters only this connection's people", async () => {
    const first = await connect();
    const created = await provision(first.token, "pat@acme.example");

    const otherWorkspace = await createWorkspaceMember({
      workspaceName: "Other",
    });
    const second = await connect(otherWorkspace.workspace.id, "Second");
    await provision(second.token, "sam@other.example");

    const list = await scim("GET", "/Users", first.token);
    expect(list.status).toBe(200);
    await expect(list.json()).resolves.toMatchObject({
      totalResults: 1,
      Resources: [{ id: created.id, userName: "pat@acme.example" }],
    });

    const filtered = await scim(
      "GET",
      `/Users?${new URLSearchParams({ filter: 'userName eq "pat@acme.example"', startIndex: "1", count: "1" })}`,
      first.token,
    );
    await expect(filtered.json()).resolves.toMatchObject({ totalResults: 1 });

    const none = await scim(
      "GET",
      `/Users?${new URLSearchParams({ filter: 'userName eq "sam@other.example"' })}`,
      first.token,
    );
    await expect(none.json()).resolves.toMatchObject({ totalResults: 0 });

    const single = await scim("GET", `/Users/${created.id}`, first.token);
    expect(single.status).toBe(200);
    const body = await single.text();
    expect(body).not.toContain("password");
    expect(body).not.toContain(first.token);

    const counted = await adminRequest(
      app,
      "GET",
      "/identity/scim",
      admin.cookie,
    );
    await expect(counted.json()).resolves.toMatchObject({
      items: [{ provisionedUsers: 1 }, { provisionedUsers: 1 }],
    });
  });

  it("serves the discovery endpoints", async () => {
    for (const path of [
      "/ServiceProviderConfig",
      "/Schemas",
      "/ResourceTypes",
    ]) {
      const response = await app.request(`${SCIM}${path}`);
      expect(response.status, path).toBe(200);
    }
  });
});

describe("changing people", () => {
  it("renames with a partial update, including displayName", async () => {
    const { token } = await connect();
    const created = await provision(token, "pat@acme.example");

    const patched = await scim("PATCH", `/Users/${created.id}`, token, {
      schemas: [PATCH_SCHEMA],
      Operations: [{ op: "Replace", path: "displayName", value: "Pat Jones" }],
    });
    expect(patched.status, await patched.clone().text()).toBe(204);
    expect(await userRow("pat@acme.example")).toMatchObject({
      name: "Pat Jones",
    });

    const pathless = await scim("PATCH", `/Users/${created.id}`, token, {
      schemas: [PATCH_SCHEMA],
      Operations: [{ op: "Replace", value: { displayName: "Pat Smith" } }],
    });
    expect(pathless.status, await pathless.clone().text()).toBe(204);
    expect(await userRow("pat@acme.example")).toMatchObject({
      name: "Pat Smith",
    });
  });

  it("accepts a patch of attributes it has nowhere to keep, and changes nothing", async () => {
    const { token } = await connect();
    const created = await provision(token, "pat@acme.example");
    const before = await userRow("pat@acme.example");

    const response = await scim("PATCH", `/Users/${created.id}`, token, {
      schemas: [PATCH_SCHEMA],
      Operations: [
        { op: "Replace", path: "title", value: "Director" },
        {
          op: "Add",
          path: 'phoneNumbers[type eq "work"].value',
          value: "+1 555 0100",
        },
        { op: "Remove", path: "preferredLanguage" },
        { op: "Replace", value: { department: "Sales" } },
      ],
    });
    expect(response.status, await response.clone().text()).toBe(204);
    expect(await userRow("pat@acme.example")).toEqual(before);
  });

  it("still applies what it keeps when a patch also names other attributes", async () => {
    const { token } = await connect();
    const created = await provision(token, "pat@acme.example");
    const response = await scim("PATCH", `/Users/${created.id}`, token, {
      schemas: [PATCH_SCHEMA],
      Operations: [
        { op: "Replace", path: "title", value: "Director" },
        { op: "Replace", path: "name.formatted", value: "Pat Renamed" },
      ],
    });
    expect(response.status, await response.clone().text()).toBe(204);
    expect(await userRow("pat@acme.example")).toMatchObject({
      name: "Pat Renamed",
    });
  });

  it("answers such a patch with 404 for someone it doesn't manage", async () => {
    const { token } = await connect();
    const response = await scim("PATCH", `/Users/${admin.user.id}`, token, {
      schemas: [PATCH_SCHEMA],
      Operations: [{ op: "Replace", path: "title", value: "Director" }],
    });
    expect(response.status).toBe(404);
  });

  it("still refuses a patch that isn't one", async () => {
    const { token } = await connect();
    const created = await provision(token, "pat@acme.example");
    const response = await scim("PATCH", `/Users/${created.id}`, token, {
      Operations: [{ op: "Replace", path: "title", value: "Director" }],
    });
    expect(response.status).toBe(400);
  });

  it("replaces with a full update", async () => {
    const { token } = await connect();
    const created = await provision(token, "pat@acme.example");
    const replaced = await scim(
      "PUT",
      `/Users/${created.id}`,
      token,
      person("pat.lee@acme.example", {
        name: { formatted: "Pat L." },
      }),
    );
    expect(replaced.status, await replaced.clone().text()).toBe(200);
    expect(await userRow("pat.lee@acme.example")).toMatchObject({
      id: created.id,
      name: "Pat L.",
      // A new address isn't proven, and only verified addresses link.
      emailVerified: false,
    });
  });

  it("won't move someone onto an address another account has", async () => {
    const { token } = await connect();
    const created = await provision(token, "pat@acme.example");
    await signUpWithSession(app, "taken@acme.example");
    const response = await scim("PATCH", `/Users/${created.id}`, token, {
      schemas: [PATCH_SCHEMA],
      Operations: [
        { op: "replace", path: "userName", value: "taken@acme.example" },
      ],
    });
    expect(response.status).toBe(409);
  });

  it("keeps a new address without the spaces around it", async () => {
    const { token } = await connect();
    const created = await provision(token, "pat@acme.example");
    const response = await scim(
      "PATCH",
      `/Users/${created.id}`,
      token,
      patch({
        op: "replace",
        path: "/userName",
        value: " Pat.Lee@Acme.Example ",
      }),
    );
    expect(response.status, await response.clone().text()).toBe(204);
    expect(await userRow("pat.lee@acme.example")).toMatchObject({
      id: created.id,
    });
  });

  it("renames through a slash path too", async () => {
    const { token } = await connect();
    const created = await provision(token, "pat@acme.example");
    for (const [operation, name] of [
      [{ op: "replace", path: "/displayName", value: "Pat One" }, "Pat One"],
      [{ op: "replace", value: { "/displayName": "Pat Two" } }, "Pat Two"],
      [
        { op: "replace", value: { "/name/formatted": "Pat Three" } },
        "Pat Three",
      ],
    ] as const) {
      const response = await scim(
        "PATCH",
        `/Users/${created.id}`,
        token,
        patch(operation),
      );
      expect(response.status, await response.clone().text()).toBe(204);
      expect(await userRow("pat@acme.example")).toMatchObject({ name });
    }
  });

  // Every spelling the plugin applies has to reach the same check.
  describe("won't change an instance admin's address", () => {
    const evil = "attacker@evil.example";

    it.each([
      ["a slash path", [{ op: "replace", path: "/userName", value: evil }]],
      ["an added value", [{ op: "add", path: "/userName", value: evil }]],
      ["a key in the value", [{ op: "replace", value: { userName: evil } }]],
      [
        "a slash key in the value",
        [{ op: "replace", value: { "/userName": evil } }],
      ],
      [
        "a slash key beside something it keeps",
        [
          {
            op: "replace",
            value: { "/userName": evil, "name.formatted": "x" },
          },
        ],
      ],
      [
        "a key nested under an empty one",
        [{ op: "replace", value: { "": { userName: evil } } }],
      ],
    ])("through %s", async (_, operations) => {
      const { token } = await connect();
      const created = await provision(token, "pat@acme.example");
      await db
        .update(schema.userTable)
        .set({ role: "admin" })
        .where(eq(schema.userTable.id, created.id));

      const response = await scim(
        "PATCH",
        `/Users/${created.id}`,
        token,
        patch(...operations),
      );
      expect(response.status).toBe(409);
      expect(await userRow("pat@acme.example")).toMatchObject({
        id: created.id,
        emailVerified: true,
      });
      expect(await userRow(evil)).toBeUndefined();
    });

    it.each(BLANK_ADDRESSES)("through %s", async (_, method, value) => {
      const { token } = await connect();
      const created = await provision(token, "pat@acme.example");
      await db
        .update(schema.userTable)
        .set({ role: "admin" })
        .where(eq(schema.userTable.id, created.id));

      const response = await scim(
        method,
        `/Users/${created.id}`,
        token,
        blankAddressBody(method, value),
      );
      await scimError(response, 400, "invalidValue");
      expect(await userRow("pat@acme.example")).toMatchObject({
        id: created.id,
        emailVerified: true,
      });
    });

    // The plugin skips an "add" that matches the current value without undoing an
    // earlier change, so reading only the last write would call this no change.
    it("through a change followed by adding the current address", async () => {
      const { token } = await connect();
      const created = await provision(token, "pat@acme.example");
      await db
        .update(schema.userTable)
        .set({ role: "admin" })
        .where(eq(schema.userTable.id, created.id));

      await scim(
        "PATCH",
        `/Users/${created.id}`,
        token,
        patch(
          { op: "replace", path: "userName", value: evil },
          { op: "add", path: "userName", value: "pat@acme.example" },
        ),
      );
      expect(await userRow("pat@acme.example")).toMatchObject({
        id: created.id,
      });
      expect(await userRow(evil)).toBeUndefined();
    });
  });
});

describe("deactivating people", () => {
  async function signedInPerson(email: string, token: string) {
    const created = await provision(token, email);
    const now = new Date();
    await db.insert(schema.sessionTable).values({
      id: `session-${created.id}`,
      token: `token-${created.id}`,
      userId: created.id,
      expiresAt: new Date(now.getTime() + 3_600_000),
      createdAt: now,
      updatedAt: now,
    });
    return created;
  }

  async function sessionCount(userId: string) {
    const rows = await db
      .select()
      .from(schema.sessionTable)
      .where(eq(schema.sessionTable.userId, userId));
    return rows.length;
  }

  it.each([
    ["boolean", { op: "replace", path: "active", value: false }],
    ["capitalized string", { op: "Replace", path: "active", value: "False" }],
    ["no path", { op: "replace", value: { active: false } }],
    ["no path, string", { op: "Replace", value: { active: "False" } }],
    ["slash path", { op: "replace", path: "/active", value: false }],
    ["slash path, string", { op: "Replace", path: "/active", value: "False" }],
    ["slash key", { op: "replace", value: { "/active": false } }],
    ["slash key, string", { op: "replace", value: { "/active": "False" } }],
    ["added value", { op: "add", path: "active", value: "False" }],
  ])(
    "ends sign-in and sessions for a patch with a %s",
    async (_, operation) => {
      const { token } = await connect();
      const created = await signedInPerson("pat@acme.example", token);
      expect(await sessionCount(created.id)).toBe(1);

      const response = await scim("PATCH", `/Users/${created.id}`, token, {
        schemas: [PATCH_SCHEMA],
        Operations: [operation],
      });
      expect(response.status, await response.clone().text()).toBe(204);

      expect(await userRow("pat@acme.example")).toMatchObject({ banned: true });
      expect(await sessionCount(created.id)).toBe(0);
      const read = await scim("GET", `/Users/${created.id}`, token);
      await expect(read.json()).resolves.toMatchObject({ active: false });
      // Still in the workspace: an identity provider's deactivation is reversible.
      expect(await membership(created.id)).toBeTruthy();
    },
  );

  it("refuses password sign-in, and reactivating brings it back", async () => {
    const { token } = await connect();
    const existing = await signUpWithSession(app, "pat@acme.example");
    const created = await provision(token, "pat@acme.example");
    expect(created.id).toBe(existing.user.id);

    await scim("PATCH", `/Users/${created.id}`, token, {
      schemas: [PATCH_SCHEMA],
      Operations: [{ op: "replace", path: "active", value: false }],
    });
    const refused = await authPost(app, "/sign-in/email", {
      email: "pat@acme.example",
      password: "correct horse battery staple",
    });
    expect(refused.status).toBe(403);

    const restored = await scim("PATCH", `/Users/${created.id}`, token, {
      schemas: [PATCH_SCHEMA],
      Operations: [{ op: "replace", path: "active", value: true }],
    });
    expect(restored.status, await restored.clone().text()).toBe(204);
    expect(await userRow("pat@acme.example")).toMatchObject({ banned: false });
    const allowed = await authPost(app, "/sign-in/email", {
      email: "pat@acme.example",
      password: "correct horse battery staple",
    });
    expect(allowed.status).toBe(200);

    const audit = await adminRequest(
      app,
      "GET",
      "/audit-log?action=scim.user_deactivated,scim.user_reactivated",
      admin.cookie,
    );
    const text = await audit.text();
    expect(text).toContain("scim.user_deactivated");
    expect(text).toContain("scim.user_reactivated");
  });

  it("deactivates with a full update too", async () => {
    const { token } = await connect();
    const created = await signedInPerson("pat@acme.example", token);
    const response = await scim(
      "PUT",
      `/Users/${created.id}`,
      token,
      person("pat@acme.example", { active: "False" }),
    );
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await userRow("pat@acme.example")).toMatchObject({ banned: true });
    expect(await sessionCount(created.id)).toBe(0);
  });

  it.each([
    ["a bare path", [{ op: "replace", path: "active", value: false }]],
    ["a slash path", [{ op: "replace", path: "/active", value: false }]],
    ["a slash path and a string", [{ path: "/active", value: "False" }]],
    ["a slash key", [{ op: "replace", value: { "/active": false } }]],
    [
      "a change followed by adding the current value",
      [
        { op: "replace", path: "active", value: false },
        { op: "add", path: "active", value: true },
      ],
    ],
  ])("protects the last instance admin from %s", async (_, operations) => {
    const { token } = await connect();
    const created = await provision(token, "pat@acme.example");
    // Promoted after it was provisioned, and the only other admin steps down.
    await db
      .update(schema.userTable)
      .set({ role: "admin" })
      .where(eq(schema.userTable.id, created.id));
    await db
      .update(schema.userTable)
      .set({ role: "user" })
      .where(eq(schema.userTable.id, admin.user.id));

    await scim("PATCH", `/Users/${created.id}`, token, patch(...operations));
    expect(await userRow("pat@acme.example")).not.toMatchObject({
      banned: true,
    });
  });

  it("refuses the last instance admin's deactivation with a clear answer", async () => {
    const { token } = await connect();
    const created = await provision(token, "pat@acme.example");
    await db
      .update(schema.userTable)
      .set({ role: "admin" })
      .where(eq(schema.userTable.id, created.id));
    await db
      .update(schema.userTable)
      .set({ role: "user" })
      .where(eq(schema.userTable.id, admin.user.id));

    for (const path of ["active", "/active"]) {
      const response = await scim(
        "PATCH",
        `/Users/${created.id}`,
        token,
        patch({ op: "replace", path, value: false }),
      );
      await scimError(response, 409, "mutability");
    }
  });

  // A ban reaches the whole instance, which is more than a workspace's token may
  // do to the people who run it.
  it.each([
    [
      "a patch",
      "PATCH",
      patch({ op: "replace", path: "active", value: false }),
    ],
    [
      "a patch without a path",
      "PATCH",
      patch({ op: "replace", value: { active: "False" } }),
    ],
    ["a full update", "PUT", person("pat@acme.example", { active: false })],
  ])(
    "refuses any instance admin's deactivation by %s, though other admins remain",
    async (_, method, body) => {
      const { token } = await connect();
      const created = await signedInPerson("pat@acme.example", token);
      await db
        .update(schema.userTable)
        .set({ role: "admin" })
        .where(eq(schema.userTable.id, created.id));
      expect(await userRow("admin@example.com")).toMatchObject({
        role: "admin",
      });

      const response = await scim(method, `/Users/${created.id}`, token, body);
      expect((await scimError(response, 409, "mutability")).detail).toContain(
        "instance admin",
      );
      expect(await userRow("pat@acme.example")).toMatchObject({
        banned: false,
      });
      expect(await sessionCount(created.id)).toBe(1);
    },
  );

  it("still lets an instance admin be renamed or removed from this workspace", async () => {
    const { token } = await connect();
    const created = await provision(token, "pat@acme.example");
    await db
      .update(schema.userTable)
      .set({ role: "admin" })
      .where(eq(schema.userTable.id, created.id));

    const renamed = await scim(
      "PATCH",
      `/Users/${created.id}`,
      token,
      patch({ op: "replace", path: "displayName", value: "Pat Jones" }),
    );
    expect(renamed.status, await renamed.clone().text()).toBe(204);
    const removed = await scim("DELETE", `/Users/${created.id}`, token);
    expect(removed.status, await removed.clone().text()).toBe(204);
    expect(await membership(created.id)).toBeUndefined();
  });

  it.each([
    ["a word", "no"],
    ["a number", 0],
    ["nothing", null],
  ])(
    "refuses active set to %s, which the plugin reads as active",
    async (_, value) => {
      const { token } = await connect();
      const created = await provision(token, "pat@acme.example");
      await scim(
        "PATCH",
        `/Users/${created.id}`,
        token,
        patch({ op: "replace", path: "active", value: false }),
      );

      const response = await scim(
        "PATCH",
        `/Users/${created.id}`,
        token,
        patch({ op: "replace", path: "active", value }),
      );
      await scimError(response, 400, "invalidValue");
      expect(await userRow("pat@acme.example")).toMatchObject({ banned: true });
    },
  );

  describe("a ban an instance admin set", () => {
    async function bannedByAdmin(token: string, reason?: string) {
      const created = await provision(token, "pat@acme.example");
      const banned = await adminRequest(
        app,
        "POST",
        `/users/${created.id}/ban`,
        admin.cookie,
        { reason, expiresInDays: 30 },
      );
      expect(banned.status, await banned.clone().text()).toBe(200);
      const row = await userRow("pat@acme.example");
      expect(row?.banExpires).toBeTruthy();
      return {
        created,
        ban: {
          banned: true,
          banReason: reason ?? null,
          banExpires: row?.banExpires,
        },
      };
    }

    it.each([
      ["a routine full update", "PUT", person("pat@acme.example")],
      [
        "a patch",
        "PATCH",
        patch({ op: "replace", path: "active", value: true }),
      ],
      [
        "a slash path",
        "PATCH",
        patch({ op: "replace", path: "/active", value: "True" }),
      ],
      ["a key", "PATCH", patch({ op: "replace", value: { active: true } })],
    ])("isn't lifted by %s", async (_, method, body) => {
      const { token } = await connect();
      const { created, ban } = await bannedByAdmin(token, "Left the company");

      const response = await scim(method, `/Users/${created.id}`, token, body);
      expect((await scimError(response, 409, "mutability")).detail).toContain(
        "instance admin",
      );
      expect(await userRow("pat@acme.example")).toMatchObject(ban);
    });

    it("isn't lifted when it has no reason", async () => {
      const { token } = await connect();
      const { created, ban } = await bannedByAdmin(token);
      const response = await scim(
        "PUT",
        `/Users/${created.id}`,
        token,
        person("pat@acme.example"),
      );
      expect(response.status).toBe(409);
      expect(await userRow("pat@acme.example")).toMatchObject(ban);
    });

    // Deactivating would rewrite it as the plugin's own, which reactivating lifts.
    it.each([
      [
        "a patch",
        "PATCH",
        patch({ op: "replace", path: "active", value: false }),
      ],
      ["a full update", "PUT", person("pat@acme.example", { active: false })],
    ])("isn't rewritten by %s", async (_, method, body) => {
      const { token } = await connect();
      const { created, ban } = await bannedByAdmin(token, "Left the company");

      const response = await scim(method, `/Users/${created.id}`, token, body);
      expect(response.status).toBe(409);
      expect(await userRow("pat@acme.example")).toMatchObject(ban);
    });

    it("leaves other changes alone", async () => {
      const { token } = await connect();
      const { created, ban } = await bannedByAdmin(token, "Left the company");
      const response = await scim(
        "PATCH",
        `/Users/${created.id}`,
        token,
        patch({ op: "replace", path: "displayName", value: "Pat Jones" }),
      );
      expect(response.status, await response.clone().text()).toBe(204);
      expect(await userRow("pat@acme.example")).toMatchObject({
        ...ban,
        name: "Pat Jones",
      });
    });

    it("stops mattering once an instance admin lifts it", async () => {
      const { token } = await connect();
      const { created } = await bannedByAdmin(token, "Left the company");
      const lifted = await adminRequest(
        app,
        "POST",
        `/users/${created.id}/unban`,
        admin.cookie,
      );
      expect(lifted.status, await lifted.clone().text()).toBe(200);

      const response = await scim(
        "PUT",
        `/Users/${created.id}`,
        token,
        person("pat@acme.example", { active: false }),
      );
      expect(response.status, await response.clone().text()).toBe(200);
      expect(await userRow("pat@acme.example")).toMatchObject({ banned: true });
    });
  });

  it("won't change an instance admin's address", async () => {
    const { token } = await connect();
    const created = await provision(token, "pat@acme.example");
    await db
      .update(schema.userTable)
      .set({ role: "admin" })
      .where(eq(schema.userTable.id, created.id));
    const response = await scim("PATCH", `/Users/${created.id}`, token, {
      schemas: [PATCH_SCHEMA],
      Operations: [
        { op: "replace", path: "userName", value: "attacker@evil.example" },
      ],
    });
    expect(response.status).toBe(409);
    expect(await userRow("pat@acme.example")).toBeTruthy();
  });
});

describe("removing people", () => {
  it("accepts the content type a provider sends on every call, body or not", async () => {
    const { token } = await connect();
    const created = await provision(token, "pat@acme.example");

    // An empty stream is what a real HTTP server hands over for no body.
    const removed = await app.request(`${SCIM}/Users/${created.id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}`, "content-type": JSON_TYPE },
      body: new ReadableStream({ start: (controller) => controller.close() }),
      duplex: "half",
    } as RequestInit);
    expect(removed.status, await removed.clone().text()).toBe(204);
    expect(await membership(created.id)).toBeUndefined();
  });

  it("removes them from the workspace and stops managing them", async () => {
    const { token } = await connect();
    const created = await provision(token, "pat@acme.example");

    const removed = await scim("DELETE", `/Users/${created.id}`, token);
    expect(removed.status, await removed.clone().text()).toBe(204);

    expect(await membership(created.id)).toBeUndefined();
    expect(await userRow("pat@acme.example")).toBeTruthy();
    expect((await scim("GET", `/Users/${created.id}`, token)).status).toBe(404);
    const links = await db
      .select()
      .from(schema.accountTable)
      .where(eq(schema.accountTable.userId, created.id));
    expect(links).toEqual([]);

    await vi.waitFor(() =>
      expect(memberEvents).toContainEqual(
        expect.objectContaining({
          workspaceId,
          userId: created.id,
          accessEnded: true,
        }),
      ),
    );
    const audit = await adminRequest(
      app,
      "GET",
      "/audit-log?action=scim.user_removed",
      admin.cookie,
    );
    await expect(audit.text()).resolves.toContain("pat@acme.example");
  });

  it("can add someone back after removing them", async () => {
    const { token } = await connect();
    const created = await provision(token, "pat@acme.example");
    await scim("DELETE", `/Users/${created.id}`, token);
    const again = await provision(token, "pat@acme.example");
    expect(again.id).toBe(created.id);
    expect(await membership(created.id)).toBeTruthy();
  });

  it("keeps a workspace's only owner", async () => {
    const { token } = await connect();
    const created = await provision(token, "pat@acme.example");
    await db
      .update(schema.workspaceUserTable)
      .set({ role: "member" })
      .where(eq(schema.workspaceUserTable.workspaceId, workspaceId));
    await db
      .update(schema.workspaceUserTable)
      .set({ role: "owner" })
      .where(eq(schema.workspaceUserTable.userId, created.id));

    const response = await scim("DELETE", `/Users/${created.id}`, token);
    await scimError(response, 409);
    expect(await membership(created.id)).toBeTruthy();
  });

  it("is refused while the workspace is pending deletion", async () => {
    const { token } = await connect();
    const created = await provision(token, "pat@acme.example");
    await markPendingDeletion();
    const response = await scim("DELETE", `/Users/${created.id}`, token);
    await scimError(response, 423);
    expect(await membership(created.id)).toBeTruthy();
  });
});

// What scim2-tester 0.6.4 found the plugin alone doesn't do as RFC 7644 asks.
describe("RFC 7644 conformance", () => {
  const USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User";
  const LIST_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:ListResponse";
  const SEARCH_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:SearchRequest";

  type Resource = Record<string, unknown>;

  async function read(token: string, path: string) {
    const response = await scim("GET", path, token);
    expect(response.status, await response.clone().text()).toBe(200);
    return (await response.json()) as Resource;
  }

  async function provisionWith(token: string, body: Record<string, unknown>) {
    const response = await scim("POST", "/Users", token, body);
    expect(response.status, await response.clone().text()).toBe(201);
    return (await response.json()) as Resource & { id: string };
  }

  async function accountId(userId: string) {
    const [row] = await db
      .select({ accountId: schema.accountTable.accountId })
      .from(schema.accountTable)
      .where(eq(schema.accountTable.userId, userId))
      .limit(1);
    return row?.accountId;
  }

  describe("attributes and excludedAttributes", () => {
    it("return only the attributes asked for, and always the id", async () => {
      const { token } = await connect();
      const created = await provision(token, "pat@acme.example");

      const only = await read(
        token,
        `/Users/${created.id}?attributes=userName`,
      );
      expect(only).toEqual({
        schemas: [USER_SCHEMA],
        id: created.id,
        userName: "pat@acme.example",
      });

      const parts = await read(
        token,
        `/Users/${created.id}?attributes=name.givenName,urn:ietf:params:scim:schemas:core:2.0:User:emails.value`,
      );
      expect(parts).toEqual({
        schemas: [USER_SCHEMA],
        id: created.id,
        name: { givenName: "Pat" },
        emails: [{ value: "pat@acme.example" }],
      });

      const list = await read(token, "/Users?attributes=active");
      expect(list).toMatchObject({ schemas: [LIST_SCHEMA], totalResults: 1 });
      expect(list.Resources).toEqual([
        { schemas: [USER_SCHEMA], id: created.id, active: true },
      ]);
    });

    it("leave out what's excluded, except the id", async () => {
      const { token } = await connect();
      const created = await provision(token, "pat@acme.example");

      const single = await read(
        token,
        `/Users/${created.id}?excludedAttributes=emails,name,id`,
      );
      expect(single).toMatchObject({
        id: created.id,
        userName: "pat@acme.example",
        active: true,
        displayName: "Pat Lee",
      });
      expect(single).not.toHaveProperty("emails");
      expect(single).not.toHaveProperty("name");

      const list = await read(
        token,
        "/Users?excludedAttributes=name.familyName,meta",
      );
      const [resource] = list.Resources as Resource[];
      expect(resource).toMatchObject({
        id: created.id,
        name: { formatted: "Pat Lee", givenName: "Pat" },
      });
      expect(resource?.name).not.toHaveProperty("familyName");
      expect(resource).not.toHaveProperty("meta");
    });
  });

  describe("paging", () => {
    async function fivePeople(token: string) {
      const ids: string[] = [];
      for (const name of ["ana", "ben", "cy", "dee", "eli"]) {
        ids.push((await provision(token, `${name}@acme.example`)).id);
      }
      return ids.sort();
    }

    const ids = (list: Resource) =>
      (list.Resources as Resource[]).map((resource) => resource.id);

    it("pages the list with startIndex and count, in a stable order", async () => {
      const { token } = await connect();
      const everyone = await fivePeople(token);

      const seen: unknown[] = [];
      for (const startIndex of [1, 3, 5]) {
        const page = await read(
          token,
          `/Users?startIndex=${startIndex}&count=2`,
        );
        expect(page).toMatchObject({
          schemas: [LIST_SCHEMA],
          totalResults: 5,
          startIndex,
          itemsPerPage: startIndex === 5 ? 1 : 2,
        });
        seen.push(...ids(page));
      }
      expect(seen).toEqual(everyone);

      const whole = await read(token, "/Users");
      expect(whole).toMatchObject({
        totalResults: 5,
        startIndex: 1,
        itemsPerPage: 5,
      });
      expect(ids(whole)).toEqual(everyone);
    });

    it("reads out-of-range values as RFC 7644 says", async () => {
      const { token } = await connect();
      const everyone = await fivePeople(token);

      const none = await read(token, "/Users?count=0");
      expect(none).toMatchObject({
        totalResults: 5,
        itemsPerPage: 0,
        Resources: [],
      });
      expect(await read(token, "/Users?count=-3")).toMatchObject({
        totalResults: 5,
        itemsPerPage: 0,
      });

      const fromZero = await read(token, "/Users?startIndex=0&count=1");
      expect(fromZero).toMatchObject({ startIndex: 1, itemsPerPage: 1 });
      expect(ids(fromZero)).toEqual(everyone.slice(0, 1));

      expect(await read(token, "/Users?startIndex=9")).toMatchObject({
        totalResults: 5,
        startIndex: 9,
        itemsPerPage: 0,
        Resources: [],
      });
      expect(await read(token, "/Users?count=100000")).toMatchObject({
        itemsPerPage: 5,
      });

      for (const query of ["startIndex=first", "count=2.5"]) {
        await scimError(
          await scim("GET", `/Users?${query}`, token),
          400,
          "invalidValue",
        );
      }
    });

    it("pages a search and a filtered list too", async () => {
      const { token } = await connect();
      const everyone = await fivePeople(token);

      const response = await scim("POST", "/Users/.search", token, {
        schemas: [SEARCH_SCHEMA],
        startIndex: 2,
        count: 2,
      });
      expect(response.status, await response.clone().text()).toBe(200);
      const page = (await response.json()) as Resource;
      expect(page).toMatchObject({
        totalResults: 5,
        startIndex: 2,
        itemsPerPage: 2,
      });
      expect(ids(page)).toEqual(everyone.slice(1, 3));

      const filtered = await read(
        token,
        `/Users?${new URLSearchParams({ filter: 'userName eq "cy@acme.example"', startIndex: "2" })}`,
      );
      expect(filtered).toMatchObject({
        totalResults: 1,
        startIndex: 2,
        itemsPerPage: 0,
      });
    });

    it("announces its page size", async () => {
      const response = await app.request(`${SCIM}/ServiceProviderConfig`);
      await expect(response.json()).resolves.toMatchObject({
        filter: { supported: true, maxResults: 500 },
      });
    });
  });

  describe("searching with POST", () => {
    it.each([["/Users/.search"], ["/.search"]])(
      "answers %s like a filtered list",
      async (path) => {
        const { token } = await connect();
        const created = await provision(token, "pat@acme.example");
        await provision(token, "sam@acme.example");

        const response = await scim("POST", path, token, {
          schemas: [SEARCH_SCHEMA],
          filter: 'userName eq "pat@acme.example"',
          attributes: ["userName"],
          startIndex: 1,
          count: 10,
        });
        expect(response.status, await response.clone().text()).toBe(200);
        await expect(response.json()).resolves.toMatchObject({
          schemas: [LIST_SCHEMA],
          totalResults: 1,
          Resources: [
            {
              schemas: [USER_SCHEMA],
              id: created.id,
              userName: "pat@acme.example",
            },
          ],
        });

        const excluded = await scim("POST", path, token, {
          schemas: [SEARCH_SCHEMA],
          excludedAttributes: ["emails"],
        });
        const body = (await excluded.json()) as { Resources: Resource[] };
        expect(body.Resources).toHaveLength(2);
        for (const resource of body.Resources) {
          expect(resource).not.toHaveProperty("emails");
        }
      },
    );

    it("still needs the token, and a search that is one", async () => {
      const { token } = await connect();
      const anonymous = await app.request(`${SCIM}/Users/.search`, {
        method: "POST",
        headers: { "content-type": JSON_TYPE },
        body: JSON.stringify({ schemas: [SEARCH_SCHEMA] }),
      });
      await scimError(anonymous, 401);

      const wrong = await scim("POST", "/Users/.search", token, {
        schemas: [SEARCH_SCHEMA],
        filter: 7,
      });
      await scimError(wrong, 400, "invalidValue");
    });
  });

  describe("filtering by externalId", () => {
    it("finds the person with that externalId, and only this connection's", async () => {
      const { token } = await connect();
      const created = await provisionWith(
        token,
        person("pat@acme.example", { externalId: "dir-0001" }),
      );
      expect(created.externalId).toBe("dir-0001");

      const other = await createWorkspaceMember({ workspaceName: "Other" });
      const second = await connect(other.workspace.id, "Second");
      await provisionWith(
        second.token,
        person("sam@other.example", { externalId: "dir-0002" }),
      );

      const found = await read(
        token,
        `/Users?${new URLSearchParams({ filter: 'externalId eq "dir-0001"' })}`,
      );
      expect(found).toMatchObject({
        totalResults: 1,
        Resources: [{ id: created.id, externalId: "dir-0001" }],
      });

      for (const filter of [
        'externalId eq "dir-0002"',
        'externalId eq "nobody"',
      ]) {
        const none = await read(
          token,
          `/Users?${new URLSearchParams({ filter })}`,
        );
        expect(none, filter).toMatchObject({ totalResults: 0, Resources: [] });
      }
    });
  });

  describe("removing attributes with a patch", () => {
    it("removes externalId, and a person created without one has none", async () => {
      const { token } = await connect();
      const plain = await provision(token, "pat@acme.example");
      expect(plain).not.toHaveProperty("externalId");
      expect(await read(token, `/Users/${plain.id}`)).not.toHaveProperty(
        "externalId",
      );

      const created = await provisionWith(
        token,
        person("sam@acme.example", { externalId: "dir-0001" }),
      );
      const response = await scim(
        "PATCH",
        `/Users/${created.id}`,
        token,
        patch({ op: "remove", path: "externalId" }),
      );
      expect(response.status, await response.clone().text()).toBe(204);
      expect(await read(token, `/Users/${created.id}`)).not.toHaveProperty(
        "externalId",
      );
      // What the plugin keeps for a person provisioned without one, so adding
      // them again is still recognised.
      expect(await accountId(created.id)).toBe("sam@acme.example");
      const again = await scim(
        "POST",
        "/Users",
        token,
        person("sam@acme.example"),
      );
      expect(again.status).toBe(409);
    });

    it("removes the name, which leaves the account named after its address", async () => {
      const { token } = await connect();
      const created = await provision(token, "pat@acme.example");
      const response = await scim(
        "PATCH",
        `/Users/${created.id}`,
        token,
        patch({ op: "remove", path: "name" }),
      );
      expect(response.status, await response.clone().text()).toBe(204);
      expect(await userRow("pat@acme.example")).toMatchObject({
        name: "pat@acme.example",
      });
      const resource = await read(token, `/Users/${created.id}`);
      expect(resource).not.toHaveProperty("name");
      expect(resource).not.toHaveProperty("displayName");
    });

    it("removes one part of the name", async () => {
      const { token } = await connect();
      const created = await provision(token, "pat@acme.example");
      const response = await scim(
        "PATCH",
        `/Users/${created.id}`,
        token,
        patch({ op: "remove", path: "name.givenName" }),
      );
      expect(response.status, await response.clone().text()).toBe(204);
      expect(await userRow("pat@acme.example")).toMatchObject({ name: "Lee" });
    });

    it.each([
      ["active", { op: "remove", path: "active" }, "mutability"],
      ["userName", { op: "remove", path: "userName" }, "mutability"],
      ["emails", { op: "remove", path: "emails" }, "mutability"],
      [
        "the work email",
        { op: "remove", path: 'emails[type eq "work"].value' },
        "mutability",
      ],
      ["no path", { op: "remove" }, "noTarget"],
    ])("refuses removing %s", async (_, operation, scimType) => {
      const { token } = await connect();
      const created = await provision(token, "pat@acme.example");
      const before = await userRow("pat@acme.example");
      const response = await scim(
        "PATCH",
        `/Users/${created.id}`,
        token,
        patch(operation),
      );
      await scimError(response, 400, scimType);
      expect(await userRow("pat@acme.example")).toEqual(before);
    });

    it("accepts removing an address it doesn't keep", async () => {
      const { token } = await connect();
      const created = await provision(token, "pat@acme.example");
      const before = await userRow("pat@acme.example");
      const response = await scim(
        "PATCH",
        `/Users/${created.id}`,
        token,
        patch({ op: "remove", path: 'emails[type eq "home"]' }),
      );
      expect(response.status, await response.clone().text()).toBe(204);
      expect(await userRow("pat@acme.example")).toEqual(before);
    });

    it("won't remove the name of someone in another workspace", async () => {
      const { token } = await connect();
      const created = await provision(token, "pat@acme.example");
      const other = await createWorkspaceMember({ workspaceName: "Other" });
      await db.insert(schema.workspaceUserTable).values({
        workspaceId: other.workspace.id,
        userId: created.id,
        role: "member",
        joinedAt: new Date(),
      });
      const response = await scim(
        "PATCH",
        `/Users/${created.id}`,
        token,
        patch({ op: "remove", path: "name" }),
      );
      await scimError(response, 409, "mutability");
      expect(await userRow("pat@acme.example")).toMatchObject({
        name: "Pat Lee",
      });
    });
  });

  describe("changing the address through emails", () => {
    it.each([
      [
        "the work email's value",
        {
          op: "replace",
          path: 'emails[type eq "work"].value',
          value: "pat.lee@acme.example",
        },
      ],
      [
        "the primary email",
        {
          op: "replace",
          path: "emails[primary eq true]",
          value: { value: "pat.lee@acme.example", primary: true },
        },
      ],
      [
        "the emails",
        {
          op: "replace",
          path: "emails",
          value: [{ value: "pat.lee@acme.example", primary: true }],
        },
      ],
      [
        "emails without a path",
        {
          op: "replace",
          value: {
            emails: [{ value: "Pat.Lee@acme.example", type: "work" }],
          },
        },
      ],
    ])("changes it through %s", async (_, operation) => {
      const { token } = await connect();
      const created = await provision(token, "pat@acme.example");
      const response = await scim(
        "PATCH",
        `/Users/${created.id}`,
        token,
        patch(operation),
      );
      expect(response.status, await response.clone().text()).toBe(204);
      expect(await userRow("pat.lee@acme.example")).toMatchObject({
        id: created.id,
        emailVerified: false,
      });
      expect(await read(token, `/Users/${created.id}`)).toMatchObject({
        userName: "pat.lee@acme.example",
        emails: [{ value: "pat.lee@acme.example", primary: true }],
      });
    });

    it("keeps the address when another one is added", async () => {
      const { token } = await connect();
      const created = await provision(token, "pat@acme.example");
      const response = await scim(
        "PATCH",
        `/Users/${created.id}`,
        token,
        patch({
          op: "add",
          path: "emails",
          value: [{ value: "pat@home.example", type: "home" }],
        }),
      );
      expect(response.status, await response.clone().text()).toBe(204);
      expect(await userRow("pat@acme.example")).toMatchObject({
        id: created.id,
      });
    });

    it("applies the same refusals as userName", async () => {
      const { token } = await connect();
      const created = await provision(token, "pat@acme.example");
      const workEmail = (value: string) =>
        patch({ op: "replace", path: 'emails[type eq "work"].value', value });

      const blank = await scim(
        "PATCH",
        `/Users/${created.id}`,
        token,
        workEmail(" "),
      );
      await scimError(blank, 400, "invalidValue");

      await db
        .update(schema.userTable)
        .set({ role: "admin" })
        .where(eq(schema.userTable.id, created.id));
      const instanceAdmin = await scim(
        "PATCH",
        `/Users/${created.id}`,
        token,
        workEmail("attacker@evil.example"),
      );
      await scimError(instanceAdmin, 409, "mutability");
      expect(await userRow("pat@acme.example")).toMatchObject({
        id: created.id,
        emailVerified: true,
      });
      expect(await userRow("attacker@evil.example")).toBeUndefined();
    });

    it("moves a person without a name or externalId along with the address", async () => {
      const { token } = await connect();
      const created = await provisionWith(token, {
        schemas: [USER_SCHEMA],
        userName: "pat@acme.example",
      });
      const response = await scim(
        "PATCH",
        `/Users/${created.id}`,
        token,
        patch({
          op: "replace",
          path: "userName",
          value: "pat.lee@acme.example",
        }),
      );
      expect(response.status, await response.clone().text()).toBe(204);
      expect(await userRow("pat.lee@acme.example")).toMatchObject({
        name: "pat.lee@acme.example",
      });
      expect(await accountId(created.id)).toBe("pat.lee@acme.example");
      const resource = await read(token, `/Users/${created.id}`);
      expect(resource).not.toHaveProperty("name");
      expect(resource).not.toHaveProperty("externalId");
    });
  });

  describe("name parts", () => {
    it("returns the given and family names", async () => {
      const { token } = await connect();
      const created = await provisionWith(token, person("pat@acme.example"));
      expect(created.name).toEqual({
        formatted: "Pat Lee",
        givenName: "Pat",
        familyName: "Lee",
      });
      expect(await read(token, `/Users/${created.id}`)).toMatchObject({
        name: { formatted: "Pat Lee", givenName: "Pat", familyName: "Lee" },
        displayName: "Pat Lee",
      });
    });

    // Margaya keeps one name. The first word reads as the given name.
    it("splits a longer name after its first word", async () => {
      const { token } = await connect();
      const created = await provisionWith(
        token,
        person("mary@acme.example", {
          name: { formatted: "Mary Ann Smith" },
        }),
      );
      expect(created.name).toEqual({
        formatted: "Mary Ann Smith",
        givenName: "Mary",
        familyName: "Ann Smith",
      });
    });

    it("changes one part and keeps the other", async () => {
      const { token } = await connect();
      const created = await provision(token, "pat@acme.example");
      for (const [operation, name, parts] of [
        [
          { op: "replace", path: "name.familyName", value: "Jones" },
          "Pat Jones",
          { givenName: "Pat", familyName: "Jones" },
        ],
        [
          { op: "replace", value: { name: { givenName: "Sam" } } },
          "Sam Jones",
          { givenName: "Sam", familyName: "Jones" },
        ],
      ] as const) {
        const response = await scim(
          "PATCH",
          `/Users/${created.id}`,
          token,
          patch(operation),
        );
        expect(response.status, await response.clone().text()).toBe(204);
        expect(await userRow("pat@acme.example")).toMatchObject({ name });
        expect(await read(token, `/Users/${created.id}`)).toMatchObject({
          name: { formatted: name, ...parts },
        });
      }
    });

    it("returns no name for a person provisioned without one", async () => {
      const { token } = await connect();
      const created = await provisionWith(token, {
        schemas: [USER_SCHEMA],
        userName: "pat@acme.example",
      });
      expect(created).not.toHaveProperty("name");
      expect(created).not.toHaveProperty("displayName");
    });
  });

  describe("answers outside the plugin's routes", () => {
    it("answers an unknown path with a SCIM 404", async () => {
      const { token } = await connect();
      for (const path of ["/Groups", `/${crypto.randomUUID()}`, "/Users/a/b"]) {
        await scimError(await scim("GET", path, token), 404);
      }
      await scimError(await app.request(`${SCIM}/Groups`), 404);
    });

    it("answers other methods on the discovery endpoints with 405", async () => {
      for (const path of [
        "/ServiceProviderConfig",
        "/Schemas",
        `/Schemas/${USER_SCHEMA}`,
        "/ResourceTypes",
        "/ResourceTypes/User",
      ]) {
        for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
          const response = await app.request(`${SCIM}${path}`, { method });
          expect(response.headers.get("allow"), `${method} ${path}`).toBe(
            "GET",
          );
          await scimError(response, 405);
        }
      }
      const users = await app.request(`${SCIM}/Users`, { method: "DELETE" });
      expect(users.headers.get("allow")).toBe("GET, POST");
      await scimError(users, 405);
    });

    it.each([["POST"], ["PUT"], ["PATCH"]])(
      "answers invalid JSON in a %s with 400 invalidSyntax",
      async (method) => {
        const { token } = await connect();
        const created = await provision(token, "pat@acme.example");
        const path = method === "POST" ? "/Users" : `/Users/${created.id}`;
        const response = await app.request(`${SCIM}${path}`, {
          method,
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": JSON_TYPE,
          },
          body: '{"schemas": [',
        });
        await scimError(response, 400, "invalidSyntax");
      },
    );

    it("answers a resource the plugin's validation refuses with a SCIM error", async () => {
      const { token } = await connect();
      const created = await provision(token, "pat@acme.example");
      const response = await scim("PUT", `/Users/${created.id}`, token, {
        schemas: [USER_SCHEMA],
        name: { formatted: "Pat Lee" },
      });
      await scimError(response, 400, "invalidValue");
    });
  });
});
