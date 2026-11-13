import { z } from "zod";

// Every DB-backed instance setting (B12 §2.6). Nothing outside this catalog
// can be stored. Each entry names its environment source: a set variable
// wins over the database and locks the setting in the panel.

export type SettingValue = string | number | boolean;
export type Env = Record<string, string | undefined>;

export const SETTING_GROUPS = [
  "general",
  "signUp",
  "signIn",
  "workspaces",
  "oauth.github",
  "oauth.google",
  "oauth.discord",
  "oauth.custom",
  "smtp",
  "publicBoards",
  "ai",
  "feedback",
] as const;
export type SettingGroup = (typeof SETTING_GROUPS)[number];

export type SettingDefinition = {
  key: string;
  group: SettingGroup;
  secret: boolean;
  default: SettingValue;
  /** Validates and normalizes a value saved from the panel. */
  schema: z.ZodType<SettingValue>;
  /** The setting's own variable, shown in the panel when it locks. */
  envVar: string | null;
  /** The value the environment gives, or undefined when it gives none. */
  readEnv?: (env: Env) => SettingValue | undefined;
  /** Variables that lock the whole group (credentials come as a set). */
  groupLock?: readonly string[];
};

/** "Set" means present and not blank after trimming. */
export function isEnvSet(env: Env, name: string): boolean {
  return Boolean(env[name]?.trim());
}

function raw(name: string) {
  return (env: Env) => (isEnvSet(env, name) ? env[name] : undefined);
}

function trimmed(name: string) {
  return (env: Env) => (isEnvSet(env, name) ? env[name]?.trim() : undefined);
}

/** `DISABLE_X`: "true" turns the setting off; any other set value keeps it on. */
function disabledFlag(name: string) {
  return (env: Env) => (isEnvSet(env, name) ? env[name] !== "true" : undefined);
}

/** A flag where "true" turns the setting on. */
function enabledFlag(name: string) {
  return (env: Env) => (isEnvSet(env, name) ? env[name] === "true" : undefined);
}

// GitHub sign-in prefers GITHUB_OAUTH_* and falls back to the legacy
// GITHUB_CLIENT_* pair, as `getGithubSsoOAuthCredentials` does.
function githubCredential(part: "id" | "secret") {
  return (env: Env) => {
    const oauthId = env.GITHUB_OAUTH_CLIENT_ID?.trim();
    const oauthSecret = env.GITHUB_OAUTH_CLIENT_SECRET?.trim();
    if (oauthId && oauthSecret) return part === "id" ? oauthId : oauthSecret;
    return (
      (part === "id"
        ? env.GITHUB_CLIENT_ID?.trim()
        : env.GITHUB_CLIENT_SECRET?.trim()) || undefined
    );
  };
}

function smtpSecurity(env: Env) {
  if (env.SMTP_SECURE !== "false") return "tls";
  if (env.SMTP_REQUIRE_TLS !== "false") return "starttls";
  return "none";
}

function smtpPort(env: Env) {
  return isEnvSet(env, "SMTP_PORT") ? Number(env.SMTP_PORT) : undefined;
}

const bool = z.boolean();

function text(max: number) {
  return z.string().trim().max(max, `at most ${max} characters`);
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

const optionalUrl = text(2048).refine((value) => !value || isHttpUrl(value), {
  message: "must be an absolute http or https URL",
});

const SCOPE_TOKEN = /^[A-Za-z0-9._:/-]+$/;

const scopes = z
  .string()
  .transform((value) =>
    value
      .split(",")
      .map((token) => token.trim())
      .filter(Boolean),
  )
  .refine((tokens) => tokens.length >= 1 && tokens.length <= 20, {
    message: "list 1 to 20 scopes",
  })
  .refine((tokens) => tokens.every((token) => SCOPE_TOKEN.test(token)), {
    message: "scopes may only use letters, digits and . _ : / -",
  })
  .transform((tokens) => tokens.join(","));

// A hostname or an IP literal: no scheme, no port, no spaces.
const HOST =
  /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.?)+$|^\[?[0-9A-Fa-f:.]+\]?$/;

