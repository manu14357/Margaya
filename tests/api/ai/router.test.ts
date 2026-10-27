import { describe, expect, it } from "vitest";
import {
  type AiInstanceConfig,
  aiInstanceConfigOf,
  modelForTier,
} from "../../../apps/api/src/ai/instance-config";
import {
  allowedTarget,
  dataTierOf,
  routeAiCall,
} from "../../../apps/api/src/ai/router";
import {
  DEFAULT_WORKSPACE_AI_POLICY,
  type WorkspaceAiPolicy,
} from "../../../apps/api/src/ai/workspace-settings";
import { resolveInstanceSettings } from "../../../apps/api/src/instance-settings/resolve";

function instance(overrides: Partial<AiInstanceConfig> = {}): AiInstanceConfig {
  const base = aiInstanceConfigOf(
    resolveInstanceSettings({ env: { NODE_ENV: "test" }, rows: [] }),
    { NODE_ENV: "test" },
  );
  return {
    ...base,
    enabled: true,
    anthropicApiKey: "sk-ant-instance",
    ...overrides,
  };
}

const workspace = (overrides: Partial<WorkspaceAiPolicy> = {}) => ({
  ...DEFAULT_WORKSPACE_AI_POLICY,
  enabled: true,
  ...overrides,
});

const local = { baseUrl: "http://ollama:11434/v1", model: "llama3.3" };

describe("instance AI settings", () => {
  it("is off by default, with Claude and safe routes", () => {
    const config = aiInstanceConfigOf(
      resolveInstanceSettings({ env: {}, rows: [] }),
      {},
    );
    expect(config.enabled).toBe(false);
    expect(config.provider).toBe("anthropic");
    expect(config.route).toEqual({ restricted: "local", private: "cloud" });
    expect(config.localOnly).toBe(false);
    expect(config.redaction).toBe(false);
  });

  it("reads the environment, which locks the values", () => {
    const env = {
      MARGAYA_AI_ENABLED: "true",
      MARGAYA_AI_PROVIDER: "openai_compatible",
      MARGAYA_AI_OPENAI_BASE_URL: "https://llm.example.com/v1",
      MARGAYA_AI_MODEL_BALANCED: "gpt-x",
      ANTHROPIC_API_KEY: "sk-ant-env",
    };
    const snapshot = resolveInstanceSettings({ env, rows: [] });
    const config = aiInstanceConfigOf(snapshot, env);
    expect(config.enabled).toBe(true);
    expect(config.provider).toBe("openai_compatible");
    expect(config.openai.baseUrl).toBe("https://llm.example.com/v1");
    expect(config.anthropicApiKey).toBe("sk-ant-env");
    expect(snapshot.settings["ai.enabled"]?.locked).toBe(true);
  });

  it("refuses the fake provider in production unless allowed", () => {
    const rows = [
      {
        key: "ai.provider",
        value: "fake",
        unreadable: false,
        updatedAt: new Date(),
        updatedBy: null,
      },
    ];
    const snapshot = resolveInstanceSettings({ env: {}, rows });
    expect(
      aiInstanceConfigOf(snapshot, { NODE_ENV: "production" }).provider,
    ).toBe("anthropic");
    expect(
      aiInstanceConfigOf(snapshot, {
        NODE_ENV: "production",
        MARGAYA_AI_ALLOW_FAKE: "true",
      }).provider,
    ).toBe("fake");
    expect(aiInstanceConfigOf(snapshot, { NODE_ENV: "test" }).provider).toBe(
      "fake",
    );
  });

  it("picks Claude defaults per tier and reuses a single configured model", () => {
    const none = { fast: "", balanced: "", deep: "" };
    expect(modelForTier("anthropic", none, "fast")).toBe("claude-haiku-5-5");
    expect(modelForTier("anthropic", none, "balanced")).toBe(
      "claude-sonnet-5-5",
    );
    expect(modelForTier("anthropic", none, "deep")).toBe("claude-opus-5-5");
    const one = { fast: "", balanced: "qwen3", deep: "" };
    expect(modelForTier("openai_compatible", one, "deep")).toBe("qwen3");
    expect(modelForTier("openai_compatible", none, "deep")).toBe("");
  });
});

describe("data tiers", () => {
  it("takes the most sensitive tier and defaults to private", () => {
    expect(dataTierOf([])).toBe("private");
    expect(dataTierOf(["public"])).toBe("public");
    expect(dataTierOf(["public", "private"])).toBe("private");
    expect(dataTierOf(["private", "restricted", "public"])).toBe("restricted");
    expect(dataTierOf(["public"], "private")).toBe("private");
  });
});

