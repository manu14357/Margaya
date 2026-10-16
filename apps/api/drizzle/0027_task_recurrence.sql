CREATE TABLE "task_recurrence" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"frequency" text NOT NULL,
	"interval" integer DEFAULT 1 NOT NULL,
	"weekdays" integer[],
	"month_day" integer,
	"trigger" text DEFAULT 'completion' NOT NULL,
	"anchor_date" date NOT NULL,
	"end_date" date,
	"max_occurrences" integer,
	"occurrence_count" integer DEFAULT 1 NOT NULL,
	"next_run_date" date,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task_recurrence" ADD CONSTRAINT "task_recurrence_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "task_recurrence" ADD CONSTRAINT "task_recurrence_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "task_recurrence_taskId_unique" ON "task_recurrence" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "task_recurrence_nextRunDate_idx" ON "task_recurrence" USING btree ("next_run_date") WHERE "task_recurrence"."next_run_date" is not null;--> statement-breakpoint
CREATE INDEX "task_recurrence_createdBy_idx" ON "task_recurrence" USING btree ("created_by");