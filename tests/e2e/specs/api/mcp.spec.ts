import { expect, test } from "../../fixtures";
import {
  createApiKey,
  createProject,
  createWorld,
  deleteApiKey,
  expectJson,
  expectStatus,
  type Project,
  type Task,
  type World,
} from "../../helpers/api-kit";
import { E2E_API_URL, E2E_WEB_URL } from "../../helpers/env";
import { McpHttpClient, mcpOAuthToken, pkcePair } from "../../helpers/mcp";
import { covers } from "../../helpers/openapi";
import { uniqueName } from "../../helpers/ui";

// The built-in MCP endpoint (/api/mcp): its OAuth 2.1 + PKCE flow and consent
// routes, then tools called over Streamable HTTP with their effects checked
// through the REST API. OAuth access tokens and API keys both authenticate it.

let world: World;
let project: Project;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  world = await createWorld("MCP");
  project = await createProject(world.as("owner"), world.workspace.id);
});

test.afterAll(async () => {
  await world?.dispose();
});

const REDIRECT_URI = "http://127.0.0.1:9/callback";

test(
  "OAuth: register a client, authorize with PKCE, read and decide the consent request",
  covers(
    "registerMcpOAuthClient",
    "authorizeMcpOAuthClient",
    "getMcpAuthorizationRequest",
    "decideMcpAuthorizationRequest",
  ),
  async () => {
    const anonymous = world.as("anonymous");
    const client = await expectJson<{
      client_id: string;
      redirect_uris: string[];
      token_endpoint_auth_method: string;
      grant_types: string[];
    }>(
      await anonymous.post("/api/mcp/register", {
        data: {
          redirect_uris: [REDIRECT_URI],
          client_name: "E2E client",
          grant_types: ["authorization_code", "refresh_token"],
        },
      }),
    );
    expect(client).toMatchObject({
      redirect_uris: [REDIRECT_URI],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code"],
    });

    // Unsafe redirect URIs are refused with an OAuth error body.
    const rejected = await expectJson<{ error: string }>(
      await anonymous.post("/api/mcp/register", {
        data: { redirect_uris: ["http://evil.example/callback"] },
      }),
      400,
    );
    expect(rejected.error).toBe("invalid_redirect_uri");

    const authorizeWith = async (challenge: string, state: string) => {
      const response = await anonymous.get("/api/mcp/authorize", {
        params: {
          response_type: "code",
          client_id: client.client_id,
          redirect_uri: REDIRECT_URI,
          code_challenge: challenge,
          code_challenge_method: "S256",
          state,
        },
        maxRedirects: 0,
      });
      expect(response.status()).toBe(302);
      const location = new URL(response.headers().location ?? "");
      expect(`${location.origin}${location.pathname}`).toBe(
        `${E2E_WEB_URL}/mcp/authorize`,
      );
      return location.searchParams.get("request_id") ?? "";
    };

    const { verifier, challenge } = pkcePair();
    const requestId = await authorizeWith(challenge, "approve-me");
    const details = await expectJson<{
      client_name: string;
      redirect_uri: string;
    }>(await anonymous.get(`/api/mcp/authorize/request/${requestId}`));
    expect(details).toEqual({
      client_name: "E2E client",
      redirect_uri: REDIRECT_URI,
    });

    // Deciding needs a signed-in user on the web app's origin.
    await expectStatus(
      await anonymous.post(`/api/mcp/authorize/request/${requestId}`, {
        data: { approved: true },
      }),
      401,
    );
    await expectStatus(
      await world.as("owner").post(`/api/mcp/authorize/request/${requestId}`, {
        data: { approved: true },
        headers: { Origin: "https://evil.example" },
      }),
      403,
    );
    const approved = await expectJson<{ redirect: string }>(
      await world.as("owner").post(`/api/mcp/authorize/request/${requestId}`, {
        data: { approved: true },
      }),
    );
    const callback = new URL(approved.redirect);
    expect(`${callback.origin}${callback.pathname}`).toBe(REDIRECT_URI);
    expect(callback.searchParams.get("state")).toBe("approve-me");
    const code = callback.searchParams.get("code") ?? "";
    expect(code).toBeTruthy();

    // A consumed request cannot be decided twice.
    await expectStatus(
      await world.as("owner").post(`/api/mcp/authorize/request/${requestId}`, {
        data: { approved: true },
      }),
      404,
    );

    // The wrong verifier fails; the right one gets a bearer token once.
    const exchange = (codeVerifier: string) =>
      anonymous.post("/api/mcp/token", {
        form: {
          grant_type: "authorization_code",
          code,
          client_id: client.client_id,
          code_verifier: codeVerifier,
          redirect_uri: REDIRECT_URI,
        },
      });
    expect(
      (
        await expectJson<{ error: string }>(
          await exchange(pkcePair().verifier),
          400,
        )
      ).error,
    ).toBe("invalid_grant");
    const denied = pkcePair();
    const deniedRequest = await authorizeWith(denied.challenge, "deny-me");
    const deniedDecision = await expectJson<{ redirect: string }>(
      await world
        .as("owner")
        .post(`/api/mcp/authorize/request/${deniedRequest}`, {
          data: { approved: false },
        }),
    );
    expect(new URL(deniedDecision.redirect).searchParams.get("error")).toBe(
      "access_denied",
    );

    const fresh = pkcePair();
    const freshRequest = await authorizeWith(fresh.challenge, "again");
    const freshDecision = await expectJson<{ redirect: string }>(
      await world
        .as("owner")
        .post(`/api/mcp/authorize/request/${freshRequest}`, {
          data: { approved: true },
        }),
    );
    const token = await expectJson<{
      access_token: string;
      token_type: string;
      expires_in: number;
    }>(
      await anonymous.post("/api/mcp/token", {
        form: {
          grant_type: "authorization_code",
          code: new URL(freshDecision.redirect).searchParams.get("code") ?? "",
          client_id: client.client_id,
          code_verifier: fresh.verifier,
          redirect_uri: REDIRECT_URI,
        },
      }),
    );
    expect(token.token_type).toBe("bearer");
    expect(token.access_token).toBeTruthy();
    expect(verifier).not.toBe(fresh.verifier);

    await expectStatus(
      await anonymous.get("/api/mcp/authorize/request/e2e-unknown-request"),
      404,
    );
    await expectStatus(
      await anonymous.get("/api/mcp/authorize", {
        params: {
          response_type: "code",
          client_id: "e2e-unknown-client",
          redirect_uri: REDIRECT_URI,
          code_challenge: challenge,
          code_challenge_method: "S256",
        },
        maxRedirects: 0,
      }),
      400,
    );
  },
);

