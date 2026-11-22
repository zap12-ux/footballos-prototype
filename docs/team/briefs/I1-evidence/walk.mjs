// Headless-Chrome walk of the four round-1 reviewer sequences against the mock app on :5173.
// Saves one PNG per mechanism into the directory given as argv[2]. Uses only the DevTools protocol.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] ?? 'http://localhost:5173';
const OUT = process.argv[3] ?? 'out';
const PORT = 9333;
mkdirSync(OUT, { recursive: true });

const profile = `/tmp/fos-walk-profile-${Date.now()}`;
const chrome = spawn(CHROME, [`--headless=new`, `--remote-debugging-port=${PORT}`, '--remote-debugging-address=127.0.0.1', `--user-data-dir=${profile}`, '--window-size=1440,1000', '--hide-scrollbars', '--no-first-run', '--disable-gpu', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
let chromeLog = '';
chrome.stderr.on('data', (d) => { chromeLog += d.toString(); });
chrome.on('exit', (code) => console.error('chrome exited', code));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function targets() {
  let last = '';
  for (let i = 0; i < 150; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json`);
      const list = await res.json();
      last = JSON.stringify(list.map((t) => [t.type, t.url]));
      const page = list.find((t) => t.type === 'page');
      if (page) return page;
    } catch (e) {
      last = `fetch: ${e.message}`;
    }
    await sleep(200);
  }
  throw new Error(`Chrome did not expose a page target. last=${last} log=${chromeLog.slice(-800)}`);
}

const page = await targets();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});
let seq = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(`${msg.error.message}`));
    else resolve(msg.result);
  }
};
function send(method, params = {}) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });

const HELPERS = `
window.__w = {
  byText(sel, re) { return [...document.querySelectorAll(sel)].find((el) => re.test((el.textContent || '').trim())); },
  byLabel(re) { const l = [...document.querySelectorAll('label')].find((x) => re.test((x.textContent || '').trim())); if (!l) return null; const id = l.getAttribute('for'); return id ? document.getElementById(id) : l.querySelector('input,textarea,select'); },
  set(el, v) { const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); },
};`;
await send('Page.addScriptToEvaluateOnNewDocument', { source: HELPERS });

async function evalJs(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? JSON.stringify(r.exceptionDetails));
  return r.result.value;
}
async function waitFor(expression, label, timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      if (await evalJs(`(() => { try { return !!(${expression}); } catch { return false; } })()`)) return;
    } catch {
      /* page navigating */
    }
    await sleep(150);
  }
  throw new Error(`Timed out waiting for ${label}`);
}
async function goto(path) {
  await send('Page.navigate', { url: `${BASE}${path}` });
  await sleep(600);
  await evalJs(HELPERS);
}
async function click(sel, re) {
  await waitFor(`__w.byText(${JSON.stringify(sel)}, ${re})`, `${sel} ${re}`);
  await evalJs(`__w.byText(${JSON.stringify(sel)}, ${re}).click()`);
  await sleep(250);
}
async function type(labelRe, text) {
  await waitFor(`__w.byLabel(${labelRe})`, `label ${labelRe}`);
  await evalJs(`__w.set(__w.byLabel(${labelRe}), ${JSON.stringify(text)})`);
  await sleep(100);
}
async function shot(name) {
  await sleep(600);
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUT, name), Buffer.from(data, 'base64'));
  console.log('saved', name);
}

async function signIn(email) {
  await goto('/sign-in');
  await type(/^Email/, email);
  await type(/^Password/, 'demo');
  await click('button[type="submit"]', /Sign in|Continue/);
  await waitFor(`__w.byLabel(/code/i)`, 'MFA code field');
  await type(/code/i, '246810');
  await click('button[type="submit"]', /Verify|Continue|Sign in/);
  await waitFor(`location.pathname.startsWith('/app')`, 'workspace');
}

try {
  // Head coach: HC-01 (mechanism 1), HC-03 (mechanism 3), OC-01/PC-04 reload (mechanism 4).
  await signIn('head.coach@winchester-hawks.demo');

  // Mechanism 1 · HC-01: add a third objective, switch units without saving, come back.
  await goto('/app/plans?unit=offense&game=game-w10&team=team-winchester-demo&season=season-2026');
  await type(/Add to Objectives/, 'Sunday protection check against the fifth rusher.');
  await evalJs(`__w.byLabel(/Add to Objectives/).closest('form').querySelector('button[type="submit"]').click()`);
  await waitFor(`__w.byText('h3', /^Objectives \\(3\\)/)`, 'Objectives (3)');
  await click('[role="tab"]', /^Special teams$/);
  await waitFor(`__w.byText('h3', /^Kickoff and kickoff return/)`, 'special teams sections');
  await click('[role="tab"]', /^Offense$/);
  await waitFor(`__w.byText('h3', /^Objectives \\(3\\)/) && document.querySelector('[data-testid="unsaved-indicator"]')`, 'objective restored with unsaved indicator');
  await shot('m1-unsaved-work-guard-HC-01.png');
  // Leave the draft as the coach would: save it so later steps start from a saved v2.
  await click('button', /^Save draft$/);
  await waitFor(`__w.byText('button', /^Draft saved$/)`, 'draft saved');

  // Mechanism 2 · OC-02 / HC-05: follow the 10:40 even-front evidence link.
  await goto('/app/scouting?unit=defense&game=game-w10&team=team-winchester-demo&season=season-2026');
  await waitFor(`__w.byText('a', /^10:40$/)`, '10:40 link');
  await evalJs(`__w.byText('a', /^10:40$/).click()`);
  await waitFor(`location.pathname.includes('/app/film/asset-westmoor-1') && /stand-in footage for 10:40 \\(play 5/.test(document.querySelector('[data-testid="seek-notice"]')?.textContent || '')`, 'stand-in caption for 10:40');
  await evalJs(`document.querySelector('.player')?.scrollIntoView({ block: 'start' })`);
  await shot('m2-evidence-links-OC-02.png');

  // Mechanism 3 · HC-03: head-coach override needs a reason; v1 keeps its history after being superseded.
  await goto('/app/plans?unit=offense&game=game-w10&team=team-winchester-demo&season=season-2026');
  await click('button', /^Approve v2 \(override\)$/);
  await type(/Reason for the override/, 'Protection check must be installed Monday; coordinator travelling.');
  await click('button', /^Confirm override approval$/);
  await waitFor(`/head-coach override/.test(document.querySelector('[data-testid="approval-history"]')?.textContent || '')`, 'override recorded');
  await waitFor(`document.querySelector('select') && [...document.querySelectorAll('select option')].some((o) => /v1/.test(o.textContent))`, 'version select');
  await evalJs(`(() => { const s = [...document.querySelectorAll('select')].find((x) => [...x.options].some((o) => /v1 · superseded/.test(o.textContent))); __w.set(s, 'pv-off-1'); })()`);
  await waitFor(`/Superseded .* by v2/.test(document.querySelector('[data-testid="approval-history"]')?.textContent || '')`, 'superseded history on v1');
  await shot('m3-approval-history-HC-03.png');

  // Mechanism 4 · OC-01 / PC-04: a browser reload keeps the approval; settings shows the persisted store and the reset confirmation.
  await send('Page.reload');
  await sleep(800);
  await evalJs(HELPERS);
  await waitFor(`[...document.querySelectorAll('select option')].some((o) => /v2 · approved \\(current\\)/.test(o.textContent))`, 'approval survived reload');
  await goto('/app/settings?team=team-winchester-demo&season=season-2026&game=game-w10&unit=offense');
  await waitFor(`/kept across reloads; last saved/.test(document.querySelector('[data-testid="demo-data"]')?.textContent || '')`, 'demo data card');
  await click('button', /^Reset demo data$/);
  await waitFor(`document.querySelector('[role="dialog"] [data-testid="reset-clears"]')`, 'reset dialog');
  await shot('m4-mock-persistence-OC-01-PC-04.png');
  await click('[role="dialog"] button', /^Cancel$/);
  console.log('walk complete');
} catch (error) {
  console.error('WALK FAILED:', error.message);
  await shot('failure.png').catch(() => undefined);
  process.exitCode = 1;
} finally {
  ws.close();
  chrome.kill();
}
