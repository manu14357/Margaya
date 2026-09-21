import { FileText, IterationCw } from "lucide-react";
import { afterEach, describe, expect, it } from "vitest";
import {
  getProjectSections,
  getVisibleProjectSections,
  type ProjectSection,
  projectSectionPath,
  registerProjectSection,
  resolveActiveSection,
  shouldShowSectionStrip,
} from "./project-sections";

const cycles: ProjectSection = {
  id: "cycles",
  labelKey: "navigation:projectNav.cycles",
  icon: IterationCw,
  feature: "cycles",
  segment: "cycles",
};

const pages: ProjectSection = {
  id: "pages",
  labelKey: "navigation:projectNav.pages",
  icon: FileText,
  feature: "pages",
  segment: "pages",
};

const cleanups: Array<() => void> = [];

function register(section: ProjectSection) {
  cleanups.push(registerProjectSection(section));
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

describe("project section registry", () => {
  it("has only Tasks by default, so the strip stays hidden", () => {
    const sections = getProjectSections();
    expect(sections.map((section) => section.id)).toEqual(["tasks"]);
    expect(shouldShowSectionStrip(getVisibleProjectSections(() => true))).toBe(
      false,
    );
  });

  it("keeps the fixed order whatever the registration order", () => {
    register(pages);
    register(cycles);
    expect(getProjectSections().map((section) => section.id)).toEqual([
      "tasks",
      "cycles",
      "pages",
    ]);
  });

  it("shows a section only while its feature is enabled", () => {
    register(cycles);
    register(pages);
    const visible = getVisibleProjectSections((feature) => feature === "pages");
    expect(visible.map((section) => section.id)).toEqual(["tasks", "pages"]);
    expect(shouldShowSectionStrip(visible)).toBe(true);
    expect(shouldShowSectionStrip(getVisibleProjectSections(() => false))).toBe(
      false,
    );
  });

  it("shows a capability section, last, only to people who have it", () => {
    const analytics: ProjectSection = {
      id: "analytics",
      labelKey: "navigation:projectNav.analytics",
      icon: FileText,
      feature: null,
      requires: "readAnalytics",
      align: "end",
      segment: "analytics",
    };
    register(analytics);
    register(cycles);
    expect(
      getVisibleProjectSections(() => false).map((section) => section.id),
    ).toEqual(["tasks"]);
    const visible = getVisibleProjectSections(
      () => false,
      undefined,
      (capability) => capability === "readAnalytics",
    );
    expect(visible.map((section) => section.id)).toEqual([
      "tasks",
      "analytics",
    ]);
    // Analytics alone is enough to show the strip.
    expect(shouldShowSectionStrip(visible)).toBe(true);
    expect(
      getVisibleProjectSections(
        () => true,
        undefined,
        () => true,
      ).map((section) => section.id),
    ).toEqual(["tasks", "cycles", "analytics"]);
  });

  it("refuses to replace the built-in Tasks section", () => {
    expect(() =>
      registerProjectSection({ ...cycles, id: "tasks", feature: null }),
    ).toThrow();
  });

  it("unregisters cleanly", () => {
    const unregister = registerProjectSection(cycles);
    unregister();
    expect(getProjectSections().map((section) => section.id)).toEqual([
      "tasks",
    ]);
  });
});

describe("resolveActiveSection", () => {
  it("maps the task views and task pages to Tasks", () => {
    for (const segment of ["board", "backlog", "calendar", "gantt", "task"]) {
      expect(
        resolveActiveSection(`/dashboard/workspace/w/project/p/${segment}`),
      ).toBe("tasks");
    }
  });

  it("maps a registered segment to its section", () => {
    register(cycles);
    expect(
      resolveActiveSection("/dashboard/workspace/w/project/p/cycles/c1"),
    ).toBe("cycles");
  });

  it("falls back to Tasks for unknown or missing segments", () => {
    expect(resolveActiveSection("/dashboard/workspace/w/project/p")).toBe(
      "tasks",
    );
    expect(
      resolveActiveSection("/dashboard/workspace/w/project/p/cycles"),
    ).toBe("tasks");
  });
});

describe("projectSectionPath", () => {
  it("builds the section's list route", () => {
    expect(projectSectionPath(cycles, "w1", "p1")).toBe(
      "/dashboard/workspace/w1/project/p1/cycles",
    );
  });
});
