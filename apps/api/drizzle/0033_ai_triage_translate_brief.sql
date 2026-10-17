CREATE TABLE "ai_brief" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"scope_type" text NOT NULL,
	"scope_id" text NOT NULL,
	"audience" text NOT NULL,
	"facts" jsonb NOT NULL,
	"page_id" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"shared_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ai_translation" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"comment_id" text,
	"task_id" text,
	"page_id" text,
	"target_locale" text NOT NULL,
	"content_hash" text NOT NULL,
	"source_language" text,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_translation_comment_locale_unique" UNIQUE("comment_id","target_locale"),
	CONSTRAINT "ai_translation_task_locale_unique" UNIQUE("task_id","target_locale"),
	CONSTRAINT "ai_translation_page_locale_unique" UNIQUE("page_id","target_locale"),
	CONSTRAINT "ai_translation_one_source_check" CHECK (num_nonnulls("ai_translation"."comment_id", "ai_translation"."task_id", "ai_translation"."page_id") = 1)
);
--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "ai_triage_auto_apply_labels" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_ai_setting" ADD COLUMN "auto_translate_comments" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_brief" ADD CONSTRAINT "ai_brief_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ai_brief" ADD CONSTRAINT "ai_brief_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ai_brief" ADD CONSTRAINT "ai_brief_page_id_page_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."page"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ai_brief" ADD CONSTRAINT "ai_brief_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ai_translation" ADD CONSTRAINT "ai_translation_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ai_translation" ADD CONSTRAINT "ai_translation_comment_id_activity_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."activity"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ai_translation" ADD CONSTRAINT "ai_translation_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ai_translation" ADD CONSTRAINT "ai_translation_page_id_page_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."page"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "ai_brief_scope_shared_idx" ON "ai_brief" USING btree ("scope_type","scope_id","shared_at");--> statement-breakpoint
CREATE INDEX "ai_brief_project_idx" ON "ai_brief" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "ai_translation_workspace_idx" ON "ai_translation" USING btree ("workspace_id");