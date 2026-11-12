import { describe, expect, it } from "vitest";
import {
  clampFocusEnd,
  DEFAULT_QUIET_DELIVERY,
  focusEnd,
  MAX_FOCUS_MS,
  normalizeFocusUntil,
  normalizeQuietDelivery,
  quietStatus,
} from "./quiet-time";

const noon = new Date("2026-11-11T12:00:00.000Z");
const off = {
  focusUntil: null,
  quietHours: false,
  quietStart: "22:00",
  quietEnd: "08:00",
};

describe("normalizeQuietDelivery", () => {
  it("keeps the defaults object for missing or default values", () => {
    expect(normalizeQuietDelivery(undefined)).toBe(DEFAULT_QUIET_DELIVERY);
    expect(
      normalizeQuietDelivery({
        channels: ["webhook", "push", "email", "desktop", "ntfy", "gotify"],
        bypass: [],
      }),
    ).toBe(DEFAULT_QUIET_DELIVERY);
  });

  it("drops unknown values and repeats, in a stable order", () => {
    expect(
      normalizeQuietDelivery({
        channels: ["email", "fax", "push", "email"],
        bypass: ["urgent", "everything", "mentions"],
      }),
    ).toEqual({ channels: ["push", "email"], bypass: ["mentions", "urgent"] });
  });
});

describe("normalizeFocusUntil", () => {
  it("keeps instants only", () => {
    expect(normalizeFocusUntil("2026-11-11T13:00:00.000Z")).toBe(
      "2026-11-11T13:00:00.000Z",
    );
    expect(normalizeFocusUntil("soon")).toBeNull();
    expect(normalizeFocusUntil(3)).toBeNull();
  });
});

describe("focusEnd", () => {
  it("adds the preset durations", () => {
    expect(focusEnd("30m", noon, null).toISOString()).toBe(
      "2026-11-11T12:30:00.000Z",
    );
    expect(focusEnd("2h", noon, null).toISOString()).toBe(
      "2026-11-11T14:00:00.000Z",
    );
  });

  it("ends tomorrow morning in the account zone, or when quiet hours end", () => {
    expect(focusEnd("tomorrow", noon, "UTC").toISOString()).toBe(
      "2026-11-12T09:00:00.000Z",
    );
    // Berlin is UTC+1 in November.
    expect(focusEnd("tomorrow", noon, "Europe/Berlin").toISOString()).toBe(
      "2026-11-12T08:00:00.000Z",
    );
    expect(focusEnd("tomorrow", noon, "UTC", "07:30").toISOString()).toBe(
      "2026-11-12T07:30:00.000Z",
    );
  });

  it("clamps a custom end to the next 7 days and rejects the past", () => {
    expect(clampFocusEnd(new Date(noon.getTime() - 1), noon)).toBeNull();
    expect(
      clampFocusEnd(
        new Date(noon.getTime() + 2 * MAX_FOCUS_MS),
        noon,
      )?.getTime(),
    ).toBe(noon.getTime() + MAX_FOCUS_MS);
  });
});

describe("quietStatus", () => {
  it("is null when nothing pauses notifications", () => {
    expect(quietStatus(off, noon, "UTC")).toBeNull();
    expect(
      quietStatus(
        { ...off, focusUntil: "2026-11-11T11:00:00.000Z" },
        noon,
        null,
      ),
    ).toBeNull();
  });

  it("prefers focus over quiet hours", () => {
    expect(
      quietStatus(
        {
          focusUntil: "2026-11-11T12:30:00.000Z",
          quietHours: true,
          quietStart: "11:00",
          quietEnd: "13:00",
        },
        noon,
        "UTC",
      ),
    ).toEqual({ kind: "focus", until: new Date("2026-11-11T12:30:00.000Z") });
  });

  it("ends quiet hours today or tomorrow", () => {
    expect(
      quietStatus(
        { ...off, quietHours: true, quietStart: "11:00", quietEnd: "13:00" },
        noon,
        "UTC",
      ),
    ).toEqual({ kind: "quiet", until: new Date("2026-11-11T13:00:00.000Z") });
    expect(
      quietStatus(
        { ...off, quietHours: true, quietStart: "10:00", quietEnd: "08:00" },
        noon,
        null,
      ),
    ).toEqual({ kind: "quiet", until: new Date("2026-11-12T08:00:00.000Z") });
  });
});
