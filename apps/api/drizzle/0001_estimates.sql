CREATE TABLE "estimate_point" (
	"id" text PRIMARY KEY NOT NULL,
	"estimate_id" text NOT NULL,
	"value" text NOT NULL,
	"numeric_value" double precision,
	"position" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "estimate" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "estimate_type_check" CHECK ("estimate"."type" in ('points', 'categories', 'time'))
);
--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "estimate_point_id" text;--> statement-breakpoint
ALTER TABLE "estimate_point" ADD CONSTRAINT "estimate_point_estimate_id_estimate_id_fk" FOREIGN KEY ("estimate_id") REFERENCES "public"."estimate"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "estimate" ADD CONSTRAINT "estimate_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "estimate" ADD CONSTRAINT "estimate_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "estimate_point_estimateId_position_idx" ON "estimate_point" USING btree ("estimate_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "estimate_project_name_unique" ON "estimate" USING btree ("project_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "estimate_project_active_unique" ON "estimate" USING btree ("project_id") WHERE "estimate"."is_active";--> statement-breakpoint
CREATE INDEX "estimate_createdBy_idx" ON "estimate" USING btree ("created_by");--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_estimate_point_id_estimate_point_id_fk" FOREIGN KEY ("estimate_point_id") REFERENCES "public"."estimate_point"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "task_estimatePointId_idx" ON "task" USING btree ("estimate_point_id");