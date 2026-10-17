import { z } from "../openapi";

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
  })
  .openapi("Config");
