CREATE TABLE "saved_view" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"filters" jsonb DEFAULT '{"version":1,"root":null,"archived":"exclude"}'::jsonb NOT NULL,
	"display" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"display_properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"access" text DEFAULT 'workspace' NOT NULL,
	"is_locked" boolean DEFAULT false NOT NULL,
	"owner_id" text,
	"locked_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "saved_view_access_check" CHECK ("saved_view"."access" in ('private', 'workspace'))
);
--> statement-breakpoint
ALTER TABLE "saved_view" ADD CONSTRAINT "saved_view_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "saved_view" ADD CONSTRAINT "saved_view_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "saved_view" ADD CONSTRAINT "saved_view_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "saved_view" ADD CONSTRAINT "saved_view_locked_by_user_id_fk" FOREIGN KEY ("locked_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "saved_view_workspace_project_idx" ON "saved_view" USING btree ("workspace_id","project_id");--> statement-breakpoint
CREATE INDEX "saved_view_projectId_idx" ON "saved_view" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "saved_view_ownerId_idx" ON "saved_view" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "saved_view_lockedBy_idx" ON "saved_view" USING btree ("locked_by");