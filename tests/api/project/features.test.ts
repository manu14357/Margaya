import { describe, expect, it } from "vitest";
import { projectTable } from "../../../apps/api/src/database/schema";
import {
  featureDisabledMessage,
  PROJECT_FEATURE_KEYS,
  projectFeatureField,
} from "../../../apps/api/src/project/features";
import { updateProjectFeaturesBody } from "../../../apps/api/src/project/schema";

describe("project feature catalog", () => {
  it("maps every feature to an existing project column", () => {
    expect(PROJECT_FEATURE_KEYS.map(projectFeatureField)).toEqual([
      "cyclesEnabled",
      "modulesEnabled",
      "viewsEnabled",
      "pagesEnabled",
      "intakeEnabled",
      "estimatesEnabled",
      "timeTrackingEnabled",
      "aiEnabled",
    ]);
    for (const feature of PROJECT_FEATURE_KEYS) {
      expect(projectTable[projectFeatureField(feature)]).toBeDefined();
    }
  });

  it("names the feature in the disabled message", () => {
    expect(featureDisabledMessage("cycles")).toBe(
      "The Cycles feature is turned off for this project.",
    );
    expect(featureDisabledMessage("timeTracking")).toBe(
      "The Time tracking feature is turned off for this project.",
    );
  });

  it("uses the product defaults for new projects", () => {
    const defaults = Object.fromEntries(
      PROJECT_FEATURE_KEYS.map((feature) => [
        feature,
        projectTable[projectFeatureField(feature)].default,
      ]),
    );
    expect(defaults).toEqual({
      cycles: true,
      modules: true,
      views: true,
      pages: true,
      intake: false,
      estimates: false,
      timeTracking: true,
      ai: true,
    });
  });
});

describe("feature update body", () => {
  it("accepts any subset of the flags", () => {
    expect(
      updateProjectFeaturesBody.safeParse({ cyclesEnabled: false }).success,
    ).toBe(true);
  });

  it("rejects unknown keys and non-boolean values", () => {
    expect(
      updateProjectFeaturesBody.safeParse({ cyclesEnabled: true, extra: 1 })
        .success,
    ).toBe(false);
    expect(
      updateProjectFeaturesBody.safeParse({ pagesEnabled: "yes" }).success,
    ).toBe(false);
  });
});
