CREATE TABLE "ai_analysis" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"symbol" varchar(32) NOT NULL,
	"timeframe" varchar(8) NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"candle_time" bigint,
	"kind" varchar(16) NOT NULL,
	"model" varchar(64),
	"status" varchar(16) NOT NULL,
	"context" jsonb NOT NULL,
	"result" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"symbol" varchar(32) NOT NULL,
	"type" varchar(24) NOT NULL,
	"value" double precision,
	"active" boolean DEFAULT true NOT NULL,
	"triggered_at" timestamp with time zone,
	"triggered_value" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backtest_equity" (
	"backtest_id" uuid NOT NULL,
	"time" bigint NOT NULL,
	"equity" double precision NOT NULL,
	"peak" double precision NOT NULL,
	"drawdown_pct" double precision NOT NULL,
	CONSTRAINT "backtest_equity_backtest_id_time_pk" PRIMARY KEY("backtest_id","time")
);
--> statement-breakpoint
CREATE TABLE "backtest_metrics" (
	"backtest_id" uuid PRIMARY KEY NOT NULL,
	"metrics" jsonb NOT NULL,
	"roi" double precision,
	"win_rate" double precision,
	"profit_factor" double precision,
	"max_drawdown" double precision,
	"sharpe" double precision,
	"total_trades" integer
);
--> statement-breakpoint
CREATE TABLE "backtest_trades" (
	"id" serial PRIMARY KEY NOT NULL,
	"backtest_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backtests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"status" varchar(16) NOT NULL,
	"mode" varchar(24) DEFAULT 'standard' NOT NULL,
	"symbol" varchar(32) NOT NULL,
	"timeframe" varchar(8) NOT NULL,
	"strategy" varchar(64) NOT NULL,
	"request" jsonb NOT NULL,
	"result" jsonb,
	"error" text,
	"progress" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "coins" (
	"symbol" varchar(32) PRIMARY KEY NOT NULL,
	"base_asset" varchar(16) NOT NULL,
	"quote_asset" varchar(16) NOT NULL,
	"name" varchar(120),
	"status" varchar(32),
	"tracked" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "news" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"source" varchar(120),
	"published_at" timestamp with time zone NOT NULL,
	"coins" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sentiment" varchar(16),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ohlcv" (
	"symbol" varchar(32) NOT NULL,
	"timeframe" varchar(8) NOT NULL,
	"open_time" bigint NOT NULL,
	"close_time" bigint NOT NULL,
	"open" double precision NOT NULL,
	"high" double precision NOT NULL,
	"low" double precision NOT NULL,
	"close" double precision NOT NULL,
	"volume" double precision NOT NULL,
	"quote_volume" double precision,
	"trades" integer,
	CONSTRAINT "ohlcv_symbol_timeframe_open_time_pk" PRIMARY KEY("symbol","timeframe","open_time")
);
--> statement-breakpoint
CREATE TABLE "portfolio" (
	"user_id" uuid NOT NULL,
	"symbol" varchar(32) NOT NULL,
	"quantity" double precision NOT NULL,
	"average_buy_price" double precision NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portfolio_user_id_symbol_pk" PRIMARY KEY("user_id","symbol")
);
--> statement-breakpoint
CREATE TABLE "portfolio_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"symbol" varchar(32) NOT NULL,
	"side" varchar(4) NOT NULL,
	"quantity" double precision NOT NULL,
	"price" double precision NOT NULL,
	"executed_at" timestamp with time zone NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sentiment" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" varchar(64) NOT NULL,
	"symbol" varchar(32),
	"timestamp" timestamp with time zone NOT NULL,
	"value" double precision NOT NULL,
	"classification" varchar(32),
	"data" jsonb
);
--> statement-breakpoint
CREATE TABLE "signal_features" (
	"signal_id" uuid PRIMARY KEY NOT NULL,
	"symbol" varchar(32) NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"price" double precision NOT NULL,
	"rsi" double precision,
	"macd" double precision,
	"macd_histogram" double precision,
	"macd_state" varchar(16),
	"ma20" double precision,
	"ma50" double precision,
	"ma200" double precision,
	"volume" double precision,
	"volume_change" double precision,
	"atr" double precision,
	"bollinger_position" double precision,
	"technical_score" double precision NOT NULL,
	"support" double precision,
	"resistance" double precision,
	"funding_rate" double precision,
	"open_interest" double precision,
	"fear_greed" integer,
	"market_condition" varchar(32),
	"regime" varchar(16),
	"volatility_regime" varchar(8)
);
--> statement-breakpoint
CREATE TABLE "signal_results" (
	"signal_id" uuid PRIMARY KEY NOT NULL,
	"symbol" varchar(32) NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"status" varchar(16) NOT NULL,
	"entry_price" double precision NOT NULL,
	"target_price" double precision NOT NULL,
	"stop_price" double precision NOT NULL,
	"exit_price" double precision,
	"entry_time" timestamp with time zone NOT NULL,
	"exit_time" timestamp with time zone,
	"return_percent" double precision,
	"max_favorable_excursion" double precision,
	"max_adverse_excursion" double precision,
	"candles_evaluated" integer DEFAULT 0 NOT NULL,
	"note" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"symbol" varchar(32) NOT NULL,
	"timeframe" varchar(8) NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"candle_time" bigint NOT NULL,
	"signal" varchar(16) NOT NULL,
	"technical_score" double precision NOT NULL,
	"ai_confidence" double precision,
	"direction" varchar(20) NOT NULL,
	"entry_price" double precision NOT NULL,
	"target_price" double precision NOT NULL,
	"stop_price" double precision NOT NULL,
	"market_condition" varchar(32),
	"analysis_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "strategies" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text,
	"default_params" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "technical_indicators" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" varchar(32) NOT NULL,
	"timeframe" varchar(8) NOT NULL,
	"timestamp" bigint NOT NULL,
	"technical_score" double precision,
	"signal" varchar(16),
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"name" varchar(120),
	"timezone" varchar(64) DEFAULT 'Asia/Jakarta' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "watchlists" (
	"user_id" uuid NOT NULL,
	"symbol" varchar(32) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "watchlists_user_id_symbol_pk" PRIMARY KEY("user_id","symbol")
);
--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backtest_equity" ADD CONSTRAINT "backtest_equity_backtest_id_backtests_id_fk" FOREIGN KEY ("backtest_id") REFERENCES "public"."backtests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backtest_metrics" ADD CONSTRAINT "backtest_metrics_backtest_id_backtests_id_fk" FOREIGN KEY ("backtest_id") REFERENCES "public"."backtests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backtest_trades" ADD CONSTRAINT "backtest_trades_backtest_id_backtests_id_fk" FOREIGN KEY ("backtest_id") REFERENCES "public"."backtests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio" ADD CONSTRAINT "portfolio_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_transactions" ADD CONSTRAINT "portfolio_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_features" ADD CONSTRAINT "signal_features_signal_id_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_results" ADD CONSTRAINT "signal_results_signal_id_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlists" ADD CONSTRAINT "watchlists_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_analysis_symbol_ts_idx" ON "ai_analysis" USING btree ("symbol","timestamp");--> statement-breakpoint
CREATE INDEX "alerts_active_idx" ON "alerts" USING btree ("active","symbol");--> statement-breakpoint
CREATE INDEX "backtest_trades_backtest_idx" ON "backtest_trades" USING btree ("backtest_id");--> statement-breakpoint
CREATE INDEX "backtests_created_idx" ON "backtests" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "market_snapshots_ts_idx" ON "market_snapshots" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "news_published_idx" ON "news" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "portfolio_tx_user_idx" ON "portfolio_transactions" USING btree ("user_id","symbol");--> statement-breakpoint
CREATE UNIQUE INDEX "sentiment_source_ts_idx" ON "sentiment" USING btree ("source","timestamp");--> statement-breakpoint
CREATE INDEX "signal_results_symbol_ts_idx" ON "signal_results" USING btree ("symbol","timestamp");--> statement-breakpoint
CREATE INDEX "signal_results_status_idx" ON "signal_results" USING btree ("status");--> statement-breakpoint
CREATE INDEX "signals_symbol_ts_idx" ON "signals" USING btree ("symbol","timestamp");--> statement-breakpoint
CREATE UNIQUE INDEX "signals_sym_tf_candle_idx" ON "signals" USING btree ("symbol","timeframe","candle_time");--> statement-breakpoint
CREATE UNIQUE INDEX "technical_indicators_sym_tf_ts_idx" ON "technical_indicators" USING btree ("symbol","timeframe","timestamp");