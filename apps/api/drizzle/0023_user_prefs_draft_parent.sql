ALTER TABLE "task_draft" ADD COLUMN "parent_task_id" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "preferences" jsonb;--> statement-breakpoint
ALTER TABLE "task_draft" ADD CONSTRAINT "task_draft_parent_task_id_task_id_fk" FOREIGN KEY ("parent_task_id") REFERENCES "public"."task"("id") ON DELETE set null ON UPDATE cascade;