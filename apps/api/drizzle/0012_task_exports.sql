CREATE TABLE "task_export_file" (
	"export_id" text PRIMARY KEY NOT NULL,
	"content" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_export" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"requested_by" text,
	"format" text NOT NULL,
	"project_ids" text[] NOT NULL,
	"split_by_project" boolean DEFAULT false NOT NULL,
	"include_archived" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"error" text,
	"task_count" integer,
	"file_name" text,
	"content_type" text,
	"size_bytes" integer,
	"storage" text,
	"object_key" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task_export_file" ADD CONSTRAINT "task_export_file_export_id_task_export_id_fk" FOREIGN KEY ("export_id") REFERENCES "public"."task_export"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "task_export" ADD CONSTRAINT "task_export_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "task_export" ADD CONSTRAINT "task_export_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "task_export_history_idx" ON "task_export" USING btree ("workspace_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "task_export_requester_idx" ON "task_export" USING btree ("requested_by","workspace_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "task_export_queue_idx" ON "task_export" USING btree ("created_at") WHERE "task_export"."status" = 'queued';--> statement-breakpoint
CREATE INDEX "task_export_expiry_idx" ON "task_export" USING btree ("expires_at") WHERE "task_export"."status" = 'completed';