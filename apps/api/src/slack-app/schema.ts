import { z } from "../openapi";

export const workspaceIdParam = z.object({ workspaceId: z.string().min(1) });
export const linkIdParam = z.object({ id: z.string().min(1) });

const mode = z.enum(["socket", "http"]).openapi({
  description:
    "socket: Socket Mode, an outbound WebSocket that needs no public URL (the default). http: Slack posts signed requests to this server's events URL.",
});

const botToken = z
  .string()
  .trim()
  .regex(/^xoxb-[A-Za-z0-9-]+$/, "A bot token starts with xoxb-")
  .max(512)
  .openapi({ description: "The app's Bot User OAuth Token (xoxb-…)." });

const appToken = z
  .string()
  .trim()
  .regex(/^xapp-[A-Za-z0-9-]+$/, "An app-level token starts with xapp-")
  .max(512)
  .openapi({
    description:
      "An app-level token with the connections:write scope (xapp-…). Needed for Socket Mode.",
  });

const signingSecret = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9]{16,128}$/, "Paste the app's signing secret")
  .openapi({
    description: "The app's signing secret. Needed for HTTP mode.",
  });

const defaultProjectId = z.string().min(1).nullable().openapi({
  description:
    "Where `/margaya add` puts a task when the text doesn't start with a project key, and the project the message shortcut preselects.",
});

const expandTaskKeys = z.boolean().openapi({
  description:
    "Reply in a thread with a preview when a message mentions task keys such as WEB-12. Needs the message scopes in the manifest; off by default.",
});

export const createSlackAppBody = z.object({
  mode: mode.optional().default("socket"),
  botToken,
  appToken: appToken.optional(),
  signingSecret: signingSecret.optional(),
  defaultProjectId: defaultProjectId.optional(),
  expandTaskKeys: expandTaskKeys.optional(),
});

export const updateSlackAppBody = z.object({
  mode: mode.optional(),
  botToken: botToken.optional(),
  appToken: appToken.optional(),
  signingSecret: signingSecret.optional(),
  defaultProjectId: defaultProjectId.optional(),
  expandTaskKeys: expandTaskKeys.optional(),
  isActive: z.boolean().optional(),
});

export const linkTokenBody = z.object({
  token: z.string().min(1).max(2048).openapi({
    description: "The token from the link prompt Slack showed the user.",
  }),
});