test("discovery metadata and the 401 challenge", async () => {
  const anonymous = world.as("anonymous");
  const resource = await expectJson<{
    resource: string;
    authorization_servers: string[];
  }>(await anonymous.get("/.well-known/oauth-protected-resource/api/mcp"));
  expect(resource).toEqual({
    resource: `${E2E_API_URL}/api/mcp`,
    authorization_servers: [`${E2E_API_URL}/api`],
  });
  const server = await expectJson<{
    token_endpoint: string;
    code_challenge_methods_supported: string[];
  }>(await anonymous.get("/.well-known/oauth-authorization-server/api"));
  expect(server.token_endpoint).toBe(`${E2E_API_URL}/api/mcp/token`);
  expect(server.code_challenge_methods_supported).toEqual(["S256"]);

  const unauthorized = await anonymous.post("/api/mcp", {
    headers: { Accept: "application/json, text/event-stream" },
    data: { jsonrpc: "2.0", id: 1, method: "tools/list" },
  });
  expect(unauthorized.status()).toBe(401);
  expect(unauthorized.headers()["www-authenticate"]).toContain(
    "resource_metadata=",
  );
});

test("MCP tools: initialize, list, create_task, query_tasks and set_task_assignees", async () => {
  const token = await mcpOAuthToken(world.as("anonymous"), world.as("owner"));
  const mcp = new McpHttpClient(world.as("anonymous"), {
    Authorization: `Bearer ${token}`,
  });
  try {
    const init = await mcp.initialize();
    expect(init.serverInfo.name).toBe("margaya-mcp");
    expect(mcp.sessionId).toBeTruthy();

    const tools = (await mcp.listTools()).map((tool) => tool.name);
    expect(tools).toEqual(
      expect.arrayContaining([
        "whoami",
        "create_task",
        "query_tasks",
        "set_task_assignees",
        "list_projects",
      ]),
    );

    const whoami = await mcp.callToolJson<{
      user?: { id: string };
      id?: string;
    }>("whoami", {});
    expect(JSON.stringify(whoami)).toContain(world.users.owner.id);

    const title = uniqueName("MCP task");
    const created = await mcp.callToolJson<Task>("create_task", {
      projectId: project.id,
      title,
      description: "Created through MCP",
      priority: "high",
      status: "to-do",
    });
    expect(created).toMatchObject({
      title,
      projectId: project.id,
      priority: "high",
    });
    const viaRest = await expectJson<
      Task & { description: string; createdBy: string }
    >(await world.as("viewer").get(`/api/task/${created.id}`));
    expect(viaRest).toMatchObject({
      title,
      description: "Created through MCP",
      createdBy: world.users.owner.id,
    });

    const query = await mcp.callToolJson<{ ids: string[] }>("query_tasks", {
      workspaceId: world.workspace.id,
      projectIds: [project.id],
      filters: { key: "priority", operator: "in", values: ["high"] },
      mode: "ids",
    });
    expect(query.ids).toContain(created.id);

    const assigned = await mcp.callToolJson<Task>("set_task_assignees", {
      taskId: created.id,
      assigneeIds: [world.users.member.id, world.users.admin.id],
    });
    expect(assigned.assigneeIds).toEqual([
      world.users.member.id,
      world.users.admin.id,
    ]);
    const afterAssign = await expectJson<Task>(
      await world.as("viewer").get(`/api/task/${created.id}`),
    );
    expect(afterAssign.assigneeIds).toEqual([
      world.users.member.id,
      world.users.admin.id,
    ]);

    // Tool input is validated; API errors come back as tool errors.
    const invalid = await mcp.callTool("create_task", {
      projectId: project.id,
    });
    expect(invalid.isError).toBe(true);
    const forbidden = await mcp.callTool("set_task_assignees", {
      taskId: created.id,
      assigneeIds: ["e2e-not-a-member"],
    });
    expect(forbidden.isError).toBe(true);
  } finally {
    await mcp.close();
  }
});

