import type { Context } from "hono";
import type { AuditAction } from "./actions";
import type { AuditRequestStore } from "./context";
import type { AuditInput } from "./record";
import { diffFields, redactUrl } from "./redact";
import {
  apiKeySnapshot,
  integrationSnapshot,
  memberSnapshot,
  permissionChanges,
  projectLabel,
  roleSnapshot,
  userLabel,
  webhookSnapshot,
  workspaceSnapshot,
  workspacesOf,
} from "./snapshots";

// Audited requests that publish no internal event: Better Auth's workspace,
// member, role and API key endpoints, webhooks, integrations, exports and
// imports. One rule per route; `before` snapshots what the request changes,
// `after` turns the outcome into entries. Rules only run on success.

type Json = Record<string, unknown>;

export type RuleInput = {
  c: Context;
  match: RegExpMatchArray;
  body: Json;
  store: AuditRequestStore;
};

export type HttpRule = {
  method: string;
  path: RegExp;
  /** Better Auth route: resolve the caller from the session up front. */
  auth?: boolean;
  /** Parse the (small) JSON request body for `before` and `after`. */
  readBody?: boolean;
  /** Which statuses count as done (default: any 2xx). */
  done?: (status: number) => boolean;
  before?: (input: RuleInput) => Promise<unknown>;
  after: (
    input: RuleInput & { before: unknown; response: Json },
  ) => Promise<AuditInput | AuditInput[] | null>;
};

const str = (value: unknown) =>
  typeof value === "string" && value ? value : null;
const obj = (value: unknown): Json =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : {};

/** The workspace a Better Auth organization call acts on. */
function authWorkspace(input: RuleInput, response?: Json) {
  return (
    str(input.body.organizationId) ??
    str(response?.organizationId) ??
    input.store.actor?.activeWorkspaceId ??
    null
  );
}

const hasRole = (role: unknown, name: string) =>
  typeof role === "string" && role.split(",").includes(name);

type WorkspaceBefore = { workspaceId: string; fields: Json | null } | null;

async function workspaceBefore(
  workspaceId: string | null,
): Promise<WorkspaceBefore> {
  return workspaceId
    ? { workspaceId, fields: await workspaceSnapshot(workspaceId) }
    : null;
}

/** workspace.updated with a before/after diff of the workspace's settings. */
async function workspaceAfter({
  before,
}: {
  before: unknown;
}): Promise<AuditInput | null> {
  const snapshot = before as WorkspaceBefore;
  if (!snapshot?.fields) return null;
  const now = await workspaceSnapshot(snapshot.workspaceId);
  const changes = diffFields(snapshot.fields, now);
  if (Object.keys(changes).length === 0) return null;
  return {
    workspaceId: snapshot.workspaceId,
    action: "workspace.updated",
    target: {
      type: "workspace",
      id: snapshot.workspaceId,
      label: str(now?.name) ?? str(snapshot.fields.name),
    },
    metadata: { changes },
  };
}

const AUTH = "^/api/auth";

