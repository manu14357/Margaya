import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ArchivedTaskBanner from "./archived-task-banner";

const m = vi.hoisted(() => ({
  canUpdate: true,
  mutate: vi.fn(),
  success: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canUpdateTasks: () => m.canUpdate,
    isCheckingPermissions: false,
  }),
}));
vi.mock("@/hooks/mutations/task/use-archive-task", () => ({
  useArchiveTask: () => ({ mutate: m.mutate, isPending: false }),
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: m.success, error: vi.fn() },
}));

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      {children}
    </QueryClientProvider>
  );
}

const archived = {
  id: "task-1",
  projectId: "project-1",
  archivedAt: "2026-08-01T00:00:00.000Z",
};

beforeEach(() => {
  m.canUpdate = true;
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ArchivedTaskBanner", () => {
  it("renders nothing for a task that is not archived", () => {
    const { container } = render(
      <ArchivedTaskBanner task={{ ...archived, archivedAt: null }} />,
      { wrapper },
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("offers Restore only with task:update", () => {
    m.canUpdate = false;
    render(<ArchivedTaskBanner task={archived} />, { wrapper });
    expect(screen.getByText("tasks:archivedBanner.message")).toBeTruthy();
    expect(screen.queryByText("tasks:archivedBanner.restore")).toBeNull();
  });

  it("restores the task to its column", () => {
    m.mutate.mockImplementation((_variables, options) =>
      options?.onSuccess?.(),
    );
    render(<ArchivedTaskBanner task={archived} />, { wrapper });
    fireEvent.click(screen.getByText("tasks:archivedBanner.restore"));
    expect(m.mutate).toHaveBeenCalledWith(
      { taskId: "task-1", projectId: "project-1", archived: false },
      expect.any(Object),
    );
    expect(m.success).toHaveBeenCalledWith(
      "workspace:archives.toast.taskRestored",
    );
  });
});
