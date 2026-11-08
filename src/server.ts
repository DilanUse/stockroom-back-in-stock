import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { isLoopback, openDemo } from './demo.ts';
import { demoPage, demoScript } from './demo-view.ts';
import { openStore } from './store.ts';
import { adminPage, embedPage, embedScript, restockEmail } from './views.ts';

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Set ${name} before starting Stockroom.`);
  return value;
}

function upstreamUrl(name: string) {
  const url = new URL(required(name));
  if (!['http:', 'https:'].includes(url.protocol) || url.search || url.hash || url.username || url.password) {
    throw new Error(`${name} must be an HTTP or HTTPS base URL.`);
  }
  return url.href.replace(/\/+$/, '');
}

function adminPassword(dataDir: string) {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;
  const file = join(dataDir, 'admin-password');
  try {
    writeFileSync(file, randomBytes(24).toString('base64url'), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  return readFileSync(file, 'utf8').trim();
}

function equalSecret(given: string, expected: string) {
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(given), digest(expected));
}

class RequestError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function readJson(req: IncomingMessage) {
  if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new RequestError(415, 'Use Content-Type: application/json.');
  }
  let size = 0;
  const chunks: Buffer[] = [];
  // Keep the socket open long enough to return a 413 to the client.
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > 8_192) {
      req.resume();
      throw new RequestError(413, 'Request body is too large.');
    }
    chunks.push(chunk);
  }
  let body: unknown;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new RequestError(400, 'Send a valid JSON object.');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new RequestError(400, 'Send a valid JSON object.');
  }
  return body as Record<string, unknown>;
}

function json(res: ServerResponse, status: number, body: object) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function html(res: ServerResponse, body: string, { embed = false, preview = false } = {}) {
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': `default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors ${embed ? '*' : "'none'"}${preview ? "; frame-src 'self'" : ''}`,
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

function skuOf(value: unknown) {
  if (typeof value !== 'string') return '';
  const sku = value.trim().toUpperCase();
  return /^[A-Z0-9][A-Z0-9._-]{0,63}$/.test(sku) ? sku : '';
}

function emailOf(value: unknown) {
  if (typeof value !== 'string') return '';
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@<>]+@[^\s@<>.]+(?:\.[^\s@<>.]+)+$/.test(email) ? email : '';
}

const stockUrl = upstreamUrl('STOCK_API_URL');
const stockKey = required('STOCK_API_KEY');
const mailUrl = upstreamUrl('RESEND_BASE_URL');
const mailKey = required('RESEND_API_KEY');
const webhookSecret = required('WEBHOOK_SECRET');
const sender = process.env.FROM_EMAIL || 'Stockroom <onboarding@resend.dev>';
const dataDir = process.env.DATA_DIR || 'data';
mkdirSync(dataDir, { recursive: true });
const adminSecret = adminPassword(dataDir);
const store = openStore(join(dataDir, 'stockroom.sqlite'));
const host = process.env.HOST || '127.0.0.1';
const demoFile = process.env.DEMO_HARNESS_STATE_FILE;
const publicDemoOrigin = process.env.DEMO_PUBLIC_ORIGIN;
if (publicDemoOrigin) {
  const origin = new URL(publicDemoOrigin);
  if (origin.origin !== publicDemoOrigin || origin.protocol !== 'https:' || origin.username || origin.password) {
    throw new Error('DEMO_PUBLIC_ORIGIN must be an HTTPS origin without a path.');
  }
  if (!demoFile || !process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 16) {
    throw new Error('A hosted demo requires its simulator and an ADMIN_PASSWORD of at least 16 characters.');
  }
}
if (demoFile && ((!isLoopback(host) && !publicDemoOrigin) || !isLoopback(new URL(mailUrl).hostname))) {
  throw new Error('Demo mode requires a local email simulator and either a loopback bind or DEMO_PUBLIC_ORIGIN.');
}
const demo = demoFile ? openDemo(demoFile, stockUrl, stockKey) : undefined;

function requireAdmin(req: IncomingMessage, res: ServerResponse) {
  const auth = req.headers.authorization?.match(/^Basic ([\w+/=]+)$/i);
  const credentials = auth ? Buffer.from(auth[1], 'base64').toString('utf8') : '';
  if (!equalSecret(credentials, `admin:${adminSecret}`)) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Stockroom", charset="UTF-8"');
    throw new RequestError(401, 'Admin credentials required.');
  }
}

async function isInStock(sku: string) {
  const response = await fetch(`${stockUrl}/${encodeURIComponent(sku)}`, {
    headers: { Authorization: `Bearer ${stockKey}` },
    redirect: 'error',
    signal: AbortSignal.timeout(5_000),
  });
  if (response.status === 404) return false;
  if (!response.ok) throw new Error(`Stock API returned HTTP ${response.status}`);
  const stock = await response.json() as { quantity?: unknown; in_stock?: unknown };
  if (typeof stock.quantity !== 'number' || !Number.isFinite(stock.quantity)) {
    throw new Error('Stock API did not return a quantity');
  }
  return stock.quantity > 0 && stock.in_stock !== false;
}

async function sendAlert(id: string, email: string, sku: string) {
  const response = await fetch(`${mailUrl}/emails`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${mailKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `stockroom/${id}`,
    },
    body: JSON.stringify({ from: sender, to: [email], ...restockEmail(sku) }),
    redirect: 'error',
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Email API returned HTTP ${response.status}`);
  }
  const receipt = await response.json() as { id?: unknown };
  if (typeof receipt.id !== 'string' || !receipt.id) throw new Error('Email API did not return a receipt');
}

