import { APIError } from "better-auth/api";
import { and, eq, ne } from "drizzle-orm";
import { isAgentEmail } from "../ai-agent/avatar";
import { recordAudit } from "../audit-log/record";
import { syncWorkspaceSeats } from "../billing/controllers/sync-seats";
import db from "../database";
import {
  accountTable,
  userTable,
  workspaceUserTable,
} from "../database/schema";
import { recordInstanceAudit } from "../instance-admin/audit";
import { publishMembersChanged } from "../workspace/members-realtime";
import {
  isWorkspacePendingDeletion,
  WORKSPACE_LOCKED_MESSAGE,
} from "../workspace-deletion/lock";
import {
  normalizeScimPatch,
  normalizeScimUser,
  resolveScimPatch,
  scimPage,
  scimPatchChangesNothing,
  scimPatchEffects,
  scimPatchName,
  scimPatchRemovalRefusal,
  scimResourceEmail,
  scimResourceName,
  scimServiceProviderConfig,
  scimUsersResponse,
} from "./scim-normalize";
import { findScimConnection } from "./scim-token";

// What Margaya adds around Better Auth's SCIM plugin (auth.ts). The plugin
// checks the token and does the provisioning; these keep the rules every other
// path to the same data follows, which its direct writes would otherwise skip:
// a workspace pending deletion stays read-only, instance admins stay active, the
// last owner stays, agent addresses stay reserved, a token reaches no further
// than its workspace, and the member list, seats and audit trails follow.

export const SCIM_USERS_PATH = "/scim/v2/Users";

// RFC 7644 lets these be read without a token, and the plugin does.
const SCIM_DISCOVERY_PATH =
  /^\/scim\/v2\/(ServiceProviderConfig|Schemas|ResourceTypes)(\/|$)/;

// The reason the plugin writes when it deactivates someone. Any other ban is an
// instance admin's. If a plugin upgrade changes this text, its own bans read as an
// admin's and can't be lifted, which the reactivation test catches.
const SCIM_BAN_REASON = "Deactivated via SCIM";

type ScimConnection = { providerId: string; organizationId: string };
type BanState = { banned: boolean | null; banReason: string | null };

const bannedByAdmin = (user: BanState) =>
  user.banned === true && user.banReason !== SCIM_BAN_REASON;

const isInstanceAdmin = (user: { role: string | null }) =>
  user.role?.split(",").includes("admin") === true;

type ScimContext = {
  path: string;
  body?: unknown;
  query?: Record<string, unknown>;
  headers?: Headers;
  params?: Record<string, string | undefined>;
  request?: Request;
  context: { returned?: unknown };
};