describe("model router", () => {
  it("sends private data to the cloud provider by default", () => {
    const decision = routeAiCall({
      instance: instance(),
      workspace: workspace(),
      workspaceApiKey: null,
      dataTier: "private",
      tier: "fast",
    });
    expect(decision).toMatchObject({
      ok: true,
      redact: false,
      destination: {
        kind: "cloud",
        provider: "anthropic",
        model: "claude-haiku-5-5",
        apiKey: "sk-ant-instance",
        allowPrivate: false,
      },
    });
  });

  it("keeps restricted data local, and blocks it without a local model", () => {
    expect(
      routeAiCall({
        instance: instance(),
        workspace: workspace(),
        workspaceApiKey: null,
        dataTier: "restricted",
        tier: "balanced",
      }),
    ).toMatchObject({ ok: false, code: "AI_ROUTE_BLOCKED" });

    expect(
      routeAiCall({
        instance: instance({ local }),
        workspace: workspace(),
        workspaceApiKey: null,
        dataTier: "restricted",
        tier: "balanced",
      }),
    ).toMatchObject({
      ok: true,
      destination: {
        kind: "local",
        provider: "openai_compatible",
        model: "llama3.3",
        baseUrl: local.baseUrl,
        allowPrivate: true,
      },
    });
  });

  it("blocks restricted data entirely when the instance says so", () => {
    expect(
      allowedTarget(
        "restricted",
        instance({
          local,
          localOnly: true,
          route: { restricted: "blocked", private: "cloud" },
        }),
        workspace(),
      ),
    ).toBe("blocked");
  });

  it("lets the instance allow restricted data in the cloud", () => {
    expect(
      allowedTarget(
        "restricted",
        instance({ route: { restricted: "cloud", private: "cloud" } }),
        workspace(),
      ),
    ).toBe("cloud");
  });

  it("forces the local endpoint in local-only mode (instance or workspace)", () => {
    for (const [inst, ws] of [
      [instance({ local, localOnly: true }), workspace()],
      [instance({ local }), workspace({ localOnly: true })],
    ] as const) {
      const decision = routeAiCall({
        instance: inst,
        workspace: ws,
        workspaceApiKey: null,
        dataTier: "public",
        tier: "deep",
      });
      expect(decision).toMatchObject({
        ok: true,
        destination: { kind: "local" },
      });
    }
    expect(
      routeAiCall({
        instance: instance({ localOnly: true }),
        workspace: workspace(),
        workspaceApiKey: null,
        dataTier: "public",
        tier: "fast",
      }),
    ).toMatchObject({ ok: false, code: "AI_NOT_CONFIGURED" });
  });

  it("keeps private data local when the instance routes it there", () => {
    expect(
      routeAiCall({
        instance: instance({
          local,
          route: { restricted: "local", private: "local" },
        }),
        workspace: workspace(),
        workspaceApiKey: null,
        dataTier: "private",
        tier: "fast",
      }),
    ).toMatchObject({ ok: true, destination: { kind: "local" } });
  });

  it("uses a workspace key only when the instance allows it", () => {
    const ws = workspace({ provider: "anthropic", hasKey: true });
    expect(
      routeAiCall({
        instance: instance(),
        workspace: ws,
        workspaceApiKey: "sk-ant-workspace",
        dataTier: "private",
        tier: "fast",
      }),
    ).toMatchObject({
      ok: true,
      destination: { apiKey: "sk-ant-workspace", workspaceKey: true },
    });
    expect(
      routeAiCall({
        instance: instance({ allowWorkspaceKeys: false }),
        workspace: ws,
        workspaceApiKey: "sk-ant-workspace",
        dataTier: "private",
        tier: "fast",
      }),
    ).toMatchObject({
      ok: true,
      destination: { apiKey: "sk-ant-instance", workspaceKey: false },
    });
  });

  it("needs a key or a base URL", () => {
    expect(
      routeAiCall({
        instance: instance({ anthropicApiKey: "" }),
        workspace: workspace(),
        workspaceApiKey: null,
        dataTier: "private",
        tier: "fast",
      }),
    ).toMatchObject({ ok: false, code: "AI_NOT_CONFIGURED" });
    expect(
      routeAiCall({
        instance: instance({ provider: "openai_compatible" }),
        workspace: workspace(),
        workspaceApiKey: null,
        dataTier: "private",
        tier: "fast",
      }),
    ).toMatchObject({ ok: false, code: "AI_NOT_CONFIGURED" });
  });

  it("redacts cloud calls when the instance or workspace asks", () => {
    for (const [inst, ws] of [
      [instance({ redaction: true }), workspace()],
      [instance(), workspace({ redactPii: true })],
    ] as const) {
      expect(
        routeAiCall({
          instance: inst,
          workspace: ws,
          workspaceApiKey: null,
          dataTier: "private",
          tier: "fast",
        }),
      ).toMatchObject({ ok: true, redact: true });
    }
    expect(
      routeAiCall({
        instance: instance({ local, redaction: true, localOnly: true }),
        workspace: workspace(),
        workspaceApiKey: null,
        dataTier: "private",
        tier: "fast",
      }),
    ).toMatchObject({ ok: true, redact: false });
  });
});
