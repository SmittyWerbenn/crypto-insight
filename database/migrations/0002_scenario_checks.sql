CREATE TABLE "scenario_checks" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"symbol" varchar(32) NOT NULL,
	"tag" varchar(16) NOT NULL,
	"timeframe" varchar(8) NOT NULL,
	"basis" varchar(16) NOT NULL,
	"entry_price" double precision NOT NULL,
	"estimated_price" double precision NOT NULL,
	"estimated_return_pct" double precision NOT NULL,
	"hold_ms" bigint NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"status" varchar(16) DEFAULT 'PENDING' NOT NULL,
	"real_price" double precision,
	"real_return_pct" double precision,
	"diff_pct" double precision,
	"checked_at" timestamp with time zone,
	"note" text
);
--> statement-breakpoint
ALTER TABLE "scenario_checks" ADD CONSTRAINT "scenario_checks_run_id_scenario_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."scenario_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "scenario_checks_run_pick_idx" ON "scenario_checks" USING btree ("run_id","symbol","tag");--> statement-breakpoint
CREATE INDEX "scenario_checks_due_idx" ON "scenario_checks" USING btree ("status","due_at");