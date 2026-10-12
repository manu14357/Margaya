import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

function json(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

function createBody(workspaceId: string, slug: string) {
  return { name: `Project ${slug}`, workspaceId, icon: "Layout", slug };
}

function updateBody(slug: string) {
  return {
    name: `Project ${slug}`,
    icon: "Layout",
    slug,
    description: "",
    isPublic: false,
  };
}

describe("API integration: project key uniqueness", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("refuses a duplicate key in the same workspace, ignoring case", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    await createProjectFixture({
      workspaceId: owner.workspace.id,
      slug: "web",
    });
    mockAuthenticatedSession(owner.user);
    const { app } = createApp();

    const response = await app.request(
      "/api/project",
      json("POST", createBody(owner.workspace.id, "WEB")),
    );

    expect(response.status).toBe(409);
    expect(await response.text()).toBe(
      "A project with the key WEB already exists in this workspace",
    );
  });

  it("allows the same key in another workspace", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const other = await createWorkspaceMember({ role: "owner" });
    await createProjectFixture({
      workspaceId: other.workspace.id,
      slug: "web",
    });
    mockAuthenticatedSession(owner.user);
    const { app } = createApp();

    const response = await app.request(
      "/api/project",
      json("POST", createBody(owner.workspace.id, "web")),
    );

    expect(response.status).toBe(200);
  });

  it("refuses an update to another project's key but keeps its own", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    await createProjectFixture({
      workspaceId: owner.workspace.id,
      slug: "web",
    });
    const { project } = await createProjectFixture({
      workspaceId: owner.workspace.id,
      slug: "api",
    });
    mockAuthenticatedSession(owner.user);
    const { app } = createApp();

    const duplicate = await app.request(
      `/api/project/${project.id}`,
      json("PUT", updateBody("Web")),
    );
    expect(duplicate.status).toBe(409);

    const unchanged = await app.request(
      `/api/project/${project.id}`,
      json("PUT", updateBody("API")),
    );
    expect(unchanged.status).toBe(200);
    expect(await unchanged.json()).toMatchObject({ slug: "API" });
  });
});
