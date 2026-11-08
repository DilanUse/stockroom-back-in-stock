import { readFileSync } from 'node:fs';

type Mail = { id: string; at: string; to: string[]; subject: string; status: string; html?: string };
type Candidate = {
  token: string;
  apiKey: string;
  stock: Record<string, number>;
  emails: Mail[];
  webhooks: { at: string; eventId: string; sku: string; quantity: number; status: number }[];
  stockChecks: { at: string; sku: string; quantity: number }[];
  failNextEmails: number;
};

export const isLoopback = (host: string) => ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host);

export function openDemo(stateFile: string, stockUrl: string, apiKey: string) {
  const stock = new URL(stockUrl);
  if (!isLoopback(stock.hostname) || !stock.pathname.endsWith('/api/stock')) {
    throw new Error('The demo requires a local simulator stock API.');
  }
  const base = stockUrl.slice(0, -'/api/stock'.length);

  function candidate(): Candidate {
    const state = JSON.parse(readFileSync(stateFile, 'utf8')) as { candidates: Record<string, Candidate> };
    const found = Object.values(state.candidates).find(entry => entry.apiKey === apiKey);
    if (!found) throw new Error('The demo candidate was not found.');
    return found;
  }

  return {
    snapshot(sku: string) {
      const entry = candidate();
      return {
        quantity: entry.stock[sku] ?? 0,
        pendingFailures: entry.failNextEmails,
        emails: entry.emails.filter(mail => mail.subject.endsWith(` · ${sku}`)).slice(-12).reverse()
          .map(({ id, at, to, subject, status, html }) => ({ id, at, to, subject, status, preview: Boolean(html) })),
        webhooks: entry.webhooks.filter(event => event.sku === sku).slice(-6).reverse(),
        stockChecks: entry.stockChecks.filter(check => check.sku === sku).slice(-6).reverse(),
      };
    },
    preview(id: string) {
      return candidate().emails.find(mail => mail.id === id)?.html;
    },
    async simulate(action: 'restock' | 'sellout' | 'phantom', sku: string, twice: boolean) {
      const response = await fetch(`${base}/api/test/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ sku, quantity: 5, twice }),
        redirect: 'error',
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`Simulator returned HTTP ${response.status}.`);
      }
      const result = await response.json() as { deliveries?: unknown[]; delivery?: unknown };
      const deliveries = result.deliveries ?? (result.delivery === undefined ? [] : [result.delivery]);
      if (deliveries.some(status => typeof status !== 'number' || status < 200 || status >= 300)) {
        throw new Error('The simulator could not deliver its webhook.');
      }
    },
    async failNextEmail() {
      const response = await fetch(`${base}/c/${candidate().token}/fail`, {
        method: 'POST',
        body: new URLSearchParams({ n: '1' }),
        redirect: 'manual',
        signal: AbortSignal.timeout(5_000),
      });
      await response.body?.cancel();
      if (response.status !== 303) throw new Error('The simulator could not schedule an email failure.');
    },
  };
}
