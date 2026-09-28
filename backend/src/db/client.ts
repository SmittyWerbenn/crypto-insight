import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import * as schema from './schema.js';

let pool: pg.Pool | null = null;
let db: NodePgDatabase<typeof schema> | null = null;
let healthy = false;

export function getDb(): NodePgDatabase<typeof schema> {
  if (!db) throw new Error('Database not initialised');
  return db;
}

export const isDbReady = () => healthy;

export async function initDb(): Promise<boolean> {
  if (!env.DATABASE_URL) {
    logger.warn('DATABASE_URL not set — persistence disabled');
    return false;
  }
  pool = new pg.Pool({
    connectionString: env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 60_000,
    ssl: env.DATABASE_URL.includes('sslmode=require') ? { rejectUnauthorized: true } : undefined,
  });
  pool.on('error', (e) => logger.error({ err: e }, 'Postgres pool error'));
  db = drizzle(pool, { schema });
  try {
    await pool.query('select 1');
    healthy = true;
  } catch (e) {
    logger.error({ err: e }, 'Postgres unreachable');
    healthy = false;
  }
  return healthy;
}

export async function closeDb() {
  await pool?.end();
}

export { schema };
