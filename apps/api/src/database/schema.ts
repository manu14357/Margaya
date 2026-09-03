import { createId } from "@paralleldrive/cuid2";
import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  date,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { ColumnGroup } from "../column/groups";
import type { CycleProgressSnapshot } from "../cycle/types";
import type {
  FavoriteEntityType,
  RecentVisitEntityType,
} from "../entity-reference/types";
import type { EstimateType } from "../estimate/types";
import type { GitHubImportState } from "../github-integration/import-state";
import type { ModuleStatus } from "../module/types";
import type {
  PageAccess,
  PageLogoKind,
  PageReferenceType,
} from "../page/types";
import type {
  TaskExportFormat,
  TaskExportStatus,
  TaskExportStorage,
} from "../task-export/types";
import type {
  ViewAccess,
  ViewDisplay,
  ViewDisplayProperties,
  ViewFilters,
} from "../view/types";
import type {
  WebhookAttempt,
  WebhookDeliveryStatus,
  WebhookDeliveryTrigger,
  WebhookDisabledReason,
  WebhookEntityType,
} from "../webhook/types";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const userTable = pgTable("user", {
  id: text("id")
    .$defaultFn(() => createId())
    .primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified")
    .$defaultFn(() => false)
    .notNull(),
  image: text("image"),
  locale: text("locale"),
  // IANA zone for server-rendered user-facing times (reminders, digests).
  // Null means "not chosen yet": the server falls back to UTC.
  timezone: text("timezone"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" })
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
  isAnonymous: boolean("is_anonymous").default(false),
  role: text("role"),
  banned: boolean("banned").default(false),
  banReason: text("ban_reason"),
  banExpires: timestamp("ban_expires", { mode: "date" }),
});

export const sessionTable = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => userTable.id, { onDelete: "cascade" }),
    activeOrganizationId: text("active_organization_id"),
    activeTeamId: text("active_team_id"),
    impersonatedBy: text("impersonated_by"),
  },
  (table) => [index("session_userId_idx").on(table.userId)],
);

export const accountTable = pgTable(
  "account",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => userTable.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      mode: "date",
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      mode: "date",
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("account_userId_idx").on(table.userId)],
);

export const userAvatarTable = pgTable(
  "user_avatar",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    userId: text("user_id")
      .notNull()
      .unique("user_avatar_user_id_unique")
      .references(() => userTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    mimeType: text("mime_type").notNull(),
    size: integer("size").notNull(),
    data: bytea("data").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("user_avatar_userId_idx").on(table.userId)],
);

export const verificationTable = pgTable(
  "verification",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const workspaceTable = pgTable("workspace", {
  id: text("id")
    .$defaultFn(() => createId())
    .primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logo: text("logo"),
  metadata: text("metadata"),
  description: text("description"),
  // IANA zone that defines "today" and day boundaries for server-side date
  // logic (cycles, automations, reminders). UTC keeps legacy behaviour.
  timezone: text("timezone").notNull().default("UTC"),
  createdAt: timestamp("created_at", { mode: "date" }).notNull(),
});

export const workspaceUserTable = pgTable(
  "workspace_member",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaceTable.id, {
        onDelete: "cascade",
      }),
    userId: text("user_id")
      .notNull()
      .references(() => userTable.id, {
        onDelete: "cascade",
      }),
    role: text("role").default("member").notNull(),
    joinedAt: timestamp("joined_at", { mode: "date" }).notNull(),
  },
  (table) => [
    index("workspace_member_workspaceId_idx").on(table.workspaceId),
    index("workspace_member_userId_idx").on(table.userId),
  ],
);

