CREATE TABLE "scenario_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"trigger" varchar(16) NOT NULL,
	"status" varchar(16) NOT NULL,
	"fx_rate" double precision,
	"capital_idr" double precision NOT NULL,
	"config" jsonb NOT NULL,
	"result" jsonb,
	"error" text,
	"duration_ms" integer
);
--> statement-breakpoint
CREATE INDEX "scenario_runs_created_idx" ON "scenario_runs" USING btree ("created_at");