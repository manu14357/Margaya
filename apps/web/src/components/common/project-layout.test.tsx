import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProjectLayout from "./project-layout";

const navigate = vi.hoisted(() => vi.fn());
const setViewMode = vi.hoisted(() => vi.fn());
const projectSwitch = vi.hoisted(() => ({
  select: (_id: string) => {},
}));

const BOARD_PATH = "/dashboard/workspace/$workspaceId/project/$projectId/board";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
  useLocation: () => ({ pathname: "/board" }),
}));
vi.mock("@/store/user-preferences", () => ({
  useUserPreferencesStore: (
    selector: (state: { setViewMode: typeof setViewMode }) => unknown,
  ) => selector({ setViewMode }),
}));
vi.mock("@/components/common/layout", () => {
  const Layout = ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  );
  Layout.TopBar = ({ place }: { place: ReactNode }) => <div>{place}</div>;
  Layout.Content = ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  );
  return { default: Layout };
});
vi.mock("@/components/common/project-view-tabs", () => ({
  ProjectViewTabs: ({
    onSelectView,
    onSelectSection,
    activeView,
  }: {
    onSelectView: (view: string) => void;
    onSelectSection: (section: { id: string }) => void;
    activeView: string;
  }) => (
    <div data-testid="tabs" data-active={activeView}>
      <button type="button" onClick={() => onSelectView("list")}>
        list
      </button>
      <button type="button" onClick={() => onSelectView("board")}>
        board
      </button>
      <button type="button" onClick={() => onSelectView("gantt")}>
        gantt
      </button>
      <button type="button" onClick={() => onSelectSection({ id: "tasks" })}>
        tasks
      </button>
    </div>
  ),
}));
vi.mock("@/components/common/header/project-crumb-select", () => ({
  default: ({ onSelectProject }: { onSelectProject: (id: string) => void }) => {
    projectSwitch.select = onSelectProject;
    return null;
  },
}));
vi.mock("@/components/ai/ai-summary", () => ({ AiSummaryButton: () => null }));
vi.mock("@/components/archives/project-archived-notice", () => ({
  default: () => null,
}));
vi.mock("@/components/context-panel/panel-primitives", () => ({
  ProjectTile: () => null,
}));
vi.mock("@/components/favorite/favorite-button", () => ({
  default: () => null,
}));
vi.mock("@/components/project/project-lead-badge", () => ({
  default: () => null,
}));
vi.mock("@/components/publication/project-public-badge", () => ({
  default: () => null,
}));
vi.mock("@/components/shared/modals/create-project-modal", () => ({
  default: () => null,
}));
vi.mock("@/hooks/mutations/recent-visit/use-record-visit", () => ({
  useRecordVisit: () => {},
  visitArchiveState: () => undefined,
}));
vi.mock("@/hooks/queries/project/use-get-project", () => ({
  default: () => ({ data: undefined }),
}));
vi.mock("@/hooks/use-project-features", () => ({
  useWorkspaceProjectFeatures: () => () => true,
}));
vi.mock("@/hooks/use-project-sections", () => ({
  useProjectSections: () => ({ sections: [], activeSection: "tasks" }),
}));
vi.mock("@/hooks/use-project-websocket", () => ({
  useProjectWebSocket: () => {},
}));

function renderLayout(activeView: "board" | "list" = "board") {
  render(
    <ProjectLayout projectId="p" workspaceId="w" activeView={activeView}>
      body
    </ProjectLayout>,
  );
}

beforeEach(() => {
  navigate.mockReset();
  setViewMode.mockReset();
});
afterEach(cleanup);

describe("ProjectLayout tabs", () => {
  it("remembers List and opens the existing board URL when List is picked", () => {
    renderLayout();
    fireEvent.click(screen.getByRole("button", { name: "list" }));
    expect(setViewMode).toHaveBeenCalledWith("list");
    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({ to: BOARD_PATH }),
    );
  });

  it("switches back to the board when Board is picked, so it is never a list", () => {
    renderLayout("list");
    fireEvent.click(screen.getByRole("button", { name: "board" }));
    expect(setViewMode).toHaveBeenCalledWith("board");
  });

  it("leaves the choice alone for other tabs and for the Tasks section", () => {
    renderLayout("list");
    fireEvent.click(screen.getByRole("button", { name: "gantt" }));
    fireEvent.click(screen.getByRole("button", { name: "tasks" }));
    expect(setViewMode).not.toHaveBeenCalled();
  });

  it("stays on the list when switching to another project", () => {
    renderLayout("list");
    expect(screen.getByTestId("tabs")).toHaveAttribute("data-active", "list");
    projectSwitch.select("other");
    expect(setViewMode).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({
        to: BOARD_PATH,
        params: { workspaceId: "w", projectId: "other" },
      }),
    );
  });
});
