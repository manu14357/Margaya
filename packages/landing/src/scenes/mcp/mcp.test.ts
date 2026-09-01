import { describe, expect, it } from "vitest";
import messages from "../../../../../i18n/en-US.json";
import { finalStateOf } from "../../demo";
import { createMcpScene } from "./mcp-scene";
import { initialMcpState, mcpReducer } from "./state";

const demo = messages.landing.demo;

describe("mcp scene", () => {
  it("ends with the prompt sent, three tasks created and a reply", () => {
    const final = finalStateOf(createMcpScene(demo));
    expect(final.prompt).toBe(demo.mcp.prompt);
    expect(final.input).toBe("");
    expect(final.created).toEqual(["announcement", "pressKit", "monitoring"]);
    expect(final.replied).toBe(true);
  });

  it("does nothing without a prompt", () => {
    expect(mcpReducer(initialMcpState, { type: "send" })).toBe(initialMcpState);
    expect(
      mcpReducer(initialMcpState, { type: "create", id: "pressKit" }),
    ).toBe(initialMcpState);
  });

  it("creates each task once", () => {
    const sent = mcpReducer(
      mcpReducer(initialMcpState, { type: "input", value: "Go" }),
      { type: "send" },
    );
    const once = mcpReducer(sent, { type: "create", id: "pressKit" });
    expect(
      mcpReducer(once, { type: "create", id: "pressKit" }).created,
    ).toEqual(["pressKit"]);
  });
});
