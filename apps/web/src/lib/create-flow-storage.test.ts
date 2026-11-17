import { afterEach, describe, expect, it } from "vitest";
import {
  countCreatedProject,
  DRAFT_TTL_MS,
  readFirstSteps,
  readLastChoice,
  readProjectDraft,
  readWorkspaceDraft,
  readWorkspaceIntent,
  writeFirstSteps,
  writeLastChoice,
  writeProjectDraft,
  writeWorkspaceDraft,
  writeWorkspaceIntent,
} from "./create-flow-storage";

afterEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe("create flow storage", () => {
  it("remembers the last choice per user and workspace", () => {
    writeLastChoice("u", "w", { categoryId: "it", templateId: "kanban" });
    expect(readLastChoice("u", "w")).toEqual({
      categoryId: "it",
      templateId: "kanban",
    });
    expect(readLastChoice("u", "other")).toBeNull();
  });

  it("keeps project drafts for 30 minutes only", () => {
    writeProjectDraft("u", "w", { step: "setup" }, 1000);
    expect(readProjectDraft("u", "w", 1000 + DRAFT_TTL_MS)).toMatchObject({
      step: "setup",
    });
    expect(readProjectDraft("u", "w", 1001 + DRAFT_TTL_MS)).toBeNull();
    // An expired draft is gone for good.
    expect(readProjectDraft("u", "w", 1000)).toBeNull();
  });

  it("keeps workspace drafts with their intent", () => {
    writeWorkspaceDraft("u", { name: "Acme", description: "", intent: "it" });
    expect(readWorkspaceDraft("u")).toEqual({
      name: "Acme",
      description: "",
      intent: "it",
    });
  });

  it("stores and clears the workspace intent", () => {
    writeWorkspaceIntent("w", "marketing");
    expect(readWorkspaceIntent("w")).toBe("marketing");
    writeWorkspaceIntent("w", null);
    expect(readWorkspaceIntent("w")).toBeNull();
  });

  it("counts created projects", () => {
    expect(countCreatedProject("u", "w")).toBe(1);
    expect(countCreatedProject("u", "w")).toBe(2);
  });

  it("merges first-steps changes", () => {
    writeFirstSteps("p", { projectName: "Support", sampleTaskCount: 6 });
    writeFirstSteps("p", { done: ["addTask"] });
    expect(readFirstSteps("p")).toMatchObject({
      projectName: "Support",
      sampleTaskCount: 6,
      done: ["addTask"],
      dismissed: false,
    });
  });

  it("ignores corrupt values", () => {
    window.localStorage.setItem("margaya:create-flow:first-steps:p", "{nope");
    expect(readFirstSteps("p")).toBeNull();
  });
});