test("MCP tools run with the caller's role", async () => {
  const token = await mcpOAuthToken(world.as("anonymous"), world.as("viewer"));
  const mcp = new McpHttpClient(world.as("anonymous"), {
    Authorization: `Bearer ${token}`,
  });
  try {
    await mcp.initialize();
    const result = await mcp.callTool("create_task", {
      projectId: project.id,
      title: "Viewer via MCP",
      description: "",
      priority: "low",
      status: "to-do",
    });
    expect(result.isError).toBe(true);
    // Another user's session id is not found.
    const other = new McpHttpClient(world.as("anonymous"), {
      Authorization: `Bearer ${await mcpOAuthToken(world.as("anonymous"), world.as("member"))}`,
    });
    other.sessionId = mcp.sessionId;
    const hijack = await other.post({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });
    expect(hijack.status()).toBe(404);
  } finally {
    await mcp.close();
  }
});

test("an API key authenticates the MCP endpoint", async () => {
  // Like every REST route, /api/mcp accepts an API key as
  // `Authorization: Bearer <key>` or `x-api-key`, and its tools act as the
  // key's owner.
  const owner = world.as("owner");
  const key = await createApiKey(owner);
  const schemes: Record<string, string>[] = [
    { Authorization: `Bearer ${key.key}` },
    { "x-api-key": key.key },
  ];
  for (const headers of schemes) {
    const mcp = new McpHttpClient(world.as("anonymous"), headers);
    try {
      const init = await mcp.initialize();
      expect(init.serverInfo.name).toBe("margaya-mcp");
      const title = uniqueName("MCP key task");
      const created = await mcp.callToolJson<Task>("create_task", {
        projectId: project.id,
        title,
        description: "",
        priority: "low",
        status: "to-do",
      });
      const viaRest = await expectJson<Task & { createdBy: string }>(
        await owner.get(`/api/task/${created.id}`),
      );
      expect(viaRest).toMatchObject({
        title,
        createdBy: world.users.owner.id,
      });
    } finally {
      await mcp.close();
    }
  }

  // A deleted key no longer opens a session.
  await deleteApiKey(owner, key.id);
  for (const headers of schemes) {
    const response = await world.as("anonymous").post("/api/mcp", {
      headers: { ...headers, Accept: "application/json, text/event-stream" },
      data: { jsonrpc: "2.0", id: 1, method: "tools/list" },
    });
    expect(response.status()).toBe(401);
  }
});

test("whoami over MCP with an API key names the key's owner", async () => {
  // Regression for e2e-bugs/api-notifications.md #9 (fixed): the tools send
  // the key as `Authorization: Bearer <key>`, which get-session now resolves.
  const owner = world.as("owner");
  const key = await createApiKey(owner);
  const mcp = new McpHttpClient(world.as("anonymous"), {
    "x-api-key": key.key,
  });
  try {
    await mcp.initialize();
    const whoami = await mcp.callToolJson<unknown>("whoami", {});
    expect(JSON.stringify(whoami)).toContain(world.users.owner.id);
  } finally {
    await mcp.close();
    await deleteApiKey(owner, key.id);
  }
});
