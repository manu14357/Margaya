import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Timeline } from "@/components/ui/timeline";
import Activity from "./index";

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (key: string, options?: { name?: string }) =>
      options?.name ? `${key}:${options.name}` : key,
  }),
}));

vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "ws-1" } }),
}));

vi.mock("@/hooks/queries/workspace-users/use-get-workspace-users", () => ({
  default: () => ({
    data: [
      { user: { id: "user-1", name: "Ada", image: null } },
      { user: { id: "user-2", name: "Grace Hopper", image: null } },
    ],
  }),
}));

afterEach(() => cleanup());

function renderActivity(type: string, eventData: Record<string, unknown>) {
  render(
    <Timeline>
      <Activity
        step={1}
        activity={{
          id: "activity-1",
          type,
          content: null,
          eventData,
          createdAt: "2026-03-01T10:00:00.000Z",
          userId: "user-1",
          taskId: "task-1",
        }}
      />
    </Timeline>,
  );
}

describe("assignee activity entries", () => {
  it("names the person who was unassigned, by their current name", () => {
    renderActivity("unassigned", {
      oldAssigneeId: "user-2",
      oldAssignee: "Grace H.",
      isSelfUnassigned: false,
    });
    expect(
      screen.getByText("activity:unassignedUser:Grace Hopper"),
    ).toBeInTheDocument();
  });

  it("falls back to the stored name for someone no longer in the workspace", () => {
    renderActivity("unassigned", {
      oldAssigneeId: "user-9",
      oldAssignee: "Former Person",
      isSelfUnassigned: false,
    });
    expect(
      screen.getByText("activity:unassignedUser:Former Person"),
    ).toBeInTheDocument();
  });

  it("says when people unassigned themselves", () => {
    renderActivity("unassigned", {
      oldAssigneeId: "user-1",
      oldAssignee: "Ada",
      isSelfUnassigned: true,
    });
    expect(screen.getByText("activity:unassignedSelf")).toBeInTheDocument();
  });

  it("keeps the old wording for rows without a person", () => {
    renderActivity("unassigned", {});
    expect(screen.getByText("activity:unassigned")).toBeInTheDocument();
  });

  it("names each added person", () => {
    renderActivity("assignee_changed", {
      newAssigneeId: "user-2",
      newAssignee: "Grace Hopper",
      isSelfAssigned: false,
    });
    expect(
      screen.getByText("activity:assignedTo:Grace Hopper"),
    ).toBeInTheDocument();
  });
});
