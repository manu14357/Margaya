CREATE TABLE "instance_setting" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb,
	"secret" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "instance_setting_one_value_check" CHECK (("instance_setting"."value" is null) <> ("instance_setting"."secret" is null))
);
--> statement-breakpoint
ALTER TABLE "instance_setting" ADD CONSTRAINT "instance_setting_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "instance_setting_updated_by_idx" ON "instance_setting" USING btree ("updated_by");