const authRules: HttpRule[] = [
  {
    method: "POST",
    path: new RegExp(`${AUTH}/organization/invite-member$`),
    auth: true,
    readBody: true,
    after: async ({ response, body }) => {
      const workspaceId = str(response.organizationId);
      if (!workspaceId) return null;
      return {
        workspaceId,
        action: "member.invited",
        target: {
          type: "invitation",
          id: str(response.id),
          label: str(response.email) ?? str(body.email),
        },
        metadata: { role: response.role ?? body.role ?? null },
      };
    },
  },
  {
    method: "POST",
    path: new RegExp(`${AUTH}/organization/cancel-invitation$`),
    auth: true,
    readBody: true,
    after: async ({ response }) => {
      const workspaceId = str(response.organizationId);
      if (!workspaceId) return null;
      return {
        workspaceId,
        action: "member.invitation_revoked",
        target: {
          type: "invitation",
          id: str(response.id),
          label: str(response.email),
        },
        metadata: { role: response.role ?? null },
      };
    },
  },
  ...(
    [
      ["accept-invitation", "member.invitation_accepted"],
      ["reject-invitation", "member.invitation_declined"],
    ] as const
  ).map(
    ([route, action]): HttpRule => ({
      method: "POST",
      path: new RegExp(`${AUTH}/organization/${route}$`),
      auth: true,
      readBody: true,
      after: async ({ response }) => {
        const invitation = obj(response.invitation);
        const member = obj(response.member);
        const workspaceId = str(invitation.organizationId);
        if (!workspaceId) return null;
        return {
          workspaceId,
          action,
          target: {
            type: "invitation",
            id: str(invitation.id),
            label: str(invitation.email),
          },
          metadata: { role: member.role ?? invitation.role ?? null },
        };
      },
    }),
  ),
  {
    method: "POST",
    path: new RegExp(`${AUTH}/organization/remove-member$`),
    auth: true,
    readBody: true,
    before: async (input) => {
      const ref = str(input.body.memberIdOrEmail);
      return ref ? memberSnapshot(ref, authWorkspace(input)) : null;
    },
    after: async ({ response, before }) => {
      const member = obj(response.member);
      const snapshot = before as Awaited<ReturnType<typeof memberSnapshot>>;
      const workspaceId = str(member.organizationId) ?? snapshot?.workspaceId;
      if (!workspaceId) return null;
      return {
        workspaceId,
        action: "member.removed",
        target: {
          type: "user",
          id: str(member.userId) ?? snapshot?.userId ?? null,
          label: snapshot?.label ?? null,
        },
        metadata: { role: member.role ?? snapshot?.role ?? null },
      };
    },
  },
  {
    method: "POST",
    path: new RegExp(`${AUTH}/organization/leave$`),
    auth: true,
    readBody: true,
    after: async ({ response, body, store }) => {
      const workspaceId =
        str(body.organizationId) ?? str(response.organizationId);
      if (!workspaceId) return null;
      const userId = str(response.userId) ?? store.actor?.userId ?? null;
      return {
        workspaceId,
        action: "member.left",
        target: { type: "user", id: userId, label: await userLabel(userId) },
        metadata: { role: response.role ?? null },
      };
    },
  },
  {
    method: "POST",
    path: new RegExp(`${AUTH}/organization/update-member-role$`),
    auth: true,
    readBody: true,
    before: async (input) => {
      const ref = str(input.body.memberId);
      return ref ? memberSnapshot(ref, authWorkspace(input)) : null;
    },
    after: async ({ response, body, before }) => {
      const updated = obj(response.member ?? response);
      const snapshot = before as Awaited<ReturnType<typeof memberSnapshot>>;
      const workspaceId =
        str(updated.organizationId) ?? snapshot?.workspaceId ?? null;
      if (!workspaceId) return null;
      const previous = snapshot?.role ?? null;
      const next =
        str(updated.role) ??
        (Array.isArray(body.role) ? body.role.join(",") : str(body.role));
      if (previous === next) return null;
      const promotedToOwner =
        hasRole(next, "owner") && !hasRole(previous, "owner");
      return {
        workspaceId,
        action: promotedToOwner
          ? "workspace.ownership_transferred"
          : "member.role_changed",
        target: {
          type: "user",
          id: str(updated.userId) ?? snapshot?.userId ?? null,
          label: snapshot?.label ?? null,
        },
        metadata: { changes: { role: { before: previous, after: next } } },
      };
    },
  },
  {
    method: "POST",
    path: new RegExp(`${AUTH}/organization/update$`),
    auth: true,
    readBody: true,
    before: async (input) => workspaceBefore(authWorkspace(input)),
    after: workspaceAfter,
  },
  {
    method: "POST",
    path: new RegExp(`${AUTH}/organization/create-role$`),
    auth: true,
    readBody: true,
    after: async (input) => {
      const role = obj(input.response.roleData);
      const workspaceId = str(role.organizationId) ?? authWorkspace(input);
      if (!workspaceId) return null;
      const permission = obj(role.permission) as Record<string, string[]>;
      return {
        workspaceId,
        action: "role.created",
        target: {
          type: "role",
          id: str(role.id),
          label: str(role.role) ?? str(input.body.role),
        },
        metadata: { permissions: permissionChanges({}, permission).added },
      };
    },
  },
  {
    method: "POST",
    path: new RegExp(`${AUTH}/organization/update-role$`),
    auth: true,
    readBody: true,
    before: async (input) => {
      const workspaceId = authWorkspace(input);
      return workspaceId
        ? { workspaceId, role: await roleSnapshot(workspaceId, input.body) }
        : null;
    },
    after: async ({ before }) => {
      const snapshot = before as {
        workspaceId: string;
        role: Awaited<ReturnType<typeof roleSnapshot>>;
      } | null;
      if (!snapshot?.role) return null;
      const now = await roleSnapshot(snapshot.workspaceId, {
        roleId: snapshot.role.id,
      });
      const grants = permissionChanges(
        snapshot.role.permission,
        now?.permission ?? snapshot.role.permission,
      );
      const renamed = now && now.role !== snapshot.role.role;
      return {
        workspaceId: snapshot.workspaceId,
        action: "role.updated",
        target: {
          type: "role",
          id: snapshot.role.id,
          label: now?.role ?? snapshot.role.role,
        },
        metadata: {
          ...(renamed
            ? {
                changes: {
                  name: { before: snapshot.role.role, after: now.role },
                },
              }
            : {}),
          added: grants.added,
          removed: grants.removed,
        },
      };
    },
  },
  {
    method: "POST",
    path: new RegExp(`${AUTH}/organization/delete-role$`),
    auth: true,
    readBody: true,
    before: async (input) => {
      const workspaceId = authWorkspace(input);
      return workspaceId
        ? { workspaceId, role: await roleSnapshot(workspaceId, input.body) }
        : null;
    },
    after: async ({ before }) => {
      const snapshot = before as {
        workspaceId: string;
        role: Awaited<ReturnType<typeof roleSnapshot>>;
      } | null;
      if (!snapshot?.role) return null;
      return {
        workspaceId: snapshot.workspaceId,
        action: "role.deleted",
        target: {
          type: "role",
          id: snapshot.role.id,
          label: snapshot.role.role,
        },
      };
    },
  },
  // API keys belong to a person and reach every workspace they are in, so
  // each of those workspaces records the key. The key value is never read.
  {
    method: "POST",
    path: new RegExp(`${AUTH}/api-key/create$`),
    auth: true,
    readBody: true,
    after: async ({ response, store }) => {
      const ownerId = str(response.referenceId) ?? str(response.userId);
      const workspaceIds = await workspacesOf(ownerId ?? store.actor?.userId);
      return workspaceIds.map((workspaceId) => ({
        workspaceId,
        action: "api_key.created" as const,
        target: {
          type: "api_key",
          id: str(response.id),
          label: str(response.name),
        },
        metadata: {
          expiresAt: response.expiresAt ?? null,
          scoped: Boolean(response.permissions),
        },
      }));
    },
  },
  {
    method: "POST",
    path: new RegExp(`${AUTH}/api-key/delete$`),
    auth: true,
    readBody: true,
    before: async ({ body }) => {
      const keyId = str(body.keyId);
      return keyId ? apiKeySnapshot(keyId) : null;
    },
    after: async ({ before }) => {
      const key = before as Awaited<ReturnType<typeof apiKeySnapshot>>;
      if (!key) return null;
      const workspaceIds = await workspacesOf(key.ownerId);
      return workspaceIds.map((workspaceId) => ({
        workspaceId,
        action: "api_key.revoked" as const,
        target: { type: "api_key", id: key.id, label: key.name },
      }));
    },
  },
];

