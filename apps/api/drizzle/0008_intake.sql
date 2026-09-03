CREATE TABLE "intake_item" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"task_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"snoozed_until" timestamp with time zone,
	"duplicate_of_task_id" text,
	"resolution_note" text,
	"source" text DEFAULT 'in_app' NOT NULL,
	"submitted_by" text,
	"triaged_by" text,
	"triaged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "intake_item_task_unique" UNIQUE("task_id")
);
--> statement-breakpoint
ALTER TABLE "intake_item" ADD CONSTRAINT "intake_item_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "intake_item" ADD CONSTRAINT "intake_item_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "intake_item" ADD CONSTRAINT "intake_item_duplicate_of_task_id_task_id_fk" FOREIGN KEY ("duplicate_of_task_id") REFERENCES "public"."task"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "intake_item" ADD CONSTRAINT "intake_item_submitted_by_user_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "intake_item" ADD CONSTRAINT "intake_item_triaged_by_user_id_fk" FOREIGN KEY ("triaged_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "intake_item_project_status_created_idx" ON "intake_item" USING btree ("project_id","status","created_at");--> statement-breakpoint
CREATE INDEX "intake_item_snoozed_until_idx" ON "intake_item" USING btree ("snoozed_until") WHERE "intake_item"."status" = 'snoozed';--> statement-breakpoint
CREATE INDEX "intake_item_submitted_by_idx" ON "intake_item" USING btree ("submitted_by");--> statement-breakpoint
CREATE INDEX "intake_item_duplicate_of_idx" ON "intake_item" USING btree ("duplicate_of_task_id");--> statement-breakpoint
CREATE INDEX "intake_item_triaged_by_idx" ON "intake_item" USING btree ("triaged_by");--> statement-breakpoint
CREATE UNIQUE INDEX "column_project_triage_unique" ON "column" USING btree ("project_id") WHERE "column"."status_group" = 'triage';