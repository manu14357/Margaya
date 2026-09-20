import { describe, expect, it } from "vitest";
import {
  customExpiresInSeconds,
  customExpiryBounds,
  EXPIRY_SAFETY_MARGIN_SECONDS,
  isCustomExpiryAllowed,
  MAX_KEY_EXPIRY_DAYS,
} from "./expiry";

const DAY = 24 * 60 * 60;
// Local times, so the assertions hold in every time zone.
const now = new Date(2026, 9, 7, 15, 30, 0);

describe("customExpiryBounds", () => {
  it("allows tomorrow through 365 days from today", () => {
    const { first, last } = customExpiryBounds(now);
    expect(first).toEqual(new Date(2026, 9, 8));
    expect(last).toEqual(new Date(2027, 9, 7));
  });

  it("checks a day against the bounds", () => {
    expect(isCustomExpiryAllowed(new Date(2026, 9, 7), now)).toBe(false);
    expect(isCustomExpiryAllowed(new Date(2026, 9, 8, 9), now)).toBe(true);
    expect(isCustomExpiryAllowed(new Date(2027, 9, 7), now)).toBe(true);
    expect(isCustomExpiryAllowed(new Date(2027, 9, 8), now)).toBe(false);
  });
});

describe("customExpiresInSeconds", () => {
  it("expires a safety margin before the end of the chosen local day", () => {
    const seconds = customExpiresInSeconds(new Date(2026, 9, 9), now);
    const expiresAt = new Date(now.getTime() + seconds * 1000);
    expect(expiresAt).toEqual(
      new Date(2026, 9, 10, 0, 0, -EXPIRY_SAFETY_MARGIN_SECONDS),
    );
    expect(expiresAt.getDate()).toBe(9);
  });

  it("stays on the chosen day when the request arrives late", () => {
    const seconds = customExpiresInSeconds(new Date(2026, 9, 17), now);
    // The server adds `expiresIn` to its own, later clock.
    const latency = 60_000;
    const expiresAt = new Date(now.getTime() + latency + seconds * 1000);
    expect(expiresAt.getTime()).toBeLessThan(new Date(2026, 9, 18).getTime());
    expect(expiresAt.getDate()).toBe(17);
  });

  it("keeps tomorrow above the one-day minimum", () => {
    const lateNight = new Date(2026, 9, 7, 23, 59, 59);
    expect(
      customExpiresInSeconds(new Date(2026, 9, 8), lateNight),
    ).toBeGreaterThanOrEqual(DAY);
  });

  it("caps the last day at the 365-day maximum", () => {
    expect(customExpiresInSeconds(new Date(2027, 9, 7), now)).toBe(
      MAX_KEY_EXPIRY_DAYS * DAY,
    );
  });
});