type WebhookSnapshot = Awaited<ReturnType<typeof webhookSnapshot>>;

const webhookBefore = async ({ match }: RuleInput) =>
  match[1] ? webhookSnapshot(match[1]) : null;

const webhookRules: HttpRule[] = [
  {
    method: "POST",
    path: /^\/api\/webhook\/?$/,
    after: async ({ response }) => {
      const workspaceId = str(response.workspaceId);
      const id = str(response.id);
      if (!workspaceId || !id) return null;
      const url = str(response.url);
      return {
        workspaceId,
        action: "webhook.created",
        target: {
          type: "webhook",
          id,
          label: str(response.name) ?? (url ? redactUrl(url) : null),
        },
        metadata: {
          url: url ? redactUrl(url) : null,
          events: response.events ?? null,
        },
      };
    },
  },
  {
    method: "PATCH",
    path: /^\/api\/webhook\/([^/]+)$/,
    before: webhookBefore,
    after: async ({ before, match }) => {
      const was = before as WebhookSnapshot;
      const now = await webhookSnapshot(match[1] as string);
      if (!was || !now) return null;
      const changes = diffFields(was.fields, now.fields);
      if (Object.keys(changes).length === 0) return null;
      return {
        workspaceId: now.workspaceId,
        action: "webhook.updated",
        target: { type: "webhook", id: match[1], label: now.label },
        metadata: { changes },
      };
    },
  },
  {
    method: "DELETE",
    path: /^\/api\/webhook\/([^/]+)$/,
    before: webhookBefore,
    after: async ({ before, match }) => {
      const was = before as WebhookSnapshot;
      if (!was) return null;
      return {
        workspaceId: was.workspaceId,
        action: "webhook.deleted",
        target: { type: "webhook", id: match[1], label: was.label },
        metadata: { url: was.fields.url, events: was.fields.events },
      };
    },
  },
  {
    method: "POST",
    path: /^\/api\/webhook\/([^/]+)\/rotate-secret$/,
    readBody: true,
    before: webhookBefore,
    after: async ({ before, match, body }) => {
      const was = before as WebhookSnapshot;
      if (!was) return null;
      return {
        workspaceId: was.workspaceId,
        action: "webhook.secret_rotated",
        target: { type: "webhook", id: match[1], label: was.label },
        metadata: { graceHours: body.graceHours ?? 24 },
      };
    },
  },
];

