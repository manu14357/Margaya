import enUS from "@i18n/en-US.json";
import { createInstance } from "i18next";
import { describe, expect, it } from "vitest";
import { durationParts, parseDurationInput } from "./duration";
import {
  formatDuration,
  formatEstimateNumber,
  formatEstimateValue,
  fromEstimateInput,
  type Translate,
  toEstimateInput,
} from "./format";

// Mirrors the en-US strings, so assertions read like the UI.
const t: Translate = (key, options = {}) => {
  const text: Record<string, string> = {
    "tasks:estimate.duration.hours": "{{hours}}h",
    "tasks:estimate.duration.minutes": "{{minutes}}m",
    "tasks:estimate.duration.hoursMinutes": "{{hours}}h {{minutes}}m",
    "tasks:estimate.duration.hourUnit": "h",
    "tasks:estimate.duration.minuteUnit": "m",
    "tasks:estimate.pointsValue": "{{value}} pts",
  };
  return (text[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
    String(options[name]),
  );
};

describe("parseDurationInput", () => {
  it.each([
    ["90", 90],
    ["1h", 60],
    ["1.5h", 90],
    ["1h 30m", 90],
    ["1h30m", 90],
    ["45m", 45],
    ["2 h", 120],
    [" 1H 5M ", 65],
    [".5h", 30],
    ["0", 0],
  ])("reads %j as %i minutes", (text, minutes) => {
    expect(parseDurationInput(text)).toBe(minutes);
  });

  it.each(["abc", "", "h", "1.5", "1h 30", "-5", "1m 1h"])(
    "rejects %j",
    (text) => {
      expect(parseDurationInput(text)).toBeNull();
    },
  );

  it("accepts localized unit letters besides h and m", () => {
    expect(
      parseDurationInput("2 st 15 min", { hour: "st", minute: "min" }),
    ).toBe(135);
    expect(parseDurationInput("2h 15m", { hour: "st", minute: "min" })).toBe(
      135,
    );
  });

  it("rounds fractional hours to whole minutes", () => {
    expect(parseDurationInput("1.33h")).toBe(80);
  });
});

describe("durationParts", () => {
  it("splits minutes into hours and minutes", () => {
    expect(durationParts(90)).toEqual({ hours: 1, minutes: 30 });
    expect(durationParts(45)).toEqual({ hours: 0, minutes: 45 });
  });
});

describe("formatEstimateValue", () => {
  it("formats time from minutes", () => {
    expect(formatEstimateValue("time", "90", { t })).toBe("1h 30m");
    expect(formatEstimateValue("time", "60", { t })).toBe("1h");
    expect(formatEstimateValue("time", "45", { t })).toBe("45m");
    expect(formatDuration(480, t)).toBe("8h");
  });

  it("shows points as the number, with the unit when asked", () => {
    expect(formatEstimateValue("points", "5", { t })).toBe("5");
    expect(formatEstimateValue("points", "2.5", { withUnit: true, t })).toBe(
      "2.5 pts",
    );
  });

  it("uses the singular unit for one point", async () => {
    const i18n = createInstance();
    await i18n.init({
      lng: "en-US",
      resources: { "en-US": { tasks: enUS.tasks } },
      interpolation: { escapeValue: false },
    });
    const real: Translate = (key, options) => i18n.t(key, options);
    expect(
      formatEstimateValue("points", "1", { withUnit: true, t: real }),
    ).toBe("1 pt");
    expect(
      formatEstimateValue("points", "2", { withUnit: true, t: real }),
    ).toBe("2 pts");
    expect(
      real("tasks:estimate.totals.points", {
        completed: "0",
        total: "1",
        count: 1,
      }),
    ).toBe("0 / 1 pt");
  });

  it("shows categories as they are", () => {
    expect(formatEstimateValue("categories", "XL", { withUnit: true, t })).toBe(
      "XL",
    );
  });

  it("rounds sums to 2 decimals without trailing zeros", () => {
    expect(formatEstimateNumber(12.5)).toBe("12.5");
    expect(formatEstimateNumber(3)).toBe("3");
    expect(formatEstimateNumber(0.1 + 0.2)).toBe("0.3");
  });
});

describe("estimate inputs", () => {
  it("edits time as a duration and sends minutes", () => {
    expect(toEstimateInput("time", "90", t)).toBe("1h 30m");
    expect(fromEstimateInput("time", "1h 30m", t)).toBe("90");
    expect(fromEstimateInput("time", "", t)).toBe("");
  });

  it("sends an unreadable duration as something that is not a number", () => {
    expect(Number.isNaN(Number(fromEstimateInput("time", "soon", t)))).toBe(
      true,
    );
  });

  it("passes points and categories through", () => {
    expect(toEstimateInput("points", "5", t)).toBe("5");
    expect(fromEstimateInput("categories", " XL ", t)).toBe(" XL ");
  });
});
