import { nullableResponseTimestamp, responseTimestamp, z } from "../openapi";

const yes = (description: string) => z.boolean().openapi({ description });

export const instanceReauthRequiredSchema = z
  .object({ code: z.string(), message: z.string() })
  .openapi("InstanceReauthRequired");

export const instanceOverviewSchema = z
  .object({
    instanceName: z.string(),
    version: z.string().openapi({ description: "The Margaya version." }),
    counts: z.object({
      accounts: z.number().int().openapi({ description: "Non-guest users." }),
      guests: z.number().int(),
      workspaces: z.number().int(),
      projects: z.number().int(),
      publishedBoards: z.number().int(),
    }),
    server: z.object({
      realtime: z.enum(["memory", "standalone", "sentinel", "cluster"]),
      email: yes("Outgoing email is configured."),
      fileStorage: yes("File storage is on: S3, or the built-in local store."),
      captcha: yes("Turnstile captcha is configured."),
      errorReporting: yes("Error reporting is configured."),
      cloudMode: z.boolean(),
      demoMode: z.boolean(),
    }),
    settingsLocked: yes(
      "MARGAYA_LOCK_INSTANCE_SETTINGS is on: the panel is read-only.",
    ),
  })
  .openapi("InstanceOverview");

const settingAuthor = z
  .object({ id: z.string(), name: z.string() })
  .nullable()
  .openapi("InstanceSettingAuthor");

export const instanceSettingEntrySchema = z
  .object({
    key: z.string(),
    group: z.string(),
    value: z.union([z.string(), z.number(), z.boolean()]).optional().openapi({
      description:
        "The effective value. Omitted for secrets, which are never returned. smtp.port 0 means the default port of the security mode.",
    }),
    source: z.enum(["environment", "database", "default"]),
    locked: yes(
      "Set by the environment (or the global lock); the panel can't change it.",
    ),
    envVar: z.string().nullable().openapi({
      description: "The variable that locks it, or null.",
    }),
    secret: z.boolean(),
    configured: yes("Secrets: a value is in effect. Always false otherwise."),
    unreadable: yes(
      "Secrets: a saved value can't be decrypted (AUTH_SECRET changed).",
    ),
    updatedAt: nullableResponseTimestamp,
    updatedBy: settingAuthor,
  })
  .openapi("InstanceSettingEntry");

export const instanceProviderStateSchema = z
  .object({
    configured: z.boolean(),
    enabled: z.boolean(),
    active: z.boolean(),
    managedByEnvironment: z.boolean(),
    callbackUrl: z.string(),
    envVars: z.array(z.string()),
  })
  .openapi("InstanceSignInProvider");

export const instanceSettingsSchema = z
  .object({
    locked: yes("The global lock: every setting is read-only."),
    settings: z.array(instanceSettingEntrySchema),
    derived: z.object({
      smtpConfigured: z.boolean(),
      guestAccessActive: z.boolean(),
      emailCodeActive: z.boolean(),
      signInMethodsActive: z.number().int(),
      providers: z.object({
        github: instanceProviderStateSchema,
        google: instanceProviderStateSchema,
        discord: instanceProviderStateSchema,
        custom: instanceProviderStateSchema,
      }),
    }),
  })
  .openapi("InstanceSettings");

export const instanceWorkspacePageSchema = z
  .object({
    items: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        slug: z.string(),
        logo: z.string().nullable(),
        createdAt: responseTimestamp,
        owner: z
          .object({ id: z.string(), name: z.string(), email: z.string() })
          .nullable(),
        memberCount: z.number().int(),
        projectCount: z.number().int(),
        deletionDueAt: nullableResponseTimestamp.openapi({
          description:
            "Set while a deletion is pending: when the workspace will be deleted.",
        }),
      }),
    ),
    nextCursor: z.string().nullable(),
  })
  .openapi("InstanceWorkspacePage");

export const smtpTestResultSchema = z
  .object({
    sent: z.boolean(),
    code: z.enum([
      "ok",
      "auth",
      "connection",
      "tls",
      "timeout",
      "sender",
      "recipient",
      "unknown",
    ]),
    message: z.string(),
  })
  .openapi("SmtpTestResult");

export const instanceAdminSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    image: z.string().nullable(),
    isYou: z.boolean(),
  })
  .openapi("InstanceAdmin");

export const removedInstanceAdminSchema = z
  .object({ userId: z.string() })
  .openapi("RemovedInstanceAdmin");

export const instancePublicBoardPageSchema = z
  .object({
    items: z.array(
      z.object({
        projectId: z.string(),
        projectName: z.string(),
        workspaceId: z.string(),
        workspaceName: z.string(),
        publishedAt: responseTimestamp,
        path: z.string().openapi({ description: "/public-project/{token}" }),
        features: z.object({
          comments: z.boolean(),
          reactions: z.boolean(),
          votes: z.boolean(),
          requests: z.boolean(),
          guests: z.boolean(),
        }),
      }),
    ),
    nextCursor: z.string().nullable(),
  })
  .openapi("InstancePublicBoardPage");

export const instanceReauthResultSchema = z
  .object({
    reauthenticatedUntil: z.string().openapi({
      description:
        "When the confirmation stops covering instance-admin changes (ISO 8601).",
    }),
  })
  .openapi("InstanceReauthResult");

export const instanceAuditEntrySchema = z
  .object({
    id: z.string(),
    actorType: z.enum(["user", "system"]).openapi({
      description: "system: the recovery CLI or the server itself.",
    }),
    actorUserId: z.string().nullable(),
    actorName: z.string().nullable(),
    action: z.string().openapi({
      description:
        "A stable action name such as instance.settings_updated or user.banned.",
    }),
    targetType: z.string().nullable(),
    targetId: z.string().nullable(),
    targetLabel: z.string().nullable(),
    metadata: z.record(z.string(), z.unknown()).nullable().openapi({
      description:
        "Details such as the setting keys that changed. Secret values are never stored.",
    }),
    ipAddress: z.string().nullable(),
    createdAt: responseTimestamp,
  })
  .openapi("InstanceAuditEntry");

