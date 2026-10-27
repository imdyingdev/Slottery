const SYMBOLS = ["cherry", "bell", "1-bar", "2-bar", "3-bar", "7", "seven", "chest"];
const ROWS = 3;
const COLS = 3;
const BETS = [
  { bet: 100, mult: 1 },
  { bet: 500, mult: 1.4 },
  { bet: 1000, mult: 1.5 },
  { bet: 2500, mult: 2 },
  { bet: 4000, mult: 2.5 },
];
let betIdx = 0;
const currentBet = () => BETS[betIdx];

// ===== payout table: middle row only, order doesn't matter =====
// ("7.png" is the diamond art; "seven.png" is the gold 7)
const BAR_VAL = { "1-bar": 1, "2-bar": 2, "3-bar": 3 };
const TRIPLE_PAY = {
  seven: 1000000,
  7: 250000, // diamond
  chest: 100000,
  bell: 5000,
  cherry: 2500,
};
const BAR_PAY = {
  "1,1,1": 10000, "2,2,2": 25000, "3,3,3": 50000,
  "1,1,2": 500, "1,2,2": 700, "1,1,3": 900, "1,2,3": 1200,
  "1,3,3": 1600, "2,2,3": 2000, "2,3,3": 3000,
};

// ===== reel weighting: stops out of 1,000 per cell =====
// middle row is symbols-only; top/bottom rows can also land multiplier tiles
const SYM_STOPS = [
  ["seven", 100], // jackpot — 10% per reel
  ["7", 105], // diamond
  ["chest", 110],
  ["3-bar", 115],
  ["2-bar", 125],
  ["1-bar", 135],
  ["bell", 145],
  ["cherry", 165],
];
const EDGE_STOPS = [
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
const TOTAL_STOPS = 1000;
const MULT_SYMS = ["x2", "x3", "x4", "x6", "x8", "x10", "x100"];
const isMult = (s) => /^x\d+$/.test(s);
const multOf = (s) => (isMult(s) ? Number(s.slice(1)) : 0);
// total multiplier of a finals grid — every power tile in the top/bottom
// rows STACKS additively (×2 + ×8 = ×10), mirroring tgcloud/lib/game.js
const bestMult = (finals) =>
  finals.reduce((m, col) => m + multOf(col[0]) + multOf(col[2]), 0);

// evaluate a finals grid ([col][top,mid,bottom]) BEFORE the reels land —
// lets us schedule voices to be heard at the stop, not output-lag late
function evalFinals(finals) {
  const mid = finals.map((col) => col[1]);
  const bars = mid.map((s) => BAR_VAL[s]);
  const midPay = bars.every(Boolean)
    ? BAR_PAY[bars.slice().sort().join(",")] || 0
    : mid[0] === mid[1] && mid[1] === mid[2]
      ? TRIPLE_PAY[mid[0]] || 0
      : 0;
  const counts = {};
  finals.flat().forEach((s) => (counts[s] = (counts[s] || 0) + 1));
  let maxN = 0;
  for (const [sym, n] of Object.entries(counts))
    if (SCATTER_PAY[sym] && n >= 4) maxN = Math.max(maxN, n);
  const bm = bestMult(finals);
  let nMult = 0;
  if (bm > 1)
    finals.forEach((col) =>
      [0, 2].forEach((r) => {
        if (multOf(col[r]) >= 2) nMult++;
      })
    );
  return { midPay, maxN, mult: bm, nMult,
    jackpot: mid[0] === "seven" && mid[1] === "seven" && mid[2] === "seven" };
}

// full local eval for preview/test spins — mirrors tgcloud/lib/game.js
function evalGridLocal(finals) {
  const { midPay } = evalFinals(finals);
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

// middle row only — returns the payout for the landed row
function evalMiddleRow() {
  const mid = reels.map((r) => r.cells[1].dataset.sym);
  const bars = mid.map((s) => BAR_VAL[s]);
  if (bars.every(Boolean)) return BAR_PAY[bars.slice().sort().join(",")] || 0;
  return mid[0] === mid[1] && mid[1] === mid[2] ? TRIPLE_PAY[mid[0]] || 0 : 0;
}

// ===== scatter pays: count each symbol across all 9 cells =====
// 4 pcs / 5 pcs / 6+ pcs tiers — every qualifying symbol pays, summed
const SCATTER_PAY = {
  seven: { 4: 5000, 5: 20000, 6: 100000 },
  7: { 4: 2000, 5: 8000, 6: 40000 }, // diamond
  chest: { 4: 1000, 5: 4000, 6: 15000 },
  "3-bar": { 4: 600, 5: 2000, 6: 8000 },
  "2-bar": { 4: 400, 5: 1200, 6: 4000 },
  "1-bar": { 4: 200, 5: 600, 6: 2000 },
  bell: { 4: 100, 5: 300, 6: 1000 },
  cherry: { 4: 50, 5: 150, 6: 500 },
};

function evalScatters() {
  const counts = {};
  reels.forEach((r) =>
    r.cells.forEach((c) => {
      const s = c.dataset.sym;
      counts[s] = (counts[s] || 0) + 1;
    })
  );
  let pay = 0;
  let maxN = 0;
  const wins = [];
  for (const [sym, n] of Object.entries(counts)) {
    const t = SCATTER_PAY[sym];
    if (!t || n < 4) continue;
    pay += t[Math.min(n, 6)] || 0;
    wins.push(sym);
    if (n > maxN) maxN = n;
  }
  return { pay, wins, maxN };
}
const FRAME_ASPECT = 1; // slot-border.png is 1254x1254

const appEl = document.getElementById("app");
const frameEl = document.getElementById("frame");
const frameInner = document.getElementById("frame-inner");
const gridEl = document.getElementById("grid");
const spinBtn = document.getElementById("spin");
const betBtn = document.getElementById("bet");
const controlsEl = document.getElementById("controls");
const jackpotBox = document.getElementById("jackpot");
const creditVal = document.getElementById("credit-val");

const updateCredits = () => {
  creditVal.textContent = balance.toLocaleString("en-US");
};

// grand jackpot pool — shared across ALL players, grows with every bet.
// Updates roll like the win bar's count-up instead of snapping.
const jackpotVal = document.getElementById("jackpot-val");
let pool = 0, poolRaf = 0;
function setPool(target) {
  if (!jackpotVal) return;
  cancelAnimationFrame(poolRaf);
  const from = pool;
  if (from === target) return;
  const t0 = performance.now();
  const dur = Math.max(300, Math.min(1400, 400 + Math.abs(target - from) / 10));
  const tick = (t) => {
    const p = Math.min(1, (t - t0) / dur);
    const eased = 1 - Math.pow(1 - p, 3); // same roll as the win bar
    pool = Math.round(from + (target - from) * eased);
    jackpotVal.textContent = `₱${pool.toLocaleString("en-US")}`;
    if (p < 1) poolRaf = requestAnimationFrame(tick);
    else pool = target;
  };
  poolRaf = requestAnimationFrame(tick);
}

const tg = window.Telegram?.WebApp;
tg?.ready();
tg?.expand();

let balance = 1000;
let spinning = false;
let pendingResult = null; // server spin result {finals, payout, balance}
let pendingWinScale = false; // mid-win strike incoming — re-apply scale after each reel swap
const reels = [];

// call a tgcloud endpoint — resolves null when unavailable (local preview)
const callApi = (name, input) =>
  new Promise((resolve) => {
    const call = tg?.Serverless?.call?.bind(tg.Serverless);
    if (!call) return resolve(null);
    try {
      call(name, input, (err, res) => resolve(err ? null : res));
    } catch {
      resolve(null);
    }
  });

// restore the player's saved balance + the shared jackpot pool
callApi("state", {}).then((r) => {
  if (r && typeof r.balance === "number") {
    balance = r.balance;
    updateCredits();
  }
  if (r && typeof r.pool === "number") setPool(r.pool);
});

// other players' bets feed the pool too — refresh it lightly
setInterval(async () => {
  const r = await callApi("state", {});
  if (r && typeof r.pool === "number") setPool(r.pool);
}, 20000);

// preload symbol images so the first spin doesn't flicker
SYMBOLS.forEach((id) => {
  const img = new Image();
  img.src = `items/${id}.png`;
});

// 3 reels, each a column of 3 cells — the reel scrolls as ONE strip.
for (let c = 0; c < COLS; c++) {
  const reel = document.createElement("div");
  reel.className = "reel";
  gridEl.appendChild(reel);
  const reelCells = [];
  for (let r = 0; r < ROWS; r++) {
    const cell = document.createElement("div");
    cell.className = "cell";
    setSym(cell, r === 1 ? randomSymbol() : randomEdge());
    reel.appendChild(cell);
    reelCells.push(cell);
  }
  reels.push({ el: reel, cells: reelCells });
}

// weighted pick — stops out of 1,000
function randomSymbol() {
  let r = Math.random() * TOTAL_STOPS;
  for (const [sym, w] of SYM_STOPS) if ((r -= w) <= 0) return sym;
  return "cherry";
}

// top/bottom rows pick from the wider table that includes multiplier tiles
function randomEdge() {
  let r = Math.random() * TOTAL_STOPS;
  for (const [sym, w] of EDGE_STOPS) if ((r -= w) <= 0) return sym;
  return "cherry";
}

// Web Audio: decoded once at startup, starts in ~10ms (HTMLAudio can lag
// 300ms+ inside a WebView even when preloaded)
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
let stopBuf = null;
let spinBuf = null;
let winBuf = null;
const loadSfx = (file, set) =>
  fetch(file)
    .then((r) => r.arrayBuffer())
    .then((ab) => audioCtx.decodeAudioData(ab))
    .then(set)
    .catch(() => {});
loadSfx("sfx/stop.mp3", (b) => (stopBuf = b));
loadSfx("sfx/spin.mp3", (b) => (spinBuf = b));
loadSfx("sfx/middle-win.mp3", (b) => (winBuf = b));
let zapBuf = null;
loadSfx("sfx/lightning.mp3", (b) => (zapBuf = b));
let winbarBuf = null;
loadSfx("sfx/winbar.mp3", (b) => (winbarBuf = b));
let fireBuf = null;
loadSfx("sfx/fire.mp3", (b) => (fireBuf = b));

// short fire whoosh when the jackpot banner is tapped
function playFire() {
  if (!fireBuf) return;
  const src = audioCtx.createBufferSource();
  src.buffer = fireBuf;
  src.connect(audioCtx.destination);
  src.start();
}

// tally sound while the win amount counts up
function playWinbarSound() {
  if (!winbarBuf) return;
  const src = audioCtx.createBufferSource();
  src.buffer = winbarBuf;
  src.connect(audioCtx.destination);
  src.start();
}

// lightning strike crack — fired when the bolts hit the multiplier
function playZap() {
  if (!zapBuf) return;
  const src = audioCtx.createBufferSource();
  src.buffer = zapBuf;
  src.connect(audioCtx.destination);
  src.start();
}

// voice lines — decoded once, played on the result
const voiceBufs = {};
["4times", "5times", "6times", "congratulations", "jackpot", "gago", "ops"].forEach((n) =>
  loadSfx(`sfx/voice/${n}.mp3`, (b) => (voiceBufs[n] = b))
);
// plays a voice clip; `delaySec` offsets it so lines don't overlap
function playVoice(name, delaySec = 0) {
  const buf = voiceBufs[name];
  if (!buf) return;
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  src.connect(audioCtx.destination);
  src.start(audioCtx.currentTime + delaySec);
}

// ===== background music: music1 ⇄ music2, crossfaded, loops forever =====
const MUSIC_VOL = 1.0;   // full volume
const MUSIC_XFADE = 2;   // seconds of overlap between tracks
const musicBufs = [null, null];
loadSfx("sfx/music1.mp3", (b) => (musicBufs[0] = b));
loadSfx("sfx/music2.mp3", (b) => (musicBufs[1] = b));
let musicNextStart = 0;
let musicIdx = 0;
let musicSrc = null;
let musicOn = localStorage.getItem("slots_music") !== "off";

function scheduleMusic() {
  if (!musicOn || !musicBufs[0] || !musicBufs[1]) return;
  const now = audioCtx.currentTime;
  const first = musicNextStart === 0;
  const start = first ? now + 0.05 : musicNextStart;
  const buf = musicBufs[musicIdx];
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  const g = audioCtx.createGain();
  const end = start + buf.duration;
  const fadeIn = first ? 1 : MUSIC_XFADE;
  g.gain.setValueAtTime(0, start);
  g.gain.linearRampToValueAtTime(MUSIC_VOL, start + fadeIn);
  g.gain.setValueAtTime(MUSIC_VOL, end - MUSIC_XFADE);
  g.gain.linearRampToValueAtTime(0, end);
  src.connect(g);
  g.connect(audioCtx.destination);
  src.start(start);
  src._gain = g;
  musicSrc = src;
  musicNextStart = end - MUSIC_XFADE;
  musicIdx ^= 1;
  // wake up shortly before the next track is due and schedule it —
  // start() anchors on the audio clock, so early scheduling stays exact
  setTimeout(scheduleMusic, Math.max(0, (musicNextStart - now - 0.5) * 1000));
}

// schedule now — while the context is suspended its clock is frozen, so the
// first track is queued at ~0 and starts the moment the first tap resumes it
const tryStartMusic = () => {
  if (!musicOn) return;
  if (musicBufs[0] && musicBufs[1]) scheduleMusic();
  else setTimeout(tryStartMusic, 300);
};
tryStartMusic();

// music toggle (top-right) — remembers the choice between sessions
const musicBtn = document.getElementById("music-btn");
musicBtn.classList.toggle("muted", !musicOn);
musicBtn.addEventListener("click", () => {
  musicOn = !musicOn;
  localStorage.setItem("slots_music", musicOn ? "on" : "off");
  musicBtn.classList.toggle("muted", !musicOn);
  if (!musicOn && musicSrc) {
    // fade out fast instead of a hard cut
    try {
      const t = audioCtx.currentTime;
      const g = musicSrc._gain;
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.linearRampToValueAtTime(0, t + 0.35);
      musicSrc.stop(t + 0.45);
    } catch {}
    musicSrc = null;
    musicNextStart = 0;
  } else if (musicOn) {
    musicNextStart = 0;
    scheduleMusic();
  }
});

// scenic background toggle (top-right) — on by default, remembered
const bgEl = document.getElementById("bg");
const bgBtn = document.getElementById("bg-btn");
let bgOn = localStorage.getItem("slots_bg") !== "off";
bgEl.hidden = !bgOn;
bgBtn.classList.toggle("off", !bgOn);
bgBtn.addEventListener("click", () => {
  bgOn = !bgOn;
  localStorage.setItem("slots_bg", bgOn ? "on" : "off");
  bgEl.hidden = !bgOn;
  bgBtn.classList.toggle("off", !bgOn);
});

// ===== timing you can tweak =====
// 0.99 = the tuned offset where hits line up; +3.0 = extra spin time before
// the cascade — everything shifts later so sync is unchanged
const SOUND_START = 0.99 + 3.0;
const SOUND_RATE = 1.0; // playback speed — keep 1, don't slow the sound
// seconds INTO the sound file when each column stops:
// [col 1, col 2, col 3] — hits are at ~0.15 / 0.50 / 0.85 for reference.
const REEL_STOP_AT = [0.15, 0.5, 0.85];
const AUDIO_OUT_LAG = 1.2; // output latency compensation — if the hit sounds
// AFTER the reel stops, raise this (Bluetooth audio can need 0.3–0.5)
const SPIN_SFX_LEAD = 0.3; // whoosh is silent this many seconds BEFORE the
// first reel's stop *at your ears* — raise if it still tails into the stops

// starts playback NOW — called via setTimeout so it shares the wall clock
// with the reel timers (no audio-clock drift)
function playStopSound() {
  if (!stopBuf) return;
  const src = audioCtx.createBufferSource();
  src.buffer = stopBuf;
  src.playbackRate.value = SOUND_RATE;
  src.connect(audioCtx.destination);
  src.start();
}

// middle-row win jingle — fired once in settle when the middle row pays
function playWinSound() {
  if (!winBuf) return;
  const src = audioCtx.createBufferSource();
  src.buffer = winBuf;
  src.connect(audioCtx.destination);
  src.start();
}

// reel whoosh at spin start — returns nodes so a fade can be scheduled
function playSpinSound() {
  if (!spinBuf) return null;
  const src = audioCtx.createBufferSource();
  src.buffer = spinBuf;
  const gain = audioCtx.createGain();
  src.connect(gain);
  gain.connect(audioCtx.destination);
  src.start();
  return { src, gain };
}

function setSym(el, id) {
  el.dataset.sym = id;
  if (isMult(id)) {
    el.classList.add("mult");
    el.innerHTML = `<span class="mult-txt">${id.replace("x", "×")}</span>`;
  } else {
    el.classList.remove("mult");
    el.innerHTML = `<img src="items/${id}.png" alt="${id}" draggable="false">`;
  }
}

function cellAt(r, c) {
  return reels[c].cells[r];
}

// Largest 1888:2272 rect that fits above the button — border keeps its
// proportions, and the button sits directly beneath the frame.
function fitFrame() {
  const appRect = appEl.getBoundingClientRect();
  const styles = getComputedStyle(appEl);
  const padV =
    parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom);
  const gap = parseFloat(styles.gap) || 0;
  const availH = appRect.height - padV - gap - spinBtn.offsetHeight;
  const availW = frameEl.clientWidth;
  let h = availH;
  let w = h * FRAME_ASPECT;
  if (w > availW) {
    w = availW;
    h = w / FRAME_ASPECT;
  }
  frameInner.style.width = `${w}px`;
  frameInner.style.height = `${h}px`;
}

window.addEventListener("resize", fitFrame);
tg?.onEvent?.("viewportChanged", fitFrame);
// the banner has no height until its image loads — refit then
jackpotBox?.querySelector("img")?.addEventListener("load", fitFrame);
fitFrame();

function setReelSymbols(reel, syms) {
  reel.el.textContent = "";
  reel.cells = syms.map((id) => {
    const cell = document.createElement("div");
    cell.className = "cell";
    setSym(cell, id);
    reel.el.appendChild(cell);
    return cell;
  });
}

// Spin one reel: a continuous strip of symbols scrolls up through all 3 rows
// and eases to a stop on the final 3 symbols (top→bottom).
// tween one reel's blur amount over `dur` ms (both in and out)
function rampBlur(fe, from, to, dur) {
  const t0 = performance.now();
  const tick = () => {
    const p = Math.min(1, (performance.now() - t0) / dur);
    fe.setAttribute("stdDeviation", `0 ${(from + (to - from) * p).toFixed(1)}`);
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function spinReel(reel, finalSyms, duration, colIdx, blurClearAt) {
  const h = reel.el.clientHeight / ROWS;
  const count = Math.max(6, Math.round(duration / 70));

  const strip = document.createElement("div");
  strip.className = "strip";
  const addSym = (txt) => {
    const s = document.createElement("div");
    s.className = "sym";
    s.style.height = `${h}px`;
    setSym(s, txt);
    strip.appendChild(s);
  };
  // [finals][randoms][currents] — the strip scrolls DOWN: currents are
  // visible first (the symbols already on the reel), finals drop in last
  const currents = reel.cells.map((c) => c.dataset.sym);
  finalSyms.forEach(addSym);
  for (let i = 0; i < count - 3; i++) addSym(randomEdge());
  currents.forEach(addSym);

  // clip extends ~7% of reel height past the opening, underneath the opaque
  // border art — symbols slide behind the frame instead of being cut
  const pad = Math.round(reel.el.clientHeight * 0.07);
  const clip = document.createElement("div");
  clip.className = "clip";
  clip.style.top = `${-pad}px`;
  clip.style.bottom = `${-pad}px`;
  strip.style.top = `${pad}px`;
  clip.appendChild(strip);
  reel.strip = strip;

  reel.el.textContent = "";
  reel.el.appendChild(clip);

  // vertical motion blur — only through the fast middle of the spin: ramps
  // in at ~800ms, fully cleared ~650ms before the stop
  const fe = document.querySelector(`#vblur${colIdx} feGaussianBlur`);
  fe.setAttribute("stdDeviation", "0 0");
  strip.style.filter = `url(#vblur${colIdx})`;
  setTimeout(() => rampBlur(fe, 0, 6, 200), 800);
  // shared deadline for ALL columns, anchored to column 1's stop: fast 150ms
  // fade that finishes BLUR_CLEAR_LEAD ms before the first reel lands
  setTimeout(() => rampBlur(fe, 6, 0, 150), Math.max(1000, blurClearAt - 150));

  return strip
    .animate(
      [
        { transform: `translateY(-${count * h}px)` },
        { transform: `translateY(${0.18 * h}px)`, offset: 0.93 },
        { transform: "translateY(0)" },
      ],
      { duration, easing: "cubic-bezier(0.35, 0, 0.3, 1)", fill: "forwards" }
    )
    .finished.catch(() => {})
    .then(() => {
      strip.style.filter = "none"; // hard-clear any residual blur
      tg?.HapticFeedback?.impactOccurred("light");
      setReelSymbols(reel, finalSyms);
      // the strip's scaled symbol was just swapped for a fresh cell —
      // re-apply the scale instantly so it never snaps back to normal
      if (pendingWinScale) reel.cells[1].classList.add("win-scale");
    });
}

function settle() {
  pendingWinScale = false;
  const midPay = evalMiddleRow();
  const { pay: scatterPay, wins, maxN } = evalScatters();
  // a top/bottom multiplier tile multiplies the whole win — only when the
  // middle row pays. Server result carries its own mult; local spins compute it
  const localMult =
    midPay > 0
      ? bestMult(reels.map((r) => r.cells.map((c) => c.dataset.sym)))
      : 0;
  const mult = pendingResult?.mult ?? localMult;
  const payout = pendingResult
    ? pendingResult.payout
    : Math.round((midPay + scatterPay) * (mult || 1) * currentBet().mult);
  if (pendingResult) balance = pendingResult.balance;
  else balance += payout;
  // the spin's bet fed the shared pool server-side at tap-time, but the
  // counter only ticks now — the increase reads as caused by THIS spin
  if (pendingResult && typeof pendingResult.pool === "number")
    setPool(pendingResult.pool);
  if (midPay > 0) {
    // light up the middle row and run the lightning — rings on the 3 winners,
    // then a strike into the multiplier tile if one applied. Coin shower and
    // the win pulse only run on plain wins — during a strike the pulse is
    // held until the bolts finish so the strike reads cleanly (and lags less)
    if (mult <= 1) {
      reels.forEach((r) => r.cells[1].classList.add("win"));
      coinShower(payout);
    } else {
      // during a strike the winners just enlarge — heartbeat starts after
      // the bolts finish (added at the end of fxFrame)
      reels.forEach((r) => r.cells[1].classList.add("win-scale"));
    }
  }
  // light up every cell that formed a scatter win — during a lightning
  // strike ALL pulses (mid + scatter) wait and fire together at the end
  const delayedWin = [];
  reels.forEach((r) =>
    r.cells.forEach((c) => {
      if (wins.includes(c.dataset.sym)) {
        if (midPay > 0 && mult > 1) delayedWin.push(c);
        else c.classList.add("win");
      }
    })
  );
  if (midPay > 0) {
    // let the winners' grow-up finish first — the electricity starts a
    // beat later so the sequence reads: land → scale up → strike
    if (mult > 1) setTimeout(() => lightningWin(mult, delayedWin, payout), 350);
    else lightningWin(mult, delayedWin, payout);
  }
  updateCredits();
  if (payout > 0) {
    tg?.HapticFeedback?.notificationOccurred("success");
    // strike path shows the accumulating mult then the final total;
    // everything else just shows the win amount
    if (mult <= 1) showWinBarTotal(payout, 0);
  }
  pendingResult = null;
  spinning = false;
  spinBtn.disabled = false;
  betBtn.disabled = false;
  document.body.classList.remove("spinning");
}

async function spin() {
  const { bet, mult } = currentBet();
  if (spinning || balance < bet) return;
  spinning = true;
  hideWinBar();
  spinBtn.disabled = true;
  betBtn.disabled = true;
  // resume the audio clock inside the tap gesture BEFORE anchoring to it —
  // while suspended currentTime is frozen, which would shift the cascade late
  try {
    if (audioCtx.state === "suspended") await audioCtx.resume();
  } catch {}
  tg?.HapticFeedback?.impactOccurred("medium");
  document.body.classList.add("spinning");

  balance -= bet;
  updateCredits();
  reels.forEach(({ cells }) =>
    cells.forEach((c) => c.classList.remove("win", "win-scale", "win-pulse"))
  );

  // small delay between reel starts (~150ms apart); each reel stops exactly
  // on its hit inside stop.mp3
  const spinSfx = playSpinSound();
  // whoosh dies into the first reel's stop (short 150ms fade to avoid a click)
  if (spinSfx) {
    const t0 = audioCtx.currentTime;
    const stopSec = (c) => SOUND_START + REEL_STOP_AT[c] / SOUND_RATE + AUDIO_OUT_LAG;
    // silence is HEARD at ~scheduled+AUDIO_OUT_LAG — pull it earlier by the
    // lag (plus the lead) so it lands just before the first visual stop
    const silentAt = t0 + stopSec(0) - AUDIO_OUT_LAG - SPIN_SFX_LEAD;
    spinSfx.gain.gain.setValueAtTime(1, silentAt - 0.2);
    spinSfx.gain.gain.linearRampToValueAtTime(0, silentAt);
    spinSfx.src.stop(silentAt + 0.05);
  }
  setTimeout(playStopSound, SOUND_START * 1000);
  // ask the server for this spin's result (finals + payout + new balance);
  // fall back to local randoms if the endpoint is unreachable (preview)
  const remote = await Promise.race([
    callApi("spin", { bet }),
    new Promise((r) => setTimeout(() => r(null), 3000)),
  ]);
  pendingResult = remote && Array.isArray(remote.finals) ? remote : null;
  const finalsGrid = pendingResult
    ? pendingResult.finals
    : [0, 1, 2].map(() => [randomEdge(), randomSymbol(), randomEdge()]);

  // schedule the result sounds so they're HEARD at the last reel's landing —
  // playVoice output reaches the ears ~AUDIO_OUT_LAG late, so we fire earlier
  const pre = evalFinals(finalsGrid);
  pendingWinScale = pre.midPay > 0 && pre.mult > 1;
  const landMs =
    (SOUND_START + REEL_STOP_AT[2] / SOUND_RATE + AUDIO_OUT_LAG) * 1000;
  const hearBase = landMs - AUDIO_OUT_LAG * 1000; // fire time → heard at landMs
  if (pre.midPay > 0) {
    // heard exactly at the visual landing — same instant the winners'
    // scale-up starts, so the jingle and the grow read as one event
    setTimeout(() => playWinSound(), Math.max(0, hearBase));
    // scale the 3 winners up on the same clock — don't wait for settle():
    // landed reels scale their cells, the still-settling last reel scales
    // its incoming strip symbol (strip[1] = final middle)
    if (pre.mult > 1)
      setTimeout(() => {
        reels.forEach((r) => {
          const s = r.strip && r.strip.isConnected ? r.strip.children[1] : r.cells[1];
          s?.classList.add("win-scale");
          r.cells[1].classList.add("win-scale");
        });
      }, Math.max(0, hearBase - 350));
    // triple 7 jackpot gets its own fanfare instead of congratulations
    setTimeout(
      () => playVoice(pre.jackpot ? "jackpot" : "congratulations"),
      Math.max(0, hearBase + 400)
    );
  }
  if (pre.maxN >= 4) {
    // strike running? the N-times voice waits until ALL tiles are struck
    // (fx +350ms, last tile's bolts end ~2.15s + 600ms per extra tile)
    const nDelay =
      pre.midPay > 0
        ? pre.mult > 1
          ? 2400 + (pre.nMult - 1) * 600
          : 1300
        : 250;
    setTimeout(
      () =>
        playVoice(pre.maxN >= 6 ? "6times" : pre.maxN === 5 ? "5times" : "4times"),
      Math.max(0, hearBase + nDelay)
    );
  }
  // total loss — 40% chance of a gago/ops taunt, 60% stay silent
  if (pre.midPay === 0 && pre.maxN < 4 && Math.random() < 0.4) {
    setTimeout(
      () => playVoice(Math.random() < 0.5 ? "gago" : "ops"),
      Math.max(0, hearBase + 700)
    );
  }

  const BLUR_CLEAR_LEAD = 1600; // blur is fully 0 this many ms before col 1 stops
  const firstStopAt =
    (SOUND_START + REEL_STOP_AT[0] / SOUND_RATE + AUDIO_OUT_LAG) * 1000;
  const anims = reels.map(
    (reel, c) =>
      new Promise((resolve) => {
        const delay = c * 150;
        const stopAt =
          (SOUND_START + REEL_STOP_AT[c] / SOUND_RATE + AUDIO_OUT_LAG) * 1000;
        setTimeout(
          () =>
            resolve(
              spinReel(
                reel,
                finalsGrid[c],
                stopAt - delay,
                c,
                firstStopAt - BLUR_CLEAR_LEAD - delay
              )
            ),
          delay
        );
      })
  );
  Promise.all(anims).then(settle);
}

// ===== lightning: electric ring on the 3 winning cells, then a strike into
// the multiplier tile — ported from "Lightning border.html" =====
const fxCv = document.getElementById("fx");
const fxCtx = fxCv.getContext("2d");
const LC = { CORE: "#fff3d6", MID: "#ffb347", GLOW: "#ff7a12" };
const FX_PAD = 46;
let fx = null;

function fxResize() {
  const r = frameInner.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  fxCv.width = Math.round((r.width + FX_PAD * 2) * dpr);
  fxCv.height = Math.round((r.height + FX_PAD * 2) * dpr);
  fxCv.style.width = `${r.width + FX_PAD * 2}px`;
  fxCv.style.height = `${r.height + FX_PAD * 2}px`;
  fxCv.style.left = `${-FX_PAD}px`;
  fxCv.style.top = `${-FX_PAD}px`;
}

function cellRect(c, r) {
  const f = frameInner.getBoundingClientRect();
  const el = cellAt(r, c).getBoundingClientRect();
  return { x: el.left - f.left, y: el.top - f.top, w: el.width, h: el.height };
}

// ordered points around a circle centered on (0,0) + outward normals —
// drawn bigger than the item so the electricity orbits *behind* it
function ringPts(r, step) {
  const n = Math.max(28, Math.round((Math.PI * 2 * r) / step));
  const p = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    p.push({ x: Math.cos(a) * r, y: Math.sin(a) * r, nx: Math.cos(a), ny: Math.sin(a) });
  }
  return p;
}

// midpoint displacement → jagged bolt
function jag(x0, y0, x1, y1, disp, iters) {
  let p = [[x0, y0], [x1, y1]];
  for (let it = 0; it < iters; it++) {
    const q = [p[0]];
    for (let i = 1; i < p.length; i++) {
      const [ax, ay] = p[i - 1], [bx, by] = p[i];
      const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1;
      const d = (Math.random() - 0.5) * 2 * disp;
      q.push([(ax + bx) / 2 - (dy / L) * d, (ay + by) / 2 + (dx / L) * d], p[i]);
    }
    p = q; disp *= 0.55;
  }
  return p;
}

function buildStrike(x0, y0, x1, y1) {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const main = jag(x0, y0, x1, y1, len * 0.14, 6);
  const ang = Math.atan2(y1 - y0, x1 - x0), branches = [];
  const n = 1 + ((Math.random() * 2) | 0); // 1–2 sub-branches — keep it readable
  for (let k = 0; k < n; k++) {
    const i = (main.length * (0.15 + Math.random() * 0.7)) | 0, p = main[i];
    const a = ang + (Math.random() < 0.5 ? -1 : 1) * (0.4 + Math.random() * 0.5);
    const bl = 20 + Math.random() * 25;
    branches.push(jag(p[0], p[1], p[0] + Math.cos(a) * bl, p[1] + Math.sin(a) * bl, bl * 0.2, 3));
  }
  return { main, branches };
}

function fxStroke(path, w, color, blur, a) {
  if (path.length < 2 || a <= 0) return;
  fxCtx.globalAlpha = a; fxCtx.lineWidth = w;
  fxCtx.strokeStyle = color; fxCtx.shadowColor = LC.GLOW; fxCtx.shadowBlur = blur;
  fxCtx.beginPath();
  fxCtx.moveTo(path[0][0], path[0][1]);
  for (let i = 1; i < path.length; i++) fxCtx.lineTo(path[i][0], path[i][1]);
  fxCtx.stroke();
}

// rebuild geometry ~14x/sec so everything flickers
function fxBuild() {
  const s = fx, N = s.pts.length;
  let v = 0;
  for (let i = 0; i < N; i++) { v += (Math.random() - 0.5) * 6; v *= 0.72; s.off[i] = v; }
  s.forks = [];
  const count = 5 + ((Math.random() * 4) | 0);
  for (let k = 0; k < count; k++) {
    const idx = (Math.random() * N) | 0, p = s.pts[idx];
    const base = 8 + s.off[idx], len = 12 + Math.random() * 22;
    const steps = 3 + ((Math.random() * 2) | 0);
    const drift = (Math.random() - 0.5) * 2, f = [];
    const tx = -p.ny, ty = p.nx;
    for (let st = 0; st <= steps; st++) {
      const d = base + (len * st) / steps, t = drift * st * 5 + (Math.random() - 0.5) * 7;
      f.push([p.x + p.nx * d + tx * t, p.y + p.ny * d + ty * t]);
    }
    s.forks.push({ idx, pts: f });
  }
  // one bolt per winning middle cell into each multiplier tile — tagged
  // with its tile index so tiles can be struck one by one
  s.strikes = [];
  s.multRects.forEach((mt, ti) => {
    const tx = mt.x + mt.w / 2, ty = mt.y + mt.h / 2;
    s.midRects.forEach((mr) => {
      const sx = mr.x + mr.w / 2, sy = mr.y + mr.h / 2;
      // bolt runs center-of-winner → center-of-tile: both ends sit under
      // the item art so it reads as the strike leaping between symbols
      s.strikes.push({
        tile: ti,
        ...buildStrike(
          sx + FX_PAD,
          sy + FX_PAD,
          tx + FX_PAD,
          ty + FX_PAD
        ),
      });
    });
  });
}

function fxPos(i, ox, oy) {
  const s = fx, N = s.pts.length, j = ((i % N) + N) % N, p = s.pts[j], d = 8 + s.off[j];
  return [p.x + p.nx * d + ox + FX_PAD, p.y + p.ny * d + oy + FX_PAD];
}

function drawRing(ox, oy, masterA) {
  const s = fx, N = s.pts.length, ringPath = [];
  for (let i = 0; i <= N; i++) ringPath.push(fxPos(i, ox, oy));
  fxStroke(ringPath, 1, LC.MID, 6, 0.28 * masterA);
  const len = Math.floor(N * 0.34), chunks = 10, per = Math.ceil(len / chunks);
  for (let c = 0; c < chunks; c++) {
    const a = Math.floor(s.head) - len + c * per, path = [];
    for (let i = 0; i <= per; i++) path.push(fxPos(a + i, ox, oy));
    const t = (c + 1) / chunks, al = t * t * masterA;
    fxStroke(path, 4, LC.GLOW, 18, al * 0.55);
    fxStroke(path, 2.2, LC.MID, 8, al * 0.9);
    fxStroke(path, 1.1, LC.CORE, 3, al);
  }
  for (const fk of s.forks) {
    const rel = ((Math.floor(s.head) - fk.idx) % N + N) % N;
    if (rel > len) continue;
    const fa = (1 - rel / len) * masterA;
    const fp = fk.pts.map((q) => [q[0] + ox + FX_PAD, q[1] + oy + FX_PAD]);
    fxStroke(fp, 2, LC.MID, 8, 0.55 * fa);
    fxStroke(fp, 0.9, LC.CORE, 2, 0.9 * fa);
  }
}

function drawImpact(x, y, a) {
  const r = 32, g = fxCtx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(214,235,255,${0.7 * a})`);
  g.addColorStop(0.35, `rgba(90,160,255,${0.32 * a})`);
  g.addColorStop(1, "rgba(40,110,255,0)");
  fxCtx.globalAlpha = 1; fxCtx.shadowBlur = 0; fxCtx.fillStyle = g;
  fxCtx.beginPath(); fxCtx.arc(x, y, r, 0, Math.PI * 2); fxCtx.fill();
}

function fxFrame(ts) {
  const s = fx;
  if (!s) return;
  const e = ts - s.t0;
  const nT = s.multRects.length;
  // tiles are struck one by one, ~600ms apart; each strike runs ~1s
  const DUR = nT ? 2200 + (nT - 1) * 600 : 1400;
  if (e - s.lastBuild > 70) { fxBuild(); s.lastBuild = e; }
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  fxCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  fxCtx.clearRect(0, 0, fxCv.width, fxCv.height);
  fxCtx.lineJoin = "round"; fxCtx.lineCap = "round";
  const ringA = Math.min(1, e / 180) * Math.min(1, (DUR - e) / 280);
  s.midRects.forEach((r) => drawRing(r.x + r.w / 2, r.y + r.h / 2, ringA));
  // tile i's bolts ignite at 800 + i*600 (after the winners' grow-up reads)
  // — each tile gets its own window, zap and shake
  const tileA = (ti) => {
    const S = 800 + ti * 600;
    return Math.min(1, Math.max(0, (e - S) / 120)) * Math.min(1, Math.max(0, (S + 1000 - e) / 300));
  };
  s.strikes.forEach((st) => {
    const sA = tileA(st.tile);
    if (sA <= 0) return;
    if (!s.zappedTiles.has(st.tile)) {
      s.zappedTiles.add(st.tile);
      playZap();
      // add this tile's value to the win-bar total — ×2, then ×10 …
      s.runMult += s.multVals[st.tile];
      showWinBar(`×${s.runMult}`);
    }
    fxStroke(st.main, 4.5, LC.GLOW, 22, sA * 0.5);
    fxStroke(st.main, 2.2, LC.MID, 10, sA * 0.9);
    fxStroke(st.main, 1.1, LC.CORE, 4, sA);
    st.branches.forEach((b) => {
      fxStroke(b, 1.6, LC.MID, 8, sA * 0.5);
      fxStroke(b, 0.8, LC.CORE, 3, sA * 0.85);
    });
    const [ex, ey] = st.main[st.main.length - 1];
    drawImpact(ex, ey, sA);
  });
  s.multEls.forEach((el, i) => el.classList.toggle("hit", tileA(i) > 0.3));
  if (e < DUR) requestAnimationFrame(fxFrame);
  else {
    s.multEls.forEach((el) => el.classList.remove("hit"));
    // bolts finished — swap the static scale for the heartbeat pulse, and
    // fire every delayed scatter pulse in sync
    s.midEls.forEach((el) => {
      el.classList.remove("win-scale");
      el.classList.add("win-pulse");
    });
    (s.delayedWin || []).forEach((el) => el.classList.add("win"));
    if (s.finalPayout > 0) showWinBarTotal(s.finalPayout, s.finalMult);
    fxCtx.clearRect(0, 0, fxCv.width, fxCv.height);
    fx = null;
  }
}

// rings on the 3 middle winners; bolts strike every multiplier tile in
// ascending order — the win bar accumulates their values as each is hit
function lightningWin(mult, delayedWin = [], payout = 0) {
  fxResize();
  const midRects = [0, 1, 2].map((c) => cellRect(c, 1));
  const midEls = reels.map((r) => r.cells[1]);
  const multRects = [], multEls = [], multVals = [];
  if (mult > 1) {
    const tiles = [];
    reels.forEach((reel, c) =>
      [0, 2].forEach((r) => {
        const v = multOf(reel.cells[r].dataset.sym);
        if (v >= 2) tiles.push({ v, el: reel.cells[r], c, r });
      })
    );
    tiles.sort((a, b) => a.v - b.v);
    tiles.forEach((t) => {
      multRects.push(cellRect(t.c, t.r));
      multEls.push(t.el);
      multVals.push(t.v);
    });
  }
  fx = {
    t0: performance.now(), lastBuild: 0, head: 0,
    midRects, midEls, multRects, multEls, multVals, delayedWin,
    runMult: 0,
    finalPayout: payout,
    finalMult: mult,
    // radius ~28% of cell width — small circle fully hidden under the item
    // art; only the forks and glow leak out around the symbol edges
    pts: ringPts(midRects[0].w * 0.18, 4),
    off: null, forks: [], strikes: [], zappedTiles: new Set(),
  };
  fx.off = new Float32Array(fx.pts.length);
  fxBuild();
  requestAnimationFrame(fxFrame);
}

// win bar pinned to the top of the machine — blue pill, gold border.
// During a strike it accumulates the multiplier (×2 → ×10); at the end it
// shows the spin's total win. Hidden again on the next spin.
const winBar = document.getElementById("win-bar");
const winBarTxt = document.getElementById("win-bar-txt");
let winBarRaf = 0, winBarTimer = 0;
function showWinBar(html) {
  if (!winBar) return; // stale cached HTML — never break a spin over the bar
  winBar.classList.remove("closing");
  winBarTxt.innerHTML = html;
  winBar.classList.add("show");
}
function hideWinBar() {
  if (!winBar) return;
  cancelAnimationFrame(winBarRaf);
  clearTimeout(winBarTimer);
  // fade while still collapsed — dropping .closing in the same tick would
  // re-expand the bar before it can fade
  winBar.classList.remove("show");
  setTimeout(() => {
    winBar.classList.remove("closing");
    winBar.style.maxWidth = "";
  }, 250);
}
// slides the bar's current text up + out, then runs cb with fresh text —
// used so the accumulated ×N exits upward before the win amount appears
function swapWinBarText(cb) {
  if (!winBar || !winBar.classList.contains("show")) { cb(); return; }
  winBarTxt.classList.add("txt-out");
  winBarTimer = setTimeout(() => {
    cb();
    winBarTxt.classList.remove("txt-out");
    winBarTxt.classList.add("txt-in");
    void winBarTxt.offsetWidth; // snap to the start position, then animate in
    winBarTxt.classList.remove("txt-in");
  }, 260);
}

// total win with a rolling count-up, then hold and close by sliding up
// while the width collapses to 0
function showWinBarTotal(payout, mult) {
  if (!winBar) return;
  clearTimeout(winBarTimer);
  swapWinBarText(() => {
    showWinBar(fmt(0));
    playWinbarSound(); // tally tick plays while the amount rolls up
    const t0 = performance.now(), dur = 900;
    const tick = (t) => {
      const p = Math.min(1, (t - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 3); // fast start, soft landing
      winBarTxt.innerHTML = fmt(Math.round(payout * eased));
      if (p < 1) {
        winBarRaf = requestAnimationFrame(tick);
      } else {
        winBarTimer = setTimeout(() => {
          // freeze the real width first so the collapse starts moving
          // immediately — a % max-width has dead travel before it shrinks
          winBar.style.maxWidth = `${winBar.offsetWidth}px`;
          void winBar.offsetWidth;
          winBar.classList.add("closing");
          winBarTimer = setTimeout(hideWinBar, 500);
        }, 1800);
      }
    };
    winBarRaf = requestAnimationFrame(tick);
  });
}

// ===== coin shower: transparent canvas, coins launched from left/bottom/right =====
const coinCv = document.getElementById("coins");
const coinCtx = coinCv.getContext("2d");
const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const coinImg = new Image();
coinImg.src = "credits.png";
let cW = 0, cH = 0, cG = 2000;
let coinList = [];
let coinRunning = false;
let coinLast = 0;

function resizeCoins() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cW = window.innerWidth;
  cH = window.innerHeight;
  coinCv.width = Math.round(cW * dpr);
  coinCv.height = Math.round(cH * dpr);
  coinCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  cG = Math.max(1400, cH * 2.6);
}
window.addEventListener("resize", resizeCoins);
resizeCoins();

function makeCoin(src, delay) {
  const r = Math.max(14, Math.min(24, cW * 0.024)) * (0.8 + Math.random() * 0.5);
  const c = {
    delay, r,
    spin: Math.random() * 6.28,
    spinV: (9 + Math.random() * 11) * (Math.random() < 0.5 ? -1 : 1),
    tilt: (Math.random() - 0.5) * 0.6,
    tiltV: (Math.random() - 0.5) * 3,
    x: 0, y: 0, vx: 0, vy: 0,
  };
  let rise;
  if (src === "bottom") {
    c.x = cW * (0.08 + Math.random() * 0.84);
    c.y = cH + r + 10;
    rise = cH * (0.55 + Math.random() * 0.4);
    c.vx = (Math.random() - 0.5) * Math.min(420, cW * 0.5);
  } else {
    const dir = src === "left" ? 1 : -1;
    c.x = src === "left" ? -r - 10 : cW + r + 10;
    c.y = cH * (0.45 + Math.random() * 0.5);
    rise = cH * (0.2 + Math.random() * 0.35);
    c.vx = (dir * (cW * (0.18 + Math.random() * 0.42))) / 1.4;
  }
  c.vy = -Math.sqrt(2 * cG * rise);
  return c;
}

// bigger wins throw more coins (log-scaled, capped for performance)
function coinShower(pay) {
  const total = Math.round(Math.min(120, 30 + Math.log10(Math.max(10, pay)) * 12) * (reducedMotion ? 0.25 : 1));
  const srcs = ["left", "bottom", "right"];
  for (let i = 0; i < total; i++) coinList.push(makeCoin(srcs[i % 3], Math.random() * 1.1));
  if (!coinRunning) {
    coinRunning = true;
    coinLast = performance.now();
    requestAnimationFrame(coinFrame);
  }
}

function coinFrame(now) {
  const dt = Math.min(0.033, (now - coinLast) / 1000);
  coinLast = now;
  coinCtx.clearRect(0, 0, cW, cH);
  const alive = [];
  for (const c of coinList) {
    if (c.delay > 0) { c.delay -= dt; alive.push(c); continue; }
    c.vy += cG * dt;
    c.x += c.vx * dt;
    c.y += c.vy * dt;
    c.spin += c.spinV * dt;
    c.tilt += c.tiltV * dt;
    if ((c.vy > 0 && c.y > cH + c.r + 40) || c.x < -160 || c.x > cW + 160) continue;
    alive.push(c);
    drawCoin(c);
  }
  coinList = alive;
  if (coinList.length) requestAnimationFrame(coinFrame);
  else { coinRunning = false; coinCtx.clearRect(0, 0, cW, cH); }
}

// the coin flips in 3D: face width follows |cos(spin)|, edge-on = thin gold bar
function drawCoin(c) {
  const s = Math.cos(c.spin), w = Math.abs(s), r = c.r;
  coinCtx.save();
  coinCtx.translate(c.x, c.y);
  coinCtx.rotate(c.tilt);
  if (w < 0.14 || !coinImg.complete) {
    coinCtx.fillStyle = "#b8820a";
    coinCtx.fillRect(-r * 0.14, -r, r * 0.28, r * 2);
    coinCtx.fillStyle = "#ffe48a";
    coinCtx.fillRect(-r * 0.04, -r, r * 0.08, r * 2);
  } else {
    if (s < 0) coinCtx.scale(-1, 1); // back face = mirrored front
    coinCtx.drawImage(coinImg, -r * w, -r, r * 2 * w, r * 2);
  }
  coinCtx.restore();
}

// ===== info modal — paytable generated from the same constants =====
const SYM_NAME = {
  seven: "7 (Jackpot)",
  7: "Diamond",
  chest: "Chest",
  "3-bar": "3 Bar",
  "2-bar": "2 Bar",
  "1-bar": "1 Bar",
  bell: "Bell",
  cherry: "Cherry",
};
const fmt = (n) => `₱${n.toLocaleString("en-US")}`;

function buildInfo() {
  const row = (a, b) => `<tr><td>${a}</td><td>${b}</td></tr>`;
  let html = `<h2>MIDDLE ROW</h2><p>Three of a kind on the center row:</p><table>`;
  for (const s of ["seven", "7", "chest", "bell", "cherry"])
    html += row(`${SYM_NAME[s]} ×3`, fmt(TRIPLE_PAY[s]));
  html += `</table><p>Three Bar symbols in any order:</p><table>`;
  for (const [k, v] of Object.entries(BAR_PAY))
    html += row(k.split(",").map((n) => `${n} Bar`).join(" + "), fmt(v));
  html += `</table><h2>SCATTERS</h2><p>Same symbol anywhere on the grid — all matches pay:</p>
    <table><tr><th></th><th>4 pcs</th><th>5 pcs</th><th>6+ pcs</th></tr>`;
  for (const s of ["seven", "7", "chest", "3-bar", "2-bar", "1-bar", "bell", "cherry"]) {
    const t = SCATTER_PAY[s];
    html += `<tr><td>${SYM_NAME[s]}</td><td>${fmt(t[4])}</td><td>${fmt(t[5])}</td><td>${fmt(t[6])}</td></tr>`;
  }
  html += `</table><h2>POWER TILES</h2>
    <p>Tiles like ×2, ×8, ×100 can only land in the <b>top &amp; bottom</b> rows.
    On their own they do nothing — they only wake up when the <b>middle row wins</b>.</p>
    <p>When that happens, lightning strikes each tile one at a time (smallest first)
    and the numbers <b>add up</b>: a ×2 plus a ×8 = <b>×10</b>. That total multiplies
    your <b>entire</b> win — middle row + scatters together.</p>
    <p><b>Example:</b> you win ₱5,000 and the grid shows a ×2 and a ×8 → ×10 → <b>₱50,000</b>.
    No middle-row win = the tiles are just decoration.
    Small tiles land often, big ones are rare — ×100 almost never shows.</p>
    <h2>ODDS</h2>
    <p>Each of the 9 cells spins its own 1,000-sided wheel. Cherry is the most common
    symbol; the Jackpot 7 is the rarest on the middle row (~10% per reel), so triple-7
    lands roughly once in 1,000 spins.</p>
    <p>Power tiles share the top &amp; bottom wheels — about a 12% chance per edge cell,
    mostly small ones (×2 common, ×100 only ~4 in 1,000).</p>
    <p><b>How a win pays:</b> middle-row triple + every scatter (4+ matching symbols
    anywhere on the grid) — all added together, then multiplied by the power tiles
    if the middle row won.</p>
    <p>Bets: ₱100 / ₱500 / ₱1,000 / ₱2,500 / ₱4,000. Bigger bets boost <b>all</b>
    winnings ×1 → ×1.4 → ×1.5 → ×2 → ×2.5 — e.g. a ₱50,000 win at ×2.5 pays ₱125,000.</p>`;
  document.getElementById("info-body").innerHTML = html;
}

const infoEl = document.getElementById("info");
document.getElementById("info-btn").addEventListener("click", () => {
  buildInfo();
  infoEl.hidden = false;
});
document.getElementById("info-close").addEventListener("click", () => (infoEl.hidden = true));
infoEl.addEventListener("click", (e) => {
  if (e.target === infoEl) infoEl.hidden = true;
});

const oddsEl = document.getElementById("odds");
betBtn.addEventListener("click", () => {
  if (spinning) return;
  betIdx = (betIdx + 1) % BETS.length;
  const { bet, mult } = currentBet();
  betBtn.innerHTML = `BET <b>${bet.toLocaleString("en-US")}</b>`;
  oddsEl.innerHTML = `ODDS <b>×${mult}</b>`;
  oddsEl.classList.toggle("hot", mult > 1);
});

// ===== history modal — last 50 spins from the server =====
const histEl = document.getElementById("history");
document.getElementById("hist-btn").addEventListener("click", async () => {
  const body = document.getElementById("hist-body");
  body.innerHTML = "<h2>HISTORY</h2><p>Loading…</p>";
  histEl.hidden = false;
  const r = await callApi("history", {});
  if (!r) {
    body.innerHTML = "<h2>HISTORY</h2><p>Not available outside Telegram.</p>";
    return;
  }
  const rows = (r.spins || [])
    .map((s) => {
      const left =
        s.bet === 0 ? (s.label ? "GKas" : "DEPOSIT") : `₱${s.bet.toLocaleString("en-US")}`;
      const mid =
        s.bet === 0
          ? `${s.payout < 0 ? "−" : "+"}₱${Math.abs(s.payout).toLocaleString("en-US")}`
          : s.payout > 0
            ? `+₱${s.payout.toLocaleString("en-US")}`
            : `−₱${s.bet.toLocaleString("en-US")}`;
      const cls = s.bet === 0 ? (s.payout < 0 ? "lost" : "won") : s.payout > 0 ? "won" : "lost";
      const tag = s.label
        ? `<span class="tag">${s.label}</span>`
        : `<span class="tag dim">—</span>`;
      return `<div class="hist-row"><span class="bet">${left}</span>` +
        tag +
        `<span class="${cls}">${mid}</span>` +
        `<span class="bet">→ ₱${s.balance.toLocaleString("en-US")}</span></div>`;
    })
    .join("");
  body.innerHTML = `<h2>HISTORY</h2>${rows || "<p>No spins yet.</p>"}`;
});
document.getElementById("hist-close").addEventListener("click", () => (histEl.hidden = true));
histEl.addEventListener("click", (e) => {
  if (e.target === histEl) histEl.hidden = true;
});

spinBtn.addEventListener("click", () => spin());

// ===== jackpot flames — ported from "Flaming Border.html" =====
// a tap on the banner ramps particle fire around its edges for ~2.5s,
// then eases out; the border glow flickers via the --lvl CSS var
(() => {
  const cv = document.getElementById("fire");
  const box = document.getElementById("jackpot");
  if (!cv || !box) return;
  const ctx = cv.getContext("2d");
  let W, H, rect;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = innerWidth; H = innerHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    measure();
  }
  // the banner's rect is re-measured every frame — mobile layouts shift
  // late (image load, Telegram viewport changes) and a stale rect put the
  // fire at the bottom of the screen
  function measure() {
    const r = box.getBoundingClientRect();
    rect = { x: r.left, y: r.top, w: r.width, h: r.height };
  }
  addEventListener("resize", resize);
  resize();

  // pre-rendered soft sprites per cooling stage:
  // white-yellow → orange → red → dark ember
  const stops = [
    [0.00, [255, 250, 210]],
    [0.25, [255, 200, 60]],
    [0.55, [255, 95, 15]],
    [0.85, [150, 25, 0]],
    [1.00, [60, 10, 0]],
  ];
  function colorAt(t) {
    for (let i = 1; i < stops.length; i++) {
      if (t <= stops[i][0]) {
        const [t0, c0] = stops[i - 1], [t1, c1] = stops[i];
        const k = (t - t0) / (t1 - t0);
        return c0.map((v, j) => Math.round(v + (c1[j] - v) * k));
      }
    }
    return stops[stops.length - 1][1];
  }
  const STAGES = 40, sprites = [];
  for (let i = 0; i < STAGES; i++) {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d");
    const [r, gr, b] = colorAt(i / (STAGES - 1));
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, `rgba(${r},${gr},${b},1)`);
    grad.addColorStop(0.4, `rgba(${r},${gr},${b},.5)`);
    grad.addColorStop(1, `rgba(${r},${gr},${b},0)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    sprites.push(c);
  }

  // random point on the banner's edge, with outward normal + height factor
  function pick() {
    const { x, y, w, h } = rect;
    let d = Math.random() * 2 * (w + h);
    if (d < w) return { x: x + d, y, nx: 0, ny: -1, k: 1.15 };       // top: tallest
    d -= w;
    if (d < h) return { x: x + w, y: y + d, nx: 1, ny: 0, k: 1 };     // right
    d -= h;
    if (d < w) return { x: x + w - d, y: y + h, nx: 0, ny: 1, k: 0.4 }; // bottom
    d -= w;
    return { x, y: y + h - d, nx: -1, ny: 0, k: 1 };                  // left
  }

  const parts = [], sparks = [];
  let acc = 0, sparkAcc = 0, time = 0, last = performance.now(), lvl = 0;

  function spawn() {
    const p = pick();
    parts.push({
      // a few px INSIDE the edge — the canvas sits behind the banner so most
      // of each flame hides under the image and only tongues peek out
      x: p.x + (Math.random() - 0.5) * 3 - p.nx * 4,
      y: p.y - p.ny * 4,
      vx: p.nx * (1.5 + Math.random() * 4) + (Math.random() - 0.5) * 4,
      vy: p.ny * (6 + Math.random() * 14) - (25 + Math.random() * 40) * p.k,
      life: (0.3 + Math.random() * 0.3) * p.k * (0.35 + 0.65 * lvl),
      age: 0,
      size: 2.5 + Math.random() * 3,
      seed: Math.random() * 6.28,
    });
  }
  function spawnSpark() {
    const p = pick();
    sparks.push({
      x: p.x, y: p.y,
      vx: (Math.random() - 0.5) * 30,
      vy: -(40 + Math.random() * 70),
      life: 0.5 + Math.random() * 0.6,
      age: 0,
      s: 0.5 + Math.random() * 0.9,
      seed: Math.random() * 6.28,
    });
  }

  function tick(dt) {
    time += dt;
    ctx.clearRect(0, 0, W, H);

    // ambient light cast by the fire, flickering
    const fl = lvl * (0.06 + 0.02 * (Math.sin(time * 13) + Math.sin(time * 7.3) + Math.sin(time * 3.1)) / 3);
    const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2, R = Math.max(rect.w, rect.h) * 1.2;
    const amb = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
    amb.addColorStop(0, `rgba(255,90,10,${fl})`);
    amb.addColorStop(1, "rgba(255,60,0,0)");
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = amb;
    ctx.fillRect(0, 0, W, H);

    // emit — flame density scales with the banner's perimeter
    const perim = 2 * (rect.w + rect.h);
    acc += perim * 1.8 * lvl * dt;
    while (acc >= 1) { spawn(); acc--; }
    sparkAcc += 28 * lvl * dt;
    while (sparkAcc >= 1) { spawnSpark(); sparkAcc--; }

    // flames (additive so overlaps burn brighter)
    ctx.globalCompositeOperation = "lighter";
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.age += dt;
      if (p.age >= p.life) { parts[i] = parts[parts.length - 1]; parts.pop(); continue; }
      const t = p.age / p.life;
      p.vy -= 90 * dt;                                   // buoyancy
      p.vx += Math.sin(time * 7 + p.seed) * 30 * dt;     // sway
      p.vx *= 1 - 1.2 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      const r = p.size * (1 - t * 0.75);
      ctx.globalAlpha = Math.min(1, (1 - t) * 1.4) * 0.85;
      ctx.drawImage(sprites[Math.min(STAGES - 1, (t * STAGES) | 0)], p.x - r, p.y - r, r * 2, r * 2);
    }

    // embers
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.age += dt;
      if (s.age >= s.life) { sparks[i] = sparks[sparks.length - 1]; sparks.pop(); continue; }
      const t = s.age / s.life;
      s.vx += Math.sin(time * 5 + s.seed) * 60 * dt;
      s.x += s.vx * dt; s.y += s.vy * dt;
      ctx.globalAlpha = (1 - t) * (0.6 + 0.4 * Math.sin(time * 30 + s.seed));
      ctx.fillStyle = `rgb(255,${(190 - 90 * t) | 0},60)`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.s, 0, 6.2832);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // tap → burn hot for ~1.3s (matched to the fire.mp3 whoosh), then ease
  // out until nothing is left
  let running = false, runUntil = 0;
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    measure(); // keep flames glued to the banner wherever layout lands
    const target = now < runUntil ? 1 : 0;
    lvl += (target - lvl) * Math.min(1, dt * (target ? 6 : 2.2));
    if (!target && lvl < 0.01) lvl = 0;
    box.style.setProperty("--lvl", lvl.toFixed(3));
    tick(dt);
    if (target || lvl > 0 || parts.length || sparks.length) requestAnimationFrame(frame);
    else running = false;
  }
  function ignite() {
    resize(); // layout may have shifted since load
    playFire();
    runUntil = performance.now() + 1300;
    if (running) return;
    running = true;
    last = performance.now();
    requestAnimationFrame(frame);
  }
  box.addEventListener("pointerdown", ignite);
})();

// intro → game: the PLAY tap is also the audio-unlock gesture
const introEl = document.getElementById("intro");
document.getElementById("start-btn").addEventListener("click", async () => {
  try {
    if (audioCtx.state === "suspended") await audioCtx.resume();
  } catch {}
  introEl.classList.add("hide");
  setTimeout(() => introEl.remove(), 500);
});