const smtpHost = text(253).refine((value) => !value || HOST.test(value), {
  message: "must be a hostname or an IP address, without a scheme or port",
});

const EMAIL = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/;

/** `address` or `Name <address>`. */
export function isValidFromAddress(value: string): boolean {
  const named = /^(.*)<([^<>]+)>$/.exec(value);
  const address = (named ? named[2] : value)?.trim() ?? "";
  return EMAIL.test(address);
}

const smtpFrom = text(320).refine(
  (value) => !value || isValidFromAddress(value),
  {
    message: "must be an email address, or a name and an address",
  },
);

function oauthGroup(
  provider: "github" | "google" | "discord",
  lock: readonly string[],
  idVar: string,
  secretVar: string,
  readId: (env: Env) => SettingValue | undefined,
  readSecret: (env: Env) => SettingValue | undefined,
): SettingDefinition[] {
  const group = `oauth.${provider}` as SettingGroup;
  return [
    {
      key: `oauth.${provider}.enabled`,
      group,
      secret: false,
      default: true,
      schema: bool,
      envVar: null,
    },
    {
      key: `oauth.${provider}.clientId`,
      group,
      secret: false,
      default: "",
      schema: text(256),
      envVar: idVar,
      readEnv: readId,
      groupLock: lock,
    },
    {
      key: `oauth.${provider}.clientSecret`,
      group,
      secret: true,
      default: "",
      schema: text(512),
      envVar: secretVar,
      readEnv: readSecret,
      groupLock: lock,
    },
  ];
}

// A bare domain such as example.com: labels of letters, digits and hyphens.
const DOMAIN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** Comma- or space-separated domains, normalized to "a.com,b.org". */
const emailDomains = z
  .string()
  .max(2000, "at most 2000 characters")
  .transform((value) => [
    ...new Set(
      value
        .split(/[\s,]+/)
        .map((token) => token.trim().toLowerCase().replace(/^@/, ""))
        .filter(Boolean),
    ),
  ])
  .refine((domains) => domains.length <= 50, {
    message: "list at most 50 domains",
  })
  .refine((domains) => domains.every((domain) => DOMAIN.test(domain)), {
    message: "list domains such as example.com, separated by commas",
  })
  .transform((domains) => domains.join(","));

export const REQUIRED_PROVIDER_VALUES = [
  "",
  "github",
  "google",
  "discord",
  "custom",
] as const;

const CUSTOM_LOCK = ["CUSTOM_OAUTH_CLIENT_ID"] as const;

export const AI_PROVIDER_VALUES = [
  "anthropic",
  "openai_compatible",
  "fake",
] as const;
export const AI_RESTRICTED_ROUTES = ["blocked", "local", "cloud"] as const;
export const AI_PRIVATE_ROUTES = ["local", "cloud"] as const;
export const AI_LOCAL_THINKING_VALUES = ["off", "on"] as const;
/** Speech-to-text request formats: OpenAI's /audio/transcriptions, or Fish Audio's /v1/asr. */
export const AI_SPEECH_FORMATS = ["openai", "fish"] as const;
export const AI_WEB_SEARCH_PROVIDERS = [
  "off",
  "searxng",
  "brave",
  "tavily",
] as const;

/** An env value from a fixed list (lower-cased), or the fallback. */
function oneOf(name: string, values: readonly string[], fallback: string) {
  return (env: Env) => {
    if (!isEnvSet(env, name)) return undefined;
    const value = env[name]?.trim().toLowerCase() ?? "";
    return values.includes(value) ? value : fallback;
  };
}

const modelName = text(128).refine(
  (value) => !value || /^[A-Za-z0-9._:/@-]+$/.test(value),
  { message: "use letters, digits and . _ : / @ - only" },
);

