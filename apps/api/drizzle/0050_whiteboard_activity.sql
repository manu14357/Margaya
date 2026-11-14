CREATE TABLE "whiteboard_activity" (
	"id" text PRIMARY KEY NOT NULL,
	"whiteboard_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "whiteboard_activity" ADD CONSTRAINT "whiteboard_activity_whiteboard_id_whiteboard_id_fk" FOREIGN KEY ("whiteboard_id") REFERENCES "public"."whiteboard"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "whiteboard_activity" ADD CONSTRAINT "whiteboard_activity_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "whiteboard_activity" ADD CONSTRAINT "whiteboard_activity_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "whiteboard_activity_whiteboard_created_idx" ON "whiteboard_activity" USING btree ("whiteboard_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "whiteboard_activity_workspace_idx" ON "whiteboard_activity" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "whiteboard_activity_actor_idx" ON "whiteboard_activity" USING btree ("actor_id");