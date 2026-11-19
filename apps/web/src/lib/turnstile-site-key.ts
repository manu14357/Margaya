/**
 * The CAPTCHA site key, or undefined when CAPTCHA is off.
 *
 * Docker images fill the "MARGAYA_TURNSTILE_SITE_KEY" placeholder at container
 * start (env.awk), with "" when unset. Vite inlines the placeholder, a truthy
 * literal, so the minifier folds checks like `KEY ? captcha() : signIn()` to
 * the captcha branch at build time. This regex test survives into the build,
 * so the decision is made at runtime with the deployment's real value. An
 * unreplaced placeholder also counts as unset.
 */
export function resolveTurnstileSiteKey(
  value: string | undefined,
): string | undefined {
  const key = value?.trim() ?? "";
  if (!key || /^MARGAYA_/.test(key)) return undefined;
  return key;
}

export const getTurnstileSiteKey = () =>
  resolveTurnstileSiteKey(
    import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined,
  );