export const workspaceBillingTable = pgTable(
  "workspace_billing",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .unique("workspace_billing_workspace_id_unique")
      .references(() => workspaceTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    foundingFree: boolean("founding_free").notNull().default(false),
    trialEndsAt: timestamp("trial_ends_at", { mode: "date" }),
    creemCustomerId: text("creem_customer_id"),
    creemSubscriptionId: text("creem_subscription_id").unique(),
    creemProductId: text("creem_product_id"),
    plan: text("plan"),
    billingInterval: text("billing_interval"),
    status: text("status"),
    seats: integer("seats").notNull().default(1),
    currentPeriodEnd: timestamp("current_period_end", { mode: "date" }),
    canceledAt: timestamp("canceled_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("workspace_billing_workspaceId_idx").on(table.workspaceId)],
);

export const trialGrantTable = pgTable("trial_grant", {
  emailHash: text("email_hash").primaryKey(),
  trialEndsAt: timestamp("trial_ends_at", { mode: "date" }).notNull(),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

export const billingEventTable = pgTable("billing_event", {
  id: text("id").primaryKey(),
  eventType: text("event_type").notNull(),
  processedAt: timestamp("processed_at", { mode: "date" })
    .defaultNow()
    .notNull(),
});

export const teamTable = pgTable(
  "team",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaceTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").$onUpdate(
      () => /* @__PURE__ */ new Date(),
    ),
  },
  (table) => [index("team_workspaceId_idx").on(table.workspaceId)],
);

export const teamMemberTable = pgTable(
  "team_member",
  {
    id: text("id").primaryKey(),
    teamId: text("team_id")
      .notNull()
      .references(() => teamTable.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => userTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at"),
  },
  (table) => [
    index("teamMember_teamId_idx").on(table.teamId),
    index("teamMember_userId_idx").on(table.userId),
  ],
);

export const invitationTable = pgTable(
  "invitation",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaceTable.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role"),
    teamId: text("team_id"),
    status: text("status").default("pending").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    inviterId: text("inviter_id")
      .notNull()
      .references(() => userTable.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("invitation_workspaceId_idx").on(table.workspaceId),
    index("invitation_email_idx").on(table.email),
    index("invitation_inviterId_idx").on(table.inviterId),
  ],
);

export const workspaceRoleTable = pgTable(
  "workspace_role",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaceTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    role: text("role").notNull(),
    permission: text("permission").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("workspace_role_workspaceId_idx").on(table.workspaceId),
    index("workspace_role_role_idx").on(table.role),
  ],
);

export const projectTable = pgTable(
  "project",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaceTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    slug: text("slug").notNull(),
    icon: text("icon").default("Layout"),
    name: text("name").notNull(),
    description: text("description"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    isPublic: boolean("is_public").default(false),
    archivedAt: timestamp("archived_at", { mode: "date" }),
    lastTaskNumber: integer("last_task_number").notNull().default(0),
    position: integer("position").notNull().default(0),
    // Per-project feature toggles. A disabled feature hides its UI and its
    // API routes answer 403; stored data is kept.
    cyclesEnabled: boolean("cycles_enabled").notNull().default(true),
    modulesEnabled: boolean("modules_enabled").notNull().default(true),
    viewsEnabled: boolean("views_enabled").notNull().default(true),
    pagesEnabled: boolean("pages_enabled").notNull().default(true),
    intakeEnabled: boolean("intake_enabled").notNull().default(false),
    estimatesEnabled: boolean("estimates_enabled").notNull().default(false),
    timeTrackingEnabled: boolean("time_tracking_enabled")
      .notNull()
      .default(true),
    // Optional project lead and default assignee. Both must be workspace
    // members; the API clears them when the member leaves the workspace.
    leadUserId: text("lead_user_id").references(() => userTable.id, {
      onDelete: "set null",
    }),
    defaultAssigneeUserId: text("default_assignee_user_id").references(
      () => userTable.id,
      { onDelete: "set null" },
    ),
    // Set while the project is in the trash (with its tasks, whose
    // `trashBatchId` is this project's id). Trashed projects behave as if
    // they no longer exist outside the trash views; see project/trash.ts.
    deletedAt: timestamp("deleted_at", { mode: "date" }),
    deletedBy: text("deleted_by").references(() => userTable.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    unique("project_workspace_id_id_unique").on(table.workspaceId, table.id),
    index("project_workspaceId_position_idx").on(
      table.workspaceId,
      table.position,
    ),
    // Workspace trash list and the auto purge.
    index("project_workspaceId_deletedAt_idx")
      .on(table.workspaceId, table.deletedAt)
      .where(sql`${table.deletedAt} is not null`),
  ],
);

export const columnTable = pgTable(
  "column",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projectTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    position: integer("position").notNull().default(0),
    icon: text("icon"),
    color: text("color"),
    // `group` is an SQL reserved word, hence the column name.
    group: text("status_group")
      .$type<ColumnGroup>()
      .notNull()
      .default("unstarted"),
    // API-maintained mirror of "closed" (group completed or cancelled), kept
    // for existing readers such as reminders and integrations.
    isFinal: boolean("is_final").default(false).notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("column_projectId_idx").on(table.projectId),
    index("column_projectId_statusGroup_idx").on(table.projectId, table.group),
    // Intake (B7) creates the one triage column lazily; this keeps concurrent
    // first submissions from creating two.
    uniqueIndex("column_project_triage_unique")
      .on(table.projectId)
      .where(sql`${table.group} = 'triage'`),
  ],
);

export const workflowRuleTable = pgTable(
  "workflow_rule",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projectTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    integrationType: text("integration_type").notNull(),
    eventType: text("event_type").notNull(),
    columnId: text("column_id")
      .notNull()
      .references(() => columnTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("workflow_rule_projectId_idx").on(table.projectId),
    index("workflow_rule_columnId_idx").on(table.columnId),
  ],
);

export const taskTable = pgTable(
  "task",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projectTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    position: integer("position").default(0),
    number: integer("number").default(1),
    userId: text("assignee_id").references(() => userTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status").notNull().default("to-do"),
    columnId: text("column_id").references(() => columnTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    priority: text("priority").default("low").notNull(),
    startDate: timestamp("start_date", { mode: "date" }),
    dueDate: timestamp("due_date", { mode: "date" }),
    // Set when the task enters a completed-group column, cleared when it
    // leaves one; archiving never touches it. See task/scope.ts.
    completedAt: timestamp("completed_at", { mode: "date" }),
    // Set while the task is archived. Orthogonal to the column: `status` and
    // `columnId` keep the task's column (D7). `status = 'archived'` is only
    // a legacy input alias; the boot migration converts old rows.
    archivedAt: timestamp("archived_at", { mode: "date" }),
    // Who created the task; null for integration-made tasks and deleted
    // users (D13).
    createdBy: text("created_by").references(() => userTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    // Null, or a point of the active estimate system of the task's own
    // project. The estimate routes and the task move repair tasks before any
    // change that would break this; the FK action is only a backstop.
    estimatePointId: text("estimate_point_id").references(
      () => estimatePointTable.id,
      { onDelete: "set null", onUpdate: "cascade" },
    ),
    // Set while the task is in the trash; trashed tasks behave as if they no
    // longer exist outside the trash views (see task/trash.ts). Tasks trashed
    // together share `trashBatchId`: the id of the task or project whose
    // delete trashed them, so restoring it brings back exactly that batch.
    deletedAt: timestamp("deleted_at", { mode: "date" }),
    deletedBy: text("deleted_by").references(() => userTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    trashBatchId: text("trash_batch_id"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("task_projectId_idx").on(table.projectId),
    // Trash (C7): the per-project trash list and the auto purge, plus batch
    // restores and purges.
    index("task_projectId_deletedAt_idx")
      .on(table.projectId, table.deletedAt)
      .where(sql`${table.deletedAt} is not null`),
    index("task_trashBatchId_idx")
      .on(table.trashBatchId)
      .where(sql`${table.trashBatchId} is not null`),
    index("task_dueDate_idx").on(table.dueDate),
    index("task_assigneeId_idx").on(table.userId),
    index("task_columnId_idx").on(table.columnId),
    index("task_projectId_completedAt_idx").on(
      table.projectId,
      table.completedAt,
    ),
    // Analytics (B8): the "created" series and created-date ranges.
    index("task_projectId_createdAt_idx").on(table.projectId, table.createdAt),
    index("task_estimatePointId_idx").on(table.estimatePointId),
    // Task query engine (B4): status and group filters, the default
    // (non-archived) scope in manual order, archived-only lists, updated and
    // due-date orders, and creator filters.
    index("task_projectId_status_idx").on(table.projectId, table.status),
    index("task_projectId_active_position_idx")
      .on(table.projectId, table.position)
      .where(sql`${table.archivedAt} is null`),
    index("task_projectId_archivedAt_idx")
      .on(table.projectId, table.archivedAt)
      .where(sql`${table.archivedAt} is not null`),
    index("task_projectId_updatedAt_idx").on(table.projectId, table.updatedAt),
    // Scheduled automations (B11): unarchived tasks, least recently updated
    // first, without walking the archive.
    index("task_projectId_updatedAt_active_idx")
      .on(table.projectId, table.updatedAt)
      .where(sql`${table.archivedAt} is null`),
    index("task_projectId_dueDate_idx").on(table.projectId, table.dueDate),
    index("task_createdBy_idx").on(table.createdBy),
    unique("task_project_number_unique").on(table.projectId, table.number),
  ],
);

export const billingReminderSentTable = pgTable(
  "billing_reminder_sent",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => userTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaceTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    reminderType: text("reminder_type").notNull(),
    trialEndsAt: timestamp("trial_ends_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("billing_reminder_sent_workspaceId_idx").on(table.workspaceId),
    index("billing_reminder_sent_userId_idx").on(table.userId),
    unique("billing_reminder_sent_user_type_unique").on(
      table.userId,
      table.reminderType,
    ),
  ],
);

export const jobLeaseTable = pgTable("job_lease", {
  name: text("name").primaryKey(),
  owner: text("owner").notNull(),
  expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
});

export const taskReminderSentTable = pgTable(
  "task_reminder_sent",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => taskTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    reminderType: text("reminder_type").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("task_reminder_sent_taskId_idx").on(table.taskId),
    unique("task_reminder_sent_task_type_unique").on(
      table.taskId,
      table.reminderType,
    ),
  ],
);

export const timeEntryTable = pgTable(
  "time_entry",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => taskTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    userId: text("user_id").references(() => userTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    description: text("description"),
    startTime: timestamp("start_time", { mode: "date" }).notNull(),
    endTime: timestamp("end_time", { mode: "date" }),
    duration: integer("duration").default(0),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("time_entry_taskId_idx").on(table.taskId),
    index("time_entry_userId_idx").on(table.userId),
  ],
);

export const activityTable = pgTable(
  "activity",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => taskTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    type: text("type").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    userId: text("user_id").references(() => userTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    content: text("content"),
    eventData: jsonb("event_data"),
    externalUserName: text("external_user_name"),
    externalUserAvatar: text("external_user_avatar"),
    externalSource: text("external_source"),
    externalUrl: text("external_url"),
    // B12 K10: a comment is internal (the default) or public, shown on the
    // project's public board. Other activity types stay internal.
    visibility: text("visibility")
      .$type<"internal" | "public">()
      .notNull()
      .default("internal"),
  },
  (table) => [
    index("activity_task_id_idx").on(table.taskId),
    index("activity_userId_idx").on(table.userId),
    // "Your work" and member profile feeds: one person's newest rows first,
    // read in index order instead of sorting their whole history. NULLS FIRST
    // is PostgreSQL's default for DESC, so `order by ... desc` matches it;
    // drizzle's plain .desc() would emit NULLS LAST, which the planner skips.
    index("activity_userId_createdAt_idx").on(
      table.userId,
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    unique("activity_task_external_source_external_url_unique").on(
      table.taskId,
      table.externalSource,
      table.externalUrl,
    ),
    check(
      "activity_visibility_check",
      sql`${table.visibility} in ('internal', 'public')`,
    ),
    // Public comment lists, counts and moderation stay cheap however large
    // the activity table grows.
    index("activity_public_comment_idx")
      .on(table.taskId, table.createdAt, table.id)
      .where(sql`${table.type} = 'comment' and ${table.visibility} = 'public'`),
  ],
);

export const assetTable = pgTable(
  "asset",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaceTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    projectId: text("project_id")
      .notNull()
      .references(() => projectTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    taskId: text("task_id").references(() => taskTable.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    }),
    activityId: text("activity_id").references(() => activityTable.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    }),
    // Set for files uploaded into a page (surface "page"). Set null, not
    // cascade: duplicates keep pointing at the source page's assets, and the
    // page delete re-points or removes them itself.
    pageId: text("page_id").references(() => pageTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    objectKey: text("object_key").notNull().unique(),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    size: integer("size").notNull(),
    kind: text("kind").notNull().default("image"),
    surface: text("surface").notNull().default("description"),
    createdBy: text("created_by").references(() => userTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    index("asset_workspaceId_idx").on(table.workspaceId),
    index("asset_projectId_idx").on(table.projectId),
    index("asset_taskId_idx").on(table.taskId),
    index("asset_activityId_idx").on(table.activityId),
    index("asset_createdBy_idx").on(table.createdBy),
    index("asset_pageId_idx").on(table.pageId),
  ],
);

export const labelTable = pgTable(
  "label",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    name: text("name").notNull(),
    color: text("color").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    deletionStartedAt: timestamp("deletion_started_at", { mode: "date" }),
    taskId: text("task_id").references(() => taskTable.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    }),
    workspaceId: text("workspace_id").references(() => workspaceTable.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    }),
  },
  (table) => [
    index("label_task_id_idx").on(table.taskId),
    index("label_workspace_id_idx").on(table.workspaceId),
    index("label_workspace_cascade_idx")
      .on(table.workspaceId, table.name, table.createdAt, table.id)
      .where(sql`${table.taskId} is not null`),
    unique("label_task_name_unique").on(table.taskId, table.name),
    uniqueIndex("label_workspace_name_unique")
      .on(table.workspaceId, table.name)
      .where(sql`${table.taskId} is null`),
  ],
);

export const notificationTable = pgTable(
  "notification",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => userTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    title: text("title"),
    content: text("content"),
    type: text("type").notNull().default("info"),
    eventData: jsonb("event_data"),
    isRead: boolean("is_read").default(false),
    resourceId: text("resource_id"),
    resourceType: text("resource_type"),
    // Derived on the server from the resource (task → its project's
    // workspace, workspace → itself). Null only for resource-less rows,
    // which show in every workspace's inbox.
    workspaceId: text("workspace_id").references(() => workspaceTable.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    }),
    // Who caused it; null for system rows (reminders) and integrations.
    actorId: text("actor_id").references(() => userTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    // Inbox state: archived, snoozed until an instant, and when a snooze
    // ended (the Inbox view sorts by coalesce(resurfaced_at, created_at)).
    archivedAt: timestamp("archived_at", { mode: "date", withTimezone: true }),
    snoozedUntil: timestamp("snoozed_until", {
      mode: "date",
      withTimezone: true,
    }),
    resurfacedAt: timestamp("resurfaced_at", {
      mode: "date",
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("notification_userId_idx").on(table.userId),
    index("notification_workspaceId_idx").on(table.workspaceId),
    index("notification_actorId_idx").on(table.actorId),
    index("notification_inbox_idx").on(
      table.userId,
      table.workspaceId,
      sql`coalesce(${table.resurfacedAt}, ${table.createdAt}) desc`,
      table.id.desc(),
    ),
    index("notification_snoozedUntil_idx")
      .on(table.snoozedUntil)
      .where(sql`${table.snoozedUntil} is not null`),
    index("notification_resource_idx").on(table.resourceType, table.resourceId),
    index("notification_workspace_missing_idx")
      .on(table.id)
      .where(
        sql`${table.workspaceId} is null and ${table.resourceType} is not null`,
      ),
  ],
);

export const userNotificationPreferenceTable = pgTable(
  "user_notification_preference",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    userId: text("user_id")
      .notNull()
      .unique()
      .references(() => userTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    emailEnabled: boolean("email_enabled").default(false).notNull(),
    ntfyEnabled: boolean("ntfy_enabled").default(false).notNull(),
    ntfyServerUrl: text("ntfy_server_url"),
    ntfyTopic: text("ntfy_topic"),
    ntfyToken: text("ntfy_token"),
    gotifyEnabled: boolean("gotify_enabled").default(false).notNull(),
    gotifyServerUrl: text("gotify_server_url"),
    gotifyToken: text("gotify_token"),
    webhookEnabled: boolean("webhook_enabled").default(false).notNull(),
    webhookUrl: text("webhook_url"),
    webhookSecret: text("webhook_secret"),
    taskAssignmentEnabled: boolean("task_assignment_enabled")
      .default(true)
      .notNull(),
    taskCommentEnabled: boolean("task_comment_enabled").default(true).notNull(),
    taskStatusChangeEnabled: boolean("task_status_change_enabled")
      .default(true)
      .notNull(),
    // Priority, due date and title changes on tasks the user watches.
    taskUpdateEnabled: boolean("task_update_enabled").default(true).notNull(),
    dueDateReminderEnabled: boolean("due_date_reminder_enabled")
      .default(true)
      .notNull(),
    dueDateReminderLeadTimeMinutes: integer(
      "due_date_reminder_lead_time_minutes",
    )
      .default(1440)
      .notNull(),
    // Optional summary email: off, daily or weekly (on digestWeekday,
    // 0 = Sunday) at digestHour in the user's local time.
    digestFrequency: text("digest_frequency").default("off").notNull(),
    digestWeekday: integer("digest_weekday").default(1).notNull(),
    digestHour: integer("digest_hour").default(8).notNull(),
    // Stamped when a digest period is handled (sent, or skipped as empty),
    // so a period never sends twice.
    lastDigestSentAt: timestamp("last_digest_sent_at", {
      mode: "date",
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
);

// Email notifications waiting for their batch window
// (EMAIL_NOTIFICATION_BATCH_WINDOW_SECONDS). The scheduler sends one email
// per user per window and deletes the rows it handled; `claimedAt` keeps
// two senders off the same rows and lets a crashed claim be retried.
export const notificationEmailQueueTable = pgTable(
  "notification_email_queue",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    notificationId: text("notification_id")
      .notNull()
      .unique()
      .references(() => notificationTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    userId: text("user_id")
      .notNull()
      .references(() => userTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    claimedAt: timestamp("claimed_at", { mode: "date", withTimezone: true }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("notification_email_queue_user_created_idx").on(
      table.userId,
      table.createdAt,
    ),
  ],
);

export const userNotificationWorkspaceRuleTable = pgTable(
  "user_notification_workspace_rule",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => userTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaceTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    isActive: boolean("is_active").default(true).notNull(),
    emailEnabled: boolean("email_enabled").default(false).notNull(),
    ntfyEnabled: boolean("ntfy_enabled").default(false).notNull(),
    gotifyEnabled: boolean("gotify_enabled").default(false).notNull(),
    webhookEnabled: boolean("webhook_enabled").default(false).notNull(),
    projectMode: text("project_mode").default("all").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("user_notification_workspace_rule_userId_idx").on(table.userId),
    index("user_notification_workspace_rule_workspaceId_idx").on(
      table.workspaceId,
    ),
    unique("user_notification_workspace_rule_user_workspace_unique").on(
      table.userId,
      table.workspaceId,
    ),
    unique("user_notification_workspace_rule_workspace_id_id_unique").on(
      table.workspaceId,
      table.id,
    ),
  ],
);

export const userNotificationWorkspaceProjectTable = pgTable(
  "user_notification_workspace_project",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaceTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    workspaceRuleId: text("workspace_rule_id").notNull(),
    projectId: text("project_id").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId, table.workspaceRuleId],
      foreignColumns: [
        userNotificationWorkspaceRuleTable.workspaceId,
        userNotificationWorkspaceRuleTable.id,
      ],
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
    foreignKey({
      columns: [table.workspaceId, table.projectId],
      foreignColumns: [projectTable.workspaceId, projectTable.id],
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
    index("user_notification_workspace_project_ruleId_idx").on(
      table.workspaceRuleId,
    ),
    index("user_notification_workspace_project_projectId_idx").on(
      table.projectId,
    ),
    index("user_notification_workspace_project_workspaceId_projectId_idx").on(
      table.workspaceId,
      table.projectId,
    ),
    index("unwp_workspaceId_workspaceRuleId_idx").on(
      table.workspaceId,
      table.workspaceRuleId,
    ),
    unique("user_notification_workspace_project_rule_project_unique").on(
      table.workspaceRuleId,
      table.projectId,
    ),
  ],
);

export const githubIntegrationTable = pgTable("github_integration", {
  id: text("id")
    .$defaultFn(() => createId())
    .primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projectTable.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    })
    .unique(),
  repositoryOwner: text("repository_owner").notNull(),
  repositoryName: text("repository_name").notNull(),
  installationId: integer("installation_id"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const integrationTable = pgTable(
  "integration",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projectTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    type: text("type").notNull(),
    config: text("config").notNull(),
    isActive: boolean("is_active").default(true),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("integration_projectId_idx").on(table.projectId),
    index("integration_type_idx").on(table.type),
    unique("integration_project_type_unique").on(table.projectId, table.type),
  ],
);

export const githubImportTable = pgTable("github_import", {
  integrationId: text("integration_id")
    .primaryKey()
    .references(() => integrationTable.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    }),
  runId: text("run_id")
    .notNull()
    .$defaultFn(() => createId()),
  state: jsonb("state").$type<GitHubImportState>().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export const externalLinkTable = pgTable(
  "external_link",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => taskTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    integrationId: text("integration_id")
      .notNull()
      .references(() => integrationTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    resourceType: text("resource_type").notNull(),
    externalId: text("external_id").notNull(),
    url: text("url").notNull(),
    title: text("title"),
    metadata: text("metadata"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("external_link_taskId_idx").on(table.taskId),
    index("external_link_integrationId_idx").on(table.integrationId),
    index("external_link_externalId_idx").on(table.externalId),
    index("external_link_resourceType_idx").on(table.resourceType),
  ],
);

// User-added web links of a task. Integration-owned links live in
// external_link instead. `url` is stored normalized (utils/link-url.ts), so
// the unique index also rejects the same page written two ways.
export const taskLinkTable = pgTable(
  "task_link",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => taskTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    url: text("url").notNull(),
    title: text("title"),
    createdBy: text("created_by").references(() => userTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    unique("task_link_task_url_unique").on(table.taskId, table.url),
    index("task_link_createdBy_idx").on(table.createdBy),
  ],
);

export const commentTable = pgTable(
  "comment",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => taskTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    userId: text("user_id")
      .notNull()
      .references(() => userTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("comment_task_idx").on(table.taskId),
    index("comment_user_idx").on(table.userId),
  ],
);

export const taskRelationTable = pgTable(
  "task_relation",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    sourceTaskId: text("source_task_id")
      .notNull()
      .references(() => taskTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    targetTaskId: text("target_task_id")
      .notNull()
      .references(() => taskTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    relationType: text("relation_type").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  // Stored types: subtask (source is the parent), blocks, related, duplicate,
  // start_before and finish_before; see task-relation/types.ts. "One parent"
  // and "one relation per pair" are API rules, not constraints, because
  // existing installations may already hold rows that break them.
  (table) => [
    index("task_relation_source_type_idx").on(
      table.sourceTaskId,
      table.relationType,
    ),
    index("task_relation_target_type_idx").on(
      table.targetTaskId,
      table.relationType,
    ),
  ],
);

export const apikeyTable = pgTable(
  "apikey",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    configId: text("config_id").default("default").notNull(),
    name: text("name"),
    start: text("start"),
    referenceId: text("reference_id")
      .notNull()
      .references(() => userTable.id, { onDelete: "cascade" }),
    prefix: text("prefix"),
    key: text("key").notNull(),
    userId: text("user_id").references(() => userTable.id, {
      onDelete: "cascade",
    }),
    refillInterval: integer("refill_interval"),
    refillAmount: integer("refill_amount"),
    lastRefillAt: timestamp("last_refill_at", { mode: "date" }),
    enabled: boolean("enabled").default(true),
    rateLimitEnabled: boolean("rate_limit_enabled").default(true),
    rateLimitTimeWindow: integer("rate_limit_time_window").default(86400000),
    rateLimitMax: integer("rate_limit_max").default(10),
    requestCount: integer("request_count").default(0),
    remaining: integer("remaining"),
    lastRequest: timestamp("last_request", { mode: "date" }),
    expiresAt: timestamp("expires_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull(),
    permissions: text("permissions"),
    metadata: text("metadata"),
  },
  (table) => [
    index("apikey_configId_idx").on(table.configId),
    index("apikey_key_idx").on(table.key),
    index("apikey_referenceId_idx").on(table.referenceId),
    index("apikey_userId_idx").on(table.userId),
  ],
);

export const deviceCodeTable = pgTable(
  "device_code",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    deviceCode: text("device_code").notNull(),
    userCode: text("user_code").notNull(),
    userId: text("user_id").references(() => userTable.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
    status: text("status").notNull(),
    lastPolledAt: timestamp("last_polled_at", { mode: "date" }),
    pollingInterval: integer("polling_interval"),
    clientId: text("client_id"),
    scope: text("scope"),
  },
  (table) => [
    uniqueIndex("device_code_device_code_uidx").on(table.deviceCode),
    uniqueIndex("device_code_user_code_uidx").on(table.userCode),
    index("device_code_user_id_idx").on(table.userId),
  ],
);

export const mcpOauthStateTable = pgTable(
  "mcp_oauth_state",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    kind: text("kind").notNull(),
    key: text("key").notNull(),
    payload: jsonb("payload").notNull(),
    expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("mcp_oauth_state_kind_key_uidx").on(table.kind, table.key),
    index("mcp_oauth_state_expiresAt_idx").on(table.expiresAt),
  ],
);

// Auth-schema compatible aliases in schema.ts
export const user = userTable;
export const session = sessionTable;
export const account = accountTable;
export const verification = verificationTable;
export const workspace = workspaceTable;
export const team = teamTable;
export const teamMember = teamMemberTable;
export const workspace_member = workspaceUserTable;
export const invitation = invitationTable;
export const organizationRole = workspaceRoleTable;
export const apikey = apikeyTable;
export const deviceCode = deviceCodeTable;

// Auth-schema compatible relation exports in schema.ts
export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  teamMembers: many(teamMember),
  workspace_members: many(workspace_member),
  invitations: many(invitation),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));

export const workspaceRelations = relations(workspace, ({ many }) => ({
  teams: many(team),
  workspace_members: many(workspace_member),
  invitations: many(invitation),
}));

export const teamRelations = relations(team, ({ one, many }) => ({
  workspace: one(workspace, {
    fields: [team.workspaceId],
    references: [workspace.id],
  }),
  teamMembers: many(teamMember),
}));

export const teamMemberRelations = relations(teamMember, ({ one }) => ({
  team: one(team, {
    fields: [teamMember.teamId],
    references: [team.id],
  }),
  user: one(user, {
    fields: [teamMember.userId],
    references: [user.id],
  }),
}));

export const workspace_memberRelations = relations(
  workspace_member,
  ({ one }) => ({
    workspace: one(workspace, {
      fields: [workspace_member.workspaceId],
      references: [workspace.id],
    }),
    user: one(user, {
      fields: [workspace_member.userId],
      references: [user.id],
    }),
  }),
);

export const invitationRelations = relations(invitation, ({ one }) => ({
  workspace: one(workspace, {
    fields: [invitation.workspaceId],
    references: [workspace.id],
  }),
  user: one(user, {
    fields: [invitation.inviterId],
    references: [user.id],
  }),
}));

export const organizationRoleRelations = relations(
  organizationRole,
  ({ one }) => ({
    workspace: one(workspace, {
      fields: [organizationRole.workspaceId],
      references: [workspace.id],
    }),
  }),
);

export const customFieldDefinitionTable = pgTable(
  "custom_field_definition",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projectTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    name: text("name").notNull(),
    type: text("type").notNull(), // 'text' | 'number' | 'date' | 'dropdown' | 'boolean'
    required: boolean("required").default(false).notNull(),
    defaultValue: text("default_value"),
    options: jsonb("options"),
    position: integer("position").default(0).notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("custom_field_def_projectId_idx").on(table.projectId)],
);

export const customFieldValueTable = pgTable(
  "custom_field_value",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => taskTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    fieldId: text("field_id")
      .notNull()
      .references(() => customFieldDefinitionTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    value: text("value"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("custom_field_value_taskId_idx").on(table.taskId),
    index("custom_field_value_fieldId_idx").on(table.fieldId),
    index("custom_field_value_field_value_idx").on(table.fieldId, table.value),
    unique("custom_field_value_task_field_unique").on(
      table.taskId,
      table.fieldId,
    ),
  ],
);

// Personal favorites, per user and workspace. `entity_id` is polymorphic, so
// cleanup on entity delete is explicit (entity-reference/registry.ts); the
// project FK cascade covers project deletes.
export const favoriteTable = pgTable(
  "favorite",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => userTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaceTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    projectId: text("project_id").references(() => projectTable.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    }),
    entityType: text("entity_type").$type<FavoriteEntityType>().notNull(),
    entityId: text("entity_id").notNull(),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    unique("favorite_user_entity_unique").on(
      table.userId,
      table.entityType,
      table.entityId,
    ),
    index("favorite_user_workspace_position_idx").on(
      table.userId,
      table.workspaceId,
      table.position,
    ),
    index("favorite_entity_idx").on(table.entityType, table.entityId),
    index("favorite_projectId_idx").on(table.projectId),
  ],
);

// The last visited entities per user and workspace, trimmed to 20 on write.
export const recentVisitTable = pgTable(
  "recent_visit",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => userTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaceTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    projectId: text("project_id").references(() => projectTable.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    }),
    entityType: text("entity_type").$type<RecentVisitEntityType>().notNull(),
    entityId: text("entity_id").notNull(),
    visitedAt: timestamp("visited_at", { mode: "date" }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    unique("recent_visit_user_entity_unique").on(
      table.userId,
      table.entityType,
      table.entityId,
    ),
    index("recent_visit_user_workspace_visited_idx").on(
      table.userId,
      table.workspaceId,
      table.visitedAt,
    ),
    index("recent_visit_entity_idx").on(table.entityType, table.entityId),
    index("recent_visit_projectId_idx").on(table.projectId),
  ],
);

// Personal markdown notes on Home, readable only by their owner. The
// plain-text projection feeds search and is never returned.
export const stickyTable = pgTable(
  "sticky",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => userTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaceTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    content: text("content").notNull().default(""),
    contentText: text("content_text").notNull().default(""),
    color: text("color").notNull().default("yellow"),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("sticky_user_workspace_position_idx").on(
      table.userId,
      table.workspaceId,
      table.position,
      table.id,
    ),
    index("sticky_workspaceId_idx").on(table.workspaceId),
  ],
);

// Personal links on Home, one per normalized URL per user and workspace.
export const quickLinkTable = pgTable(
  "quick_link",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => userTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaceTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    url: text("url").notNull(),
    title: text("title"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    unique("quick_link_user_workspace_url_unique").on(
      table.userId,
      table.workspaceId,
      table.url,
    ),
    index("quick_link_user_workspace_created_idx").on(
      table.userId,
      table.workspaceId,
      table.createdAt,
    ),
    index("quick_link_workspaceId_idx").on(table.workspaceId),
  ],
);

// Home widget order and visibility per user and workspace. Stored keys are
// normalized on read, so rows written before a widget existed stay valid.
export const homePreferenceTable = pgTable(
  "home_preference",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => userTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaceTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    widgets: jsonb("widgets")
      .$type<Array<{ key: string; enabled: boolean }>>()
      .notNull()
      .default([]),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    unique("home_preference_user_workspace_unique").on(
      table.userId,
      table.workspaceId,
    ),
    index("home_preference_workspaceId_idx").on(table.workspaceId),
  ],
);

// A time-boxed iteration of a project. Dates are inclusive calendar days with
// no time zone; the status (draft, upcoming, current, completed) is derived
// from them against the server's UTC date and never stored.
export const cycleTable = pgTable(
  "cycle",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projectTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    startDate: date("start_date", { mode: "string" }),
    endDate: date("end_date", { mode: "string" }),
    ownerId: text("owner_id").references(() => userTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    sortOrder: doublePrecision("sort_order").notNull().default(65535),
    archivedAt: timestamp("archived_at", { mode: "date" }),
    // The progress report frozen by the first transfer of unfinished tasks,
    // so a completed cycle keeps its numbers after that work leaves.
    progressSnapshot: jsonb("progress_snapshot").$type<CycleProgressSnapshot>(),
    createdBy: text("created_by").references(() => userTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("cycle_projectId_idx").on(table.projectId),
    index("cycle_ownerId_idx").on(table.ownerId),
    index("cycle_createdBy_idx").on(table.createdBy),
    check(
      "cycle_dates_check",
      sql`(${table.startDate} is null and ${table.endDate} is null) or (${table.startDate} is not null and ${table.endDate} is not null and ${table.startDate} <= ${table.endDate})`,
    ),
  ],
);

// Cycle membership. The task id is the primary key, so a task is in at most
// one cycle by construction.
export const cycleTaskTable = pgTable(
  "cycle_task",
  {
    taskId: text("task_id")
      .primaryKey()
      .references(() => taskTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    cycleId: text("cycle_id")
      .notNull()
      .references(() => cycleTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    addedBy: text("added_by").references(() => userTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    addedAt: timestamp("added_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    index("cycle_task_cycleId_idx").on(table.cycleId),
    index("cycle_task_addedBy_idx").on(table.addedBy),
  ],
);

// A named, feature-level grouping of tasks inside one project; a task can be
// in any number of modules. The status is set by hand. Dates are optional
// inclusive calendar days with no time zone. Names are unique per project,
// case-insensitively, archived modules included.
export const moduleTable = pgTable(
  "module",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projectTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    name: text("name").notNull(),
    description: text("description"),
    status: text("status").$type<ModuleStatus>().notNull().default("backlog"),
    startDate: date("start_date", { mode: "string" }),
    targetDate: date("target_date", { mode: "string" }),
    leadId: text("lead_id").references(() => userTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    position: integer("position").notNull().default(0),
    archivedAt: timestamp("archived_at", { mode: "date" }),
    createdBy: text("created_by").references(() => userTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("module_project_name_unique").on(
      table.projectId,
      sql`lower(${table.name})`,
    ),
    index("module_projectId_position_idx").on(table.projectId, table.position),
    index("module_leadId_idx").on(table.leadId),
    index("module_createdBy_idx").on(table.createdBy),
    check(
      "module_dates_check",
      sql`${table.startDate} is null or ${table.targetDate} is null or ${table.startDate} <= ${table.targetDate}`,
    ),
  ],
);

// Module membership (many-to-many). Nothing ties the task's project to the
// module's project here, so writes check it and reads join on it.
export const moduleTaskTable = pgTable(
  "module_task",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    moduleId: text("module_id")
      .notNull()
      .references(() => moduleTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    taskId: text("task_id")
      .notNull()
      .references(() => taskTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    createdBy: text("created_by").references(() => userTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    unique("module_task_module_task_unique").on(table.moduleId, table.taskId),
    index("module_task_taskId_idx").on(table.taskId),
    index("module_task_createdBy_idx").on(table.createdBy),
  ],
);

export const moduleMemberTable = pgTable(
  "module_member",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    moduleId: text("module_id")
      .notNull()
      .references(() => moduleTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    userId: text("user_id")
      .notNull()
      .references(() => userTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    unique("module_member_module_user_unique").on(table.moduleId, table.userId),
    index("module_member_userId_idx").on(table.userId),
  ],
);

// User-created reference links of a module. Integration-owned task links live
// in external_link instead.
export const moduleLinkTable = pgTable(
  "module_link",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    moduleId: text("module_id")
      .notNull()
      .references(() => moduleTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    url: text("url").notNull(),
    title: text("title"),
    createdBy: text("created_by").references(() => userTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    unique("module_link_module_url_unique").on(table.moduleId, table.url),
    index("module_link_createdBy_idx").on(table.createdBy),
  ],
);

// An estimate system of a project: points, categories or time (minutes). A
// project may keep several, but at most one is active (the partial unique
// index); tasks only ever point at the active one's values. Names are unique
// per project, case-insensitively. The type never changes after insert.
export const estimateTable = pgTable(
  "estimate",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projectTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    name: text("name").notNull(),
    type: text("type").$type<EstimateType>().notNull(),
    isActive: boolean("is_active").notNull().default(false),
    createdBy: text("created_by").references(() => userTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("estimate_project_name_unique").on(
      table.projectId,
      sql`lower(${table.name})`,
    ),
    uniqueIndex("estimate_project_active_unique")
      .on(table.projectId)
      .where(sql`${table.isActive}`),
    index("estimate_createdBy_idx").on(table.createdBy),
    check(
      "estimate_type_check",
      sql`${table.type} in ('points', 'categories', 'time')`,
    ),
  ],
);

// One value of an estimate system. `value` is the display text (whole
// minutes for time systems); `numericValue` is the parsed number that totals
// sum, null for categories. Positions are 1..n per system, kept contiguous by
// the API, which also enforces value uniqueness.
export const estimatePointTable = pgTable(
  "estimate_point",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    estimateId: text("estimate_id")
      .notNull()
      .references(() => estimateTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    value: text("value").notNull(),
    numericValue: doublePrecision("numeric_value"),
    position: integer("position").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("estimate_point_estimateId_position_idx").on(
      table.estimateId,
      table.position,
    ),
  ],
);

// A task's assignees, the source of truth for who a task is assigned to.
// `task.assignee_id` mirrors the first row (lowest position) and only the
// helpers in task/assignee-writes.ts (plus the startup repair) write it,
// in the same transaction as these rows. Rows are inserted and deleted,
// never updated; gaps in `position` are fine.
export const taskAssigneeTable = pgTable(
  "task_assignee",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => taskTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    userId: text("user_id")
      .notNull()
      .references(() => userTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    unique("task_assignee_task_user_unique").on(table.taskId, table.userId),
    index("task_assignee_userId_idx").on(table.userId),
    index("task_assignee_taskId_position_idx").on(table.taskId, table.position),
  ],
);

// Permission resources already added to the existing default role rows, so
// each new resource is backfilled once and a later admin edit that removes it
// is never undone. See utils/backfill-role-permissions.ts.
export const rolePermissionBackfillTable = pgTable("role_permission_backfill", {
  resource: text("resource").primaryKey(),
  appliedAt: timestamp("applied_at", { mode: "date" }).defaultNow().notNull(),
});

// Who watches a task (B10). `subscribed = false` is an explicit unsubscribe
// (muted), which also silences an assignee's watcher notifications. A
// task's watchers are its subscribed rows plus its assignees, minus muted
// rows. `reason` is why the row was last turned on.
export const taskSubscriberTable = pgTable(
  "task_subscriber",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => taskTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    userId: text("user_id")
      .notNull()
      .references(() => userTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    subscribed: boolean("subscribed").default(true).notNull(),
    reason: text("reason").default("manual").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    unique("task_subscriber_task_user_unique").on(table.taskId, table.userId),
    index("task_subscriber_userId_idx").on(table.userId),
  ],
);

// Who is @mentioned where: the task description (comment_id null) or one
// comment. Mirrors the latest content for the `mention` filter;
// notifications diff old against new content instead.
export const taskMentionTable = pgTable(
  "task_mention",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => taskTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    userId: text("user_id")
      .notNull()
      .references(() => userTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    commentId: text("comment_id").references(() => activityTable.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("task_mention_description_unique")
      .on(table.taskId, table.userId)
      .where(sql`${table.commentId} is null`),
    uniqueIndex("task_mention_comment_unique")
      .on(table.commentId, table.userId)
      .where(sql`${table.commentId} is not null`),
    index("task_mention_taskId_idx").on(table.taskId),
    index("task_mention_userId_idx").on(table.userId, table.taskId),
    index("task_mention_commentId_idx").on(table.commentId),
  ],
);

// Emoji reactions on a task (comment_id null) or on one of its comments.
// `task_id` is always set, so one query loads a task's and its comments'
// reactions. Rows are only inserted and deleted.
export const reactionTable = pgTable(
  "reaction",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => taskTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    commentId: text("comment_id").references(() => activityTable.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    }),
    userId: text("user_id")
      .notNull()
      .references(() => userTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    emoji: text("emoji").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("reaction_task_user_emoji_unique")
      .on(table.taskId, table.userId, table.emoji)
      .where(sql`${table.commentId} is null`),
    uniqueIndex("reaction_comment_user_emoji_unique")
      .on(table.commentId, table.userId, table.emoji)
      .where(sql`${table.commentId} is not null`),
    index("reaction_taskId_createdAt_idx").on(table.taskId, table.createdAt),
    index("reaction_commentId_idx").on(table.commentId),
    index("reaction_userId_idx").on(table.userId),
  ],
);

// A saved task query (B4): filters, display and shown properties, for one
// project or (project_id null) the whole workspace. The API always writes the
// project's own workspace, and every read joins on it. Private views are
// visible to their owner only; an ownerless private view is purged lazily.
export const savedViewTable = pgTable(
  "saved_view",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaceTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    projectId: text("project_id").references(() => projectTable.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    filters: jsonb("filters")
      .$type<ViewFilters>()
      .notNull()
      .default({ version: 1, root: null, archived: "exclude" }),
    // Normalized with the scope's defaults on read.
    display: jsonb("display")
      .$type<Partial<ViewDisplay>>()
      .notNull()
      .default({}),
    displayProperties: jsonb("display_properties")
      .$type<Partial<ViewDisplayProperties>>()
      .notNull()
      .default({}),
    access: text("access").$type<ViewAccess>().notNull().default("workspace"),
    isLocked: boolean("is_locked").notNull().default(false),
    ownerId: text("owner_id").references(() => userTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    lockedBy: text("locked_by").references(() => userTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("saved_view_workspace_project_idx").on(
      table.workspaceId,
      table.projectId,
    ),
    index("saved_view_projectId_idx").on(table.projectId),
    index("saved_view_ownerId_idx").on(table.ownerId),
    index("saved_view_lockedBy_idx").on(table.lockedBy),
    check(
      "saved_view_access_check",
      sql`${table.access} in ('private', 'workspace')`,
    ),
  ],
);

// Intake (B7): one row per request. The request itself is a task in the
// project's triage column; this row holds the triage state. `projectId` is the
// queue it was submitted to, which an accepted task may later leave.
export const intakeItemTable = pgTable(
  "intake_item",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projectTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    taskId: text("task_id")
      .notNull()
      .references(() => taskTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    // pending, snoozed, accepted, declined or duplicate. A snooze whose time
    // has passed reads as pending (intake/status.ts).
    status: text("status").notNull().default("pending"),
    snoozedUntil: timestamp("snoozed_until", {
      mode: "date",
      withTimezone: true,
    }),
    duplicateOfTaskId: text("duplicate_of_task_id").references(
      () => taskTable.id,
      { onDelete: "set null", onUpdate: "cascade" },
    ),
    resolutionNote: text("resolution_note"),
    source: text("source").notNull().default("in_app"),
    submittedBy: text("submitted_by").references(() => userTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    triagedBy: text("triaged_by").references(() => userTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    triagedAt: timestamp("triaged_at", { mode: "date", withTimezone: true }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    unique("intake_item_task_unique").on(table.taskId),
    index("intake_item_project_status_created_idx").on(
      table.projectId,
      table.status,
      table.createdAt,
    ),
    index("intake_item_snoozed_until_idx")
      .on(table.snoozedUntil)
      .where(sql`${table.status} = 'snoozed'`),
    index("intake_item_submitted_by_idx").on(table.submittedBy),
    index("intake_item_duplicate_of_idx").on(table.duplicateOfTaskId),
    index("intake_item_triaged_by_idx").on(table.triagedBy),
    // Analytics (B8): the "triaged" series and the median time to triage.
    index("intake_item_project_triagedAt_idx")
      .on(table.projectId, table.triagedAt)
      .where(sql`${table.triagedAt} is not null`),
  ],
);

// Drafts (B11): a task its owner has not published yet. Kept out of `task`,
// so no task reader, counter or integration can ever see one, and no task
// number is taken before publishing. Private to `createdBy`. Cycle, module
// and estimate ids are soft references, revalidated when publishing.
export const taskDraftTable = pgTable(
  "task_draft",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaceTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    // A deleted project leaves a workspace-level draft.
    projectId: text("project_id").references(() => projectTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    createdBy: text("created_by")
      .notNull()
      .references(() => userTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    title: text("title").notNull().default(""),
    description: text("description").notNull().default(""),
    status: text("status"),
    priority: text("priority").notNull().default("no-priority"),
    assigneeIds: jsonb("assignee_ids").$type<string[]>().notNull().default([]),
    labels: jsonb("labels")
      .$type<{ name: string; color: string }[]>()
      .notNull()
      .default([]),
    startDate: timestamp("start_date", { mode: "date" }),
    dueDate: timestamp("due_date", { mode: "date" }),
    customFieldValues: jsonb("custom_field_values")
      .$type<{ fieldId: string; value: string }[]>()
      .notNull()
      .default([]),
    cycleId: text("cycle_id"),
    moduleIds: jsonb("module_ids").$type<string[]>().notNull().default([]),
    estimatePointId: text("estimate_point_id"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("task_draft_owner_workspace_updated_idx").on(
      table.createdBy,
      table.workspaceId,
      table.updatedAt,
    ),
    index("task_draft_projectId_idx").on(table.projectId),
    index("task_draft_workspaceId_idx").on(table.workspaceId),
  ],
);

// Scheduled automations (B11): one row per project, created on the first
// settings write; no row means both rules are off. Turning a rule off keeps
// its months and column. The job records its last run here.
export const projectAutomationTable = pgTable(
  "project_automation",
  {
    projectId: text("project_id")
      .primaryKey()
      .references(() => projectTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    autoArchiveEnabled: boolean("auto_archive_enabled")
      .notNull()
      .default(false),
    autoArchiveMonths: integer("auto_archive_months").notNull().default(3),
    autoCloseEnabled: boolean("auto_close_enabled").notNull().default(false),
    autoCloseMonths: integer("auto_close_months").notNull().default(3),
    // Deleting the column pauses auto-close instead of blocking the delete.
    autoCloseColumnId: text("auto_close_column_id").references(
      () => columnTable.id,
      { onDelete: "set null", onUpdate: "cascade" },
    ),
    lastCheckedAt: timestamp("last_checked_at", { mode: "date" }),
    lastArchivedAt: timestamp("last_archived_at", { mode: "date" }),
    lastArchivedCount: integer("last_archived_count").notNull().default(0),
    lastClosedAt: timestamp("last_closed_at", { mode: "date" }),
    lastClosedCount: integer("last_closed_count").notNull().default(0),
    updatedBy: text("updated_by").references(() => userTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    check(
      "project_automation_months_check",
      sql`${table.autoArchiveMonths} between 1 and 12 and ${table.autoCloseMonths} between 1 and 12`,
    ),
    // The job's queue: enabled projects, least recently checked first.
    index("project_automation_active_idx")
      .on(table.lastCheckedAt)
      .where(sql`${table.autoArchiveEnabled} or ${table.autoCloseEnabled}`),
    index("project_automation_closeColumnId_idx").on(table.autoCloseColumnId),
    index("project_automation_updatedBy_idx").on(table.updatedBy),
  ],
);

// Pages (B5): project documents. The Yjs state is the source of truth for
// the content; markdown and plain text are projections the server rewrites
// on every content write. `projectId` is nullable for later workspace-level
// pages, but always set today. `updatedAt` is set explicitly (no $onUpdate):
// lock, access, archive and position changes must not bump it.
export const pageTable = pgTable(
  "page",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaceTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    projectId: text("project_id").references(() => projectTable.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    }),
    parentId: text("parent_id"),
    position: integer("position").notNull().default(0),
    title: text("title").notNull().default(""),
    logoKind: text("logo_kind").$type<PageLogoKind>(),
    logoValue: text("logo_value"),
    access: text("access").$type<PageAccess>().notNull().default("public"),
    ownerId: text("owner_id").references(() => userTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    isLocked: boolean("is_locked").notNull().default(false),
    lockedById: text("locked_by_id").references(() => userTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    lockedAt: timestamp("locked_at", { mode: "date" }),
    archivedAt: timestamp("archived_at", { mode: "date" }),
    isFullWidth: boolean("is_full_width").notNull().default(false),
    contentYjs: bytea("content_yjs"),
    contentMarkdown: text("content_markdown").notNull().default(""),
    contentText: text("content_text").notNull().default(""),
    contentVersion: integer("content_version").notNull().default(0),
    createdById: text("created_by_id").references(() => userTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    updatedById: text("updated_by_id").references(() => userTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    // Deleting a page moves its children to the root.
    foreignKey({
      name: "page_parent_id_page_id_fk",
      columns: [table.parentId],
      foreignColumns: [table.id],
    })
      .onDelete("set null")
      .onUpdate("cascade"),
    index("page_project_parent_position_idx").on(
      table.projectId,
      table.parentId,
      table.position,
    ),
    index("page_workspace_idx").on(table.workspaceId),
    index("page_owner_idx").on(table.ownerId),
    index("page_parent_idx").on(table.parentId),
    index("page_lockedById_idx").on(table.lockedById),
    index("page_createdById_idx").on(table.createdById),
    index("page_updatedById_idx").on(table.updatedById),
    check("page_access_check", sql`${table.access} in ('public', 'private')`),
    check(
      "page_logo_check",
      sql`(${table.logoKind} is null and ${table.logoValue} is null) or (${table.logoKind} in ('emoji', 'icon') and ${table.logoValue} is not null)`,
    ),
  ],
);

// Saved snapshots of a page's content (JSON and markdown, not Yjs). A later
// save by the same user within 10 minutes updates the newest one; at most 20
// are kept per page.
export const pageVersionTable = pgTable(
  "page_version",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    pageId: text("page_id")
      .notNull()
      .references(() => pageTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaceTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    ownerId: text("owner_id").references(() => userTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    contributorIds: jsonb("contributor_ids")
      .$type<string[]>()
      .notNull()
      .default([]),
    title: text("title").notNull().default(""),
    contentJson: jsonb("content_json")
      .$type<Record<string, unknown>>()
      .notNull(),
    contentMarkdown: text("content_markdown").notNull().default(""),
    lastSavedAt: timestamp("last_saved_at", { mode: "date" })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    index("page_version_page_saved_idx").on(table.pageId, table.lastSavedAt),
    index("page_version_ownerId_idx").on(table.ownerId),
  ],
);

// Saved versions of a task's description (C9). A later save by the same
// author within 10 minutes updates the newest one; at most 50 are kept per
// task. They go with the task when it is deleted for good.
export const taskDescriptionVersionTable = pgTable(
  "task_description_version",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => taskTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    // Null for the description a task had before its history began, and for
    // deleted users.
    authorId: text("author_id").references(() => userTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    content: text("content").notNull().default(""),
    savedAt: timestamp("saved_at", { mode: "date" }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    index("task_description_version_task_saved_idx").on(
      table.taskId,
      table.savedAt,
    ),
    index("task_description_version_authorId_idx").on(table.authorId),
  ],
);

// Members, tasks and pages a page's content references. Rows stay while the
// reference stays, so `createdAt` is when it first appeared. Targets are not
// foreign keys; reads filter out the ones that are gone.
export const pageReferenceTable = pgTable(
  "page_reference",
  {
    pageId: text("page_id")
      .notNull()
      .references(() => pageTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaceTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    entityType: text("entity_type").$type<PageReferenceType>().notNull(),
    entityId: text("entity_id").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      name: "page_reference_pkey",
      columns: [table.pageId, table.entityType, table.entityId],
    }),
    index("page_reference_entity_idx").on(table.entityType, table.entityId),
    check(
      "page_reference_entity_type_check",
      sql`${table.entityType} in ('user', 'task', 'page')`,
    ),
  ],
);

// Asynchronous task exports (B13). One row per requested export: the queue,
// the job's lease and the download history. Files live in object storage
// when it is configured, otherwise in `task_export_file`. Deleting a
// project keeps its exports (their files are snapshots until they expire).
export const taskExportTable = pgTable(
  "task_export",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaceTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    requestedBy: text("requested_by").references(() => userTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    format: text("format").$type<TaskExportFormat>().notNull(),
    // Resolved when the export is requested, in export order.
    projectIds: text("project_ids").array().notNull(),
    splitByProject: boolean("split_by_project").notNull().default(false),
    includeArchived: boolean("include_archived").notNull().default(true),
    status: text("status")
      .$type<TaskExportStatus>()
      .notNull()
      .default("queued"),
    // A safe, user-facing reason; never raw exception text.
    error: text("error"),
    taskCount: integer("task_count"),
    fileName: text("file_name"),
    contentType: text("content_type"),
    sizeBytes: integer("size_bytes"),
    storage: text("storage").$type<TaskExportStorage>(),
    // The full object key, S3_KEY_PREFIX included. Null for database
    // storage and once the file has expired.
    objectKey: text("object_key"),
    attempts: integer("attempts").notNull().default(0),
    lockedUntil: timestamp("locked_until", {
      mode: "date",
      withTimezone: true,
    }),
    startedAt: timestamp("started_at", { mode: "date", withTimezone: true }),
    completedAt: timestamp("completed_at", {
      mode: "date",
      withTimezone: true,
    }),
    expiresAt: timestamp("expires_at", { mode: "date", withTimezone: true }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("task_export_history_idx").on(
      table.workspaceId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
    index("task_export_requester_idx").on(
      table.requestedBy,
      table.workspaceId,
      table.createdAt.desc(),
    ),
    index("task_export_queue_idx")
      .on(table.createdAt)
      .where(sql`${table.status} = 'queued'`),
    index("task_export_expiry_idx")
      .on(table.expiresAt)
      .where(sql`${table.status} = 'completed'`),
  ],
);

// The finished file of an export stored in Postgres, used when object
// storage is not configured (at most 25 MiB, enforced by the job).
export const taskExportFileTable = pgTable("task_export_file", {
  exportId: text("export_id")
    .primaryKey()
    .references(() => taskExportTable.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    }),
  content: bytea("content").notNull(),
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
    .defaultNow()
    .notNull(),
});

// Workspace webhooks (B13a): signed HTTP deliveries of workspace events to
// endpoints an admin registers. Separate from the per-project generic
// webhook integration and from personal notification webhooks.
export const workspaceWebhookTable = pgTable(
  "workspace_webhook",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaceTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    name: text("name"),
    // Normalized (lower-case scheme and host, no fragment, no default port).
    url: text("url").notNull(),
    // Subscription patterns: "*", "<family>.*" or exact public event names.
    events: text("events").array().notNull().default(sql`ARRAY['*']::text[]`),
    isActive: boolean("is_active").notNull().default(true),
    disabledReason: text("disabled_reason").$type<WebhookDisabledReason>(),
    disabledAt: timestamp("disabled_at", { mode: "date", withTimezone: true }),
    // Sealed with the AES-256-GCM secret box (key derived from AUTH_SECRET).
    secretCiphertext: text("secret_ciphertext").notNull(),
    secretLast4: text("secret_last4").notNull(),
    previousSecretCiphertext: text("previous_secret_ciphertext"),
    previousSecretExpiresAt: timestamp("previous_secret_expires_at", {
      mode: "date",
      withTimezone: true,
    }),
    secretRotatedAt: timestamp("secret_rotated_at", {
      mode: "date",
      withTimezone: true,
    }),
    // Consecutive deliveries that failed for good since the last success.
    failureStreak: integer("failure_streak").notNull().default(0),
    failingSince: timestamp("failing_since", {
      mode: "date",
      withTimezone: true,
    }),
    lastSuccessAt: timestamp("last_success_at", {
      mode: "date",
      withTimezone: true,
    }),
    lastFailureAt: timestamp("last_failure_at", {
      mode: "date",
      withTimezone: true,
    }),
    // Receives the auto-disable email.
    createdBy: text("created_by").references(() => userTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    unique("workspace_webhook_workspace_url_unique").on(
      table.workspaceId,
      table.url,
    ),
    index("workspace_webhook_active_idx")
      .on(table.workspaceId)
      .where(sql`${table.isActive}`),
    index("workspace_webhook_created_by_idx").on(table.createdBy),
  ],
);

// The webhook outbox and delivery log. Any instance claims due rows with
// FOR UPDATE SKIP LOCKED; `body` is serialized once so every attempt sends
// identical bytes. Rows are deleted after WEBHOOK_DELIVERY_RETENTION_DAYS.
export const webhookDeliveryTable = pgTable(
  "webhook_delivery",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    webhookId: text("webhook_id")
      .notNull()
      .references(() => workspaceWebhookTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaceTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    event: text("event").notNull(),
    entityType: text("entity_type").$type<WebhookEntityType>().notNull(),
    entityId: text("entity_id"),
    // No FK: the log outlives a deleted project.
    projectId: text("project_id"),
    summary: text("summary"),
    body: text("body").notNull(),
    status: text("status")
      .$type<WebhookDeliveryStatus>()
      .notNull()
      .default("pending"),
    trigger: text("trigger")
      .$type<WebhookDeliveryTrigger>()
      .notNull()
      .default("event"),
    redeliveryOf: text("redelivery_of"),
    coalesceKey: text("coalesce_key"),
    attemptCount: integer("attempt_count").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(6),
    nextAttemptAt: timestamp("next_attempt_at", {
      mode: "date",
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
    lockedUntil: timestamp("locked_until", {
      mode: "date",
      withTimezone: true,
    }),
    lastAttemptAt: timestamp("last_attempt_at", {
      mode: "date",
      withTimezone: true,
    }),
    responseStatus: integer("response_status"),
    responseSnippet: text("response_snippet"),
    // A safe message, never raw exception text.
    error: text("error"),
    durationMs: integer("duration_ms"),
    attempts: jsonb("attempts")
      .$type<WebhookAttempt[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp("completed_at", {
      mode: "date",
      withTimezone: true,
    }),
  },
  (table) => [
    foreignKey({
      name: "webhook_delivery_redelivery_of_fk",
      columns: [table.redeliveryOf],
      foreignColumns: [table.id],
    })
      .onDelete("set null")
      .onUpdate("cascade"),
    index("webhook_delivery_due_idx")
      .on(table.nextAttemptAt)
      .where(sql`${table.status} = 'pending'`),
    index("webhook_delivery_lease_idx")
      .on(table.lockedUntil)
      .where(sql`${table.status} = 'sending'`),
    index("webhook_delivery_log_idx").on(
      table.webhookId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
    index("webhook_delivery_created_idx").on(table.createdAt),
    index("webhook_delivery_workspace_idx").on(table.workspaceId),
    uniqueIndex("webhook_delivery_coalesce_unique")
      .on(table.webhookId, table.coalesceKey)
      .where(
        sql`${table.status} = 'pending' and ${table.attemptCount} = 0 and ${table.coalesceKey} is not null`,
      ),
    index("webhook_delivery_redelivery_of_idx").on(table.redeliveryOf),
  ],
);

// B12: a project's public board. One row per project, kept when the board is
// unpublished so republishing restores the same link and settings.
// `project.is_public` mirrors "published" for older readers.
export const projectPublicationTable = pgTable(
  "project_publication",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projectTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    linkToken: text("link_token").notNull(),
    publishedAt: timestamp("published_at", { mode: "date" }),
    publishedBy: text("published_by").references(() => userTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    layouts: jsonb("layouts")
      .$type<("board" | "list")[]>()
      .notNull()
      .default(["board", "list"]),
    defaultLayout: text("default_layout")
      .$type<"board" | "list">()
      .notNull()
      .default("board"),
    commentsEnabled: boolean("comments_enabled").notNull().default(false),
    reactionsEnabled: boolean("reactions_enabled").notNull().default(false),
    votesEnabled: boolean("votes_enabled").notNull().default(false),
    requestsEnabled: boolean("requests_enabled").notNull().default(false),
    allowGuests: boolean("allow_guests").notNull().default(false),
    showAssignees: boolean("show_assignees").notNull().default(false),
    showBacklog: boolean("show_backlog").notNull().default(false),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    unique("project_publication_project_unique").on(table.projectId),
    unique("project_publication_link_token_unique").on(table.linkToken),
    index("project_publication_published_by_idx").on(table.publishedBy),
    check(
      "project_publication_default_layout_check",
      sql`${table.defaultLayout} in ('board', 'list')`,
    ),
  ],
);

// B12: people blocked from taking part on one public board.
export const publicBoardBlockTable = pgTable(
  "public_board_block",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projectTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    userId: text("user_id")
      .notNull()
      .references(() => userTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    blockedBy: text("blocked_by").references(() => userTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      name: "public_board_block_pk",
      columns: [table.projectId, table.userId],
    }),
    index("public_board_block_user_idx").on(table.userId),
    index("public_board_block_blocked_by_idx").on(table.blockedBy),
  ],
);

// B12: public board votes, one per (task, account), +1 or -1.
export const taskVoteTable = pgTable(
  "task_vote",
  {
    taskId: text("task_id")
      .notNull()
      .references(() => taskTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    userId: text("user_id")
      .notNull()
      .references(() => userTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    value: smallint("value").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    primaryKey({
      name: "task_vote_pk",
      columns: [table.taskId, table.userId],
    }),
    index("task_vote_user_idx").on(table.userId),
    check("task_vote_value_check", sql`${table.value} in (-1, 1)`),
  ],
);

// B12: DB-backed instance settings, one row per catalog key. Non-secret
// values are JSON; secrets are sealed with the secret box and never returned.
// No row means "not set here": the environment or the default applies.
export const instanceSettingTable = pgTable(
  "instance_setting",
  {
    key: text("key").primaryKey(),
    value: jsonb("value").$type<string | number | boolean>(),
    secret: text("secret"),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    updatedBy: text("updated_by").references(() => userTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
  },
  (table) => [
    index("instance_setting_updated_by_idx").on(table.updatedBy),
    check(
      "instance_setting_one_value_check",
      sql`(${table.value} is null) <> (${table.secret} is null)`,
    ),
  ],
);

// Workspace audit log: append-only record of administrative actions. Actor
// and target names are snapshots so entries stay readable after the user,
// key or target is gone. Metadata is redacted before it is written (see
// `audit-log/redact.ts`); no secret ever lands here.
export const auditLogTable = pgTable(
  "audit_log",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaceTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    actorType: text("actor_type")
      .$type<"user" | "api_key" | "system">()
      .notNull(),
    actorUserId: text("actor_user_id").references(() => userTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    // No foreign key: a revoked key's entries must outlive the key.
    apiKeyId: text("api_key_id"),
    actorName: text("actor_name"),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    targetLabel: text("target_label"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("audit_log_workspace_created_idx").on(
      table.workspaceId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
    index("audit_log_workspace_action_idx").on(
      table.workspaceId,
      table.action,
      table.createdAt.desc(),
    ),
    index("audit_log_workspace_actor_idx").on(
      table.workspaceId,
      table.actorUserId,
      table.createdAt.desc(),
    ),
    index("audit_log_created_idx").on(table.createdAt),
  ],
);
