ALTER TABLE "project" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "deleted_by" text;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "deleted_by" text;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "trash_batch_id" text;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_deleted_by_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_deleted_by_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "project_workspaceId_deletedAt_idx" ON "project" USING btree ("workspace_id","deleted_at") WHERE "project"."deleted_at" is not null;--> statement-breakpoint
CREATE INDEX "task_projectId_deletedAt_idx" ON "task" USING btree ("project_id","deleted_at") WHERE "task"."deleted_at" is not null;--> statement-breakpoint
CREATE INDEX "task_trashBatchId_idx" ON "task" USING btree ("trash_batch_id") WHERE "task"."trash_batch_id" is not null;