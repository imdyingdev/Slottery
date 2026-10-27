// handlers/message.js — runs on each `message` update. The file name is the
// Telegram update type; the platform calls the default export with the matching
// payload (here, a Message). The full update is available as `ctx.update`.

import { api, fetch, InputFile } from 'sdk';
import db, { eq, inArray, desc } from 'sdk/db';
import { players, spins, groupMembers } from '../schema.js';
import { findPlayer, getOrCreate, ensureGkas, findByGkas } from '../lib/player.js';

// slotsbackend (Puppeteer renderer on Render) — key matches the API_KEY env var
const BACKEND_URL = 'https://slotmachine-a0n1.onrender.com';
const BACKEND_KEY = '9be1d0b9aaae0aeacf566fb99bf185f8fc0129b382397bed';

const APP_URL = 'https://app8886680607.tgcloud.ai/';
const APP_LINK = 'https://t.me/SlotSpinsBot?startapp=play';
const GIF_URL = APP_URL + 'giphy.gif';
const ADMIN_ID = 8442877660;
const MEDALS = ['🥇', '🥈', '🥉', '4.', '5.'];

const fmt = (n) => `₱${Number(n).toLocaleString('en-US')}`;
const nameOf = (p) => (p.username ? `@${p.username}` : `id ${p.tgId}`);
// reply into the same topic when the chat is a forum group
const dest = (m) => ({
  chat_id: m.chat.id,
  ...(m.message_thread_id ? { message_thread_id: m.message_thread_id } : {}),
});

async function notifyUser(tgId, text) {
  try {
    await api.sendMessage({ chat_id: tgId, text });
    return true;
  } catch {
    return false;
  }
}

async function trackMember(message) {
  const isGroup = ['group', 'supergroup'].includes(message.chat?.type);
  if (!isGroup || !message.from) return;
  const m = {
    chatId: message.chat.id,
    tgId: message.from.id,
    username: message.from.username || null,
    firstName: message.from.first_name || null,
  };
  await db.insert(groupMembers).values(m).onConflictDoNothing().run();
  const patch = {};
  if (m.username) patch.username = m.username;
  if (m.firstName) patch.firstName = m.firstName;
  if (Object.keys(patch).length) {
    await db.update(groupMembers)
      .set(patch)
      .where(eq(groupMembers.chatId, m.chatId), eq(groupMembers.tgId, m.tgId))
      .run();
    // keep player identity fresh too so /deposit finds them by name — no-op
    // if they've never opened the app
    await db.update(players)
      .set(patch)
      .where(eq(players.tgId, m.tgId))
      .run();
  }
}

// top 5 balances among members seen in this chat
async function groupTop(chatId) {
  const members = await db.select({
    tgId: groupMembers.tgId,
    username: groupMembers.username,
    firstName: groupMembers.firstName,
  }).from(groupMembers).where(eq(groupMembers.chatId, chatId)).all();
  if (!members.length) return [];
  const byId = new Map(members.map((m) => [m.tgId, m]));
  const top = await db.select().from(players)
    .where(inArray(players.tgId, members.map((m) => m.tgId)))
    .orderBy(desc(players.balance)).limit(5).all();
  return top.map((p, i) => {
    const m = byId.get(p.tgId) || {};
    const label = m.username ? `@${m.username}` : (m.firstName || `id ${p.tgId}`);
    return `${MEDALS[i]} ${label} — ${fmt(p.balance)}`;
  });
}

async function renderImage(path, payload) {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': BACKEND_KEY },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`backend ${res.status}`);
  const chunks = [];
  let len = 0;
  for await (const c of res.body) {
    chunks.push(c);
    len += c.length;
  }
  const bytes = new Uint8Array(len);
  let off = 0;
  for (const c of chunks) {
    bytes.set(c, off);
    off += c.length;
  }
  return bytes;
}

// 30s per-user cooldown on the image commands — stamps the column up front
// so even a failed render can't be spam-retried
const COOLDOWN_SEC = 30;
async function cooldownLeft(tgId, col) {
  const now = Math.floor(Date.now() / 1000);
  const row = await db.select().from(players).where(eq(players.tgId, tgId)).get();
  const left = COOLDOWN_SEC - (now - (row?.[col] || 0));
  if (left <= 0) {
    await db.update(players).set({ [col]: now }).where(eq(players.tgId, tgId)).run();
    return 0;
  }
  return left;
}

