import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationPreferencesSettings } from "./notification-preferences-settings";

const m = vi.hoisted(() => ({
  workspaces: [] as { id: string; name: string }[],
  pushStatus: undefined as { subscriptions: unknown[] } | undefined,
  upsertRule: vi.fn(),
}));
const updatePreferences = vi.fn();
const preferences = {
  emailAddress: "mina@example.com",
  emailEnabled: false,
  ntfyEnabled: false,
  ntfyConfigured: false,
  ntfyServerUrl: null,
  ntfyTopic: null,
  ntfyTokenConfigured: false,
  maskedNtfyToken: null,
  gotifyEnabled: false,
  gotifyConfigured: false,
  gotifyServerUrl: null,
  gotifyTokenConfigured: false,
  maskedGotifyToken: null,
  webhookEnabled: false,
  webhookConfigured: false,
  webhookUrl: null,
  webhookSecretConfigured: false,
  maskedWebhookSecret: null,
  taskAssignmentEnabled: true,
  taskCommentEnabled: true,
  taskStatusChangeEnabled: true,
  taskUpdateEnabled: true,
  dueDateReminderEnabled: true,
  dueDateReminderLeadTimeMinutes: 1440,
  workspaces: [] as Record<string, unknown>[],
  createdAt: null,
  updatedAt: null,
};

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock(
  "@/hooks/queries/notification-preferences/use-get-notification-preferences",
  () => ({
    default: () => ({
      data: preferences,
      isLoading: false,
    }),
  }),
);

vi.mock("@/components/insight/my-brief-email-setting", () => ({
  default: () => null,
}));
vi.mock("@/hooks/queries/workspace/use-get-workspaces", () => ({
  default: () => ({ data: m.workspaces }),
}));
vi.mock("@/hooks/queries/project/use-get-projects", () => ({
  default: () => ({ data: [] }),
}));

vi.mock(
  "@/hooks/mutations/notification-preferences/use-notification-preferences",
  () => ({
    useUpdateNotificationPreferences: () => ({
      mutateAsync: updatePreferences,
      isPending: false,
    }),
    useUpsertNotificationWorkspaceRule: () => ({ mutateAsync: m.upsertRule }),
    useDeleteNotificationWorkspaceRule: () => ({ mutateAsync: vi.fn() }),
  }),
);

vi.mock("@/components/account/push-notification-card", () => ({
  PushNotificationCard: () => null,
}));

vi.mock("@/hooks/queries/notification-preferences/use-get-push-status", () => ({
  default: () => ({ data: m.pushStatus }),
}));

