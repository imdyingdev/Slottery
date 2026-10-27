import { getOrCreate } from '../lib/player.js';
import { jackpotPool } from '../lib/jackpot.js';

export default async function (input, ctx) {
  const player = await getOrCreate(ctx.initData.user);
  const pool = await jackpotPool();
  return { balance: player.balance, pool };
}
