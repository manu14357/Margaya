import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../apps/api/src/index";
import { mockAnonymousSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";

// Teams have no screens and projects can't be assigned to one, so the feature
// is off: the provider serves no team routes and the API docs list none. The
// tables stay for existing installations.

const TEAM_ROUTES = [
  ["POST", "create-team"],
  ["GET", "list-teams"],
  ["POST", "update-team"],
  ["POST", "remove-team"],
  ["POST", "add-team-member"],
  ["POST", "remove-team-member"],
  ["GET", "list-team-members"],
  ["GET", "list-user-teams"],
  ["POST", "set-active-team"],
] as const;

describe("API integration: Teams are off", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    mockAnonymousSession();
  });

  it("serves none of the provider's team routes", async () => {
    const { app } = createApp();
    for (const [method, name] of TEAM_ROUTES) {
      const response = await app.request(`/api/auth/organization/${name}`, {
        method,
        headers: { "content-type": "application/json" },
        ...(method === "POST" ? { body: "{}" } : {}),
      });
      expect(response.status, name).toBe(404);
    }

    // The same route answers differently when it exists: the plugin is on.
    const known = await app.request("/api/auth/organization/list", {
      method: "GET",
    });
    expect(known.status).not.toBe(404);
  });

  it("documents no team route or field", async () => {
    const { app } = createApp();
    const response = await app.request("/api/openapi");
    expect(response.status).toBe(200);
    const document = (await response.json()) as {
      paths: Record<string, unknown>;
    };
    const paths = Object.keys(document.paths);
    expect(paths.some((path) => path.includes("/organization/"))).toBe(true);
    expect(paths.filter((path) => /team/i.test(path))).toEqual([]);
    const organizationDocs = JSON.stringify(
      Object.entries(document.paths).filter(([path]) =>
        path.includes("/auth/organization/"),
      ),
    );
    expect(organizationDocs).not.toMatch(/teamId/);
  });
});