let stopping = false;
let work: Promise<void> | undefined;

async function drain() {
  for (const check of store.checks()) {
    if (stopping) return;
    try {
      store.completeCheck(check, await isInStock(check.sku));
    } catch {
      store.retryCheck(check);
    }
  }
  for (const delivery of store.deliveries()) {
    if (stopping) return;
    try {
      await sendAlert(delivery.id, delivery.email, delivery.sku);
      store.delivered(delivery);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Unknown delivery error';
      store.retryDelivery(delivery, reason.slice(0, 140));
    }
  }
}

function wake() {
  if (stopping || work) return;
  work = drain().catch(error => console.error('Worker cycle failed:', error)).finally(() => { work = undefined; });
}

async function route(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url || '/', 'http://stockroom.local');
  const endpoint = `${req.method} ${url.pathname}`;
  if (url.pathname === '/demo' || url.pathname.startsWith('/demo/')) {
    return demoRoute(req, res, url, endpoint);
  }
  switch (endpoint) {
    case 'GET /':
      if (demo) {
        res.writeHead(302, { Location: '/demo', 'Cache-Control': 'no-store' });
        return res.end();
      }
    case 'GET /embed':
      return html(res, embedPage(skuOf(url.searchParams.get('sku'))), { embed: true });
    case 'GET /embed.js':
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
      return res.end(embedScript);
    case 'GET /healthz':
      return json(res, 200, { ok: true });
    case 'POST /api/requests': {
      const body = await readJson(req);
      const email = emailOf(body.email);
      const sku = skuOf(body.sku);
      if (!email || !sku) throw new RequestError(400, 'Enter a valid email address and item code.');
      if (publicDemoOrigin && !email.endsWith('@example.com')) {
        throw new RequestError(400, 'Use an @example.com address in this shared test environment.');
      }
      const created = store.subscribe(email, sku);
      wake();
      return json(res, created ? 201 : 200, { created });
    }
    case 'POST /webhooks/stock': {
      const secret = req.headers['x-webhook-secret'];
      if (typeof secret !== 'string' || !equalSecret(secret, webhookSecret)) {
        throw new RequestError(401, 'Invalid webhook secret.');
      }
      const body = await readJson(req);
      const sku = skuOf(body.sku);
      if (!sku || typeof body.event_id !== 'string' || !body.event_id.trim() || body.event_id.length > 160
        || typeof body.quantity !== 'number' || !Number.isFinite(body.quantity) || body.quantity < 0) {
        throw new RequestError(400, 'A valid event ID, item code, and quantity are required.');
      }
      const accepted = store.recordWebhook(body.event_id, sku);
      wake();
      return json(res, 200, { accepted });
    }
    case 'GET /admin': {
      requireAdmin(req, res);
      const page = Number(url.searchParams.get('page') || 1);
      if (!Number.isSafeInteger(page) || page < 1 || page > 100_000) {
        throw new RequestError(400, 'Invalid page.');
      }
      const rows = store.alerts(51, (page - 1) * 50);
      return html(res, adminPage(rows.slice(0, 50), page, rows.length > 50));
    }
    default:
      throw new RequestError(404, 'Page not found.');
  }
}

