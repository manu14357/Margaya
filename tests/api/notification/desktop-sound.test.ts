import { describe, expect, it } from "vitest";
import {
  DEFAULT_NOTIFICATION_SOUND,
  desktopSound,
  validTimeZone,
  wantsDesktopSound,
} from "../../../apps/api/src/notification/desktop-sound";

const noon = new Date("2026-11-11T12:00:00.000Z");

type Options = {
  preference?: Partial<typeof DEFAULT_NOTIFICATION_SOUND>;
  eventData?: Record<string, unknown>;
  now?: Date;
  timeZone?: string | null;
};

function input(type: string, options: Options) {
  return {
    preference: options.preference
      ? { ...DEFAULT_NOTIFICATION_SOUND, ...options.preference }
      : undefined,
    notification: {
      id: "n1",
      userId: "u1",
      type,
      eventData: options.eventData ?? {},
    },
    now: options.now ?? noon,
    timeZone: options.timeZone ?? null,
  };
}

function wants(type: string, options: Options = {}) {
  return wantsDesktopSound(input(type, options));
}

function sound(type: string, options: Options = {}) {
  return desktopSound(input(type, options));
}

describe("wantsDesktopSound", () => {
  it("follows the web app's defaults: mentions, agents and replies sound, the rest is quiet", () => {
    expect(wants("task_mention")).toBe(true);
    expect(wants("task_assignee_changed")).toBe(true);
    expect(wants("ai_approval_requested")).toBe(true);
    expect(wants("ai_agent_reply")).toBe(true);
    expect(
      wants("task_comment", { eventData: { parentCommentId: "c0" } }),
    ).toBe(true);
    expect(wants("task_comment")).toBe(false);
    expect(wants("info")).toBe(false);
  });

  it("is silent when sounds are off, at volume 0 or with no sound for the kind", () => {
    expect(wants("task_mention", { preference: { enabled: false } })).toBe(
      false,
    );
    expect(wants("task_mention", { preference: { volume: 0 } })).toBe(false);
    expect(wants("task_mention", { preference: { mentions: "none" } })).toBe(
      false,
    );
    expect(wants("info", { preference: { other: "bell" } })).toBe(true);
  });

  it("keeps quiet hours in the given zone, across midnight, else UTC", () => {
    const quiet = { quietHours: true, quietStart: "22:00", quietEnd: "08:00" };
    // 12:00 UTC is 21:00 in Tokyo (not quiet) and 23:00 in Sydney's summer.
    expect(
      wants("task_mention", { preference: quiet, timeZone: "Asia/Tokyo" }),
    ).toBe(true);
    expect(
      wants("task_mention", {
        preference: quiet,
        timeZone: "Australia/Sydney",
      }),
    ).toBe(false);
    expect(wants("task_mention", { preference: quiet })).toBe(true);
    expect(
      wants("task_mention", {
        preference: { ...quiet, quietStart: "11:00", quietEnd: "13:00" },
      }),
    ).toBe(false);
    // Equal times mean no quiet hours.
    expect(
      wants("task_mention", {
        preference: { ...quiet, quietStart: "12:00", quietEnd: "12:00" },
      }),
    ).toBe(true);
  });

  it("accepts only real time zones", () => {
    expect(validTimeZone("Europe/Berlin")).toBe("Europe/Berlin");
    expect(validTimeZone("Mars/Olympus")).toBeNull();
    expect(validTimeZone("")).toBeNull();
    expect(validTimeZone(null)).toBeNull();
  });

  it("names the chosen sound for the kind and the user's volume", () => {
    expect(sound("task_mention")).toEqual({ soundName: "chime", volume: 70 });
    expect(sound("ai_approval_requested")).toEqual({
      soundName: "knock",
      volume: 70,
    });
    expect(
      sound("task_comment", { eventData: { parentCommentId: "c0" } }),
    ).toEqual({ soundName: "pop", volume: 70 });
    expect(sound("info")).toEqual({ soundName: null, volume: 70 });
    expect(
      sound("info", { preference: { other: "marimba", volume: 35 } }),
    ).toEqual({ soundName: "marimba", volume: 35 });
    expect(
      sound("task_mention", { preference: { mentions: "bell", volume: 100 } }),
    ).toEqual({ soundName: "bell", volume: 100 });
  });

  it("names no sound whenever the alert stays silent", () => {
    expect(sound("task_mention", { preference: { enabled: false } })).toEqual({
      soundName: null,
      volume: 70,
    });
    expect(sound("task_mention", { preference: { volume: 0 } })).toEqual({
      soundName: null,
      volume: 0,
    });
    expect(
      sound("task_mention", {
        preference: {
          quietHours: true,
          quietStart: "11:00",
          quietEnd: "13:00",
        },
      }).soundName,
    ).toBeNull();
  });
});