describe("NotificationPreferencesSettings", () => {
  afterEach(cleanup);

  beforeEach(() => {
    updatePreferences.mockReset();
    updatePreferences.mockResolvedValue(undefined);
    m.upsertRule.mockReset();
    m.upsertRule.mockResolvedValue(undefined);
    m.workspaces = [];
    m.pushStatus = undefined;
    preferences.workspaces = [];
  });

  it("shows a workspace rule's push as off while no device has push, and keeps the saved choice", async () => {
    m.workspaces = [{ id: "ws-1", name: "Acme" }];
    m.pushStatus = { subscriptions: [] };
    preferences.workspaces = [
      {
        workspaceId: "ws-1",
        isActive: true,
        emailEnabled: false,
        ntfyEnabled: false,
        gotifyEnabled: false,
        webhookEnabled: false,
        pushEnabled: true,
        projectMode: "all",
        selectedProjectIds: [],
      },
    ];
    const { rerender } = render(<NotificationPreferencesSettings />);
    const push = () =>
      screen.getByRole("switch", {
        name: "settings:notificationsPage.workspaceCardLabelPush",
      });

    expect(push()).not.toBeChecked();
    expect(
      screen.getByText("settings:notificationsPage.pushChannelHintDisabled"),
    ).toBeTruthy();

    // Saving the rule keeps push on for when a device turns it on.
    const saves = screen.getAllByRole("button", {
      name: "settings:notificationsPage.saveChanges",
    });
    fireEvent.click(saves[saves.length - 1] as HTMLElement);
    await waitFor(() =>
      expect(m.upsertRule).toHaveBeenCalledWith({
        workspaceId: "ws-1",
        json: expect.objectContaining({ pushEnabled: true }),
      }),
    );

    m.pushStatus = { subscriptions: [{ id: "device-1" }] };
    rerender(<NotificationPreferencesSettings />);
    expect(push()).toBeChecked();
  });

  it("shows a workspace rule's channels as off while they are off globally, and keeps the saved choices", async () => {
    m.workspaces = [{ id: "ws-1", name: "Acme" }];
    // Email, ntfy, Gotify and the webhook are all off in `preferences`.
    preferences.workspaces = [
      {
        workspaceId: "ws-1",
        isActive: true,
        emailEnabled: true,
        ntfyEnabled: true,
        gotifyEnabled: true,
        webhookEnabled: true,
        pushEnabled: false,
        projectMode: "all",
        selectedProjectIds: [],
      },
    ];
    render(<NotificationPreferencesSettings />);

    for (const channel of ["Email", "Ntfy", "Gotify", "Webhook"]) {
      expect(
        screen.getByRole("switch", {
          name: `settings:notificationsPage.workspaceCardLabel${channel}`,
        }),
      ).not.toBeChecked();
    }

    const saves = screen.getAllByRole("button", {
      name: "settings:notificationsPage.saveChanges",
    });
    fireEvent.click(saves[saves.length - 1] as HTMLElement);
    await waitFor(() =>
      expect(m.upsertRule).toHaveBeenCalledWith({
        workspaceId: "ws-1",
        json: expect.objectContaining({
          emailEnabled: true,
          ntfyEnabled: true,
          gotifyEnabled: true,
          webhookEnabled: true,
        }),
      }),
    );
  });

  it("saves event preferences and a configurable reminder lead time", async () => {
    render(<NotificationPreferencesSettings />);

    fireEvent.click(
      screen.getByRole("switch", {
        name: "settings:notificationsPage.eventTaskAssignments",
      }),
    );
    fireEvent.change(
      screen.getByLabelText("settings:notificationsPage.reminderLeadTimeLabel"),
      { target: { value: "2" } },
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings:notificationsPage.saveEventPreferences",
      }),
    );

    await waitFor(() =>
      expect(updatePreferences).toHaveBeenCalledWith({
        taskAssignmentEnabled: false,
        taskCommentEnabled: true,
        taskStatusChangeEnabled: true,
        taskUpdateEnabled: true,
        dueDateReminderEnabled: true,
        dueDateReminderLeadTimeMinutes: 2880,
      }),
    );
  });

  it("blocks saving a cleared reminder lead time", () => {
    render(<NotificationPreferencesSettings />);

    fireEvent.change(
      screen.getByLabelText("settings:notificationsPage.reminderLeadTimeLabel"),
      { target: { value: "" } },
    );

    expect(
      screen.getByText("settings:notificationsPage.reminderLeadTimeInvalid"),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "settings:notificationsPage.saveEventPreferences",
      }),
    ).toHaveProperty("disabled", true);
  });

  it("saves disabled reminders without validating their retained lead time", async () => {
    render(<NotificationPreferencesSettings />);

    fireEvent.change(
      screen.getByLabelText("settings:notificationsPage.reminderLeadTimeLabel"),
      { target: { value: "0" } },
    );
    fireEvent.click(
      screen.getByRole("switch", {
        name: "settings:notificationsPage.eventDueDateReminders",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings:notificationsPage.saveEventPreferences",
      }),
    );

    await waitFor(() =>
      expect(updatePreferences).toHaveBeenCalledWith({
        taskAssignmentEnabled: true,
        taskCommentEnabled: true,
        taskStatusChangeEnabled: true,
        taskUpdateEnabled: true,
        dueDateReminderEnabled: false,
      }),
    );
  });

  it("saves the other task changes switch", async () => {
    render(<NotificationPreferencesSettings />);

    fireEvent.click(
      screen.getByRole("switch", {
        name: "settings:notificationsPage.eventTaskUpdates",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings:notificationsPage.saveEventPreferences",
      }),
    );

    await waitFor(() =>
      expect(updatePreferences).toHaveBeenCalledWith(
        expect.objectContaining({ taskUpdateEnabled: false }),
      ),
    );
  });
});
