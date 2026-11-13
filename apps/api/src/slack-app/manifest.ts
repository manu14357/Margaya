import { publicApiUrl, publicWebUrl } from "../utils/desktop-config";
import { SHORTCUT_CREATE_TASK } from "./blocks";
import type { SlackMode } from "./store";

// The Slack app manifest an admin pastes into "Create an app › From a
// manifest". Socket Mode needs no public URL; HTTP mode points Events,
// Interactivity and the slash command at this workspace's signed endpoint.

export function slackEventsUrl(workspaceId: string): string {
  return `${publicApiUrl()}/api/slack/events/${encodeURIComponent(workspaceId)}`;
}

/** The web host Slack may unfurl, or null for hosts Slack won't accept. */
export function unfurlDomain(webUrl = publicWebUrl()): string | null {
  let host: string;
  try {
    host = new URL(webUrl).hostname;
  } catch {
    return null;
  }
  if (
    host === "localhost" ||
    !host.includes(".") ||
    /^\d+\.\d+\.\d+\.\d+$/.test(host) ||
    host.includes(":")
  ) {
    return null;
  }
  return host;
}

export function buildSlackManifest(input: {
  mode: SlackMode;
  workspaceId: string;
  expandTaskKeys: boolean;
  appName?: string;
}): Record<string, unknown> {
  const http = input.mode === "http";
  const url = slackEventsUrl(input.workspaceId);
  const domain = unfurlDomain();
  const botScopes = [
    "commands",
    "chat:write",
    "incoming-webhook",
    "links:read",
    "links:write",
    ...(input.expandTaskKeys ? ["channels:history", "groups:history"] : []),
  ];
  const botEvents = [
    ...(domain ? ["link_shared"] : []),
    ...(input.expandTaskKeys ? ["message.channels", "message.groups"] : []),
  ];
  const name = (input.appName ?? "Margaya").slice(0, 35);

  return {
    display_information: {
      name,
      description: "Search, capture and update Margaya tasks from Slack.",
      background_color: "#1f3d2b",
    },
    features: {
      bot_user: { display_name: name, always_online: true },
      slash_commands: [
        {
          command: "/margaya",
          description: "Search Margaya or capture a task",
          usage_hint: "search login | add WEB Fix login @ana !high friday",
          should_escape: false,
          ...(http ? { url } : {}),
        },
      ],
      shortcuts: [
        {
          name: "Create Margaya task",
          type: "message",
          callback_id: SHORTCUT_CREATE_TASK,
          description: "Turn this message into a task or an intake request",
        },
      ],
      ...(domain ? { unfurl_domains: [domain] } : {}),
    },
    oauth_config: { scopes: { bot: botScopes } },
    settings: {
      ...(botEvents.length > 0
        ? {
            event_subscriptions: {
              ...(http ? { request_url: url } : {}),
              bot_events: botEvents,
            },
          }
        : {}),
      interactivity: {
        is_enabled: true,
        ...(http ? { request_url: url } : {}),
      },
      org_deploy_enabled: false,
      socket_mode_enabled: !http,
      token_rotation_enabled: false,
    },
  };
}
