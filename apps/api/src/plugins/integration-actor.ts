/**
 * Who an integration webhook's change is attributed to: the integration,
 * plus the account on the other side that caused it (the event's sender).
 * Webhook changes carry no Margaya user, so task history and notifications
 * name this instead of an anonymous "Someone". Only a name, never a token.
 */
export type IntegrationActor = {
  source: "github" | "gitea";
  login?: string;
};

const INTEGRATION_NAMES: Record<IntegrationActor["source"], string> = {
  github: "GitHub",
  gitea: "Gitea",
};

export function integrationActor(
  source: IntegrationActor["source"],
  sender:
    | { login?: string | null; username?: string | null }
    | null
    | undefined,
): IntegrationActor {
  const login = (sender?.login ?? sender?.username ?? "").trim();
  return login ? { source, login } : { source };
}

/** The name a notification shows for it: the account, else the integration. */
export function integrationActorName(actor: IntegrationActor): string {
  return actor.login ?? INTEGRATION_NAMES[actor.source];
}

/** The marker from an event payload, when it is a known integration's. */
export function integrationActorOf(value: unknown): IntegrationActor | null {
  if (!value || typeof value !== "object") return null;
  const { source, login } = value as { source?: unknown; login?: unknown };
  if (source !== "github" && source !== "gitea") return null;
  return typeof login === "string" && login.trim()
    ? { source, login: login.trim() }
    : { source };
}
