CREATE TABLE "project_publication" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"link_token" text NOT NULL,
	"published_at" timestamp,
	"published_by" text,
	"layouts" jsonb DEFAULT '["board","list"]'::jsonb NOT NULL,
	"default_layout" text DEFAULT 'board' NOT NULL,
	"comments_enabled" boolean DEFAULT false NOT NULL,
	"reactions_enabled" boolean DEFAULT false NOT NULL,
	"votes_enabled" boolean DEFAULT false NOT NULL,
	"requests_enabled" boolean DEFAULT false NOT NULL,
	"allow_guests" boolean DEFAULT false NOT NULL,
	"show_assignees" boolean DEFAULT false NOT NULL,
	"show_backlog" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_publication_project_unique" UNIQUE("project_id"),
	CONSTRAINT "project_publication_link_token_unique" UNIQUE("link_token"),
	CONSTRAINT "project_publication_default_layout_check" CHECK ("project_publication"."default_layout" in ('board', 'list'))
);
--> statement-breakpoint
CREATE TABLE "public_board_block" (
	"project_id" text NOT NULL,
	"user_id" text NOT NULL,
	"blocked_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "public_board_block_pk" PRIMARY KEY("project_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "task_vote" (
	"task_id" text NOT NULL,
	"user_id" text NOT NULL,
	"value" smallint NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "task_vote_pk" PRIMARY KEY("task_id","user_id"),
	CONSTRAINT "task_vote_value_check" CHECK ("task_vote"."value" in (-1, 1))
);
--> statement-breakpoint
ALTER TABLE "activity" ADD COLUMN "visibility" text DEFAULT 'internal' NOT NULL;--> statement-breakpoint
ALTER TABLE "project_publication" ADD CONSTRAINT "project_publication_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "project_publication" ADD CONSTRAINT "project_publication_published_by_user_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "public_board_block" ADD CONSTRAINT "public_board_block_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "public_board_block" ADD CONSTRAINT "public_board_block_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "public_board_block" ADD CONSTRAINT "public_board_block_blocked_by_user_id_fk" FOREIGN KEY ("blocked_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "task_vote" ADD CONSTRAINT "task_vote_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "task_vote" ADD CONSTRAINT "task_vote_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "project_publication_published_by_idx" ON "project_publication" USING btree ("published_by");--> statement-breakpoint
CREATE INDEX "public_board_block_user_idx" ON "public_board_block" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "public_board_block_blocked_by_idx" ON "public_board_block" USING btree ("blocked_by");--> statement-breakpoint
CREATE INDEX "task_vote_user_idx" ON "task_vote" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "activity_public_comment_idx" ON "activity" USING btree ("task_id","created_at","id") WHERE "activity"."type" = 'comment' and "activity"."visibility" = 'public';--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_visibility_check" CHECK ("activity"."visibility" in ('internal', 'public'));