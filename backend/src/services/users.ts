import { eq } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { users } from '../db/schema.js';
import { DEFAULT_USER_EMAIL } from '../db/migrate.js';

let cached: string | null = null;

/** v1 is single-user (local/self-hosted, no auth). All user data belongs to the seeded local user. */
export async function currentUserId(): Promise<string> {
  if (cached) return cached;
  const [u] = await getDb().select({ id: users.id }).from(users).where(eq(users.email, DEFAULT_USER_EMAIL));
  if (!u) throw new Error('Default user missing — run migrations');
  cached = u.id;
  return cached;
}
