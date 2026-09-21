import { afterEach, describe, expect, it, vi } from "vitest";
import { formatTaskKey, taskUrl } from "./task-key";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("formatTaskKey", () => {
  it("upper-cases the project slug", () => {
    expect(formatTaskKey("web", 12)).toBe("WEB-12");
    expect(formatTaskKey("OPS", 3)).toBe("OPS-3");
  });

  it("falls back to 0 without a number, like the API snapshots", () => {
    expect(formatTaskKey("web", null)).toBe("WEB-0");
  });
});

describe("taskUrl", () => {
  it("uses the given project id and the configured app URL", () => {
    vi.stubEnv("VITE_APP_URL", "https://margaya.example");
    expect(
      taskUrl({ workspaceId: "ws-1", projectId: "proj-2", taskId: "task-3" }),
    ).toBe(
      "https://margaya.example/dashboard/workspace/ws-1/project/proj-2/task/task-3",
    );
  });

  it("falls back to the current origin", () => {
    vi.stubEnv("VITE_APP_URL", "");
    expect(
      taskUrl({ workspaceId: "ws-1", projectId: "proj-2", taskId: "task-3" }),
    ).toBe(
      `${window.location.protocol}//${window.location.host}/dashboard/workspace/ws-1/project/proj-2/task/task-3`,
    );
  });
});
