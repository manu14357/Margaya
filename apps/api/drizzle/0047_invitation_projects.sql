CREATE TABLE "invitation_project" (
	"invitation_id" text NOT NULL,
	"project_id" text NOT NULL,
	"role" text NOT NULL,
	"added_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "invitation_project_invitation_id_project_id_pk" PRIMARY KEY("invitation_id","project_id")
);
--> statement-breakpoint
ALTER TABLE "invitation_project" ADD CONSTRAINT "invitation_project_invitation_id_invitation_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."invitation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation_project" ADD CONSTRAINT "invitation_project_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "invitation_project" ADD CONSTRAINT "invitation_project_added_by_user_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invitation_project_projectId_idx" ON "invitation_project" USING btree ("project_id");