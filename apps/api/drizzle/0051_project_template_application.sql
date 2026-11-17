CREATE TABLE "project_template_application" (
	"project_id" text PRIMARY KEY NOT NULL,
	"template_id" text NOT NULL,
	"template_version" integer NOT NULL,
	"locale" text NOT NULL,
	"sample_task_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sample_removed_at" timestamp with time zone,
	"applied_by" text,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_template_application" ADD CONSTRAINT "project_template_application_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "project_template_application" ADD CONSTRAINT "project_template_application_applied_by_user_id_fk" FOREIGN KEY ("applied_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "project_template_application_templateId_idx" ON "project_template_application" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "project_template_application_appliedBy_idx" ON "project_template_application" USING btree ("applied_by");