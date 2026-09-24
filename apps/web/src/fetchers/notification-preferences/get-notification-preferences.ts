import { getApiUrl } from "@/fetchers/get-api-url";

import { HttpError } from "@/lib/http-error";
export type NotificationPreferenceWorkspaceRule = {
  id: string;
  workspaceId: string;
  workspaceName: string;
  isActive: boolean;
  emailEnabled: boolean;
  ntfyEnabled: boolean;
  gotifyEnabled: boolean;
  webhookEnabled: boolean;
  projectMode: "all" | "selected";
  selectedProjectIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type NotificationPreferences = {
  emailAddress: string | null;
  emailEnabled: boolean;
  ntfyEnabled: boolean;
  ntfyConfigured: boolean;
  ntfyServerUrl: string | null;
  ntfyTopic: string | null;
  ntfyTokenConfigured: boolean;
  maskedNtfyToken: string | null;
  gotifyEnabled: boolean;
  gotifyConfigured: boolean;
  gotifyServerUrl: string | null;
  gotifyTokenConfigured: boolean;
  maskedGotifyToken: string | null;
  webhookEnabled: boolean;
  webhookConfigured: boolean;
  webhookUrl: string | null;
  webhookSecretConfigured: boolean;
  maskedWebhookSecret: string | null;
  taskAssignmentEnabled: boolean;
  taskCommentEnabled: boolean;
  taskStatusChangeEnabled: boolean;
  taskUpdateEnabled: boolean;
  dueDateReminderEnabled: boolean;
  dueDateReminderLeadTimeMinutes: number;
  digestFrequency: "off" | "daily" | "weekly";
  /** 0 = Sunday … 6 = Saturday. */
  digestWeekday: number;
  /** Local hour, 0–23. */
  digestHour: number;
  lastDigestSentAt: string | null;
  workspaces: NotificationPreferenceWorkspaceRule[];
  createdAt: string | null;
  updatedAt: string | null;
};

async function getNotificationPreferences(): Promise<NotificationPreferences> {
  const response = await fetch(getApiUrl("/notification-preferences"), {
    credentials: "include",
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return (await response.json()) as NotificationPreferences;
}

export default getNotificationPreferences;
