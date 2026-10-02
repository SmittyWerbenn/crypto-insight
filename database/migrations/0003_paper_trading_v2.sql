CREATE TABLE "paper_ledger" (
	"id" serial PRIMARY KEY NOT NULL,
	"time" timestamp with time zone NOT NULL,
	"event" varchar(8) NOT NULL,
	"symbol" varchar(32),
	"amount" double precision NOT NULL,
	"cash" double precision NOT NULL,
	"invested" double precision NOT NULL,
	"realized_pnl" double precision NOT NULL,
	"unrealized_pnl" double precision NOT NULL,
	"equity" double precision NOT NULL,
	"open_positions" integer NOT NULL,
	"high_water_mark" double precision NOT NULL,
	"drawdown_pct" double precision NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paper_positions" (
	"id" varchar(16) PRIMARY KEY NOT NULL,
	"symbol" varchar(32) NOT NULL,
	"cluster" varchar(24) NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"planned_cost" double precision NOT NULL,
	"layers" jsonb NOT NULL,
	"tp" double precision NOT NULL,
	"sl" double precision NOT NULL,
	"timeout_at" timestamp with time zone NOT NULL,
	"atr_pct" double precision NOT NULL,
	"high" double precision NOT NULL,
	"low" double precision NOT NULL,
	"meta" jsonb NOT NULL,
	"last_bar_time" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paper_scans" (
	"id" serial PRIMARY KEY NOT NULL,
	"time" timestamp with time zone NOT NULL,
	"btc" jsonb,
	"scanned" integer NOT NULL,
	"signals" integer NOT NULL,
	"entries" jsonb NOT NULL,
	"skipped" jsonb NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "paper_state" (
	"id" integer PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"config" jsonb NOT NULL,
	"cash" double precision NOT NULL,
	"realized_pnl" double precision DEFAULT 0 NOT NULL,
	"high_water_mark" double precision NOT NULL,
	"max_drawdown_pct" double precision DEFAULT 0 NOT NULL,
	"seq" integer DEFAULT 0 NOT NULL,
	"last_scan_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paper_trades" (
	"id" varchar(16) PRIMARY KEY NOT NULL,
	"symbol" varchar(32) NOT NULL,
	"cluster" varchar(24) NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone NOT NULL,
	"qty" double precision NOT NULL,
	"avg_entry" double precision NOT NULL,
	"cost" double precision NOT NULL,
	"exit_price" double precision NOT NULL,
	"exit_reason" varchar(16) NOT NULL,
	"pnl" double precision NOT NULL,
	"pnl_pct" double precision NOT NULL,
	"hold_h" double precision NOT NULL,
	"mfe_pct" double precision NOT NULL,
	"mae_pct" double precision NOT NULL,
	"tp" double precision NOT NULL,
	"sl" double precision NOT NULL,
	"layers" jsonb NOT NULL,
	"meta" jsonb NOT NULL,
	"cash_after" double precision NOT NULL,
	"equity_after" double precision NOT NULL
);
--> statement-breakpoint
CREATE INDEX "paper_ledger_time_idx" ON "paper_ledger" USING btree ("time");--> statement-breakpoint
CREATE INDEX "paper_scans_time_idx" ON "paper_scans" USING btree ("time");--> statement-breakpoint
CREATE INDEX "paper_trades_closed_idx" ON "paper_trades" USING btree ("closed_at");