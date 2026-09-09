function clientUrl() {
  return (process.env.MARGAYA_CLIENT_URL || "http://localhost:5173").replace(
    /\/+$/,
    "",
  );
}

/** Where a user changes how they are notified (linked from every batch). */
export function notificationSettingsUrl() {
  return `${clientUrl()}/dashboard/settings/account/notifications`;
}

export function workspaceInboxUrl(workspaceId: string) {
  return `${clientUrl()}/dashboard/workspace/${workspaceId}/inbox`;
}
