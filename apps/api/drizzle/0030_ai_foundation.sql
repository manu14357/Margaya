CREATE TABLE "ai_usage" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text,
	"agent_id" text,
	"run_id" text,
	"feature" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"tier" text NOT NULL,
	"data_tier" text NOT NULL,
	"status" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"cost_micros" bigint DEFAULT 0 NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_ai_setting" (
	"workspace_id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"provider" text,
	"secret" text,
	"secret_last4" text,
	"monthly_cap_micros" bigint,
	"user_daily_cap_tokens" integer,
	"require_approval_for_writes" boolean DEFAULT false NOT NULL,
	"include_restricted" boolean DEFAULT false NOT NULL,
	"local_only" boolean DEFAULT false NOT NULL,
	"redact_pii" boolean DEFAULT false NOT NULL,
	"embeddings_enabled" boolean DEFAULT false NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_ai_setting_secret_sealed_check" CHECK ("workspace_ai_setting"."secret" is null or "workspace_ai_setting"."secret" like 'sbx:v1:%'),
	CONSTRAINT "workspace_ai_setting_caps_check" CHECK (("workspace_ai_setting"."monthly_cap_micros" is null or "workspace_ai_setting"."monthly_cap_micros" >= 0) and ("workspace_ai_setting"."user_daily_cap_tokens" is null or "workspace_ai_setting"."user_daily_cap_tokens" >= 0))
);
--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "ai_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "workspace_ai_setting" ADD CONSTRAINT "workspace_ai_setting_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "workspace_ai_setting" ADD CONSTRAINT "workspace_ai_setting_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "ai_usage_workspace_created_idx" ON "ai_usage" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_usage_user_created_idx" ON "ai_usage" USING btree ("user_id","created_at");