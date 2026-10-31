import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_NOTIFICATION_SOUND } from "@/lib/notification-sound/settings";
import { useNotificationSoundDevice } from "@/store/notification-sound-device";
import { useUserPreferencesStore } from "@/store/user-preferences";
import { NotificationSoundSettings } from "./notification-sound-settings";

const { previewSound, toastError } = vi.hoisted(() => ({
  previewSound: vi.fn(async () => true),
  toastError: vi.fn(),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/notification-sound/player", () => ({ previewSound }));
vi.mock("@/lib/toast", () => ({ toast: { error: toastError } }));

const switchFor = (label: string) =>
  screen.getByRole("switch", { name: label });

describe("NotificationSoundSettings", () => {
  beforeEach(() => {
    previewSound.mockClear();
    toastError.mockClear();
    useUserPreferencesStore.setState({
      notificationSound: DEFAULT_NOTIFICATION_SOUND,
    });
    useNotificationSoundDevice.setState({ muted: false });
  });
  afterEach(cleanup);

  it("turns sounds off for the account", () => {
    render(<NotificationSoundSettings />);
    fireEvent.click(switchFor("settings:notificationsPage.sound.enabled"));
    expect(useUserPreferencesStore.getState().notificationSound.enabled).toBe(
      false,
    );
  });

  it("mutes this device without touching the account setting", () => {
    render(<NotificationSoundSettings />);
    fireEvent.click(switchFor("settings:notificationsPage.sound.deviceMute"));
    expect(useNotificationSoundDevice.getState().muted).toBe(true);
    expect(useUserPreferencesStore.getState().notificationSound).toBe(
      DEFAULT_NOTIFICATION_SOUND,
    );
  });

  it("previews a category's sound at the chosen volume", () => {
    render(<NotificationSoundSettings />);
    const play = screen.getAllByRole("button", {
      name: "settings:notificationsPage.sound.preview",
    });
    // Mentions, agents, replies; "Everything else" is None, so disabled.
    expect(play).toHaveLength(4);
    fireEvent.click(play[0]);
    expect(previewSound).toHaveBeenCalledWith("chime", 70);
    expect(play[3]).toBeDisabled();
  });

  it("says so when the browser does not play the preview", async () => {
    previewSound.mockResolvedValueOnce(false);
    render(<NotificationSoundSettings />);
    fireEvent.click(
      screen.getAllByRole("button", {
        name: "settings:notificationsPage.sound.preview",
      })[0],
    );
    await vi.waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "settings:notificationsPage.sound.previewFailed",
      ),
    );
  });

  it("shows the quiet hours times only when quiet hours are on", () => {
    render(<NotificationSoundSettings />);
    expect(
      screen.queryByLabelText("settings:notificationsPage.sound.quietFrom"),
    ).toBeNull();
    fireEvent.click(switchFor("settings:notificationsPage.sound.quietHours"));
    const from = screen.getByLabelText(
      "settings:notificationsPage.sound.quietFrom",
    );
    fireEvent.change(from, { target: { value: "21:30" } });
    expect(useUserPreferencesStore.getState().notificationSound).toMatchObject({
      quietHours: true,
      quietStart: "21:30",
      quietEnd: "08:00",
    });
  });

  it("disables the choices while sounds are off", () => {
    useUserPreferencesStore.setState({
      notificationSound: { ...DEFAULT_NOTIFICATION_SOUND, enabled: false },
    });
    render(<NotificationSoundSettings />);
    expect(
      switchFor("settings:notificationsPage.sound.quietHours"),
    ).toHaveAttribute("aria-disabled", "true");
    // The device mute stays usable.
    expect(
      switchFor("settings:notificationsPage.sound.deviceMute"),
    ).not.toHaveAttribute("aria-disabled", "true");
  });
});
