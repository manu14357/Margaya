import { describe, expect, it } from "vitest";
import {
  createModulePayload,
  isModuleFormDirty,
  type ModuleFormValues,
  updateModulePayload,
  validateModuleForm,
} from "./form";

const blank: ModuleFormValues = {
  name: "",
  description: "",
  status: "backlog",
  startDate: null,
  targetDate: null,
  leadId: null,
  memberIds: [],
};

describe("validateModuleForm", () => {
  it("requires a name of at most 255 characters", () => {
    expect(validateModuleForm({ ...blank, name: "   " })).toEqual([
      { field: "name", key: "modules:form.nameRequired" },
    ]);
    expect(validateModuleForm({ ...blank, name: "x".repeat(256) })).toEqual([
      { field: "name", key: "modules:form.nameTooLong" },
    ]);
  });

  it("limits the description and orders the dates", () => {
    expect(
      validateModuleForm({
        ...blank,
        name: "Billing",
        description: "x".repeat(5001),
        startDate: "2026-05-02",
        targetDate: "2026-05-01",
      }).map((error) => error.key),
    ).toEqual(["modules:form.descriptionTooLong", "modules:form.dateOrder"]);
    expect(
      validateModuleForm({
        ...blank,
        name: "Billing",
        startDate: "2026-05-01",
        targetDate: "2026-05-01",
      }),
    ).toEqual([]);
  });
});

describe("payloads", () => {
  it("creates with the name and status plus what was filled in", () => {
    expect(
      createModulePayload({
        ...blank,
        name: "  Billing ",
        description: "  ",
        targetDate: "2026-06-30",
        memberIds: ["ann"],
      }),
    ).toEqual({
      name: "Billing",
      status: "backlog",
      targetDate: "2026-06-30",
      memberIds: ["ann"],
    });
  });

  it("updates only what changed, clearing with null", () => {
    const original: ModuleFormValues = {
      ...blank,
      name: "Billing",
      description: "Old",
      startDate: "2026-05-01",
      leadId: "ann",
      memberIds: ["bob", "carl"],
    };
    expect(
      updateModulePayload(
        {
          ...original,
          description: "",
          startDate: null,
          memberIds: ["carl", "bob"],
        },
        original,
      ),
    ).toEqual({ description: null, startDate: null });
    expect(isModuleFormDirty(original, original)).toBe(false);
    expect(isModuleFormDirty({ ...original, name: "Billing " }, original)).toBe(
      true,
    );
  });
});
