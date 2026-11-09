import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { inboxNotification } from "@/components/inbox/inbox-test-fixtures";
import NotificationDropdown from "./notification-dropdown";

const api = vi.hoisted(() => ({
  getInbox: vi.fn(),
  getCounts: vi.fn(),
  clear: vi.fn(),
  update: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("@/fetchers/notification/get-inbox", () => ({ default: api.getInbox }));
vi.mock("@/fetchers/notification/get-inbox-counts", () => ({
  default: api.getCounts,
}));
vi.mock("@/fetchers/notification/clear-notifications", () => ({
  default: api.clear,
}));
vi.mock("@/fetchers/notification/update-notification-state", () => ({
  default: api.update,
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => api.navigate }));
vi.mock("@/hooks/use-keyboard-shortcuts", () => ({
  getModifierKeyText: () => "Ctrl",
  useRegisterShortcuts: vi.fn(),
}));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "ws", name: "Acme" } }),
}));
vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderDropdown() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <NotificationDropdown />
    </QueryClientProvider>,
  );
}

describe("NotificationDropdown", () => {
  it("reads the active workspace's inbox and badge counts", async () => {
    api.getInbox.mockResolvedValue({
      items: [inboxNotification()],
      nextCursor: null,
    });
    api.getCounts.mockResolvedValue({ unread: 120, unreadMentions: 0 });
    renderDropdown();

    expect(await screen.findByText("99+")).toBeInTheDocument();
    expect(api.getInbox).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws",
        tab: "all",
        view: "inbox",
        limit: 20,
      }),
    );
    expect(api.getCounts).toHaveBeenCalledWith("ws");
  });

  it("opens the full inbox", async () => {
    api.getInbox.mockResolvedValue({
      items: [inboxNotification()],
      nextCursor: null,
    });
    api.getCounts.mockResolvedValue({ unread: 1, unreadMentions: 0 });
    renderDropdown();

    fireEvent.click(
      screen.getByRole("button", { name: /navigation:notifications/ }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", {
        name: "notifications:inbox.dropdown.openInbox",
      }),
    );
    expect(api.navigate).toHaveBeenCalledWith({
      to: "/dashboard/workspace/$workspaceId/inbox",
      params: { workspaceId: "ws" },
    });
  });

  it("clears only this workspace", async () => {
    api.getInbox.mockResolvedValue({
      items: [inboxNotification()],
      nextCursor: null,
    });
    api.getCounts.mockResolvedValue({ unread: 1, unreadMentions: 0 });
    api.clear.mockResolvedValue({ success: true, updatedCount: 1 });
    renderDropdown();

    await screen.findByText("1");
    fireEvent.click(
      screen.getByRole("button", { name: /navigation:notifications/ }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", {
        name: "notifications:clearAll",
      }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "common:actions.clearAll" }),
    );
    await waitFor(() => expect(api.clear).toHaveBeenCalledWith("ws"));
  });

  it("opens a declined request in its intake queue", async () => {
    api.getInbox.mockResolvedValue({
      items: [
        inboxNotification({
          type: "intake_declined",
          eventData: {
            intakeItemId: "item-1",
            taskTitle: "Ship it",
            taskKey: "web-12",
            projectId: "project-1",
            workspaceId: "ws",
            note: null,
          },
        }),
      ],
      nextCursor: null,
    });
    api.getCounts.mockResolvedValue({ unread: 1, unreadMentions: 0 });
    api.update.mockResolvedValue({});
    renderDropdown();

    fireEvent.click(
      screen.getByRole("button", { name: /navigation:notifications/ }),
    );
    fireEvent.click(
      await screen.findByText("notifications:events.intake_declined.title"),
    );
    expect(api.navigate).toHaveBeenCalledWith({
      to: "/dashboard/workspace/$workspaceId/project/$projectId/intake",
      params: { workspaceId: "ws", projectId: "project-1" },
      search: { tab: "closed", item: "item-1" },
    });
  });

  it("opens an agent's question in the Agent Desk, not its task", async () => {
    api.getInbox.mockResolvedValue({
      items: [
        inboxNotification({
          type: "ai_agent_reply",
          resourceType: "task",
          resourceId: "task-1",
          eventData: {
            runId: "run-1",
            agentId: "agent-1",
            agentName: "Spec writer",
            needsInput: true,
            projectId: "project-1",
          },
        }),
      ],
      nextCursor: null,
    });
    api.getCounts.mockResolvedValue({ unread: 1, unreadMentions: 0 });
    api.update.mockResolvedValue({});
    renderDropdown();

    fireEvent.click(
      screen.getByRole("button", { name: /navigation:notifications/ }),
    );
    fireEvent.click(
      await screen.findByText("ai:agents.needsInput.notificationTitle"),
    );
    expect(api.navigate).toHaveBeenCalledWith({
      to: "/dashboard/workspace/$workspaceId/agents",
      params: { workspaceId: "ws" },
      search: { runId: "run-1" },
    });
  });

  it("shows an agent's written answer as plain text", async () => {
    api.getInbox.mockResolvedValue({
      items: [
        inboxNotification({
          type: "ai_agent_reply",
          task: null,
          resourceType: "workspace",
          resourceId: "ws",
          content:
            "Created a standup page **2026-11-05**: [2026-11-05](/dashboard/workspace/ws/project/p1/pages/pg1).",
          eventData: { runId: "run-1", agentName: "Standup" },
        }),
      ],
      nextCursor: null,
    });
    api.getCounts.mockResolvedValue({ unread: 1, unreadMentions: 0 });
    renderDropdown();

    fireEvent.click(
      screen.getByRole("button", { name: /navigation:notifications/ }),
    );
    expect(
      await screen.findByText("Created a standup page 2026-11-05: 2026-11-05."),
    ).toBeInTheDocument();
  });

  it("shows the caught-up state when the inbox is empty", async () => {
    api.getInbox.mockResolvedValue({ items: [], nextCursor: null });
    api.getCounts.mockResolvedValue({ unread: 0, unreadMentions: 0 });
    renderDropdown();

    fireEvent.click(
      screen.getByRole("button", { name: /navigation:notifications/ }),
    );
    expect(
      await screen.findByText("notifications:inbox.dropdown.emptyTitle"),
    ).toBeInTheDocument();
  });
});
