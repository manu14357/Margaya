import { createHash } from "node:crypto";
import {
  type Env,
  isEnvSet,
  LOCK_VARIABLE,
  SETTINGS_CATALOG,
  type SettingDefinition,
  type SettingGroup,
  type SettingValue,
} from "./catalog";

// The pure resolver (B12 §2.7): environment, database rows and the global
// lock in, one effective snapshot out. Precedence per key: global lock
// (environment or default only), then a set environment variable (own or
// group lock), then a readable database row, then the catalog default.

export type SettingSource = "environment" | "database" | "default";

export type SettingAuthor = { id: string; name: string };

/** A database row after decryption. `unreadable` secrets carry no value. */
export type StoredSetting = {
  key: string;
  value: SettingValue | null;
  unreadable: boolean;
  updatedAt: Date;
  updatedBy: SettingAuthor | null;
};

export type ResolvedSetting = {
  key: string;
  group: SettingGroup;
  secret: boolean;
  value: SettingValue;
  source: SettingSource;
  locked: boolean;
  envVar: string | null;
  /** Secrets: a non-empty value is in effect (always false otherwise). */
  configured: boolean;
  /** Secrets: a stored value can't be decrypted with the current key. */
  unreadable: boolean;
  updatedAt: Date | null;
  updatedBy: SettingAuthor | null;
};

export const OAUTH_PROVIDERS = [
  "github",
  "google",
  "discord",
  "custom",
] as const;
export type OAuthProviderId = (typeof OAUTH_PROVIDERS)[number];

export type SmtpSecurity = "tls" | "starttls" | "none";

export type EffectiveSettings = {
  instanceName: string;
  publicLanding: boolean;
  inviteOnly: boolean;
  emailSignUp: boolean;
  guestAccess: boolean;
  emailSignIn: boolean;
  emailCodeSignIn: boolean;
  restrictWorkspaceCreation: boolean;
  oauthEnabled: Record<OAuthProviderId, boolean>;
  customOAuth: { autoSignIn: boolean; logoutUrl: string; buttonLabel: string };
  smtp: {
    host: string;
    port: number | null;
    security: SmtpSecurity;
    user: string;
    password: string;
    from: string;
  };
  publicBoards: { enabled: boolean; participation: boolean };
};

/** What the Better Auth instance is built from. Changing it rebuilds. */
export type OAuthBuildConfig = {
  github: { clientId: string; clientSecret: string };
  google: { clientId: string; clientSecret: string };
  discord: { clientId: string; clientSecret: string };
  custom: {
    clientId: string;
    clientSecret: string;
    discoveryUrl: string;
    authorizationUrl: string;
    tokenUrl: string;
    userInfoUrl: string;
    scopes: string[];
    responseType: string;
    pkce: boolean;
  };
};

export type ProviderState = {
  configured: boolean;
  enabled: boolean;
  active: boolean;
  managedByEnvironment: boolean;
  callbackUrl: string;
  envVars: string[];
};

export type DerivedSettings = {
  smtpConfigured: boolean;
  emailSignInActive: boolean;
  emailCodeActive: boolean;
  guestAccessActive: boolean;
  signInMethodsActive: number;
  providers: Record<OAuthProviderId, ProviderState>;
};

export type InstanceSettingsSnapshot = {
  locked: boolean;
  settings: Record<string, ResolvedSetting>;
  effective: EffectiveSettings;
  derived: DerivedSettings;
  oauth: OAuthBuildConfig;
  /** A hash over `oauth`; the auth facade rebuilds when it changes. */
  oauthFingerprint: string;
};

export type ResolveInput = {
  env: Env;
  rows: readonly StoredSetting[];
  /** Called for a stored row that no longer validates. */
  warn?: (key: string, reason: string) => void;
};

function lockingVariable(entry: SettingDefinition, env: Env): string | null {
  if (entry.groupLock) {
    return entry.groupLock.find((name) => isEnvSet(env, name)) ?? null;
  }
  return entry.envVar && isEnvSet(env, entry.envVar) ? entry.envVar : null;
}

