import { describe, expect, it } from "vitest";
import {
  ACCESS_MARKER,
  areasOf,
  decodeScope,
  encodeScope,
  PROJECTS_MARKER,
  projectScopedWorkspaceRouteAllowed,
  readOnlyKeyAllows,
} from "../../../apps/api/src/api-key/scope";

describe("API key scopes", () => {
  it("stores nothing for full, unlimited access", () => {
    expect(encodeScope({ access: "full" })).toBeNull();
    expect(decodeScope(null)).toEqual({
      access: "full",
      permissions: null,
      projectIds: null,
      readOnly: false,
    });
  });

  it("round-trips a read-only key limited to projects", () => {
    const stored = encodeScope({ access: "read", projectIds: ["p1", "p1"] });
    expect(stored?.[ACCESS_MARKER]).toEqual(["read"]);
    expect(stored?.[PROJECTS_MARKER]).toEqual(["p1"]);
    expect(stored?.task).toEqual(["read"]);
    const decoded = decodeScope(stored);
    expect(decoded.readOnly).toBe(true);
    expect(decoded.projectIds).toEqual(["p1"]);
    // Markers never reach the permission check.
    expect(decoded.permissions).not.toHaveProperty(ACCESS_MARKER);
    expect(decoded.permissions).not.toHaveProperty(PROJECTS_MARKER);
  });

  it("keeps full access with only a project limit", () => {
    const decoded = decodeScope(
      encodeScope({ access: "full", projectIds: ["p1"] }),
    );
    expect(decoded.permissions).toBeNull();
    expect(decoded.projectIds).toEqual(["p1"]);
  });

  it("maps custom areas to their actions and back", () => {
    const stored = encodeScope({
      access: "custom",
      areas: { task: "write", project: "read" },
    });
    expect(stored?.task).toEqual(
      expect.arrayContaining(["create", "read", "update", "delete"]),
    );
    expect(stored?.project).toEqual(["read"]);
    expect(stored?.label).toBeUndefined();
    expect(areasOf(decodeScope(stored).permissions)).toEqual({
      task: "write",
      project: "read",
    });
  });

  it("reads older permission-only keys as custom", () => {
    expect(decodeScope({ project: ["read"] })).toMatchObject({
      access: "custom",
      permissions: { project: ["read"] },
      readOnly: false,
    });
  });

  it("lets read-only keys read and query, nothing else", () => {
    expect(readOnlyKeyAllows("GET", "/api/project")).toBe(true);
    expect(readOnlyKeyAllows("POST", "/api/task-query")).toBe(true);
    expect(readOnlyKeyAllows("POST", "/api/task/abc")).toBe(false);
    expect(readOnlyKeyAllows("DELETE", "/api/project/abc")).toBe(false);
  });

  it("allows only narrowing workspace routes for project keys", () => {
    expect(projectScopedWorkspaceRouteAllowed("GET", "/api/project")).toBe(
      true,
    );
    expect(projectScopedWorkspaceRouteAllowed("GET", "/api/search")).toBe(
      false,
    );
  });
});
