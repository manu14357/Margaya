CREATE TABLE "webhook_delivery" (
	"id" text PRIMARY KEY NOT NULL,
	"webhook_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"event" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"project_id" text,
	"summary" text,
	"body" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"trigger" text DEFAULT 'event' NOT NULL,
	"redelivery_of" text,
	"coalesce_key" text,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 6 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_until" timestamp with time zone,
	"last_attempt_at" timestamp with time zone,
	"response_status" integer,
	"response_snippet" text,
	"error" text,
	"duration_ms" integer,
	"attempts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "workspace_webhook" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text,
	"url" text NOT NULL,
	"events" text[] DEFAULT ARRAY['*']::text[] NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"disabled_reason" text,
	"disabled_at" timestamp with time zone,
	"secret_ciphertext" text NOT NULL,
	"secret_last4" text NOT NULL,
	"previous_secret_ciphertext" text,
	"previous_secret_expires_at" timestamp with time zone,
	"secret_rotated_at" timestamp with time zone,
	"failure_streak" integer DEFAULT 0 NOT NULL,
	"failing_since" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_failure_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_webhook_workspace_url_unique" UNIQUE("workspace_id","url")
);
--> statement-breakpoint
ALTER TABLE "webhook_delivery" ADD CONSTRAINT "webhook_delivery_webhook_id_workspace_webhook_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."workspace_webhook"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "webhook_delivery" ADD CONSTRAINT "webhook_delivery_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "webhook_delivery" ADD CONSTRAINT "webhook_delivery_redelivery_of_fk" FOREIGN KEY ("redelivery_of") REFERENCES "public"."webhook_delivery"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "workspace_webhook" ADD CONSTRAINT "workspace_webhook_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "workspace_webhook" ADD CONSTRAINT "workspace_webhook_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "webhook_delivery_due_idx" ON "webhook_delivery" USING btree ("next_attempt_at") WHERE "webhook_delivery"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "webhook_delivery_lease_idx" ON "webhook_delivery" USING btree ("locked_until") WHERE "webhook_delivery"."status" = 'sending';--> statement-breakpoint
CREATE INDEX "webhook_delivery_log_idx" ON "webhook_delivery" USING btree ("webhook_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "webhook_delivery_created_idx" ON "webhook_delivery" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "webhook_delivery_workspace_idx" ON "webhook_delivery" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_delivery_coalesce_unique" ON "webhook_delivery" USING btree ("webhook_id","coalesce_key") WHERE "webhook_delivery"."status" = 'pending' and "webhook_delivery"."attempt_count" = 0 and "webhook_delivery"."coalesce_key" is not null;--> statement-breakpoint
CREATE INDEX "webhook_delivery_redelivery_of_idx" ON "webhook_delivery" USING btree ("redelivery_of");--> statement-breakpoint
CREATE INDEX "workspace_webhook_active_idx" ON "workspace_webhook" USING btree ("workspace_id") WHERE "workspace_webhook"."is_active";--> statement-breakpoint
CREATE INDEX "workspace_webhook_created_by_idx" ON "workspace_webhook" USING btree ("created_by");