import type {
  InstanceSettingEntry,
  InstanceSettings,
  InstanceSettingsPatch,
  OAuthProviderId,
} from "@/types/instance-admin";

// Pure helpers for the instance admin pages: which catalog groups each page
// shows, where a value comes from, secret field states, sign-in method status
// and the patches the forms send.

export const INSTANCE_PAGES = [
  "general",
  "authentication",
  "email",
  "workspaces",
  "publicBoards",
  "users",
  "admins",
  "ai",
] as const;
export type InstancePage = (typeof INSTANCE_PAGES)[number];

export const INSTANCE_PAGE_PATHS = {
  general: "/dashboard/settings/instance/general",
  authentication: "/dashboard/settings/instance/authentication",
  email: "/dashboard/settings/instance/email",
  workspaces: "/dashboard/settings/instance/workspaces",
  publicBoards: "/dashboard/settings/instance/public-boards",
  users: "/dashboard/settings/instance/users",
  admins: "/dashboard/settings/instance/admins",
  ai: "/dashboard/settings/instance/ai",
} as const satisfies Record<InstancePage, string>;

/** The catalog groups each page manages. */
export const PAGE_GROUPS: Record<InstancePage, readonly string[]> = {
  general: ["general"],
  authentication: [
    "signUp",
    "signIn",
    "oauth.github",
    "oauth.google",
    "oauth.discord",
    "oauth.custom",
  ],
  email: ["smtp"],
  workspaces: ["workspaces"],
  publicBoards: ["publicBoards"],
  users: [],
  admins: [],
  ai: ["ai"],
};

export function settingsForPage(
  settings: readonly InstanceSettingEntry[],
  page: InstancePage,
): InstanceSettingEntry[] {
  const groups = PAGE_GROUPS[page];
  return settings.filter((entry) => groups.includes(entry.group));
}

export type SettingsIndex = Map<string, InstanceSettingEntry>;

export function indexSettings(settings: InstanceSettings | undefined) {
  return new Map((settings?.settings ?? []).map((entry) => [entry.key, entry]));
}

export function settingText(index: SettingsIndex, key: string): string {
  const value = index.get(key)?.value;
  if (value === undefined || value === null) return "";
  return String(value);
}

export function settingFlag(index: SettingsIndex, key: string): boolean {
  return index.get(key)?.value === true;
}

/** A control is read-only when its key or the whole panel is locked. */
export function isSettingLocked(
  settings: InstanceSettings | undefined,
  entry: InstanceSettingEntry | undefined,
): boolean {
  return Boolean(settings?.locked || entry?.locked);
}

export type SourceBadge =
  | { kind: "default"; labelKey: "instanceAdmin:source.default" }
  | {
      kind: "saved";
      labelKey: "instanceAdmin:source.saved";
      tooltipKey: "instanceAdmin:source.savedBy" | null;
      by: string | null;
      at: string | null;
    }
  | {
      kind: "environment";
      labelKey: "instanceAdmin:source.environment";
      tooltipKey: "instanceAdmin:source.lockTooltip";
      variable: string;
    };

export function sourceBadgeOf(
  entry: Pick<InstanceSettingEntry, "source" | "envVar"> & {
    updatedAt?: string | null;
    updatedBy?: { name: string } | null;
  },
): SourceBadge {
  if (entry.source === "environment" && entry.envVar) {
    return {
      kind: "environment",
      labelKey: "instanceAdmin:source.environment",
      tooltipKey: "instanceAdmin:source.lockTooltip",
      variable: entry.envVar,
    };
  }
  if (entry.source === "database") {
    const by = entry.updatedBy?.name ?? null;
    const at = entry.updatedAt ?? null;
    return {
      kind: "saved",
      labelKey: "instanceAdmin:source.saved",
      tooltipKey: by && at ? "instanceAdmin:source.savedBy" : null,
      by,
      at,
    };
  }
  return { kind: "default", labelKey: "instanceAdmin:source.default" };
}

export type SecretFieldState = "empty" | "saved" | "unreadable" | "replacing";

export function secretFieldState(
  entry: Pick<InstanceSettingEntry, "configured" | "unreadable">,
  replacing: boolean,
): SecretFieldState {
  if (entry.unreadable) return "unreadable";
  if (replacing) return "replacing";
  return entry.configured ? "saved" : "empty";
}

