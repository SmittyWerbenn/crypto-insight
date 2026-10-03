# Paper Trading V2 — research harness

Reproduces the research behind `src/services/paper/` (see `docs/paper-trading-v2.md`).
It replays the production scoring/feature code on historical Binance candles and simulates exits on 5-minute candles.

```bash
cd backend/scripts/paper-research
mkdir -p data/k1h data/k5m
(cd data && node ../fetch.mjs 1h 2024-11-01T00:00:00Z k1h && node ../fetch.mjs 5m 2025-01-01T00:00:00Z k5m)  # ~4M candles, ~10 min
cd ../.. && npx tsx scripts/paper-research/final.ts   # writes data/report.json
```

- `lib.ts` — features per 1h candle (cached in `data/cands.json`), per-trade 5m exit simulation, train/valid/test splits.
- `pf.ts` — Rp1.000.000 portfolio simulation using the real `PaperPortfolio` + `entryCheck`.
- `explore-*.ts` — the exploration steps (entry families, BTC filters, exit grid) used to pick the rules.
- `final.ts` — old vs V2 per period, robustness grid, full equity curve, daily/per-asset/trade log.
- `profiles.ts` — the three profiles (Aman/Menengah/Agresif): funnel, rejection reasons, utilization, threshold evidence (writes `data/profiles-report.json` → `src/services/paper/research-profiles.data.ts`).

Splits: train 2025-01-01…2025-12-31, validation 2026-01-01…2026-06-30, test 2026-07-01…2026-10-02.
Parameters were chosen on train (+ checked on validation); the test period was only used for the final check.