// AI (ai/settings.ts). Off by default; each workspace opts in after this.
// Model names left empty use the provider's defaults for the tier.
const AI_SETTINGS: SettingDefinition[] = [
  {
    key: "ai.enabled",
    group: "ai",
    secret: false,
    default: false,
    schema: bool,
    envVar: "MARGAYA_AI_ENABLED",
    readEnv: enabledFlag("MARGAYA_AI_ENABLED"),
  },
  {
    key: "ai.provider",
    group: "ai",
    secret: false,
    default: "anthropic",
    schema: z.enum(AI_PROVIDER_VALUES),
    envVar: "MARGAYA_AI_PROVIDER",
    readEnv: oneOf("MARGAYA_AI_PROVIDER", AI_PROVIDER_VALUES, "anthropic"),
  },
  {
    key: "ai.anthropic.apiKey",
    group: "ai",
    secret: true,
    default: "",
    schema: text(512),
    envVar: "ANTHROPIC_API_KEY",
    readEnv: trimmed("ANTHROPIC_API_KEY"),
  },
  {
    key: "ai.openai.baseUrl",
    group: "ai",
    secret: false,
    default: "",
    schema: optionalUrl,
    envVar: "MARGAYA_AI_OPENAI_BASE_URL",
    readEnv: trimmed("MARGAYA_AI_OPENAI_BASE_URL"),
  },
  {
    key: "ai.openai.apiKey",
    group: "ai",
    secret: true,
    default: "",
    schema: text(512),
    envVar: "MARGAYA_AI_OPENAI_API_KEY",
    readEnv: trimmed("MARGAYA_AI_OPENAI_API_KEY"),
  },
  ...(["fast", "balanced", "deep"] as const).map(
    (tier): SettingDefinition => ({
      key: `ai.models.${tier}`,
      group: "ai",
      secret: false,
      default: "",
      schema: modelName,
      envVar: `MARGAYA_AI_MODEL_${tier.toUpperCase()}`,
      readEnv: trimmed(`MARGAYA_AI_MODEL_${tier.toUpperCase()}`),
    }),
  ),
  {
    // An OpenAI-compatible endpoint on the operator's own network (Ollama,
    // vLLM, LM Studio). Private addresses are allowed here only.
    key: "ai.local.baseUrl",
    group: "ai",
    secret: false,
    default: "",
    schema: optionalUrl,
    envVar: "MARGAYA_AI_LOCAL_BASE_URL",
    readEnv: trimmed("MARGAYA_AI_LOCAL_BASE_URL"),
  },
  {
    key: "ai.local.model",
    group: "ai",
    secret: false,
    default: "",
    schema: modelName,
    envVar: "MARGAYA_AI_LOCAL_MODEL",
    readEnv: trimmed("MARGAYA_AI_LOCAL_MODEL"),
  },
  {
    // Optional: local servers started with an API key (e.g. vLLM --api-key).
    key: "ai.local.apiKey",
    group: "ai",
    secret: true,
    default: "",
    schema: text(512),
    envVar: "MARGAYA_AI_LOCAL_API_KEY",
    readEnv: trimmed("MARGAYA_AI_LOCAL_API_KEY"),
  },
  {
    key: "ai.localOnly",
    group: "ai",
    secret: false,
    default: false,
    schema: bool,
    envVar: "MARGAYA_AI_LOCAL_ONLY",
    readEnv: enabledFlag("MARGAYA_AI_LOCAL_ONLY"),
  },
  {
    // Where data from restricted projects may go.
    key: "ai.route.restricted",
    group: "ai",
    secret: false,
    default: "local",
    schema: z.enum(AI_RESTRICTED_ROUTES),
    envVar: null,
  },
  {
    // Where other workspace data may go.
    key: "ai.route.private",
    group: "ai",
    secret: false,
    default: "cloud",
    schema: z.enum(AI_PRIVATE_ROUTES),
    envVar: null,
  },
  {
    key: "ai.redaction.enabled",
    group: "ai",
    secret: false,
    default: false,
    schema: bool,
    envVar: null,
  },
  {
    // Recorded only: zero data retention is an agreement with the provider.
    key: "ai.zeroRetention",
    group: "ai",
    secret: false,
    default: false,
    schema: bool,
    envVar: null,
  },
  {
    // Keep the text of agent requests and of what the model wrote in the
    // run log. Off: runs keep counts, steps and their final summary only.
    // Ask history a workspace opted into is governed by its own switch.
    key: "ai.retention.storePrompts",
    group: "ai",
    secret: false,
    default: false,
    schema: bool,
    envVar: "MARGAYA_AI_STORE_PROMPTS",
    readEnv: enabledFlag("MARGAYA_AI_STORE_PROMPTS"),
  },
  {
    key: "ai.allowWorkspaceKeys",
    group: "ai",
    secret: false,
    default: true,
    schema: bool,
    envVar: null,
  },
  {
    // Embeddings always use an OpenAI-compatible endpoint.
    key: "ai.embeddings.baseUrl",
    group: "ai",
    secret: false,
    default: "",
    schema: optionalUrl,
    envVar: "MARGAYA_AI_EMBEDDINGS_BASE_URL",
    readEnv: trimmed("MARGAYA_AI_EMBEDDINGS_BASE_URL"),
  },
  {
    key: "ai.embeddings.model",
    group: "ai",
    secret: false,
    default: "",
    schema: modelName,
    envVar: "MARGAYA_AI_EMBEDDINGS_MODEL",
    readEnv: trimmed("MARGAYA_AI_EMBEDDINGS_MODEL"),
  },
  {
    key: "ai.embeddings.apiKey",
    group: "ai",
    secret: true,
    default: "",
    schema: text(512),
    envVar: "MARGAYA_AI_EMBEDDINGS_API_KEY",
    readEnv: trimmed("MARGAYA_AI_EMBEDDINGS_API_KEY"),
  },
  {
    // Send a reasoning model's thinking text to the person who asked. The
    // duration is always sent; the text is never stored or logged.
    key: "ai.showReasoning",
    group: "ai",
    secret: false,
    default: false,
    schema: bool,
    envVar: "MARGAYA_AI_SHOW_REASONING",
    readEnv: enabledFlag("MARGAYA_AI_SHOW_REASONING"),
  },
  {
    // "off" asks local reasoning models to skip thinking (faster, and
    // structured answers stay clean); "on" lets them think.
    key: "ai.local.thinking",
    group: "ai",
    secret: false,
    default: "off",
    schema: z.enum(AI_LOCAL_THINKING_VALUES),
    envVar: "MARGAYA_AI_LOCAL_THINKING",
    readEnv: oneOf(
      "MARGAYA_AI_LOCAL_THINKING",
      AI_LOCAL_THINKING_VALUES,
      "off",
    ),
  },
  {
    // Web search for Ask and agents; each workspace still opts in.
    key: "ai.webSearch.provider",
    group: "ai",
    secret: false,
    default: "off",
    schema: z.enum(AI_WEB_SEARCH_PROVIDERS),
    envVar: "MARGAYA_AI_WEB_SEARCH_PROVIDER",
    readEnv: oneOf(
      "MARGAYA_AI_WEB_SEARCH_PROVIDER",
      AI_WEB_SEARCH_PROVIDERS,
      "off",
    ),
  },
  {
    // The SearXNG base URL (its JSON API must be enabled).
    key: "ai.webSearch.url",
    group: "ai",
    secret: false,
    default: "",
    schema: optionalUrl,
    envVar: "MARGAYA_AI_WEB_SEARCH_URL",
    readEnv: trimmed("MARGAYA_AI_WEB_SEARCH_URL"),
  },
  {
    // Brave Search or Tavily API key.
    key: "ai.webSearch.apiKey",
    group: "ai",
    secret: true,
    default: "",
    schema: text(512),
    envVar: "MARGAYA_AI_WEB_SEARCH_API_KEY",
    readEnv: trimmed("MARGAYA_AI_WEB_SEARCH_API_KEY"),
  },
  {
    // How audio is sent: "openai" posts to <url>/audio/transcriptions with a
    // model; "fish" posts to the URL as given (Fish Audio's /v1/asr).
    key: "ai.speech.format",
    group: "ai",
    secret: false,
    default: "openai",
    schema: z.enum(AI_SPEECH_FORMATS),
    envVar: "MARGAYA_AI_SPEECH_FORMAT",
    readEnv: oneOf("MARGAYA_AI_SPEECH_FORMAT", AI_SPEECH_FORMATS, "openai"),
  },
  {
    // A speech-to-text endpoint: an OpenAI-compatible base URL (a local
    // Whisper server, https://api.openai.com/v1) or Fish Audio's ASR URL.
    key: "ai.speech.baseUrl",
    group: "ai",
    secret: false,
    default: "",
    schema: optionalUrl,
    envVar: "MARGAYA_AI_SPEECH_BASE_URL",
    readEnv: trimmed("MARGAYA_AI_SPEECH_BASE_URL"),
  },
  {
    key: "ai.speech.model",
    group: "ai",
    secret: false,
    default: "",
    schema: modelName,
    envVar: "MARGAYA_AI_SPEECH_MODEL",
    readEnv: trimmed("MARGAYA_AI_SPEECH_MODEL"),
  },
  {
    key: "ai.speech.apiKey",
    group: "ai",
    secret: true,
    default: "",
    schema: text(512),
    envVar: "MARGAYA_AI_SPEECH_API_KEY",
    readEnv: trimmed("MARGAYA_AI_SPEECH_API_KEY"),
  },
];