/** A typed secret replaces the stored one; nothing typed keeps it. */
export function secretPatchValue(draft: string): string | undefined {
  return draft.trim() ? draft : undefined;
}

/** Text fields: blank clears the saved value (back to the default). */
export function textPatchValue(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export type SignInMethodId = "emailPassword" | "emailCode" | OAuthProviderId;
export type SignInMethodStatus =
  | "active"
  | "off"
  | "notConfigured"
  | "needsEmail";

export type SignInMethod = {
  id: SignInMethodId;
  /** The catalog key its switch writes. */
  settingKey: string;
  enabled: boolean;
  status: SignInMethodStatus;
  locked: boolean;
  envVar: string | null;
  /** Turning it off would leave nobody a way to sign in. */
  isLastActive: boolean;
  isProvider: boolean;
};

export const OAUTH_PROVIDER_IDS = [
  "github",
  "google",
  "discord",
  "custom",
] as const satisfies readonly OAuthProviderId[];

export function signInMethods(settings: InstanceSettings): SignInMethod[] {
  const index = indexSettings(settings);
  const { derived } = settings;
  const onlyOne = derived.signInMethodsActive <= 1;
  const lock = (key: string) => ({
    locked: isSettingLocked(settings, index.get(key)),
    envVar:
      index.get(key)?.source === "environment"
        ? (index.get(key)?.envVar ?? null)
        : null,
  });

  const emailSignIn = settingFlag(index, "auth.emailSignIn");
  const emailCode = settingFlag(index, "auth.emailCodeSignIn");
  const methods: SignInMethod[] = [
    {
      id: "emailPassword",
      settingKey: "auth.emailSignIn",
      enabled: emailSignIn,
      status: emailSignIn ? "active" : "off",
      ...lock("auth.emailSignIn"),
      isLastActive: emailSignIn && onlyOne,
      isProvider: false,
    },
    {
      id: "emailCode",
      settingKey: "auth.emailCodeSignIn",
      enabled: emailCode,
      // A code would skip the second step, so required two-factor stops them.
      status:
        !emailCode ||
        !emailSignIn ||
        settingFlag(index, "auth.requireTwoFactor")
          ? "off"
          : derived.smtpConfigured
            ? "active"
            : "needsEmail",
      ...lock("auth.emailCodeSignIn"),
      // Codes are part of email sign-in, not a method of their own.
      isLastActive: false,
      isProvider: false,
    },
  ];

  for (const provider of OAUTH_PROVIDER_IDS) {
    const state = derived.providers[provider];
    const settingKey = `oauth.${provider}.enabled`;
    methods.push({
      id: provider,
      settingKey,
      enabled: state.enabled,
      status: state.active
        ? "active"
        : state.configured
          ? "off"
          : "notConfigured",
      ...lock(settingKey),
      isLastActive: state.active && onlyOne,
      isProvider: true,
    });
  }
  return methods;
}

/** Custom OAuth's text fields, in form order. */
export const CUSTOM_OAUTH_TEXT_FIELDS = [
  "buttonLabel",
  "discoveryUrl",
  "authorizationUrl",
  "tokenUrl",
  "userInfoUrl",
  "scopes",
  "logoutUrl",
] as const;
export type CustomOAuthTextField = (typeof CUSTOM_OAUTH_TEXT_FIELDS)[number];

export type OAuthDraft = { clientId: string } & Record<
  CustomOAuthTextField,
  string
> & { pkce: boolean; autoSignIn: boolean };

export function oauthDraftOf(
  index: SettingsIndex,
  provider: OAuthProviderId,
): OAuthDraft {
  const custom = (field: string) => settingText(index, `oauth.custom.${field}`);
  return {
    clientId: settingText(index, `oauth.${provider}.clientId`),
    buttonLabel: custom("buttonLabel"),
    discoveryUrl: custom("discoveryUrl"),
    authorizationUrl: custom("authorizationUrl"),
    tokenUrl: custom("tokenUrl"),
    userInfoUrl: custom("userInfoUrl"),
    // Shown as "profile, email" to match the hint.
    scopes: custom("scopes").split(",").filter(Boolean).join(", "),
    logoutUrl: custom("logoutUrl"),
    pkce: settingFlag(index, "oauth.custom.pkce"),
    autoSignIn: settingFlag(index, "oauth.custom.autoSignIn"),
  };
}

/** The changed provider fields. Custom-only fields apply to custom OAuth. */
export function oauthPatch(
  provider: OAuthProviderId,
  draft: OAuthDraft,
  initial: OAuthDraft,
  secretDraft = "",
): InstanceSettingsPatch {
  const patch: InstanceSettingsPatch = {};
  if (draft.clientId.trim() !== initial.clientId.trim()) {
    patch[`oauth.${provider}.clientId`] = textPatchValue(draft.clientId);
  }
  const secret = secretPatchValue(secretDraft);
  if (secret !== undefined) patch[`oauth.${provider}.clientSecret`] = secret;
  if (provider !== "custom") return patch;

  for (const field of CUSTOM_OAUTH_TEXT_FIELDS) {
    if (draft[field].trim() !== initial[field].trim()) {
      patch[`oauth.custom.${field}`] = textPatchValue(draft[field]);
    }
  }
  if (draft.pkce !== initial.pkce) patch["oauth.custom.pkce"] = draft.pkce;
  if (draft.autoSignIn !== initial.autoSignIn) {
    patch["oauth.custom.autoSignIn"] = draft.autoSignIn;
  }
  return patch;
}

/** Empty, or an absolute http(s) URL, as the server accepts it. */
export function isValidOptionalUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export type SmtpSecurity = "tls" | "starttls" | "none";

export type SmtpFormValues = {
  host: string;
  port: string;
  security: SmtpSecurity;
  user: string;
  from: string;
};

export function smtpFormValues(index: SettingsIndex): SmtpFormValues {
  const port = Number(index.get("smtp.port")?.value ?? 0);
  const security = settingText(index, "smtp.security");
  return {
    host: settingText(index, "smtp.host"),
    // 0 means "the default port of the security mode": an empty field.
    port: Number.isInteger(port) && port > 0 ? String(port) : "",
    security: security === "starttls" || security === "none" ? security : "tls",
    user: settingText(index, "smtp.user"),
    from: settingText(index, "smtp.from"),
  };
}

/** Only the fields that changed, with blanks clearing the saved value. */
export function smtpPatch(
  values: SmtpFormValues,
  initial: SmtpFormValues,
  passwordDraft = "",
): InstanceSettingsPatch {
  const patch: InstanceSettingsPatch = {};
  const text = (key: "host" | "user" | "from") => {
    if (values[key].trim() !== initial[key].trim()) {
      patch[`smtp.${key}`] = textPatchValue(values[key]);
    }
  };
  text("host");
  if (values.port.trim() !== initial.port.trim()) {
    patch["smtp.port"] = values.port.trim() ? Number(values.port) : null;
  }
  if (values.security !== initial.security) {
    patch["smtp.security"] = values.security;
  }
  text("user");
  text("from");
  const password = secretPatchValue(passwordDraft);
  if (password !== undefined) patch["smtp.password"] = password;
  return patch;
}

export const SMTP_KEYS = [
  "smtp.host",
  "smtp.port",
  "smtp.security",
  "smtp.user",
  "smtp.password",
  "smtp.from",
] as const;

/** "Remove email settings": clear every saved SMTP value. */
export function clearSmtpPatch(): InstanceSettingsPatch {
  return Object.fromEntries(SMTP_KEYS.map((key) => [key, null]));
}

const SMTP_HOST =
  /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.?)+$|^\[?[0-9A-Fa-f:.]+\]?$/;
const EMAIL = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/;

export function isValidSmtpHost(value: string): boolean {
  const trimmed = value.trim();
  return !trimmed || (trimmed.length <= 253 && SMTP_HOST.test(trimmed));
}

export function isValidSmtpPort(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  const port = Number(trimmed);
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

export function isValidEmail(value: string): boolean {
  return EMAIL.test(value.trim());
}

/** `address` or `Name <address>`, as the server accepts it. */
export function isValidFromAddress(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  const named = /^(.*)<([^<>]+)>$/.exec(trimmed);
  return isValidEmail(named ? (named[2] ?? "") : trimmed);
}
