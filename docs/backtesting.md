# Backtesting

## Execution model (`backend/src/services/backtest/engine.ts`)

For every candle *T*:

1. Orders decided at the close of *T−1* are filled at the **open of T**: buy at `open × (1 + slippage)`, sell at `price × (1 − slippage)`; fee = notional × fee on both sides.
2. Stop-loss / take-profit are checked against *T*'s high/low. A gap through a level fills at the open (worse for stops). If both levels fall inside one candle, lower-timeframe candles decide the order (15m for 4H, 1m for 15m, …). If still ambiguous, the trade is conservatively closed at the stop and flagged `ambiguous`.
3. Equity is marked to market at *T*'s close; drawdown is measured from the running peak.
4. The strategy evaluates *T* through a `StrategyContext` that only exposes candles/snapshots/scores at offsets ≥ 0 (past). Asking for the future throws `LookAheadError`.

Positions are long-only, one at a time, sized as a fraction of current equity. Open positions are closed at the end of the test window. Indicator warm-up uses 250 candles before the start date (past data only).

### Look-ahead tests (`lookahead.test.ts`)
- Day 1 = 100, Day 2 = 110, Day 3 = 90: the Day-1 decision can only see 100.
- Strategies reading `candle(-1)` / `snapshot(-2)` throw.
- Replacing all data after *T* with ×3 prices leaves every trade, equity point and signal count up to *T* unchanged, for all strategies.
- Indicator series computed on full history equal those computed on the prefix at every *T*; pivots known by *T* are identical.
- Every entry fills on the candle after its signal.
- Historical similarity at *T* ignores data after *T*.

## Strategies (`strategies/`)

| id | Entry | Exit |
|---|---|---|
| `ma-rsi-macd` (CryptoInsight AI Technical Strategy) | price > MA fast > MA slow, MACD hist > 0, RSI in [rsiMin, rsiMax], volume > volumeMultiplier × avg, score ≥ entryScore | score < exitScore, or bearish MACD cross, or SL/TP |
| `trend-following` | EMA20 > EMA50, price > MA200, ADX ≥ adxMin, 20-candle breakout | close < EMA50 or EMA20 < EMA50 |
| `momentum` | RSI crosses above 50, ROC > rocMin, StochRSI K > D | RSI < rsiExit or ROC < 0 |

Add a strategy by extending `BaseStrategy` and registering it in `strategies/index.ts`; implement `evaluate(candle, context)`.

## Metrics (`metrics.ts`)

Initial/final capital, net profit, ROI, CAGR, trades, wins/losses, win rate, average win/loss ($ and %), profit factor, expectancy, max drawdown, Sharpe and Sortino (per-candle returns annualised by timeframe), Calmar (CAGR / |MaxDD|), largest win/loss, average holding time, total fees, total slippage, max consecutive losses, 95% historical VaR (per candle), exposure, ambiguous trades, buy-and-hold ROI, average MFE/MAE. Also monthly returns, signal distribution (score band of every evaluated candle) and breakdown by market regime (bull/bear/sideways from MA50/MA200 at signal time; high/low volatility vs the 100-candle HV median).

Per trade: entry/exit time and price, quantity, gross P&L, fees, slippage, net P&L, return, holding time, exit reason, **MFE** and **MAE**.

## Modes

| Mode | Behaviour |
|---|---|
| `standard` | Single run over the period |
| `out-of-sample` | Time split (default 70/30). Same parameters run on both windows; compared side-by-side |
| `optimization` | Grid search on the **in-sample window only** (objective: Sharpe, ROI or profit factor, min trades), then one run on the out-of-sample window with the chosen parameters |
| `walk-forward` | Rolling windows (default 90 d train / 30 d test, step = test). Optional per-window optimisation on train only. Test windows are compounded into one out-of-sample equity curve |
| `matrix` | Same settings across several coins × timeframes (performance by coin / timeframe) |

Search space is `min..max` by `step` per parameter; at most 6 parameters, and the number of combinations is capped (`maxCombinations`, hard limit 500) and reported. Structurally invalid combos (fast ≥ slow MA, rsiMin ≥ rsiMax) are skipped and counted.

**Overfitting warning** when: profitable in-sample but losing out-of-sample; Sharpe falls below 40% of in-sample; win rate drops > 15 points. Fewer than 10 out-of-sample trades is reported as low statistical power.

## Monte Carlo

1,000 bootstrap resamples (seeded, reproducible) of the per-trade equity returns → median / 5th / 95th percentile ending capital, median and 5th-percentile max drawdown, probability of drawdown beyond X%, probability of ending below initial capital. A simulation of the past return distribution, not a forecast.

## Data quality

Before every run: duplicates removed, invalid OHLC dropped, gaps counted, zero-volume and > 50× median volume spikes flagged. If missing + invalid candles exceed 5% the backtest **fails** with "Data quality warning"; smaller issues are listed in the result warnings and logged.

## Jobs

`POST /api/backtest` returns `202 {jobId}`. Jobs run on a BullMQ queue (Redis) with concurrency 2, or an in-process queue when Redis is unavailable. Poll `GET /api/backtest/:id` for `QUEUED | RUNNING | COMPLETED | FAILED` and `progress`.
