CREATE TABLE "task_link" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"url" text NOT NULL,
	"title" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "task_link_task_url_unique" UNIQUE("task_id","url")
);
--> statement-breakpoint
DROP INDEX "task_relation_source_idx";--> statement-breakpoint
DROP INDEX "task_relation_target_idx";--> statement-breakpoint
ALTER TABLE "task_link" ADD CONSTRAINT "task_link_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "task_link" ADD CONSTRAINT "task_link_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "task_link_createdBy_idx" ON "task_link" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "task_relation_source_type_idx" ON "task_relation" USING btree ("source_task_id","relation_type");--> statement-breakpoint
CREATE INDEX "task_relation_target_type_idx" ON "task_relation" USING btree ("target_task_id","relation_type");