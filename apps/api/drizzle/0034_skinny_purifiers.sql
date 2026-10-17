CREATE TABLE "agent" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"instructions" text DEFAULT '' NOT NULL,
	"model_tier" text DEFAULT 'balanced' NOT NULL,
	"provider_override" text,
	"owner_id" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"monthly_budget_micros" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "agent_model_tier_check" CHECK ("agent"."model_tier" in ('fast', 'balanced', 'deep')),
	CONSTRAINT "agent_budget_check" CHECK ("agent"."monthly_budget_micros" is null or "agent"."monthly_budget_micros" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ai_approval" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"step_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"requested_for_user_id" text NOT NULL,
	"tool_name" text NOT NULL,
	"args_preview" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_approval_step_unique" UNIQUE("step_id")
);
--> statement-breakpoint
CREATE TABLE "ai_run_step" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"seq" integer NOT NULL,
	"kind" text NOT NULL,
	"tool_name" text,
	"risk" text,
	"args" jsonb,
	"result_status" text NOT NULL,
	"result_ref" jsonb,
	"change" jsonb,
	"token_in" integer DEFAULT 0 NOT NULL,
	"token_out" integer DEFAULT 0 NOT NULL,
	"cost_micros" bigint DEFAULT 0 NOT NULL,
	"applied_at" timestamp with time zone,
	"reverted_at" timestamp with time zone,
	"reverted_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_run_step_run_seq_unique" UNIQUE("run_id","seq")
);
--> statement-breakpoint
CREATE TABLE "ai_run" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text,
	"task_id" text,
	"agent_id" text,
	"principal_user_id" text,
	"trigger" text NOT NULL,
	"trigger_ref" jsonb,
	"dedupe_key" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"locked_until" timestamp with time zone,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"input" jsonb,
	"output_summary" text,
	"error" text,
	"token_in" integer DEFAULT 0 NOT NULL,
	"token_out" integer DEFAULT 0 NOT NULL,
	"cost_micros" bigint DEFAULT 0 NOT NULL,
	"tool_calls" integer DEFAULT 0 NOT NULL,
	"api_key_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "ai_run_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "kind" text DEFAULT 'human' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent" ADD CONSTRAINT "agent_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "agent" ADD CONSTRAINT "agent_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "agent" ADD CONSTRAINT "agent_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ai_approval" ADD CONSTRAINT "ai_approval_run_id_ai_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ai_run"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ai_approval" ADD CONSTRAINT "ai_approval_step_id_ai_run_step_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."ai_run_step"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ai_approval" ADD CONSTRAINT "ai_approval_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ai_approval" ADD CONSTRAINT "ai_approval_requested_for_user_id_user_id_fk" FOREIGN KEY ("requested_for_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ai_approval" ADD CONSTRAINT "ai_approval_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ai_run_step" ADD CONSTRAINT "ai_run_step_run_id_ai_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ai_run"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ai_run_step" ADD CONSTRAINT "ai_run_step_reverted_by_user_id_fk" FOREIGN KEY ("reverted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ai_run" ADD CONSTRAINT "ai_run_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ai_run" ADD CONSTRAINT "ai_run_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ai_run" ADD CONSTRAINT "ai_run_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ai_run" ADD CONSTRAINT "ai_run_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ai_run" ADD CONSTRAINT "ai_run_principal_user_id_user_id_fk" FOREIGN KEY ("principal_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "agent_workspace_idx" ON "agent" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "ai_approval_requested_status_idx" ON "ai_approval" USING btree ("requested_for_user_id","status");--> statement-breakpoint
CREATE INDEX "ai_approval_workspace_status_idx" ON "ai_approval" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "ai_approval_status_expires_idx" ON "ai_approval" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "ai_run_status_locked_idx" ON "ai_run" USING btree ("status","locked_until");--> statement-breakpoint
CREATE INDEX "ai_run_workspace_created_idx" ON "ai_run" USING btree ("workspace_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ai_run_agent_created_idx" ON "ai_run" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_run_task_idx" ON "ai_run" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "ai_run_api_key_idx" ON "ai_run" USING btree ("api_key_id");--> statement-breakpoint
CREATE INDEX "user_kind_agent_idx" ON "user" USING btree ("kind") WHERE "user"."kind" = 'agent';--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_kind_check" CHECK ("user"."kind" in ('human', 'agent'));