// Shared slot game logic — the server is the source of truth for odds,
// payouts and results. The Mini App mirrors this for visuals only.
export const BET = 100;
// bet → payout multiplier (server-owned so it can't be spoofed)
export const BET_TIERS = { 100: 1, 500: 1.4, 1000: 1.5, 2500: 2, 4000: 2.5 };

export const BAR_VAL = { "1-bar": 1, "2-bar": 2, "3-bar": 3 };
export const TRIPLE_PAY = {
  seven: 1000000,
  7: 250000, // diamond
  chest: 100000,
  bell: 5000,
  cherry: 2500,
};
export const BAR_PAY = {
  "1,1,1": 10000, "2,2,2": 25000, "3,3,3": 50000,
  "1,1,2": 500, "1,2,2": 700, "1,1,3": 900, "1,2,3": 1200,
  "1,3,3": 1600, "2,2,3": 2000, "2,3,3": 3000,
};
export const SCATTER_PAY = {
  seven: { 4: 5000, 5: 20000, 6: 100000 },
  7: { 4: 2000, 5: 8000, 6: 40000 }, // diamond
  chest: { 4: 1000, 5: 4000, 6: 15000 },
  "3-bar": { 4: 600, 5: 2000, 6: 8000 },
  "2-bar": { 4: 400, 5: 1200, 6: 4000 },
  "1-bar": { 4: 200, 5: 600, 6: 2000 },
  bell: { 4: 100, 5: 300, 6: 1000 },
  cherry: { 4: 50, 5: 150, 6: 500 },
};

// middle row — symbol-only strip (win odds unchanged)
export const SYM_STOPS = [
  ["seven", 100], // jackpot — 10% per reel → ~1 in 1,000 for triple
  ["7", 105], // diamond
  ["chest", 110],
  ["3-bar", 115],
  ["2-bar", 125],
  ["1-bar", 135],
  ["bell", 145],
  ["cherry", 165],
];
// top/bottom rows — symbols reduced to make room for multiplier tiles
export const EDGE_STOPS = [
  ["seven", 100],
  ["7", 81],
  ["chest", 92],
  ["3-bar", 96],
  ["2-bar", 108],
  ["1-bar", 118],
  ["bell", 130],
  ["cherry", 155],
  ["x2", 30],
  ["x3", 25],
  ["x4", 20],
  ["x6", 18],
  ["x8", 15],
  ["x10", 8],
  ["x100", 4],
];
export const TOTAL_STOPS = 1000;

export function randomSymbol() {
  let r = Math.random() * TOTAL_STOPS;
  for (const [sym, w] of SYM_STOPS) if ((r -= w) <= 0) return sym;
  return "cherry";
}

export function randomEdge() {
  let r = Math.random() * TOTAL_STOPS;
  for (const [sym, w] of EDGE_STOPS) if ((r -= w) <= 0) return sym;
  return "cherry";
}

// multiplier tiles only land in top/bottom rows
export const isMult = (s) => /^x\d+$/.test(s);
export const multOf = (s) => (isMult(s) ? Number(s.slice(1)) : 0);

// total multiplier — every power tile in the top/bottom rows STACKS
// additively (×2 + ×8 = ×10), matching the strike sequence display
export function bestMult(finals) {
  let m = 0;
  for (const col of finals)
    for (const s of [col[0], col[2]]) m += multOf(s);
  return m;
}

// finals = 3 columns, each [top, middle, bottom]
export function evalMiddle(mid) {
  const bars = mid.map((s) => BAR_VAL[s]);
  if (bars.every(Boolean)) return BAR_PAY[bars.slice().sort().join(",")] || 0;
  return mid[0] === mid[1] && mid[1] === mid[2] ? TRIPLE_PAY[mid[0]] || 0 : 0;
}

const SYM_LABEL = {
  seven: "7", "7": "DIAMOND", chest: "CHEST", bell: "BELL", cherry: "CHERRY",
  "3-bar": "3-BAR", "2-bar": "2-BAR", "1-bar": "1-BAR",
};

// short human label for a result — "JACKPOT", "3× BELL + 4× CHERRY ×2"
export function describeWin(finals, ev) {
  const parts = [];
  const mid = finals.map((c) => c[1]);
  const bars = mid.map((s) => BAR_VAL[s]);
  if (mid.every((s) => s === "seven")) parts.push("JACKPOT 777");
  else if (bars.every(Boolean)) parts.push("3× BAR");
  else if (ev.mid > 0) parts.push(`3× ${SYM_LABEL[mid[0]]}`);
  const counts = {};
  finals.flat().forEach((s) => (counts[s] = (counts[s] || 0) + 1));
  for (const [sym, n] of Object.entries(counts))
    if (SCATTER_PAY[sym] && n >= 4)
      parts.push(`${Math.min(n, 6)}× ${SYM_LABEL[sym]}`);
  if (ev.mult > 1) parts.push(`×${ev.mult}`);
  return parts.join(" + ");
}

// returns { mid, scatter, mult, total } — top/bottom multiplier tiles
// stack additively and multiply the whole win, but only when the middle row pays
export function evalGrid(finals) {
  const mid = finals.map((col) => col[1]);
  const midPay = evalMiddle(mid);
  const counts = {};
  finals.flat().forEach((s) => (counts[s] = (counts[s] || 0) + 1));
  let scatter = 0;
  for (const [sym, n] of Object.entries(counts)) {
    const t = SCATTER_PAY[sym];
    if (t && n >= 4) scatter += t[Math.min(n, 6)] || 0;
  }
  const mult = midPay > 0 ? bestMult(finals) : 0;
  return { mid: midPay, scatter, mult, total: (midPay + scatter) * (mult || 1) };
}

