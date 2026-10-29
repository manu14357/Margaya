import { describe, expect, it, vi } from "vitest";

// Pure pieces of the intake trigger and of ai.retention.storePrompts.
// Nothing here touches the database.
vi.mock("../../../apps/api/src/database", () => ({ default: {} }));
vi.mock("../../../apps/api/src/ai-agent/events", () => ({
  publishRunUpdated: vi.fn(),
}));

const { BACKGROUND_TRIGGERS, INTAKE_REQUEST, triggerNote } = await import(
  "../../../apps/api/src/ai-agent/run-context"
);
const { retainedInput } = await import(
  "../../../apps/api/src/ai-agent/run-state"
);
const { aiInstanceConfigOf } = await import(
  "../../../apps/api/src/ai/instance-config"
);
const { resolveInstanceSettings } = await import(
  "../../../apps/api/src/instance-settings/resolve"
);
const { settingDefinition } = await import(
  "../../../apps/api/src/instance-settings/catalog"
);

describe("intake runs", () => {
  it("are background runs that triage without deciding", () => {
    expect(BACKGROUND_TRIGGERS).toContain("intake");
    expect(INTAKE_REQUEST).toContain("add_comment");
    expect(INTAKE_REQUEST).toMatch(/Don't accept, decline or move/);
  });

  it("tell the model the request text is data", () => {
    const note = triggerNote("intake", { canComment: true, hasTask: true });
    expect(note).toMatch(/intake request/);
    expect(note).toMatch(/never instructions/);
    // Without comment rights the answer goes to the person's inbox.
    expect(triggerNote("intake", { canComment: false, hasTask: true })).toMatch(
      /can't comment/,
    );
  });
});

describe("ai.retention.storePrompts", () => {
  it("is an instance setting, off by default, lockable by environment", () => {
    const definition = settingDefinition("ai.retention.storePrompts");
    expect(definition).toMatchObject({
      group: "ai",
      secret: false,
      default: false,
      envVar: "MARGAYA_AI_STORE_PROMPTS",
    });
    const off = aiInstanceConfigOf(
      resolveInstanceSettings({ env: {}, rows: [] }),
      {},
    );
    expect(off.storePrompts).toBe(false);
    const env = { MARGAYA_AI_STORE_PROMPTS: "true" };
    const on = aiInstanceConfigOf(
      resolveInstanceSettings({ env, rows: [] }),
      env,
    );
    expect(on.storePrompts).toBe(true);
    const other = { MARGAYA_AI_STORE_PROMPTS: "yes" };
    expect(
      aiInstanceConfigOf(
        resolveInstanceSettings({ env: other, rows: [] }),
        other,
      ).storePrompts,
    ).toBe(false);
  });

  it("clears a run's input when off and keeps only request and answers when on", () => {
    expect(retainedInput(false)).toBeNull();
    const kept = retainedInput(true);
    expect(kept).not.toBeNull();
  });
});
