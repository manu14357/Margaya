import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Timeline } from "@/components/ui/timeline";
import { automationOf } from "./automation-activity";
import Activity from "./index";

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (key: string, options?: { count?: number; to?: string }) =>
      options?.count !== undefined
        ? `${key}:${options.count}${options.to ? `:${options.to}` : ""}`
        : key,
  }),
}));

vi.mock("@/lib/i18n/domain", () => ({
  getStatusLabel: (status: string) => `status(${status})`,
  getPriorityLabel: (priority: string) => priority,
}));

vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "ws-1" } }),
}));

vi.mock("@/hooks/queries/workspace-users/use-get-workspace-users", () => ({
  default: () => ({
    data: [{ user: { id: "user-1", name: "Ada", image: null } }],
  }),
}));

afterEach(() => cleanup());

function renderActivity(
  type: string,
  eventData: Record<string, unknown>,
  userId: string | null = null,
) {
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
          userId,
          taskId: "task-1",
        }}
      />
    </Timeline>,
  );
}

describe("automation activity entries", () => {
  it("shows the Automation actor for an auto-archive", () => {
    renderActivity("archived", {
      automation: { rule: "auto_archive", months: 3 },
    });
    expect(screen.getByText("activity:automation.actor")).toBeInTheDocument();
    expect(
      screen.getByText("activity:automation.archived:3"),
    ).toBeInTheDocument();
  });

  it("names the column an auto-close moved the task to", () => {
    renderActivity("status_changed", {
      oldStatus: "to-do",
      newStatus: "wont-do",
      automation: { rule: "auto_close", months: 6 },
    });
    expect(screen.getByText("activity:automation.actor")).toBeInTheDocument();
    expect(
      screen.getByText("activity:automation.closed:6:status(wont-do)"),
    ).toBeInTheDocument();
  });

  it("shows a cycle rollover as Automation", () => {
    renderActivity("cycle_changed", {
      oldCycleId: "c1",
      oldCycleName: "Sprint 1",
      newCycleId: "c2",
      newCycleName: "Sprint 2",
      automation: { rule: "cycle_rollover" },
    });
    expect(screen.getByText("activity:automation.actor")).toBeInTheDocument();
    expect(
      screen.getByText("activity:automation.rolledOver"),
    ).toBeInTheDocument();
  });

  it("leaves rows without a marker unchanged", () => {
    renderActivity("archived", {});
    expect(screen.queryByText("activity:automation.actor")).toBeNull();
    expect(screen.getByText("activity:archived")).toBeInTheDocument();
  });
});

describe("automationOf", () => {
  it("needs no user and a known rule", () => {
    expect(
      automationOf({
        userId: null,
        eventData: { automation: { rule: "auto_archive", months: 2 } },
      }),
    ).toEqual({ rule: "auto_archive", months: 2 });
    expect(
      automationOf({
        userId: "user-1",
        eventData: { automation: { rule: "auto_archive", months: 2 } },
      }),
    ).toBeNull();
    expect(
      automationOf({
        userId: null,
        eventData: { automation: { rule: "other", months: 2 } },
      }),
    ).toBeNull();
    expect(automationOf({ userId: null, eventData: null })).toBeNull();
  });
});
