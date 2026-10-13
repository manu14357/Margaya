import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "../../fixtures";
import {
  createApiKey,
  createProject,
  deleteApiKey,
  deleteProjectQuietly,
  expectJson,
  expectStatus,
  headerContext,
  signUpUser,
  type TestUser,
} from "../../helpers/api-kit";
import {
  liveOperationIds,
  loadOpenApi,
  loadOperations,
  type Operation,
  sampleFromSchema,
} from "../../helpers/openapi";

// Cross-cutting authorization over the whole contract: every secured route
// rejects anonymous callers, API keys authenticate like sessions, another
// workspace's data stays out of reach, and unknown ids get a documented 4xx.

const document = loadOpenApi();
const operations = loadOperations();

/** Placeholder bodies and queries shaped like the schema (required fields). */
function sampleRequest(operation: Operation, placeholder = "e2e-unknown-id") {
  const pathname = operation.path.replace(/\{([^}]+)\}/g, (_, name: string) =>
    name === "entityType" ? "project" : placeholder,
  );
  const params: Record<string, string> = {};
  for (const parameter of operation.raw.parameters ?? []) {
    if (parameter.in === "query" && parameter.required) {
      params[parameter.name] = String(
        sampleFromSchema(document, parameter.schema, placeholder),
      );
    }
  }
  const bodySchema =
    operation.raw.requestBody?.content?.["application/json"]?.schema;
  return {
    url: `/api${pathname}`,
    params,
    data:
      bodySchema === undefined
        ? undefined
        : sampleFromSchema(document, bodySchema, placeholder),
  };
}

// Better Auth's schema-less bodies need their real fields to reach the
// session check instead of failing validation first.
const ANONYMOUS_OVERRIDES: Record<
  string,
  { data?: unknown; params?: Record<string, string> }
> = {
  deleteOrganizationRole: { data: { roleName: "x", organizationId: "x" } },
  updateOrganizationRole: {
    data: { roleName: "x", organizationId: "x", data: {} },
  },
  getOrganizationRole: { params: { roleName: "x", organizationId: "x" } },
  removeOrganizationTeam: { data: { teamId: "x", organizationId: "x" } },
};

async function send(
  ctx: APIRequestContext,
  operation: Operation,
  request: { url: string; params: Record<string, string>; data?: unknown },
) {
  return ctx.fetch(request.url, {
    method: operation.method.toUpperCase(),
    params: request.params,
    data: request.data,
    maxRedirects: 0,
  });
}

test.describe("unauthenticated callers", () => {
  test("every secured operation answers 401 without credentials", async ({
    apiAs,
  }) => {
    const anonymous = await apiAs("anonymous");
    const secured = operations.filter((operation) => operation.secured);
    expect(secured.length).toBeGreaterThan(150);

    const failures: string[] = [];
    for (const operation of secured) {
      const request = sampleRequest(operation);
      const override = ANONYMOUS_OVERRIDES[operation.operationId];
      if (override?.data) request.data = override.data;
      if (override?.params) request.params = override.params;
      const response = await send(anonymous, operation, request);
      // Better Auth answers "Missing session headers, or email query
      // parameter." with 400 here; it never lists anything.
      const allowed =
        operation.operationId === "listOrganizationUserInvitations"
          ? [400, 401]
          : [401];
      if (!allowed.includes(response.status())) {
        failures.push(
          `${operation.method.toUpperCase()} ${operation.path} -> ${response.status()} ${(await response.text()).slice(0, 120)}`,
        );
      }
    }
    expect(failures).toEqual([]);
  });

  test("public operations answer without credentials", async ({
    apiAs,
    seed,
  }) => {
    const anonymous = await apiAs("anonymous");
    await expectJson(await anonymous.get("/api/config"));
    await expectJson(await anonymous.get("/api/instance/status"));
    // An unpublished project is not readable anonymously: the deprecated
    // route resolves its id like a link token, so it answers 404.
    await expectStatus(
      await anonymous.get(`/api/public-project/${seed.projects.web.id}`),
      404,
    );
  });

  test("a malformed or unknown bearer token is rejected", async ({ seed }) => {
    const attempts: Record<string, string>[] = [
      { Authorization: "Bearer" },
      { Authorization: "Bearer not-a-real-token" },
      { "x-api-key": "not-a-real-key" },
    ];
    for (const headers of attempts) {
      const ctx = await headerContext(headers);
      try {
        await expectStatus(
          await ctx.get("/api/project", {
            params: { workspaceId: seed.workspace.id },
          }),
          401,
        );
      } finally {
        await ctx.dispose();
      }
    }
  });
});

