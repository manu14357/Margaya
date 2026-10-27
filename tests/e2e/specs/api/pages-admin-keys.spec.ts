import { expect, test } from "../../fixtures";
import {
  createProject,
  createWorld,
  deleteApiKey,
  expectJson,
  expectStatus,
  headerContext,
  type Json,
  type Project,
  signUpUser,
  type TestUser,
  type World,
} from "../../helpers/api-kit";
import { E2E_API_URL, E2E_WEB_URL } from "../../helpers/env";
import { createApiContext } from "../../helpers/http";
import { covers } from "../../helpers/openapi";
import { uniqueName } from "../../helpers/ui";
import { SEED_USERS } from "../../seed/data";

// Page templates and public page links, the built-in upload store, instance
// user management (with the password re-confirmation) and scoped API keys
// with their request log.

type Page = Json & { projectId: string; title: string; access: string };
type Template = Json & {
  name: string;
  scope: "project" | "workspace";
  projectId: string | null;
  createdById: string | null;
  canDelete: boolean;
};
type Publication = {
  published: boolean;
  token: string | null;
  path: string | null;
  publishedAt: string | null;
  allowed: boolean;
  canPublish: boolean;
  canUnpublish: boolean;
};
type InstanceUser = {
  id: string;
  email: string;
  isAdmin: boolean;
  banned: boolean;
  banReason: string | null;
  banExpires: string | null;
  workspaceCount: number;
};
type ApiKeySummary = {
  id: string;
  name: string | null;
  enabled: boolean;
  scope: {
    access: "full" | "read" | "custom";
    areas: Record<string, "read" | "write">;
    projects: { id: string; name: string | null }[] | null;
  };
};

let world: World;
let project: Project;
let other: Project;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  world = await createWorld("PagesKeys");
  project = await createProject(world.as("owner"), world.workspace.id);
  other = await createProject(world.as("owner"), world.workspace.id);
});

test.afterAll(async () => {
  await world?.dispose();
});

async function newPage(data: Record<string, unknown> = {}): Promise<Page> {
  return expectJson<Page>(
    await world.as("member").post(`/api/page/project/${project.id}`, {
      data: { title: uniqueName("Page"), ...data },
    }),
  );
}

test(
  "a page saved as a template is listed, used for a new page and deleted",
  covers("savePageAsTemplate", "listPageTemplates", "deletePageTemplate"),
  async () => {
    const member = world.as("member");
    const source = await newPage({
      content: "# Retro\n\nWhat went well, what to change.",
    });
    const name = uniqueName("Retro template");

    // A viewer may read pages but not save templates.
    await expectStatus(
      await world.as("viewer").post(`/api/page/${source.id}/template`, {
        data: { name, scope: "project" },
      }),
      403,
    );
    await expectStatus(
      await member.post(`/api/page/${source.id}/template`, {
        data: { name: "  ", scope: "project" },
      }),
      400,
    );

    const template = await expectJson<Template>(
      await member.post(`/api/page/${source.id}/template`, {
        data: { name, scope: "project" },
      }),
    );
    expect(template).toMatchObject({
      name,
      scope: "project",
      projectId: project.id,
      createdById: world.users.member.id,
      canDelete: true,
    });
    const workspaceWide = await expectJson<Template>(
      await member.post(`/api/page/${source.id}/template`, {
        data: { name: uniqueName("Shared template"), scope: "workspace" },
      }),
    );
    expect(workspaceWide).toMatchObject({
      scope: "workspace",
      projectId: null,
    });

    // The project template stays in its project; the workspace one is shared.
    const inProject = await expectJson<Template[]>(
      await world.as("viewer").get(`/api/page/project/${project.id}/templates`),
    );
    const viewerCopy = inProject.find((entry) => entry.id === template.id);
    expect(viewerCopy?.canDelete).toBe(false);
    expect(inProject.map((entry) => entry.id)).toContain(workspaceWide.id);
    const inOther = await expectJson<Template[]>(
      await member.get(`/api/page/project/${other.id}/templates`),
    );
    expect(inOther.map((entry) => entry.id)).toContain(workspaceWide.id);
    expect(inOther.map((entry) => entry.id)).not.toContain(template.id);

    // A new page copies the template's content.
    const fromTemplate = await expectJson<Page>(
      await member.post(`/api/page/project/${project.id}`, {
        data: { templateId: template.id },
      }),
    );
    expect(fromTemplate.title).toBe(name);
    const read = await expectJson<Page & { contentMarkdown: string }>(
      await member.get(`/api/page/${fromTemplate.id}`),
    );
    expect(read.contentMarkdown).toContain("What went well");

    // Outsiders cannot list or see the templates at all.
    const outsider = await signUpUser("Template outsider");
    try {
      await expectStatus(
        await outsider.ctx.get(`/api/page/project/${project.id}/templates`),
        [403, 404],
      );
      await expectStatus(
        await outsider.ctx.delete(`/api/page/template/${template.id}`),
        404,
      );
    } finally {
      await outsider.ctx.dispose();
    }
    await expectStatus(
      await world.anonymous.get(`/api/page/project/${project.id}/templates`),
      401,
    );

    // Not who saved it and no page:delete.
    await expectStatus(
      await world.as("viewer").delete(`/api/page/template/${template.id}`),
      403,
    );
    expect(
      await expectJson(
        await member.delete(`/api/page/template/${template.id}`),
      ),
    ).toEqual({ id: template.id });
    // An admin (page:delete) removes a template someone else saved.
    await expectJson(
      await world.as("admin").delete(`/api/page/template/${workspaceWide.id}`),
    );
    const after = await expectJson<Template[]>(
      await member.get(`/api/page/project/${project.id}/templates`),
    );
    expect(after.map((entry) => entry.id)).not.toContain(template.id);
    expect(after.map((entry) => entry.id)).not.toContain(workspaceWide.id);
    await expectStatus(
      await member.delete(`/api/page/template/${template.id}`),
      404,
    );
  },
);

