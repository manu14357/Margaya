import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InboxSearch } from "@/lib/inbox-search";
import type { InboxNotification } from "@/types/notification";
import InboxPage from "./inbox-page";
import { inboxNotification } from "./inbox-test-fixtures";

const api = vi.hoisted(() => ({
  getInbox: vi.fn(),
  getCounts: vi.fn(),
  update: vi.fn(),
  markAll: vi.fn(),
  navigate: vi.fn(),
  shortcuts: {} as Record<string, () => void>,
}));

vi.mock("@/fetchers/notification/get-inbox", () => ({ default: api.getInbox }));
vi.mock("@/fetchers/notification/get-inbox-counts", () => ({
  default: api.getCounts,
}));
vi.mock("@/fetchers/notification/update-notification-state", () => ({
  default: api.update,
}));
vi.mock("@/fetchers/notification/mark-all-notifications-as-read", () => ({
  default: api.markAll,
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => api.navigate }));
vi.mock("@/hooks/use-keyboard-shortcuts", () => ({
  getModifierKeyText: () => "Ctrl",
  useRegisterShortcuts: ({
    shortcuts,
  }: {
    shortcuts: Record<string, () => void>;
  }) => {
    api.shortcuts = shortcuts;
  },
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("./inbox-preview", () => ({
  default: ({
    notification,
    snoozeSignal,
  }: {
    notification: InboxNotification | null;
    snoozeSignal?: number;
  }) => (
    <div data-testid="preview" data-snooze={snoozeSignal}>
      {notification?.id ?? "none"}
    </div>
  ),
}));
vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  api.shortcuts = {};
});

const pane = (slot: "primary" | "secondary") =>
  document.querySelector(`[data-slot="split-view-${slot}"]`);

function Harness({ initial = {} }: { initial?: InboxSearch }) {
  const [search, setSearch] = useState<InboxSearch>(initial);
  return (
    <>
      <output data-testid="search">{JSON.stringify(search)}</output>
      <InboxPage
        workspaceId="ws"
        search={search}
        onSearchChange={(patch) => setSearch((prev) => ({ ...prev, ...patch }))}
      />
    </>
  );
}

function renderPage(initial?: InboxSearch) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <Harness initial={initial} />
    </QueryClientProvider>,
  );
}

describe("InboxPage", () => {
  it("switches the list query with the tabs", async () => {
    api.getInbox.mockResolvedValue({ items: [], nextCursor: null });
    api.getCounts.mockResolvedValue({ unread: 3, unreadMentions: 1 });
    renderPage();

    await waitFor(() =>
      expect(api.getInbox).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceId: "ws", tab: "all", limit: 50 }),
      ),
    );
    fireEvent.click(
      screen.getByRole("tab", { name: /notifications:inbox\.tabs\.mentions/ }),
    );
    await waitFor(() =>
      expect(api.getInbox).toHaveBeenCalledWith(
        expect.objectContaining({ tab: "mentions" }),
      ),
    );
    expect(screen.getByTestId("search")).toHaveTextContent('"tab":"mentions"');
  });

  it("selects a row, marks it read and previews it", async () => {
    api.getInbox.mockResolvedValue({
      items: [inboxNotification()],
      nextCursor: null,
    });
    api.getCounts.mockResolvedValue({ unread: 1, unreadMentions: 0 });
    api.update.mockResolvedValue({});
    renderPage();

    fireEvent.click(await screen.findByRole("option"));

    expect(screen.getByTestId("search")).toHaveTextContent(
      '"notificationId":"n1"',
    );
    expect(screen.getByTestId("preview")).toHaveTextContent("n1");
    await waitFor(() =>
      expect(api.update).toHaveBeenCalledWith("n1", { action: "read" }),
    );
  });

  it("swaps the list for the reader on narrow screens once a row opens", async () => {
    api.getInbox.mockResolvedValue({
      items: [inboxNotification({ isRead: true })],
      nextCursor: null,
    });
    api.getCounts.mockResolvedValue({ unread: 0, unreadMentions: 0 });
    renderPage();

    await screen.findByRole("option");
    expect(pane("secondary")).toHaveClass("hidden");
    fireEvent.click(screen.getByRole("option"));
    expect(pane("primary")).toHaveClass("hidden");
    expect(pane("secondary")).not.toHaveClass("hidden");
    expect(api.update).not.toHaveBeenCalled();
  });

  it("archives with E and moves the reader to the next row", async () => {
    api.getInbox.mockResolvedValue({
      items: [
        inboxNotification({ id: "n1", isRead: true }),
        inboxNotification({ id: "n2", isRead: true }),
      ],
      nextCursor: null,
    });
    api.getCounts.mockResolvedValue({ unread: 0, unreadMentions: 0 });
    api.update.mockResolvedValue({});
    renderPage({ notificationId: "n1" });

    await screen.findAllByRole("option");
    act(() => api.shortcuts.e());
    await waitFor(() =>
      expect(api.update).toHaveBeenCalledWith("n1", { action: "archive" }),
    );
    expect(screen.getByTestId("search")).toHaveTextContent(
      '"notificationId":"n2"',
    );
  });

  it("opens the reader's snooze menu with S or H", async () => {
    api.getInbox.mockResolvedValue({
      items: [inboxNotification({ isRead: true })],
      nextCursor: null,
    });
    api.getCounts.mockResolvedValue({ unread: 0, unreadMentions: 0 });
    renderPage({ notificationId: "n1" });

    await screen.findByRole("option");
    expect(screen.getByTestId("preview")).toHaveAttribute("data-snooze", "0");
    act(() => api.shortcuts.s());
    act(() => api.shortcuts.h());
    expect(screen.getByTestId("preview")).toHaveAttribute("data-snooze", "2");
  });

  it("points inbox zero on to Your work", async () => {
    api.getInbox.mockResolvedValue({ items: [], nextCursor: null });
    api.getCounts.mockResolvedValue({ unread: 0, unreadMentions: 0 });
    renderPage();

    fireEvent.click(
      await screen.findByRole("button", {
        name: "notifications:inbox.empty.openMyWork",
      }),
    );
    expect(api.navigate).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "/dashboard/workspace/$workspaceId/my-work",
      }),
    );
  });

  it.each([
    [{}, "notifications:inbox.empty.all.title"],
    [{ tab: "mentions" as const }, "notifications:inbox.empty.mentions.title"],
    [{ view: "snoozed" as const }, "notifications:inbox.empty.snoozed.title"],
    [{ view: "archived" as const }, "notifications:inbox.empty.archived.title"],
    [{ unread: true }, "notifications:inbox.empty.unread.title"],
    [
      { types: ["assigned" as const] },
      "notifications:inbox.empty.filtered.title",
    ],
  ])("shows the empty state for %j", async (initial, title) => {
    api.getInbox.mockResolvedValue({ items: [], nextCursor: null });
    api.getCounts.mockResolvedValue({ unread: 0, unreadMentions: 0 });
    renderPage(initial);
    expect(await screen.findByText(title)).toBeInTheDocument();
  });

  it("shows an error with Retry", async () => {
    api.getInbox.mockRejectedValueOnce(new Error("down"));
    api.getCounts.mockResolvedValue({ unread: 0, unreadMentions: 0 });
    renderPage();

    fireEvent.click(
      await screen.findByRole("button", { name: "notifications:inbox.retry" }),
    );
    api.getInbox.mockResolvedValue({ items: [], nextCursor: null });
    expect(
      await screen.findByText("notifications:inbox.empty.all.title"),
    ).toBeInTheDocument();
    expect(api.getInbox).toHaveBeenCalledTimes(2);
  });
});
