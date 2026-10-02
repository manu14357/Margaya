import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MemberProfileOverview from "./member-profile-overview";

const m = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  activityProps: [] as Array<Record<string, unknown>>,
  summaryArgs: [] as unknown[][],
}));

vi.mock("@/lib/i18n", () => ({
  i18n: { t: (key: string) => key, language: "en-US" },
}));
vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/hooks/queries/task-query/use-member-work-summary", () => ({
  useMemberWorkSummary: (...args: unknown[]) => {
    m.summaryArgs.push(args);
    return m.state;
  },
}));
vi.mock("@/components/my-work/my-work-activity", () => ({
  default: (props: Record<string, unknown>) => {
    m.activityProps.push(props);
    return <div data-testid="activity" />;
  },
}));

function summary() {
  return {
    counts: { assignedOpen: 5, overdue: 2, completed30: 7, created30: 3 },
    groups: {
      total: 13,
      backlog: 1,
      unstarted: 2,
      started: 2,
      completed: 7,
      cancelled: 1,
    },
    priorities: [
      { priority: "urgent", count: 1 },
      { priority: "high", count: 4 },
      { priority: "medium", count: 0 },
      { priority: "low", count: 0 },
      { priority: "no-priority", count: 0 },
    ],
  };
}

afterEach(cleanup);
beforeEach(() => {
  m.activityProps = [];
  m.summaryArgs = [];
  m.state = {
    summary: summary(),
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  };
});

function tile(label: string) {
  const button = screen.getByText(label).closest("button");
  if (!button) throw new Error(`no tile ${label}`);
  return button;
}

describe("MemberProfileOverview", () => {
  it("shows the member's numbers and their activity", () => {
    render(
      <MemberProfileOverview
        workspaceId="w1"
        userId="ben"
        onOpenAssigned={vi.fn()}
      />,
    );

    expect(m.summaryArgs[0]).toEqual(["w1", "ben"]);
    expect(tile("team:profile.stats.assignedOpen").textContent).toContain("5");
    expect(tile("team:profile.stats.overdue").textContent).toContain("2");
    expect(tile("team:profile.stats.completed30").textContent).toContain("7");
    // Created work is not an assigned list: the tile is not a button.
    const created = screen.getByText("team:profile.stats.created30");
    expect(created.closest("button")).toBeNull();
    expect(created.parentElement?.textContent).toContain("3");

    expect(m.activityProps[0]).toMatchObject({
      workspaceId: "w1",
      userId: "ben",
      emptyLabel: "team:profile.emptyActivity",
    });
  });

  it("opens the assigned list with the tile's or row's filters", () => {
    const onOpenAssigned = vi.fn();
    render(
      <MemberProfileOverview
        workspaceId="w1"
        userId="ben"
        onOpenAssigned={onOpenAssigned}
      />,
    );

    fireEvent.click(tile("team:profile.stats.overdue"));
    expect(onOpenAssigned).toHaveBeenLastCalledWith("overdue");
    fireEvent.click(tile("team:profile.stats.assignedOpen"));
    expect(onOpenAssigned).toHaveBeenLastCalledWith("open");

    const high = screen
      .getAllByRole("button")
      .find((button) => button.textContent?.endsWith("4"));
    if (!high) throw new Error("no priority row");
    fireEvent.click(high);
    expect(onOpenAssigned).toHaveBeenLastCalledWith("priority:high");
  });

  it("offers a retry when the numbers fail to load", () => {
    const refetch = vi.fn();
    m.state = { ...m.state, isError: true, refetch };
    render(
      <MemberProfileOverview
        workspaceId="w1"
        userId="ben"
        onOpenAssigned={vi.fn()}
      />,
    );
    expect(screen.getByText("team:profile.statsError")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "team:profile.retry" }));
    expect(refetch).toHaveBeenCalled();
  });
});
