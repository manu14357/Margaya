CREATE TABLE "whiteboard_asset" (
	"id" text PRIMARY KEY NOT NULL,
	"whiteboard_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"object_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"size" integer NOT NULL,
	"width" integer,
	"height" integer,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "whiteboard_asset_object_key_unique" UNIQUE("object_key")
);
--> statement-breakpoint
CREATE TABLE "whiteboard" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"icon" text,
	"is_locked" boolean DEFAULT false NOT NULL,
	"locked_by_id" text,
	"locked_at" timestamp,
	"archived_at" timestamp,
	"deleted_at" timestamp,
	"deleted_by_id" text,
	"public_token" text,
	"published_at" timestamp,
	"published_by_id" text,
	"content_yjs" "bytea",
	"content_text" text DEFAULT '' NOT NULL,
	"element_count" integer DEFAULT 0 NOT NULL,
	"content_version" integer DEFAULT 0 NOT NULL,
	"created_by_id" text,
	"updated_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "whiteboard_public_token_unique" UNIQUE("public_token")
);
--> statement-breakpoint
CREATE TABLE "whiteboard_task_link" (
	"whiteboard_id" text NOT NULL,
	"task_id" text NOT NULL,
	CONSTRAINT "whiteboard_task_link_whiteboard_id_task_id_pk" PRIMARY KEY("whiteboard_id","task_id")
);
--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "whiteboards_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "whiteboard_asset" ADD CONSTRAINT "whiteboard_asset_whiteboard_id_whiteboard_id_fk" FOREIGN KEY ("whiteboard_id") REFERENCES "public"."whiteboard"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "whiteboard_asset" ADD CONSTRAINT "whiteboard_asset_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "whiteboard_asset" ADD CONSTRAINT "whiteboard_asset_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "whiteboard" ADD CONSTRAINT "whiteboard_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "whiteboard" ADD CONSTRAINT "whiteboard_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "whiteboard" ADD CONSTRAINT "whiteboard_locked_by_id_user_id_fk" FOREIGN KEY ("locked_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "whiteboard" ADD CONSTRAINT "whiteboard_deleted_by_id_user_id_fk" FOREIGN KEY ("deleted_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "whiteboard" ADD CONSTRAINT "whiteboard_published_by_id_user_id_fk" FOREIGN KEY ("published_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "whiteboard" ADD CONSTRAINT "whiteboard_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "whiteboard" ADD CONSTRAINT "whiteboard_updated_by_id_user_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "whiteboard_task_link" ADD CONSTRAINT "whiteboard_task_link_whiteboard_id_whiteboard_id_fk" FOREIGN KEY ("whiteboard_id") REFERENCES "public"."whiteboard"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "whiteboard_task_link" ADD CONSTRAINT "whiteboard_task_link_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "whiteboard_asset_whiteboard_idx" ON "whiteboard_asset" USING btree ("whiteboard_id");--> statement-breakpoint
CREATE INDEX "whiteboard_asset_workspace_idx" ON "whiteboard_asset" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "whiteboard_asset_createdById_idx" ON "whiteboard_asset" USING btree ("created_by_id");--> statement-breakpoint
CREATE INDEX "whiteboard_projectId_archivedAt_idx" ON "whiteboard" USING btree ("project_id","archived_at");--> statement-breakpoint
CREATE INDEX "whiteboard_workspace_idx" ON "whiteboard" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "whiteboard_deletedAt_idx" ON "whiteboard" USING btree ("deleted_at") WHERE "whiteboard"."deleted_at" is not null;--> statement-breakpoint
CREATE INDEX "whiteboard_lockedById_idx" ON "whiteboard" USING btree ("locked_by_id");--> statement-breakpoint
CREATE INDEX "whiteboard_createdById_idx" ON "whiteboard" USING btree ("created_by_id");--> statement-breakpoint
CREATE INDEX "whiteboard_updatedById_idx" ON "whiteboard" USING btree ("updated_by_id");--> statement-breakpoint
CREATE INDEX "whiteboard_deletedById_idx" ON "whiteboard" USING btree ("deleted_by_id");--> statement-breakpoint
CREATE INDEX "whiteboard_publishedById_idx" ON "whiteboard" USING btree ("published_by_id");--> statement-breakpoint
CREATE INDEX "whiteboard_task_link_task_idx" ON "whiteboard_task_link" USING btree ("task_id");