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

const CUSTOM_LOCK = ["CUSTOM_OAUTH_CLIENT_ID"] as const;
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
