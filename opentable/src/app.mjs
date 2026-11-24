// The Reservation Sniper app: a small web page on this Mac (http://localhost:4747) that drives the bot.
import { exec } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { openBrowser } from './opentable.mjs';
import { checkConfig, findRestaurantId, platformOf, runSnipe } from './sniper.mjs';

const PORT = 4747;
const CONFIG = new URL('../config.json', import.meta.url);
const UI = new URL('./app.html', import.meta.url);

const loadConfig = () => {
  try {
    return JSON.parse(readFileSync(CONFIG, 'utf8'));
  } catch {
    return {};
  }
};
const saveConfig = (c) => writeFileSync(CONFIG, JSON.stringify(c, null, 2));

let job = null; // { label, abort }
const history = [];
const listeners = new Set();
function log(msg) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg.replace(/\x07/g, '')}`;
  console.log(line);
  history.push(line);
  if (history.length > 300) history.shift();
  for (const res of listeners) res.write(`data: ${JSON.stringify({ line, busy: job?.label ?? null })}\n\n`);
}
function setJob(next) {
  job = next;
  for (const res of listeners) res.write(`data: ${JSON.stringify({ busy: job?.label ?? null })}\n\n`);
}

function start(label, fn) {
  if (job) throw new Error(`Already busy: ${job.label}. Press Stop first.`);
  const abort = new AbortController();
  setJob({ label, abort });
  fn(abort.signal)
    .then((msg) => msg && log(msg))
    .catch((err) => log(`Error: ${err.message}`))
    .finally(() => setJob(null));
}

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let s = '';
    req.on('data', (c) => (s += c));
    req.on('end', () => {
      try {
        resolve(s ? JSON.parse(s) : {});
      } catch (e) {
        reject(e);
      }
    });
  });

const routes = {
  'GET /': (req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(readFileSync(UI));
  },
  'GET /api/config': () => ({ config: loadConfig(), busy: job?.label ?? null, history }),
  'GET /api/events': (req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    res.write(`data: ${JSON.stringify({ busy: job?.label ?? null })}\n\n`);
    listeners.add(res);
    req.on('close', () => listeners.delete(res));
  },
  'POST /api/save': async (req) => {
    const config = { ...loadConfig(), ...(await readBody(req)) };
    saveConfig(config);
    return { config };
  },
  'POST /api/find': async (req) => {
    const url = String((await readBody(req)).url ?? '').trim();
    const platform = platformOf(url);
    if (!platform) throw new Error('Paste a link from opentable.com or doordash.com.');
    if (platform === 'doordash') {
      const config = { ...loadConfig(), platform, restaurantUrl: url, restaurantId: null };
      saveConfig(config);
      log('DoorDash restaurant saved.');
      return { config };
    }
    if (job) throw new Error(`Already busy: ${job.label}. Press Stop first.`);
    setJob({ label: 'Looking up the restaurant', abort: new AbortController() });
    try {
      log('Looking up the restaurant...');
      const restaurantId = await findRestaurantId(url);
      const config = { ...loadConfig(), platform, restaurantUrl: url, restaurantId };
      saveConfig(config);
      log(`Found it (restaurant ID ${restaurantId}).`);
      return { config };
    } finally {
      setJob(null);
    }
  },
  'POST /api/login': () => {
    start('Logging in', async (signal) => {
      const { context, page } = await openBrowser();
      signal.addEventListener('abort', () => context.close().catch(() => {}));
      const site = loadConfig().platform === 'doordash' ? 'https://www.doordash.com/' : 'https://www.opentable.com/';
      await page.goto(site);
      log(`Log in to ${site.includes('doordash') ? 'DoorDash' : 'OpenTable'} in the Chrome window, then close that window.`);
      await new Promise((resolve) => context.on('close', resolve));
      return 'Login saved.';
    });
    return {};
  },
  'POST /api/run': async (req) => {
    const { mode } = await readBody(req);
    const config = loadConfig();
    const dryRun = mode === 'test';
    checkConfig(config, { dryRun });
    if (mode === 'schedule' && !(new Date(config.dropTime).getTime() > Date.now())) {
      throw new Error('The release time is in the past. Use "Book now" for tables that are already open.');
    }
    const labels = { test: 'Testing (will not book)', now: 'Booking now', schedule: 'Waiting for the release' };
    start(labels[mode], (signal) => runSnipe(config, { dryRun, now: mode !== 'schedule', log, signal }));
    return {};
  },
  'POST /api/stop': () => {
    job?.abort.abort();
    return {};
  },
};

createServer(async (req, res) => {
  const route = routes[`${req.method} ${req.url.split('?')[0]}`];
  if (!route) {
    res.writeHead(404).end();
    return;
  }
  // Only accept requests from this app's own page.
  if (req.method === 'POST' && req.headers.origin && req.headers.origin !== `http://localhost:${PORT}`) {
    res.writeHead(403).end();
    return;
  }
  try {
    const out = await route(req, res);
    if (out !== undefined) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(out));
    }
  } catch (err) {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
})
  .on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log('The app is already running; opening it.');
      exec(`open http://localhost:${PORT}`);
      setTimeout(() => process.exit(0), 500);
    } else throw err;
  })
  .listen(PORT, '127.0.0.1', () => {
    console.log(`Reservation Sniper is running at http://localhost:${PORT}. Keep this window open.`);
    if (process.platform === 'darwin' && !process.env.NO_OPEN) exec(`open http://localhost:${PORT}`);
  });
