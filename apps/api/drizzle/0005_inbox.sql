CREATE TABLE "reaction" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"comment_id" text,
	"user_id" text NOT NULL,
	"emoji" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_mention" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"user_id" text NOT NULL,
	"comment_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_subscriber" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"user_id" text NOT NULL,
	"subscribed" boolean DEFAULT true NOT NULL,
	"reason" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "task_subscriber_task_user_unique" UNIQUE("task_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "workspace_id" text;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "actor_id" text;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "snoozed_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "resurfaced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_notification_preference" ADD COLUMN "task_update_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "reaction" ADD CONSTRAINT "reaction_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "reaction" ADD CONSTRAINT "reaction_comment_id_activity_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."activity"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "reaction" ADD CONSTRAINT "reaction_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "task_mention" ADD CONSTRAINT "task_mention_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "task_mention" ADD CONSTRAINT "task_mention_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "task_mention" ADD CONSTRAINT "task_mention_comment_id_activity_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."activity"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "task_subscriber" ADD CONSTRAINT "task_subscriber_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "task_subscriber" ADD CONSTRAINT "task_subscriber_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "reaction_task_user_emoji_unique" ON "reaction" USING btree ("task_id","user_id","emoji") WHERE "reaction"."comment_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "reaction_comment_user_emoji_unique" ON "reaction" USING btree ("comment_id","user_id","emoji") WHERE "reaction"."comment_id" is not null;--> statement-breakpoint
CREATE INDEX "reaction_taskId_createdAt_idx" ON "reaction" USING btree ("task_id","created_at");--> statement-breakpoint
CREATE INDEX "reaction_commentId_idx" ON "reaction" USING btree ("comment_id");--> statement-breakpoint
CREATE INDEX "reaction_userId_idx" ON "reaction" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "task_mention_description_unique" ON "task_mention" USING btree ("task_id","user_id") WHERE "task_mention"."comment_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "task_mention_comment_unique" ON "task_mention" USING btree ("comment_id","user_id") WHERE "task_mention"."comment_id" is not null;--> statement-breakpoint
CREATE INDEX "task_mention_taskId_idx" ON "task_mention" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "task_mention_userId_idx" ON "task_mention" USING btree ("user_id","task_id");--> statement-breakpoint
CREATE INDEX "task_mention_commentId_idx" ON "task_mention" USING btree ("comment_id");--> statement-breakpoint
CREATE INDEX "task_subscriber_userId_idx" ON "task_subscriber" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "notification_workspaceId_idx" ON "notification" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "notification_actorId_idx" ON "notification" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "notification_inbox_idx" ON "notification" USING btree ("user_id","workspace_id",coalesce("resurfaced_at", "created_at") desc,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notification_snoozedUntil_idx" ON "notification" USING btree ("snoozed_until") WHERE "notification"."snoozed_until" is not null;--> statement-breakpoint
CREATE INDEX "notification_resource_idx" ON "notification" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "notification_workspace_missing_idx" ON "notification" USING btree ("id") WHERE "notification"."workspace_id" is null and "notification"."resource_type" is not null;