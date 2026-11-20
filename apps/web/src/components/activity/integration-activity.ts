// History rows an integration webhook wrote (a push, a pull request or an
// issue changing the task's status): no user, and an `integration` marker
// in the event data naming the integration and the account that acted.

export type IntegrationActor = {
  source: "github" | "gitea";
  /** The account on the other side that caused the change, when known. */
  login?: string;
};

export function integrationActorOf(activity: {
  userId: string | null;
  eventData?: unknown;
}): IntegrationActor | null {
  if (activity.userId) return null;
  const data = activity.eventData;
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const marker = (data as { integration?: unknown }).integration;
  if (!marker || typeof marker !== "object") return null;
  const { source, login } = marker as { source?: unknown; login?: unknown };
  if (source !== "github" && source !== "gitea") return null;
  return typeof login === "string" && login.trim()
    ? { source, login: login.trim() }
    : { source };
}
