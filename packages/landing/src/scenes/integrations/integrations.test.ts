import { describe, expect, it } from "vitest";
import messages from "../../../../../i18n/en-US.json";
import { finalStateOf } from "../../demo";
import { createIntegrationsScene } from "./integrations-scene";
import {
  INTEGRATIONS,
  initialIntegrationsState,
  integrationsReducer,
} from "./state";

describe("integrations scene", () => {
  it("ends with Slack and Telegram connected", () => {
    const final = finalStateOf(createIntegrationsScene());
    expect(final.connected).toEqual([
      "github",
      "webhooks",
      "slack",
      "telegram",
    ]);
    expect(final.fresh).toBe("telegram");
  });

  it("never connects or disconnects the built-in API and MCP", () => {
    expect(
      integrationsReducer(initialIntegrationsState, {
        type: "connect",
        id: "mcp",
      }),
    ).toBe(initialIntegrationsState);
  });

  it("disconnects what was connected", () => {
    const state = integrationsReducer(initialIntegrationsState, {
      type: "disconnect",
      id: "github",
    });
    expect(state.connected).toEqual(["webhooks"]);
  });

  it("lists every integration the spec names, each with copy", () => {
    expect(INTEGRATIONS).toHaveLength(11);
    for (const id of INTEGRATIONS) {
      expect(messages.landing.demo.integrations.items[id].name).toBeTruthy();
    }
  });
});
