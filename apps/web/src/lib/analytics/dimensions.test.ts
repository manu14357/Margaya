import { describe, expect, it } from "vitest";
import {
  availabilityOf,
  availableDimensions,
  segmentOptions,
} from "./dimensions";
import { analyticsScopeKey, parseProjectIdsParam } from "./scope-key";
import { availableAnalyticsTabs, resolveAnalyticsTab } from "./tabs";

const plain = { id: "a", cyclesEnabled: false };
const withCycles = { id: "b", cyclesEnabled: true, modulesEnabled: true };
const withIntake = { id: "c", intakeEnabled: true, estimatesEnabled: true };

describe("dimension availability", () => {
  it("offers status only with exactly one project, project only with several", () => {
    const one = availableDimensions(availabilityOf([plain]));
    expect(one).toContain("status");
    expect(one).not.toContain("project");
    const several = availableDimensions(availabilityOf([plain, withCycles]));
    expect(several).not.toContain("status");
    expect(several).toContain("project");
  });

  it("hides cycle, module and estimate while every project has them off", () => {
    const off = availableDimensions(availabilityOf([plain]));
    expect(off).not.toContain("cycle");
    expect(off).not.toContain("module");
    expect(off).not.toContain("estimate");
    const on = availableDimensions(availabilityOf([withCycles, withIntake]));
    expect(on).toEqual(expect.arrayContaining(["cycle", "module", "estimate"]));
  });

  it("offers segments that are neither the x-axis nor dates", () => {
    const segments = segmentOptions("priority", availabilityOf([plain]));
    expect(segments).not.toContain("priority");
    expect(segments).not.toContain("createdAt");
    expect(segments).toContain("group");
  });
});

describe("tabs", () => {
  it("shows Overview only in workspace scope", () => {
    expect(
      availableAnalyticsTabs("workspace", [plain], { canReadIntake: true }),
    ).toEqual(["overview", "tasks"]);
    expect(
      availableAnalyticsTabs("project", [plain], { canReadIntake: true }),
    ).toEqual(["tasks", "delivery"]);
  });

  it("shows Delivery only in project scope", () => {
    expect(
      availableAnalyticsTabs("workspace", [plain], { canReadIntake: true }),
    ).not.toContain("delivery");
  });

  it("shows feature tabs while a scope project has the feature on", () => {
    expect(
      availableAnalyticsTabs("workspace", [plain, withCycles, withIntake], {
        canReadIntake: true,
      }),
    ).toEqual(["overview", "tasks", "cycles", "modules", "intake"]);
  });

  it("needs intake:read for the Intake tab", () => {
    expect(
      availableAnalyticsTabs("project", [withIntake], { canReadIntake: false }),
    ).toEqual(["tasks", "delivery"]);
  });

  it("falls back to the default tab for unknown or hidden tabs", () => {
    const tabs = availableAnalyticsTabs("project", [plain], {
      canReadIntake: true,
    });
    expect(resolveAnalyticsTab("cycles", tabs, "project")).toBe("tasks");
    expect(resolveAnalyticsTab("nope", tabs, "project")).toBe("tasks");
    expect(
      resolveAnalyticsTab(undefined, ["overview", "tasks"], "workspace"),
    ).toBe("overview");
  });
});

describe("scope keys", () => {
  it("is 'all' without projects and the sorted ids otherwise", () => {
    expect(analyticsScopeKey(undefined)).toBe("all");
    expect(analyticsScopeKey([])).toBe("all");
    expect(analyticsScopeKey(["b", "a", "b"])).toBe("a,b");
  });

  it("parses the URL's project list", () => {
    expect(parseProjectIdsParam(" a, b,,a ")).toEqual(["a", "b"]);
    expect(parseProjectIdsParam(undefined)).toEqual([]);
  });
});
