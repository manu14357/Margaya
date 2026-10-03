import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PublicBoard, PublicTaskRow } from "@/types/public-board";
import PublicTaskCard from "./public-task-card";

afterEach(cleanup);

vi.mock("@/lib/format", () => ({
  formatDateShort: () => "Oct 9",
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key} ${JSON.stringify(values)}` : key,
  }),
}));

const board: PublicBoard["board"] = {
  layouts: ["board", "list"],
  defaultLayout: "board",
  comments: true,
  reactions: true,
  votes: true,
  requests: false,
  guestsAllowed: false,
  showAssignees: false,
  showBacklog: false,
};

const row: PublicTaskRow = {
  id: "t1",
  number: 12,
  key: "WEB-12",
  title: "Dark mode",
  status: "to-do",
  priority: "high",
  dueDate: null,
  startDate: null,
  labels: [{ name: "ui", color: "#22c55e" }],
  assignees: [{ name: "Ana Lima", image: null }],
  counts: {
    votesUp: 7,
    votesDown: 1,
    reactions: [
      { emoji: "heart", count: 3 },
      { emoji: "eyes", count: 0 },
    ],
    comments: 2,
  },
};

function renderCard(
  overrides: Partial<PublicBoard["board"]> = {},
  rowOverrides: Partial<PublicTaskRow> = {},
) {
  const onOpen = vi.fn();
  render(
    <PublicTaskCard
      row={{ ...row, ...rowOverrides }}
      board={{ ...board, ...overrides }}
      isCompleted={false}
      onOpen={onOpen}
    />,
  );
  return onOpen;
}

describe("PublicTaskCard", () => {
  it("shows the key, title, labels and the count chips for features that are on", () => {
    renderCard();
    expect(screen.getByText("WEB-12")).toBeInTheDocument();
    expect(screen.getByText("Dark mode")).toBeInTheDocument();
    expect(screen.getByText("ui")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText("🧡")).toBeInTheDocument();
    // A zero-count reaction is not shown.
    expect(screen.queryByText("👀")).not.toBeInTheDocument();
    expect(
      screen.getByText('publicProject:card.comments {"count":2}'),
    ).toBeInTheDocument();
  });

  it("hides chips whose feature is off", () => {
    renderCard({ votes: false, reactions: false, comments: false });
    expect(screen.queryByText("7")).not.toBeInTheDocument();
    expect(screen.queryByText("🧡")).not.toBeInTheDocument();
    expect(
      screen.queryByText('publicProject:card.comments {"count":2}'),
    ).not.toBeInTheDocument();
  });

  it("shows the vote chip at zero but no comment chip at zero", () => {
    renderCard({}, { counts: { votesUp: 0, votesDown: 0, comments: 0 } });
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(
      screen.queryByText(/publicProject:card\.comments/),
    ).not.toBeInTheDocument();
  });

  it("shows assignees only when the board shows them", () => {
    renderCard();
    expect(screen.queryByText("AL")).not.toBeInTheDocument();
    cleanup();
    renderCard({ showAssignees: true });
    expect(screen.getAllByText("AL").length).toBeGreaterThan(0);
  });

  it("opens the peek with the task number", () => {
    const onOpen = renderCard();
    fireEvent.click(
      screen.getByRole("button", {
        name: 'publicProject:taskCard.viewDetailsAria {"title":"Dark mode"}',
      }),
    );
    expect(onOpen).toHaveBeenCalledWith(12);
  });
});