test(
  "a published page reads anonymously until it is unpublished",
  covers(
    "getPagePublication",
    "publishPage",
    "getPublicPage",
    "getPublicPageAsset",
    "unpublishPage",
  ),
  async () => {
    const owner = world.as("owner");
    const page = await newPage({
      content: "# Release notes\n\nVisible to anyone with the link.",
    });

    // Public pages are off by default for a workspace.
    const initial = await expectJson<Publication>(
      await owner.get(`/api/page/${page.id}/publication`),
    );
    expect(initial).toMatchObject({
      published: false,
      token: null,
      path: null,
      allowed: false,
      canPublish: false,
      canUnpublish: false,
    });
    await expectStatus(await owner.post(`/api/page/${page.id}/publish`), 409);

    await expectJson(
      await owner.patch(`/api/workspace/${world.workspace.id}/settings`, {
        data: { allowPublicPages: true },
      }),
    );
    const allowed = await expectJson<Publication>(
      await owner.get(`/api/page/${page.id}/publication`),
    );
    expect(allowed).toMatchObject({ allowed: true, canPublish: true });

    // A member has no project:share.
    const asMember = await expectJson<Publication>(
      await world.as("member").get(`/api/page/${page.id}/publication`),
    );
    expect(asMember.canPublish).toBe(false);
    await expectStatus(
      await world.as("member").post(`/api/page/${page.id}/publish`),
      403,
    );
    await expectStatus(
      await world.anonymous.get(`/api/page/${page.id}/publication`),
      401,
    );

    // A private page can't be published.
    const privatePage = await newPage({ access: "private" });
    await expectStatus(
      await world.as("admin").post(`/api/page/${privatePage.id}/publish`),
      [404, 409],
    );

    const published = await expectJson<Publication>(
      await owner.post(`/api/page/${page.id}/publish`),
    );
    expect(published.published).toBe(true);
    const token = published.token ?? "";
    expect(token.length).toBeGreaterThan(16);
    expect(published.path).toBe(`/public-page/${token}`);
    expect(published.publishedAt).not.toBeNull();
    expect(published.canUnpublish).toBe(true);
    // Publishing again keeps the link.
    const again = await expectJson<Publication>(
      await owner.post(`/api/page/${page.id}/publish`),
    );
    expect(again.token).toBe(token);

    const response = await world.anonymous.get(`/api/public-page/${token}`);
    const publicPage = await expectJson<{
      title: string;
      isFullWidth: boolean;
      updatedAt: string;
      content: Record<string, unknown>;
    }>(response);
    expect(publicPage.title).toBe(page.title);
    expect(JSON.stringify(publicPage.content)).toContain(
      "Visible to anyone with the link.",
    );
    expect(response.headers()["x-robots-tag"]).toBe("noindex");
    expect(response.headers()["cache-control"]).toBe("no-store");
    // Nothing internal leaks into the public shape.
    expect(Object.keys(publicPage).sort()).toEqual(
      [
        "content",
        "isFullWidth",
        "logoKind",
        "logoValue",
        "title",
        "updatedAt",
      ].sort(),
    );

    // Images: only the page's own uploaded images are served. The e2e API has
    // no object storage, so the page has none and any asset id is 404.
    await expectStatus(
      await world.anonymous.get(
        `/api/public-page/${token}/asset/00000000-0000-0000-0000-000000000000`,
      ),
      404,
    );
    await expectStatus(
      await world.anonymous.get(
        "/api/public-page/not-a-real-token/asset/anything",
      ),
      404,
    );
    await expectStatus(
      await world.anonymous.get("/api/public-page/not-a-real-token"),
      404,
    );

    await expectStatus(
      await world.as("member").post(`/api/page/${page.id}/unpublish`),
      403,
    );
    const unpublished = await expectJson<Publication>(
      await owner.post(`/api/page/${page.id}/unpublish`),
    );
    expect(unpublished).toMatchObject({
      published: false,
      token: null,
      path: null,
      canUnpublish: false,
    });
    await expectStatus(
      await world.anonymous.get(`/api/public-page/${token}`),
      404,
    );

    // Publishing again issues a new link; turning public pages off for the
    // workspace hides it at once.
    const republished = await expectJson<Publication>(
      await owner.post(`/api/page/${page.id}/publish`),
    );
    expect(republished.token).not.toBe(token);
    await expectJson(
      await world.anonymous.get(`/api/public-page/${republished.token}`),
    );
    await expectJson(
      await owner.patch(`/api/workspace/${world.workspace.id}/settings`, {
        data: { allowPublicPages: false },
      }),
    );
    await expectStatus(
      await world.anonymous.get(`/api/public-page/${republished.token}`),
      404,
    );
  },
);