const PROVIDERS =
  "slack|discord|mattermost|telegram|gitea|github|generic-webhook";
const INTEGRATION_PATH = new RegExp(
  `^/api/(${PROVIDERS})-integration/project/([^/]+)$`,
);

function integrationRule(method: string, action: AuditAction): HttpRule {
  return {
    method,
    path: INTEGRATION_PATH,
    before: async ({ match }) =>
      integrationSnapshot(match[2] as string, match[1] as string),
    after: async ({ c, match, before }) => {
      const provider = match[1] as string;
      const projectId = match[2] as string;
      const was = before as Awaited<ReturnType<typeof integrationSnapshot>>;
      const now =
        method === "DELETE"
          ? null
          : await integrationSnapshot(projectId, provider);
      const project = await projectLabel(projectId);
      const workspaceId =
        (c.get("workspaceId") as string | undefined) ?? project?.workspaceId;
      if (!workspaceId || (!was && !now)) return null;
      const changes =
        action === "integration.updated"
          ? diffFields(was?.fields, now?.fields)
          : undefined;
      if (changes && Object.keys(changes).length === 0) return null;
      return {
        workspaceId,
        action,
        target: {
          type: "integration",
          id: now?.id ?? was?.id ?? null,
          label: project?.name ?? null,
        },
        metadata: {
          provider,
          projectId,
          ...(changes ? { changes } : {}),
        },
      };
    },
  };
}

const integrationRules: HttpRule[] = [
  integrationRule("POST", "integration.connected"),
  integrationRule("PATCH", "integration.updated"),
  integrationRule("DELETE", "integration.disconnected"),
];

