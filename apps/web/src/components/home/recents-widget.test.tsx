import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FileText } from "lucide-react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerEntityLink } from "@/lib/entity-links";
import RecentsWidget from "./recents-widget";

const mocks = vi.hoisted(() => ({
  calls: [] as Array<{ entityType?: string; limit?: number }>,
  visits: [] as unknown[],
  refetch: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
}));
vi.mock("@/hooks/queries/recent-visit/use-get-recent-visits", () => ({
  default: (args: { entityType?: string; limit?: number }) => {
    mocks.calls.push(args);
    return {
      data: mocks.visits,
      isLoading: false,
      isError: false,
      refetch: mocks.refetch,
      dataUpdatedAt: 0,
    };
  },
}));
vi.mock("@/hooks/use-task-assignees", () => ({
  useTaskAssignees: () => [],
}));

const taskVisit = {
  id: "rv-1",
  workspaceId: "ws-1",
  projectId: "p-1",
  entityType: "task",
  entityId: "t-1",
  visitedAt: new Date().toISOString(),
  entity: {
    type: "task",
    id: "t-1",
    name: "Fix login",
    key: "web-12",
    icon: null,
    projectId: "p-1",
    projectName: "Web",
    isArchived: false,
    feature: null,
    details: { group: "started", priority: "high", assigneeIds: [] },
  },
};

const onOpenTask = vi.fn();

function renderWidget() {
  return render(<RecentsWidget workspaceId="ws-1" onOpenTask={onOpenTask} />);
}

const lastCall = () => mocks.calls[mocks.calls.length - 1];

beforeEach(() => {
  mocks.calls = [];
  mocks.visits = [];
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("RecentsWidget", () => {
  it("requests the entity type of the selected tab", () => {
    renderWidget();
    expect(lastCall()).toMatchObject({ entityType: undefined, limit: 20 });

    fireEvent.click(
      screen.getByRole("tab", { name: "home:recents.tabs.tasks" }),
    );
    expect(lastCall()).toMatchObject({ entityType: "task" });

    fireEvent.click(
      screen.getByRole("tab", { name: "home:recents.tabs.projects" }),
    );
    expect(lastCall()).toMatchObject({ entityType: "project" });
    expect(screen.getByText("home:recents.empty.projects")).toBeInTheDocument();
  });

  it("shows the Pages tab only once pages have an entity link", () => {
    renderWidget();
    expect(
      screen.queryByRole("tab", { name: "home:recents.tabs.pages" }),
    ).toBeNull();
    cleanup();

    const restore = registerEntityLink("page", {
      icon: () => FileText,
      path: (entity, workspaceId) =>
        `/dashboard/workspace/${workspaceId}/pages/${entity.id}`,
    });
    try {
      renderWidget();
      fireEvent.click(
        screen.getByRole("tab", { name: "home:recents.tabs.pages" }),
      );
      expect(lastCall()).toMatchObject({ entityType: "page" });
      expect(screen.getByText("home:recents.empty.pages")).toBeInTheDocument();
    } finally {
      restore();
    }
  });

  it("shows the per-tab empty copy", () => {
    renderWidget();
    expect(screen.getByText("home:recents.empty.all")).toBeInTheDocument();
  });

  it("opens a task in the side sheet, keeping the full page as its href", () => {
    mocks.visits = [taskVisit];
    renderWidget();

    const row = screen.getByText("Fix login").closest("a");
    expect(row).toHaveAttribute(
      "href",
      "/dashboard/workspace/ws-1/project/p-1/task/t-1",
    );
    expect(screen.getByText("web-12")).toBeInTheDocument();

    fireEvent.click(row as HTMLAnchorElement);
    expect(onOpenTask).toHaveBeenCalledWith("t-1", "p-1");

    // A modified click is left to the browser (new tab).
    fireEvent.click(row as HTMLAnchorElement, { ctrlKey: true });
    expect(onOpenTask).toHaveBeenCalledTimes(1);
  });

  it("shows five rows until asked for more", () => {
    mocks.visits = Array.from({ length: 7 }, (_, index) => ({
      ...taskVisit,
      id: `rv-${index}`,
      entity: { ...taskVisit.entity, id: `t-${index}`, name: `Task ${index}` },
    }));
    renderWidget();
    expect(screen.getAllByText(/^Task \d$/)).toHaveLength(5);

    fireEvent.click(
      screen.getByRole("button", { name: "home:recents.showMore" }),
    );
    expect(screen.getAllByText(/^Task \d$/)).toHaveLength(7);
  });

  it("skips entity types without a web link", () => {
    mocks.visits = [
      {
        ...taskVisit,
        id: "rv-2",
        entityType: "page",
        entity: { ...taskVisit.entity, type: "page", name: "Unlinked page" },
      },
    ];
    renderWidget();
    expect(screen.queryByText("Unlinked page")).toBeNull();
    expect(screen.getByText("home:recents.empty.all")).toBeInTheDocument();
  });
});
