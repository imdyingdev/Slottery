import { table, integer, text, sql, primaryKey } from 'sdk/db';

export const players = table('players', {
  tgId: integer('tg_id').primaryKey(),
  username: text('username'),
  firstName: text('first_name'),
  balance: integer('balance').notNull().default(1000),
});

export const spins = table('spins', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  tgId: integer('tg_id').notNull(),
  bet: integer('bet').notNull(),
  payout: integer('payout').notNull().default(0),
  balance: integer('balance').notNull(),
  label: text('label'),
  created: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
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
