CREATE TABLE "page_template" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text,
	"name" text NOT NULL,
	"logo_kind" text,
	"logo_value" text,
	"content_markdown" text DEFAULT '' NOT NULL,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "page_template_logo_check" CHECK (("page_template"."logo_kind" is null and "page_template"."logo_value" is null) or ("page_template"."logo_kind" in ('emoji', 'icon') and "page_template"."logo_value" is not null))
);
--> statement-breakpoint
ALTER TABLE "page" ADD COLUMN "public_token" text;--> statement-breakpoint
ALTER TABLE "page" ADD COLUMN "published_at" timestamp;--> statement-breakpoint
ALTER TABLE "page" ADD COLUMN "published_by_id" text;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "allow_public_pages" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "deletion_scheduled_at" timestamp;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "deletion_due_at" timestamp;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "deletion_scheduled_by_id" text;--> statement-breakpoint
ALTER TABLE "page_template" ADD CONSTRAINT "page_template_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "page_template" ADD CONSTRAINT "page_template_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "page_template" ADD CONSTRAINT "page_template_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "page_template_workspace_project_idx" ON "page_template" USING btree ("workspace_id","project_id");--> statement-breakpoint
CREATE INDEX "page_template_project_idx" ON "page_template" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "page_template_createdById_idx" ON "page_template" USING btree ("created_by_id");--> statement-breakpoint
ALTER TABLE "page" ADD CONSTRAINT "page_published_by_id_user_id_fk" FOREIGN KEY ("published_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "workspace" ADD CONSTRAINT "workspace_deletion_scheduled_by_id_user_id_fk" FOREIGN KEY ("deletion_scheduled_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "page" ADD CONSTRAINT "page_public_token_unique" UNIQUE("public_token");