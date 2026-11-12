import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_NOTIFICATION_SOUND } from "@/lib/notification-sound/settings";
import { DEFAULT_QUIET_DELIVERY } from "@/lib/quiet-time";
import { useUserPreferencesStore } from "@/store/user-preferences";
import { QuietHoursSettings } from "./quiet-hours-settings";

const { saveTimezone } = vi.hoisted(() => ({
  saveTimezone: vi.fn(async (_zone: string) => ({ timezone: "UTC" })),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/mutations/user/use-update-user-timezone", () => ({
  default: () => ({ mutateAsync: saveTimezone, isPending: false }),
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));

function Wrapper({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

const switchFor = (label: string) =>
  screen.getByRole("switch", { name: label });

describe("QuietHoursSettings", () => {
  beforeEach(() => {
    saveTimezone.mockClear();
    useUserPreferencesStore.setState({
      notificationSound: DEFAULT_NOTIFICATION_SOUND,
      quietDelivery: DEFAULT_QUIET_DELIVERY,
      focusUntil: null,
      timeZone: "Europe/Berlin",
    });
  });
  afterEach(cleanup);

  it("shows the quiet hours times only when quiet hours are on, even with sounds off", () => {
    useUserPreferencesStore.setState({
      notificationSound: { ...DEFAULT_NOTIFICATION_SOUND, enabled: false },
    });
    render(<QuietHoursSettings />, { wrapper: Wrapper });
    expect(
      screen.queryByLabelText("settings:notificationsPage.sound.quietFrom"),
    ).toBeNull();
    fireEvent.click(switchFor("settings:notificationsPage.sound.quietHours"));
    fireEvent.change(
      screen.getByLabelText("settings:notificationsPage.sound.quietFrom"),
      { target: { value: "21:30" } },
    );
    expect(useUserPreferencesStore.getState().notificationSound).toMatchObject({
      quietHours: true,
      quietStart: "21:30",
      quietEnd: "08:00",
    });
  });

  it("offers the browser's zone when the account has none", () => {
    useUserPreferencesStore.setState({
      timeZone: null,
      notificationSound: { ...DEFAULT_NOTIFICATION_SOUND, quietHours: true },
    });
    render(<QuietHoursSettings />, { wrapper: Wrapper });
    expect(
      screen.getByText("settings:notificationsPage.quiet.noTimeZone"),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings:notificationsPage.quiet.useTimeZone",
      }),
    );
    expect(saveTimezone).toHaveBeenCalledTimes(1);
  });

  it("chooses the held channels and the bypasses", () => {
    render(<QuietHoursSettings />, { wrapper: Wrapper });
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "settings:notificationsPage.quiet.channelWebhook",
      }),
    );
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "settings:notificationsPage.quiet.bypassMentions",
      }),
    );
    expect(useUserPreferencesStore.getState().quietDelivery).toEqual({
      channels: ["push", "email", "desktop", "ntfy", "gotify"],
      bypass: ["mentions"],
    });
  });

  it("starts and ends focus mode", () => {
    render(<QuietHoursSettings />, { wrapper: Wrapper });
    fireEvent.click(
      screen.getByRole("button", { name: "navigation:focus.preset30m" }),
    );
    const until = useUserPreferencesStore.getState().focusUntil;
    expect(until).not.toBeNull();
    const minutes = (Date.parse(until ?? "") - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(29);
    expect(minutes).toBeLessThanOrEqual(30);
    fireEvent.click(
      screen.getByRole("button", { name: "navigation:focus.resume" }),
    );
    expect(useUserPreferencesStore.getState().focusUntil).toBeNull();
  });
});
