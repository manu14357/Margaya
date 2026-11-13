import { nullableResponseTimestamp, responseTimestamp, z } from "../openapi";

// Tokens and the signing secret are bearer credentials: responses carry only
// whether each is set and a masked hint ("xoxb-…a1b2").
export const slackAppConnectionSchema = z
  .object({
    id: z.string(),
    workspaceId: z.string(),
    mode: z.enum(["socket", "http"]),
    teamId: z.string().nullable(),
    teamName: z.string().nullable(),
    botUserId: z.string().nullable(),
    botTokenConfigured: z.boolean(),
    maskedBotToken: z.string(),
    appTokenConfigured: z.boolean(),
    maskedAppToken: z.string(),
    signingSecretConfigured: z.boolean(),
    maskedSigningSecret: z.string(),
    credentialsReadable: z.boolean().openapi({
      description:
        "False when the stored credentials can't be opened (AUTH_SECRET changed); enter them again.",
    }),
    defaultProjectId: z.string().nullable(),
    expandTaskKeys: z.boolean(),
    isActive: z.boolean(),
    lastConnectedAt: nullableResponseTimestamp.openapi({
      description: "When a Socket Mode connection last opened.",
    }),
    lastError: z.string().nullable().openapi({
      description: "The last connection error code from Slack, if any.",
    }),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
  })
  .openapi("SlackAppConnection");

export const slackAppSetupSchema = z
  .object({
    eventsUrl: z.string().openapi({
      description:
        "The Request URL for Events, Interactivity and the slash command in HTTP mode.",
    }),
    unfurlDomain: z.string().nullable().openapi({
      description:
        "The web host Slack unfurls, or null when it is localhost or an IP address, which Slack won't accept.",
    }),
    manifests: z.object({
      socket: z.string().openapi({ description: "App manifest JSON." }),
      http: z.string().openapi({ description: "App manifest JSON." }),
    }),
  })
  .openapi("SlackAppSetup");

export const slackAppStateSchema = z
  .object({
    connection: slackAppConnectionSchema.nullable(),
    setup: slackAppSetupSchema,
  })
  .openapi("SlackAppState");

export const slackAppTestSchema = z
  .object({
    ok: z.boolean(),
    teamName: z.string().nullable(),
    checks: z.array(
      z.object({
        check: z.enum(["bot_token", "app_token", "signing_secret"]),
        ok: z.boolean(),
        error: z.string().nullable().openapi({
          description: "Slack's error code when the check failed.",
        }),
      }),
    ),
  })
  .openapi("SlackAppTest");

export const slackLinkSchema = z
  .object({
    id: z.string(),
    workspaceId: z.string(),
    workspaceName: z.string(),
    slackTeamId: z.string(),
    teamName: z.string().nullable(),
    slackUserId: z.string(),
    slackUserName: z.string().nullable(),
    createdAt: responseTimestamp,
  })
  .openapi("SlackLink");

export const slackLinkPreviewSchema = z
  .object({
    workspaceId: z.string(),
    workspaceName: z.string(),
    teamName: z.string().nullable(),
    slackUserName: z.string().nullable(),
    linkedToYou: z.boolean(),
    linkedToSomeoneElse: z.boolean().openapi({
      description:
        "This Slack user is linked to another Margaya account; confirming moves the link to you.",
    }),
  })
  .openapi("SlackLinkPreview");

export const deletedSchema = z.object({ success: z.boolean() });