test.describe("API keys", () => {
  test("a key created over HTTP authenticates REST calls until it is deleted", async ({
    api,
    seed,
  }) => {
    const project = await createProject(api, seed.workspace.id);
    const key = await createApiKey(api);
    expect(key.key).toBeTruthy();

    const listed = await expectJson<
      { id: string; name: string }[] | { apiKeys: { id: string }[] }
    >(await api.get("/api/auth/api-key/list"));
    const keys = Array.isArray(listed) ? listed : listed.apiKeys;
    expect(keys.map((entry) => entry.id)).toContain(key.id);

    const schemes: Record<string, string>[] = [
      { "x-api-key": key.key },
      { Authorization: `Bearer ${key.key}` },
    ];
    for (const headers of schemes) {
      const ctx = await headerContext(headers);
      try {
        const projects = await expectJson<{ id: string }[]>(
          await ctx.get("/api/project", {
            params: { workspaceId: seed.workspace.id },
          }),
        );
        expect(projects.map((project) => project.id)).toContain(
          seed.projects.web.id,
        );
        // Writes run as the key's user.
        const task = await expectJson<{ id: string; createdBy: string }>(
          await ctx.post(`/api/task/${project.id}`, {
            data: {
              title: `API key task ${Date.now()}`,
              description: "",
              priority: "low",
              status: "to-do",
            },
          }),
        );
        expect(task.createdBy).toBe(seed.users.owner.id);
        await expectJson(await ctx.delete(`/api/task/${task.id}`));
      } finally {
        await ctx.dispose();
      }
    }

    await deleteApiKey(api, key.id);
    const revoked = await headerContext({ "x-api-key": key.key });
    try {
      await expectStatus(
        await revoked.get("/api/project", {
          params: { workspaceId: seed.workspace.id },
        }),
        401,
      );
    } finally {
      await revoked.dispose();
      await deleteProjectQuietly(api, project.id);
    }
  });

  test("a key carries its user's role: a viewer key cannot write", async ({
    apiAs,
    seed,
  }) => {
    const viewer = await apiAs("viewer");
    const key = await createApiKey(viewer);
    const ctx = await headerContext({ "x-api-key": key.key });
    try {
      await expectJson(
        await ctx.get(`/api/task/${seed.projects.web.tasks.hero.id}`),
      );
      await expectStatus(
        await ctx.post(`/api/task/${seed.projects.web.id}`, {
          data: {
            title: "Viewer key task",
            description: "",
            priority: "low",
            status: "to-do",
          },
        }),
        403,
      );
    } finally {
      await ctx.dispose();
      await deleteApiKey(viewer, key.id);
    }
  });
});

