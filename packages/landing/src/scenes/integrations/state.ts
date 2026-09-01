export type IntegrationId =
  | "github"
  | "gitea"
  | "slack"
  | "discord"
  | "telegram"
  | "mattermost"
  | "ntfy"
  | "gotify"
  | "webhooks"
  | "api"
  | "mcp";

export const INTEGRATIONS: readonly IntegrationId[] = [
  "github",
  "gitea",
  "slack",
  "discord",
  "telegram",
  "mattermost",
  "ntfy",
  "gotify",
  "webhooks",
  "api",
  "mcp",
];

/** The REST API and MCP ship with every instance: nothing to connect. */
export const BUILT_IN: readonly IntegrationId[] = ["api", "mcp"];

export type IntegrationsState = {
  connected: IntegrationId[];
  /** The tile that just changed, highlighted for a moment. */
  fresh: IntegrationId | null;
};

export type IntegrationsAction =
  | { type: "connect"; id: IntegrationId }
  | { type: "disconnect"; id: IntegrationId };

export const initialIntegrationsState: IntegrationsState = {
  connected: ["github", "webhooks"],
  fresh: null,
};

export function integrationsReducer(
  state: IntegrationsState,
  action: IntegrationsAction,
): IntegrationsState {
  if (BUILT_IN.includes(action.id)) return state;
  switch (action.type) {
    case "connect":
      if (state.connected.includes(action.id)) return state;
      return { connected: [...state.connected, action.id], fresh: action.id };
    case "disconnect":
      return {
        connected: state.connected.filter((id) => id !== action.id),
        fresh: null,
      };
  }
}
