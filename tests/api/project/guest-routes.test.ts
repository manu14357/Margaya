import { describe, expect, it } from "vitest";
import { guestWorkspaceRouteAllowed } from "../../../apps/api/src/project/guest-routes";

const allowed = (method: string, path: string, projectId?: string) =>
  guestWorkspaceRouteAllowed(method, path, { projectId });

describe("guestWorkspaceRouteAllowed", () => {
  it("lets through the routes that narrow to the guest's projects", () => {
    for (const [method, path] of [
      ["GET", "/api/project"],
      ["GET", "/api/project/"],
      ["POST", "/api/task-query"],
      ["GET", "/api/search"],
      ["GET", "/api/notification/inbox"],
      ["GET", "/api/notification/counts"],
      ["GET", "/api/activity/mine"],
      ["GET", "/api/time-entry/running"],
      ["GET", "/api/task/by-key/w1/WEB-1"],
      ["GET", "/api/favorite"],
      ["POST", "/api/favorite"],
      ["PUT", "/api/favorite/reorder"],
      ["DELETE", "/api/favorite/f1"],
      ["DELETE", "/api/favorite/entity/task/t1"],
      ["GET", "/api/recent-visit"],
      ["POST", "/api/recent-visit"],
      ["GET", "/api/view/built-in"],
      ["GET", "/api/workspace/w1/settings"],
      ["GET", "/api/ai/availability"],
    ] as const) {
      expect(allowed(method, path), `${method} ${path}`).toBe(true);
    }
  });

  it("fails closed on anything else, new routes included", () => {
    for (const [method, path] of [
      ["POST", "/api/project"],
      ["PUT", "/api/project/reorder"],
      ["PATCH", "/api/workspace/w1/settings"],
      ["GET", "/api/workspace/w1/members"],
      ["GET", "/api/workspace/w1/deletion"],
      ["GET", "/api/label/workspace/w1"],
      ["GET", "/api/analytics/overview"],
      ["GET", "/api/audit-log"],
      ["GET", "/api/task-export"],
      ["POST", "/api/task-export"],
      ["GET", "/api/sticky"],
      ["GET", "/api/home/preferences"],
      ["GET", "/api/some-new-route"],
      ["GET", "/api/projects"],
      ["GET", "/api/project/extra"],
      ["DELETE", "/api/recent-visit"],
    ] as const) {
      expect(allowed(method, path), `${method} ${path}`).toBe(false);
    }
  });

  it("lists views only of a named project, which the route then checks", () => {
    expect(allowed("GET", "/api/view")).toBe(false);
    expect(allowed("GET", "/api/view", "p1")).toBe(true);
    expect(allowed("POST", "/api/view", "p1")).toBe(false);
  });
});
