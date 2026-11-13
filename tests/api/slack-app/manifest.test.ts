import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildSlackManifest,
  slackEventsUrl,
  unfurlDomain,
} from "../../../apps/api/src/slack-app/manifest";

afterEach(() => {
  vi.unstubAllEnvs();
});

type Manifest = {
  features: {
    slash_commands: Array<{ command: string; url?: string }>;
    shortcuts: Array<{ callback_id: string; type: string }>;
    unfurl_domains?: string[];
  };
  oauth_config: { scopes: { bot: string[] } };
  settings: {
    socket_mode_enabled: boolean;
    interactivity: { is_enabled: boolean; request_url?: string };
    event_subscriptions?: { request_url?: string; bot_events: string[] };
  };
};

describe("Slack app manifest", () => {
  it("defaults to Socket Mode with no public URL anywhere", () => {
    vi.stubEnv("MARGAYA_CLIENT_URL", "https://pm.example.com");
    vi.stubEnv("MARGAYA_API_URL", "https://pm.example.com");
    const manifest = buildSlackManifest({
      mode: "socket",
      workspaceId: "ws-1",
      expandTaskKeys: false,
    }) as unknown as Manifest;
    expect(manifest.settings.socket_mode_enabled).toBe(true);
    expect(JSON.stringify(manifest)).not.toContain("/api/slack/events");
    expect(manifest.features.slash_commands[0]?.command).toBe("/margaya");
    expect(manifest.features.shortcuts[0]).toMatchObject({
      callback_id: "margaya_create_task",
      type: "message",
    });
    expect(manifest.features.unfurl_domains).toEqual(["pm.example.com"]);
    expect(manifest.settings.event_subscriptions?.bot_events).toEqual([
      "link_shared",
    ]);
    // No message history unless task key previews are on.
    expect(manifest.oauth_config.scopes.bot).not.toContain("channels:history");
  });

  it("points every request URL at the workspace's signed endpoint in HTTP mode", () => {
    vi.stubEnv("MARGAYA_CLIENT_URL", "https://pm.example.com");
    vi.stubEnv("MARGAYA_API_URL", "https://api.example.com");
    const url = "https://api.example.com/api/slack/events/ws-1";
    expect(slackEventsUrl("ws-1")).toBe(url);
    const manifest = buildSlackManifest({
      mode: "http",
      workspaceId: "ws-1",
      expandTaskKeys: true,
    }) as unknown as Manifest;
    expect(manifest.settings.socket_mode_enabled).toBe(false);
    expect(manifest.features.slash_commands[0]?.url).toBe(url);
    expect(manifest.settings.interactivity.request_url).toBe(url);
    expect(manifest.settings.event_subscriptions?.request_url).toBe(url);
    expect(manifest.settings.event_subscriptions?.bot_events).toContain(
      "message.channels",
    );
    expect(manifest.oauth_config.scopes.bot).toContain("channels:history");
  });

  it("leaves out unfurls for hosts Slack won't accept", () => {
    expect(unfurlDomain("http://localhost:5173")).toBeNull();
    expect(unfurlDomain("http://192.168.1.10:5173")).toBeNull();
    expect(unfurlDomain("https://intranet")).toBeNull();
    expect(unfurlDomain("https://pm.example.com/margaya")).toBe(
      "pm.example.com",
    );
  });
});
