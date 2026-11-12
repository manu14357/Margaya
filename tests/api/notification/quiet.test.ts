import { describe, expect, it } from "vitest";
import {
  bypassGroup,
  isQuietNow,
  quietDecision,
  quietSettings,
} from "../../../apps/api/src/notification/quiet";

const noon = new Date("2026-11-11T12:00:00.000Z");
const later = (minutes: number) =>
  new Date(noon.getTime() + minutes * 60 * 1000).toISOString();

const sound = {
  enabled: true,
  volume: 70,
  mentions: "chime",
  agents: "knock",
  replies: "pop",
  other: "none",
  quietHours: true,
  quietStart: "11:00",
  quietEnd: "13:00",
} as const;

function decide(
  type: string,
  options: {
    preferences?: Parameters<typeof quietSettings>[0];
    urgentTask?: boolean;
    eventData?: unknown;
    timeZone?: string | null;
  } = {},
) {
  return quietDecision({
    settings: quietSettings(options.preferences ?? { focusUntil: later(30) }),
    notification: { type, eventData: options.eventData ?? {} },
    urgentTask: options.urgentTask ?? false,
    now: noon,
    timeZone: options.timeZone ?? null,
  });
}

describe("quiet time", () => {
  it("is off for a user who never chose anything", () => {
    expect(isQuietNow(quietSettings({}), noon, null)).toBe(false);
    expect(decide("task_comment", { preferences: {} })).toMatchObject({
      quiet: false,
    });
    expect(decide("task_comment", { preferences: {} }).held.size).toBe(0);
  });

  it("holds every channel during focus by default", () => {
    const decision = decide("task_comment");
    expect(decision.quiet).toBe(true);
    expect([...decision.held].sort()).toEqual([
      "desktop",
      "email",
      "gotify",
      "ntfy",
      "push",
      "webhook",
    ]);
  });

  it("ends focus at its instant", () => {
    expect(
      isQuietNow(quietSettings({ focusUntil: later(0) }), noon, null),
    ).toBe(false);
    expect(
      isQuietNow(quietSettings({ focusUntil: later(-5) }), noon, null),
    ).toBe(false);
    expect(
      isQuietNow(quietSettings({ focusUntil: later(1) }), noon, null),
    ).toBe(true);
  });

  it("follows quiet hours in the account time zone, else UTC", () => {
    const settings = quietSettings({ notificationSound: sound });
    expect(isQuietNow(settings, noon, null)).toBe(true);
    expect(isQuietNow(settings, noon, "UTC")).toBe(true);
    // 17:45 in Kathmandu.
    expect(isQuietNow(settings, noon, "Asia/Kathmandu")).toBe(false);
    expect(
      isQuietNow(
        quietSettings({ notificationSound: { ...sound, quietHours: false } }),
        noon,
        null,
      ),
    ).toBe(false);
  });

  it("holds only the chosen channels", () => {
    const decision = decide("task_comment", {
      preferences: {
        focusUntil: later(30),
        quietDelivery: { channels: ["email", "webhook"], bypass: [] },
      },
    });
    expect(decision.quiet).toBe(true);
    expect([...decision.held].sort()).toEqual(["email", "webhook"]);
  });

  it("lets the chosen bypasses through", () => {
    const preferences = {
      focusUntil: later(30),
      quietDelivery: {
        channels: ["push" as const],
        bypass: ["mentions" as const, "urgent" as const, "approvals" as const],
      },
    };
    for (const type of [
      "task_mention",
      "page_mention",
      "ai_approval_requested",
    ]) {
      expect(decide(type, { preferences }).quiet, type).toBe(false);
    }
    expect(
      decide("task_assignee_changed", { preferences, urgentTask: true }).quiet,
    ).toBe(false);
    expect(
      decide("task_assignee_changed", { preferences, urgentTask: false }).quiet,
    ).toBe(true);
    expect(
      decide("ai_agent_reply", { preferences, eventData: { needsInput: true } })
        .quiet,
    ).toBe(false);
    expect(decide("ai_agent_reply", { preferences }).quiet).toBe(true);
    // Not chosen: mentions wait like the rest.
    expect(decide("task_mention").quiet).toBe(true);
  });

  it("groups notifications for the bypass", () => {
    expect(bypassGroup("task_mention", {}, false)).toBe("mentions");
    expect(bypassGroup("task_assignee_changed", {}, true)).toBe("urgent");
    expect(bypassGroup("task_assignee_changed", {}, false)).toBeNull();
    expect(bypassGroup("ai_approval_requested", null, false)).toBe("approvals");
    expect(bypassGroup("task_comment", {}, false)).toBeNull();
  });
});