// Product feedback (feedback/). Responses stay on this instance. "Send
// feedback" is on by default; the occasional survey asks only once an admin
// turns it on. A trigger of 0 is off.
export const FEEDBACK_SURVEY_FORMATS = [
  "faces3",
  "faces5",
  "stars",
  "nps",
] as const;

const FEEDBACK_SETTINGS: SettingDefinition[] = [
  {
    key: "feedback.enabled",
    group: "feedback",
    secret: false,
    default: true,
    schema: bool,
    envVar: "MARGAYA_FEEDBACK_ENABLED",
    readEnv: (env) =>
      isEnvSet(env, "MARGAYA_FEEDBACK_ENABLED")
        ? env.MARGAYA_FEEDBACK_ENABLED?.trim().toLowerCase() !== "false"
        : undefined,
  },
  {
    key: "feedback.survey.enabled",
    group: "feedback",
    secret: false,
    default: false,
    schema: bool,
    envVar: null,
  },
  {
    key: "feedback.survey.format",
    group: "feedback",
    secret: false,
    default: "faces5",
    schema: z.enum(FEEDBACK_SURVEY_FORMATS),
    envVar: null,
  },
  {
    key: "feedback.survey.activeDays",
    group: "feedback",
    secret: false,
    default: 10,
    schema: z.number().int().min(0).max(365),
    envVar: null,
  },
  {
    key: "feedback.survey.tasksCompleted",
    group: "feedback",
    secret: false,
    default: 10,
    schema: z.number().int().min(0).max(1000),
    envVar: null,
  },
  {
    key: "feedback.survey.intervalDays",
    group: "feedback",
    secret: false,
    default: 90,
    schema: z.number().int().min(30).max(365),
    envVar: null,
  },
];
const SMTP_LOCK = ["SMTP_HOST"] as const;

