import db, { sql } from 'sdk/db';
import { spins } from '../schema.js';

// shared progressive pool — every bet from every player feeds it
export async function jackpotPool() {
  const row = await db
    .select({ t: sql`coalesce(sum(bet), 0)` })
    .from(spins)
    .get();
  return row?.t ?? 0;
}
