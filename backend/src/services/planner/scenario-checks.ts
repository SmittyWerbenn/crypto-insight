import { and, asc, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import { getDb, isDbReady } from '../../db/client.js';
import { scenarioChecks, scenarioRuns } from '../../db/schema.js';
import { logger } from '../../utils/logger.js';
import { round } from '../../utils/math.js';
import { marketData } from '../binance/index.js';
import type { ScenarioRun } from './scenario.service.js';

export interface CheckPlan {
  runId: string;
  symbol: string;
  tag: string;
  timeframe: string;
  basis: 'ESTIMATED_HOLD' | 'MAX_HOLD';
  entryPrice: number;
  estimatedPrice: number;
  estimatedReturnPct: number;
  holdMs: number;
  dueAt: Date;
}

/** One check per pick: due at scan time + estimated hold (or the sell-by limit if no estimate exists). */
export function planChecks(run: Pick<ScenarioRun, 'id' | 'createdAt' | 'styles'>): CheckPlan[] {
  const scanTime = new Date(run.createdAt).getTime();
  return run.styles.flatMap((s) =>
    s.picks.map((p) => {
      const entry = p.scanPrice ?? p.entry;
      const holdMs = p.estimatedHoldMs ?? p.maxHoldMs;
      return {
        runId: run.id,
        symbol: p.symbol,
        tag: s.tag,
        timeframe: s.timeframe,
        basis: p.estimatedHoldMs !== null ? ('ESTIMATED_HOLD' as const) : ('MAX_HOLD' as const),
        entryPrice: entry,
        estimatedPrice: p.target,
        estimatedReturnPct: round(((p.target - entry) / entry) * 100, 3),
        holdMs,
        dueAt: new Date(scanTime + holdMs),
      };
    }),
  );
}

/** Real vs estimated at the due time. */
export function compareWithReal(entryPrice: number, estimatedPrice: number, realPrice: number) {
  return {
    realReturnPct: round(((realPrice - entryPrice) / entryPrice) * 100, 3),
    diffPct: round(((realPrice - estimatedPrice) / estimatedPrice) * 100, 3),
  };
}

export async function createChecksForRun(run: ScenarioRun): Promise<number> {
  if (!isDbReady() || run.status !== 'OK') return 0;
  const plans = planChecks(run);
  if (!plans.length) return 0;
  const rows = await getDb().insert(scenarioChecks).values(plans).onConflictDoNothing().returning({ id: scenarioChecks.id });
  return rows.length;
}

/** Real price at `at`: open of the 1-minute candle starting at that minute (works retroactively). */
async function priceAt(symbol: string, at: number): Promise<number | null> {
  const minute = Math.floor(at / 60_000) * 60_000;
  const [c] = await marketData.klines(symbol, '1m', { startTime: minute, limit: 1 });
  return c && c.openTime - minute < 5 * 60_000 ? c.open : null;
}

/** Record the real price for every check whose due time has passed. */
export async function processDueChecks(now = Date.now()): Promise<{ done: number; failed: number }> {
  if (!isDbReady()) return { done: 0, failed: 0 };
  const db = getDb();
  const due = await db
    .select()
    .from(scenarioChecks)
    .where(and(eq(scenarioChecks.status, 'PENDING'), lte(scenarioChecks.dueAt, new Date(now))))
    .orderBy(asc(scenarioChecks.dueAt))
    .limit(100);
  let done = 0;
  let failed = 0;
  for (const c of due) {
    try {
      const real = await priceAt(c.symbol, c.dueAt.getTime());
      if (real === null) {
        // Data for that minute not available (yet); give up after 7 days
        if (now - c.dueAt.getTime() > 7 * 86_400_000) {
          await db.update(scenarioChecks).set({ status: 'FAILED', checkedAt: new Date(), note: 'Harga pada waktu cek tidak tersedia dari Binance.' }).where(eq(scenarioChecks.id, c.id));
          failed++;
        }
        continue;
      }
      const cmp = compareWithReal(c.entryPrice, c.estimatedPrice, real);
      await db
        .update(scenarioChecks)
        .set({ status: 'DONE', realPrice: real, realReturnPct: cmp.realReturnPct, diffPct: cmp.diffPct, checkedAt: new Date() })
        .where(eq(scenarioChecks.id, c.id));
      done++;
    } catch (e) {
      logger.warn({ id: c.id, symbol: c.symbol, err: (e as Error).message }, 'Scenario check failed, will retry');
    }
  }
  if (done || failed) logger.info({ done, failed }, 'Scenario checks updated');
  return { done, failed };
}

/** Create checks for recent scans that predate this feature. */
export async function backfillChecks(loadRun: (id: string) => Promise<ScenarioRun>): Promise<number> {
  if (!isDbReady()) return 0;
  const db = getDb();
  const runs = await db
    .select({ id: scenarioRuns.id })
    .from(scenarioRuns)
    .where(and(eq(scenarioRuns.status, 'OK'), sql`not exists (select 1 from ${scenarioChecks} where ${scenarioChecks.runId} = ${scenarioRuns.id})`))
    .orderBy(desc(scenarioRuns.createdAt))
    .limit(50);
  let created = 0;
  for (const r of runs) created += await createChecksForRun(await loadRun(r.id));
  return created;
}

export type ScenarioCheck = typeof scenarioChecks.$inferSelect;

export async function checksForRuns(runIds: string[]): Promise<ScenarioCheck[]> {
  if (!isDbReady() || !runIds.length) return [];
  return getDb().select().from(scenarioChecks).where(inArray(scenarioChecks.runId, runIds));
}

/** Accuracy summary of estimated vs real prices. */
export function summarizeChecks(checks: ScenarioCheck[]) {
  const done = checks.filter((c) => c.status === 'DONE');
  const avg = (xs: number[]) => (xs.length ? round(xs.reduce((a, b) => a + b, 0) / xs.length, 2) : null);
  return {
    total: checks.length,
    done: done.length,
    pending: checks.filter((c) => c.status === 'PENDING').length,
    reachedEstimate: done.filter((c) => (c.realPrice ?? 0) >= c.estimatedPrice).length,
    averageDiffPct: avg(done.map((c) => c.diffPct ?? 0)),
    averageEstimatedReturnPct: avg(done.map((c) => c.estimatedReturnPct)),
    averageRealReturnPct: avg(done.map((c) => c.realReturnPct ?? 0)),
    nextDueAt: checks.filter((c) => c.status === 'PENDING').sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())[0]?.dueAt.toISOString() ?? null,
  };
}
