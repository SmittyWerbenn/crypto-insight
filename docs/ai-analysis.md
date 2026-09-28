# AI Analysis (Claude)

## Flow

```
Binance candles → indicators → score → risk/levels/scenarios → historical similarity
  → derivatives (Binance Futures) → Fear & Greed → news sentiment (optional)
  → structured context (JSON) → Claude (structured output) → Zod validation
  → consistency enforcement → store ai_analysis + signal + signal_features
```

`services/analysis/analysis.service.ts` builds the context (`buildCoinContext`). Every value in it comes from the backend: price, MAs, RSI, MACD state, ATR, Bollinger, volume change, support/resistance, levels, scenarios, similar-setup count, positive rate, forward-return medians, best/worst, derivatives, Fear & Greed, data-quality warnings.

## Model call (`services/claude/claude.service.ts`)

- SDK: `@anthropic-ai/sdk`, `client.beta.messages.create`.
- Model: `ANTHROPIC_MODEL` (default `claude-opus-5`), adaptive thinking, effort `ANTHROPIC_EFFORT` (default `medium`).
- Structured output: `output_config.format = { type: 'json_schema', schema }` (schemas in `schemas.ts`), then parsed and validated again with Zod.
- Server-side refusal fallbacks (`fallbacks: 'default'`, beta `server-side-fallback-2026-07-01`) for Opus 5 / Fable 5 models; disable with `ANTHROPIC_ENABLE_FALLBACKS=false`.
- `stop_reason` `refusal` / `max_tokens` → error; invalid JSON / schema mismatch → error; timeouts, rate limits, connection and API errors are mapped to typed `ClaudeError` codes.
- The API key is only read by the backend.

## System prompt (summary)

Only analyse the provided data; never invent price, volume, indicators, levels, historical statistics, backtest results, news or market data; no guarantees; separate facts / interpretation / historical evidence / scenarios / risks / uncertainty; technical score is not probability; AI confidence is not probability of profit; copy backend numbers exactly; cautious language; valid JSON. Prose language is set by `AI_LANGUAGE` (`id` = Bahasa Indonesia).

## Output schema (coin)

`marketCondition, signal, technicalScore, confidence (0–100 | null), confidenceRationale, summary, observedFacts[], technicalInterpretation, historicalEvidence, reasons[], risks[], uncertainty, historicalContext{sampleSize, positiveRate, medianReturn24h, medianReturn48h}, scenario{bullish{target, potential, explanation}, base{low, high, explanation}, bearish{target, potential, explanation}}`

Market summary: `marketCondition, headline, summary, btcTrend, altcoinTrend, breadth, volume, volatility, sentiment, derivatives, historicalContext, opportunities[], risks[], keyLevels[], confidence, uncertainty`.

## Consistency enforcement (`analysis/consistency.ts`)

After validation, backend-owned fields are overwritten with engine values (signal, score, historical context, scenario levels, market condition, key levels) and each replacement is reported in `consistencyWarnings`.

**AI confidence** means confidence in the quality and consistency of the current analytical setup given the available data. It is capped: data completeness < 0.8 → N/A; < 1 → max 50; insufficient historical sample → 50; limited → 65.

## Caching & cost control

- Result cached in Redis by `(symbol, timeframe, candle time, context hash)`, so the same context never triggers a second call.
- The 15-minute job reuses a stored AI analysis for the same closed candle, so each coin calls Claude at most once per candle (e.g. 6×/day per coin on 4H).
- Market summary: at most every `AI_MARKET_SUMMARY_MINUTES` (default 60).
- `GET /api/analysis/:symbol` never calls Claude; `POST` ("Analyze Now") does, and is rate-limited (10/min).

## Failure behaviour

Claude unavailable → "AI analysis temporarily unavailable. Technical market data is still available." plus the timestamp of the last successful AI analysis (which is still shown, labelled). No API key → "AI analysis not configured"; no placeholder text is generated outside `MOCK_MODE`.
