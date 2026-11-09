import { z } from "../openapi";

export const desktopConfigSchema = z
  .object({
    enabled: z.boolean().openapi({
      description:
        "Whether Margaya Desktop may sign in to this server through the system browser (DESKTOP_SIGN_IN_ENABLED, default true).",
    }),
    serverVersion: z.string().openapi({
      description: "This server's version (MARGAYA_VERSION, or the release's).",
      example: "1.0.0",
    }),
    minDesktopVersion: z.string().openapi({
      description:
        "The oldest Margaya Desktop version this server supports (DESKTOP_MIN_VERSION, default 0.1.0).",
      example: "0.1.0",
    }),
    webUrl: z.string().openapi({
      description: "The web app's public URL, which the desktop window loads.",
      example: "https://margaya.example.com",
    }),
    apiUrl: z.string().openapi({
      description: "The API's public origin.",
      example: "https://margaya.example.com",
    }),
  })
  .openapi("DesktopConfig", {
    description: "What Margaya Desktop needs to connect to this server.",
  });

export const configSchema = z
  .object({
    disableRegistration: z.boolean(),
    disablePasswordRegistration: z.boolean(),
    disableEmailOtpSignIn: z.boolean(),
    disableWorkspaceCreation: z.boolean(),
    isDemoMode: z.boolean(),
    hasSmtp: z.boolean(),
    hasGithubSignIn: z.boolean(),
    hasGoogleSignIn: z.boolean(),
    hasDiscordSignIn: z.boolean(),
    hasCustomOAuth: z.boolean(),
    hasSamlSignIn: z.boolean().openapi({
      description:
        "An identity provider is connected for SAML sign-in, so the sign-in screen offers it.",
    }),
    hasGuestAccess: z.boolean(),
    disableLoginForm: z.boolean(),
    customOAuthAutoLogin: z.boolean(),
    customOAuthLogoutUrl: z.string().nullable(),
    billingEnabled: z.boolean(),
    exportRetentionDays: z.number().int().openapi({
      description: "Days a finished task export stays downloadable.",
    }),
    instanceName: z.string().openapi({
      description:
        "The instance's display name, shown on the sign-in screen and on public boards.",
    }),
    customOAuthButtonLabel: z.string().nullable().openapi({
      description:
        "Label of the custom OAuth sign-in button, or null for the default copy.",
    }),
    publicBoardsEnabled: z.boolean().openapi({
      description:
        "Whether public boards are allowed on this instance. When false every public link answers 404.",
    }),
    passwordResetEnabled: z.boolean().openapi({
      description:
        "Whether the sign-in screen offers a forgotten-password link: password sign-in is on and outgoing email is configured.",
    }),
    publicLandingEnabled: z.boolean().openapi({
      description:
        "Whether signed-out visitors to the web app's root see the product landing page. When false they go straight to sign-in.",
    }),
    passwordSignUpForInvitations: z.boolean().openapi({
      description:
        "Password sign-up is off, but people with a valid invitation may still create a password account.",
    }),
    requiredSignInProvider: z
      .enum(["github", "google", "discord", "custom"])
      .nullable()
      .openapi({
        description:
          "Everyone signs in through this provider; instance admins keep password sign-in. Null when there is no requirement.",
      }),
    requireTwoFactor: z.boolean().openapi({
      description:
        "Accounts that can sign in with a password must set up two-factor before they can use anything. Email links and codes are turned off.",
    }),
    sourceCodeUrl: z.string().openapi({
      description:
        "Where people using this instance can get its source code, as the AGPL-3.0 requires: MARGAYA_SOURCE_URL, or the official repository.",
      example: "https://github.com/manu14357/Margaya",
    }),
    desktop: desktopConfigSchema,
  })
  .openapi("Config");