export default async function (message, ctx) {
  const text = (message.text || '').trim();
  const isAdmin = message.from?.id === ADMIN_ID;
  const isGroup = ['group', 'supergroup'].includes(message.chat?.type);

  await trackMember(message);

  // /gkas — the sender's slots balance as a GKas wallet card image,
  // with a Copy Number button so they can share their code
  if (/^\/gkas(?:@\w+)?\s*$/i.test(text) && message.from) {
    const me = await db.select().from(players).where(eq(players.tgId, message.from.id)).get();
    if (!me) {
      await api.sendMessage({
        ...dest(message),
        reply_parameters: { message_id: message.message_id },
        text: '💳 You are not registered yet — send me a message first!',
      });
      return;
    }
    const wait = await cooldownLeft(message.from.id, 'lastGkasAt');
    if (wait > 0) {
      await api.sendMessage({
        ...dest(message),
        reply_parameters: { message_id: message.message_id },
        text: `⏳ Slow down — try /gkas again in ${wait}s.`,
      });
      return;
    }
    const p = await ensureGkas(message.from);
    const payload = {
      name: message.from.first_name || message.from.username || 'Player',
      balance: p.balance,
      number: p.gkas || `09${message.from.id}`,
    };
    const markup = {
      inline_keyboard: [[{ text: '📋 Copy Number', copy_text: { text: payload.number } }]],
    };
    const reply = { ...dest(message), reply_parameters: { message_id: message.message_id } };
    try {
      if (!BACKEND_URL) throw new Error('no backend');
      const png = await renderImage('/gkas', payload);
      await api.sendPhoto({
        ...reply,
        photo: new InputFile(png, 'gkas.png', { type: 'image/png' }),
        reply_markup: markup,
      });
    } catch {
      await api.sendMessage({
        ...reply,
        text: `💳 GKas ${payload.number}\n${payload.name} — ${fmt(payload.balance)}`,
        reply_markup: markup,
      });
    }
    return;
  }

  // /send <gkas number>, <amount> — transfer balance to another player,
  // works in the bot DM and in groups; replies with the GKas receipt
  const send = text.match(/^\/send\s+(09\s?[a-z]{3})\s*,\s*(\d+)/i);
  if (send && message.from) {
    const me = await db.select().from(players).where(eq(players.tgId, message.from.id)).get();
    if (!me) {
      await api.sendMessage({
        ...dest(message),
        reply_parameters: { message_id: message.message_id },
        text: '💳 You are not registered yet — send me a message first!',
      });
      return;
    }
    const wait = await cooldownLeft(message.from.id, 'lastSendAt');
    if (wait > 0) {
      await api.sendMessage({
        ...dest(message),
        reply_parameters: { message_id: message.message_id },
        text: `⏳ Slow down — try /send again in ${wait}s.`,
      });
      return;
    }
    const code = send[1].replace(/\s+/g, '').toUpperCase();
    const amount = parseInt(send[2], 10);
    const reply = { ...dest(message), reply_parameters: { message_id: message.message_id } };
    const say = (t) => api.sendMessage({ ...reply, text: t });

    const sender = await ensureGkas(message.from);
    const to = await findByGkas(code);
    if (!to) return say(`❌ No GKas account ${code} — check the number.`);
    if (to.tgId === sender.tgId) return say('❌ You cannot send to yourself.');
    if (amount < 1) return say('❌ Amount must be at least ₱1.');
    if (sender.balance < amount)
      return say(`❌ Not enough balance — you have ${fmt(sender.balance)}.`);

    const fromBal = sender.balance - amount;
    const toBal = to.balance + amount;
    await db.update(players).set({ balance: fromBal }).where(eq(players.tgId, sender.tgId)).run();
    await db.update(players).set({ balance: toBal }).where(eq(players.tgId, to.tgId)).run();
    await db.insert(spins).values({ tgId: sender.tgId, bet: 0, payout: -amount, balance: fromBal, label: `TO ${to.gkas}` }).run();
    await db.insert(spins).values({ tgId: to.tgId, bet: 0, payout: amount, balance: toBal, label: `FROM ${sender.gkas}` }).run();

    const toName = to.firstName || to.username || 'Player';
    try {
      if (!BACKEND_URL) throw new Error('no backend');
      const png = await renderImage('/receipt', { toName, toNumber: to.gkas, amount });
      await api.sendPhoto({
        ...reply,
        photo: new InputFile(png, 'receipt.png', { type: 'image/png' }),
        caption: `✅ Sent ${fmt(amount)} to ${to.gkas} — balance ${fmt(fromBal)}`,
      });
    } catch {
      await say(`✅ Sent ${fmt(amount)} to ${toName} (${to.gkas}) — balance ${fmt(fromBal)}`);
    }
    await notifyUser(
      to.tgId,
      `💸 You received ${fmt(amount)} from ${message.from.first_name || message.from.username || 'a player'} (${sender.gkas}) — new balance ${fmt(toBal)}`
    );
    return;
  }

  // /spin — group card: gif + group leaderboard + Spin button
  if (/^\/spin(?:@\w+)?\s*$/i.test(text)) {
    const lines = isGroup ? await groupTop(message.chat.id) : [];
    const caption =
      '🎰 Feeling lucky? Hit Spin and climb the board!' +
      (lines.length ? `\n\n🏆 Top players here:\n${lines.join('\n')}` : '');
    // web_app buttons are private-chat only — url to the t.me app link works everywhere
    const markup = {
      inline_keyboard: [[{ text: '🎰 Spin', url: APP_LINK }]],
    };
    try {
      await api.sendAnimation({
        ...dest(message),
        animation: GIF_URL,
        caption,
        reply_markup: markup,
      });
    } catch {
      try {
        // gif URL unreachable / chat quirks — plain message still works
        await api.sendMessage({
          ...dest(message),
          text: caption,
          reply_markup: markup,
        });
      } catch (e) {
        try {
          // no markup / no thread — bare text as last resort
          await api.sendMessage({ chat_id: message.chat.id, text: caption });
        } catch (e2) {
          const why = e2?.description || e2?.message || String(e2);
          await notifyUser(ADMIN_ID, `⚠️ /spin failed in ${message.chat.id}: ${why}`);
        }
      }
    }
    return;
  }

  // /deposit <username|id|name>, <amount> — admin only
  const dep = text.match(/^\/deposit\s+@?([\w ]+?)\s*,\s*(\d+)/i);
  if (dep && isAdmin) {
    const [, refRaw, amtStr] = dep;
    const ref = refRaw.trim();
    const amount = parseInt(amtStr, 10);
    const p = await findPlayer(ref);
    if (!p) {
      await api.sendMessage({
        chat_id: message.chat.id,
        text: `❌ User "${ref}" not found — they must open the app once first.`,
      });
      return;
    }
    const balance = p.balance + amount;
    await db.update(players).set({ balance }).where(eq(players.tgId, p.tgId)).run();
    // bet 0 marks a deposit row in the user's history
    await db.insert(spins).values({ tgId: p.tgId, bet: 0, payout: amount, balance }).run();
    const notified = await notifyUser(
      p.tgId,
      `💰 ${fmt(amount)} was deposited to your slots balance — new balance ${fmt(balance)}`
    );
    await api.sendMessage({
      chat_id: message.chat.id,
      text: `✅ Deposited ${fmt(amount)} to ${nameOf(p)} — new balance ${fmt(balance)}` +
        (notified ? '' : ' (could not DM them)'),
    });
    return;
  }

  // /reset <username|id> — admin only: balance back to 1,000, history cleared
  const rst = text.match(/^\/reset\s+@?(.+)$/i);
  if (rst && isAdmin) {
    const ref = rst[1].trim();
    const p = await findPlayer(ref);
    if (!p) {
      await api.sendMessage({
        chat_id: message.chat.id,
        text: `❌ User "${ref}" not found.`,
      });
      return;
    }
    await db.update(players).set({ balance: 1000 }).where(eq(players.tgId, p.tgId)).run();
    await db.delete(spins).where(eq(spins.tgId, p.tgId)).run();
    const notified = await notifyUser(
      p.tgId,
      `♻️ Your slots account was reset — balance ${fmt(1000)}, history cleared.`
    );
    await api.sendMessage({
      chat_id: message.chat.id,
      text: `♻️ Reset ${nameOf(p)} — balance ${fmt(1000)}, history cleared.` +
        (notified ? '' : ' (could not DM them)'),
    });
    return;
  }

  // default card — private chats only; in groups only /spin answers
  if (isGroup) return;
  await api.sendMessage({
    chat_id: message.chat.id,
    text: '🎰 Slots — tap below to play!',
    reply_markup: {
      inline_keyboard: [[{ text: '🎰 Play Slots', web_app: { url: APP_URL } }]],
    },
  });
}
