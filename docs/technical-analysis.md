# Technical Analysis Engine

All indicators live in `backend/src/services/technical/indicators.ts` and are pure, causal array functions (warm-up = `NaN`).

| Group | Indicators |
|---|---|
| Trend | SMA20/50/200, EMA20/50 (SMA-seeded), ADX(14) with +DI/−DI (Wilder) |
| Momentum | RSI(14, Wilder), MACD(12,26,9), Stochastic RSI(14,14,3,3), ROC(10) |
| Volatility | Bollinger(20, 2σ population) with %B and bandwidth, ATR(14, Wilder), annualised historical volatility (20-period log returns) |
| Volume | Volume MA(20), volume change vs MA, OBV and its 10-candle slope |
| Price action | Swing pivots (3 candles each side, known only after confirmation), HH/HL/LH/LL structure, 20-candle breakout/breakdown, clustered support/resistance from confirmed pivots (120-candle window, 0.6% tolerance) |

Reference tests: RSI against Wilder/StockCharts sample data, Bollinger against a known population σ, ATR on constant ranges, MACD identity, and prefix-vs-full causality.

## Technical score (0–100)

Configured in `backend/src/config/scoring.ts`:

| Component | Weight | Bullish reading |
|---|---|---|
| RSI | 15 | 60–70 best, 50–60 good, >80 or 30–40 weak |
| MACD | 20 | bullish cross = 1, histogram > 0 and rising = 0.85 |
| MA20 vs MA50 | 15 | MA20 > MA50 and price > MA20 |
| MA50 vs MA200 | 15 | MA50 > MA200 and price > MA50 |
| Volume | 10 | high volume on up candle, adjusted by OBV slope |
| Bollinger | 5 | %B between 0.5 and 0.9 |
| Momentum | 10 | ROC(10) and StochRSI K > D |
| Price action | 10 | HH/HL structure, breakout bonus, breakdown = 0 |

Each component gives a 0–1 value × weight. Unavailable components (warm-up) score neutral 0.5 and reduce `dataCompleteness`, which caps AI confidence.

| Score | Signal |
|---|---|
| 80–100 | STRONG BUY |
| 65–79 | BUY |
| 45–64 | HOLD |
| 30–44 | SELL / REDUCE |
| 0–29 | STRONG SELL |

**The score is a weighted checklist, not a probability.**

## Risk level

Points from annualised HV (>40/60/90%), RSI extremes (>75/<25), extension > 2 ATR from MA20 and recent breakdown → LOW / LOW_MEDIUM / MEDIUM / HIGH.

## Targets, stops and scenarios (`scoring/targets.ts`)

Long side (BUY/HOLD):
- **Stop** = nearest confirmed support − 0.25 ATR when that support is 0.5–3 ATR below price, otherwise price − 1.5 ATR.
- **Target** = first of {resistance levels, last swing high, upper Bollinger band} that gives R:R ≥ 1.5, otherwise price + max(3 ATR, 1.5 × risk).
- Upside `(target − price) / price × 100`; downside `(stop − price) / price × 100`.

Sell side: no upside is projected; the bearish target is the nearest support ≥ 1 ATR below price (or 3 ATR), invalidation above resistance.

Scenarios: bullish (break resistance with volume → next resistance), base (support–resistance range), bearish (lose support → next support). Claude only explains them.

## Historical similarity (`historical/similarity.ts`)

Current setup = {RSI, MACD histogram sign, price vs MA20, price vs MA50, volume vs average}. Matches: same booleans and RSI within ±7.5. Candidates must have their whole forward window closed **before** the evaluation candle, and matches within the outcome horizon of the previous match are skipped to reduce overlap.

Forward returns after 1, 3, 6, 12, 24 candles (plus the candle counts equal to 24H and 48H when they divide evenly), reported as average, median, best, worst and positive share. "Historical Positive Rate" = share of matches with a positive return after the outcome horizon (6 candles). It is labelled as historical behaviour, not probability.

Reliability: `< 10` insufficient, `< MIN_RELIABLE_SAMPLE` (30) limited, `< FULL_METRICS_SAMPLE` (100) moderate, otherwise good. Limited samples show "Limited historical sample. Performance statistics may be unreliable."