/** Top-level numbers of an import's answer: its counts. */
function counts(response: Json) {
  const source = obj(response.results ?? response.summary ?? response);
  const out: Json = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === "number") out[key] = value;
  }
  return out;
}

const transferRules: HttpRule[] = [
  {
    method: "POST",
    path: /^\/api\/jira-import\/([^/]+)$/,
    after: async ({ c, match, response }) => {
      const project = await projectLabel(match[1]);
      const workspaceId =
        (c.get("workspaceId") as string | undefined) ?? project?.workspaceId;
      if (!workspaceId) return null;
      return {
        workspaceId,
        action: "import.run",
        target: { type: "project", id: match[1], label: project?.name },
        metadata: { source: "jira", ...counts(response) },
      };
    },
  },
  {
    method: "POST",
    path: /^\/api\/task\/import\/([^/]+)$/,
    after: async ({ c, match, response }) => {
      const project = await projectLabel(match[1]);
      const workspaceId =
        (c.get("workspaceId") as string | undefined) ?? project?.workspaceId;
      if (!workspaceId) return null;
      return {
        workspaceId,
        action: "import.run",
        target: { type: "project", id: match[1], label: project?.name },
        metadata: { source: "file", ...counts(response) },
      };
    },
  },
  {
    method: "POST",
    path: /^\/api\/(github|gitea)-integration\/import-issues$/,
    readBody: true,
    // 202 answers are progress; the run is done on 200.
    done: (status) => status === 200,
    after: async ({ c, match, body, response }) => {
      const projectId = str(body.projectId);
      const project = await projectLabel(projectId);
      const workspaceId =
        (c.get("workspaceId") as string | undefined) ?? project?.workspaceId;
      if (!workspaceId) return null;
      return {
        workspaceId,
        action: "import.run",
        target: { type: "project", id: projectId, label: project?.name },
        metadata: { source: match[1], ...counts(response) },
      };
    },
  },
  {
    method: "POST",
    path: /^\/api\/task-export\/?$/,
    after: async ({ c, response }) => {
      const workspaceId =
        str(response.workspaceId) ??
        (c.get("workspaceId") as string | undefined);
      if (!workspaceId) return null;
      const projectIds = Array.isArray(response.projectIds)
        ? response.projectIds
        : [];
      return {
        workspaceId,
        action: "export.created",
        target: {
          type: "export",
          id: str(response.id),
          label: str(response.format),
        },
        metadata: {
          format: response.format ?? null,
          projectCount: projectIds.length,
          includeArchived: response.includeArchived ?? null,
          splitByProject: response.splitByProject ?? null,
        },
      };
    },
  },
  {
    method: "GET",
    path: /^\/api\/task-export\/([^/]+)\/download$/,
    done: (status) => status >= 200 && status < 400,
    after: async ({ c, match }) => {
      const row = c.get("taskExport") as
        | { workspaceId: string; format: string; fileName: string | null }
        | undefined;
      if (!row) return null;
      return {
        workspaceId: row.workspaceId,
        action: "export.downloaded",
        target: {
          type: "export",
          id: match[1],
          label: row.fileName ?? row.format,
        },
        metadata: { format: row.format },
      };
    },
  },
];

// Margaya's own workspace settings (the time zone today).
const workspaceRules: HttpRule[] = [
  {
    method: "PATCH",
    path: /^\/api\/workspace\/([^/]+)\/settings$/,
    before: async ({ match }) => workspaceBefore(match[1] ?? null),
    after: workspaceAfter,
  },
];

export const HTTP_RULES: HttpRule[] = [
  ...authRules,
  ...workspaceRules,
  ...webhookRules,
  ...integrationRules,
  ...transferRules,
];

export function matchRule(method: string, path: string) {
  for (const rule of HTTP_RULES) {
    if (rule.method !== method) continue;
    const match = path.match(rule.path);
    if (match) return { rule, match };
  }
  return null;
}
