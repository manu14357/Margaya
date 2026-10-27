import { describe, expect, it } from "vitest";
import { HttpError } from "@/lib/http-error";
import {
  cronLabel,
  looksLikeCron,
  presetOf,
  SCHEDULE_PRESETS,
  scheduleErrorKey,
  timeZones,
} from "./schedules";

describe("schedule presets", () => {
  it("offers weekday, Monday and first-of-month mornings", () => {
    expect(SCHEDULE_PRESETS.map((preset) => preset.cron)).toEqual([
      "0 9 * * 1-5",
      "0 9 * * 1",
      "0 9 1 * *",
    ]);
  });

  it("recognizes a preset whatever the spacing, else custom", () => {
    expect(presetOf("0  9 * *   1-5")).toBe("weekdays");
    expect(presetOf("0 9 * * 1")).toBe("mondays");
    expect(presetOf("30 8 * * *")).toBe("custom");
  });

  it("labels presets by name and other crons by their fields", () => {
    expect(cronLabel("0 9 1 * *")).toEqual({
      key: "ai:agents.schedules.presets.monthly",
    });
    expect(cronLabel(" 30 8 * * * ")).toEqual({
      key: "ai:agents.schedules.customLabel",
      values: { cron: "30 8 * * *" },
    });
  });

  it("wants five cron fields", () => {
    expect(looksLikeCron("*/30 9-17 * * mon-fri")).toBe(true);
    expect(looksLikeCron("0 9 * *")).toBe(false);
    expect(looksLikeCron("0 9 * * * *")).toBe(false);
    expect(looksLikeCron("0 9 * * ;")).toBe(false);
  });
});

describe("schedule errors", () => {
  it("maps the API's codes to messages", () => {
    const error = new HttpError(
      400,
      JSON.stringify({ code: "CRON_TOO_FREQUENT", message: "cron: …" }),
    );
    expect(scheduleErrorKey(error)).toBe(
      "ai:agents.schedules.errors.CRON_TOO_FREQUENT",
    );
    expect(
      scheduleErrorKey(
        new HttpError(400, JSON.stringify({ code: "OUTSIDE_AGENT_PROJECTS" })),
      ),
    ).toBe("ai:agents.schedules.errors.OUTSIDE_AGENT_PROJECTS");
  });

  it("falls back to a generic message", () => {
    expect(scheduleErrorKey(new HttpError(500, "boom"))).toBe(
      "ai:agents.schedules.saveError",
    );
    expect(scheduleErrorKey(new Error("x"))).toBe(
      "ai:agents.schedules.saveError",
    );
  });
});

describe("time zones", () => {
  it("lists UTC and keeps the current zone", () => {
    const zones = timeZones("Mars/Olympus");
    expect(zones).toContain("UTC");
    expect(zones).toContain("Mars/Olympus");
    expect([...zones].sort((a, b) => a.localeCompare(b))).toEqual(zones);
  });
});
