ALTER TABLE "project" ADD COLUMN "lead_user_id" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "default_assignee_user_id" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "timezone" text;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "timezone" text DEFAULT 'UTC' NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_lead_user_id_user_id_fk" FOREIGN KEY ("lead_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_default_assignee_user_id_user_id_fk" FOREIGN KEY ("default_assignee_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;