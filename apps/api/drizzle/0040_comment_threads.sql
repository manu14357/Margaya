ALTER TABLE "activity" ADD COLUMN "parent_id" text;--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_parent_id_activity_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."activity"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "activity_parent_id_idx" ON "activity" USING btree ("parent_id") WHERE "activity"."parent_id" is not null;