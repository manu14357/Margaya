CREATE TABLE "page_comment" (
	"id" text PRIMARY KEY NOT NULL,
	"page_id" text NOT NULL,
	"user_id" text,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "page_subscriber" (
	"id" text PRIMARY KEY NOT NULL,
	"page_id" text NOT NULL,
	"user_id" text NOT NULL,
	"subscribed" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "page_subscriber_page_user_unique" UNIQUE("page_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "page" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "page" ADD COLUMN "deleted_by_id" text;--> statement-breakpoint
ALTER TABLE "page_comment" ADD CONSTRAINT "page_comment_page_id_page_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."page"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "page_comment" ADD CONSTRAINT "page_comment_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "page_subscriber" ADD CONSTRAINT "page_subscriber_page_id_page_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."page"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "page_subscriber" ADD CONSTRAINT "page_subscriber_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "page_comment_page_created_idx" ON "page_comment" USING btree ("page_id","created_at");--> statement-breakpoint
CREATE INDEX "page_comment_user_idx" ON "page_comment" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "page_subscriber_userId_idx" ON "page_subscriber" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "page" ADD CONSTRAINT "page_deleted_by_id_user_id_fk" FOREIGN KEY ("deleted_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "page_deletedById_idx" ON "page" USING btree ("deleted_by_id");--> statement-breakpoint
CREATE INDEX "page_projectId_deletedAt_idx" ON "page" USING btree ("project_id","deleted_at") WHERE "page"."deleted_at" is not null;