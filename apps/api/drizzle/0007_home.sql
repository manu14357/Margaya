CREATE TABLE "home_preference" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"widgets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "home_preference_user_workspace_unique" UNIQUE("user_id","workspace_id")
);
--> statement-breakpoint
CREATE TABLE "quick_link" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"url" text NOT NULL,
	"title" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "quick_link_user_workspace_url_unique" UNIQUE("user_id","workspace_id","url")
);
--> statement-breakpoint
CREATE TABLE "sticky" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"content_text" text DEFAULT '' NOT NULL,
	"color" text DEFAULT 'yellow' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "home_preference" ADD CONSTRAINT "home_preference_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "home_preference" ADD CONSTRAINT "home_preference_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "quick_link" ADD CONSTRAINT "quick_link_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "quick_link" ADD CONSTRAINT "quick_link_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "sticky" ADD CONSTRAINT "sticky_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "sticky" ADD CONSTRAINT "sticky_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "home_preference_workspaceId_idx" ON "home_preference" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "quick_link_user_workspace_created_idx" ON "quick_link" USING btree ("user_id","workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "quick_link_workspaceId_idx" ON "quick_link" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "sticky_user_workspace_position_idx" ON "sticky" USING btree ("user_id","workspace_id","position","id");--> statement-breakpoint
CREATE INDEX "sticky_workspaceId_idx" ON "sticky" USING btree ("workspace_id");