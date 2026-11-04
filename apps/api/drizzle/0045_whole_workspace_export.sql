ALTER TABLE "task_export" ALTER COLUMN "size_bytes" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "task_export" ADD COLUMN "kind" text DEFAULT 'tasks' NOT NULL;--> statement-breakpoint
ALTER TABLE "task_export" ADD COLUMN "include_files" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "task_export" ADD COLUMN "file_count" integer;--> statement-breakpoint
ALTER TABLE "task_export" ADD COLUMN "missing_file_count" integer;