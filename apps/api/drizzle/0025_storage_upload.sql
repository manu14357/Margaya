CREATE TABLE "storage_upload" (
	"object_key" text PRIMARY KEY NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "storage_upload_createdAt_idx" ON "storage_upload" USING btree ("created_at");