CREATE TABLE "a2a_push_config" (
	"id" text PRIMARY KEY NOT NULL,
	"a2a_task_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"ref_kind" text NOT NULL,
	"ref_id" text NOT NULL,
	"url" text NOT NULL,
	"token_sealed" text,
	"auth_scheme" text,
	"auth_credentials_sealed" text,
	"last_state" text,
	"last_delivered_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_feed" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"token_start" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_feed_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "feedback_survey_state" (
	"user_id" text PRIMARY KEY NOT NULL,
	"active_days" integer DEFAULT 0 NOT NULL,
	"last_active_on" date,
	"last_shown_at" timestamp with time zone,
	"last_answered_at" timestamp with time zone,
	"snoozed_until" timestamp with time zone,
	"opted_out" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"format" text NOT NULL,
	"score" smallint,
	"comment" text,
	"page_type" text,
	"feature" text,
	"app_version" text,
	"client" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_kind_check" CHECK ("feedback"."kind" in ('general', 'survey', 'feature')),
	CONSTRAINT "feedback_format_check" CHECK ("feedback"."format" in ('faces3', 'faces5', 'stars', 'nps', 'thumbs')),
	CONSTRAINT "feedback_content_check" CHECK ("feedback"."score" is not null or "feedback"."comment" is not null)
);
--> statement-breakpoint
CREATE TABLE "intake_email_message" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"intake_item_id" text NOT NULL,
	"message_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "intake_email_message_project_message_unique" UNIQUE("project_id","message_id")
);
--> statement-breakpoint
CREATE TABLE "intake_email_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"address_token" text NOT NULL,
	"allowed_domains" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"blocked_domains" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"imap_enabled" boolean DEFAULT false NOT NULL,
	"imap_host" text,
	"imap_port" integer,
	"imap_security" text DEFAULT 'tls' NOT NULL,
	"imap_username" text,
	"imap_password" text,
	"imap_folder" text DEFAULT 'INBOX' NOT NULL,
	"last_polled_at" timestamp with time zone,
	"last_received_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "intake_email_settings_project_unique" UNIQUE("project_id"),
	CONSTRAINT "intake_email_settings_address_token_unique" UNIQUE("address_token"),
	CONSTRAINT "intake_email_settings_imap_security_check" CHECK ("intake_email_settings"."imap_security" in ('tls', 'starttls'))
);
--> statement-breakpoint
CREATE TABLE "intake_form" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"token" text NOT NULL,
	"title" text,
	"intro" text,
	"description_field" text DEFAULT 'optional' NOT NULL,
	"email_field" text DEFAULT 'required' NOT NULL,
	"name_field" text DEFAULT 'optional' NOT NULL,
	"custom_field_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confirmation_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "intake_form_project_unique" UNIQUE("project_id"),
	CONSTRAINT "intake_form_token_unique" UNIQUE("token"),
	CONSTRAINT "intake_form_field_modes_check" CHECK ("intake_form"."description_field" in ('off', 'optional', 'required') and "intake_form"."email_field" in ('off', 'optional', 'required') and "intake_form"."name_field" in ('off', 'optional', 'required'))
);
--> statement-breakpoint
CREATE TABLE "notification_delivery_hold" (
	"id" text PRIMARY KEY NOT NULL,
	"notification_id" text NOT NULL,
	"user_id" text NOT NULL,
	"channels" text[] NOT NULL,
	"claimed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_delivery_hold_notification_id_unique" UNIQUE("notification_id")
);
--> statement-breakpoint
CREATE TABLE "project_update_comment" (
	"id" text PRIMARY KEY NOT NULL,
	"update_id" text NOT NULL,
	"user_id" text,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_update_reaction" (
	"id" text PRIMARY KEY NOT NULL,
	"update_id" text NOT NULL,
	"user_id" text NOT NULL,
	"emoji" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_update_reaction_unique" UNIQUE("update_id","user_id","emoji")
);
--> statement-breakpoint
CREATE TABLE "project_update_reminder" (
	"project_id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"weekday" smallint DEFAULT 5 NOT NULL,
	"last_reminded_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_update_reminder_weekday_check" CHECK ("project_update_reminder"."weekday" between 0 and 6)
);
--> statement-breakpoint
CREATE TABLE "project_update_subscriber" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"user_id" text NOT NULL,
	"subscribed" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_update_subscriber_project_user_unique" UNIQUE("project_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "project_update" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"author_id" text,
	"health" text NOT NULL,
	"summary" text NOT NULL,
	"highlights" text,
	"blockers" text,
	"next_steps" text,
	"ai_provenance" jsonb,
	"facts" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_update_health_check" CHECK ("project_update"."health" in ('on_track', 'at_risk', 'off_track'))
);
--> statement-breakpoint
CREATE TABLE "slack_connection" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"mode" text DEFAULT 'socket' NOT NULL,
	"bot_token" text NOT NULL,
	"app_token" text,
	"signing_secret" text,
	"team_id" text,
	"team_name" text,
	"bot_user_id" text,
	"default_project_id" text,
	"expand_task_keys" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_connected_at" timestamp,
	"last_error" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "slack_connection_workspace_unique" UNIQUE("workspace_id")
);
--> statement-breakpoint
CREATE TABLE "slack_user_link" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"slack_team_id" text NOT NULL,
	"slack_user_id" text NOT NULL,
	"slack_user_name" text,
	"user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "slack_user_link_identity_unique" UNIQUE("workspace_id","slack_team_id","slack_user_id")
);
--> statement-breakpoint
ALTER TABLE "activity" ADD COLUMN "ai_provenance" jsonb;--> statement-breakpoint
ALTER TABLE "intake_item" ADD COLUMN "submitter_email" text;--> statement-breakpoint
ALTER TABLE "intake_item" ADD COLUMN "submitter_name" text;--> statement-breakpoint
ALTER TABLE "page" ADD COLUMN "ai_provenance" jsonb;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "updates_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "ai_provenance" jsonb;--> statement-breakpoint
ALTER TABLE "a2a_push_config" ADD CONSTRAINT "a2a_push_config_a2a_task_id_a2a_task_id_fk" FOREIGN KEY ("a2a_task_id") REFERENCES "public"."a2a_task"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "a2a_push_config" ADD CONSTRAINT "a2a_push_config_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "a2a_push_config" ADD CONSTRAINT "a2a_push_config_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "calendar_feed" ADD CONSTRAINT "calendar_feed_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_feed" ADD CONSTRAINT "calendar_feed_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_feed" ADD CONSTRAINT "calendar_feed_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_survey_state" ADD CONSTRAINT "feedback_survey_state_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "intake_email_message" ADD CONSTRAINT "intake_email_message_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "intake_email_message" ADD CONSTRAINT "intake_email_message_intake_item_id_intake_item_id_fk" FOREIGN KEY ("intake_item_id") REFERENCES "public"."intake_item"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "intake_email_settings" ADD CONSTRAINT "intake_email_settings_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "intake_form" ADD CONSTRAINT "intake_form_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "notification_delivery_hold" ADD CONSTRAINT "notification_delivery_hold_notification_id_notification_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notification"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "notification_delivery_hold" ADD CONSTRAINT "notification_delivery_hold_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "project_update_comment" ADD CONSTRAINT "project_update_comment_update_id_project_update_id_fk" FOREIGN KEY ("update_id") REFERENCES "public"."project_update"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "project_update_comment" ADD CONSTRAINT "project_update_comment_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "project_update_reaction" ADD CONSTRAINT "project_update_reaction_update_id_project_update_id_fk" FOREIGN KEY ("update_id") REFERENCES "public"."project_update"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "project_update_reaction" ADD CONSTRAINT "project_update_reaction_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "project_update_reminder" ADD CONSTRAINT "project_update_reminder_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "project_update_subscriber" ADD CONSTRAINT "project_update_subscriber_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "project_update_subscriber" ADD CONSTRAINT "project_update_subscriber_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "project_update" ADD CONSTRAINT "project_update_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "project_update" ADD CONSTRAINT "project_update_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "project_update" ADD CONSTRAINT "project_update_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "slack_connection" ADD CONSTRAINT "slack_connection_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "slack_connection" ADD CONSTRAINT "slack_connection_default_project_id_project_id_fk" FOREIGN KEY ("default_project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "slack_connection" ADD CONSTRAINT "slack_connection_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "slack_user_link" ADD CONSTRAINT "slack_user_link_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "slack_user_link" ADD CONSTRAINT "slack_user_link_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "a2a_push_config_task_idx" ON "a2a_push_config" USING btree ("a2a_task_id");--> statement-breakpoint
CREATE INDEX "a2a_push_config_ref_idx" ON "a2a_push_config" USING btree ("ref_kind","ref_id");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_feed_user_workspace_kind_unique" ON "calendar_feed" USING btree ("user_id","workspace_id","kind") WHERE "calendar_feed"."project_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_feed_user_project_unique" ON "calendar_feed" USING btree ("user_id","project_id") WHERE "calendar_feed"."project_id" is not null;--> statement-breakpoint
CREATE INDEX "calendar_feed_userId_idx" ON "calendar_feed" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "calendar_feed_workspaceId_userId_idx" ON "calendar_feed" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE INDEX "calendar_feed_projectId_idx" ON "calendar_feed" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "feedback_created_idx" ON "feedback" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "feedback_format_created_idx" ON "feedback" USING btree ("format","created_at");--> statement-breakpoint
CREATE INDEX "feedback_user_idx" ON "feedback" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "intake_email_message_item_idx" ON "intake_email_message" USING btree ("intake_item_id");--> statement-breakpoint
CREATE INDEX "intake_email_settings_imap_idx" ON "intake_email_settings" USING btree ("project_id") WHERE "intake_email_settings"."enabled" and "intake_email_settings"."imap_enabled";--> statement-breakpoint
CREATE INDEX "notification_delivery_hold_user_idx" ON "notification_delivery_hold" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "project_update_comment_update_created_idx" ON "project_update_comment" USING btree ("update_id","created_at");--> statement-breakpoint
CREATE INDEX "project_update_comment_user_idx" ON "project_update_comment" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "project_update_reaction_user_idx" ON "project_update_reaction" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "project_update_reminder_enabled_idx" ON "project_update_reminder" USING btree ("enabled") WHERE "project_update_reminder"."enabled";--> statement-breakpoint
CREATE INDEX "project_update_subscriber_user_idx" ON "project_update_subscriber" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "project_update_project_created_idx" ON "project_update" USING btree ("project_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "project_update_workspace_created_idx" ON "project_update" USING btree ("workspace_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "project_update_author_idx" ON "project_update" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "slack_connection_team_idx" ON "slack_connection" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "slack_user_link_user_idx" ON "slack_user_link" USING btree ("user_id");