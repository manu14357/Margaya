import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskExport } from "@/types/task-export";
import { ExportHistory } from "./export-history";

const m = vi.hoisted(() => ({
  rows: [] as unknown[],
  useTaskExports: vi.fn(),
  download: vi.fn(),
  remove: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/lib/i18n", () => ({ i18n: { t: (key: string) => key } }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options && "count" in options
        ? `${key}:${options.count}:${options.format ?? ""}:${options.name ?? ""}`
        : key,
  }),
}));
vi.mock("@/hooks/use-current-minute", () => ({
  useCurrentMinute: () => new Date("2026-10-06T12:00:00.000Z"),
}));
vi.mock("@/hooks/queries/task-export/use-task-exports", () => ({
  useTaskExports: m.useTaskExports,
}));
vi.mock("@/hooks/mutations/task-export/use-download-task-export", () => ({
  useDownloadTaskExport: () => ({ mutate: m.download }),
}));
vi.mock("@/hooks/mutations/task-export/use-delete-task-export", () => ({
  useDeleteTaskExport: () => ({ mutate: m.remove, isPending: false }),
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: m.success, error: m.error },
}));

function exportRow(overrides: Partial<TaskExport> = {}): TaskExport {
  return {
    id: "exp-1",
    workspaceId: "ws-1",
    kind: "tasks",
    format: "csv",
    projectIds: ["p-1"],
    projects: [{ id: "p-1", name: "Website", slug: "WEB" }],
    splitByProject: false,
    includeArchived: true,
    includeFiles: false,
    status: "completed",
    error: null,
    taskCount: 42,
    fileCount: null,
    missingFileCount: null,
    fileName: "acme-tasks.csv",
    contentType: "text/csv",
    sizeBytes: 2048,
    requestedBy: { id: "u-1", name: "Ada Lovelace", image: null },
    createdAt: "2026-10-06T11:00:00.000Z",
    startedAt: "2026-10-06T11:00:01.000Z",
    completedAt: "2026-10-06T11:00:05.000Z",
    expiresAt: "2026-10-13T11:00:05.000Z",
    downloadable: true,
    ...overrides,
  };
}

function renderHistory(canSeeAll = false) {
  return render(
    <ExportHistory
      workspaceId="ws-1"
      canSeeAll={canSeeAll}
      retentionDays={7}
    />,
  );
}

describe("ExportHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.rows = [exportRow()];
    m.useTaskExports.mockImplementation(() => ({
      data: { pages: [{ items: m.rows, nextCursor: null }] },
      isLoading: false,
      isError: false,
      hasNextPage: false,
    }));
  });
  afterEach(cleanup);

  it("shows the caller's exports without the scope toggle or requester", () => {
    renderHistory(false);

    expect(m.useTaskExports).toHaveBeenLastCalledWith("ws-1", "mine");
    expect(
      screen.queryByText("settings:workspaceExports.history.all"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        "settings:workspaceExports.history.columns.requestedBy",
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "settings:workspaceExports.history.summaryProjects:1:settings:workspaceExports.formats.csv:Website",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("settings:workspaceExports.status.completed"),
    ).toBeInTheDocument();
  });

  it("lets admins switch to everyone's exports with the requester column", () => {
    renderHistory(true);

    fireEvent.click(screen.getByText("settings:workspaceExports.history.all"));

    expect(m.useTaskExports).toHaveBeenLastCalledWith("ws-1", "all");
    expect(
      screen.getByText("settings:workspaceExports.history.columns.requestedBy"),
    ).toBeInTheDocument();
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
  });

  it("names whole-workspace exports and reports their files", () => {
    m.rows = [
      exportRow({
        kind: "workspace",
        format: "json",
        includeFiles: true,
        fileCount: 12,
        missingFileCount: 3,
      }),
      exportRow({
        id: "exp-2",
        kind: "workspace",
        format: "json",
        includeFiles: false,
        fileCount: 0,
        missingFileCount: 0,
      }),
    ];
    renderHistory(true);

    expect(
      screen.getAllByText("settings:workspaceExports.history.summaryWorkspace"),
    ).toHaveLength(2);
    expect(
      screen.getByText("settings:workspaceExports.history.fileCount:12::"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("settings:workspaceExports.history.missingFiles:3::"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("settings:workspaceExports.history.withoutFiles"),
    ).toBeInTheDocument();
  });

  it("downloads ready files only, under the row's file name", () => {
    m.rows = [
      exportRow(),
      exportRow({
        id: "exp-2",
        status: "processing",
        expiresAt: null,
        fileName: null,
        downloadable: false,
      }),
      exportRow({
        id: "exp-3",
        expiresAt: "2026-10-06T11:59:00.000Z",
        downloadable: false,
      }),
    ];
    renderHistory();

    const downloads = screen.getAllByLabelText(
      "settings:workspaceExports.history.downloadAria",
    );
    expect(downloads).toHaveLength(1);
    fireEvent.click(downloads[0]);
    expect(m.download).toHaveBeenCalledWith(
      { id: "exp-1", fileName: "acme-tasks.csv", sizeBytes: 2048 },
      expect.any(Object),
    );
    // The third row's window has passed: it reads as expired.
    expect(
      screen.getByText("settings:workspaceExports.status.expired"),
    ).toBeInTheDocument();
  });

  it("deletes after confirmation, and not while processing", () => {
    m.rows = [
      exportRow(),
      exportRow({ id: "exp-2", status: "processing", downloadable: false }),
    ];
    renderHistory();

    const deletes = screen.getAllByLabelText(
      "settings:workspaceExports.history.deleteAria",
    );
    expect(deletes[1]).toBeDisabled();
    fireEvent.click(deletes[0]);
    expect(
      screen.getByText("settings:workspaceExports.history.deleteTitle"),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings:workspaceExports.history.delete",
      }),
    );
    expect(m.remove).toHaveBeenCalledWith("exp-1", expect.any(Object));
  });

  it("shows the empty state with the retention period", () => {
    m.rows = [];
    renderHistory();

    expect(
      screen.getByText("settings:workspaceExports.history.empty"),
    ).toBeInTheDocument();
  });
});
