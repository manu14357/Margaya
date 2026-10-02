import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import InboxRow from "./inbox-row";
import { inboxNotification } from "./inbox-test-fixtures";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values?.date ? `${key} ${values.date}` : key,
  }),
}));
vi.mock("@/lib/format", () => ({
  formatRelativeTime: () => "2 hours ago",
  formatDate: () => "Sat, Sep 27, 9:00 AM",
  formatDateMedium: () => "Sep 27, 2026",
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderRow(
  overrides: Parameters<typeof inboxNotification>[0] = {},
  view: "inbox" | "snoozed" | "archived" = "inbox",
) {
  const onSelect = vi.fn();
  const onAction = vi.fn();
  const notification = inboxNotification(overrides);
  render(
    <InboxRow
      notification={notification}
      view={view}
      selected={false}
      onSelect={onSelect}
      onAction={onAction}
    />,
  );
  return { notification, onSelect, onAction };
}

describe("InboxRow", () => {
  it("shows the actor, verb, task and comment preview", () => {
    renderRow();
    expect(screen.getByText("Ana Silva")).toBeInTheDocument();
    expect(
      screen.getByText("notifications:inbox.verbs.task_comment"),
    ).toBeInTheDocument();
    expect(screen.getByText("WEB-12")).toBeInTheDocument();
    expect(screen.getByText("Ship it")).toBeInTheDocument();
    expect(screen.getByText("Looks good")).toBeInTheDocument();
    expect(screen.getByText("2 hours ago")).toBeInTheDocument();
  });

  it("marks unread rows with a dot and a strong actor", () => {
    renderRow();
    expect(document.querySelector(".bg-info")).not.toBeNull();
    expect(screen.getByText("Ana Silva")).toHaveClass("font-medium");
    cleanup();
    renderRow({ isRead: true });
    expect(document.querySelector(".bg-info")).toBeNull();
    expect(screen.getByText("Ana Silva")).not.toHaveClass("font-medium");
  });

  it("renders system rows without an actor", () => {
    renderRow({
      type: "due_date_reminder",
      actor: null,
      actorId: null,
      eventData: { taskTitle: "Ship it", leadTimeMinutes: 60 },
    });
    expect(screen.queryByText("Ana Silva")).not.toBeInTheDocument();
    expect(
      screen.getByText("notifications:inbox.verbs.due_date_reminder"),
    ).toBeInTheDocument();
    expect(screen.queryByText("notifications:inbox.someone")).toBeNull();
  });

  it("shows the snooze end in the Snoozed view", () => {
    renderRow(
      { isSnoozed: true, snoozedUntil: "2026-09-27T09:00:00.000Z" },
      "snoozed",
    );
    expect(
      screen.getByText("notifications:inbox.snooze.until Sat, Sep 27, 9:00 AM"),
    ).toBeInTheDocument();
    expect(screen.queryByText("2 hours ago")).toBeNull();
  });

  it("selects on click and on Enter", () => {
    const { notification, onSelect } = renderRow();
    const row = screen.getByRole("option");
    fireEvent.click(row);
    fireEvent.keyDown(row, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(onSelect.mock.calls[0]?.[0]).toBe(notification);
  });

  it("hover actions call the right action without selecting", () => {
    const { notification, onAction, onSelect } = renderRow();
    fireEvent.click(
      screen.getByRole("button", {
        name: "notifications:inbox.actions.markRead",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "notifications:inbox.actions.archive",
      }),
    );
    expect(onAction.mock.calls).toEqual([
      [notification, { action: "read" }],
      [notification, { action: "archive" }],
    ]);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("offers unread and move-to-inbox for read, archived rows", () => {
    const { notification, onAction } = renderRow(
      { isRead: true, archivedAt: "2026-09-26T11:00:00.000Z" },
      "archived",
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "notifications:inbox.actions.markUnread",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "notifications:inbox.actions.unarchive",
      }),
    );
    expect(onAction.mock.calls).toEqual([
      [notification, { action: "unread" }],
      [notification, { action: "unarchive" }],
    ]);
  });
});
