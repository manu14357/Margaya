import { describe, expect, it } from "vitest";
import messages from "../../../../../i18n/en-US.json";
import { finalStateOf } from "../../demo";
import { createAuditLogScene } from "./audit-log-scene";
import { auditReducer, initialAuditState } from "./state";

describe("audit log scene", () => {
  it("ends with the three new entries on top, newest first, settled", () => {
    const final = finalStateOf(createAuditLogScene());
    expect(final.entries).toEqual([
      "apiKey",
      "integration",
      "webhook",
      "role",
      "publicBoard",
      "purge",
      "import",
    ]);
    expect(final.fresh).toBeNull();
  });

  it("moves a repeated entry to the top instead of duplicating it", () => {
    const state = auditReducer(initialAuditState, {
      type: "arrive",
      id: "purge",
    });
    expect(state.entries[0]).toBe("purge");
    expect(state.entries).toHaveLength(initialAuditState.entries.length);
    expect(state.fresh).toBe("purge");
  });

  it("has copy for every entry", () => {
    const final = finalStateOf(createAuditLogScene());
    for (const id of final.entries) {
      expect(messages.landing.demo.auditLog.entries[id].action).toBeTruthy();
    }
  });
});
