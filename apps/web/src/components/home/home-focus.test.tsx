import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import HomeFocus from "./home-focus";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    className,
    style,
  }: {
    children: ReactNode;
    to: string;
    className?: string;
    style?: React.CSSProperties;
  }) => (
    <a href={to} className={className} style={style}>
      {children}
    </a>
  ),
}));

const useInboxCounts = vi.fn();
vi.mock("@/hooks/queries/notification/use-inbox-counts", () => ({
  default: () => useInboxCounts(),
}));
const useMyWorkSummary = vi.fn();
vi.mock("@/hooks/queries/task-query/use-my-work-summary", () => ({
  useMyWorkSummary: () => useMyWorkSummary(),
}));

const summary = {
  counts: { assignedOpen: 3, overdue: 0 },
  groups: {
    total: 3,
    backlog: 0,
    unstarted: 3,
    started: 0,
    completed: 0,
    cancelled: 0,
  },
};

function work(overrides: Record<string, unknown> = {}) {
  return {
    summary,
    isLoading: false,
    isUnavailable: false,
    refetch: vi.fn(),
    ...overrides,
  };
}

const TRY_AGAIN = "common:states.error.tryAgain";

afterEach(cleanup);

describe("HomeFocus", () => {
  it("says Caught up only when the inbox really loaded with nothing unread", () => {
    useInboxCounts.mockReturnValue({ data: { unread: 0 }, isLoading: false });
    useMyWorkSummary.mockReturnValue(work());
    render(<HomeFocus workspaceId="w" />);

    expect(screen.getByText("home:focus.caughtUp")).toBeInTheDocument();
    expect(screen.queryByText("home:focus.loadError")).toBeNull();
  });

  it("shows an error with a retry, not Caught up, when the inbox count fails", () => {
    const refetch = vi.fn();
    useInboxCounts.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    });
    useMyWorkSummary.mockReturnValue(work());
    render(<HomeFocus workspaceId="w" />);

    expect(screen.queryByText("home:focus.caughtUp")).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent("home:focus.loadError");

    const retry = screen.getByRole("button", { name: TRY_AGAIN });
    // A button inside the tile's link would be invalid and would also navigate.
    expect(retry.closest("a")).toBeNull();
    fireEvent.click(retry);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("keeps showing the last count when a later refresh fails", () => {
    useInboxCounts.mockReturnValue({
      data: { unread: 4 },
      isLoading: false,
      isError: true,
    });
    useMyWorkSummary.mockReturnValue(work());
    render(<HomeFocus workspaceId="w" />);

    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: TRY_AGAIN })).toBeNull();
  });

  it("shows no error while the inbox count is still loading", () => {
    useInboxCounts.mockReturnValue({ data: undefined, isLoading: true });
    useMyWorkSummary.mockReturnValue(work());
    render(<HomeFocus workspaceId="w" />);

    expect(screen.queryByText("home:focus.caughtUp")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows an error, not 0 open, when Your work's counts fail", () => {
    const refetch = vi.fn();
    useInboxCounts.mockReturnValue({ data: { unread: 0 }, isLoading: false });
    useMyWorkSummary.mockReturnValue(
      work({
        isUnavailable: true,
        refetch,
        summary: { ...summary, counts: { assignedOpen: 0, overdue: 0 } },
      }),
    );
    render(<HomeFocus workspaceId="w" />);

    expect(screen.queryByText("home:focus.openCaption")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: TRY_AGAIN }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
