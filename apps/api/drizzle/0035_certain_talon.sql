CREATE TABLE "coding_agent_profile" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"builtin" text,
	"name" text NOT NULL,
	"mention" text DEFAULT '' NOT NULL,
	"assignee" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coding_agent_profile_builtin_unique" UNIQUE("workspace_id","builtin")
);
--> statement-breakpoint
CREATE TABLE "coding_handoff" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"task_id" text NOT NULL,
	"integration_id" text NOT NULL,
	"provider" text NOT NULL,
	"profile_id" text,
	"profile_name" text NOT NULL,
	"issue_number" integer NOT NULL,
	"issue_url" text NOT NULL,
	"pr_number" integer,
	"pr_url" text,
	"pr_title" text,
	"state" text DEFAULT 'issue_created' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"working_at" timestamp with time zone,
	"ready_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "coding_agent_profile" ADD CONSTRAINT "coding_agent_profile_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "coding_handoff" ADD CONSTRAINT "coding_handoff_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "coding_handoff" ADD CONSTRAINT "coding_handoff_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "coding_handoff" ADD CONSTRAINT "coding_handoff_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "coding_handoff" ADD CONSTRAINT "coding_handoff_integration_id_integration_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integration"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "coding_handoff" ADD CONSTRAINT "coding_handoff_profile_id_coding_agent_profile_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."coding_agent_profile"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "coding_handoff" ADD CONSTRAINT "coding_handoff_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "coding_agent_profile_workspace_idx" ON "coding_agent_profile" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "coding_handoff_task_idx" ON "coding_handoff" USING btree ("task_id","created_at");--> statement-breakpoint
CREATE INDEX "coding_handoff_integration_issue_idx" ON "coding_handoff" USING btree ("integration_id","issue_number");