// Sign-in and sign-up branding from /config: the instance name (when an admin
// renamed it) and the custom OAuth button label.

export const DEFAULT_INSTANCE_NAME = "Margaya";

/** The instance's own name, or null while it is the default. */
export function customInstanceName(
  config: { instanceName?: string | null } | undefined,
): string | null {
  const name = config?.instanceName?.trim();
  return name && name !== DEFAULT_INSTANCE_NAME ? name : null;
}

/** The custom OAuth button's label, or null for the default copy. */
export function customOAuthLabel(
  config: { customOAuthButtonLabel?: string | null } | undefined,
): string | null {
  return config?.customOAuthButtonLabel?.trim() || null;
}

/** Only same-origin paths may be a post-auth destination. */
export function safeRedirectPath(redirect: string | undefined) {
  if (redirect?.startsWith("/") && !redirect.includes("//")) return redirect;
  return undefined;
}
