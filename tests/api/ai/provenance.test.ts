import { beforeEach, describe, expect, it, vi } from "vitest";

// The database answers every select with the next queued rows.
const state = vi.hoisted(() => ({
  rows: [] as unknown[][],
  via: null as null | {
    agentId: string;
    agentUserId: string;
    agentName: string;
    onBehalfOf: string;
    onBehalfOfName: string | null;
    runId: string;
  },
}));

vi.mock("../../../apps/api/src/database", () => {
  const chain = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: async () => state.rows.shift() ?? [],
  };
  return { default: chain };
});
vi.mock("../../../apps/api/src/ai-agent/attribution", () => ({
  currentAgentVia: () => state.via,
}));

const {
  aiWriteProvenance,
  commentAiProvenance,
  markHumanEdit,
  nextAiProvenance,
} = await import("../../../apps/api/src/ai/provenance");
const { formatAiProvenance } = await import(
  "../../../apps/api/src/task-export/columns"
);
const { AI_LABEL_GRACE_MS, pageProvenanceAfterEdit } = await import(
  "../../../apps/api/src/page/persistence"
);

const NOW = new Date("2026-11-13T10:00:00.000Z");

const assisted = {
  source: "assist" as const,
  feature: "editor_assist",
  model: "model-fast",
  agentId: null,
  agentName: null,
  requestedById: "u1",
  generatedAt: "2026-11-13T09:00:00.000Z",
  editedById: null,
  editedByName: null,
  editedAt: null,
};

beforeEach(() => {
  state.rows = [];
  state.via = null;
});

describe("AI provenance of a write", () => {
  it("is null for a person's own text", async () => {
    expect(await aiWriteProvenance({ userId: "u1", now: NOW })).toBeNull();
  });

  it("records accepted AI text with the model from the ledger", async () => {
    state.rows = [[{ model: "model-fast" }]];
    expect(
      await aiWriteProvenance({
        workspaceId: "w1",
        userId: "u1",
        assist: { feature: "spec_draft" },
        now: NOW,
      }),
    ).toEqual({
      source: "assist",
      feature: "spec_draft",
      model: "model-fast",
      agentId: null,
      agentName: null,
      requestedById: "u1",
      generatedAt: NOW.toISOString(),
      editedById: null,
      editedByName: null,
      editedAt: null,
    });
  });

  it("leaves the model empty when the ledger has no recent call", async () => {
    const provenance = await aiWriteProvenance({
      userId: "u1",
      assist: { feature: "editor_assist" },
      now: NOW,
    });
    expect(provenance?.model).toBeNull();
  });

  it("marks an agent's write without any claim from the client", async () => {
    state.via = {
      agentId: "a1",
      agentUserId: "agent-user",
      agentName: "Triage bot",
      onBehalfOf: "u1",
      onBehalfOfName: "Ada",
      runId: "r1",
    };
    state.rows = [[{ model: "model-deep" }]];
    expect(
      await aiWriteProvenance({ userId: "agent-user", now: NOW }),
    ).toMatchObject({
      source: "agent",
      feature: "agent_run",
      model: "model-deep",
      agentId: "a1",
      agentName: "Triage bot",
      requestedById: "u1",
    });
  });
});

describe("the provenance after a save", () => {
  it("keeps the stored value when the text did not change", async () => {
    expect(
      await nextAiProvenance({
        existing: assisted,
        changed: false,
        userId: "u2",
        assist: { feature: "editor_assist" },
      }),
    ).toBeUndefined();
  });

  it("leaves human text unlabelled", async () => {
    expect(
      await nextAiProvenance({ existing: null, changed: true, userId: "u2" }),
    ).toBeUndefined();
  });

  it("names a person who changes AI-written text", async () => {
    state.rows = [[{ name: "Mia" }]];
    expect(
      await nextAiProvenance({
        existing: assisted,
        changed: true,
        userId: "u2",
        now: NOW,
      }),
    ).toEqual({
      ...assisted,
      editedById: "u2",
      editedByName: "Mia",
      editedAt: NOW.toISOString(),
    });
  });

  it("replaces the label when AI rewrites the text", async () => {
    const next = await nextAiProvenance({
      existing: markHumanEdit(assisted, { id: "u2", name: "Mia" }, NOW),
      changed: true,
      userId: "u1",
      assist: { feature: "summarize" },
      now: NOW,
    });
    expect(next).toMatchObject({ feature: "summarize", editedById: null });
  });
});

describe("comment provenance", () => {
  it("reads older agent comments from their attribution", () => {
    expect(
      commentAiProvenance({
        aiProvenance: null,
        eventData: {
          via: { agentId: "a1", agentName: "Triage bot", onBehalfOf: "u1" },
        },
        createdAt: NOW,
      }),
    ).toMatchObject({
      source: "agent",
      agentName: "Triage bot",
      requestedById: "u1",
      generatedAt: NOW.toISOString(),
    });
  });

  it("is null for a person's comment", () => {
    expect(commentAiProvenance({ eventData: null, createdAt: NOW })).toBeNull();
  });
});

describe("page edits", () => {
  it("ignores saves right after the label, which carry the AI text", async () => {
    const fresh = { ...assisted, generatedAt: NOW.toISOString() };
    const soon = new Date(NOW.getTime() + AI_LABEL_GRACE_MS - 1);
    expect(
      await pageProvenanceAfterEdit(
        // biome-ignore lint/suspicious/noExplicitAny: the mocked database
        (await import("../../../apps/api/src/database")).default as any,
        fresh,
        "u2",
        soon,
      ),
    ).toBeUndefined();
  });

  it("names the editor of a later change", async () => {
    state.rows = [[{ name: "Mia" }]];
    const result = await pageProvenanceAfterEdit(
      // biome-ignore lint/suspicious/noExplicitAny: the mocked database
      (await import("../../../apps/api/src/database")).default as any,
      assisted,
      "u2",
      NOW,
    );
    expect(result).toMatchObject({ editedById: "u2", editedByName: "Mia" });
  });

  it("does nothing for a page AI never wrote", async () => {
    expect(
      await pageProvenanceAfterEdit(
        // biome-ignore lint/suspicious/noExplicitAny: the mocked database
        (await import("../../../apps/api/src/database")).default as any,
        null,
        "u2",
        NOW,
      ),
    ).toBeUndefined();
  });
});

describe("export cell", () => {
  it("summarises who wrote the text and who edited it", () => {
    expect(formatAiProvenance(null)).toBe("");
    expect(formatAiProvenance(assisted)).toBe(
      "assist: editor_assist (model-fast)",
    );
    expect(
      formatAiProvenance({
        ...assisted,
        source: "agent",
        agentId: "a1",
        agentName: "Triage bot",
        model: null,
        editedById: "u2",
        editedByName: "Mia",
      }),
    ).toBe("agent: Triage bot; edited by Mia");
  });
});
