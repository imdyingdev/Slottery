import { table, integer, text, sql, primaryKey, uniqueIndex } from 'sdk/db';

export const players = table('players', {
  tgId: integer('tg_id').primaryKey(),
  username: text('username'),
  firstName: text('first_name'),
  gkas: text('gkas'), // GKAS number: "09" + 3 letters — unique index below
  balance: integer('balance').notNull().default(1000),
  lastGkasAt: integer('last_gkas_at'), // /gkas cooldown (unix)
  lastSendAt: integer('last_send_at'), // /send cooldown (unix)
  referredBy: integer('referred_by'), // tg id of the inviter (referral cap = count of these)
}, (t) => ({
  gkasUq: uniqueIndex('players_gkas_uq').on(t.gkas),
}));

export const spins = table('spins', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  tgId: integer('tg_id').notNull(),
  bet: integer('bet').notNull(),
  payout: integer('payout').notNull().default(0),
  balance: integer('balance').notNull(),
  label: text('label'),
  created: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

// monotonic key/value store — the grand jackpot pool lives here so
// /reset (which deletes a player's spins) can never shrink it
export const meta = table('meta', {
  key: text('key').primaryKey(),
  value: integer('value').notNull(),
});

// who has been seen in which group chat — powers the per-group leaderboard
export const groupMembers = table('group_members', {
  chatId: integer('chat_id').notNull(),
  tgId: integer('tg_id').notNull(),
  username: text('username'),
  firstName: text('first_name'),
}, (t) => ({
  pk: primaryKey({ columns: [t.chatId, t.tgId] }),
}));
