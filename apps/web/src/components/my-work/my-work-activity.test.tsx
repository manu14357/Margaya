import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MyWorkActivity from "./my-work-activity";

const m = vi.hoisted(() => ({
  query: {} as Record<string, unknown>,
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, params }: { children: ReactNode; params: object }) => (
    <a href={`/task/${JSON.stringify(params)}`}>{children}</a>
  ),
}));
vi.mock("@/components/activity", () => ({
  default: ({ activity }: { activity: { type: string } }) => (
    <span>{`activity:${activity.type}`}</span>
  ),
}));
vi.mock("@/hooks/queries/activity/use-my-activity", () => ({
  default: () => m.query,
}));

const task = { id: "t1", key: "WEB-7", title: "Fix login", projectId: "p1" };

function item(id: string, type: string, content: string | null = null) {
  return {
    id,
    type,
    content,
    taskId: "t1",
    userId: "me",
    createdAt: "2026-09-30T10:00:00.000Z",
    task,
  };
}

afterEach(cleanup);
beforeEach(() => {
  m.query = {
    isLoading: false,
    isError: false,
    hasNextPage: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
    data: { pages: [{ items: [], nextCursor: null }] },
  };
});

describe("MyWorkActivity", () => {
  it("lists each entry under a link to its task", () => {
    m.query.data = {
      pages: [
        {
          items: [
            item("a1", "status_changed"),
            item("a2", "comment", "Looks good\nsecond line"),
          ],
          nextCursor: null,
        },
      ],
    };
    render(<MyWorkActivity workspaceId="w1" />);

    const list = screen.getByRole("list", {
      name: "myWork:workload.recentActivity",
    });
    expect(list.querySelectorAll("li")).toHaveLength(2);
    expect(
      screen.getAllByRole("link", { name: "WEB-7 Fix login" }),
    ).toHaveLength(2);
    expect(screen.getByText("activity:status_changed")).toBeInTheDocument();
    expect(screen.getByText("Looks good")).toBeInTheDocument();
    expect(screen.queryByText(/second line/)).toBeNull();
    expect(
      screen.queryByRole("button", { name: "myWork:activity.showMore" }),
    ).toBeNull();
  });

  it("loads the next page on demand", () => {
    m.query.data = {
      pages: [{ items: [item("a1", "status_changed")], nextCursor: "c" }],
    };
    m.query.hasNextPage = true;
    render(<MyWorkActivity workspaceId="w1" />);

    fireEvent.click(
      screen.getByRole("button", { name: "myWork:activity.showMore" }),
    );

    expect(m.query.fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it("says when there is nothing yet, and offers a retry on errors", () => {
    const { unmount } = render(<MyWorkActivity workspaceId="w1" />);
    expect(screen.getByText("myWork:empty.activity")).toBeInTheDocument();
    unmount();

    m.query.isError = true;
    render(<MyWorkActivity workspaceId="w1" />);
    fireEvent.click(screen.getByRole("button", { name: "myWork:retry" }));
    expect(m.query.refetch).toHaveBeenCalledTimes(1);
  });
});
