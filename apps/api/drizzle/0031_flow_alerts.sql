CREATE TABLE "flow_alert" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"metric" text NOT NULL,
	"direction" text NOT NULL,
	"window_start" date NOT NULL,
	"window_end" date NOT NULL,
	"value" double precision NOT NULL,
	"baseline_median" double precision NOT NULL,
	"baseline_scale" double precision NOT NULL,
	"notified_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "flow_alert_project_metric_window_unique" UNIQUE("project_id","metric","window_start"),
	CONSTRAINT "flow_alert_metric_check" CHECK ("flow_alert"."metric" in ('wip', 'cycle_time', 'throughput')),
	CONSTRAINT "flow_alert_direction_check" CHECK ("flow_alert"."direction" in ('high', 'low'))
);
--> statement-breakpoint
ALTER TABLE "project_automation" ADD COLUMN "flow_alerts_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "project_automation" ADD COLUMN "flow_alerts_checked_on" date;--> statement-breakpoint
ALTER TABLE "project_automation" ADD COLUMN "last_flow_alert_at" timestamp;--> statement-breakpoint
ALTER TABLE "flow_alert" ADD CONSTRAINT "flow_alert_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "flow_alert" ADD CONSTRAINT "flow_alert_notified_user_id_user_id_fk" FOREIGN KEY ("notified_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "flow_alert_projectId_createdAt_idx" ON "flow_alert" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "flow_alert_notifiedUserId_idx" ON "flow_alert" USING btree ("notified_user_id");--> statement-breakpoint
CREATE INDEX "project_automation_flow_alerts_idx" ON "project_automation" USING btree ("flow_alerts_checked_on") WHERE "project_automation"."flow_alerts_enabled";