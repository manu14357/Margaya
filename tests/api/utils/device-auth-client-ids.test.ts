import { describe, expect, it } from "vitest";
import { getDeviceAuthClientIds } from "../../../apps/api/src/utils/device-auth-client-ids";

describe("device authorization client ids", () => {
  it("allows the CLI, MCP and desktop clients by default", () => {
    expect([...getDeviceAuthClientIds(undefined)].sort()).toEqual([
      "margaya-cli",
      "margaya-desktop",
      "margaya-mcp",
    ]);
    expect(getDeviceAuthClientIds("  ").has("margaya-desktop")).toBe(true);
  });

  it("uses exactly the configured list when set", () => {
    const ids = getDeviceAuthClientIds(" margaya-cli , other-client ,");
    expect([...ids].sort()).toEqual(["margaya-cli", "other-client"]);
    expect(ids.has("margaya-desktop")).toBe(false);
  });
});
