import { beforeEach, describe, expect, it, vi } from "vitest";
import deleteNotificationWorkspaceRule from "./delete-notification-workspace-rule";
import getNotificationPreferences from "./get-notification-preferences";
import updateNotificationPreferences from "./update-notification-preferences";
import upsertNotificationWorkspaceRule from "./upsert-notification-workspace-rule";

const { root, rule } = vi.hoisted(() => ({
  root: { $get: vi.fn(), $put: vi.fn() },
  rule: { $put: vi.fn(), $delete: vi.fn() },
}));
vi.mock("@margaya/libs", () => ({
  client: {
    "notification-preferences": {
      ...root,
      workspaces: { ":workspaceId": rule },
    },
  },
}));

const prefs = { emailEnabled: true, workspaces: [] };

beforeEach(() => {
  for (const fn of [root.$get, root.$put, rule.$put, rule.$delete]) {
    fn.mockReset();
  }
});

describe("notification preference fetchers", () => {
  it("reads and updates the global preferences", async () => {
    root.$get.mockResolvedValueOnce(Response.json(prefs));
    await expect(getNotificationPreferences()).resolves.toEqual(prefs);

    root.$put.mockResolvedValueOnce(Response.json(prefs));
    await updateNotificationPreferences({ emailEnabled: true });
    expect(root.$put).toHaveBeenCalledWith({ json: { emailEnabled: true } });
  });

  it("upserts and deletes a workspace rule", async () => {
    const body = {
      isActive: true,
      emailEnabled: true,
      ntfyEnabled: false,
      gotifyEnabled: false,
      webhookEnabled: false,
      projectMode: "all" as const,
    };
    rule.$put.mockResolvedValueOnce(Response.json(prefs));
    await upsertNotificationWorkspaceRule("w1", body);
    expect(rule.$put).toHaveBeenCalledWith({
      param: { workspaceId: "w1" },
      json: body,
    });

    rule.$delete.mockResolvedValueOnce(Response.json(prefs));
    await expect(deleteNotificationWorkspaceRule("w1")).resolves.toEqual(prefs);
    expect(rule.$delete).toHaveBeenCalledWith({ param: { workspaceId: "w1" } });
  });

  it("throws HttpError with the status and body text", async () => {
    root.$put.mockResolvedValueOnce(
      new Response("webhookUrl: required", { status: 400 }),
    );
    await expect(
      updateNotificationPreferences({ webhookEnabled: true }),
    ).rejects.toMatchObject({ status: 400, message: "webhookUrl: required" });
  });
});
