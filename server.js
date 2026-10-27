import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { timingSafeEqual } from 'node:crypto';
import puppeteer from 'puppeteer';

const PORT = Number(process.env.PORT) || 3000;
const API_KEY = process.env.API_KEY;
if (!API_KEY) {
  console.error('API_KEY env var is required');
  process.exit(1);
}

const TEMPLATE = await readFile(new URL('./templates/gkas.html', import.meta.url), 'utf8');
const RECEIPT_TEMPLATE = await readFile(new URL('./templates/receipt.html', import.meta.url), 'utf8');
// inlined as a data URI — setContent has no base URL to resolve relative srcs
const ICON = `data:image/png;base64,${await readFile(
  new URL('./templates/icon.png', import.meta.url)
).then((b) => b.toString('base64'))}`;

// one shared browser — launching Chromium per request is far too slow
let browserP;
const getBrowser = () =>
  (browserP ??= puppeteer
    .launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] })
    .then((b) => {
      b.on('disconnected', () => (browserP = null));
      return b;
    })
    // a failed launch must not poison every future request
    .catch((e) => ((browserP = null), Promise.reject(e))));

const fmt = (n) => '₱ ' + Math.round(Number(n) || 0).toLocaleString('en-PH');
const fmtNum = (n) => Math.round(Number(n) || 0).toLocaleString('en-PH');

// "Juan Dela Cruz" -> "Ju•••••• C." (mirrors the receipt template)
const maskName = (full) => {
  const parts = String(full || 'Player').trim().split(/\s+/);
  const first = parts[0] || '';
  const last = parts.length > 1 ? parts[parts.length - 1][0].toUpperCase() + '.' : '';
  return first.slice(0, 2) + '•'.repeat(Math.max(first.length - 2, 3)) + (last ? ' ' + last : '');
};
const genRef = () => {
  const d = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');
  return `${d(4)} ${d(3)} ${d(6)}`;
};
const dateStr = () =>
  new Date().toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });

async function renderGkas({ name, balance, number }) {
  const page = await (await getBrowser()).newPage();
  try {
    await page.setViewport({ width: 380, height: 600, deviceScaleFactor: 2 });
    await page.setContent(TEMPLATE, { waitUntil: 'networkidle0', timeout: 8000 }).catch(() =>
      page.setContent(TEMPLATE, { waitUntil: 'domcontentloaded' })
    );
    // set via the DOM (textContent) so names can never inject markup
    await page.evaluate(
      (n, b, num, icon) => {
        document.getElementById('hello').textContent = `Hello, ${n}!`;
        document.getElementById('balance').textContent = b;
        document.getElementById('number').textContent = num;
        document.getElementById('logo-img').src = icon;
      },
      String(name || 'Player').slice(0, 40),
      fmt(balance),
      String(number || '').slice(0, 20),
      ICON
    );
    await page.evaluate(() => document.fonts.ready);
    const card = await page.$('#card');
    return await card.screenshot({ type: 'png', omitBackground: true });
  } finally {
    await page.close();
  }
}

async function renderReceipt({ toName, toNumber, amount }) {
  const page = await (await getBrowser()).newPage();
  try {
    await page.setViewport({ width: 404, height: 600, deviceScaleFactor: 2 });
    await page.setContent(RECEIPT_TEMPLATE, { waitUntil: 'networkidle0', timeout: 8000 }).catch(() =>
      page.setContent(RECEIPT_TEMPLATE, { waitUntil: 'domcontentloaded' })
    );
    await page.evaluate(
      (name, num, amt, total, ref, date) => {
        document.getElementById('toName').textContent = name;
        document.getElementById('toNumber').textContent = num;
        document.getElementById('amount').textContent = amt;
        document.getElementById('total').textContent = total;
        document.getElementById('ref').textContent = ref;
        document.getElementById('date').textContent = date;
      },
      maskName(String(toName || 'Player').slice(0, 40)),
      String(toNumber || '').slice(0, 20),
      fmtNum(amount),
      fmt(amount),
      genRef(),
      dateStr()
    );
    await page.evaluate(() => document.fonts.ready);
    const card = await page.$('#receipt');
    return await card.screenshot({ type: 'png', omitBackground: true });
  } finally {
    await page.close();
  }
}

const authed = (req) => {
  const got = Buffer.from(req.headers['x-api-key'] || '');
  const want = Buffer.from(API_KEY);
  return got.length === want.length && timingSafeEqual(got, want);
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let s = '';
    req.on('data', (c) => {
      s += c;
      if (s.length > 10_000) reject(new Error('body too large'));
    });
    req.on('end', () => resolve(s));
  });

http
  .createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200).end('ok');
        return;
      }
      if (req.method === 'POST' && (req.url === '/gkas' || req.url === '/receipt')) {
        if (!authed(req)) return void res.writeHead(401).end('unauthorized');
        const input = JSON.parse((await readBody(req)) || '{}');
        const png = req.url === '/gkas' ? await renderGkas(input) : await renderReceipt(input);
        res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': png.length });
        res.end(png);
        return;
      }
      res.writeHead(404).end('not found');
    } catch (e) {
      console.error(e);
      res.writeHead(500).end('render failed');
    }
  })
  .listen(PORT, () => console.log(`slotsbackend listening on :${PORT}`));
