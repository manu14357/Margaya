import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AnalyticsPage from "./analytics-page";

const state = vi.hoisted(() => ({
  canReadAnalytics: true,
  canReadIntake: true,
  canCreateProjects: true,
  isCheckingPermissions: false,
  projects: [] as Array<Record<string, unknown>>,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canReadAnalytics: () => state.canReadAnalytics,
    canReadIntake: () => state.canReadIntake,
    canCreateProjects: () => state.canCreateProjects,
    isCheckingPermissions: state.isCheckingPermissions,
  }),
}));
vi.mock("@/hooks/queries/project/use-get-projects", () => ({
  default: () => ({ data: state.projects, isLoading: false }),
}));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "ws-1", slug: "acme" } }),
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/components/common/workspace-layout", () => ({
  default: ({
    children,
    headerActions,
  }: {
    children: ReactNode;
    headerActions?: ReactNode;
  }) => (
    <div>
      <div data-testid="header">{headerActions}</div>
      {children}
    </div>
  ),
}));
vi.mock("@/components/common/project-layout", () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/modals/create-project-modal", () => ({
  default: () => null,
}));
vi.mock("./analytics-refresh-button", () => ({
  default: () => <button type="button">refresh</button>,
}));
vi.mock("./analytics-project-select", () => ({
  default: () => <button type="button">projects</button>,
}));
vi.mock("./overview-tab", () => ({ default: () => <p>overview tab</p> }));
vi.mock("./tasks-tab", () => ({ default: () => <p>tasks tab</p> }));
vi.mock("./cycles-tab", () => ({ default: () => <p>cycles tab</p> }));
vi.mock("./modules-tab", () => ({ default: () => <p>modules tab</p> }));
vi.mock("./intake-tab", () => ({ default: () => <p>intake tab</p> }));

const plain = { id: "p1", name: "Web", slug: "WEB", icon: null };
const planned = {
  id: "p2",
  name: "API",
  slug: "API",
  icon: null,
  cyclesEnabled: true,
  modulesEnabled: true,
};
const triaged = {
  id: "p3",
  name: "Support",
  slug: "SUP",
  icon: null,
  intakeEnabled: true,
};

afterEach(() => {
  cleanup();
  state.canReadAnalytics = true;
  state.canReadIntake = true;
  state.canCreateProjects = true;
  state.isCheckingPermissions = false;
  state.projects = [];
});

function renderPage(props: Partial<Parameters<typeof AnalyticsPage>[0]> = {}) {
  const onTabChange = vi.fn();
  render(
    <AnalyticsPage
      scope="workspace"
      workspaceId="ws-1"
      onTabChange={onTabChange}
      {...props}
    />,
  );
  const tabs = screen.queryAllByRole("tab").map((tab) => tab.textContent ?? "");
  return { onTabChange, tabs };
}

describe("AnalyticsPage", () => {
  it("shows Overview and Tasks, and feature tabs only when a project has them", () => {
    state.projects = [plain];
    expect(renderPage().tabs).toEqual([
      "analytics:tabs.overview",
      "analytics:tabs.tasks",
    ]);
    cleanup();

    state.projects = [plain, planned, triaged];
    expect(renderPage().tabs).toEqual([
      "analytics:tabs.overview",
      "analytics:tabs.tasks",
      "analytics:tabs.cycles",
      "analytics:tabs.modules",
      "analytics:tabs.intake",
    ]);
    expect(screen.getByText("overview tab")).toBeInTheDocument();
  });

  it("hides Intake without intake:read", () => {
    state.projects = [triaged];
    state.canReadIntake = false;
    expect(renderPage().tabs).not.toContain("analytics:tabs.intake");
  });

  it("narrows the tabs to the selected projects", () => {
    state.projects = [plain, planned];
    expect(renderPage({ selectedProjectIds: ["p1"] }).tabs).toEqual([
      "analytics:tabs.overview",
      "analytics:tabs.tasks",
    ]);
  });

  it("replaces a hidden tab with the default one", () => {
    state.projects = [plain];
    const { onTabChange } = renderPage({ tab: "cycles" });
    expect(screen.getByText("overview tab")).toBeInTheDocument();
    expect(onTabChange).toHaveBeenCalledWith("overview", { replace: true });
  });

  it("opens project analytics on Tasks, without Overview", () => {
    state.projects = [planned];
    const { tabs } = renderPage({ scope: "project", projectId: "p2" });
    expect(tabs).toEqual([
      "analytics:tabs.tasks",
      "analytics:tabs.cycles",
      "analytics:tabs.modules",
    ]);
    expect(screen.getByText("tasks tab")).toBeInTheDocument();
  });

  it("shows the no-access state without the capability", () => {
    state.projects = [plain];
    state.canReadAnalytics = false;
    const { tabs } = renderPage();
    expect(tabs).toEqual([]);
    expect(
      screen.getByText("analytics:states.noAccessTitle"),
    ).toBeInTheDocument();
    expect(screen.queryByText("refresh")).toBeNull();
  });

  it("waits for the permission check before showing anything", () => {
    state.projects = [plain];
    state.isCheckingPermissions = true;
    state.canReadAnalytics = false;
    renderPage();
    expect(screen.queryByText("analytics:states.noAccessTitle")).toBeNull();
    expect(screen.queryByText("overview tab")).toBeNull();
  });

  it("asks for a first project in an empty workspace", () => {
    renderPage();
    expect(
      screen.getByText("analytics:states.noProjectsTitle"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "analytics:states.newProject" }),
    ).toBeInTheDocument();
  });
});
