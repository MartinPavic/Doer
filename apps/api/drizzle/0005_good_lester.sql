CREATE TABLE "task_calendar_link" (
	"task_id" uuid PRIMARY KEY NOT NULL,
	"calendar_id" uuid NOT NULL,
	"external_event_id" text NOT NULL,
	"etag" text,
	"last_synced_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "calendar" ADD COLUMN "writable" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "profile" ADD COLUMN "mirror_tasks" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "mirror" boolean;--> statement-breakpoint
ALTER TABLE "task_calendar_link" ADD CONSTRAINT "task_calendar_link_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_calendar_link" ADD CONSTRAINT "task_calendar_link_calendar_id_calendar_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."calendar"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "task_link_event_unique" ON "task_calendar_link" USING btree ("calendar_id","external_event_id");