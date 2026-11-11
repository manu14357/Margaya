import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNotificationSoundDevice } from "@/store/notification-sound-device";
import { useUserPreferencesStore } from "@/store/user-preferences";
import {
  claimSoundSlot,
  playForNotification,
  SOUND_WINDOW_MS,
  syncDesktopSoundMute,
} from "./notify";
import { DEFAULT_NOTIFICATION_SOUND } from "./settings";

const player = vi.hoisted(() => ({
  ready: true,
  voice: false,
  playSound: vi.fn(() => true),
}));
vi.mock("./player", () => ({
  audioReady: () => player.ready,
  isVoiceActive: () => player.voice,
  playSound: player.playSound,
}));

const mention = { notificationType: "task_mention" };
const noonUtc = new Date("2026-10-31T12:00:00Z");

/** A Web Locks stand-in with one exclusive lock per name. */
function fakeLocks() {
  const held = new Set<string>();
  return {
    request: vi.fn(
      async (
        name: string,
        _options: { ifAvailable: boolean },
        callback: (lock: object | null) => unknown,
      ) => {
        if (held.has(name)) return callback(null);
        held.add(name);
        try {
          return await callback({ name });
        } finally {
          held.delete(name);
        }
      },
    ),
  };
}

describe("claimSoundSlot", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("lets one claim through per window with Web Locks, across tabs", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("navigator", { locks: fakeLocks() });
    expect(await claimSoundSlot()).toBe(true);
    // A second tab (same lock manager) or a second notification: no.
    expect(await claimSoundSlot()).toBe(false);
    await vi.advanceTimersByTimeAsync(SOUND_WINDOW_MS);
    expect(await claimSoundSlot()).toBe(true);
  });

  it("falls back to a shared timestamp without Web Locks", async () => {
    vi.stubGlobal("navigator", {});
    expect(await claimSoundSlot(10_000)).toBe(true);
    expect(await claimSoundSlot(10_000 + SOUND_WINDOW_MS - 1)).toBe(false);
    expect(await claimSoundSlot(10_000 + SOUND_WINDOW_MS)).toBe(true);
  });
});

describe("playForNotification", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal("navigator", {});
    player.ready = true;
    player.voice = false;
    player.playSound.mockClear();
    useNotificationSoundDevice.setState({ muted: false });
    useUserPreferencesStore.setState({
      notificationSound: DEFAULT_NOTIFICATION_SOUND,
      timeZone: "UTC",
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("plays the category's sound at the chosen volume", async () => {
    useUserPreferencesStore.setState({
      notificationSound: { ...DEFAULT_NOTIFICATION_SOUND, volume: 40 },
    });
    expect(await playForNotification(mention, noonUtc)).toBe(true);
    expect(player.playSound).toHaveBeenCalledWith("chime", 40);
  });

  it("plays once per burst", async () => {
    await playForNotification(mention, noonUtc);
    await playForNotification(mention, new Date(noonUtc.getTime() + 1000));
    expect(player.playSound).toHaveBeenCalledTimes(1);
  });

  it("stays silent when muted here, in voice mode or before audio starts", async () => {
    useNotificationSoundDevice.setState({ muted: true });
    expect(await playForNotification(mention, noonUtc)).toBe(false);
    useNotificationSoundDevice.setState({ muted: false });
    player.voice = true;
    expect(await playForNotification(mention, noonUtc)).toBe(false);
    player.voice = false;
    player.ready = false;
    expect(await playForNotification(mention, noonUtc)).toBe(false);
    expect(player.playSound).not.toHaveBeenCalled();
  });

  it("does not spend the burst on a notification that makes no sound", async () => {
    // "Everything else" is silent by default; the mention right after plays.
    await playForNotification({ notificationType: "task_updated" }, noonUtc);
    await playForNotification(mention, noonUtc);
    expect(player.playSound).toHaveBeenCalledTimes(1);
  });

  it("respects quiet hours in the account time zone", async () => {
    useUserPreferencesStore.setState({
      notificationSound: {
        ...DEFAULT_NOTIFICATION_SOUND,
        quietHours: true,
        quietStart: "17:00",
        quietEnd: "18:00",
      },
      // 12:00 UTC is 17:30 in Kolkata.
      timeZone: "Asia/Kolkata",
    });
    expect(await playForNotification(mention, noonUtc)).toBe(false);
    useUserPreferencesStore.setState({ timeZone: "UTC" });
    expect(await playForNotification(mention, noonUtc)).toBe(true);
  });
});

describe("in the desktop app", () => {
  const bridge = { notificationSound: "system", setSoundMuted: vi.fn() };
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal("navigator", {});
    player.ready = true;
    player.voice = false;
    player.playSound.mockClear();
    bridge.setSoundMuted.mockClear();
    useNotificationSoundDevice.setState({ muted: false });
    useUserPreferencesStore.setState({
      notificationSound: DEFAULT_NOTIFICATION_SOUND,
      timeZone: "UTC",
    });
  });
  afterEach(() => {
    delete (window as { __MARGAYA_DESKTOP__?: unknown }).__MARGAYA_DESKTOP__;
    vi.unstubAllGlobals();
  });

  it("leaves the one sound to the app's native notification", async () => {
    (window as { __MARGAYA_DESKTOP__?: unknown }).__MARGAYA_DESKTOP__ = bridge;
    expect(await playForNotification(mention, noonUtc)).toBe(false);
    expect(player.playSound).not.toHaveBeenCalled();
  });

  it("still plays in an app version that doesn't sound its notifications", async () => {
    (window as { __MARGAYA_DESKTOP__?: unknown }).__MARGAYA_DESKTOP__ = {
      setBadge: vi.fn(),
    };
    expect(await playForNotification(mention, noonUtc)).toBe(true);
  });

  it("tells the app about this device's mute, now and on change", () => {
    (window as { __MARGAYA_DESKTOP__?: unknown }).__MARGAYA_DESKTOP__ = bridge;
    useNotificationSoundDevice.setState({ muted: true });
    const stop = syncDesktopSoundMute();
    expect(bridge.setSoundMuted).toHaveBeenLastCalledWith(true);
    useNotificationSoundDevice.setState({ muted: false });
    expect(bridge.setSoundMuted).toHaveBeenLastCalledWith(false);
    stop();
    useNotificationSoundDevice.setState({ muted: true });
    expect(bridge.setSoundMuted).toHaveBeenCalledTimes(2);
  });

  it("sends nothing in a browser", () => {
    const stop = syncDesktopSoundMute();
    useNotificationSoundDevice.setState({ muted: true });
    stop();
    expect(bridge.setSoundMuted).not.toHaveBeenCalled();
  });
});