test.describe("workspace boundary", () => {
  let outsider: TestUser;

  test.beforeAll(async () => {
    outsider = await signUpUser("outsider");
  });

  test.afterAll(async () => {
    await outsider?.ctx.dispose();
  });

  test("a signed-in user of another workspace gets 403 on the seeded workspace", async ({
    api,
    seed,
  }) => {
    const workspaceId = seed.workspace.id;
    const web = seed.projects.web;
    const task = web.tasks.hero.id;
    const reads = [
      `/api/project?workspaceId=${workspaceId}`,
      `/api/project/${web.id}`,
      `/api/task/tasks/${web.id}`,
      `/api/task/${task}`,
      `/api/column/${web.id}`,
      `/api/activity/${task}`,
      `/api/comment/${task}`,
      `/api/label/workspace/${workspaceId}`,
      `/api/label/task/${task}`,
      `/api/workspace/${workspaceId}/members`,
      `/api/cycle/project/${web.id}`,
      `/api/module/project/${web.id}`,
      `/api/estimate/${web.id}`,
      `/api/custom-field/project/${web.id}`,
      `/api/task-relation/${task}`,
      `/api/task-link/${task}`,
      `/api/favorite?workspaceId=${workspaceId}`,
      `/api/recent-visit?workspaceId=${workspaceId}`,
      `/api/search?q=landing&workspaceId=${workspaceId}`,
      `/api/generic-webhook-integration/project/${web.id}`,
    ];
    const leaks: string[] = [];
    for (const url of reads) {
      const response = await outsider.ctx.get(url);
      if (response.status() !== 403) {
        leaks.push(`GET ${url} -> ${response.status()}`);
      }
    }
    const writes: [string, string, unknown][] = [
      [
        "POST",
        `/api/task/${web.id}`,
        { title: "x", description: "", priority: "low", status: "to-do" },
      ],
      ["PUT", `/api/task/title/${task}`, { title: "hijacked" }],
      ["POST", `/api/comment/${task}`, { content: "hello" }],
      ["DELETE", `/api/task/${task}`, undefined],
      ["POST", "/api/task-query", { workspaceId }],
    ];
    for (const [method, url, data] of writes) {
      const response = await outsider.ctx.fetch(url, { method, data });
      if (response.status() !== 403) {
        leaks.push(`${method} ${url} -> ${response.status()}`);
      }
    }
    expect(leaks).toEqual([]);

    // Nothing changed.
    const hero = await expectJson<{ title: string }>(
      await api.get(`/api/task/${task}`),
    );
    expect(hero.title).toBe(web.tasks.hero.title);
  });
});

test.describe("unknown ids", () => {
  test("every operation with a path id answers a documented status below 500 for unknown ids", async ({
    apiAs,
  }) => {
    // The workspace admin: a regular account, unlike the owner, who is also
    // the instance administrator.
    const admin = await apiAs("admin");
    // Routes in the contract that the running API does not serve yet answer
    // the router's plain 404; they are checked once deployed.
    const live = await liveOperationIds();
    const failures: string[] = [];
    for (const operation of operations) {
      if (!operation.path.includes("{")) continue;
      if (!live.has(operation.operationId)) continue;
      const response = await send(admin, operation, sampleRequest(operation));
      const status = response.status();
      if (status >= 500 || !operation.responses.includes(String(status))) {
        failures.push(
          `${operation.method.toUpperCase()} ${operation.path} -> ${status} (documented ${operation.responses.join(",")}): ${(await response.text()).slice(0, 100)}`,
        );
      }
    }
    expect(failures).toEqual([]);
  });

  test("publication routes answer a documented 404 for an unknown project", async ({
    apiAs,
  }) => {
    // Regression: these once answered an undocumented 400 "Workspace ID could
    // not be determined".
    const admin = await apiAs("admin");
    const failures: string[] = [];
    for (const operationId of [
      "getProjectPublication",
      "unpublishProject",
      "rotateProjectPublicationLink",
      "listPublicBoardBlocks",
      "unblockPublicBoardParticipant",
    ]) {
      const operation = operations.find(
        (entry) => entry.operationId === operationId,
      );
      if (!operation) {
        failures.push(`${operationId}: not in the contract`);
        continue;
      }
      const response = await send(admin, operation, sampleRequest(operation));
      const status = response.status();
      if (status !== 404 || !operation.responses.includes("404")) {
        failures.push(
          `${operationId} -> ${status} (documented ${operation.responses.join(",")})`,
        );
      }
    }
    expect(failures).toEqual([]);
  });

  test("DELETE /estimate with an unknown project answers the documented 400", async ({
    apiAs,
  }) => {
    // Regression: deleteEstimate once answered an undocumented 400. The
    // contract now documents 400 "Unknown project" for this case.
    const admin = await apiAs("admin");
    const response = await admin.delete(
      "/api/estimate/e2e-unknown-id/e2e-unknown-id",
    );
    const message = await expectStatus(response, 400);
    expect(message).toContain("Workspace ID could not be determined");
    const documented = operations.find(
      (operation) => operation.operationId === "deleteEstimate",
    )?.responses;
    expect(documented).toContain("400");
  });
});
