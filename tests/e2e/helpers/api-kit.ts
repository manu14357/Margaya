import {
  type APIRequestContext,
  type APIResponse,
  expect,
} from "@playwright/test";
import { E2E_API_URL, E2E_WEB_URL } from "./env";
import { createApiContext } from "./http";
import { uniqueName } from "./ui";

// Building blocks for the API and notification specs: role contexts that live
// for a whole file (beforeAll), throwaway users and workspaces, and small
// creators for the data a spec mutates. LOCAL TESTING ONLY.

export type Json = Record<string, unknown> & { id: string };

/** Assert the status (with the body in the failure message) and parse JSON. */
export async function expectJson<T = Json>(
  response: APIResponse,
  status: number | number[] = 200,
): Promise<T> {
  const text = await response.text();
  const allowed = Array.isArray(status) ? status : [status];
  expect(
    allowed,
    `${response.url()} answered ${response.status()}: ${text.slice(0, 600)}`,
  ).toContain(response.status());
  return (text ? JSON.parse(text) : null) as T;
}

/** Assert a non-2xx status, with the body in the failure message. */
export async function expectStatus(
  response: APIResponse,
  status: number | number[],
): Promise<string> {
  const text = await response.text();
  const allowed = Array.isArray(status) ? status : [status];
  expect(
    allowed,
    `${response.url()} answered ${response.status()}: ${text.slice(0, 600)}`,
  ).toContain(response.status());
  return text;
}

/** An API context that authenticates with a header instead of a cookie. */
export function headerContext(
  headers: Record<string, string>,
): Promise<APIRequestContext> {
  return createApiContext({
    apiURL: E2E_API_URL,
    clientURL: E2E_WEB_URL,
    extraHTTPHeaders: headers,
  });
}

export type TestUser = {
  id: string;
  name: string;
  email: string;
  password: string;
  /** Signed in with the session cookie. */
  ctx: APIRequestContext;
  /** The Better Auth session token (usable as a Bearer token). */
  token: string;
};

function randomSuffix() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Sign up a brand-new account (registration is open on the e2e API). */
export async function signUpUser(
  label: string,
  options: { email?: string } = {},
): Promise<TestUser> {
  const suffix = randomSuffix();
  const email =
    options.email ??
    `e2e-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${suffix}@margaya.test`;
  const name = `E2E ${label} ${suffix.slice(-4)}`;
  const password = `E2E-${suffix}-Pass!`;
  const ctx = await createApiContext({
    apiURL: E2E_API_URL,
    clientURL: E2E_WEB_URL,
  });
  const body = await expectJson<{ token: string; user: { id: string } }>(
    await ctx.post("/api/auth/sign-up/email", {
      data: { name, email, password },
    }),
  );
  return { id: body.user.id, name, email, password, ctx, token: body.token };
}

/**
 * Mark `user`'s email as verified through the Better Auth admin plugin (the
 * seeded owner is the instance administrator), then sign in again so the
 * session no longer carries the cached unverified state.
 */
export async function verifyEmail(
  instanceAdmin: APIRequestContext,
  user: TestUser,
): Promise<void> {
  await expectJson(
    await instanceAdmin.post("/api/auth/admin/update-user", {
      data: { userId: user.id, data: { emailVerified: true } },
    }),
  );
  const body = await expectJson<{ token: string }>(
    await user.ctx.post("/api/auth/sign-in/email", {
      data: { email: user.email, password: user.password },
    }),
  );
  user.token = body.token;
}

export type Workspace = { id: string; name: string; slug: string };

/** Create a workspace owned by `owner` and make it their active one. */
export async function createWorkspace(
  owner: APIRequestContext,
  prefix = "E2E Workspace",
): Promise<Workspace> {
  const name = uniqueName(prefix);
  const slug = `e2e-${randomSuffix()}`;
  const workspace = await expectJson<Workspace>(
    await owner.post("/api/auth/organization/create", {
      data: { name, slug },
    }),
  );
  await expectJson(
    await owner.post("/api/auth/organization/set-active", {
      data: { organizationId: workspace.id },
    }),
  );
  return workspace;
}

/** Invite `user` with `role` and accept as them. Returns the invitation id. */
export async function addMember(
  owner: APIRequestContext,
  workspaceId: string,
  user: TestUser,
  role: "admin" | "member" | "viewer" | "guest",
): Promise<string> {
  const invitation = await expectJson<{ id: string }>(
    await owner.post("/api/auth/organization/invite-member", {
      data: { email: user.email, role, organizationId: workspaceId },
    }),
  );
  await expectJson(
    await user.ctx.post("/api/auth/organization/accept-invitation", {
      data: { invitationId: invitation.id },
    }),
  );
  await expectJson(
    await user.ctx.post("/api/auth/organization/set-active", {
      data: { organizationId: workspaceId },
    }),
  );
  return invitation.id;
}

