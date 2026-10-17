CREATE TABLE "a2a_task" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text,
	"api_key_id" text,
	"context_id" text NOT NULL,
	"skill" text NOT NULL,
	"ref_kind" text NOT NULL,
	"ref_id" text,
	"project_id" text,
	"final_state" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "allow_a2a" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "a2a_task" ADD CONSTRAINT "a2a_task_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "a2a_task" ADD CONSTRAINT "a2a_task_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "a2a_task" ADD CONSTRAINT "a2a_task_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "a2a_task_user_created_idx" ON "a2a_task" USING btree ("user_id","workspace_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "a2a_task_context_idx" ON "a2a_task" USING btree ("context_id");