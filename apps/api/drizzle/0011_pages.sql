CREATE TABLE "page_reference" (
	"page_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "page_reference_pkey" PRIMARY KEY("page_id","entity_type","entity_id"),
	CONSTRAINT "page_reference_entity_type_check" CHECK ("page_reference"."entity_type" in ('user', 'task', 'page'))
);
--> statement-breakpoint
CREATE TABLE "page" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text,
	"parent_id" text,
	"position" integer DEFAULT 0 NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"logo_kind" text,
	"logo_value" text,
	"access" text DEFAULT 'public' NOT NULL,
	"owner_id" text,
	"is_locked" boolean DEFAULT false NOT NULL,
	"locked_by_id" text,
	"locked_at" timestamp,
	"archived_at" timestamp,
	"is_full_width" boolean DEFAULT false NOT NULL,
	"content_yjs" "bytea",
	"content_markdown" text DEFAULT '' NOT NULL,
	"content_text" text DEFAULT '' NOT NULL,
	"content_version" integer DEFAULT 0 NOT NULL,
	"created_by_id" text,
	"updated_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "page_access_check" CHECK ("page"."access" in ('public', 'private')),
	CONSTRAINT "page_logo_check" CHECK (("page"."logo_kind" is null and "page"."logo_value" is null) or ("page"."logo_kind" in ('emoji', 'icon') and "page"."logo_value" is not null))
);
--> statement-breakpoint
CREATE TABLE "page_version" (
	"id" text PRIMARY KEY NOT NULL,
	"page_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"owner_id" text,
	"contributor_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"content_json" jsonb NOT NULL,
	"content_markdown" text DEFAULT '' NOT NULL,
	"last_saved_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "asset" ADD COLUMN "page_id" text;--> statement-breakpoint
ALTER TABLE "page_reference" ADD CONSTRAINT "page_reference_page_id_page_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."page"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "page_reference" ADD CONSTRAINT "page_reference_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "page" ADD CONSTRAINT "page_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "page" ADD CONSTRAINT "page_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "page" ADD CONSTRAINT "page_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "page" ADD CONSTRAINT "page_locked_by_id_user_id_fk" FOREIGN KEY ("locked_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "page" ADD CONSTRAINT "page_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "page" ADD CONSTRAINT "page_updated_by_id_user_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "page" ADD CONSTRAINT "page_parent_id_page_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."page"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "page_version" ADD CONSTRAINT "page_version_page_id_page_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."page"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "page_version" ADD CONSTRAINT "page_version_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "page_version" ADD CONSTRAINT "page_version_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "page_reference_entity_idx" ON "page_reference" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "page_project_parent_position_idx" ON "page" USING btree ("project_id","parent_id","position");--> statement-breakpoint
CREATE INDEX "page_workspace_idx" ON "page" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "page_owner_idx" ON "page" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "page_parent_idx" ON "page" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "page_lockedById_idx" ON "page" USING btree ("locked_by_id");--> statement-breakpoint
CREATE INDEX "page_createdById_idx" ON "page" USING btree ("created_by_id");--> statement-breakpoint
CREATE INDEX "page_updatedById_idx" ON "page" USING btree ("updated_by_id");--> statement-breakpoint
CREATE INDEX "page_version_page_saved_idx" ON "page_version" USING btree ("page_id","last_saved_at");--> statement-breakpoint
CREATE INDEX "page_version_ownerId_idx" ON "page_version" USING btree ("owner_id");--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_page_id_page_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."page"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "asset_pageId_idx" ON "asset" USING btree ("page_id");