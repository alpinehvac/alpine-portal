// ── Alpine HVAC — BuildOps invoice list reader (read-only) ───────────
// Run in a logged-in live.buildops.com tab (Claude in Chrome: javascript_exec):
//   1. paste this file's contents once (defines window.alpineInvoices)
//   2. alpineInvoices.start()    returns at once; the work runs in the background
//   3. poll JSON.stringify(alpineInvoices.status()) until running is false
//   4. read alpineInvoices.chunks(), then alpineInvoices.chunk(0), chunk(1), ... and join them into one CSV file
//
// Opens /invoice/list, sets nothing, and reads every row of the grid by column heading:
// invoice number, service agreement, job, amount, balance, property, issued date, billing customer,
// status. Clicks only the grid's next-page button.
// Safety: never clicks Create, Export, Bulk Actions or anything on a row.
(() => {
let sleep;
try {
  const w = new Worker(URL.createObjectURL(new Blob(["onmessage=e=>setTimeout(()=>postMessage(e.data[0]),e.data[1])"], { type: "text/javascript" })));
  const pend = new Map(); let seq = 0;
  w.onmessage = e => { const r = pend.get(e.data); pend.delete(e.data); if (r) r(); };
  sleep = ms => new Promise(r => { const id = ++seq; pend.set(id, r); w.postMessage([id, ms]); });
} catch (e) { sleep = ms => new Promise(r => setTimeout(r, ms)); }
const S = { running: false, rows: [], pages: 0, error: null, heads: [] };
function nav(path) { history.pushState({}, "", path); window.dispatchEvent(new PopStateEvent("popstate", { state: {} })); }
async function waitFor(fn, max) { const t0 = Date.now(); while (Date.now() - t0 < (max || 20000)) { await sleep(300); try { if (fn()) return true; } catch (e) {} } return false; }
const KEYS = [[/^invoice/i, "no"], [/service agreement/i, "sa"], [/^job/i, "job"], [/^amount/i, "amount"], [/^balance/i, "balance"], [/^property/i, "property"], [/^issued/i, "issued"], [/billing/i, "billTo"], [/^status/i, "status"], [/^due/i, "due"], [/^created by/i, "by"], [/sync/i, "sync"]];
const num = s => { const n = parseFloat(String(s || "").replace(/[$,\s]/g, "")); return isNaN(n) ? null : n; };
const iso = s => { const d = new Date(s); return s && !isNaN(d) ? d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0") : ""; };
function fieldMap() {
  const m = {};
  document.querySelectorAll(".MuiDataGrid-columnHeader").forEach(h => {
    const t = (h.innerText || "").trim(), k = KEYS.find(([re]) => re.test(t));
    if (k && !Object.values(m).includes(k[1])) m[h.getAttribute("data-field")] = k[1];
  });
  S.heads = Object.values(m);
  return m;
}
async function readPage(found) {
  const scroller = document.querySelector(".MuiDataGrid-virtualScroller");
  // the grid is virtualised: walk it down and right so every row and column is drawn
  const sweepOnce = () => {
    const map = fieldMap();
    document.querySelectorAll(".MuiDataGrid-row").forEach(r => {
      const a = r.getAttribute("data-id") || r.getAttribute("data-rowindex");
      const o = found.get(a) || {};
      r.querySelectorAll(".MuiDataGrid-cell").forEach(c => { const k = map[c.getAttribute("data-field")]; if (k) { const t = (c.innerText || "").trim(); if (t) o[k] = t; } });
      found.set(a, o);
    });
  };
  if (!scroller) { sweepOnce(); return; }
  for (let x = 0; x <= 3; x++) {
    scroller.scrollLeft = x * scroller.clientWidth * 0.8;
    for (let y = 0; y <= scroller.scrollHeight; y += Math.max(200, scroller.clientHeight * 0.7)) {
      scroller.scrollTop = y; await sleep(120); sweepOnce();
    }
    scroller.scrollTop = 0; await sleep(120);
  }
}
async function run() {
  S.running = true; S.rows = []; S.pages = 0; S.error = null;
  try {
    if (!/\/invoice\/list/.test(location.pathname)) nav("/invoice/list");
    if (!await waitFor(() => document.querySelectorAll(".MuiDataGrid-row").length > 0, 30000)) throw new Error("invoice grid did not load");
    await sleep(800);
    for (let p = 0; p < 40; p++) {
      const found = new Map();
      await readPage(found);
      S.rows.push(...[...found.values()].filter(o => o.no));
      S.pages = p + 1;
      const next = document.querySelector('button[aria-label="Go to next page"], button[title="Go to next page"]');
      if (!next || next.disabled) break;
      const first = (document.querySelector(".MuiDataGrid-row") || {}).innerText;
      next.click();
      await waitFor(() => (document.querySelector(".MuiDataGrid-row") || {}).innerText !== first, 15000);
      await sleep(500);
    }
    const seen = new Set();
    S.rows = S.rows.filter(r => !seen.has(r.no) && seen.add(r.no)).map(r => ({ ...r, amount: num(r.amount), balance: num(r.balance), issued: iso(r.issued), due: iso(r.due) }));
  } catch (e) { S.error = String(e && e.message || e); }
  S.running = false;
}
window.alpineInvoices = {
  start() { if (!S.running) run(); return "started"; },
  status() { return { running: S.running, pages: S.pages, rows: S.rows.length, error: S.error, columns: S.heads }; },
  result() { return S.rows; },
  // Browser tool output truncates at about 1,000 characters, so the rows come back as CSV in short pieces.
  // Non-void invoices from the last 180 days: no,job,sa,amount,issued,by
  csv() {
    const cut = new Date(Date.now() - 180 * 86400000).toISOString().slice(0, 10), c = s => String(s == null ? "" : s).replace(/[,\n]/g, " ");
    return S.rows.filter(r => !/void/i.test(r.status || "") && (r.issued || "") >= cut).map(r => [r.no, r.job, r.sa, r.amount, r.issued, r.by].map(c).join(",")).join("\n");
  },
  chunks() { return Math.ceil(this.csv().length / 800); },
  chunk(i) { return this.csv().slice(i * 800, (i + 1) * 800); },
};
window.alpineInvoices.ready = true;
})();
