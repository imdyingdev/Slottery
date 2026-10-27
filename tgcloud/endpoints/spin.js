import db, { eq } from 'sdk/db';
import { EndpointError } from 'sdk';
import { players, spins } from '../schema.js';
import { getOrCreate } from '../lib/player.js';
import { jackpotPool, addToJackpot } from '../lib/jackpot.js';
import { BET, BET_TIERS, randomSymbol, randomEdge, evalGrid, describeWin } from '../lib/game.js';

export default async function (input, ctx) {
  const uid = ctx.initData.user.id;
  const player = await getOrCreate(ctx.initData.user);
  const bet = Math.floor(input?.bet ?? BET);
  const mult = BET_TIERS[bet];
  if (!mult) throw new EndpointError('Invalid bet');
  if (player.balance < bet) throw new EndpointError('Not enough credits');

  // 3 columns of [top, middle, bottom] finals — middle is symbols-only,
  // top/bottom can land multiplier tiles — weighted server-side
  const finals = Array.from({ length: 3 }, () => [
    randomEdge(),
    randomSymbol(),
    randomEdge(),
  ]);
  const ev = evalGrid(finals);
  const payout = Math.round(ev.total * mult);
  const balance = player.balance - bet + payout;
  await db.update(players).set({ balance }).where(eq(players.tgId, uid)).run();
  const label = ev.total > 0 ? describeWin(finals, ev) : null;
  await db.insert(spins).values({ tgId: uid, bet, payout, balance, label }).run();
  await addToJackpot(bet); // monotonic pool — survives /reset of history
  const pool = await jackpotPool();

  return { finals, bet, payout, mult: ev.mult, balance, pool };
}

