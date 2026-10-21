/** Marks issues Margaya opened for a coding-agent handoff. */
export const HANDOFF_MARKER = "<!-- margaya:coding-handoff -->";

/**
 * Handoff issues belong to an existing task: the issue webhooks must not
 * import them as new tasks.
 */
export function isHandoffIssue(body: string | null | undefined): boolean {
  return Boolean(body?.includes(HANDOFF_MARKER));
}
