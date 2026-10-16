CREATE TABLE "analytics_report" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"owner_id" text,
	"name" text NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"config" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "analytics_report_visibility_check" CHECK ("analytics_report"."visibility" in ('private', 'workspace'))
);
--> statement-breakpoint
CREATE TABLE "task_template" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"title_pattern" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"column_id" text,
	"priority" text,
	"label_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"assignee_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"estimate_point_id" text,
	"subtasks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cycle" ADD COLUMN "rolled_over_at" timestamp;--> statement-breakpoint
ALTER TABLE "cycle" ADD COLUMN "rollover_result" jsonb;--> statement-breakpoint
ALTER TABLE "project_automation" ADD COLUMN "cycle_rollover_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "project_automation" ADD COLUMN "cycle_rollover_since" date;--> statement-breakpoint
ALTER TABLE "project_automation" ADD COLUMN "last_rolled_over_at" timestamp;--> statement-breakpoint
ALTER TABLE "project_automation" ADD COLUMN "last_rolled_over_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "analytics_report" ADD CONSTRAINT "analytics_report_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "analytics_report" ADD CONSTRAINT "analytics_report_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "task_template" ADD CONSTRAINT "task_template_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "task_template" ADD CONSTRAINT "task_template_column_id_column_id_fk" FOREIGN KEY ("column_id") REFERENCES "public"."column"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "task_template" ADD CONSTRAINT "task_template_estimate_point_id_estimate_point_id_fk" FOREIGN KEY ("estimate_point_id") REFERENCES "public"."estimate_point"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "task_template" ADD CONSTRAINT "task_template_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "analytics_report_workspaceId_idx" ON "analytics_report" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "analytics_report_ownerId_idx" ON "analytics_report" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "task_template_projectId_position_idx" ON "task_template" USING btree ("project_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "task_template_project_name_unique" ON "task_template" USING btree ("project_id",lower("name"));--> statement-breakpoint
CREATE INDEX "task_template_columnId_idx" ON "task_template" USING btree ("column_id");--> statement-breakpoint
CREATE INDEX "task_template_estimatePointId_idx" ON "task_template" USING btree ("estimate_point_id");--> statement-breakpoint
CREATE INDEX "task_template_createdBy_idx" ON "task_template" USING btree ("created_by");