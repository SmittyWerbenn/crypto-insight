import { migrate } from 'drizzle-orm/node-postgres/migrator';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { eq } from 'drizzle-orm';
import { getDb, initDb, closeDb } from './client.js';
import { users, strategies } from './schema.js';
import { listStrategies } from '../services/backtest/strategies/index.js';
import { logger } from '../utils/logger.js';

export const DEFAULT_USER_EMAIL = 'local@cryptoinsight.ai';

function migrationsFolder(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [process.env.MIGRATIONS_DIR, path.resolve(here, '../../../database/migrations'), path.resolve(here, '../../database/migrations'), '/app/database/migrations'].filter(Boolean) as string[];
  const found = candidates.find((p) => fs.existsSync(path.join(p, 'meta', '_journal.json')));
  if (!found) throw new Error(`Migrations folder not found (tried ${candidates.join(', ')})`);
  return found;
}

export async function runMigrations(): Promise<void> {
  const db = getDb();
  await migrate(db, { migrationsFolder: migrationsFolder() });
  // Seed single local user (v1 is single-user, no auth) and strategy catalogue
  const existing = await db.select().from(users).where(eq(users.email, DEFAULT_USER_EMAIL));
  if (!existing.length) await db.insert(users).values({ email: DEFAULT_USER_EMAIL, name: 'Local User' });
  for (const s of listStrategies()) {
    await db
      .insert(strategies)
      .values({ id: s.id, name: s.name, description: s.description, defaultParams: s.defaultParams })
      .onConflictDoUpdate({ target: strategies.id, set: { name: s.name, description: s.description, defaultParams: s.defaultParams, updatedAt: new Date() } });
  }
  logger.info('Database migrations applied');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  (async () => {
    if (!(await initDb())) process.exit(1);
    await runMigrations();
    await closeDb();
  })().catch((e) => {
    logger.error(e);
    process.exit(1);
  });
}