test(
  "the built-in upload store is off when the instance has no local storage",
  covers("uploadStorageObject"),
  async () => {
    // The e2e API runs with MARGAYA_LOCAL_STORAGE=false and no S3, so the
    // built-in store answers 404 whatever the token.
    const response = await world.anonymous.put(
      "/api/storage/upload/e2e-not-a-signed-token",
      {
        headers: { "content-type": "image/png" },
        data: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      },
    );
    await expectStatus(response, 404);
  },
);

test.describe("instance user management", () => {
  let target: TestUser;
  let bystander: TestUser;

  test.beforeAll(async () => {
    target = await signUpUser("Instance target");
    bystander = await signUpUser("Instance bystander");
  });

  test.afterAll(async () => {
    await target?.ctx.dispose();
    await bystander?.ctx.dispose();
  });

  async function signIn(user: TestUser, password = user.password) {
    const ctx = await createApiContext({
      apiURL: E2E_API_URL,
      clientURL: E2E_WEB_URL,
    });
    const response = await ctx.post("/api/auth/sign-in/email", {
      data: { email: user.email, password },
    });
    return { ctx, status: response.status() };
  }

  test(
    "the instance admin lists and inspects accounts; others cannot",
    covers("listInstanceUsers", "getInstanceUser"),
    async ({ api }) => {
      const page = await expectJson<{
        items: InstanceUser[];
        nextCursor: string | null;
      }>(
        await api.get("/api/instance-admin/users", {
          params: { search: target.email },
        }),
      );
      expect(page.items).toHaveLength(1);
      expect(page.items[0]).toMatchObject({
        id: target.id,
        email: target.email,
        isAdmin: false,
        banned: false,
        workspaceCount: 0,
      });
      expect(page.nextCursor).toBeNull();
      expect(JSON.stringify(page)).not.toContain("password");

      const admins = await expectJson<{ items: InstanceUser[] }>(
        await api.get("/api/instance-admin/users", {
          params: { status: "admins", limit: "100" },
        }),
      );
      expect(admins.items.every((user) => user.isAdmin)).toBe(true);
      expect(admins.items.map((user) => user.id)).not.toContain(target.id);

      const detail = await expectJson<{
        id: string;
        workspaces: unknown[];
        activeSessions: number;
        hasPassword: boolean;
      }>(await api.get(`/api/instance-admin/users/${target.id}`));
      expect(detail).toMatchObject({
        id: target.id,
        workspaces: [],
        hasPassword: true,
      });
      expect(detail.activeSessions).toBeGreaterThanOrEqual(1);

      const memberDetail = await expectJson<{
        workspaces: { id: string; role: string }[];
      }>(await api.get(`/api/instance-admin/users/${world.users.member.id}`));
      expect(memberDetail.workspaces).toContainEqual(
        expect.objectContaining({ id: world.workspace.id, role: "member" }),
      );

      await expectStatus(
        await api.get("/api/instance-admin/users/e2e-no-such-user"),
        404,
      );
      await expectStatus(
        await api.get("/api/instance-admin/users", {
          params: { status: "everyone" },
        }),
        400,
      );

      // Workspace owners are not instance admins.
      await expectStatus(
        await world.as("owner").get("/api/instance-admin/users"),
        403,
      );
      await expectStatus(
        await bystander.ctx.get(`/api/instance-admin/users/${target.id}`),
        403,
      );
      await expectStatus(
        await world.anonymous.get("/api/instance-admin/users"),
        401,
      );
    },
  );

  test(
    "account changes need a confirmed password, then ban, unban, sign out and reset",
    covers(
      "confirmInstanceAdmin",
      "banInstanceUser",
      "unbanInstanceUser",
      "revokeInstanceUserSessions",
      "resetInstanceUserPassword",
    ),
    async ({ api, seed }) => {
      const wrong = await api.post("/api/instance-admin/reauth", {
        data: { password: "definitely-not-the-password" },
      });
      const wrongBody = JSON.parse(await expectStatus(wrong, 403));
      expect(wrongBody.code).toBe("INVALID_PASSWORD");

      const confirmed = await expectJson<{ reauthenticatedUntil: string }>(
        await api.post("/api/instance-admin/reauth", {
          data: { password: SEED_USERS.owner.password },
        }),
      );
      const until = new Date(confirmed.reauthenticatedUntil).getTime();
      expect(until).toBeGreaterThan(Date.now() + 8 * 60_000);
      expect(until).toBeLessThanOrEqual(Date.now() + 11 * 60_000);

      // Only an instance admin may confirm, and only with a session.
      await expectStatus(
        await bystander.ctx.post("/api/instance-admin/reauth", {
          data: { password: bystander.password },
        }),
        403,
      );
      await expectStatus(
        await bystander.ctx.post(`/api/instance-admin/users/${target.id}/ban`, {
          data: {},
        }),
        403,
      );

      // Ban: the account is signed out and can't sign in.
      await expectStatus(
        await api.post(`/api/instance-admin/users/${seed.users.owner.id}/ban`, {
          data: {},
        }),
        400,
      );
      expect(
        await expectJson(
          await api.post(`/api/instance-admin/users/${target.id}/ban`, {
            data: { reason: "E2E ban", expiresInDays: 1 },
          }),
        ),
      ).toEqual({ userId: target.id, banned: true });
      await expectStatus(
        await target.ctx.get("/api/project", {
          params: { workspaceId: world.workspace.id },
        }),
        401,
      );
      const bannedSignIn = await signIn(target);
      await bannedSignIn.ctx.dispose();
      expect(bannedSignIn.status).toBeGreaterThanOrEqual(400);
      const banned = await expectJson<{ items: InstanceUser[] }>(
        await api.get("/api/instance-admin/users", {
          params: { status: "banned", search: target.email },
        }),
      );
      expect(banned.items[0]).toMatchObject({
        id: target.id,
        banned: true,
        banReason: "E2E ban",
      });
      expect(banned.items[0]?.banExpires).not.toBeNull();

      // Unban: signing in works again.
      expect(
        await expectJson(
          await api.post(`/api/instance-admin/users/${target.id}/unban`),
        ),
      ).toEqual({ userId: target.id, banned: false });
      const back = await signIn(target);
      expect(back.status).toBe(200);
      const stillBanned = await expectJson<{ items: InstanceUser[] }>(
        await api.get("/api/instance-admin/users", {
          params: { status: "banned", search: target.email },
        }),
      );
      expect(stillBanned.items).toEqual([]);

      // Sign out everywhere: the fresh session stops working. Signed in, the
      // target is refused a workspace it is not in (403), not unauthenticated.
      await expectStatus(
        await back.ctx.get("/api/project", {
          params: { workspaceId: world.workspace.id },
        }),
        403,
      );
      await expectStatus(
        await api.post(
          `/api/instance-admin/users/${seed.users.owner.id}/revoke-sessions`,
        ),
        400,
      );
      const revoked = await expectJson<{ userId: string; revoked: number }>(
        await api.post(
          `/api/instance-admin/users/${target.id}/revoke-sessions`,
        ),
      );
      expect(revoked.userId).toBe(target.id);
      expect(revoked.revoked).toBeGreaterThanOrEqual(1);
      await expectStatus(
        await back.ctx.get("/api/project", {
          params: { workspaceId: world.workspace.id },
        }),
        401,
      );
      await back.ctx.dispose();
      const detail = await expectJson<{ activeSessions: number }>(
        await api.get(`/api/instance-admin/users/${target.id}`),
      );
      expect(detail.activeSessions).toBe(0);

      // Reset: the password rules apply; a new password replaces the old.
      await expectStatus(
        await api.post(
          `/api/instance-admin/users/${target.id}/reset-password`,
          { data: { password: "short" } },
        ),
        400,
      );
      const newPassword = `E2E-Reset-${Date.now().toString(36)}-Pass!`;
      expect(
        await expectJson(
          await api.post(
            `/api/instance-admin/users/${target.id}/reset-password`,
            { data: { password: newPassword } },
          ),
        ),
      ).toEqual({ userId: target.id, method: "set" });
      const oldPassword = await signIn(target);
      await oldPassword.ctx.dispose();
      expect(oldPassword.status).toBeGreaterThanOrEqual(400);
      const withNew = await signIn(target, newPassword);
      await withNew.ctx.dispose();
      expect(withNew.status).toBe(200);
      target.password = newPassword;

      // Without a password: a reset link by email (MailPit is configured).
      expect(
        await expectJson(
          await api.post(
            `/api/instance-admin/users/${target.id}/reset-password`,
            { data: {} },
          ),
        ),
      ).toEqual({ userId: target.id, method: "email" });

      await expectStatus(
        await api.post("/api/instance-admin/users/e2e-no-such-user/unban"),
        404,
      );
    },
  );

  test(
    "the instance audit trail records the account actions",
    covers("listInstanceAuditLog"),
    async ({ api }) => {
      const page = await expectJson<{
        items: {
          action: string;
          actorType: string;
          targetId: string | null;
          metadata: Record<string, unknown> | null;
        }[];
        nextCursor: string | null;
      }>(
        await api.get("/api/instance-admin/audit-log", {
          params: {
            action:
              "user.banned,user.unbanned,user.sessions_revoked,user.password_set,user.password_reset_sent",
            limit: "100",
          },
        }),
      );
      const forTarget = page.items.filter(
        (entry) => entry.targetId === target.id,
      );
      expect(forTarget.map((entry) => entry.action).sort()).toEqual(
        [
          "user.banned",
          "user.password_reset_sent",
          "user.password_set",
          "user.sessions_revoked",
          "user.unbanned",
        ].sort(),
      );
      expect(forTarget.every((entry) => entry.actorType === "user")).toBe(true);
      // Passwords never land in the trail.
      expect(JSON.stringify(page)).not.toContain(target.password);

      const confirmations = await expectJson<{ items: { action: string }[] }>(
        await api.get("/api/instance-admin/audit-log", {
          params: { action: "instance.reauthenticated", limit: "5" },
        }),
      );
      expect(confirmations.items.length).toBeGreaterThan(0);
      expect(
        confirmations.items.every(
          (entry) => entry.action === "instance.reauthenticated",
        ),
      ).toBe(true);

      await expectStatus(
        await bystander.ctx.get("/api/instance-admin/audit-log"),
        403,
      );
      await expectStatus(
        await world.anonymous.get("/api/instance-admin/audit-log"),
        401,
      );
    },
  );
});

