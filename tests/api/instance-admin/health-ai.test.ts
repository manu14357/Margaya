import { describe, expect, it, vi } from "vitest";
import type { AiInstanceConfig } from "../../../apps/api/src/ai/instance-config";

vi.mock("../../../apps/api/src/database", () => ({ default: {} }));

const { aiProviderConfigured } = await import(
  "../../../apps/api/src/instance-admin/controllers/health"
);

const config = (overrides: Partial<AiInstanceConfig>): AiInstanceConfig =>
  ({
    enabled: true,
    provider: "anthropic",
    anthropicApiKey: "",
    openai: { baseUrl: "", apiKey: "" },
    local: { baseUrl: "", model: "", apiKey: "" },
    localOnly: false,
    route: { restricted: "local", private: "cloud" },
    ...overrides,
  }) as AiInstanceConfig;

const local = {
  baseUrl: "http://ollama:11434/v1",
  model: "llama3.3",
  apiKey: "",
};

describe("health: AI provider check", () => {
  it("counts a local endpoint with a model as set up", () => {
    expect(aiProviderConfigured(config({ local }))).toBe(true);
    expect(
      aiProviderConfigured(
        config({ local, route: { restricted: "cloud", private: "cloud" } }),
      ),
    ).toBe(true);
  });

  it("warns when nothing is set up", () => {
    expect(aiProviderConfigured(config({}))).toBe(false);
    expect(aiProviderConfigured(config({ localOnly: true }))).toBe(false);
    expect(
      aiProviderConfigured(
        config({ local: { baseUrl: local.baseUrl, model: "", apiKey: "" } }),
      ),
    ).toBe(false);
  });

  it("counts a cloud key or base URL", () => {
    expect(aiProviderConfigured(config({ anthropicApiKey: "sk-ant-x" }))).toBe(
      true,
    );
    expect(
      aiProviderConfigured(
        config({
          provider: "openai_compatible",
          openai: { baseUrl: "https://api.example.com/v1", apiKey: "" },
        } as Partial<AiInstanceConfig>),
      ),
    ).toBe(true);
    // Local-only mode needs the local model, whatever the cloud has.
    expect(
      aiProviderConfigured(
        config({ localOnly: true, anthropicApiKey: "sk-ant-x" }),
      ),
    ).toBe(false);
  });
});
