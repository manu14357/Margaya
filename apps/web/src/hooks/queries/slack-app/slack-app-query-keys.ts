export const slackAppKeys = {
  all: ["slack-app"] as const,
  workspace: (workspaceId: string) =>
    ["slack-app", "workspace", workspaceId] as const,
  links: () => ["slack-app", "links"] as const,
  linkPreview: (token: string) => ["slack-app", "link-preview", token] as const,
};
