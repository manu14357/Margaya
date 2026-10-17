CREATE TABLE "automation_rule" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"trigger_type" text NOT NULL,
	"trigger" jsonb NOT NULL,
	"conditions" jsonb,
	"actions" jsonb NOT NULL,
	"created_by" text,
	"updated_by" text,
	"run_count" integer DEFAULT 0 NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_outcome" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_run" (
	"id" text PRIMARY KEY NOT NULL,
	"rule_id" text NOT NULL,
	"project_id" text NOT NULL,
	"task_id" text,
	"trigger_type" text NOT NULL,
	"outcome" text NOT NULL,
	"error" text,
	"actions" jsonb,
	"depth" integer DEFAULT 0 NOT NULL,
	"dedupe_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "automation_run_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
ALTER TABLE "automation_rule" ADD CONSTRAINT "automation_rule_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "automation_rule" ADD CONSTRAINT "automation_rule_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "automation_rule" ADD CONSTRAINT "automation_rule_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "automation_run" ADD CONSTRAINT "automation_run_rule_id_automation_rule_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."automation_rule"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "automation_run" ADD CONSTRAINT "automation_run_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "automation_run" ADD CONSTRAINT "automation_run_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "automation_rule_project_trigger_idx" ON "automation_rule" USING btree ("project_id","enabled","trigger_type");--> statement-breakpoint
CREATE INDEX "automation_run_rule_created_idx" ON "automation_run" USING btree ("rule_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "automation_run_project_created_idx" ON "automation_run" USING btree ("project_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "automation_run_task_created_idx" ON "automation_run" USING btree ("task_id","created_at");--> statement-breakpoint
CREATE INDEX "automation_run_created_idx" ON "automation_run" USING btree ("created_at");