export type WorldRole = "owner" | "admin" | "member" | "viewer";

/**
 * A private workspace with one fresh account per role, so a spec can mutate
 * anything (settings, members, notifications, preferences) without touching
 * the seeded data other specs rely on.
 */
export type World = {
  workspace: Workspace;
  users: Record<WorldRole, TestUser>;
  anonymous: APIRequestContext;
  as: (actor: WorldRole | "anonymous") => APIRequestContext;
  dispose: () => Promise<void>;
};

export async function createWorld(label = "World"): Promise<World> {
  const owner = await signUpUser(`${label} owner`);
  const workspace = await createWorkspace(owner.ctx, `E2E ${label}`);
  const users = { owner } as Record<WorldRole, TestUser>;
  for (const role of ["admin", "member", "viewer"] as const) {
    const user = await signUpUser(`${label} ${role}`);
    await addMember(owner.ctx, workspace.id, user, role);
    users[role] = user;
  }
  const anonymous = await createApiContext({
    apiURL: E2E_API_URL,
    clientURL: E2E_WEB_URL,
  });
  return {
    workspace,
    users,
    anonymous,
    as: (actor) => (actor === "anonymous" ? anonymous : users[actor].ctx),
    dispose: async () => {
      await Promise.all([
        anonymous.dispose(),
        ...Object.values(users).map((user) => user.ctx.dispose()),
      ]);
    },
  };
}

export type Project = Json & {
  workspaceId: string;
  slug: string;
  name: string;
  cyclesEnabled: boolean;
  modulesEnabled: boolean;
  estimatesEnabled: boolean;
  timeTrackingEnabled: boolean;
};

/** A project key the workspace has not used: two letters and five random. */
export function uniqueSlug(prefix = "E"): string {
  return `${prefix}${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
}

export async function createProject(
  ctx: APIRequestContext,
  workspaceId: string,
  overrides: Partial<{ name: string; slug: string; icon: string }> = {},
): Promise<Project> {
  return expectJson<Project>(
    await ctx.post("/api/project", {
      data: {
        name: overrides.name ?? uniqueName("API Project"),
        slug: overrides.slug ?? uniqueSlug(),
        icon: overrides.icon ?? "Layout",
        workspaceId,
      },
    }),
  );
}

export type Task = Json & {
  projectId: string;
  title: string;
  status: string;
  priority: string;
  number: number;
  assigneeIds: string[];
  dueDate: string | null;
  archivedAt?: string | null;
};

export async function createTask(
  ctx: APIRequestContext,
  projectId: string,
  overrides: Partial<{
    title: string;
    description: string;
    status: string;
    priority: string;
    assigneeIds: string[];
    dueDate: string;
    startDate: string;
    estimatePointId: string | null;
  }> = {},
): Promise<Task> {
  return expectJson<Task>(
    await ctx.post(`/api/task/${projectId}`, {
      data: {
        title: uniqueName("API Task"),
        description: "",
        priority: "medium",
        status: "to-do",
        ...overrides,
      },
    }),
  );
}

export async function deleteProjectQuietly(
  ctx: APIRequestContext,
  projectId: string | undefined,
) {
  if (!projectId) return;
  await ctx.delete(`/api/project/${projectId}`).catch(() => undefined);
}

export type ApiKey = { id: string; key: string; name: string };

/** Create a Better Auth API key for the signed-in user of `ctx`. */
export async function createApiKey(
  ctx: APIRequestContext,
  name = uniqueName("e2e key"),
): Promise<ApiKey> {
  return expectJson<ApiKey>(
    await ctx.post("/api/auth/api-key/create", { data: { name } }),
  );
}

export async function deleteApiKey(ctx: APIRequestContext, keyId: string) {
  await ctx.post("/api/auth/api-key/delete", { data: { keyId } });
}

/** Poll `probe` until it returns a truthy value. */
export async function eventually<T>(
  probe: () => Promise<T | undefined | null | false>,
  { timeoutMs = 15_000, intervalMs = 250, what = "condition" } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      const value = await probe();
      if (value) return value;
    } catch (error) {
      last = error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for ${what}${last ? `: ${String(last)}` : ""}`,
  );
}
