import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NotificationPreferences } from "@/fetchers/notification-preferences/get-notification-preferences";
import { EmailDigestSettings } from "./email-digest-settings";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function preferences(
  overrides: Partial<NotificationPreferences> = {},
): NotificationPreferences {
  return {
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
    digestFrequency: "off",
    digestWeekday: 1,
    digestHour: 8,
    lastDigestSentAt: null,
    workspaces: [],
    createdAt: null,
    updatedAt: null,
    ...overrides,
  };
}

const save = () =>
  screen.getByRole("button", { name: "settings:notificationsPage.saveDigest" });

describe("EmailDigestSettings", () => {
  afterEach(cleanup);

  it("shows the saved weekly schedule and saves it back", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <EmailDigestSettings
        isSaving={false}
        onSave={onSave}
        preferences={preferences({
          digestFrequency: "weekly",
          digestWeekday: 3,
          digestHour: 9,
        })}
      />,
    );

    expect(
      screen.getByText("settings:notificationsPage.digestFrequencyWeekly"),
    ).toBeTruthy();
    expect(
      screen.getByText("settings:notificationsPage.digestWeekdayWednesday"),
    ).toBeTruthy();
    expect(screen.getByText("09:00")).toBeTruthy();

    fireEvent.click(save());
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        digestFrequency: "weekly",
        digestWeekday: 3,
        digestHour: 9,
      }),
    );
  });

  it("hides the weekday unless the digest is weekly", () => {
    render(
      <EmailDigestSettings
        isSaving={false}
        onSave={vi.fn()}
        preferences={preferences({ digestFrequency: "daily" })}
      />,
    );
    expect(
      screen.queryByText("settings:notificationsPage.digestWeekdayLabel"),
    ).toBeNull();
    expect(screen.getByText("08:00")).toBeTruthy();
  });

  it("explains and blocks digests without an email address", () => {
    render(
      <EmailDigestSettings
        isSaving={false}
        onSave={vi.fn()}
        preferences={preferences({ emailAddress: null })}
      />,
    );
    expect(
      screen.getByText("settings:notificationsPage.digestNoEmail"),
    ).toBeTruthy();
    expect(save()).toHaveProperty("disabled", true);
  });
});
