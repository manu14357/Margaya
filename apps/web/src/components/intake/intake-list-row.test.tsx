import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import IntakeListRow from "./intake-list-row";
import { intakeItem } from "./intake-test-fixtures";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options?.column
        ? `${key}(${options.column})`
        : options?.date
          ? `${key}(date)`
          : key,
  }),
}));

vi.mock("@/lib/format", () => ({
  formatRelativeTime: () => "2 hours ago",
  formatDate: () => "Mon, Oct 5",
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderRow(item = intakeItem(), selected = false) {
  const onSelect = vi.fn();
  render(
    <ul>
      <IntakeListRow item={item} selected={selected} onSelect={onSelect} />
    </ul>,
  );
  return { onSelect };
}

describe("IntakeListRow", () => {
  it("shows the key, title, submitter and when it was sent", () => {
    renderRow();
    expect(screen.getByText("WEB-42")).toBeInTheDocument();
    expect(screen.getByText("Export fails on Safari")).toBeInTheDocument();
    expect(screen.getByText("Ana")).toBeInTheDocument();
    expect(screen.getByText("2 hours ago")).toBeInTheDocument();
  });

  it("hides the status badge for pending requests", () => {
    renderRow();
    expect(screen.queryByText("intake:status.pending.label")).toBeNull();
  });

  it("says until when a snoozed request sleeps", () => {
    renderRow(
      intakeItem({
        status: "snoozed",
        snoozedUntil: "2999-10-05T00:00:00.000Z",
      }),
    );
    expect(screen.getByText("intake:status.snoozed.label")).toBeInTheDocument();
    expect(
      screen.getByText("intake:status.snoozedUntil(date)"),
    ).toBeInTheDocument();
  });

  it("names the column an accepted request went to", () => {
    renderRow(
      intakeItem({
        status: "accepted",
        task: { columnName: "To Do", group: "unstarted" },
      }),
    );
    expect(
      screen.getByText("intake:list.acceptedInto(To Do)"),
    ).toBeInTheDocument();
    cleanup();
    renderRow(
      intakeItem({
        status: "accepted",
        task: { columnName: null, group: "backlog" },
      }),
    );
    expect(
      screen.getByText("intake:list.acceptedIntoBacklog"),
    ).toBeInTheDocument();
  });

  it("marks the selected row and reports clicks", () => {
    const { onSelect } = renderRow(intakeItem(), true);
    const row = screen.getByRole("button");
    expect(row).toHaveAttribute("aria-current", "true");
    fireEvent.click(row);
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: "item-1" }),
    );
  });

  it("falls back to someone for deleted requesters", () => {
    renderRow(intakeItem({ submittedBy: null }));
    expect(screen.getByText("common:people.someone")).toBeInTheDocument();
  });
});
