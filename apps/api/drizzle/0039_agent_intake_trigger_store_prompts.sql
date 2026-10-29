ALTER TABLE "agent" ADD COLUMN "intake_trigger_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "agent" ADD COLUMN "intake_trigger_prompt" text;--> statement-breakpoint
ALTER TABLE "agent" ADD COLUMN "intake_trigger_by" text;--> statement-breakpoint
ALTER TABLE "ai_run_step" ADD COLUMN "output_text" text;--> statement-breakpoint
ALTER TABLE "agent" ADD CONSTRAINT "agent_intake_trigger_by_user_id_fk" FOREIGN KEY ("intake_trigger_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;