function resolveEntry(
  entry: SettingDefinition,
  env: Env,
  row: StoredSetting | undefined,
  globalLock: boolean,
  warn: ResolveInput["warn"],
): ResolvedSetting {
  const base = {
    key: entry.key,
    group: entry.group,
    secret: entry.secret,
    updatedAt: row?.updatedAt ?? null,
    updatedBy: row?.updatedBy ?? null,
    unreadable: Boolean(entry.secret && row?.unreadable),
  };
  const finish = (
    value: SettingValue,
    source: SettingSource,
    locked: boolean,
    envVar: string | null,
  ): ResolvedSetting => ({
    ...base,
    value,
    source,
    locked,
    envVar,
    configured: entry.secret && value !== "",
  });

  const lockVar = lockingVariable(entry, env);
  if (lockVar) {
    return finish(
      entry.readEnv?.(env) ?? entry.default,
      "environment",
      true,
      lockVar,
    );
  }
  if (globalLock) {
    return finish(entry.default, "default", true, LOCK_VARIABLE);
  }
  if (row && !row.unreadable && row.value !== null) {
    const parsed = entry.schema.safeParse(row.value);
    if (parsed.success) return finish(parsed.data, "database", false, null);
    warn?.(entry.key, parsed.error.issues[0]?.message ?? "invalid value");
  }
  return finish(entry.default, "default", false, null);
}

function str(settings: Record<string, ResolvedSetting>, key: string): string {
  const value = settings[key]?.value;
  return typeof value === "string" ? value : String(value ?? "");
}

function flag(settings: Record<string, ResolvedSetting>, key: string): boolean {
  return settings[key]?.value === true;
}

/** The API origin, as Better Auth's `baseURL` derives it. */
export function apiOrigin(env: Env): string {
  const apiUrl = env.MARGAYA_API_URL || "http://localhost:1337";
  try {
    const url = new URL(apiUrl);
    return `${url.protocol}//${url.host}`;
  } catch {
    return apiUrl.split("/").slice(0, 3).join("/");
  }
}

function scopesOf(value: string): string[] {
  return value
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);
}

function buildOAuth(
  settings: Record<string, ResolvedSetting>,
): OAuthBuildConfig {
  const pair = (provider: string) => ({
    clientId: str(settings, `oauth.${provider}.clientId`),
    clientSecret: str(settings, `oauth.${provider}.clientSecret`),
  });
  return {
    github: pair("github"),
    google: pair("google"),
    discord: pair("discord"),
    custom: {
      ...pair("custom"),
      discoveryUrl: str(settings, "oauth.custom.discoveryUrl"),
      authorizationUrl: str(settings, "oauth.custom.authorizationUrl"),
      tokenUrl: str(settings, "oauth.custom.tokenUrl"),
      userInfoUrl: str(settings, "oauth.custom.userInfoUrl"),
      scopes: scopesOf(str(settings, "oauth.custom.scopes")),
      responseType: str(settings, "oauth.custom.responseType") || "code",
      pkce: flag(settings, "oauth.custom.pkce"),
    },
  };
}

function providerEnvVars(provider: OAuthProviderId, env: Env): string[] {
  if (provider === "github") {
    const legacy =
      !isEnvSet(env, "GITHUB_OAUTH_CLIENT_ID") &&
      isEnvSet(env, "GITHUB_CLIENT_ID");
    return legacy
      ? ["GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"]
      : ["GITHUB_OAUTH_CLIENT_ID", "GITHUB_OAUTH_CLIENT_SECRET"];
  }
  if (provider === "custom") {
    return SETTINGS_CATALOG.filter(
      (entry) => entry.group === "oauth.custom" && entry.groupLock,
    ).flatMap((entry) => (entry.envVar ? [entry.envVar] : []));
  }
  const prefix = provider.toUpperCase();
  return [`${prefix}_CLIENT_ID`, `${prefix}_CLIENT_SECRET`];
}

