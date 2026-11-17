import { describe, expect, it } from "vitest";
import type { ProjectTemplateSummary } from "@/fetchers/project-template/project-templates";
import {
  buildCreateRequest,
  EMPTY_FORM,
  effectiveForm,
  flowReducer,
  initialFlowState,
  suggestionFor,
  validateSetup,
} from "./create-flow-model";

const counts = {
  statuses: 5,
  labels: 2,
  customFields: 1,
  views: 2,
  automationRules: 0,
  taskTemplates: 0,
  pages: 0,
  whiteboards: 0,
  modules: 0,
  sampleTasks: 6,
};

const desk = {
  id: "hr-service-desk",
  version: 1,
  categories: ["human-resources"],
  featured: true,
  icon: "Users",
  name: "HR requests",
  pitch: "People questions in one queue",
  description: "",
  suggestedKey: "HR",
  suggestedVisibility: "restricted",
  counts,
  hasSampleData: true,
} satisfies ProjectTemplateSummary;

const preview = {
  ...desk,
  projectDescription: null,
  features: { intake: true, pages: true, cycles: false },
  statuses: [],
  labels: [],
  customFields: [],
  estimate: null,
  modules: [],
  taskTemplates: [],
  views: [],
  automations: [],
  scheduledAutomations: {
    autoArchive: false,
    autoClose: false,
    cycleRollover: false,
    flowAlerts: false,
  },
  intakeForm: true,
  pages: [],
  whiteboards: [],
  sampleTasks: [],
};

describe("suggestionFor", () => {
  it("takes name, key, icon, privacy and features from the template", () => {
    const suggestion = suggestionFor({
      source: { kind: "template", id: desk.id },
      templates: [desk],
      preview,
      projects: [],
    });
    expect(suggestion).toMatchObject({
      name: "HR requests",
      key: "HR",
      icon: "Users",
      visibility: "restricted",
      sampleTaskCount: 6,
      templateId: desk.id,
    });
    expect(suggestion.features.intake).toBe(true);
    expect(suggestion.features.cycles).toBe(false);
  });

  it("keeps today's blank project when the catalog has no blank template", () => {
    const suggestion = suggestionFor({
      source: { kind: "blank" },
      templates: [desk],
      projects: [],
    });
    expect(suggestion.templateId).toBeNull();
    expect(suggestion.features.cycles).toBe(true);
  });
});

describe("effectiveForm", () => {
  const suggestion = suggestionFor({
    source: { kind: "template", id: desk.id },
    templates: [desk],
    preview,
    projects: [],
  });

  it("uses the suggestion until the person types", () => {
    expect(effectiveForm(EMPTY_FORM, suggestion)).toMatchObject({
      name: "HR requests",
      key: "HR",
      visibility: "restricted",
    });
  });

  it("derives the key from a typed name unless the key was edited", () => {
    const typed = { ...EMPTY_FORM, name: "People Ops", nameEdited: true };
    expect(effectiveForm(typed, suggestion).key).toBe("PO");
    expect(
      effectiveForm({ ...typed, key: "ppl", keyEdited: true }, suggestion).key,
    ).toBe("PPL");
  });
});

describe("buildCreateRequest", () => {
  const suggestion = suggestionFor({
    source: { kind: "template", id: desk.id },
    templates: [desk],
    preview,
    projects: [],
  });

  it("sends the template, the locale, example tasks and only changed features", () => {
    const request = buildCreateRequest({
      workspaceId: "ws",
      source: { kind: "template", id: desk.id },
      form: { ...EMPTY_FORM, features: { intake: true, cycles: true } },
      suggestion,
      sampleData: true,
      locale: "de-DE",
      canCopyOpenTasks: false,
    });
    expect(request).toEqual({
      name: "HR requests",
      slug: "HR",
      icon: "Users",
      workspaceId: "ws",
      visibility: "restricted",
      features: { cycles: true },
      template: { id: desk.id, locale: "de-DE", sampleData: true },
    });
  });

  it("copies from a project without a template", () => {
    const request = buildCreateRequest({
      workspaceId: "ws",
      source: { kind: "project", id: "p1" },
      form: {
        ...EMPTY_FORM,
        name: "Copy",
        nameEdited: true,
        copyOpenTasks: true,
        copyTaskTemplates: true,
      },
      suggestion: suggestionFor({
        source: { kind: "project", id: "p1" },
        templates: [],
        projects: [{ id: "p1", name: "Web", icon: "Globe" }],
      }),
      sampleData: false,
      locale: "en-US",
      canCopyOpenTasks: false,
    });
    expect(request).toMatchObject({
      fromProjectId: "p1",
      copy: { taskTemplates: true, openTasks: false },
    });
    expect(request).not.toHaveProperty("template");
  });
});

describe("flowReducer", () => {
  it("keeps typed values when the source changes and resets example tasks", () => {
    let state = initialFlowState();
    state = flowReducer(state, {
      type: "edit",
      change: { name: "Mine", nameEdited: true, sampleData: true },
    });
    state = flowReducer(state, {
      type: "select",
      source: { kind: "project", id: "p" },
    });
    expect(state.form.name).toBe("Mine");
    expect(state.form.sampleData).toBeNull();
  });

  it("continues forward and goes back", () => {
    let state = flowReducer(initialFlowState(), {
      type: "continue",
      viaKeyboard: true,
    });
    expect(state).toMatchObject({
      step: "setup",
      direction: "forward",
      focusName: true,
    });
    state = flowReducer(state, { type: "back" });
    expect(state).toMatchObject({ step: "choose", direction: "back" });
  });

  it("opens Set up for a blank project from the import link", () => {
    const state = flowReducer(
      initialFlowState({ source: { kind: "template", id: "x" } }),
      { type: "import" },
    );
    expect(state).toMatchObject({
      step: "setup",
      source: { kind: "blank" },
      afterCreate: "import",
    });
  });
});

describe("validateSetup", () => {
  it("reports a missing name and a bad key", () => {
    expect(validateSetup(" ", "A B")).toEqual({
      name: "required",
      key: "invalid",
    });
    expect(validateSetup("Site", "WEB")).toEqual({});
  });
});
