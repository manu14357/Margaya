import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth-client", () => ({ authClient: {} }));

const {
  isWorkspaceMembersPath,
  projectSettingsFromPath,
  settingsAreaFromPath,
} = await import("./settings-nav");

describe("settingsAreaFromPath", () => {
  it.each([
    ["/dashboard/settings/account/information", "account"],
    ["/dashboard/settings/workspace/roles", "workspace"],
    ["/dashboard/settings/workspace/webhooks/abc", "workspace"],
    // Members keeps its workspace URL but is a workspace setting.
    ["/dashboard/workspace/ws-1/members", "workspace"],
    ["/dashboard/settings/projects/p-1/workflow", "project"],
    ["/dashboard/settings/instance/users", "instance"],
  ])("%s is in %s", (path, area) => {
    expect(settingsAreaFromPath(path)).toBe(area);
  });

  it("knows the members page only by its exact path", () => {
    expect(isWorkspaceMembersPath("/dashboard/workspace/ws-1/members")).toBe(
      true,
    );
    expect(
      isWorkspaceMembersPath("/dashboard/workspace/ws-1/members/extra"),
    ).toBe(false);
    expect(isWorkspaceMembersPath("/dashboard/workspace/ws-1/projects")).toBe(
      false,
    );
  });
});

describe("projectSettingsFromPath", () => {
  it("reads the project and page, defaulting to General", () => {
    expect(
      projectSettingsFromPath("/dashboard/settings/projects/p-1/integrations"),
    ).toEqual({ projectId: "p-1", segment: "integrations" });
    expect(projectSettingsFromPath("/dashboard/settings/projects/p-1")).toEqual(
      { projectId: "p-1", segment: "general" },
    );
  });
});
