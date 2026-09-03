CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activity" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"type" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"user_id" text,
	"content" text,
	"event_data" jsonb,
	"external_user_name" text,
	"external_user_avatar" text,
	"external_source" text,
	"external_url" text,
	CONSTRAINT "activity_task_external_source_external_url_unique" UNIQUE("task_id","external_source","external_url")
);
--> statement-breakpoint
CREATE TABLE "apikey" (
	"id" text PRIMARY KEY NOT NULL,
	"config_id" text DEFAULT 'default' NOT NULL,
	"name" text,
	"start" text,
	"reference_id" text NOT NULL,
	"prefix" text,
	"key" text NOT NULL,
	"user_id" text,
	"refill_interval" integer,
	"refill_amount" integer,
	"last_refill_at" timestamp,
	"enabled" boolean DEFAULT true,
	"rate_limit_enabled" boolean DEFAULT true,
	"rate_limit_time_window" integer DEFAULT 86400000,
	"rate_limit_max" integer DEFAULT 10,
	"request_count" integer DEFAULT 0,
	"remaining" integer,
	"last_request" timestamp,
	"expires_at" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"permissions" text,
	"metadata" text
);
--> statement-breakpoint
CREATE TABLE "asset" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"task_id" text,
	"activity_id" text,
	"object_key" text NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size" integer NOT NULL,
	"kind" text DEFAULT 'image' NOT NULL,
	"surface" text DEFAULT 'description' NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "asset_object_key_unique" UNIQUE("object_key")
);
--> statement-breakpoint
CREATE TABLE "billing_event" (
	"id" text PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"processed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_reminder_sent" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"reminder_type" text NOT NULL,
	"trial_ends_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "billing_reminder_sent_user_type_unique" UNIQUE("user_id","reminder_type")
);
--> statement-breakpoint
CREATE TABLE "column" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"icon" text,
	"color" text,
	"status_group" text DEFAULT 'unstarted' NOT NULL,
	"is_final" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comment" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"user_id" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custom_field_definition" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"default_value" text,
	"options" jsonb,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custom_field_value" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"field_id" text NOT NULL,
	"value" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "custom_field_value_task_field_unique" UNIQUE("task_id","field_id")
);
--> statement-breakpoint
CREATE TABLE "cycle" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"start_date" date,
	"end_date" date,
	"owner_id" text,
	"sort_order" double precision DEFAULT 65535 NOT NULL,
	"archived_at" timestamp,
	"progress_snapshot" jsonb,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cycle_dates_check" CHECK (("cycle"."start_date" is null and "cycle"."end_date" is null) or ("cycle"."start_date" is not null and "cycle"."end_date" is not null and "cycle"."start_date" <= "cycle"."end_date"))
);
--> statement-breakpoint
CREATE TABLE "cycle_task" (
	"task_id" text PRIMARY KEY NOT NULL,
	"cycle_id" text NOT NULL,
	"added_by" text,
	"added_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_code" (
	"id" text PRIMARY KEY NOT NULL,
	"device_code" text NOT NULL,
	"user_code" text NOT NULL,
	"user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"status" text NOT NULL,
	"last_polled_at" timestamp,
	"polling_interval" integer,
	"client_id" text,
	"scope" text
);
--> statement-breakpoint
CREATE TABLE "external_link" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"integration_id" text NOT NULL,
	"resource_type" text NOT NULL,
	"external_id" text NOT NULL,
	"url" text NOT NULL,
	"title" text,
	"metadata" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "favorite" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "favorite_user_entity_unique" UNIQUE("user_id","entity_type","entity_id")
);
--> statement-breakpoint
CREATE TABLE "github_import" (
	"integration_id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"state" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_integration" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"repository_owner" text NOT NULL,
	"repository_name" text NOT NULL,
	"installation_id" integer,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "github_integration_project_id_unique" UNIQUE("project_id")
);
--> statement-breakpoint
CREATE TABLE "integration" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"type" text NOT NULL,
	"config" text NOT NULL,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "integration_project_type_unique" UNIQUE("project_id","type")
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"team_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"inviter_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_lease" (
	"name" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "label" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deletion_started_at" timestamp,
	"task_id" text,
	"workspace_id" text,
	CONSTRAINT "label_task_name_unique" UNIQUE("task_id","name")
);
--> statement-breakpoint
CREATE TABLE "mcp_oauth_state" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "module_link" (
	"id" text PRIMARY KEY NOT NULL,
	"module_id" text NOT NULL,
	"url" text NOT NULL,
	"title" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "module_link_module_url_unique" UNIQUE("module_id","url")
);
--> statement-breakpoint
CREATE TABLE "module_member" (
	"id" text PRIMARY KEY NOT NULL,
	"module_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "module_member_module_user_unique" UNIQUE("module_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "module" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'backlog' NOT NULL,
	"start_date" date,
	"target_date" date,
	"lead_id" text,
	"position" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "module_dates_check" CHECK ("module"."start_date" is null or "module"."target_date" is null or "module"."start_date" <= "module"."target_date")
);
--> statement-breakpoint
CREATE TABLE "module_task" (
	"id" text PRIMARY KEY NOT NULL,
	"module_id" text NOT NULL,
	"task_id" text NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "module_task_module_task_unique" UNIQUE("module_id","task_id")
);
--> statement-breakpoint
CREATE TABLE "notification" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"title" text,
	"content" text,
	"type" text DEFAULT 'info' NOT NULL,
	"event_data" jsonb,
	"is_read" boolean DEFAULT false,
	"resource_id" text,
	"resource_type" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_role" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"role" text NOT NULL,
	"permission" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"slug" text NOT NULL,
	"icon" text DEFAULT 'Layout',
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"is_public" boolean DEFAULT false,
	"archived_at" timestamp,
	"last_task_number" integer DEFAULT 0 NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"cycles_enabled" boolean DEFAULT true NOT NULL,
	"modules_enabled" boolean DEFAULT true NOT NULL,
	"views_enabled" boolean DEFAULT true NOT NULL,
	"pages_enabled" boolean DEFAULT true NOT NULL,
	"intake_enabled" boolean DEFAULT false NOT NULL,
	"estimates_enabled" boolean DEFAULT false NOT NULL,
	"time_tracking_enabled" boolean DEFAULT true NOT NULL,
	CONSTRAINT "project_workspace_id_id_unique" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "recent_visit" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"visited_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "recent_visit_user_entity_unique" UNIQUE("user_id","entity_type","entity_id")
);
--> statement-breakpoint
CREATE TABLE "role_permission_backfill" (
	"resource" text PRIMARY KEY NOT NULL,
	"applied_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"active_organization_id" text,
	"active_team_id" text,
	"impersonated_by" text,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "task_relation" (
	"id" text PRIMARY KEY NOT NULL,
	"source_task_id" text NOT NULL,
	"target_task_id" text NOT NULL,
	"relation_type" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_reminder_sent" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"reminder_type" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "task_reminder_sent_task_type_unique" UNIQUE("task_id","reminder_type")
);
--> statement-breakpoint
CREATE TABLE "task" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"position" integer DEFAULT 0,
	"number" integer DEFAULT 1,
	"assignee_id" text,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'to-do' NOT NULL,
	"column_id" text,
	"priority" text DEFAULT 'low' NOT NULL,
	"start_date" timestamp,
	"due_date" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "task_project_number_unique" UNIQUE("project_id","number")
);
--> statement-breakpoint
CREATE TABLE "team" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"workspace_id" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "team_member" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "time_entry" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"user_id" text,
	"description" text,
	"start_time" timestamp NOT NULL,
	"end_time" timestamp,
	"duration" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trial_grant" (
	"email_hash" text PRIMARY KEY NOT NULL,
	"trial_ends_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean NOT NULL,
	"image" text,
	"locale" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"is_anonymous" boolean DEFAULT false,
	"role" text,
	"banned" boolean DEFAULT false,
	"ban_reason" text,
	"ban_expires" timestamp,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "user_avatar" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"mime_type" text NOT NULL,
	"size" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_avatar_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "user_notification_preference" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"email_enabled" boolean DEFAULT false NOT NULL,
	"ntfy_enabled" boolean DEFAULT false NOT NULL,
	"ntfy_server_url" text,
	"ntfy_topic" text,
	"ntfy_token" text,
	"gotify_enabled" boolean DEFAULT false NOT NULL,
	"gotify_server_url" text,
	"gotify_token" text,
	"webhook_enabled" boolean DEFAULT false NOT NULL,
	"webhook_url" text,
	"webhook_secret" text,
	"task_assignment_enabled" boolean DEFAULT true NOT NULL,
	"task_comment_enabled" boolean DEFAULT true NOT NULL,
	"task_status_change_enabled" boolean DEFAULT true NOT NULL,
	"due_date_reminder_enabled" boolean DEFAULT true NOT NULL,
	"due_date_reminder_lead_time_minutes" integer DEFAULT 1440 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_notification_preference_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "user_notification_workspace_project" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"workspace_rule_id" text NOT NULL,
	"project_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_notification_workspace_project_rule_project_unique" UNIQUE("workspace_rule_id","project_id")
);
--> statement-breakpoint
CREATE TABLE "user_notification_workspace_rule" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"email_enabled" boolean DEFAULT false NOT NULL,
	"ntfy_enabled" boolean DEFAULT false NOT NULL,
	"gotify_enabled" boolean DEFAULT false NOT NULL,
	"webhook_enabled" boolean DEFAULT false NOT NULL,
	"project_mode" text DEFAULT 'all' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_notification_workspace_rule_user_workspace_unique" UNIQUE("user_id","workspace_id"),
	CONSTRAINT "user_notification_workspace_rule_workspace_id_id_unique" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_rule" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"integration_type" text NOT NULL,
	"event_type" text NOT NULL,
	"column_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"metadata" text,
	"description" text,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "workspace_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "workspace_billing" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"founding_free" boolean DEFAULT false NOT NULL,
	"trial_ends_at" timestamp,
	"creem_customer_id" text,
	"creem_subscription_id" text,
	"creem_product_id" text,
	"plan" text,
	"billing_interval" text,
	"status" text,
	"seats" integer DEFAULT 1 NOT NULL,
	"current_period_end" timestamp,
	"canceled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_billing_workspace_id_unique" UNIQUE("workspace_id"),
	CONSTRAINT "workspace_billing_creem_subscription_id_unique" UNIQUE("creem_subscription_id")
);
--> statement-breakpoint
CREATE TABLE "workspace_member" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"joined_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "apikey" ADD CONSTRAINT "apikey_reference_id_user_id_fk" FOREIGN KEY ("reference_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apikey" ADD CONSTRAINT "apikey_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_activity_id_activity_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activity"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "billing_reminder_sent" ADD CONSTRAINT "billing_reminder_sent_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "billing_reminder_sent" ADD CONSTRAINT "billing_reminder_sent_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "column" ADD CONSTRAINT "column_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "comment" ADD CONSTRAINT "comment_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "comment" ADD CONSTRAINT "comment_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "custom_field_definition" ADD CONSTRAINT "custom_field_definition_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "custom_field_value" ADD CONSTRAINT "custom_field_value_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "custom_field_value" ADD CONSTRAINT "custom_field_value_field_id_custom_field_definition_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."custom_field_definition"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "cycle" ADD CONSTRAINT "cycle_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "cycle" ADD CONSTRAINT "cycle_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "cycle" ADD CONSTRAINT "cycle_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "cycle_task" ADD CONSTRAINT "cycle_task_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "cycle_task" ADD CONSTRAINT "cycle_task_cycle_id_cycle_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."cycle"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "cycle_task" ADD CONSTRAINT "cycle_task_added_by_user_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "device_code" ADD CONSTRAINT "device_code_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "external_link" ADD CONSTRAINT "external_link_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "external_link" ADD CONSTRAINT "external_link_integration_id_integration_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integration"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "favorite" ADD CONSTRAINT "favorite_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "favorite" ADD CONSTRAINT "favorite_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "favorite" ADD CONSTRAINT "favorite_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "github_import" ADD CONSTRAINT "github_import_integration_id_integration_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integration"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "github_integration" ADD CONSTRAINT "github_integration_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "integration" ADD CONSTRAINT "integration_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label" ADD CONSTRAINT "label_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "label" ADD CONSTRAINT "label_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "module_link" ADD CONSTRAINT "module_link_module_id_module_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."module"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "module_link" ADD CONSTRAINT "module_link_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "module_member" ADD CONSTRAINT "module_member_module_id_module_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."module"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "module_member" ADD CONSTRAINT "module_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "module" ADD CONSTRAINT "module_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "module" ADD CONSTRAINT "module_lead_id_user_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "module" ADD CONSTRAINT "module_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "module_task" ADD CONSTRAINT "module_task_module_id_module_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."module"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "module_task" ADD CONSTRAINT "module_task_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "module_task" ADD CONSTRAINT "module_task_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "workspace_role" ADD CONSTRAINT "workspace_role_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "recent_visit" ADD CONSTRAINT "recent_visit_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "recent_visit" ADD CONSTRAINT "recent_visit_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "recent_visit" ADD CONSTRAINT "recent_visit_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_relation" ADD CONSTRAINT "task_relation_source_task_id_task_id_fk" FOREIGN KEY ("source_task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "task_relation" ADD CONSTRAINT "task_relation_target_task_id_task_id_fk" FOREIGN KEY ("target_task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "task_reminder_sent" ADD CONSTRAINT "task_reminder_sent_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_assignee_id_user_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_column_id_column_id_fk" FOREIGN KEY ("column_id") REFERENCES "public"."column"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "team" ADD CONSTRAINT "team_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_member" ADD CONSTRAINT "team_member_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_member" ADD CONSTRAINT "team_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "user_avatar" ADD CONSTRAINT "user_avatar_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "user_notification_preference" ADD CONSTRAINT "user_notification_preference_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "user_notification_workspace_project" ADD CONSTRAINT "user_notification_workspace_project_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "user_notification_workspace_project" ADD CONSTRAINT "user_notification_workspace_project_workspace_id_workspace_rule_id_user_notification_workspace_rule_workspace_id_id_fk" FOREIGN KEY ("workspace_id","workspace_rule_id") REFERENCES "public"."user_notification_workspace_rule"("workspace_id","id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "user_notification_workspace_project" ADD CONSTRAINT "user_notification_workspace_project_workspace_id_project_id_project_workspace_id_id_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."project"("workspace_id","id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "user_notification_workspace_rule" ADD CONSTRAINT "user_notification_workspace_rule_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "user_notification_workspace_rule" ADD CONSTRAINT "user_notification_workspace_rule_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "workflow_rule" ADD CONSTRAINT "workflow_rule_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "workflow_rule" ADD CONSTRAINT "workflow_rule_column_id_column_id_fk" FOREIGN KEY ("column_id") REFERENCES "public"."column"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "workspace_billing" ADD CONSTRAINT "workspace_billing_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "workspace_member" ADD CONSTRAINT "workspace_member_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_member" ADD CONSTRAINT "workspace_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "activity_task_id_idx" ON "activity" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "activity_userId_idx" ON "activity" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "apikey_configId_idx" ON "apikey" USING btree ("config_id");--> statement-breakpoint
CREATE INDEX "apikey_key_idx" ON "apikey" USING btree ("key");--> statement-breakpoint
CREATE INDEX "apikey_referenceId_idx" ON "apikey" USING btree ("reference_id");--> statement-breakpoint
CREATE INDEX "apikey_userId_idx" ON "apikey" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "asset_workspaceId_idx" ON "asset" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "asset_projectId_idx" ON "asset" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "asset_taskId_idx" ON "asset" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "asset_activityId_idx" ON "asset" USING btree ("activity_id");--> statement-breakpoint
CREATE INDEX "asset_createdBy_idx" ON "asset" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "billing_reminder_sent_workspaceId_idx" ON "billing_reminder_sent" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "billing_reminder_sent_userId_idx" ON "billing_reminder_sent" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "column_projectId_idx" ON "column" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "column_projectId_statusGroup_idx" ON "column" USING btree ("project_id","status_group");--> statement-breakpoint
CREATE INDEX "comment_task_idx" ON "comment" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "comment_user_idx" ON "comment" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "custom_field_def_projectId_idx" ON "custom_field_definition" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "custom_field_value_taskId_idx" ON "custom_field_value" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "custom_field_value_fieldId_idx" ON "custom_field_value" USING btree ("field_id");--> statement-breakpoint
CREATE INDEX "cycle_projectId_idx" ON "cycle" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "cycle_ownerId_idx" ON "cycle" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "cycle_createdBy_idx" ON "cycle" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "cycle_task_cycleId_idx" ON "cycle_task" USING btree ("cycle_id");--> statement-breakpoint
CREATE INDEX "cycle_task_addedBy_idx" ON "cycle_task" USING btree ("added_by");--> statement-breakpoint
CREATE UNIQUE INDEX "device_code_device_code_uidx" ON "device_code" USING btree ("device_code");--> statement-breakpoint
CREATE UNIQUE INDEX "device_code_user_code_uidx" ON "device_code" USING btree ("user_code");--> statement-breakpoint
CREATE INDEX "device_code_user_id_idx" ON "device_code" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "external_link_taskId_idx" ON "external_link" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "external_link_integrationId_idx" ON "external_link" USING btree ("integration_id");--> statement-breakpoint
CREATE INDEX "external_link_externalId_idx" ON "external_link" USING btree ("external_id");--> statement-breakpoint
CREATE INDEX "external_link_resourceType_idx" ON "external_link" USING btree ("resource_type");--> statement-breakpoint
CREATE INDEX "favorite_user_workspace_position_idx" ON "favorite" USING btree ("user_id","workspace_id","position");--> statement-breakpoint
CREATE INDEX "favorite_entity_idx" ON "favorite" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "favorite_projectId_idx" ON "favorite" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "integration_projectId_idx" ON "integration" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "integration_type_idx" ON "integration" USING btree ("type");--> statement-breakpoint
CREATE INDEX "invitation_workspaceId_idx" ON "invitation" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "invitation_email_idx" ON "invitation" USING btree ("email");--> statement-breakpoint
CREATE INDEX "invitation_inviterId_idx" ON "invitation" USING btree ("inviter_id");--> statement-breakpoint
CREATE INDEX "label_task_id_idx" ON "label" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "label_workspace_id_idx" ON "label" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "label_workspace_cascade_idx" ON "label" USING btree ("workspace_id","name","created_at","id") WHERE "label"."task_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "label_workspace_name_unique" ON "label" USING btree ("workspace_id","name") WHERE "label"."task_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_oauth_state_kind_key_uidx" ON "mcp_oauth_state" USING btree ("kind","key");--> statement-breakpoint
CREATE INDEX "mcp_oauth_state_expiresAt_idx" ON "mcp_oauth_state" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "module_link_createdBy_idx" ON "module_link" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "module_member_userId_idx" ON "module_member" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "module_project_name_unique" ON "module" USING btree ("project_id",lower("name"));--> statement-breakpoint
CREATE INDEX "module_projectId_position_idx" ON "module" USING btree ("project_id","position");--> statement-breakpoint
CREATE INDEX "module_leadId_idx" ON "module" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "module_createdBy_idx" ON "module" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "module_task_taskId_idx" ON "module_task" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "module_task_createdBy_idx" ON "module_task" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "notification_userId_idx" ON "notification" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "workspace_role_workspaceId_idx" ON "workspace_role" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "workspace_role_role_idx" ON "workspace_role" USING btree ("role");--> statement-breakpoint
CREATE INDEX "project_workspaceId_position_idx" ON "project" USING btree ("workspace_id","position");--> statement-breakpoint
CREATE INDEX "recent_visit_user_workspace_visited_idx" ON "recent_visit" USING btree ("user_id","workspace_id","visited_at");--> statement-breakpoint
CREATE INDEX "recent_visit_entity_idx" ON "recent_visit" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "recent_visit_projectId_idx" ON "recent_visit" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "task_relation_source_idx" ON "task_relation" USING btree ("source_task_id");--> statement-breakpoint
CREATE INDEX "task_relation_target_idx" ON "task_relation" USING btree ("target_task_id");--> statement-breakpoint
CREATE INDEX "task_reminder_sent_taskId_idx" ON "task_reminder_sent" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "task_projectId_idx" ON "task" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "task_dueDate_idx" ON "task" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX "task_assigneeId_idx" ON "task" USING btree ("assignee_id");--> statement-breakpoint
CREATE INDEX "task_columnId_idx" ON "task" USING btree ("column_id");--> statement-breakpoint
CREATE INDEX "task_projectId_completedAt_idx" ON "task" USING btree ("project_id","completed_at");--> statement-breakpoint
CREATE INDEX "team_workspaceId_idx" ON "team" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "teamMember_teamId_idx" ON "team_member" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "teamMember_userId_idx" ON "team_member" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "time_entry_taskId_idx" ON "time_entry" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "time_entry_userId_idx" ON "time_entry" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_avatar_userId_idx" ON "user_avatar" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_notification_workspace_project_ruleId_idx" ON "user_notification_workspace_project" USING btree ("workspace_rule_id");--> statement-breakpoint
CREATE INDEX "user_notification_workspace_project_projectId_idx" ON "user_notification_workspace_project" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "user_notification_workspace_project_workspaceId_projectId_idx" ON "user_notification_workspace_project" USING btree ("workspace_id","project_id");--> statement-breakpoint
CREATE INDEX "unwp_workspaceId_workspaceRuleId_idx" ON "user_notification_workspace_project" USING btree ("workspace_id","workspace_rule_id");--> statement-breakpoint
CREATE INDEX "user_notification_workspace_rule_userId_idx" ON "user_notification_workspace_rule" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_notification_workspace_rule_workspaceId_idx" ON "user_notification_workspace_rule" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "workflow_rule_projectId_idx" ON "workflow_rule" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "workflow_rule_columnId_idx" ON "workflow_rule" USING btree ("column_id");--> statement-breakpoint
CREATE INDEX "workspace_billing_workspaceId_idx" ON "workspace_billing" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "workspace_member_workspaceId_idx" ON "workspace_member" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "workspace_member_userId_idx" ON "workspace_member" USING btree ("user_id");