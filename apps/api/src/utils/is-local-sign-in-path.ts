const localSignInPaths = new Set([
  "/sign-in/email",
  "/sign-in/magic-link",
  "/magic-link/verify",
  "/sign-in/email-otp",
  // Resetting a forgotten password is a way back into password sign-in.
  "/request-password-reset",
  "/reset-password",
]);

export function isLocalSignInPath(path: string) {
  return localSignInPaths.has(path) || path.startsWith("/email-otp/");
}