export const instanceAuditPageSchema = z
  .object({
    items: z.array(instanceAuditEntrySchema),
    nextCursor: z.string().nullable(),
  })
  .openapi("InstanceAuditPage");

export const instanceDeliveryFailuresSchema = z
  .object({
    items: z.array(
      z.object({
        id: z.string(),
        workspaceName: z.string(),
        webhookName: z.string().nullable(),
        event: z.string(),
        error: z.string().nullable().openapi({
          description: "A safe message, never raw exception text.",
        }),
        responseStatus: z.number().int().nullable(),
        attemptCount: z.number().int(),
        failedAt: responseTimestamp,
      }),
    ),
  })
  .openapi("InstanceDeliveryFailures");

export const instanceUserPageSchema = z
  .object({
    items: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        email: z.string(),
        image: z.string().nullable(),
        isAdmin: z.boolean(),
        banned: yes("Banned now (a timed ban that ran out reads false)."),
        banReason: z.string().nullable(),
        banExpires: nullableResponseTimestamp,
        twoFactorEnabled: z.boolean(),
        workspaceCount: z.number().int(),
        lastActiveAt: nullableResponseTimestamp.openapi({
          description: "The latest session activity, or null.",
        }),
        createdAt: responseTimestamp,
      }),
    ),
    nextCursor: z.string().nullable(),
  })
  .openapi("InstanceUserPage");

export const instanceUserDetailSchema = z
  .object({
    id: z.string(),
    workspaces: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        slug: z.string(),
        role: z.string(),
        joinedAt: responseTimestamp,
      }),
    ),
    activeSessions: z.number().int(),
    hasPassword: z.boolean(),
  })
  .openapi("InstanceUserDetail");

export const instanceUserActionSchema = z
  .object({
    userId: z.string(),
    banned: z.boolean().optional(),
    revoked: z.number().int().optional(),
    method: z.enum(["email", "set"]).optional(),
  })
  .openapi("InstanceUserActionResult");

const checkStatus = z.enum(["ok", "warning", "error", "off"]);

export const instanceHealthSchema = z
  .object({
    version: z.string(),
    nodeVersion: z.string(),
    startedAt: responseTimestamp,
    uptimeSeconds: z.number().int(),
    migrations: z.object({
      status: z.enum(["ok", "pending", "unknown"]).openapi({
        description:
          "pending: this build ships migrations the database hasn't run; unknown: the migration table or the shipped journal can't be read.",
      }),
      applied: z.number().int(),
      available: z.number().int(),
      pending: z.number().int(),
      latest: z.string().nullable().openapi({
        description: "The newest shipped migration the database has.",
      }),
      latestAppliedAt: nullableResponseTimestamp,
    }),
    checks: z.array(
      z.object({
        id: z.enum(["database", "redis", "storage", "email", "ai"]),
        status: checkStatus,
        code: z.string().nullable().openapi({
          description:
            "A short reason: unreachable, timeout, disabled, not_configured, s3, local, none, denied, not_writable, recent_errors, or an SMTP code (auth, connection, tls, sender, recipient, unknown). Never server text.",
        }),
        latencyMs: z.number().int().nullable(),
        count: z.number().int().nullable().openapi({
          description: "ai: failed calls in the last 24 hours.",
        }),
      }),
    ),
    jobs: z
      .array(
        z.object({
          name: z.string(),
          running: z.boolean(),
          lastRunAt: nullableResponseTimestamp,
          lastOutcome: z.enum(["ok", "degraded", "failed"]).nullable(),
          lastDurationMs: z.number().int().nullable(),
          lastSuccessAt: nullableResponseTimestamp,
          lastFailureAt: nullableResponseTimestamp,
          runs: z.number().int(),
          failures: z.number().int(),
        }),
      )
      .openapi({
        description:
          "Scheduled jobs on the instance that answered, since it started.",
      }),
    failures: z
      .array(
        z.object({
          source: z.enum(["job", "ai", "email"]),
          name: z.string(),
          message: z.string().nullable().openapi({
            description:
              "The error class and the start of its message; details are in the server log.",
          }),
          at: responseTimestamp,
        }),
      )
      .openapi({
        description:
          "The newest 20 failures recorded by the instance that answered, since it started.",
      }),
    queues: z
      .object({
        emailBacklog: z.number().int(),
        webhookPending: z.number().int(),
        webhookFailed24h: z.number().int(),
      })
      .nullable(),
    connections: z.object({
      project: z.number().int(),
      user: z.number().int(),
      pageRooms: z.number().int(),
    }),
    metrics: z.object({
      enabled: yes("MARGAYA_METRICS_ENABLED is true."),
      token: yes("MARGAYA_METRICS_TOKEN is set (never returned)."),
      port: z.number().int().nullable(),
    }),
  })
  .openapi("InstanceHealth");

export const instanceUpdateStatusSchema = z
  .object({
    enabled: yes("The update check is on (off by default)."),
    currentVersion: z.string(),
    latestVersion: z.string().nullable(),
    updateAvailable: z.boolean(),
    releaseUrl: z.string().nullable(),
    publishedAt: nullableResponseTimestamp,
    checkedAt: nullableResponseTimestamp,
    error: z.enum(["unreachable", "invalid_response"]).nullable(),
  })
  .openapi("InstanceUpdateStatus");
