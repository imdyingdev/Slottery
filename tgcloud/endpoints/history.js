import db, { eq, desc, sql, or, and } from 'sdk/db';
import { spins } from '../schema.js';

export default async function (input, ctx) {
  const uid = ctx.initData.user.id;
  // a spin is written the instant it's tapped but the reels keep animating —
  // hide real spins until the reveal would have finished (~10s) so opening
  // history mid-spin can't spoil the result. Deposits (bet=0) show at once.
  const rows = await db.select().from(spins)
    .where(and(
      eq(spins.tgId, uid),
      or(eq(spins.bet, 0), sql`${spins.created} <= unixepoch() - 10`),
    ))
    .orderBy(desc(spins.id)).limit(50).all();
  return {
    spins: rows.map((r) => ({
      bet: r.bet,
      payout: r.payout,
      balance: r.balance,
      label: r.label || null,
      at: r.created,
    })),
  };
}
