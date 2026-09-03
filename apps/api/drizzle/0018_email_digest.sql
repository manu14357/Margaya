CREATE TABLE "notification_email_queue" (
	"id" text PRIMARY KEY NOT NULL,
	"notification_id" text NOT NULL,
	"user_id" text NOT NULL,
	"claimed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_email_queue_notification_id_unique" UNIQUE("notification_id")
);
--> statement-breakpoint
ALTER TABLE "user_notification_preference" ADD COLUMN "digest_frequency" text DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_notification_preference" ADD COLUMN "digest_weekday" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_notification_preference" ADD COLUMN "digest_hour" integer DEFAULT 8 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_notification_preference" ADD COLUMN "last_digest_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notification_email_queue" ADD CONSTRAINT "notification_email_queue_notification_id_notification_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notification"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "notification_email_queue" ADD CONSTRAINT "notification_email_queue_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "notification_email_queue_user_created_idx" ON "notification_email_queue" USING btree ("user_id","created_at");