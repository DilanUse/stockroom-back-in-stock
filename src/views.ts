import type { Alert } from './store.ts';

const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escape = (value: string) => value.replace(/[&<>"']/g, character => entities[character]);
const time = (value: number | null) => value === null
  ? '—'
  : `<time datetime="${new Date(value).toISOString()}">${new Date(value).toISOString().slice(0, 16).replace('T', ' ')}</time>`;

function page(title: string, body: string, script = '') {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} | Stockroom</title>
<style>
  :root { color-scheme: light; --ink: #17332b; --muted: #496357; --line: #d3e0d7; --accent: #216246; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #f2f5ef; color: var(--ink); font: 16px/1.5 system-ui, sans-serif; }
  main { margin: 0 auto; padding: 24px; max-width: 65rem; }
  .embed { max-width: 33rem; }
  .card { background: #fffefa; border: 1px solid var(--line); border-radius: 18px; padding: clamp(20px, 5vw, 36px); }
  .brand { margin: 0 0 20px; color: var(--accent); font-weight: 750; font-size: .82rem; letter-spacing: .13em; text-transform: uppercase; }
  h1 { margin: 0; font-size: clamp(1.7rem, 5vw, 2.4rem); line-height: 1.1; letter-spacing: -.04em; }
  .lead { margin: .7rem 0 1.4rem; color: var(--muted); }
  label { display: block; font-weight: 650; margin: .8rem 0 .35rem; }
  input, button { width: 100%; border-radius: 8px; font: inherit; padding: .72rem .85rem; }
  input { border: 1px solid #9eafa5; background: white; color: var(--ink); }
  button { margin-top: 1.15rem; border: 0; background: var(--accent); color: white; font-weight: 750; cursor: pointer; }
  button:disabled { opacity: .68; cursor: progress; }
  :focus-visible { outline: 3px solid #2f785d; outline-offset: 3px; }
  #result { margin: .75rem 0 0; color: var(--accent); font-size: .94rem; }
  #result:empty { display: none; }
  #result[data-error] { color: #9a3026; }
  .table { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; text-align: left; font-size: .92rem; }
  th, td { padding: .75rem .6rem; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { white-space: nowrap; color: var(--muted); }
  td:nth-child(2), time { white-space: nowrap; }
  td:first-child { overflow-wrap: anywhere; min-width: 9rem; }
  .badge { display: inline-block; padding: .15rem .5rem; white-space: nowrap; border-radius: 99px; background: #e4eee5; }
  .badge.sent { background: #d7f0df; }
  .badge.retry { background: #f9e9cc; }
  nav { display: flex; gap: 1rem; margin-top: 1rem; }
  nav a { color: var(--accent); }
</style></head><body>${body}${script}</body></html>`;
}

export function embedPage(sku: string) {
  return page('Stock alerts', `<main class="embed"><section class="card" aria-labelledby="title">
  <p class="brand">Stockroom</p>
  <h1 id="title">Get a restock alert</h1>
  <p class="lead">Leave your email and the item code. We’ll send one email when the item is available again.</p>
  <form id="subscribe">
    <label for="email">Email address</label>
    <input id="email" name="email" type="email" autocomplete="email" maxlength="254" placeholder="you@example.com" required>
    <label for="sku">Item code (SKU)</label>
    <input id="sku" name="sku" value="${escape(sku)}" maxlength="64" placeholder="e.g. TEE-ORG-WHT-M" required>
    <button type="submit">Notify me</button>
  </form>
  <p id="result" role="status" aria-live="polite"></p>
</section></main>`, '<script src="/embed.js" defer></script>');
}

export const embedScript = `
const form = document.querySelector('#subscribe');
const result = document.querySelector('#result');
const button = form.querySelector('button');
form.addEventListener('submit', async event => {
  event.preventDefault();
  button.disabled = true;
  result.removeAttribute('data-error');
  result.textContent = 'Saving your request…';
  try {
    const response = await fetch('/api/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(new FormData(form))),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Try again in a moment.');
    result.textContent = data.created ? 'You’re on the list.' : 'You’re already on the list for this item.';
  } catch (error) {
    result.setAttribute('data-error', '');
    result.textContent = error.message || 'Could not save your request. Try again.';
  } finally {
    button.disabled = false;
  }
});
`;

export function adminPage(alerts: Alert[], pageNumber: number, hasNext: boolean) {
  const rows = alerts.map(alert => {
    const state = alert.notified_at !== null ? ['sent', 'Notified']
      : alert.delivery_error ? ['retry', 'Retrying']
      : alert.queued_at !== null ? ['', 'Queued']
      : ['', 'Waiting for stock'];
    return `<tr><td>${escape(alert.email)}</td><td>${escape(alert.sku)}</td>
      <td><span class="badge ${state[0]}">${state[1]}</span>${alert.delivery_error ? `<br><small>${escape(alert.delivery_error)}</small>` : ''}</td>
      <td>${time(alert.created_at)}</td><td>${time(alert.notified_at)}</td></tr>`;
  }).join('');
  return page('Alert activity', `<main><section class="card" aria-labelledby="title">
  <p class="brand">Stockroom</p>
  <h1 id="title">Alert activity</h1>
  <p class="lead">Customer requests and delivery status. Times are shown in UTC.</p>
  <div class="table"><table><thead><tr><th scope="col">Email</th><th scope="col">SKU</th><th scope="col">Status</th>
    <th scope="col">Requested</th><th scope="col">Notified</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="5">No requests on this page.</td></tr>'}</tbody></table></div>
  ${pageNumber > 1 || hasNext ? `<nav aria-label="Alert pages">
    ${pageNumber > 1 ? `<a href="/admin?page=${pageNumber - 1}">Previous</a>` : ''}
    ${hasNext ? `<a href="/admin?page=${pageNumber + 1}">Next</a>` : ''}</nav>` : ''}
</section></main>`);
}

export function restockEmail(sku: string) {
  return {
    subject: `Back in stock · ${sku}`,
    text: `Good news. Item ${sku} is back in stock. You can check availability at the store. This is the one-time alert you requested.`,
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
      <body style="margin:0;background:#f2f5ef;color:#17332b;font:16px/1.55 Arial,sans-serif">
        <div style="max-width:480px;margin:0 auto;padding:24px 16px">
          <div style="padding:28px 24px;background:#fffefa;border:1px solid #d3e0d7;border-radius:16px">
            <p style="margin:0 0 16px;color:#216246;font-size:13px;font-weight:bold;letter-spacing:2px">STOCKROOM</p>
            <h1 style="margin:0 0 12px;font-size:28px;line-height:1.2">Your item is back</h1>
            <p style="margin:0 0 18px">Good news. The item you were watching is available again.</p>
            <p style="margin:0 0 18px;padding:12px;background:#e4eee5;border-radius:8px">Item code <strong>${escape(sku)}</strong></p>
            <p style="margin:0">Visit the store to check availability.</p>
          </div>
          <p style="color:#496357;font-size:13px;padding:0 8px">You received this one-time email because you requested a restock alert.</p>
        </div>
      </body></html>`,
  };
}
