import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Timeline } from "@/components/ui/timeline";
import { useUserPreferencesStore } from "@/store/user-preferences";
import ActivityFeedControls from "./activity-feed-controls";
import Activity from "./index";

const state = vi.hoisted(() => ({
  membersLoading: false,
  membersWorkspaceIds: [] as (string | undefined)[],
  agentWorkspaceIds: [] as (string | undefined)[],
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

// A task opened directly: the active-workspace store has nothing yet.
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: undefined, isLoading: true }),
}));

vi.mock("@/hooks/queries/workspace-users/use-get-workspace-users", () => ({
  default: ({ workspaceId }: { workspaceId?: string }) => {
    state.membersWorkspaceIds.push(workspaceId);
    if (!workspaceId || state.membersLoading) {
      return { data: undefined, isLoading: Boolean(workspaceId) };
    }
    return {
      data: [{ user: { id: "agent-1", name: "Triage Bot", image: null } }],
      isLoading: false,
    };
  },
}));

vi.mock("@/hooks/queries/ai/use-agents", () => ({
  useAgentUserIds: (workspaceId: string | undefined) => {
    state.agentWorkspaceIds.push(workspaceId);
    return new Set(workspaceId ? ["agent-1"] : []);
  },
}));

beforeEach(() => {
  state.membersLoading = false;
  state.membersWorkspaceIds = [];
  state.agentWorkspaceIds = [];
  useUserPreferencesStore.getState().setActivityFilter("all");
});

afterEach(() => cleanup());

function renderCreated(workspaceId?: string) {
  render(
    <Timeline>
      <Activity
        step={1}
        workspaceId={workspaceId}
        activity={{
          id: "activity-1",
          type: "created",
          content: null,
          eventData: { title: "Fix login" },
          createdAt: "2026-03-01T10:00:00.000Z",
          userId: "agent-1",
          taskId: "task-1",
        }}
      />
    </Timeline>,
  );
}

describe("activity actors", () => {
  it("loads members from the feed's workspace when the active one is empty", () => {
    renderCreated("ws-route");
    expect(state.membersWorkspaceIds).toContain("ws-route");
    expect(screen.getByText("Triage Bot")).toBeInTheDocument();
    expect(screen.queryByText("common:people.someone")).toBeNull();
  });

  it("shows a placeholder, not Someone, while members load", () => {
    state.membersLoading = true;
    renderCreated("ws-route");
    expect(screen.getByTestId("activity-actor-loading")).toBeInTheDocument();
    expect(screen.queryByText("common:people.someone")).toBeNull();
  });
});

describe("activity feed controls", () => {
  it("offers Agents from the page's workspace and closes after a pick", async () => {
    render(<ActivityFeedControls workspaceId="ws-route" />);
    expect(state.agentWorkspaceIds).toContain("ws-route");

    fireEvent.click(
      screen.getByRole("button", { name: "activity:feed.label" }),
    );
    expect(
      await screen.findByRole("menuitemradio", {
        name: "ai:agents.activityFilter",
      }),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("menuitemradio", { name: "activity:feed.comments" }),
    );
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(useUserPreferencesStore.getState().activityFilter).toBe("comments");
  });
});
