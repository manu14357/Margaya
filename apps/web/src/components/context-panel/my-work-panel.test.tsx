import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SidebarProvider } from "@/components/ui/sidebar";
import { MyWorkPanel } from "./my-work-panel";

const m = vi.hoisted(() => ({
  pathname: "/dashboard/workspace/w1/my-work",
  search: {} as Record<string, unknown>,
  count: 0,
  navigate: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => m.navigate,
  useLocation: ({ select }: { select: (location: object) => unknown }) =>
    select({ pathname: m.pathname, search: m.search }),
}));
vi.mock("@/hooks/queries/ai/use-agents", () => ({
  useAgentUserIds: () => new Set<string>(),
  useAgents: () => ({ data: [] }),
  useAgentApprovals: () => ({ data: [] }),
}));

vi.mock("@/hooks/queries/ai/use-ai", () => ({
  useAiAvailability: () => ({ available: false, canUse: false }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));
vi.mock("@/hooks/queries/task-draft/use-task-draft-count", () => ({
  useTaskDraftCount: () => ({ data: m.count }),
}));

function renderPanel() {
  render(
    <SidebarProvider>
      <MyWorkPanel workspaceId="w1" />
    </SidebarProvider>,
  );
}

beforeEach(() => {
  m.pathname = "/dashboard/workspace/w1/my-work";
  m.search = {};
  m.count = 0;
});
afterEach(() => {
  cleanup();
  m.navigate.mockClear();
});

describe("MyWorkPanel", () => {
  it("lists the Your work tabs and marks the current one", () => {
    m.search = { tab: "assigned" };
    renderPanel();
    const assigned = screen
      .getByText("myWork:tabs.assigned")
      .closest("[data-active]");
    expect(assigned).toHaveAttribute("data-active", "true");
    expect(
      screen.getByText("myWork:tabs.summary").closest("[data-active]"),
    ).toHaveAttribute("data-active", "false");
  });

  it("opens a tab through the route's search", () => {
    renderPanel();
    fireEvent.click(screen.getByText("myWork:tabs.created"));
    expect(m.navigate).toHaveBeenCalledWith({
      to: "/dashboard/workspace/$workspaceId/my-work",
      params: { workspaceId: "w1" },
      search: { tab: "created" },
    });
  });

  it("hides Drafts without drafts", () => {
    renderPanel();
    expect(screen.queryByText("navigation:sidebar.drafts")).toBeNull();
  });

  it("shows the drafts count, capped at 99+", () => {
    m.count = 4;
    const { unmount } = render(
      <SidebarProvider>
        <MyWorkPanel workspaceId="w1" />
      </SidebarProvider>,
    );
    expect(screen.getByText("navigation:sidebar.drafts")).toBeTruthy();
    expect(screen.getByText("4")).toBeTruthy();
    unmount();
    m.count = 120;
    renderPanel();
    expect(screen.getByText("99+")).toBeTruthy();
  });

  it("keeps Drafts while its page is open, even when empty", () => {
    m.pathname = "/dashboard/workspace/w1/drafts";
    renderPanel();
    expect(screen.getByText("navigation:sidebar.drafts")).toBeTruthy();
  });
});
