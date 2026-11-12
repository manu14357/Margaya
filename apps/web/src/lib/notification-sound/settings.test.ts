import { describe, expect, it } from "vitest";
import {
  DEFAULT_NOTIFICATION_SOUND,
  isQuietTime,
  minutesInZone,
  normalizeNotificationSound,
  soundCategory,
  soundFor,
} from "./settings";

const at = (clock: string) => {
  const [h, m] = clock.split(":").map(Number);
  return h * 60 + m;
};

describe("soundCategory", () => {
  it.each([
    [{ notificationType: "task_mention" }, "mentions"],
    [{ notificationType: "page_mention" }, "mentions"],
    [{ notificationType: "task_assignee_changed" }, "mentions"],
    [{ notificationType: "ai_approval_requested" }, "agents"],
    [{ notificationType: "ai_agent_reply", needsInput: true }, "agents"],
    [{ notificationType: "ai_agent_reply" }, "replies"],
    [{ notificationType: "task_comment", reply: true }, "replies"],
    [{ notificationType: "task_comment" }, "other"],
    [{ notificationType: "task_status_changed" }, "other"],
    [{ notificationType: null }, "other"],
    [{}, "other"],
  ] as const)("%o is %s", (hint, category) => {
    expect(soundCategory(hint)).toBe(category);
  });
});

describe("normalizeNotificationSound", () => {
  it("returns the defaults object itself for nothing or defaults", () => {
    expect(normalizeNotificationSound(undefined)).toBe(
      DEFAULT_NOTIFICATION_SOUND,
    );
    expect(normalizeNotificationSound({ ...DEFAULT_NOTIFICATION_SOUND })).toBe(
      DEFAULT_NOTIFICATION_SOUND,
    );
  });

  it("keeps valid fields and replaces broken ones one by one", () => {
    expect(
      normalizeNotificationSound({
        enabled: false,
        volume: 140,
        mentions: "bell",
        agents: "siren",
        quietStart: "25:00",
        quietEnd: "07:30",
        quietHours: "yes",
      }),
    ).toEqual({
      ...DEFAULT_NOTIFICATION_SOUND,
      enabled: false,
      volume: 100,
      mentions: "bell",
      quietEnd: "07:30",
    });
  });
});

describe("isQuietTime", () => {
  const night = { quietHours: true, quietStart: "22:00", quietEnd: "08:00" };

  it("covers a range across midnight, end exclusive", () => {
    expect(isQuietTime(night, at("23:30"))).toBe(true);
    expect(isQuietTime(night, at("02:00"))).toBe(true);
    expect(isQuietTime(night, at("08:00"))).toBe(false);
    expect(isQuietTime(night, at("12:00"))).toBe(false);
  });

  it("covers a daytime range", () => {
    const lunch = { quietHours: true, quietStart: "12:00", quietEnd: "13:00" };
    expect(isQuietTime(lunch, at("12:00"))).toBe(true);
    expect(isQuietTime(lunch, at("13:00"))).toBe(false);
  });

  it("is off when disabled or when start equals end", () => {
    expect(isQuietTime({ ...night, quietHours: false }, at("23:00"))).toBe(
      false,
    );
    expect(
      isQuietTime(
        { quietHours: true, quietStart: "09:00", quietEnd: "09:00" },
        at("09:00"),
      ),
    ).toBe(false);
  });
});

describe("minutesInZone", () => {
  it("reads the wall clock of the given zone", () => {
    const noonUtc = new Date("2026-10-31T12:00:00Z");
    expect(minutesInZone(noonUtc, "UTC")).toBe(12 * 60);
    expect(minutesInZone(noonUtc, "Asia/Kolkata")).toBe(17 * 60 + 30);
  });

  it("falls back to the device zone for an unknown zone", () => {
    const now = new Date(2026, 9, 31, 9, 15);
    expect(minutesInZone(now, "Not/AZone")).toBe(9 * 60 + 15);
  });
});

describe("soundFor", () => {
  const noon = at("12:00");
  const s = DEFAULT_NOTIFICATION_SOUND;

  it("picks the category's sound", () => {
    expect(soundFor(s, { notificationType: "task_mention" }, noon)).toBe(
      "chime",
    );
    expect(
      soundFor(s, { notificationType: "ai_approval_requested" }, noon),
    ).toBe("knock");
    expect(
      soundFor(s, { notificationType: "task_comment", reply: true }, noon),
    ).toBe("pop");
    // "Everything else" is silent by default.
    expect(soundFor(s, { notificationType: "task_updated" }, noon)).toBeNull();
  });

  it("is silent when off, at volume 0 or in quiet hours", () => {
    const hint = { notificationType: "task_mention" };
    expect(soundFor({ ...s, enabled: false }, hint, noon)).toBeNull();
    expect(soundFor({ ...s, volume: 0 }, hint, noon)).toBeNull();
    expect(
      soundFor(
        { ...s, quietHours: true, quietStart: "11:00", quietEnd: "13:00" },
        hint,
        noon,
      ),
    ).toBeNull();
  });

  it("follows the server's quiet-time call when the hint carries one", () => {
    const quietNow = {
      ...s,
      quietHours: true,
      quietStart: "11:00",
      quietEnd: "13:00",
    };
    // Focus mode or quiet hours on the server.
    expect(
      soundFor(s, { notificationType: "task_mention", quiet: true }, noon),
    ).toBeNull();
    // A bypassed mention sounds even inside the local quiet hours.
    expect(
      soundFor(
        quietNow,
        { notificationType: "task_mention", quiet: false },
        noon,
      ),
    ).toBe("chime");
  });
});
