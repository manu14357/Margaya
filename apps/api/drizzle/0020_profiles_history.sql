CREATE TABLE "task_description_version" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"author_id" text,
	"content" text DEFAULT '' NOT NULL,
	"saved_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task_description_version" ADD CONSTRAINT "task_description_version_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "task_description_version" ADD CONSTRAINT "task_description_version_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "task_description_version_task_saved_idx" ON "task_description_version" USING btree ("task_id","saved_at");--> statement-breakpoint
CREATE INDEX "task_description_version_authorId_idx" ON "task_description_version" USING btree ("author_id");