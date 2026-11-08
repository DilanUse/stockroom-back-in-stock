import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root = resolve(process.env.DATA_DIR || 'data');
mkdirSync(root, { recursive: true });
const stateFile = join(root, 'simulator', 'db.json');
const appPort = Number(process.env.PORT || 8080);
const appUrl = `http://127.0.0.1:${appPort}`;
const publicOrigin = process.env.DEMO_PUBLIC_ORIGIN
  || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '');
if (!['127.0.0.1', 'localhost', '::1'].includes(process.env.HOST || '127.0.0.1') && !publicOrigin) {
  throw new Error('Set DEMO_PUBLIC_ORIGIN to the HTTPS address before exposing the demo.');
}
if (publicOrigin && (process.env.ADMIN_PASSWORD || '').length < 16) {
  throw new Error('Set a unique ADMIN_PASSWORD of at least 16 characters for the hosted demo.');
}

const probe = createServer().listen(0, '127.0.0.1');
await once(probe, 'listening');
const address = probe.address();
if (!address || typeof address === 'string') throw new Error('No simulator port available.');
const simulatorPort = address.port;
await new Promise<void>((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
const simulatorUrl = `http://127.0.0.1:${simulatorPort}`;
let stopping = false;
const children: ReturnType<typeof spawn>[] = [];

function start(entry: string, env: NodeJS.ProcessEnv) {
  const child = spawn(process.execPath, [entry], {
    env: { ...process.env, ...env }, stdio: 'inherit', windowsHide: true,
  });
  children.push(child);
  child.on('error', error => { console.error(error); void stop(1); });
  child.on('exit', code => { if (!stopping) void stop(code || 1); });
  return child;
}

async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  // Stop the app first, then give the simulator's deferred JSON writes time to flush.
  for (const child of [...children].reverse()) {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      await Promise.race([exited, wait(5_000)]);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await wait(350);
    }
  }
  process.exit(code);
}
process.once('SIGTERM', () => void stop());
process.once('SIGINT', () => void stop());

function candidate(): { token: string; apiKey: string; webhookSecret: string } | undefined {
  try {
    const state = JSON.parse(readFileSync(stateFile, 'utf8'));
    return Object.values(state.candidates)[0] as ReturnType<typeof candidate>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

async function form(path: string, data: Record<string, string>) {
  const response = await fetch(simulatorUrl + path, {
    method: 'POST', body: new URLSearchParams(data), redirect: 'manual', signal: AbortSignal.timeout(5_000),
  });
  await response.body?.cancel();
  if (response.status !== 303) throw new Error(`Simulator setup failed (${response.status}).`);
}

try {
  start(fileURLToPath(new URL('../.harness/server.cjs', import.meta.url)), {
    PORT: String(simulatorPort), DATA_DIR: join(root, 'simulator'), PUBLIC_URL: simulatorUrl,
    SIM_INTERVAL_SECONDS: '3600', INVITE_CODE: '', ADMIN_PASSWORD: '',
  });
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    const response = await fetch(simulatorUrl + '/healthz').catch(() => undefined);
    ready = Boolean(response?.ok);
    await response?.body?.cancel();
    if (ready) break;
    await wait(100);
  }
  if (!ready) throw new Error('Simulator did not start.');
  if (!candidate()) await form('/signup', { name: 'Stockroom interactive demo' });
  let identity = candidate();
  for (let attempt = 0; !identity && attempt < 30; attempt++) {
    await wait(100);
    identity = candidate();
  }
  if (!identity) throw new Error('Simulator identity was not persisted.');
  await form(`/c/${identity.token}/sim`, { action: 'stop' });
  await form(`/c/${identity.token}/baseurl`, { baseUrl: appUrl });
  await wait(350);
  start(fileURLToPath(new URL('./server.ts', import.meta.url)), {
    DATA_DIR: join(root, 'app'), STOCK_API_URL: simulatorUrl + '/api/stock',
    STOCK_API_KEY: identity.apiKey, RESEND_API_KEY: identity.apiKey,
    RESEND_BASE_URL: simulatorUrl, WEBHOOK_SECRET: identity.webhookSecret,
    DEMO_HARNESS_STATE_FILE: stateFile, DEMO_PUBLIC_ORIGIN: publicOrigin,
  });
  console.log('Demo initialized. Open /demo. All email is captured by the private simulator.');
} catch (error) {
  console.error(error);
  await stop(1);
}
