import {
  type IntegrationActor,
  integrationActor,
} from "../../integration-actor";

export type { IntegrationActor };

/** The GitHub account that sent a webhook event (plugins/integration-actor.ts). */
export function githubActor(
  sender: { login?: string | null } | null | undefined,
): IntegrationActor {
  return integrationActor("github", sender);
}
