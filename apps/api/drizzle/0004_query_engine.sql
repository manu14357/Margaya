ALTER TABLE "task" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "created_by" text;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "custom_field_value_field_value_idx" ON "custom_field_value" USING btree ("field_id","value");--> statement-breakpoint
CREATE INDEX "task_projectId_status_idx" ON "task" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "task_projectId_active_position_idx" ON "task" USING btree ("project_id","position") WHERE "task"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "task_projectId_archivedAt_idx" ON "task" USING btree ("project_id","archived_at") WHERE "task"."archived_at" is not null;--> statement-breakpoint
CREATE INDEX "task_projectId_updatedAt_idx" ON "task" USING btree ("project_id","updated_at");--> statement-breakpoint
CREATE INDEX "task_projectId_dueDate_idx" ON "task" USING btree ("project_id","due_date");--> statement-breakpoint
CREATE INDEX "task_createdBy_idx" ON "task" USING btree ("created_by");