import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { setTimeout as wait } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const harnessDir = process.env.HARNESS_DIR;
const appEntry = fileURLToPath(new URL('../src/server.ts', import.meta.url));
const jsonHeaders = { 'Content-Type': 'application/json' };
const localAdmin = 'stockroom-local-test-password';
const adminHeaders = { Authorization: `Basic ${Buffer.from(`admin:${localAdmin}`).toString('base64')}` };

async function freePort() {
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const address = probe.address();
  assert.ok(address && typeof address !== 'string');
  const port = address.port;
  await new Promise<void>((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  return port;
}

async function until<T>(read: () => Promise<T | undefined>, label: string) {
  const deadline = Date.now() + 7_000;
  do {
    const result = await read();
    if (result !== undefined) return result;
    await wait(30);
  } while (Date.now() < deadline);
  throw new Error(`Timed out waiting for ${label}`);
}

function start(entry: string, env: NodeJS.ProcessEnv) {
  const processHandle = spawn(process.execPath, [entry], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let output = '';
  let spawnError: Error | undefined;
  processHandle.on('error', error => { spawnError = error; });
  processHandle.stdout.on('data', data => { output += data; });
  processHandle.stderr.on('data', data => { output += data; });
  return {
    async ready(url: string) {
      try {
        await until(async () => {
          if (spawnError) throw spawnError;
          if (processHandle.exitCode !== null || processHandle.signalCode !== null) throw new Error('Server exited');
          const response = await fetch(url + '/healthz', { signal: AbortSignal.timeout(500) }).catch(() => undefined);
          const ready = response?.ok;
          await response?.body?.cancel();
          return ready ? true : undefined;
        }, `server at ${url}`);
      } catch (error) {
        throw new Error(`${error instanceof Error ? error.message : error}\n${output}`, { cause: error });
      }
    },
    async stop() {
      if (!processHandle.pid || processHandle.exitCode !== null || processHandle.signalCode !== null) return;
      const exit = once(processHandle, 'exit');
      processHandle.kill('SIGKILL');
      await exit;
    },
  };
}

function post(url: string, data: object, headers = {}) {
  return fetch(url, {
    method: 'POST',
    headers: { ...jsonHeaders, ...headers },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(5_000),
  });
}

function form(url: string, data: Record<string, string>) {
  return fetch(url, {
    method: 'POST',
    body: new URLSearchParams(data),
    redirect: 'manual',
    signal: AbortSignal.timeout(5_000),
  });
}

type HarnessState = {
  candidates: Record<string, {
    emails: { to: string[]; status: string; idempotencyKey: string; html: string }[];
    stockChecks: { sku: string; quantity: number }[];
  }>;
};

test('Stockroom against the official local harness', {
  skip: !harnessDir && 'Set HARNESS_DIR to the public challenge checkout.',
  timeout: 45_000,
}, async t => {
  const root = mkdtempSync(join(tmpdir(), 'stockroom-test-'));
  const port = await freePort();
  const harnessPort = await freePort();
  const harnessUrl = `http://127.0.0.1:${harnessPort}`;
  const appUrl = `http://127.0.0.1:${port}`;
  const harnessData = join(root, 'harness');
  let dropNextReceipt = false;
  const emailRelay = createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk);
      const receipt = await fetch(harnessUrl + '/emails', {
        method: 'POST',
        headers: {
          ...jsonHeaders,
          Authorization: req.headers.authorization || '',
          'Idempotency-Key': String(req.headers['idempotency-key'] || ''),
        },
        body: Buffer.concat(chunks),
        signal: AbortSignal.timeout(5_000),
      });
      const body = await receipt.text();
      if (receipt.ok && dropNextReceipt) {
        dropNextReceipt = false;
        res.destroy();
        return;
      }
      res.writeHead(receipt.status, jsonHeaders);
      res.end(body);
    } catch {
      res.writeHead(502);
      res.end();
    }
  });
  emailRelay.listen(0, '127.0.0.1');
  await once(emailRelay, 'listening');
  const relayAddress = emailRelay.address();
  assert.ok(relayAddress && typeof relayAddress !== 'string');
  const harness = start(resolve(harnessDir!, 'harness', 'server.js'), {
    PORT: String(harnessPort),
    DATA_DIR: harnessData,
    PUBLIC_URL: harnessUrl,
    SIM_INTERVAL_SECONDS: '3600',
    INVITE_CODE: '',
  });
  let app: ReturnType<typeof start> | undefined;
  t.after(async () => {
    await app?.stop();
    await harness.stop();
    await new Promise<void>((resolve, reject) => emailRelay.close(error => error ? reject(error) : resolve()));
    const target = realpathSync(root);
    assert.equal(dirname(target), realpathSync(tmpdir()));
    assert.match(basename(target), /^stockroom-test-/);
    rmSync(target, { recursive: true });
  });
  await harness.ready(harnessUrl);

  const signup = await form(harnessUrl + '/signup', { name: 'Stockroom local test' });
  assert.equal(signup.status, 303);
  const dashboard = harnessUrl + signup.headers.get('location');
  await signup.body?.cancel();
  const dashboardPage = await (await fetch(dashboard)).text();
  const apiKey = dashboardPage.match(/STOCK_API_KEY=(re_test_[a-f0-9]+)/)?.[1];
  const webhookSecret = dashboardPage.match(/WEBHOOK_SECRET=(whsec_[a-f0-9]+)/)?.[1];
  assert.ok(apiKey && webhookSecret);
  const appEnv = {
    PORT: String(port),
    HOST: '127.0.0.1',
    DATA_DIR: join(root, 'app'),
    STOCK_API_URL: harnessUrl + '/api/stock',
    STOCK_API_KEY: apiKey,
    RESEND_API_KEY: apiKey,
    RESEND_BASE_URL: `http://127.0.0.1:${relayAddress.port}`,
    WEBHOOK_SECRET: webhookSecret,
    ADMIN_PASSWORD: localAdmin,
    DEMO_HARNESS_STATE_FILE: join(harnessData, 'db.json'),
  };
  app = start(appEntry, appEnv);
  await app.ready(appUrl);
  assert.equal((await form(dashboard + '/baseurl', { baseUrl: appUrl })).status, 303);
  assert.equal((await form(dashboard + '/sim', { action: 'stop' })).status, 303);

  const sku = 'TEE-ORG-WHT-M';
  const email = 'first@example.com';
  const secondSku = 'MUG-STN-SAGE';
  const secondEmail = 'retry@example.com';
  const thirdSku = 'CAP-WAX-OLV';
  const demoSku = 'SOCK-MRN-3PK';
  // The simulator randomizes initial stock at signup.
  for (const product of [sku, secondSku, thirdSku, demoSku]) {
    assert.equal((await form(dashboard + '/stock', { sku: product, quantity: '0' })).status, 303);
  }
  const inbox = (address: string) => state()?.emails.filter(message => message.to.includes(address)) || [];

  function state() {
    try {
      const state = JSON.parse(readFileSync(join(harnessData, 'db.json'), 'utf8')) as HarnessState;
      return Object.values(state.candidates)[0];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return undefined;
    }
  }

  async function simulate(action: string, data: object) {
    const response = await post(harnessUrl + '/api/test/' + action, data, { Authorization: `Bearer ${apiKey}` });
    const output = await response.json();
    assert.equal(response.status, 200, JSON.stringify(output));
    return output;
  }

  async function admin() {
    const response = await fetch(appUrl + '/admin', { headers: adminHeaders });
    assert.equal(response.status, 200);
    return response.text();
  }

  await t.test('embeddable form, authenticated admin and atomic subscription deduplication', async () => {
    const embed = await fetch(appUrl + '/embed?sku=' + sku);
    assert.match(embed.headers.get('content-security-policy') || '', /frame-ancestors \*/);
    assert.match(await embed.text(), /Get a restock alert[\s\S]*value="TEE-ORG-WHT-M"/);
    const unauthenticated = await fetch(appUrl + '/admin');
    assert.equal(unauthenticated.status, 401);
    await unauthenticated.body?.cancel();
    const results = await Promise.all([
      simulate('request', { sku, email }),
      simulate('request', { sku, email: 'FIRST@example.com' }),
    ]);
    assert.deepEqual(results.map(result => result.app_status).sort(), [200, 201]);
    assert.equal((await admin()).match(/first@example\.com/g)?.length, 1);
  });

  await t.test('invalid secret and false restock never produce mail', async () => {
    await until(async () => state()?.stockChecks.some(check => check.sku === sku) ? true : undefined, 'initial stock check');
    const checksBefore = state()!.stockChecks.length;
    const bad = await post(appUrl + '/webhooks/stock', { sku, event_id: 'bad-secret', quantity: 8 }, {
      'X-Webhook-Secret': 'wrong',
    });
    assert.equal(bad.status, 401);
    await bad.body?.cancel();
    const phantom = await simulate('phantom', { sku, event_id: 'phantom', quantity: 12 });
    assert.deepEqual(phantom.deliveries, [200]);
    await until(async () => {
      const latest = state()?.stockChecks.slice(checksBefore);
      return latest?.some(check => check.sku === sku && check.quantity === 0) ? true : undefined;
    }, 'authoritative check of phantom event');
    assert.equal(state()?.stockChecks.length, checksBefore + 1);
    assert.match(await admin(), /Waiting for stock/);
    assert.equal(inbox(email).length, 0);
  });

  await t.test('concurrent duplicates and distinct restock events send one email', async () => {
    const events = await Promise.all([
      simulate('restock', { sku, event_id: 'restock-a', twice: true }),
      simulate('restock', { sku, event_id: 'restock-b', twice: false }),
    ]);
    assert.deepEqual(events.map(event => event.deliveries), [[200, 200], [200]]);
    await until(async () => inbox(email).length ? true : undefined, 'accepted email');
    await until(async () => (await admin()).includes('badge sent">Notified') ? true : undefined, 'notified state');
    const messages = inbox(email);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].status, 'accepted');
    assert.match(messages[0].html, /Your item is back/);
  });

  await t.test('an injected HTTP 500 is retried after the app is killed and restarted', async () => {
    assert.equal((await simulate('request', { sku: secondSku, email: secondEmail })).app_status, 201);
    assert.equal((await form(dashboard + '/fail', { n: '1' })).status, 303);
    assert.deepEqual((await simulate('restock', { sku: secondSku, twice: false })).deliveries, [200]);
    await until(async () => (await admin()).includes('Email API returned HTTP 500') ? true : undefined, 'durable failed attempt');
    await app!.stop();
    await until(async () => inbox(secondEmail).some(message => message.status.startsWith('failed')) ? true : undefined, 'injected failure in harness');
    assert.equal(inbox(secondEmail).some(message => message.status === 'accepted'), false);
    app = start(appEntry, appEnv);
    await app.ready(appUrl);
    await until(async () => inbox(secondEmail).some(message => message.status === 'accepted') ? true : undefined, 'retry after restart');
    const messages = inbox(secondEmail);
    assert.equal(messages.length, 2);
    assert.equal(messages[0].idempotencyKey, messages[1].idempotencyKey);
    assert.equal(messages[1].status, 'accepted');
    assert.match(await admin(), /first@example\.com/);
    assert.match(await admin(), /retry@example\.com[\s\S]*Notified/);
  });

  await t.test('a lost receipt is retried without delivering a second email', async () => {
    const email = 'lost-response@example.com';
    assert.equal((await simulate('request', { sku: thirdSku, email })).app_status, 201);
    dropNextReceipt = true;
    assert.deepEqual((await simulate('restock', { sku: thirdSku, twice: false })).deliveries, [200]);
    await until(async () => inbox(email).some(message => message.status.startsWith('deduped')) ? true : undefined, 'provider deduplication');
    const messages = inbox(email);
    assert.deepEqual(messages.map(message => message.status), ['accepted', 'deduped (idempotency key)']);
    assert.equal(messages[0].idempotencyKey, messages[1].idempotencyKey);
    assert.match(await admin(), /lost-response@example\.com[^]*?badge sent">Notified/);
  });

  await t.test('local demo controls and inbox reflect the official simulator', async () => {
    const demoUrl = appUrl + '/demo';
    const email = 'demo-panel@example.com';
    const body = { action: 'restock', sku: demoSku, twice: true };
    const origin = { Origin: appUrl };
    const dashboard = await fetch(demoUrl);
    assert.match(await dashboard.text(), /Run complete test/);
    const blocked = await post(demoUrl + '/simulate', body, { Origin: 'https://other.example' });
    assert.equal(blocked.status, 403);
    await blocked.body?.cancel();
    assert.equal((await simulate('request', { sku: demoSku, email })).app_status, 201);
    assert.equal((await post(demoUrl + '/fail-next', {}, origin)).status, 200);
    assert.equal((await post(demoUrl + '/simulate', body, origin)).status, 200);
    const snapshot = await until(async () => {
      const response = await fetch(demoUrl + '/state?sku=' + demoSku);
      assert.equal(response.status, 200);
      const data = await response.json();
      return data.emails.some((mail: { status: string }) => mail.status === 'accepted') ? data : undefined;
    }, 'live demo inbox');
    assert.equal(snapshot.quantity, 5);
    assert.equal(snapshot.webhooks.length, 2);
    assert.equal(snapshot.webhooks[0].eventId, snapshot.webhooks[1].eventId);
    assert.equal(snapshot.alerts[0].email, email);
    assert.ok(snapshot.alerts[0].notified_at);
    assert.deepEqual(snapshot.emails.map((mail: { status: string }) => mail.status), ['accepted', 'failed (injected 500)']);
    assert.equal(JSON.stringify(snapshot).includes(apiKey), false);
    const preview = await fetch(demoUrl + '/email?id=' + snapshot.emails[0].id);
    assert.match(preview.headers.get('content-security-policy') || '', /^sandbox;/);
    assert.match(await preview.text(), /Your item is back/);
  });

  await t.test('hosted demo requires authentication, exact origin and synthetic addresses', async () => {
    await app!.stop();
    // Model an HTTPS edge forwarding to the app over HTTP while preserving Host.
    const publicOrigin = `https://127.0.0.1:${port}`;
    app = start(appEntry, { ...appEnv, DEMO_PUBLIC_ORIGIN: publicOrigin });
    await app.ready(appUrl);
    const headers = { ...adminHeaders, Origin: publicOrigin };
    const url = appUrl + '/demo';
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await fetch(url + '/state?sku=' + demoSku)).status, 401);
    assert.equal((await fetch(url + '/client.js')).status, 401);
    assert.equal((await fetch(url + '/email?id=0000000000000000')).status, 401);
    const wrongHost = await new Promise<number>((resolve, reject) => {
      const req = request(url, { headers: { ...adminHeaders, Host: 'unexpected.example' } }, res => {
        res.resume();
        resolve(res.statusCode!);
      });
      req.on('error', reject);
      req.end();
    });
    assert.equal(wrongHost, 404);
    assert.equal((await fetch(url, { headers })).status, 200);
    const body = { action: 'sellout', sku: demoSku };
    assert.equal((await post(url + '/simulate', body, { ...headers, Origin: 'https://other.example' })).status, 403);
    assert.equal((await post(url + '/simulate', body, adminHeaders)).status, 403);
    assert.equal((await post(url + '/simulate', body, headers)).status, 200);
    assert.equal((await post(appUrl + '/api/requests', { sku: demoSku, email: 'personal@somewhere.test' })).status, 400);
    assert.equal((await post(appUrl + '/api/requests', { sku: demoSku, email: 'hosted@example.com' })).status, 201);
    assert.equal((await post(url + '/simulate', { action: 'restock', sku: demoSku, twice: true }, headers)).status, 200);
    const snapshot = await until(async () => {
      const state = await (await fetch(url + '/state?sku=' + demoSku, { headers })).json();
      return state.alerts.some((alert: { email: string; notified_at: number }) => alert.email === 'hosted@example.com' && alert.notified_at)
        && state.emails.some((mail: { to: string[] }) => mail.to.includes('hosted@example.com')) ? state : undefined;
    }, 'hosted demo delivery');
    assert.equal(snapshot.emails.filter((mail: { to: string[]; status: string }) => mail.to.includes('hosted@example.com') && mail.status === 'accepted').length, 1);
    assert.equal(JSON.stringify(snapshot).includes(apiKey), false);
    assert.equal(JSON.stringify(snapshot).includes(webhookSecret), false);
  });
});