async function demoRoute(req: IncomingMessage, res: ServerResponse, url: URL, endpoint: string) {
  if (!demo || !req.headers.host) {
    throw new RequestError(404, 'Page not found.');
  }
  const requestHost = new URL(`http://${req.headers.host}`);
  if (publicDemoOrigin) {
    if (requestHost.host !== new URL(publicDemoOrigin).host) throw new RequestError(404, 'Page not found.');
    requireAdmin(req, res);
  } else if (!isLoopback(requestHost.hostname)) {
    throw new RequestError(404, 'Page not found.');
  }
  if (req.method === 'POST' && req.headers.origin !== (publicDemoOrigin || requestHost.origin)) {
    throw new RequestError(403, 'Run the simulator from the demo page.');
  }
  switch (endpoint) {
    case 'GET /demo':
      return html(res, demoPage(), { preview: true });
    case 'GET /demo/client.js':
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(demoScript);
    case 'GET /demo/state': {
      const sku = skuOf(url.searchParams.get('sku'));
      if (!sku) throw new RequestError(400, 'Enter a valid SKU.');
      return json(res, 200, { ...demo.snapshot(sku), alerts: store.alertsForSku(sku) });
    }
    case 'GET /demo/email': {
      const id = url.searchParams.get('id') || '';
      const body = /^[a-f0-9-]{16,40}$/.test(id) ? demo.preview(id) : undefined;
      if (!body) throw new RequestError(404, 'Email preview not found.');
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'self'",
        'X-Content-Type-Options': 'nosniff',
      });
      return res.end(body);
    }
    case 'POST /demo/simulate': {
      const { action, sku: rawSku, twice } = await readJson(req);
      const sku = skuOf(rawSku);
      if (!sku || (action !== 'restock' && action !== 'sellout' && action !== 'phantom')) {
        throw new RequestError(400, 'Enter a valid SKU and action.');
      }
      await demo.simulate(action, sku, twice === true);
      return json(res, 200, { ok: true });
    }
    case 'POST /demo/fail-next':
      await demo.failNextEmail();
      return json(res, 200, { ok: true });
    default:
      throw new RequestError(404, 'Page not found.');
  }
}

const server = createServer((req, res) => {
  route(req, res).catch(error => {
    if (error instanceof RequestError) return json(res, error.status, { error: error.message });
    console.error('Request failed:', error);
    if (!res.headersSent) json(res, 500, { error: 'Something went wrong. Please retry.' });
    else res.end();
  });
});
const port = Number(process.env.PORT || 8080);
const timer = setInterval(wake, 250);
server.listen(port, host, () => {
  const address = server.address();
  console.log(`Stockroom listening on ${host}:${typeof address === 'object' && address ? address.port : port}`);
  wake();
});

function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  server.close(async () => {
    await work;
    store.close();
  });
}

process.once('SIGINT', stop);
process.once('SIGTERM', stop);
