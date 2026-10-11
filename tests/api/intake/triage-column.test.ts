import { describe, expect, it } from "vitest";
import { pickTriageSlug } from "../../../apps/api/src/intake/triage-column";

describe("pickTriageSlug", () => {
  it("uses triage when it is free", () => {
    expect(pickTriageSlug(["to-do", "done"])).toBe("triage");
    expect(pickTriageSlug([])).toBe("triage");
  });

  it("counts up past taken slugs", () => {
    expect(pickTriageSlug(["triage"])).toBe("triage-2");
    expect(pickTriageSlug(["triage", "triage-2"])).toBe("triage-3");
    expect(pickTriageSlug(["triage", "triage-3"])).toBe("triage-2");
  });
});
