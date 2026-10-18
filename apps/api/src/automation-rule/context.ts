import { AsyncLocalStorage } from "node:async_hooks";

// The system actor "Automation". A rule's actions run inside this store, so
// everything they cause (events, history rows, audit entries) knows it was
// an automation and which rule, and the engine knows how deep a chain of
// rules already is. Event subscribers run in the publisher's async context,
// so the store reaches them without changing any payload.

export type AutomationStore = {
  ruleId: string;
  ruleName: string;
  projectId: string;
  /** 0 for a rule a person's change triggered, +1 per rule in between. */
  depth: number;
  /** The rules of this chain, the running one last. */
  chain: readonly string[];
  /** An agent's change started the chain: no rule may run an agent. */
  causedByAgent?: boolean;
};

export const automationContext = new AsyncLocalStorage<AutomationStore>();

/**
 * The actor id the existing controllers receive for automation changes.
 * They take a person's id as a string; the system actor has none, and every
 * payload reader already treats a missing user as a system change, like
 * integration webhooks do.
 */
export const AUTOMATION_ACTOR = null as unknown as string;

export function currentAutomation(): AutomationStore | null {
  return automationContext.getStore() ?? null;
}

/** The history marker the web shows as "Automation · <rule>". */
export type AutomationMarker = {
  rule: "custom";
  ruleId: string;
  ruleName: string;
};

export function automationMarker(): AutomationMarker | null {
  const store = currentAutomation();
  if (!store) return null;
  return { rule: "custom", ruleId: store.ruleId, ruleName: store.ruleName };
}

/** eventData with the automation marker added while a rule acts. */
export function withAutomationMarker(
  eventData: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  const marker = automationMarker();
  if (!marker) return eventData ?? null;
  return { ...(eventData ?? {}), automation: marker };
}
