import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  getTaskExport: vi.fn(),
  saveTaskExport: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock("i18next", () => ({
  default: {
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
  },
}));
vi.mock("@/fetchers/task-export/get-task-export", () => ({
  default: m.getTaskExport,
}));
vi.mock("@/lib/task-export/download", () => ({
  saveTaskExport: m.saveTaskExport,
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: m.success, error: m.error },
}));

import {
  createTaskExportMessageHandler,
  handleTaskExportUserMessage,
} from "./realtime";

function setup() {
  const notify = { ready: vi.fn(), failed: vi.fn() };
  const queryClient = { invalidateQueries: vi.fn() };
  const handle = createTaskExportMessageHandler(notify);
  return { notify, queryClient, handle };
}

describe("createTaskExportMessageHandler", () => {
  it("ignores other message types", () => {
    const { handle, queryClient, notify } = setup();
    expect(handle(queryClient, { type: "FAVORITES_UPDATED" })).toBe(false);
    expect(queryClient.invalidateQueries).not.toHaveBeenCalled();
    expect(notify.ready).not.toHaveBeenCalled();
  });

  it("refreshes the workspace history and the row on every status", () => {
    const { handle, queryClient, notify } = setup();
    for (const status of ["queued", "processing", "expired", "deleted"]) {
      expect(
        handle(queryClient, {
          type: "EXPORT_UPDATED",
          workspaceId: "ws-1",
          exportId: "exp-1",
          status,
        }),
      ).toBe(true);
    }
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["task-exports", "ws-1"],
    });
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["task-export", "exp-1"],
    });
    expect(notify.ready).not.toHaveBeenCalled();
    expect(notify.failed).not.toHaveBeenCalled();
  });

  it("notifies once per export id for completed and failed", () => {
    const { handle, queryClient, notify } = setup();
    const ready = {
      type: "EXPORT_UPDATED",
      workspaceId: "ws-1",
      exportId: "exp-1",
      status: "completed",
    };
    handle(queryClient, ready);
    handle(queryClient, ready);
    handle(queryClient, { ...ready, exportId: "exp-2", status: "failed" });
    handle(queryClient, { ...ready, exportId: "exp-2", status: "failed" });

    expect(notify.ready).toHaveBeenCalledTimes(1);
    expect(notify.ready).toHaveBeenCalledWith("exp-1");
    expect(notify.failed).toHaveBeenCalledTimes(1);
    expect(notify.failed).toHaveBeenCalledWith("exp-2");
  });
});

describe("handleTaskExportUserMessage toasts", () => {
  const queryClient = { invalidateQueries: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("offers a Download action that saves the file under its name", async () => {
    m.getTaskExport.mockResolvedValue({
      id: "exp-ready",
      fileName: "acme-tasks.csv",
      sizeBytes: 2048,
      error: null,
    });
    m.saveTaskExport.mockResolvedValue("acme-tasks.csv");

    handleTaskExportUserMessage(queryClient, {
      type: "EXPORT_UPDATED",
      workspaceId: "ws-1",
      exportId: "exp-ready",
      status: "completed",
    });

    await vi.waitFor(() => expect(m.success).toHaveBeenCalledTimes(1));
    const [title, options] = m.success.mock.calls[0];
    expect(title).toBe("settings:workspaceExports.toast.ready");
    expect(options.description).toBe("acme-tasks.csv");
    expect(options.action.label).toBe(
      "settings:workspaceExports.toast.download",
    );
    options.action.onClick();
    expect(m.saveTaskExport).toHaveBeenCalledWith({
      id: "exp-ready",
      fileName: "acme-tasks.csv",
      sizeBytes: 2048,
    });
  });

  it("shows the failure reason from the refetched row", async () => {
    m.getTaskExport.mockResolvedValue({
      id: "exp-failed",
      fileName: null,
      error: "This export has more than 50,000 tasks",
    });

    handleTaskExportUserMessage(queryClient, {
      type: "EXPORT_UPDATED",
      workspaceId: "ws-1",
      exportId: "exp-failed",
      status: "failed",
    });

    await vi.waitFor(() => expect(m.error).toHaveBeenCalledTimes(1));
    expect(m.error.mock.calls[0][0]).toContain(
      "This export has more than 50,000 tasks",
    );
  });
});
