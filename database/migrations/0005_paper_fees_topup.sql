ALTER TABLE "paper_state" ADD COLUMN "deposits" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "paper_state" ADD COLUMN "fees_paid" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "paper_trades" ADD COLUMN "fees" double precision DEFAULT 0 NOT NULL;