function deriveProviders(
  settings: Record<string, ResolvedSetting>,
  oauth: OAuthBuildConfig,
  env: Env,
): Record<OAuthProviderId, ProviderState> {
  const origin = apiOrigin(env);
  const states = {} as Record<OAuthProviderId, ProviderState>;
  for (const provider of OAUTH_PROVIDERS) {
    const credentials = oauth[provider];
    const managedByEnvironment =
      settings[`oauth.${provider}.clientId`]?.source === "environment";
    let configured = Boolean(credentials.clientId && credentials.clientSecret);
    if (provider === "custom" && configured && !managedByEnvironment) {
      // Environment-managed custom OAuth keeps today's rule (id and secret);
      // a panel configuration also needs its endpoints.
      const custom = oauth.custom;
      configured = Boolean(
        custom.discoveryUrl ||
          (custom.authorizationUrl && custom.tokenUrl && custom.userInfoUrl),
      );
    }
    const enabled = flag(settings, `oauth.${provider}.enabled`);
    states[provider] = {
      configured,
      enabled,
      active: configured && enabled,
      managedByEnvironment,
      callbackUrl:
        provider === "custom"
          ? `${origin}/api/auth/oauth2/callback/custom`
          : `${origin}/api/auth/callback/${provider}`,
      envVars: providerEnvVars(provider, env),
    };
  }
  return states;
}

export function oauthFingerprintOf(oauth: OAuthBuildConfig): string {
  return createHash("sha256").update(JSON.stringify(oauth)).digest("hex");
}

export function resolveInstanceSettings({
  env,
  rows,
  warn,
}: ResolveInput): InstanceSettingsSnapshot {
  const locked = env[LOCK_VARIABLE] === "true";
  const rowsByKey = new Map(rows.map((row) => [row.key, row]));
  const settings: Record<string, ResolvedSetting> = {};
  for (const entry of SETTINGS_CATALOG) {
    settings[entry.key] = resolveEntry(
      entry,
      env,
      rowsByKey.get(entry.key),
      locked,
      warn,
    );
  }

  const port = Number(settings["smtp.port"]?.value);
  const effective: EffectiveSettings = {
    instanceName: str(settings, "general.instanceName"),
    publicLanding: flag(settings, "general.publicLanding"),
    inviteOnly: flag(settings, "auth.inviteOnly"),
    emailSignUp: flag(settings, "auth.emailSignUp"),
    guestAccess: flag(settings, "auth.guestAccess"),
    emailSignIn: flag(settings, "auth.emailSignIn"),
    emailCodeSignIn: flag(settings, "auth.emailCodeSignIn"),
    restrictWorkspaceCreation: flag(settings, "workspaces.restrictCreation"),
    oauthEnabled: {
      github: flag(settings, "oauth.github.enabled"),
      google: flag(settings, "oauth.google.enabled"),
      discord: flag(settings, "oauth.discord.enabled"),
      custom: flag(settings, "oauth.custom.enabled"),
    },
    customOAuth: {
      autoSignIn: flag(settings, "oauth.custom.autoSignIn"),
      logoutUrl: str(settings, "oauth.custom.logoutUrl"),
      buttonLabel: str(settings, "oauth.custom.buttonLabel"),
    },
    smtp: {
      host: str(settings, "smtp.host"),
      port: Number.isFinite(port) && port > 0 ? port : null,
      security: str(settings, "smtp.security") as SmtpSecurity,
      user: str(settings, "smtp.user"),
      password: str(settings, "smtp.password"),
      from: str(settings, "smtp.from"),
    },
    publicBoards: {
      enabled: flag(settings, "publicBoards.enabled"),
      participation: flag(settings, "publicBoards.participation"),
    },
  };

  const oauth = buildOAuth(settings);
  const providers = deriveProviders(settings, oauth, env);
  const smtpConfigured = Boolean(effective.smtp.host && effective.smtp.from);
  const derived: DerivedSettings = {
    smtpConfigured,
    emailSignInActive: effective.emailSignIn,
    emailCodeActive:
      effective.emailSignIn && effective.emailCodeSignIn && smtpConfigured,
    // Today's guest rule: guests need open, email-based sign-up and sign-in.
    guestAccessActive:
      effective.guestAccess &&
      !effective.inviteOnly &&
      effective.emailSignUp &&
      effective.emailSignIn,
    signInMethodsActive:
      (effective.emailSignIn ? 1 : 0) +
      OAUTH_PROVIDERS.filter((provider) => providers[provider].active).length,
    providers,
  };

  return {
    locked,
    settings,
    effective,
    derived,
    oauth,
    oauthFingerprint: oauthFingerprintOf(oauth),
  };
}
