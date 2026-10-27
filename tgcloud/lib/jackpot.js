import db, { sql } from 'sdk/db';
import { meta, spins } from '../schema.js';

// shared progressive pool — every bet from every player feeds it, forever.
// The value lives in meta ('pool'), NOT as SUM(spins.bet): /reset deletes a
// player's history rows, and a computed sum would silently shrink the pool.
// The first read seeds meta from the historical sum so the pool accumulated
// before this change carries over — after that it only ever goes up.
async function ensurePool() {
  await db.run(sql`
    insert into meta (key, value)
      select 'pool', coalesce(sum(bet), 0) from spins where true
    on conflict (key) do nothing
  `);
}

export async function jackpotPool() {
  await ensurePool();
  const row = await db.get(sql`select value from meta where key = 'pool'`);
  return row?.value ?? 0;
}

// called right after the spin row is inserted — if this is the first bet
// ever the seed branch writes sum(bet) which already includes it; on every
// later call the conflict branch adds just this bet
export async function addToJackpot(bet) {
  await db.run(sql`
    insert into meta (key, value)
      select 'pool', coalesce(sum(bet), 0) from spins where true
    on conflict (key) do update set value = value + ${bet}
  `);
}