function refusal(
  status: "BAD_REQUEST" | "UNAUTHORIZED" | "CONFLICT" | "LOCKED",
  code: number,
  detail: string,
  scimType?: string,
) {
  // The body is exactly an RFC 7644 (3.12) error, which strict clients check:
  // no other members. The text stays on the error for logs, as the plugin's
  // own errors do it.
  const error = new APIError(status, {
    schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
    status: String(code),
    detail,
    ...(scimType ? { scimType } : {}),
  });
  error.message = detail;
  return error;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function assertProvisionableEmail(email: string | null) {
  if (!email || !EMAIL.test(email)) {
    throw refusal(
      "BAD_REQUEST",
      400,
      "A user needs an email address: send it as userName or in emails",
      "invalidValue",
    );
  }
  if (isAgentEmail(email)) {
    throw refusal(
      "BAD_REQUEST",
      400,
      "This address is reserved",
      "invalidValue",
    );
  }
}

/**
 * The account a request names, when this connection manages it. The plugin's own
 * test: linked to the connection, and still in its workspace.
 */
async function managedUser(
  userId: string | undefined,
  connection: ScimConnection,
) {
  if (!userId) return null;
  const [row] = await db
    .select({
      id: userTable.id,
      role: userTable.role,
      email: userTable.email,
      name: userTable.name,
      banned: userTable.banned,
      banReason: userTable.banReason,
      accountId: accountTable.accountId,
    })
    .from(accountTable)
    .innerJoin(userTable, eq(userTable.id, accountTable.userId))
    .innerJoin(
      workspaceUserTable,
      and(
        eq(workspaceUserTable.userId, accountTable.userId),
        eq(workspaceUserTable.workspaceId, connection.organizationId),
      ),
    )
    .where(
      and(
        eq(accountTable.userId, userId),
        eq(accountTable.providerId, connection.providerId),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function belongsToAnotherWorkspace(userId: string, workspaceId: string) {
  const [other] = await db
    .select({ id: workspaceUserTable.id })
    .from(workspaceUserTable)
    .where(
      and(
        eq(workspaceUserTable.userId, userId),
        ne(workspaceUserTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  return Boolean(other);
}

type UserChange = {
  active: boolean | null;
  email: string | null;
  /** The name the request leaves the account with; null when it names none. */
  name: (current: { name: string; email: string }) => string | null;
};

type ManagedUser = NonNullable<Awaited<ReturnType<typeof managedUser>>>;

async function assertUserChangeAllowed(
  user: ManagedUser | null,
  connection: ScimConnection,
  change: UserChange,
) {
  // Not this connection's account: the plugin answers 404, and nothing here may
  // tell a token holder more than that.
  if (!user) return;
  // active:true would clear the ban, its reason and expiry. active:false would
  // rewrite it as the plugin's own, which active:true could then clear.
  if (change.active !== null && bannedByAdmin(user)) {
    throw refusal(
      "CONFLICT",
      409,
      "An instance admin banned this account, so provisioning can't change whether it's active. An instance admin has to lift the ban first.",
      "mutability",
    );
  }
  // Null means the request doesn't name an address. An empty one is a change, and
  // the plugin would store it.
  if (change.email !== null && change.email !== user.email) {
    assertProvisionableEmail(change.email);
    // A changed address is one password reset away from the account.
    if (isInstanceAdmin(user)) {
      throw refusal(
        "CONFLICT",
        409,
        "An instance admin's email can't be changed by provisioning",
        "mutability",
      );
    }
    if (await belongsToAnotherWorkspace(user.id, connection.organizationId)) {
      throw refusal(
        "CONFLICT",
        409,
        "This account also belongs to another workspace, so provisioning can't change its email",
        "mutability",
      );
    }
  }
  // The name is the account's, shown in every workspace it belongs to. A routine
  // sync that sends the current name changes nothing.
  const name = change.name(user);
  if (
    name !== null &&
    name !== user.name &&
    (await belongsToAnotherWorkspace(user.id, connection.organizationId))
  ) {
    throw refusal(
      "CONFLICT",
      409,
      "This account also belongs to another workspace, so provisioning can't change its name",
      "mutability",
    );
  }
  // Someone already banned here got that from provisioning: repeating it is a
  // routine sync that changes nothing, and shouldn't read as a failure.
  if (change.active === false && !user.banned) {
    // A ban reaches the whole instance, and so would end an instance admin's
    // access to every workspace, not only this one.
    if (isInstanceAdmin(user)) {
      throw refusal(
        "CONFLICT",
        409,
        "An instance admin can't be deactivated by provisioning, because that would ban them across the whole instance. Remove them from this workspace instead.",
        "mutability",
      );
    }
    if (await belongsToAnotherWorkspace(user.id, connection.organizationId)) {
      throw refusal(
        "CONFLICT",
        409,
        "This account also belongs to another workspace, so provisioning can't deactivate it. Remove it from this workspace instead.",
        "mutability",
      );
    }
  }
}

const EXTERNAL_ID_FILTER = /^\s*externalId\s+eq\s+"((?:[^"\\]|\\.)*)"\s*$/i;

/**
 * The plugin filters on userName alone. A filter on externalId (RFC 7644,
 * 3.4.2.2), which providers use to find someone they provisioned, becomes the
 * userName filter of the person this connection keeps that externalId for. The
 * plugin then lists them as it lists anyone, so its scoping still applies.
 */
async function filterByExternalId(
  ctx: ScimContext,
  connection: ScimConnection,
  startIndex: number,
) {
  const filter = ctx.query?.filter;
  const match = typeof filter === "string" && filter.match(EXTERNAL_ID_FILTER);
  if (!match) return;
  let externalId = "";
  try {
    externalId = String(JSON.parse(`"${match[1]}"`));
  } catch {
    throw refusal("BAD_REQUEST", 400, "Invalid filter value", "invalidFilter");
  }
  const [row] = await db
    .select({ email: userTable.email })
    .from(accountTable)
    .innerJoin(userTable, eq(userTable.id, accountTable.userId))
    .innerJoin(
      workspaceUserTable,
      and(
        eq(workspaceUserTable.userId, accountTable.userId),
        eq(workspaceUserTable.workspaceId, connection.organizationId),
      ),
    )
    .where(
      and(
        eq(accountTable.providerId, connection.providerId),
        eq(accountTable.accountId, externalId),
      ),
    )
    .limit(1);
  // The plugin's filter syntax can't quote an address with a quote in it.
  if (!row || row.email.includes('"')) {
    return {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
      totalResults: 0,
      startIndex,
      itemsPerPage: 0,
      Resources: [],
    };
  }
  return {
    context: { query: { ...ctx.query, filter: `userName eq "${row.email}"` } },
  };
}

async function isOnlyOwner(workspaceId: string, userId: string) {
  const members = await db
    .select({
      userId: workspaceUserTable.userId,
      role: workspaceUserTable.role,
    })
    .from(workspaceUserTable)
    .where(eq(workspaceUserTable.workspaceId, workspaceId));
  const owners = members.filter((member) =>
    member.role.split(",").includes("owner"),
  );
  return owners.length === 1 && owners[0]?.userId === userId;
}

/**
 * Runs in Better Auth's before hook for /scim/v2/*, ahead of the plugin's own
 * token check. The plugin also accepts a token with no Bearer prefix or with no
 * workspace in it, so anything this can't read is refused here: passed along, it
 * would reach the plugin with every rule below, and the audit trail, skipped.
 */
export async function guardScimRequest(ctx: ScimContext) {
  if (SCIM_DISCOVERY_PATH.test(ctx.path)) return;
  const connection = await findScimConnection(
    ctx.headers?.get("authorization"),
  );
  if (!connection) {
    throw refusal("UNAUTHORIZED", 401, "A valid SCIM bearer token is required");
  }
  const method = ctx.request?.method ?? "GET";
  if (method === "GET") {
    if (ctx.path !== SCIM_USERS_PATH) return;
    const page = scimPage(ctx.query);
    if (!page) {
      throw refusal(
        "BAD_REQUEST",
        400,
        "startIndex and count must be whole numbers",
        "invalidValue",
      );
    }
    return filterByExternalId(ctx, connection, page.startIndex);
  }

  if (await isWorkspacePendingDeletion(connection.organizationId)) {
    throw refusal("LOCKED", 423, WORKSPACE_LOCKED_MESSAGE);
  }

  const userId = ctx.params?.userId;
  if (method === "POST") {
    const body = normalizeScimUser(ctx.body);
    assertProvisionableEmail(scimResourceEmail(body));
    return { context: { body } };
  }
  if (method === "PUT") {
    const body = normalizeScimUser(ctx.body) as { active?: unknown };
    await assertUserChangeAllowed(
      await managedUser(userId, connection),
      connection,
      {
        active: typeof body?.active === "boolean" ? body.active : null,
        email: scimResourceEmail(body),
        name: () => scimResourceName(body),
      },
    );
    return { context: { body } };
  }
  if (method === "PATCH") {
    const body = normalizeScimPatch(ctx.body);
    const removal = scimPatchRemovalRefusal(body);
    if (removal) {
      throw refusal("BAD_REQUEST", 400, removal.detail, removal.scimType);
    }
    const user = await managedUser(userId, connection);
    if (scimPatchChangesNothing(body) && user) {
      return new Response(null, { status: 204 });
    }
    const effects = scimPatchEffects(body);
    if (effects.invalid) {
      throw refusal(
        "BAD_REQUEST",
        400,
        "active must be true or false, and userName and the name must be strings",
        "invalidValue",
      );
    }
    await assertUserChangeAllowed(user, connection, {
      ...effects,
      name: (current) => scimPatchName(body, current),
    });
    return { context: { body: user ? resolveScimPatch(body, user) : body } };
  }
  if (method === "DELETE") {
    const user = await managedUser(userId, connection);
    if (user && (await isOnlyOwner(connection.organizationId, user.id))) {
      throw refusal(
        "CONFLICT",
        409,
        "This person is the workspace's only owner. Transfer ownership first.",
      );
    }
  }
  return;
}

/**
 * Whether a token may take over an account that already has this address.
 * Instance admins, agents and guests never, nor an account an instance admin
 * banned: linking with active:false would rewrite the ban as the plugin's own.
 * Otherwise only someone in this workspace alone, or in no workspace at all (which
 * includes someone this connection removed earlier and is now adding back). Anyone
 * who is in another workspace too stays out of this token's reach.
 */
export async function scimMayLinkUser(
  userId: string,
  workspaceId: string | null | undefined,
): Promise<boolean> {
  if (!workspaceId) return false;
  const [user] = await db
    .select({
      role: userTable.role,
      kind: userTable.kind,
      isAnonymous: userTable.isAnonymous,
      banned: userTable.banned,
      banReason: userTable.banReason,
    })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);
  if (!user || user.kind === "agent" || user.isAnonymous) return false;
  if (user.role?.split(",").includes("admin")) return false;
  if (bannedByAdmin(user)) return false;
  return !(await belongsToAnotherWorkspace(userId, workspaceId));
}

/**
 * Runs in Better Auth's after hook for /scim/v2/*; never throws. Returns what a
 * response from /Users or /ServiceProviderConfig should say instead, which the
 * hook hands back to Better Auth, or undefined to leave the response alone.
 */
export async function afterScimRequest(ctx: ScimContext) {
  const method = ctx.request?.method ?? "GET";
  const returned = ctx.context.returned;
  if (returned instanceof Error) return;
  if (method !== "GET") await followUp(ctx, method, returned);
  if (ctx.path === "/scim/v2/ServiceProviderConfig") {
    return scimServiceProviderConfig(returned);
  }
  if (!ctx.path.startsWith(SCIM_USERS_PATH)) return;
  return scimUsersResponse(returned, ctx.query);
}

/** Seats, the member list and the audit trails after a change. */
async function followUp(ctx: ScimContext, method: string, returned: unknown) {
  try {
    const connection = await findScimConnection(
      ctx.headers?.get("authorization"),
    );
    if (!connection) return;
    const workspaceId = connection.organizationId;
    const actor = { system: true, name: connection.name };
    const metadata = { connectionId: connection.id, workspaceId };

    if (method === "POST") {
      const created = returned as { id?: unknown; userName?: unknown };
      if (typeof created?.id !== "string") return;
      const label =
        typeof created.userName === "string" ? created.userName : null;
      void syncWorkspaceSeats(workspaceId).catch((error) => {
        console.error("Seat sync after SCIM provisioning failed:", error);
      });
      void publishMembersChanged({ workspaceId });
      await recordAudit({
        workspaceId,
        action: "member.provisioned",
        target: { type: "user", id: created.id, label },
        metadata: { via: "scim", connectionId: connection.id },
      });
      await recordInstanceAudit({
        action: "scim.user_provisioned",
        target: { type: "user", id: created.id, label },
        metadata,
        actor,
      });
      return;
    }

    const userId = ctx.params?.userId;
    if (!userId) return;
    const [user] = await db
      .select({ email: userTable.email })
      .from(userTable)
      .where(eq(userTable.id, userId))
      .limit(1);
    const target = { type: "user", id: userId, label: user?.email ?? null };

    if (method === "DELETE") {
      await recordAudit({
        workspaceId,
        action: "member.removed",
        target: { type: "user", id: userId, label: user?.email ?? null },
        metadata: { via: "scim", connectionId: connection.id },
      });
      await recordInstanceAudit({
        action: "scim.user_removed",
        target,
        metadata,
        actor,
      });
      return;
    }

    void publishMembersChanged({ workspaceId, userId });
    const active =
      method === "PATCH"
        ? scimPatchEffects(ctx.body).active
        : (ctx.body as { active?: unknown })?.active;
    if (active === false || active === true) {
      await recordInstanceAudit({
        action: active ? "scim.user_reactivated" : "scim.user_deactivated",
        target,
        metadata,
        actor,
      });
    }
  } catch (error) {
    console.error("SCIM follow-up failed:", error);
  }
}
