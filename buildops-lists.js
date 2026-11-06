// ── Alpine HVAC — BuildOps list reader for Account Management (read-only) ──
// Run in a logged-in live.buildops.com tab (Claude in Chrome: javascript_exec):
//   1. paste this file's contents once (defines window.alpineLists)
//   2. alpineLists.start()          returns immediately; the work runs in the background
//   3. poll alpineLists.status()    until done is true
//   4. alpineLists.result(i, size)  JSON text in slices (i = 0, 1, 2 …) to copy out
//
// Reads four list pages, every row on every page, and only these columns:
//   /property/list     every property: name, id, customer, type, address, status
//   /job/list          every job: number, property, status, billing status, issue description, created,
//                      completed, type, PO, customer, visits, invoices, agreement
//   /maintenance/list  every maintenance record: number, status, due date, type, property, agreement
//   /invoice/list      every invoice: number, agreement, job, amount, balance, property, issued, status
// Never reads Job Notes, Property Instructions or any notes column (they can hold site access codes).
// Never clicks anything except a list's own "Go to next page" button. Nothing is saved in BuildOps.
// Progress lives in localStorage (__alpine_lists); calling start() again resumes.
(() => {
const KEY = '__alpine_lists', VERSION = 1;
const LISTS = [
  { name: 'properties', path: '/property/list' },
  { name: 'jobs', path: '/job/list' },
  { name: 'maintenance', path: '/maintenance/list' },
  { name: 'invoices', path: '/invoice/list' }
];
const SKIP_FIELD = /note|instruction|comment|access|gate|alarm|lockbox|code/i;
let sleep;
try {
  const w = new Worker(URL.createObjectURL(new Blob(['onmessage=e=>setTimeout(()=>postMessage(e.data[0]),e.data[1])'], { type: 'text/javascript' })));
  const pend = new Map(); let seq = 0;
  w.onmessage = e => { const r = pend.get(e.data); pend.delete(e.data); if (r) r(); };
  sleep = ms => new Promise(r => { const id = ++seq; pend.set(id, r); w.postMessage([id, ms]); });
} catch (e) { sleep = ms => new Promise(r => setTimeout(r, ms)); }

let S;
const load = () => { try { S = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { S = null; } if (!S || S.version !== VERSION) S = { version: VERSION, started: null, rows: {}, totals: {}, done: false, running: false, err: null, log: [] }; };
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} };
load();
const log = m => { S.log.push(new Date().toISOString().slice(11, 19) + ' ' + m); S.log = S.log.slice(-40); save(); };
function nav(path) { history.pushState({}, '', path); window.dispatchEvent(new PopStateEvent('popstate', { state: {} })); }
async function waitFor(fn, max) { const t0 = Date.now(); while (Date.now() - t0 < (max || 30000)) { await sleep(400); try { const v = fn(); if (v) { await sleep(600); return v; } } catch (e) {} } return null; }
const grid = () => document.querySelector('[role=grid]');
const totalOf = () => { const e = [...document.querySelectorAll('p,span,div')].find(x => x.children.length === 0 && /^\s*\d+\s*[–-]\s*\d+\s+of\s+\d+/.test(x.textContent)); return e ? +e.textContent.match(/of\s+(\d+)/)[1] : null; };
const pageSig = () => { const e = [...document.querySelectorAll('p,span,div')].find(x => x.children.length === 0 && /^\s*\d+\s*[–-]\s*\d+\s+of\s+\d+/.test(x.textContent)); return e ? e.textContent.trim() : ''; };

function readRow(r) {
  const o = {};
  r.querySelectorAll('[role=cell],[role=gridcell]').forEach(c => {
    const f = c.getAttribute('data-field'); if (!f || SKIP_FIELD.test(f)) return;
    o[f] = c.innerText.replace(/\s+/g, ' ').trim();
    const a = c.querySelector('a[href]'); if (a) o[f + '_href'] = a.getAttribute('href');
  });
  return o;
}
// The element that scrolls the rows (MuiDataGrid-window or -virtualScroller, depending on the list).
function scrollerOf(g) {
  let n = g.querySelector('[role=row][data-id]');
  while (n && n !== g.parentElement) { const s = getComputedStyle(n); if (n.scrollHeight > n.clientHeight + 5 && /auto|scroll/.test(s.overflowY)) return n; n = n.parentElement; }
  return g.querySelector('[class*=virtualScroller],[class*=DataGrid-window]') || g;
}
// Rows are virtualised: scroll the grid's own scroller top to bottom, collecting by data-id.
async function readPage(out) {
  const g = grid(); if (!g) return 0;
  const sc = scrollerOf(g);
  sc.scrollTop = 0; await sleep(500);
  let n = 0, last = -1;
  for (let i = 0; i < 200; i++) {
    g.querySelectorAll('[role=row][data-id]').forEach(r => { const id = r.getAttribute('data-id'); if (!out[id]) { out[id] = readRow(r); n++; } });
    if (sc.scrollTop === last) break;
    last = sc.scrollTop; sc.scrollTop = sc.scrollTop + Math.max(200, sc.clientHeight * 0.7); await sleep(350);
  }
  return n;
}
async function readList(L) {
  nav(L.path);
  if (!await waitFor(() => grid() && grid().querySelector('[role=row][data-id]'), 40000)) throw new Error(L.name + ': list did not load');
  const out = S.rows[L.name] = S.rows[L.name] || {};
  for (let p = 0; p < 60; p++) {
    await readPage(out);
    S.totals[L.name] = totalOf(); save();
    const nb = document.querySelector('button[aria-label="Go to next page"],button[aria-label="Next page"]');
    if (!nb || nb.disabled) break;
    const sig = pageSig(); nb.click();
    if (!await waitFor(() => pageSig() !== sig, 20000)) break;
    await sleep(1200);
  }
  log(L.name + ': ' + Object.keys(out).length + ' of ' + S.totals[L.name]);
}
async function run() {
  S.running = true; S.err = null; S.started = S.started || Date.now(); save();
  try {
    for (const L of LISTS) {
      if (S.totals[L.name] != null && Object.keys(S.rows[L.name] || {}).length >= S.totals[L.name]) continue;
      S.rows[L.name] = {}; await readList(L);
    }
    const short = LISTS.filter(L => Object.keys(S.rows[L.name] || {}).length < (S.totals[L.name] || 0)).map(L => L.name);
    if (short.length) throw new Error('incomplete: ' + short.join(', ') + ' (call start() again to retry those)');
    S.done = true;
  } catch (e) { S.err = String(e && e.message || e); log('error: ' + S.err); }
  S.running = false; save();
}
window.alpineLists = {
  start() { if (S.running) return 'already running'; if (S.done) return 'done (call reset() to read again)'; run(); return 'started'; },
  reset() { localStorage.removeItem(KEY); load(); return 'reset'; },
  status() { return { running: S.running, done: S.done, err: S.err, counts: Object.fromEntries(LISTS.map(L => [L.name, Object.keys(S.rows[L.name] || {}).length + ' of ' + (S.totals[L.name] == null ? '?' : S.totals[L.name])])), log: S.log.slice(-6) }; },
  result(i, size) {
    const out = { asOf: new Date().toISOString().slice(0, 10) };
    LISTS.forEach(L => out[L.name] = Object.values(S.rows[L.name] || {}));
    const t = JSON.stringify(out); size = size || 30000;
    return i == null ? t.length : t.slice(i * size, (i + 1) * size);
  }
};
return 'alpineLists ready';
})();