test(
  "a scoped API key is enforced, logs its requests and is revoked",
  covers("createScopedApiKey", "listApiKeys", "listApiKeyRequests"),
  async () => {
    const owner = world.as("owner");
    await newPage();

    // Custom access needs at least one area; projects must be reachable.
    await expectStatus(
      await owner.post("/api/api-key", {
        data: { name: "no areas", expiresIn: null, access: "custom" },
      }),
      400,
    );
    await expectStatus(
      await owner.post("/api/api-key", {
        data: {
          name: "bad project",
          expiresIn: null,
          access: "read",
          projectIds: ["e2e-no-such-project"],
        },
      }),
      400,
    );

    const name = uniqueName("ro key").slice(0, 32);
    const created = await expectJson<ApiKeySummary & { key: string }>(
      await owner.post("/api/api-key", {
        data: {
          name,
          expiresIn: 7 * 24 * 60 * 60,
          access: "read",
          projectIds: [project.id],
        },
      }),
    );
    expect(created.key.length).toBeGreaterThan(20);
    expect(created).toMatchObject({
      name,
      enabled: true,
      scope: {
        access: "read",
        projects: [{ id: project.id, name: project.name }],
      },
    });
    expect(created.scope.areas.page).toBe("read");

    const viaKey = await headerContext({ "x-api-key": created.key });
    try {
      // Reads within the project work.
      const pages = await expectJson<Page[]>(
        await viaKey.get(`/api/page/project/${project.id}`),
      );
      expect(pages.length).toBeGreaterThan(0);
      // Writes are refused for a read-only key.
      const refused = await expectStatus(
        await viaKey.post(`/api/page/project/${project.id}`, {
          data: { title: "Written by a read-only key" },
        }),
        403,
      );
      expect(refused).toContain("read-only");
      // Other projects read as missing.
      await expectStatus(
        await viaKey.get(`/api/page/project/${other.id}`),
        404,
      );
      // A key can't manage keys.
      await expectStatus(await viaKey.get("/api/api-key"), 403);

      const keys = await expectJson<ApiKeySummary[]>(
        await owner.get("/api/api-key"),
      );
      const listed = keys.find((key) => key.id === created.id);
      expect(listed).toMatchObject({ name, scope: { access: "read" } });
      expect(JSON.stringify(keys)).not.toContain(created.key);
      // Other users never see this key.
      const memberKeys = await expectJson<ApiKeySummary[]>(
        await world.as("member").get("/api/api-key"),
      );
      expect(memberKeys.map((key) => key.id)).not.toContain(created.id);

      const log = await expectJson<{
        items: {
          method: string;
          route: string;
          status: number;
          durationMs: number;
        }[];
        nextCursor: string | null;
      }>(await owner.get(`/api/api-key/${created.id}/requests`));
      expect(log.items).toContainEqual(
        expect.objectContaining({
          method: "GET",
          route: "/api/page/project/:projectId",
          status: 200,
        }),
      );
      expect(log.items).toContainEqual(
        expect.objectContaining({ method: "POST", status: 403 }),
      );
      // Route templates only: never the concrete ids.
      expect(JSON.stringify(log)).not.toContain(project.id);

      const paged = await expectJson<{
        items: unknown[];
        nextCursor: string | null;
      }>(
        await owner.get(`/api/api-key/${created.id}/requests`, {
          params: { limit: "1" },
        }),
      );
      expect(paged.items).toHaveLength(1);
      expect(paged.nextCursor).not.toBeNull();

      await expectStatus(
        await world.as("member").get(`/api/api-key/${created.id}/requests`),
        404,
      );
      await expectStatus(await world.anonymous.get("/api/api-key"), 401);

      // Revoked: the key stops working and leaves the list.
      await deleteApiKey(owner, created.id);
      await expectStatus(
        await viaKey.get(`/api/page/project/${project.id}`),
        401,
      );
      const afterDelete = await expectJson<ApiKeySummary[]>(
        await owner.get("/api/api-key"),
      );
      expect(afterDelete.map((key) => key.id)).not.toContain(created.id);
    } finally {
      await viaKey.dispose();
      await deleteApiKey(owner, created.id).catch(() => undefined);
    }
  },
);
