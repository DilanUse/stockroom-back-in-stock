export function demoPage() {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Stockroom · Restock alert lab</title>
<style>
  :root { color-scheme:light; --ink:#172a23; --subtle:#496257; --line:#dce8df; --green:#216448; --canvas:#f1f5ef; --white:#fffefa }
  * { box-sizing:border-box }
  body { margin:0; background:var(--canvas); color:var(--ink); font:15px/1.45 system-ui,sans-serif }
  main { max-width:1200px; margin:0 auto; padding:clamp(16px,4vw,42px) }
  h1,h2,h3,p { margin:0 }
  a { color:var(--green) }
  button,input { font:inherit }
  :focus-visible { outline:3px solid #46926c; outline-offset:3px }
  .hero { background:radial-gradient(ellipse at top right,#33755a,#153c2e 75%); color:#fffefa; padding:clamp(20px,4.5vw,42px); border-radius:24px }
  .hero-top,.heading,.mail-item,.event,.actions { display:flex; align-items:center; justify-content:space-between; gap:12px }
  .brand { text-transform:uppercase; font-size:.78rem; font-weight:800; letter-spacing:.17em; color:#bde2c7 }
  .hero h1 { margin:.9rem 0 .45rem; font-size:clamp(2rem,5vw,3.55rem); line-height:1.04; letter-spacing:-.06em }
  .hero p { color:#d7ece0; max-width:37rem }
  .live { display:inline-flex; align-items:center; gap:7px; flex-shrink:0; padding:6px 10px; border:1px solid #ffffff50; border-radius:99px; font-size:.76rem; color:#fff }
  .live::before { content:''; width:7px; height:7px; border-radius:50%; background:#efd290 }
  .live[data-ready="true"]::before { background:#a0efb1; box-shadow:0 0 0 3px #a0efb132 }
  .grid { display:grid; grid-template-columns:minmax(260px,.9fr) minmax(0,1.25fr); align-items:start; gap:18px; margin-top:18px }
  .stack { display:grid; gap:18px; min-width:0 }
  .card { padding:clamp(16px,2.4vw,24px); border:1px solid var(--line); border-radius:19px; background:var(--white); box-shadow:0 3px 9px #173b2510 }
  .eyebrow { color:var(--green); font-size:.7rem; font-weight:800; letter-spacing:.13em; text-transform:uppercase; margin-bottom:5px }
  h2 { font-size:1.25rem; letter-spacing:-.035em }
  h3 { font-size:.94rem }
  .muted { color:var(--subtle); font-size:.86rem }
  .note { margin:.35rem 0 .95rem }
  .field { display:block; margin:.65rem 0 }
  .field span { display:block; margin-bottom:4px; font-weight:650; font-size:.85rem }
  .field input { width:100%; min-width:0; padding:.66rem .72rem; border:1px solid #a9bdaf; border-radius:9px; background:#fff; color:var(--ink) }
  .options { display:grid; gap:7px; margin:1rem 0 }
  .options label { display:flex; align-items:flex-start; gap:8px; color:var(--subtle); font-size:.84rem }
  .options input { accent-color:var(--green); margin-top:4px }
  button { cursor:pointer; color:var(--green); border:1px solid var(--line); background:#f7faf6; border-radius:9px; padding:.55rem .7rem; font-size:.84rem; font-weight:700 }
  button:hover:not(:disabled) { background:#e9f2ea }
  button:disabled { cursor:progress; opacity:.55 }
  .primary { width:100%; padding:.73rem; color:white; background:var(--green); border-color:var(--green) }
  .primary:hover:not(:disabled) { background:#174b35 }
  .actions { justify-content:flex-start; flex-wrap:wrap; gap:6px; margin-top:8px }
  .status { min-height:2.6rem; margin-top:9px; color:var(--green); font-size:.84rem }
  .status[data-error="true"] { color:#9b3127 }
  .stats { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px; margin-top:12px }
  .stat { border:1px solid var(--line); background:#f7faf6; border-radius:10px; padding:.55rem .65rem }
  .stat span { display:block; color:var(--subtle); font-size:.72rem }
  .stat strong { font-size:1.4rem; font-variant-numeric:tabular-nums }
  .list { margin:.5rem 0 0; padding:0; list-style:none; max-height:15rem; overflow:auto }
  .list li { padding:.57rem 0; border-bottom:1px solid var(--line); overflow-wrap:anywhere }
  .list li:last-child { border-bottom:0 }
  .mail-item { align-items:flex-start }
  .mail-copy { min-width:0 }
  .badge { flex-shrink:0; display:inline-block; color:#315746; background:#e8f1e9; padding:3px 7px; border-radius:20px; font-size:.71rem; white-space:nowrap }
  .badge[hidden] { display:none }
  .badge.ok { color:#155a37; background:#d9f0de }
  .badge.warn { color:#754515; background:#f8edd4 }
  .preview { margin-top:.75rem }
  .preview iframe { display:block; width:100%; height:380px; margin-top:.4rem; border:1px solid var(--line); border-radius:12px; background:#f2f5ef }
  .footer { display:flex; flex-wrap:wrap; gap:14px; margin-top:18px; color:var(--subtle); font-size:.8rem }
  details { margin-top:.75rem }
  summary { cursor:pointer; color:var(--green); font-weight:650; font-size:.86rem }
  @media(max-width:760px) { .grid { grid-template-columns:1fr } }
  @media(max-width:380px) { .stats { gap:5px } .stat { padding:.4rem } .hero-top { gap:5px } }
</style></head><body><main>
  <header class="hero">
    <div class="hero-top"><span class="brand">Stockroom · Interactive demo</span><span class="live" id="live">Connecting</span></div>
    <h1>Restock alert lab</h1>
    <p>Create an alert, restock a product, and watch the email arrive.</p>
  </header>
  <div class="grid">
    <div class="stack">
      <section class="card" aria-labelledby="controls-title">
        <p class="eyebrow">Controls</p><h2 id="controls-title">Try a restock alert</h2>
        <p class="muted note">Use an @example.com address. All email stays in the test inbox.</p>
        <form id="controls">
          <label class="field"><span>Test email</span><input id="email" type="email" maxlength="254" value="demo@example.com" required></label>
          <label class="field"><span>Product code (SKU)</span><input id="sku" value="TEE-ORG-WHT-M" maxlength="64" required></label>
          <div class="options">
            <label><input id="duplicate" type="checkbox"> Send the same webhook twice</label>
            <label><input id="fail" type="checkbox"> Fail the next email attempt</label>
          </div>
          <button class="primary" type="submit" data-action="complete">Run complete test</button>
          <div class="actions" aria-label="Individual actions">
            <button type="button" data-action="request">Create alert</button>
            <button type="button" data-action="sellout">Sell out</button>
            <button type="button" data-action="restock">Restock 5 units</button>
            <button type="button" data-action="phantom">False restock</button>
          </div>
          <p id="action-status" class="status" role="status" aria-live="polite">The complete test sells out the product, creates an alert, then restocks it.</p>
        </form>
      </section>
      <section class="card" aria-labelledby="activity-title">
        <p class="eyebrow">Simulator</p><h2 id="activity-title">Inventory activity</h2>
        <ul class="list" id="events"><li class="muted">No events for this product yet.</li></ul>
        <details><summary>Stock API checks</summary><ul class="list" id="checks"></ul></details>
      </section>
    </div>
    <div class="stack">
      <section class="card" aria-labelledby="inbox-title">
        <div class="heading"><div><p class="eyebrow">Test deliveries</p><h2 id="inbox-title">Email inbox</h2></div><span class="badge" id="failures" hidden></span></div>
        <div class="stats">
          <div class="stat"><span>Verified stock</span><strong id="quantity">—</strong></div>
          <div class="stat"><span>Recent alerts</span><strong id="requests">—</strong></div>
          <div class="stat"><span>Recent deliveries</span><strong id="delivered">—</strong></div>
        </div>
        <ul class="list" id="inbox"><li class="muted">Emails for this product will appear here.</li></ul>
        <div class="preview" id="preview" hidden><h3>Email preview</h3><iframe title="Test email preview" id="mail-frame" sandbox></iframe></div>
      </section>
      <section class="card" aria-labelledby="requests-title">
        <p class="eyebrow">Stockroom activity</p><h2 id="requests-title">Alerts</h2>
        <ul class="list" id="request-list"><li class="muted">No alerts for this product yet.</li></ul>
      </section>
    </div>
  </div>
  <footer class="footer"><span>Test environment · No real emails sent</span><a href="/embed?sku=TEE-ORG-WHT-M" target="_blank" rel="noopener">Open storefront form</a><a href="/admin" target="_blank" rel="noopener">Open admin</a></footer>
</main><script src="/demo/client.js" defer></script></body></html>`;
}

export const demoScript = `
const byId = id => document.getElementById(id);
const controls = byId('controls');
const skuField = byId('sku');
const emailField = byId('email');
const status = byId('action-status');
const live = byId('live');
const buttons = [...controls.querySelectorAll('button')];
const clock = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
let activeSku = '';
let lastSnapshot = '';
let chosenEmail;
let watching;
let polling = false;
let running = false;

function node(tag, text, className) {
  const item = document.createElement(tag);
  if (text) item.textContent = text;
  if (className) item.className = className;
  return item;
}

function renderList(id, values, empty, render) {
  byId(id).replaceChildren(...(values.length ? values.map(render) : [node('li', empty, 'muted')]));
}

function showEmail(mail) {
  byId('preview').hidden = !mail;
  const frame = byId('mail-frame');
  if (!mail) frame.removeAttribute('src');
  else {
    const src = '/demo/email?id=' + encodeURIComponent(mail.id);
    if (frame.getAttribute('src') !== src) frame.src = src;
  }
}

function render(state) {
  byId('quantity').textContent = state.quantity;
  byId('requests').textContent = state.alerts.length;
  byId('delivered').textContent = state.emails.filter(mail => mail.status === 'accepted').length;
  byId('failures').hidden = state.pendingFailures === 0;
  byId('failures').textContent = 'Scheduled failures: ' + state.pendingFailures;

  renderList('inbox', state.emails, 'No emails for this product yet.', mail => {
    const line = node('li', '', 'mail-item');
    const copy = node('div', '', 'mail-copy');
    copy.append(node('strong', mail.subject), node('p', mail.to.join(', ') + ' · ' + clock.format(new Date(mail.at)), 'muted'));
    const accepted = mail.status === 'accepted';
    const retry = mail.status.startsWith('failed');
    const pill = node('span', accepted ? 'Accepted' : retry ? 'Test failure' : 'Duplicate prevented', 'badge ' + (accepted ? 'ok' : retry ? 'warn' : ''));
    if (mail.preview) {
      const button = node('button', 'View email');
      button.type = 'button';
      button.addEventListener('click', () => {
        chosenEmail = mail.id;
        showEmail(mail);
      });
      copy.append(button);
    }
    line.append(copy, pill);
    return line;
  });
  showEmail(state.emails.find(mail => mail.id === chosenEmail && mail.preview)
    || state.emails.find(mail => mail.status === 'accepted' && mail.preview));
  renderList('request-list', state.alerts, 'No alerts for this product yet.', alert => {
    const line = node('li', '', 'event');
    const copy = node('div');
    const stamp = alert.notified_at ? 'Notified at ' + clock.format(alert.notified_at) : 'Created at ' + clock.format(alert.created_at);
    copy.append(node('strong', alert.email), node('p', stamp, 'muted'));
    const stateLabel = alert.notified_at ? 'Notified' : alert.delivery_error ? 'Retrying' : alert.queued_at ? 'Queued' : 'Waiting for stock';
    line.append(copy, node('span', stateLabel, 'badge ' + (alert.notified_at ? 'ok' : alert.delivery_error ? 'warn' : '')));
    return line;
  });
  renderList('events', state.webhooks, 'No events for this product yet.', event => {
    const line = node('li', '', 'event');
    const copy = node('div');
    copy.append(node('strong', event.quantity ? 'Restock event' : 'Sold out'),
      node('p', clock.format(new Date(event.at)) + ' · ' + event.eventId + ' · Reported quantity: ' + event.quantity, 'muted'));
    line.append(copy, node('span', 'HTTP ' + event.status, 'badge'));
    return line;
  });
  renderList('checks', state.stockChecks, 'No stock checks yet.', check =>
    node('li', clock.format(new Date(check.at)) + ' · Verified quantity: ' + check.quantity, 'muted'));
}

async function api(path, body) {
  const signal = AbortSignal.timeout(8_000);
  const response = await fetch(path, body === undefined ? { signal } : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'Could not complete the operation.');
  }
  return response.json();
}

function skuValue() {
  return skuField.value.trim().toUpperCase();
}

async function refresh() {
  const sku = skuValue();
  if (polling || !/^[A-Z0-9][A-Z0-9._-]{0,63}$/.test(sku)) return;
  polling = true;
  try {
    const data = await api('/demo/state?sku=' + encodeURIComponent(sku));
    if (sku !== skuValue()) return;
    const snapshot = JSON.stringify(data);
    if (activeSku !== sku || lastSnapshot !== snapshot) {
      if (activeSku !== sku) chosenEmail = undefined;
      activeSku = sku;
      lastSnapshot = snapshot;
      render(data);
    }
    if (watching?.sku === sku) {
      const alert = data.alerts.find(item => item.email === watching.email);
      if (alert?.notified_at && data.emails.some(mail => mail.status === 'accepted'
        && mail.to.includes(watching.email) && Date.parse(mail.at) >= alert.created_at)) {
        status.textContent = 'Test complete. Your email is now in the inbox.';
        watching = undefined;
      } else if (alert?.delivery_error) {
        status.textContent = 'The simulator rejected the first attempt. Stockroom is retrying.';
      }
    }
    live.dataset.ready = 'true';
    live.textContent = 'Live';
  } catch {
    live.dataset.ready = 'false';
    live.textContent = 'Reconnecting';
  } finally {
    polling = false;
  }
}

async function run(action) {
  const sku = skuValue();
  if (running) return;
  if (!/^[A-Z0-9][A-Z0-9._-]{0,63}$/.test(sku)) {
    status.dataset.error = 'true';
    status.textContent = 'Enter a valid product code.';
    skuField.focus();
    return;
  }
  if ((action === 'request' || action === 'complete') && !emailField.reportValidity()) return;
  running = true;
  watching = undefined;
  buttons.forEach(button => { button.disabled = true; });
  status.dataset.error = 'false';
  status.textContent = 'Running…';
  const simulate = (name, twice = false) => api('/demo/simulate', { action: name, sku, twice });
  const email = emailField.value.trim().toLowerCase();
  const subscribe = () => api('/api/requests', { sku, email });
  async function restock() {
    chosenEmail = undefined;
    if (byId('fail').checked) await api('/demo/fail-next', {});
    await simulate('restock', byId('duplicate').checked);
  }
  try {
    if (action === 'complete') {
      await simulate('sellout');
      await subscribe();
      await restock();
      watching = { sku, email };
      status.textContent = 'Test started. Watch the alert and inbox as the email arrives.';
    } else if (action === 'request') {
      const response = await subscribe();
      status.textContent = response.created ? 'Alert created.' : 'An open alert already exists for this email and product.';
    } else if (action === 'restock') {
      await restock();
      status.textContent = 'Restock sent. The inbox will update automatically.';
    } else if (action === 'phantom') {
      await simulate('sellout');
      await simulate('phantom');
      status.textContent = 'False restock sent while verified stock remains zero.';
    } else {
      await simulate('sellout');
      status.textContent = 'The product is now sold out.';
    }
  } catch (error) {
    status.dataset.error = 'true';
    status.textContent = error.message;
  } finally {
    running = false;
    buttons.forEach(button => { button.disabled = false; });
    void refresh();
  }
}

controls.addEventListener('submit', event => { event.preventDefault(); void run('complete'); });
for (const button of buttons.filter(button => button.type === 'button')) {
  button.addEventListener('click', () => void run(button.dataset.action));
}
skuField.addEventListener('change', () => void refresh());
emailField.value = 'demo+' + Date.now().toString(36) + '@example.com';
void refresh();
setInterval(refresh, 900);
`;
