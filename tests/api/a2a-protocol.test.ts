import { describe, expect, it } from "vitest";
import { buildAgentCard } from "../../apps/api/src/a2a/card";
import {
  A2A_ERRORS,
  A2aError,
  decodePageToken,
  encodePageToken,
  intakeState,
  isTerminal,
  messageSchema,
  parseParams,
  runState,
  sendMessageParams,
  skillInput,
  splitTitle,
  versionSupported,
} from "../../apps/api/src/a2a/protocol";

// A2A 1.0 conformance of the pure pieces: the Agent Card's required fields
// and ProtoJSON names, the task state mapping, and message parsing.

const BASE = "https://pm.example";

describe("A2A Agent Card", () => {
  const card = buildAgentCard({ baseUrl: BASE, aiEnabled: true });

  it("has every field A2A 1.0 requires", () => {
    for (const field of [
      "name",
      "description",
      "supportedInterfaces",
      "version",
      "capabilities",
      "defaultInputModes",
      "defaultOutputModes",
      "skills",
    ]) {
      expect(card).toHaveProperty(field);
    }
    expect(card.supportedInterfaces).toEqual([
      {
        url: `${BASE}/api/a2a`,
        protocolBinding: "JSONRPC",
        protocolVersion: "1.0",
      },
    ]);
    expect(card.capabilities).toEqual({
      streaming: true,
      pushNotifications: true,
      extendedAgentCard: true,
    });
    for (const skill of card.skills) {
      expect(skill.id).toBeTruthy();
      expect(skill.name).toBeTruthy();
      expect(skill.description).toBeTruthy();
      expect(skill.tags.length).toBeGreaterThan(0);
    }
    expect(card.skills.map((skill) => skill.id)).toEqual([
      "create_task",
      "triage_request",
      "ask_workspace",
      "run_agent",
    ]);
  });

  it("uses ProtoJSON security scheme wrappers and requirements", () => {
    expect(card.securitySchemes.bearer).toEqual({
      httpAuthSecurityScheme: expect.objectContaining({ scheme: "Bearer" }),
    });
    expect(card.securitySchemes.apiKey.apiKeySecurityScheme).toMatchObject({
      location: "header",
      name: "x-api-key",
    });
    expect(
      card.securitySchemes.oauth2.oauth2SecurityScheme.flows.authorizationCode,
    ).toMatchObject({
      authorizationUrl: `${BASE}/api/mcp/authorize`,
      tokenUrl: `${BASE}/api/mcp/token`,
      pkceRequired: true,
    });
    expect(card.securityRequirements).toContainEqual({
      schemes: { bearer: { list: [] } },
    });
  });

  it("names no workspace on the public card and one tenant per workspace on the extended card", () => {
    expect(JSON.stringify(card)).not.toMatch(/tenant/);
    const extended = buildAgentCard({
      baseUrl: BASE,
      aiEnabled: true,
      tenants: ["acme", "labs"],
    });
    expect(extended.supportedInterfaces.map((i) => i.tenant)).toEqual([
      "acme",
      "labs",
    ]);
  });

  it("leaves out the AI skills while AI is off", () => {
    const off = buildAgentCard({ baseUrl: BASE, aiEnabled: false });
    expect(off.skills.map((skill) => skill.id)).toEqual([
      "create_task",
      "triage_request",
    ]);
  });
});

describe("A2A task state mapping", () => {
  it("maps intake statuses", () => {
    expect(intakeState("pending")).toBe("TASK_STATE_SUBMITTED");
    expect(intakeState("snoozed")).toBe("TASK_STATE_SUBMITTED");
    expect(intakeState("accepted")).toBe("TASK_STATE_COMPLETED");
    expect(intakeState("duplicate")).toBe("TASK_STATE_COMPLETED");
    expect(intakeState("declined")).toBe("TASK_STATE_REJECTED");
  });

  it("maps agent run statuses", () => {
    expect(runState("queued")).toBe("TASK_STATE_SUBMITTED");
    expect(runState("running")).toBe("TASK_STATE_WORKING");
    // A person approves, not the calling agent: not input-required.
    expect(runState("awaiting_approval")).toBe("TASK_STATE_WORKING");
    expect(runState("succeeded")).toBe("TASK_STATE_COMPLETED");
    expect(runState("failed")).toBe("TASK_STATE_FAILED");
    expect(runState("cancelled")).toBe("TASK_STATE_CANCELED");
  });

  it("knows the terminal states", () => {
    expect(isTerminal("TASK_STATE_COMPLETED")).toBe(true);
    expect(isTerminal("TASK_STATE_REJECTED")).toBe(true);
    expect(isTerminal("TASK_STATE_WORKING")).toBe(false);
    expect(isTerminal("TASK_STATE_SUBMITTED")).toBe(false);
  });
});

describe("A2A messages", () => {
  const message = (parts: unknown[], extra: Record<string, unknown> = {}) =>
    messageSchema.parse({
      messageId: "m1",
      role: "ROLE_USER",
      parts,
      ...extra,
    });

  it("reads the skill from a data part, metadata, or defaults to triage", () => {
    expect(
      skillInput(
        message([{ text: "Fix it" }, { data: { skill: "create_task" } }]),
      ).skill,
    ).toBe("create_task");
    expect(
      skillInput(
        message([{ text: "Q" }], { metadata: { skill: "ask_workspace" } }),
      ).skill,
    ).toBe("ask_workspace");
    expect(skillInput(message([{ text: "Hi" }])).skill).toBe("triage_request");
  });

  it("refuses unknown skills and file parts", () => {
    expect(() =>
      skillInput(message([{ data: { skill: "delete_everything" } }])),
    ).toThrow(A2aError);
    try {
      skillInput(message([{ url: "https://x.example/a.pdf" }]));
    } catch (error) {
      expect((error as A2aError).code).toBe(A2A_ERRORS.contentTypeNotSupported);
    }
  });

  it("accepts lower-case roles and rejects messages without parts", () => {
    expect(message([{ text: "x" }], { role: "user" }).role).toBe("ROLE_USER");
    expect(() =>
      parseParams(sendMessageParams, {
        message: { messageId: "m", role: "ROLE_USER", parts: [] },
      }),
    ).toThrow(A2aError);
  });

  it("splits a title from the text", () => {
    expect(splitTitle("Title\nLine 2\nLine 3")).toEqual({
      title: "Title",
      description: "Line 2\nLine 3",
    });
  });

  it("round-trips page tokens and rejects garbage", () => {
    const at = new Date("2026-10-21T10:00:00.000Z");
    expect(decodePageToken(encodePageToken(at, "abc"))).toEqual({
      createdAt: at,
      id: "abc",
    });
    expect(decodePageToken("not-a-token")).toBeNull();
  });

  it("negotiates A2A-Version", () => {
    expect(versionSupported("1.0", "SendMessage")).toBe(true);
    expect(versionSupported("1.0.0", "GetTask")).toBe(true);
    expect(versionSupported("0.3", "SendMessage")).toBe(false);
    // No header: 0.3 to the spec, unless the method name is a 1.0 one.
    expect(versionSupported(undefined, "SendMessage")).toBe(true);
    expect(versionSupported(undefined, "message/send")).toBe(false);
  });
});
