import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ArchiveTab } from "@/lib/archives";
import ArchivesView from "./archives-view";

type Item = Record<string, unknown>;

const m = vi.hoisted(() => ({
  summary: undefined as Record<string, number | null> | undefined,
  items: {} as Record<string, Item[]>,
  archiveCycle: vi.fn(),
  archiveModule: vi.fn(),
  archiveProject: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));
vi.mock("@/hooks/queries/archive/use-archive-summary", () => ({
  useArchiveSummary: () => ({ data: m.summary }),
}));
vi.mock("@/hooks/queries/project/use-get-projects", () => ({
  default: () => ({ data: [{ id: "p1", name: "Web" }] }),
}));
vi.mock("./archived-tasks-tab", () => ({
  default: () => <div data-testid="tasks-tab" />,
}));
vi.mock("@/hooks/queries/archive/use-archived-entities", () => ({
  useArchivedEntities: ({ type }: { type: string }) => ({
    isPending: false,
    isError: false,
    data: { pages: [{ items: m.items[type] ?? [] }] },
    hasNextPage: false,
  }),
}));
vi.mock("@/hooks/mutations/cycle/use-archive-cycle", () => ({
  useArchiveCycle: () => ({ mutateAsync: m.archiveCycle }),
}));
vi.mock("@/hooks/mutations/module/use-archive-module", () => ({
  useArchiveModule: () => ({ mutateAsync: m.archiveModule }),
}));
vi.mock("@/hooks/mutations/project/use-archive-project", () => ({
  useArchiveProject: () => ({ mutateAsync: m.archiveProject }),
}));
vi.mock("@/hooks/mutations/cycle/use-delete-cycle", () => ({
  useDeleteCycle: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/hooks/mutations/module/use-delete-module", () => ({
  useDeleteModule: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/hooks/mutations/project/use-delete-project", () => ({
  default: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: m.success, error: m.error },
}));

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      {children}
    </QueryClientProvider>
  );
}

function cycle(overrides: Item = {}): Item {
  return {
    type: "cycle",
    id: "c1",
    name: "Sprint 4",
    projectId: "p1",
    projectName: "Web",
    projectSlug: "web",
    projectIcon: null,
    archivedAt: "2026-08-01T00:00:00.000Z",
    details: { startDate: "2026-07-01", endDate: "2026-07-14" },
    canRestore: true,
    canDelete: true,
    ...overrides,
  };
}

function renderView(tab: ArchiveTab, projectId?: string) {
  return render(
    <ArchivesView
      workspaceId="w1"
      projectId={projectId}
      tab={tab}
      onSearchChange={vi.fn()}
    />,
    { wrapper },
  );
}

beforeEach(() => {
  m.summary = { tasks: 2, cycles: 1, modules: 0, projects: 0 };
  m.items = {};
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ArchivesView", () => {
  it("hides tabs the summary returns null for", () => {
    m.summary = { tasks: 2, cycles: null, modules: 0, projects: 0 };
    renderView("tasks");
    expect(screen.getByText("workspace:archives.tabs.tasks")).toBeTruthy();
    expect(screen.queryByText("workspace:archives.tabs.cycles")).toBeNull();
    expect(screen.getByText("workspace:archives.tabs.modules")).toBeTruthy();
    expect(screen.getByTestId("tasks-tab")).toBeTruthy();
  });

  it("lists projects only in the workspace scope", () => {
    renderView("tasks");
    expect(screen.getByText("workspace:archives.tabs.projects")).toBeTruthy();
    cleanup();
    m.summary = { tasks: 2, cycles: 1, modules: 0, projects: 3 };
    renderView("tasks", "p1");
    expect(screen.queryByText("workspace:archives.tabs.projects")).toBeNull();
  });

  it("falls back to Tasks for a hidden tab", () => {
    m.summary = { tasks: 2, cycles: null, modules: 0, projects: 0 };
    renderView("cycles");
    expect(screen.getByTestId("tasks-tab")).toBeTruthy();
  });

  it("restores through the owner's route and removes the row", async () => {
    m.items = { cycle: [cycle()] };
    m.archiveCycle.mockResolvedValue({});
    renderView("cycles");
    fireEvent.click(
      screen.getByRole("button", {
        name: "workspace:archives.actions.restoreAria",
      }),
    );
    expect(m.archiveCycle).toHaveBeenCalledWith({
      cycleId: "c1",
      projectId: "p1",
      archive: false,
    });
    await waitFor(() => expect(screen.queryByText("Sprint 4")).toBeNull());
    expect(m.success).toHaveBeenCalledWith(
      "workspace:archives.toast.cycleRestored",
    );
  });

  it("brings the row back when restoring fails", async () => {
    m.items = { cycle: [cycle()] };
    m.archiveCycle.mockRejectedValue(new Error("nope"));
    renderView("cycles");
    fireEvent.click(
      screen.getByRole("button", {
        name: "workspace:archives.actions.restoreAria",
      }),
    );
    await waitFor(() =>
      expect(m.error).toHaveBeenCalledWith(
        "workspace:archives.toast.restoreError",
      ),
    );
    expect(screen.getByText("Sprint 4")).toBeTruthy();
  });

  it("hides Restore on rows the caller may not restore", () => {
    m.items = { cycle: [cycle({ canRestore: false })] };
    renderView("cycles");
    expect(screen.getByText("Sprint 4")).toBeTruthy();
    expect(
      screen.queryByRole("button", {
        name: "workspace:archives.actions.restoreAria",
      }),
    ).toBeNull();
  });

  it("shows each tab's empty state", () => {
    renderView("modules");
    expect(
      screen.getByText("workspace:archives.empty.modulesTitle"),
    ).toBeTruthy();
    cleanup();
    renderView("projects");
    expect(
      screen.getByText("workspace:archives.empty.projectsTitle"),
    ).toBeTruthy();
  });
});
