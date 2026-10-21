// The avatar every agent user gets: a small bot glyph on a muted tile with a
// sparkle in the corner. It is the agent's `user.image`, so every place that
// shows an avatar marks the agent without knowing about agents.

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="32" fill="#E4EAE6"/><rect x="18" y="22" width="28" height="22" rx="7" fill="none" stroke="#3E5A4A" stroke-width="3.5"/><circle cx="27" cy="33" r="3" fill="#3E5A4A"/><circle cx="37" cy="33" r="3" fill="#3E5A4A"/><path d="M32 22v-6" stroke="#3E5A4A" stroke-width="3.5" stroke-linecap="round"/><circle cx="32" cy="14" r="2.5" fill="#3E5A4A"/><path d="M50 8l1.6 3.4L55 13l-3.4 1.6L50 18l-1.6-3.4L45 13l3.4-1.6z" fill="#3E5A4A"/></svg>`;

export const AGENT_AVATAR = `data:image/svg+xml;base64,${Buffer.from(SVG).toString("base64")}`;

/** Agent users get a synthetic address that can never receive mail. */
export const AGENT_EMAIL_DOMAIN = "agents.margaya.invalid";

export function agentEmail(agentId: string): string {
  return `agent-${agentId}@${AGENT_EMAIL_DOMAIN}`;
}

export function isAgentEmail(email: string | null | undefined): boolean {
  return Boolean(email?.toLowerCase().endsWith(`@${AGENT_EMAIL_DOMAIN}`));
}
