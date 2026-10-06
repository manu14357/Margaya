import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { IterationCw, Layers } from "lucide-react";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { SidebarProvider } from "@/components/ui/sidebar";
import { registerProjectSection } from "@/lib/project-sections";
import { NavProjects } from "./nav-projects";

const m = vi.hoisted(() => ({
  navigate: vi.fn(),
  pathname: "/dashboard/workspace/w1/project/p1/board",
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => m.navigate,
  useParams: () => ({ workspaceId: "w1", projectId: "p1" }),
  useLocation: ({ select }: { select: (location: object) => unknown }) =>
    select({ pathname: m.pathname }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "w1" } }),
}));
vi.mock("@/hooks/queries/project/use-get-projects", () => ({
  default: () => ({
    data: [
      {
        id: "p1",
        name: "Website",
        icon: null,
        slug: "WEB",
        cyclesEnabled: true,
      },
      {
        id: "p2",
        name: "Mobile",
        icon: null,
        slug: "MOB",
        cyclesEnabled: false,
      },
    ],
  }),
}));
vi.mock("@/hooks/mutations/project/use-delete-project", () => ({
  default: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/hooks/mutations/project/use-reorder-projects", () => ({
  default: () => vi.fn(),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canCreateProjects: () => true,
    canDeleteProjects: () => false,
    canUpdateProjects: () => true,
    canShareProjects: () => false,
    canReadAnalytics: () => false,
    isCheckingPermissions: false,
  }),
}));
vi.mock("@/components/favorite/favorite-button", () => ({
  default: () => null,
}));
vi.mock("./shared/modals/create-project-modal", () => ({
  default: () => null,
}));

// Cycles' availability flag decides whether its section can show at all.
vi.mock("@/constants/project-features", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/constants/project-features")>();
  return {
    ...actual,
    isProjectFeatureEnabled: (
      project: Record<string, unknown> | undefined,
      key: string,
    ) => Boolean(project?.[`${key}Enabled`]),
  };
});

let unregister: Array<() => void> = [];
beforeAll(() => {
  unregister = [
    registerProjectSection({
      id: "cycles",
      labelKey: "navigation:projectNav.cycles",
      icon: IterationCw,
      feature: "cycles",
      segment: "cycles",
    }),
    registerProjectSection({
      id: "modules",
      labelKey: "navigation:projectNav.modules",
      icon: Layers,
      feature: "modules",
      segment: "modules",
    }),
  ];
});
afterAll(() => {
  for (const off of unregister) off();
});
afterEach(() => {
  cleanup();
  m.navigate.mockClear();
});

function renderTree(filter?: string) {
  render(
    <SidebarProvider>
      <NavProjects filter={filter} />
    </SidebarProvider>,
  );
}

describe("NavProjects", () => {
  it("expands the current project to its enabled sections only", () => {
    renderTree();
    expect(screen.getByText("navigation:projectNav.tasks")).toBeInTheDocument();
    expect(
      screen.getByText("navigation:projectNav.cycles"),
    ).toBeInTheDocument();
    // Modules is off for every project.
    expect(screen.queryByText("navigation:projectNav.modules")).toBeNull();
    expect(
      screen.getByText("navigation:projectNav.tasks").closest("[data-active]"),
    ).toHaveAttribute("data-active", "true");
  });

  it("opens a section of the project", () => {
    renderTree();
    fireEvent.click(screen.getByText("navigation:projectNav.cycles"));
    expect(m.navigate).toHaveBeenCalledWith({
      to: "/dashboard/workspace/w1/project/p1/cycles",
    });
  });

  it("filters projects by name", () => {
    renderTree("mob");
    expect(screen.getByText("Mobile")).toBeInTheDocument();
    expect(screen.queryByText("Website")).toBeNull();
  });

  it("opens a project's board from its row", () => {
    renderTree();
    fireEvent.click(screen.getByText("Mobile"));
    expect(m.navigate).toHaveBeenCalledWith({
      to: "/dashboard/workspace/$workspaceId/project/$projectId/board",
      params: { workspaceId: "w1", projectId: "p2" },
    });
  });
});
