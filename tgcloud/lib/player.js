import db, { eq, sql } from 'sdk/db';
import { players } from '../schema.js';

const displayName = (u) =>
  [u.first_name, u.last_name].filter(Boolean).join(' ') || null;

// keeps username + display name fresh on every call so /deposit can find
// players by whatever the admin types
export async function getOrCreate(user) {
  const uname = user.username || null;
  const name = displayName(user);
  const row = await db.select().from(players).where(eq(players.tgId, user.id)).get();
  if (row) {
    // only overwrite identity fields when Telegram actually sent a value —
    // a call without initData must not wipe what we know
    const patch = {};
    if (uname && row.username !== uname) patch.username = uname;
    if (name && row.firstName !== name) patch.firstName = name;
    if (Object.keys(patch).length) {
      await db.update(players).set(patch).where(eq(players.tgId, user.id)).run();
    }
    return row;
  }
  await db.insert(players)
    .values({ tgId: user.id, username: uname, firstName: name, balance: 1000 })
    .onConflictDoNothing({ target: players.tgId }).run();
  const created = await db.select().from(players).where(eq(players.tgId, user.id)).get();
  return created || { tgId: user.id, username: uname, firstName: name, balance: 1000 };
}

// find by numeric tg id, @username, or display name — all case-insensitive
export async function findPlayer(ref) {
  if (/^\d+$/.test(ref)) {
    return db.select().from(players)
      .where(eq(players.tgId, Number(ref))).get();
  }
  const q = ref.replace(/^@/, '').toLowerCase();
  const byUser = await db.select().from(players)
    .where(sql`lower(${players.username}) = ${q}`).get();
  if (byUser) return byUser;
  return db.select().from(players)
    .where(sql`lower(${players.firstName}) = ${q}`).get();
}
