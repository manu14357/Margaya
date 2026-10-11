import { describe, expect, it } from "vitest";
import {
  type DigestSchedule,
  digestSince,
  isDigestDue,
  localWeekday,
} from "../../../apps/api/src/notification-email/digest-schedule";

function schedule(overrides: Partial<DigestSchedule> = {}): DigestSchedule {
  return {
    frequency: "daily",
    weekday: 1,
    hour: 8,
    timeZone: "UTC",
    lastSentAt: null,
    ...overrides,
  };
}

// 2026-10-14 is a Wednesday.
const wednesday0805 = new Date("2026-10-14T08:05:00.000Z");

describe("isDigestDue", () => {
  it("never sends when off or unknown", () => {
    expect(isDigestDue(schedule({ frequency: "off" }), wednesday0805)).toBe(
      false,
    );
    expect(isDigestDue(schedule({ frequency: "hourly" }), wednesday0805)).toBe(
      false,
    );
  });

  it("waits for the local send hour", () => {
    expect(isDigestDue(schedule(), new Date("2026-10-14T07:59:00.000Z"))).toBe(
      false,
    );
    expect(isDigestDue(schedule(), wednesday0805)).toBe(true);
  });

  it("sends once per local day", () => {
    const sentThisMorning = new Date("2026-10-14T08:01:00.000Z");
    expect(
      isDigestDue(schedule({ lastSentAt: sentThisMorning }), wednesday0805),
    ).toBe(false);
    expect(
      isDigestDue(
        schedule({ lastSentAt: sentThisMorning }),
        new Date("2026-10-15T08:00:00.000Z"),
      ),
    ).toBe(true);
  });

  it("does not resend after the send hour is moved later the same day", () => {
    expect(
      isDigestDue(
        schedule({
          hour: 10,
          lastSentAt: new Date("2026-10-14T08:01:00.000Z"),
        }),
        new Date("2026-10-14T10:30:00.000Z"),
      ),
    ).toBe(false);
  });

  it("sends weekly digests only on the chosen weekday", () => {
    const weekly = schedule({ frequency: "weekly", weekday: 3 });
    expect(isDigestDue(weekly, wednesday0805)).toBe(true);
    expect(isDigestDue({ ...weekly, weekday: 4 }, wednesday0805)).toBe(false);
    // Last Wednesday's digest does not block this one.
    expect(
      isDigestDue(
        { ...weekly, lastSentAt: new Date("2026-10-07T08:00:00.000Z") },
        wednesday0805,
      ),
    ).toBe(true);
  });

  it("uses the user's local time", () => {
    // 08:05 UTC is 01:05 in Los Angeles (PDT) and 13:35 in Kolkata.
    expect(
      isDigestDue(schedule({ timeZone: "America/Los_Angeles" }), wednesday0805),
    ).toBe(false);
    expect(
      isDigestDue(
        schedule({ timeZone: "Asia/Kolkata", hour: 13 }),
        wednesday0805,
      ),
    ).toBe(true);
    // Late on Tuesday in Los Angeles is already Wednesday in UTC.
    expect(
      localWeekday(new Date("2026-10-14T05:00:00.000Z"), "America/Los_Angeles"),
    ).toBe(2);
  });

  it("falls back to UTC for an unknown zone", () => {
    expect(
      isDigestDue(schedule({ timeZone: "Mars/Olympus" }), wednesday0805),
    ).toBe(true);
  });
});

describe("digestSince", () => {
  const now = new Date("2026-10-14T08:00:00.000Z");

  it("starts at the last digest", () => {
    const last = new Date("2026-10-13T08:00:00.000Z");
    expect(digestSince("daily", last, now)).toBe(last);
  });

  it("goes back one period for a first digest", () => {
    expect(digestSince("daily", null, now).toISOString()).toBe(
      "2026-10-13T08:00:00.000Z",
    );
    expect(digestSince("weekly", null, now).toISOString()).toBe(
      "2026-10-07T08:00:00.000Z",
    );
  });
});
