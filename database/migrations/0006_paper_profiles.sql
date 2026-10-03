CREATE TABLE "paper_signals" (
	"id" serial PRIMARY KEY NOT NULL,
	"time" timestamp with time zone NOT NULL,
	"symbol" varchar(32) NOT NULL,
	"profile" varchar(16) NOT NULL,
	"decision" varchar(8) NOT NULL,
	"stage" varchar(8) NOT NULL,
	"reasons" jsonb NOT NULL,
	"features" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "paper_ledger" ADD COLUMN "profile" varchar(16) DEFAULT 'V2' NOT NULL;--> statement-breakpoint
ALTER TABLE "paper_positions" ADD COLUMN "profile" varchar(16) DEFAULT 'V2' NOT NULL;--> statement-breakpoint
ALTER TABLE "paper_state" ADD COLUMN "profile" varchar(16) DEFAULT 'V2' NOT NULL;--> statement-breakpoint
ALTER TABLE "paper_trades" ADD COLUMN "profile" varchar(16) DEFAULT 'V2' NOT NULL;--> statement-breakpoint
CREATE INDEX "paper_signals_time_idx" ON "paper_signals" USING btree ("time");--> statement-breakpoint
CREATE INDEX "paper_signals_profile_idx" ON "paper_signals" USING btree ("profile","time");--> statement-breakpoint
CREATE INDEX "paper_ledger_profile_idx" ON "paper_ledger" USING btree ("profile","time");--> statement-breakpoint
CREATE INDEX "paper_trades_profile_idx" ON "paper_trades" USING btree ("profile");--> statement-breakpoint
ALTER TABLE "paper_state" ADD CONSTRAINT "paper_state_profile_unique" UNIQUE("profile");