export const SETTINGS_CATALOG: readonly SettingDefinition[] = [
  {
    key: "general.instanceName",
    group: "general",
    secret: false,
    default: "Margaya",
    schema: z
      .string()
      .trim()
      .min(1, "required")
      .max(80, "at most 80 characters"),
    envVar: "MARGAYA_INSTANCE_NAME",
    readEnv: trimmed("MARGAYA_INSTANCE_NAME"),
  },
  {
    // The product landing page signed-out visitors see at the web app's root.
    key: "general.publicLanding",
    group: "general",
    secret: false,
    default: true,
    schema: bool,
    envVar: "MARGAYA_PUBLIC_LANDING",
    readEnv: (env) =>
      isEnvSet(env, "MARGAYA_PUBLIC_LANDING")
        ? env.MARGAYA_PUBLIC_LANDING?.trim().toLowerCase() !== "false"
        : undefined,
  },
  {
    // Opt-in: once a day the server asks the public release feed for the
    // latest version and tells instance admins when one is newer. Nothing
    // about the instance is sent (observability/update-check.ts).
    key: "general.updateCheck",
    group: "general",
    secret: false,
    default: false,
    schema: bool,
    envVar: "MARGAYA_UPDATE_CHECK",
    readEnv: (env) =>
      isEnvSet(env, "MARGAYA_UPDATE_CHECK")
        ? env.MARGAYA_UPDATE_CHECK?.trim().toLowerCase() === "true"
        : undefined,
  },
  {
    key: "auth.inviteOnly",
    group: "signUp",
    secret: false,
    default: false,
    schema: bool,
    envVar: "DISABLE_REGISTRATION",
    readEnv: enabledFlag("DISABLE_REGISTRATION"),
  },
  {
    key: "auth.emailSignUp",
    group: "signUp",
    secret: false,
    default: true,
    schema: bool,
    envVar: "DISABLE_PASSWORD_REGISTRATION",
    readEnv: disabledFlag("DISABLE_PASSWORD_REGISTRATION"),
  },
  {
    key: "auth.guestAccess",
    group: "signUp",
    secret: false,
    default: true,
    schema: bool,
    envVar: "DISABLE_GUEST_ACCESS",
    readEnv: disabledFlag("DISABLE_GUEST_ACCESS"),
  },
  {
    // With password sign-up off, people holding a valid invitation may still
    // create a password account.
    key: "auth.emailSignUpForInvitations",
    group: "signUp",
    secret: false,
    default: false,
    schema: bool,
    envVar: "ALLOW_INVITED_PASSWORD_REGISTRATION",
    readEnv: enabledFlag("ALLOW_INVITED_PASSWORD_REGISTRATION"),
  },
  {
    // New accounts (every sign-up method, invitations included) must use an
    // address at one of these domains. Empty allows any domain.
    key: "auth.allowedEmailDomains",
    group: "signUp",
    secret: false,
    default: "",
    schema: emailDomains,
    envVar: "ALLOWED_EMAIL_DOMAINS",
    readEnv: (env) => {
      if (!isEnvSet(env, "ALLOWED_EMAIL_DOMAINS")) return undefined;
      const parsed = emailDomains.safeParse(env.ALLOWED_EMAIL_DOMAINS);
      return parsed.success ? parsed.data : "";
    },
  },
  {
    // Everyone signs in through this provider; instance admins keep password
    // sign-in as a way back in. Empty means no requirement.
    key: "auth.requiredProvider",
    group: "signIn",
    secret: false,
    default: "",
    schema: z.enum(REQUIRED_PROVIDER_VALUES),
    envVar: "REQUIRED_SIGN_IN_PROVIDER",
    readEnv: (env) => {
      if (!isEnvSet(env, "REQUIRED_SIGN_IN_PROVIDER")) return undefined;
      const value = env.REQUIRED_SIGN_IN_PROVIDER?.trim().toLowerCase() ?? "";
      return (REQUIRED_PROVIDER_VALUES as readonly string[]).includes(value)
        ? value
        : "";
    },
  },
  {
    // How long a session lasts without use; each day of use extends it.
    key: "auth.sessionLifetimeHours",
    group: "signIn",
    secret: false,
    default: 168,
    schema: z.number().int().min(1).max(8760),
    envVar: "SESSION_LIFETIME_HOURS",
    readEnv: (env) => {
      if (!isEnvSet(env, "SESSION_LIFETIME_HOURS")) return undefined;
      const value = Number(env.SESSION_LIFETIME_HOURS?.trim());
      return Number.isInteger(value) && value >= 1 && value <= 8760
        ? value
        : 168;
    },
  },
  {
    // Accounts that can sign in with a password must set up two-factor before
    // they can use anything, and email links and codes are refused because
    // they would skip the second step (utils/two-factor-policy.ts).
    key: "auth.requireTwoFactor",
    group: "signIn",
    secret: false,
    default: false,
    schema: bool,
    envVar: "REQUIRE_TWO_FACTOR",
    readEnv: enabledFlag("REQUIRE_TWO_FACTOR"),
  },
  {
    key: "auth.emailSignIn",
    group: "signIn",
    secret: false,
    default: true,
    schema: bool,
    envVar: "DISABLE_LOGIN_FORM",
    readEnv: disabledFlag("DISABLE_LOGIN_FORM"),
  },
  {
    key: "auth.emailCodeSignIn",
    group: "signIn",
    secret: false,
    default: true,
    schema: bool,
    envVar: "DISABLE_EMAIL_OTP_SIGN_IN",
    readEnv: disabledFlag("DISABLE_EMAIL_OTP_SIGN_IN"),
  },
  {
    key: "workspaces.restrictCreation",
    group: "workspaces",
    secret: false,
    default: false,
    schema: bool,
    envVar: "DISABLE_WORKSPACE_CREATION",
    readEnv: enabledFlag("DISABLE_WORKSPACE_CREATION"),
  },
  ...oauthGroup(
    "github",
    ["GITHUB_OAUTH_CLIENT_ID", "GITHUB_CLIENT_ID"],
    "GITHUB_OAUTH_CLIENT_ID",
    "GITHUB_OAUTH_CLIENT_SECRET",
    githubCredential("id"),
    githubCredential("secret"),
  ),
  ...oauthGroup(
    "google",
    ["GOOGLE_CLIENT_ID"],
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    trimmed("GOOGLE_CLIENT_ID"),
    trimmed("GOOGLE_CLIENT_SECRET"),
  ),
  ...oauthGroup(
    "discord",
    ["DISCORD_CLIENT_ID"],
    "DISCORD_CLIENT_ID",
    "DISCORD_CLIENT_SECRET",
    trimmed("DISCORD_CLIENT_ID"),
    trimmed("DISCORD_CLIENT_SECRET"),
  ),
  {
    key: "oauth.custom.enabled",
    group: "oauth.custom",
    secret: false,
    default: true,
    schema: bool,
    envVar: null,
  },
  {
    key: "oauth.custom.clientId",
    group: "oauth.custom",
    secret: false,
    default: "",
    schema: text(256),
    envVar: "CUSTOM_OAUTH_CLIENT_ID",
    readEnv: raw("CUSTOM_OAUTH_CLIENT_ID"),
    groupLock: CUSTOM_LOCK,
  },
  {
    key: "oauth.custom.clientSecret",
    group: "oauth.custom",
    secret: true,
    default: "",
    schema: text(512),
    envVar: "CUSTOM_OAUTH_CLIENT_SECRET",
    readEnv: raw("CUSTOM_OAUTH_CLIENT_SECRET"),
    groupLock: CUSTOM_LOCK,
  },
  ...(
    [
      ["discoveryUrl", "CUSTOM_OAUTH_DISCOVERY_URL"],
      ["authorizationUrl", "CUSTOM_OAUTH_AUTHORIZATION_URL"],
      ["tokenUrl", "CUSTOM_OAUTH_TOKEN_URL"],
      ["userInfoUrl", "CUSTOM_OAUTH_USER_INFO_URL"],
    ] as const
  ).map(
    ([name, envVar]): SettingDefinition => ({
      key: `oauth.custom.${name}`,
      group: "oauth.custom",
      secret: false,
      default: "",
      schema: optionalUrl,
      envVar,
      readEnv: raw(envVar),
      groupLock: CUSTOM_LOCK,
    }),
  ),
  {
    key: "oauth.custom.scopes",
    group: "oauth.custom",
    secret: false,
    default: "profile,email",
    schema: scopes,
    envVar: "CUSTOM_OAUTH_SCOPES",
    readEnv: raw("CUSTOM_OAUTH_SCOPES"),
    groupLock: CUSTOM_LOCK,
  },
  {
    key: "oauth.custom.responseType",
    group: "oauth.custom",
    secret: false,
    default: "code",
    schema: z.literal("code"),
    envVar: "CUSTOM_OAUTH_RESPONSE_TYPE",
    readEnv: raw("CUSTOM_OAUTH_RESPONSE_TYPE"),
    groupLock: CUSTOM_LOCK,
  },
  {
    key: "oauth.custom.pkce",
    group: "oauth.custom",
    secret: false,
    default: true,
    schema: bool,
    envVar: "CUSTOM_AUTH_PKCE",
    readEnv: (env) =>
      isEnvSet(env, "CUSTOM_AUTH_PKCE")
        ? env.CUSTOM_AUTH_PKCE !== "false"
        : undefined,
    groupLock: CUSTOM_LOCK,
  },
  {
    key: "oauth.custom.autoSignIn",
    group: "oauth.custom",
    secret: false,
    default: false,
    schema: bool,
    envVar: "CUSTOM_OAUTH_AUTO_LOGIN",
    readEnv: enabledFlag("CUSTOM_OAUTH_AUTO_LOGIN"),
  },
  {
    key: "oauth.custom.logoutUrl",
    group: "oauth.custom",
    secret: false,
    default: "",
    schema: optionalUrl,
    envVar: "CUSTOM_OAUTH_LOGOUT_URL",
    readEnv: raw("CUSTOM_OAUTH_LOGOUT_URL"),
  },
  {
    key: "oauth.custom.buttonLabel",
    group: "oauth.custom",
    secret: false,
    default: "",
    schema: text(40),
    envVar: null,
  },
  {
    key: "smtp.host",
    group: "smtp",
    secret: false,
    default: "",
    schema: smtpHost,
    envVar: "SMTP_HOST",
    readEnv: raw("SMTP_HOST"),
    groupLock: SMTP_LOCK,
  },
  {
    key: "smtp.port",
    group: "smtp",
    secret: false,
    default: 0,
    schema: z.number().int().min(1).max(65535),
    envVar: "SMTP_PORT",
    readEnv: smtpPort,
    groupLock: SMTP_LOCK,
  },
  {
    key: "smtp.security",
    group: "smtp",
    secret: false,
    default: "tls",
    schema: z.enum(["tls", "starttls", "none"]),
    envVar: "SMTP_SECURE",
    readEnv: smtpSecurity,
    groupLock: SMTP_LOCK,
  },
  {
    key: "smtp.user",
    group: "smtp",
    secret: false,
    default: "",
    schema: text(256),
    envVar: "SMTP_USER",
    readEnv: raw("SMTP_USER"),
    groupLock: SMTP_LOCK,
  },
  {
    key: "smtp.password",
    group: "smtp",
    secret: true,
    default: "",
    schema: text(512),
    envVar: "SMTP_PASSWORD",
    readEnv: raw("SMTP_PASSWORD"),
    groupLock: SMTP_LOCK,
  },
  {
    key: "smtp.from",
    group: "smtp",
    secret: false,
    default: "",
    schema: smtpFrom,
    envVar: "SMTP_FROM",
    readEnv: raw("SMTP_FROM"),
    groupLock: SMTP_LOCK,
  },
  {
    key: "publicBoards.enabled",
    group: "publicBoards",
    secret: false,
    default: true,
    schema: bool,
    envVar: "DISABLE_PUBLIC_BOARDS",
    readEnv: disabledFlag("DISABLE_PUBLIC_BOARDS"),
  },
  {
    key: "publicBoards.participation",
    group: "publicBoards",
    secret: false,
    default: true,
    schema: bool,
    envVar: null,
  },
  ...AI_SETTINGS,
  ...FEEDBACK_SETTINGS,
];

export const LOCK_VARIABLE = "MARGAYA_LOCK_INSTANCE_SETTINGS";

const byKey = new Map(SETTINGS_CATALOG.map((entry) => [entry.key, entry]));

export function settingDefinition(key: string): SettingDefinition | undefined {
  return byKey.get(key);
}

/** Every variable the resolver reads; the snapshot is memoized over them. */
export const RESOLVER_ENV_VARIABLES: readonly string[] = [
  ...new Set([
    LOCK_VARIABLE,
    "MARGAYA_API_URL",
    "GITHUB_OAUTH_CLIENT_ID",
    "GITHUB_OAUTH_CLIENT_SECRET",
    "GITHUB_CLIENT_ID",
    "GITHUB_CLIENT_SECRET",
    "SMTP_SECURE",
    "SMTP_REQUIRE_TLS",
    ...SETTINGS_CATALOG.flatMap((entry) => [
      ...(entry.envVar ? [entry.envVar] : []),
      ...(entry.groupLock ?? []),
    ]),
  ]),
];
