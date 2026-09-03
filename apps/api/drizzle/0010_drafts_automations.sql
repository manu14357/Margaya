CREATE TABLE "project_automation" (
	"project_id" text PRIMARY KEY NOT NULL,
	"auto_archive_enabled" boolean DEFAULT false NOT NULL,
	"auto_archive_months" integer DEFAULT 3 NOT NULL,
	"auto_close_enabled" boolean DEFAULT false NOT NULL,
	"auto_close_months" integer DEFAULT 3 NOT NULL,
	"auto_close_column_id" text,
	"last_checked_at" timestamp,
	"last_archived_at" timestamp,
	"last_archived_count" integer DEFAULT 0 NOT NULL,
	"last_closed_at" timestamp,
	"last_closed_count" integer DEFAULT 0 NOT NULL,
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_automation_months_check" CHECK ("project_automation"."auto_archive_months" between 1 and 12 and "project_automation"."auto_close_months" between 1 and 12)
);
--> statement-breakpoint
CREATE TABLE "task_draft" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text,
	"created_by" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" text,
	"priority" text DEFAULT 'no-priority' NOT NULL,
	"assignee_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"labels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"start_date" timestamp,
	"due_date" timestamp,
	"custom_field_values" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cycle_id" text,
	"module_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"estimate_point_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_automation" ADD CONSTRAINT "project_automation_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "project_automation" ADD CONSTRAINT "project_automation_auto_close_column_id_column_id_fk" FOREIGN KEY ("auto_close_column_id") REFERENCES "public"."column"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "project_automation" ADD CONSTRAINT "project_automation_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "task_draft" ADD CONSTRAINT "task_draft_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "task_draft" ADD CONSTRAINT "task_draft_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "task_draft" ADD CONSTRAINT "task_draft_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "project_automation_active_idx" ON "project_automation" USING btree ("last_checked_at") WHERE "project_automation"."auto_archive_enabled" or "project_automation"."auto_close_enabled";--> statement-breakpoint
CREATE INDEX "project_automation_closeColumnId_idx" ON "project_automation" USING btree ("auto_close_column_id");--> statement-breakpoint
CREATE INDEX "project_automation_updatedBy_idx" ON "project_automation" USING btree ("updated_by");--> statement-breakpoint
CREATE INDEX "task_draft_owner_workspace_updated_idx" ON "task_draft" USING btree ("created_by","workspace_id","updated_at");--> statement-breakpoint
CREATE INDEX "task_draft_projectId_idx" ON "task_draft" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "task_draft_workspaceId_idx" ON "task_draft" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "task_projectId_updatedAt_active_idx" ON "task" USING btree ("project_id","updated_at") WHERE "task"."archived_at" is null;