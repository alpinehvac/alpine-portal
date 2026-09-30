// ── Alpine HVAC — Site Reports ──────────────────────────────────────
// Quarterly maintenance progress per customer, with two views:
//   Internal  — monthly checklist review (Mike / Steve): mark tasks ✔ / Issue / N/A
//   Customer  — clean summary the account manager uses on the quarterly call
//
// Synced to Firestore collection site_reports_data via cloud-sync.js.
//   sr_item_<maint#>        one maintenance item with its task checklist
//   sr_jobs_<SA#>           service calls (jobs + visits) for an agreement
//   sr_call_<cust>_<qtr>    call prep notes + call-completed record
//   sr_meta                 last BuildOps pull date
// Dollar amounts and BuildOps property instructions are never stored.

(function () {
'use strict';

const K = { item: 'sr_item_', jobs: 'sr_jobs_', call: 'sr_call_', meta: 'sr_meta' };
const session = (typeof apGetSession === 'function' && apGetSession()) || { name: 'Unknown', roles: [] };
const TODAY = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const Q_MONTHS = ['Jan–Mar', 'Apr–Jun', 'Jul–Sep', 'Oct–Dec'];
const DONE_RE = /complete|converted|closed|finished|invoiced/i;

let items = [], jobsBySa = {}, meta = {};
let ui = { customer: '', quarter: '', view: 'internal', open: new Set(), outstandingOnly: new Set() };

// ── helpers ──────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function parseD(s) { if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null; const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function isoD(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function fmtD(s) { const d = typeof s === 'string' ? parseD(s) : s; return d ? MONTHS[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear() : '—'; }
function toIso(v) {
  if (!v) return '';
  if (v instanceof Date && !isNaN(v)) return isoD(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = new Date(v); return isNaN(d) ? '' : isoD(d);
}
function quarterOf(iso) { const d = parseD(iso); return d ? d.getFullYear() + '-Q' + (Math.floor(d.getMonth() / 3) + 1) : ''; }
function qLabel(q) { const [y, n] = q.split('-Q'); return 'Q' + n + ' ' + y; }
function qRange(q) { const [y, n] = q.split('-Q').map(Number); return [new Date(y, (n - 1) * 3, 1), new Date(y, n * 3, 0)]; }
function inQuarter(iso, q) { const d = parseD(iso); if (!d) return false; const [a, b] = qRange(q); return d >= a && d <= b; }
function custName(c) { return String(c || '').replace(/^\*+/, '').trim(); }
function custKey(c) { return custName(c).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50); }
function readJSON(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
function num(v) { const n = parseFloat(String(v).replace(/[^0-9.\-]/g, '')); return isNaN(n) ? null : n; }
function safeId(id) { return String(id).replace(/[^A-Za-z0-9\-]/g, '_'); }
let toastT; function toast(m) { const t = $('toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 3500); }

// ── storage ──────────────────────────────────────────────────────────
function loadAll() {
  items = []; jobsBySa = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k.startsWith(K.item)) { const r = readJSON(k); if (r && !r.deleted) items.push(r); }
    else if (k.startsWith(K.jobs)) { const r = readJSON(k); if (r && r.sa) jobsBySa[r.sa] = r; }
  }
  meta = readJSON(K.meta) || {};
}
function saveItem(it) { it.updatedAt = Date.now(); localStorage.setItem(K.item + safeId(it.id), JSON.stringify(it)); }
function callKey() { return K.call + ui.customer + '_' + ui.quarter; }
function getCall() { return readJSON(callKey()) || { recs: '', calledAt: '', calledBy: '', callNotes: '' }; }
function saveCall(c) { localStorage.setItem(callKey(), JSON.stringify(c)); }

// ── completion math ──────────────────────────────────────────────────
// ✔ counts as done. N/A is removed from the required count. If BuildOps marks the
// whole item Complete, every task not flagged Issue/N/A counts as done.
function itemStats(it) {
  const s = { total: 0, done: 0, issue: 0, na: 0 };
  const complete = /^complete/i.test(it.status || '');
  (it.tasks || []).forEach(t => {
    s.total++;
    if (t.done === 'N/A') s.na++;
    else if (t.done === 'Issue') s.issue++;
    else if (t.done === '✔' || complete) s.done++;
  });
  s.required = s.total - s.na;
  s.pct = s.required ? s.done / s.required : 0;
  return s;
}
function sumStats(list) {
  const s = { total: 0, done: 0, issue: 0, na: 0, required: 0 };
  list.forEach(it => { const x = itemStats(it); for (const k in s) s[k] += x[k]; });
  s.pct = s.required ? s.done / s.required : 0;
  return s;
}
function pct(p) { return Math.round(p * 100) + '%'; }
// Checklist finished in the portal but the maintenance item is still open in BuildOps.
function needsCloseOut(it) { const s = itemStats(it); return s.required > 0 && s.done >= s.required && !/^complete/i.test(it.status || ''); }

// ── selection ────────────────────────────────────────────────────────
function customers() {
  const m = new Map();
  // Customers come from maintenance items; service calls join by agreement (SA#),
  // so BuildOps naming differences like "c/o MPM Inc." don't split a customer in two.
  items.forEach(it => m.set(custKey(it.customer), custName(it.customer)));
  return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
}
function quartersFor(ck) {
  const qs = new Set([quarterOf(isoD(TODAY))]);
  items.filter(it => custKey(it.customer) === ck).forEach(it => it.quarter && qs.add(it.quarter));
  return [...qs].sort().reverse();
}
function scope() {
  const mine = items.filter(it => custKey(it.customer) === ui.customer && it.quarter === ui.quarter);
  const maint = mine.filter(it => it.kind !== 'Chiller Log').sort((a, b) => (a.property || '').localeCompare(b.property || '') || (a.id || '').localeCompare(b.id || '', undefined, { numeric: true }));
  const chiller = mine.filter(it => it.kind === 'Chiller Log').sort((a, b) => (a.due || '').localeCompare(b.due || '') || (a.property || '').localeCompare(b.property || ''));
  const sas = new Set(items.filter(it => custKey(it.customer) === ui.customer).map(it => it.sa));
  Object.values(jobsBySa).forEach(j => { if (custKey(j.customer) === ui.customer) sas.add(j.sa); });
  const calls = [];
  sas.forEach(sa => (jobsBySa[sa] && jobsBySa[sa].jobs || []).forEach(j => {
    if (j.kind === 'Maintenance') return;
    const vis = (j.visits || []).filter(v => inQuarter(v.date, ui.quarter));
    if (vis.length || (!(j.visits || []).length && inQuarter(j.created, ui.quarter))) calls.push({ ...j, sa, qVisits: vis });
  }));
  const seen = new Set();
  const uniqCalls = calls.filter(c => { if (seen.has(c.id)) return false; seen.add(c.id); return true; })
    .sort((a, b) => ((b.qVisits[0] || {}).date || b.created || '').localeCompare((a.qVisits[0] || {}).date || a.created || ''));
  return { maint, chiller, calls: uniqCalls };
}

function populatePickers() {
  const cs = customers();
  if (!cs.length) { $('pick-customer').innerHTML = '<option>No data yet</option>'; $('pick-quarter').innerHTML = ''; return false; }
  if (!ui.customer || !cs.some(c => c[0] === ui.customer)) ui.customer = cs[0][0];
  $('pick-customer').innerHTML = cs.map(([k, n]) => '<option value="' + esc(k) + '"' + (k === ui.customer ? ' selected' : '') + '>' + esc(n) + '</option>').join('');
  const qs = quartersFor(ui.customer);
  if (!ui.quarter || !qs.includes(ui.quarter)) {
    const withData = qs.find(q => items.some(it => custKey(it.customer) === ui.customer && it.quarter === q && it.kind !== 'Chiller Log'));
    ui.quarter = withData || qs[0];
  }
  $('pick-quarter').innerHTML = qs.map(q => '<option value="' + q + '"' + (q === ui.quarter ? ' selected' : '') + '>' + qLabel(q) + '</option>').join('');
  return true;
}

// ── render ───────────────────────────────────────────────────────────
function render() {
  loadAll();
  if (!populatePickers()) {
    $('main').innerHTML = '<div class="empty"><p>No site report data yet.</p><p style="margin-top:.5rem">Use <b>⇅ Data</b> to import the quarterly maintenance workbook or apply a BuildOps pull.</p></div>';
    return;
  }
  document.querySelectorAll('.seg button').forEach(b => b.classList.toggle('on', b.dataset.view === ui.view));
  if (ui.view === 'customer') renderCustomer(); else renderInternal();
}

function renderInternal() {
  const { maint, chiller, calls } = scope();
  const name = (customers().find(c => c[0] === ui.customer) || [, ''])[1];
  const s = sumStats(maint);
  const [, qEnd] = qRange(ui.quarter);
  const daysLeft = Math.round((qEnd - TODAY) / 86400000);
  const hrs = maint.reduce((a, it) => a + (num(it.budgetHrs) || 0), 0);
  const lastRev = maint.map(it => it.reviewedAt ? { at: it.reviewedAt, by: it.reviewedBy } : null).filter(Boolean).sort((a, b) => b.at.localeCompare(a.at))[0];
  const chDone = chiller.filter(c => DONE_RE.test(c.status || '')).length;
  const chLate = chiller.filter(c => !DONE_RE.test(c.status || '') && parseD(c.due) && parseD(c.due) < TODAY).length;
  const call = getCall();
  const closeOuts = maint.filter(needsCloseOut).length;

  let h = '<h1>' + esc(name) + '</h1>' +
    '<p class="sub">' + qLabel(ui.quarter) + ' (' + Q_MONTHS[+ui.quarter.slice(-1) - 1] + ') · ' +
    (daysLeft >= 0 ? daysLeft + ' days left in the quarter' : 'Quarter closed ' + fmtD(isoD(qEnd))) +
    ' · Last checklist review: ' + (lastRev ? esc(fmtD(lastRev.at)) + ' by ' + esc(lastRev.by) : 'not yet') + '</p>';

  h += '<div class="qhead">' +
    '<div><div class="k-label">Maintenance complete</div><div class="k-val">' + pct(s.pct) + '</div>' +
      '<div class="bigbar">' + bar(s) + '</div><div class="k-foot" style="margin-top:.35rem">' + s.done + ' of ' + s.required + ' tasks' + (s.na ? ' · ' + s.na + ' N/A' : '') + '</div></div>' +
    '<div><div class="k-label">Tasks remaining</div><div class="k-val">' + Math.max(0, s.required - s.done - s.issue) + '</div><div class="k-foot">across ' + maint.length + ' maintenance items</div></div>' +
    '<div><div class="k-label">Flagged issues</div><div class="k-val" style="color:' + (s.issue ? 'var(--red)' : 'inherit') + '">' + s.issue + '</div><div class="k-foot">for the customer call' + (closeOuts ? ' · <span style="color:var(--amber)">' + closeOuts + ' to close out in BuildOps</span>' : '') + '</div></div>' +
    '<div><div class="k-label">Chiller logs</div><div class="k-val">' + chDone + '/' + chiller.length + '</div><div class="k-foot">' + (chLate ? '<span style="color:var(--red)">' + chLate + ' past due</span>' : 'none past due') + ' · ' + hrs.toFixed(1) + ' budget hrs</div></div>' +
    '</div>';

  h += '<h2>Maintenance checklist</h2>';
  if (!maint.length) h += '<div class="empty">No maintenance items for ' + qLabel(ui.quarter) + '.</div>';
  maint.forEach(it => { h += itemHTML(it); });

  h += '<h2>Chiller logs</h2>';
  h += chiller.length ? '<div class="tbl-wrap"><table><thead><tr><th>Site</th><th>Item</th><th>Due</th><th>Status</th></tr></thead><tbody>' +
    chiller.map(c => { const late = !DONE_RE.test(c.status || '') && parseD(c.due) && parseD(c.due) < TODAY;
      return '<tr><td>' + esc(c.property) + '</td><td>' + esc(c.id) + '</td><td>' + fmtD(c.due) + '</td><td>' +
        '<span class="badge ' + (DONE_RE.test(c.status || '') ? 'b-teal' : late ? 'b-red' : 'b-grey') + '">' + esc(late ? 'Past due' : (c.status || '—')) + '</span></td></tr>'; }).join('') +
    '</tbody></table></div>' : '<p class="muted" style="font-size:.84rem">No chiller logs this quarter.</p>';

  h += '<h2>Service calls this quarter</h2>' + callsTable(calls, true);

  h += '<h2>Customer call</h2><div class="callbox no-print">' +
    '<div style="font-size:.84rem">' + (s.issue ? s.issue + ' flagged issue' + (s.issue > 1 ? 's' : '') + ' will appear under "Needs your attention" on the customer view.' : 'No flagged issues. Add talking points below if needed.') + '</div>' +
    '<label class="muted" style="font-size:.74rem;display:block;margin-top:.8rem">Recommendations and talking points (one per line, shown to the customer)</label>' +
    '<textarea class="inp" id="call-recs" placeholder="e.g. Boiler #2 at 20 Hughson is due for a heat exchanger inspection before winter">' + esc(call.recs) + '</textarea>' +
    '<div style="display:flex;gap:.6rem;align-items:center;margin-top:.8rem;flex-wrap:wrap">' +
    (call.calledAt ? '<span class="badge b-teal">Call completed ' + esc(fmtD(call.calledAt)) + ' by ' + esc(call.calledBy) + '</span> <button class="btn sm" data-act="call-undo">Undo</button>'
      : '<button class="btn primary" data-act="call-done">Mark call completed</button>') +
    '</div>' +
    (call.calledAt ? '<label class="muted" style="font-size:.74rem;display:block;margin-top:.8rem">Call notes (internal)</label><textarea class="inp" id="call-notes">' + esc(call.callNotes) + '</textarea>' : '') +
    '</div>';

  $('main').innerHTML = h;
}

function bar(s) {
  const t = s.required + s.na || 1;
  return '<i class="f-done" style="width:' + (s.done / t * 100) + '%"></i><i class="f-issue" style="width:' + (s.issue / t * 100) + '%"></i><i class="f-na" style="width:' + (s.na / t * 100) + '%"></i>';
}

function itemHTML(it) {
  const s = itemStats(it);
  const open = ui.open.has(it.id);
  const onlyOut = ui.outstandingOnly.has(it.id);
  const due = parseD(it.due);
  const dueFlag = due && !inQuarter(it.due, ui.quarter) ? ' <span class="badge b-amber">due ' + esc(fmtD(it.due)) + '</span>' : '';
  let body = '';
  if (open) {
    const seen = new Set();
    const groups = new Map();
    (it.tasks || []).forEach((t, i) => {
      const sig = (t.asset + '|' + t.task + '|' + t.desc).toLowerCase();
      const dup = seen.has(sig); seen.add(sig);
      if (onlyOut && (t.done === '✔' || t.done === 'N/A')) return;
      if (!groups.has(t.asset)) groups.set(t.asset, []);
      groups.get(t.asset).push({ t, i, dup });
    });
    body = '<div class="item-tools">' +
      '<button class="btn sm" data-act="only-out" data-id="' + esc(it.id) + '">' + (onlyOut ? 'Show all tasks' : 'Show outstanding only') + '</button>' +
      '<button class="btn sm" data-act="all-done" data-id="' + esc(it.id) + '">Mark all remaining ✔</button>' +
      '<span class="muted">BuildOps status: ' + esc(it.status || '—') + (/^complete/i.test(it.status || '') ? ' (all tasks count as done unless flagged)' : '') + '</span>' +
      '</div>' +
      (groups.size ? [...groups.entries()].map(([asset, arr]) =>
        '<div class="asset-group"><div class="asset-name">' + esc(asset || 'General') + '</div>' +
        arr.map(({ t, i, dup }) =>
          '<div class="task' + (dup ? ' dup' : '') + '">' +
          '<div><div class="t-desc">' + esc(t.desc || t.task) + '</div>' + (t.by ? '<div class="t-sub">' + esc(t.done || 'Cleared') + ' · ' + esc(t.by) + ' · ' + esc(fmtD(t.at)) + '</div>' : '') + '</div>' +
          '<div class="mark" role="group" aria-label="Task status">' +
            ['✔', 'Issue', 'N/A'].map(v => '<button data-act="mark" data-id="' + esc(it.id) + '" data-i="' + i + '" data-v="' + v + '" class="' +
              (t.done === v ? (v === '✔' ? 'on-done' : v === 'Issue' ? 'on-issue' : 'on-na') : '') + '">' + v + '</button>').join('') +
          '</div>' +
          (t.done === 'Issue' ? '<div class="task-note"><input class="inp" data-act="note" data-id="' + esc(it.id) + '" data-i="' + i + '" value="' + esc(t.note || '') + '" placeholder="What did the tech find? (shown to the customer)"></div>' : '') +
          '</div>').join('') + '</div>').join('')
        : '<p class="muted" style="font-size:.82rem">' + (onlyOut ? 'Everything on this item is done.' : 'No task list loaded for this item.') + '</p>');
  }
  return '<div class="item' + (open ? ' open' : '') + '">' +
    '<div class="item-head" data-act="toggle" data-id="' + esc(it.id) + '">' +
      '<div><div class="item-title">' + esc(it.property || it.id) + dueFlag + (s.issue ? ' <span class="badge b-red">' + s.issue + ' issue' + (s.issue > 1 ? 's' : '') + '</span>' : '') + (needsCloseOut(it) ? ' <span class="badge b-amber" title="Every task is done here but BuildOps still shows this item open">Close out in BuildOps</span>' : '') + '</div>' +
      '<div class="item-meta">' + esc(it.id) + ' · ' + esc(it.status || '—') + (it.budgetHrs ? ' · ' + esc(it.budgetHrs) + ' budget hrs' : '') + (it.reviewedAt ? ' · reviewed ' + esc(fmtD(it.reviewedAt)) : '') + '</div></div>' +
      '<div class="hide-sm"><div class="minibar">' + bar(s) + '</div></div>' +
      '<div class="hide-sm item-meta" style="text-align:right">' + s.done + ' of ' + s.required + ' tasks</div>' +
      '<div class="pct">' + pct(s.pct) + '</div>' +
      '<div class="chev">›</div>' +
    '</div><div class="item-body">' + body + '</div></div>';
}

function callsTable(calls, internal) {
  if (!calls.length) return internal ? '<p class="muted" style="font-size:.84rem">No service calls recorded for this quarter' + (meta.lastPull ? ' (BuildOps pulled ' + esc(fmtD(meta.lastPull)) + ')' : ' (BuildOps not pulled yet)') + '.</p>'
    : '<p class="p-none">No service calls were needed this quarter.</p>';
  return '<div class="tbl-wrap"><table><thead><tr><th>Date</th><th>Site</th><th>What we addressed</th>' + (internal ? '<th>Job</th><th>Techs</th><th>Status</th>' : '') + '</tr></thead><tbody>' +
    calls.map(c => {
      const v = c.qVisits[0] || {};
      const what = [c.title, ...c.qVisits.map(x => x.desc).filter(d => d && d !== c.title)].filter(Boolean);
      const uniq = [...new Set(what)];
      return '<tr><td style="white-space:nowrap">' + esc(fmtD(v.date || c.created)) + (c.qVisits.length > 1 ? '<br><span style="font-size:.72rem;opacity:.6">' + c.qVisits.length + ' visits</span>' : '') + '</td>' +
        '<td>' + esc(c.property || '') + '</td><td>' + uniq.map(esc).join('<br>') + '</td>' +
        (internal ? '<td>' + (c.url ? '<a style="color:var(--teal-light)" target="_blank" rel="noopener" href="' + esc(/^https?:/.test(c.url) ? c.url : 'https://live.buildops.com' + c.url) + '">' + esc(c.id) + '</a>' : esc(c.id)) + '</td>' +
          '<td>' + esc([...new Set(c.qVisits.flatMap(x => [x.tech, x.others]).filter(Boolean).join(', ').split(', '))].filter(Boolean).join(', ')) + '</td><td>' + esc(c.status || '') + '</td>' : '') + '</tr>';
    }).join('') + '</tbody></table></div>';
}

function renderCustomer() {
  const { maint, calls } = scope();
  const name = (customers().find(c => c[0] === ui.customer) || [, ''])[1];
  const s = sumStats(maint);
  const call = getCall();
  const byProp = new Map();
  maint.forEach(it => { const k = it.property || 'Site'; if (!byProp.has(k)) byProp.set(k, []); byProp.get(k).push(it); });
  const issues = [];
  maint.forEach(it => (it.tasks || []).forEach(t => { if (t.done === 'Issue') issues.push({ site: it.property, asset: t.asset, text: t.note || t.desc || t.task }); }));
  const recs = (call.recs || '').split('\n').map(x => x.trim()).filter(Boolean);
  const [, qEnd] = qRange(ui.quarter);
  const open = qEnd >= TODAY;

  let h = '<div class="paper">' +
    '<div class="p-top"><div><div class="p-brand">Alpine HVAC<small>Hydronics · Controls · Building Systems</small></div>' +
      '<h3 style="margin-top:.9rem">' + esc(name) + '</h3><div style="font-size:.9rem;color:#3d4348">Quarterly Service Summary · ' + qLabel(ui.quarter) + ' (' + Q_MONTHS[+ui.quarter.slice(-1) - 1] + ')</div></div>' +
      '<div class="p-date">Prepared ' + esc(fmtD(isoD(TODAY))) + (open ? '<br><span style="color:#C97A1E">Quarter in progress</span>' : '') + '</div></div>';

  h += '<div class="p-head"><div><div class="p-big">' + pct(s.pct) + '</div></div>' +
    '<div class="p-big-label"><b>' + s.done + ' of ' + s.required + '</b> scheduled maintenance tasks completed across <b>' + byProp.size + ' site' + (byProp.size === 1 ? '' : 's') + '</b>' +
    (calls.length ? ', plus <b>' + calls.length + ' service call' + (calls.length === 1 ? '' : 's') + '</b>' : '') + '.</div></div>';

  h += '<h4>Maintenance by site</h4>';
  if (!byProp.size) h += '<p class="p-none">No scheduled maintenance this quarter.</p>';
  byProp.forEach((list, site) => {
    const ps = sumStats(list);
    const assets = [...new Set(list.flatMap(it => (it.tasks || []).filter(t => t.done === '✔' || (/^complete/i.test(it.status || '') && !t.done)).map(t => t.asset)).filter(Boolean))];
    h += '<div class="p-prop"><div>' + esc(site) + '</div><div class="p-bar"><i style="width:' + (ps.pct * 100) + '%"></i></div><div class="p-pct">' + pct(ps.pct) + '</div>' +
      (assets.length ? '<div class="p-eq">Serviced: ' + esc(assets.slice(0, 8).join(', ')) + (assets.length > 8 ? ' and ' + (assets.length - 8) + ' more' : '') + '</div>' : '') + '</div>';
  });

  h += '<h4>Service calls</h4>' + callsTable(calls, false);

  h += '<h4>Needs your attention</h4>';
  if (!issues.length && !recs.length) h += '<p class="p-none">No outstanding concerns this quarter.</p>';
  issues.forEach(x => { h += '<div class="p-attn"><b>' + esc(x.asset || 'Equipment') + ' · ' + esc(x.site || '') + '</b>' + esc(x.text) + '</div>'; });
  recs.forEach(r => { h += '<div class="p-attn">' + esc(r) + '</div>'; });

  h += '<div class="p-foot"><span>Questions? Call 289 438 1175 · alpinehvac.ca</span><span>Prepared by ' + esc(session.name) + '</span></div></div>';
  $('main').innerHTML = h;
}

// ── actions ──────────────────────────────────────────────────────────
function findItem(id) { return items.find(it => it.id === id); }
function stampReview(it) { it.reviewedAt = isoD(TODAY); it.reviewedBy = session.name; }

function markTask(id, i, v) {
  const it = findItem(id); const t = it && it.tasks[i]; if (!t) return;
  t.done = t.done === v ? '' : v;
  t.by = session.name; t.at = isoD(TODAY);
  if (t.done !== 'Issue') delete t.note;
  stampReview(it); saveItem(it); render();
}
function markAllDone(id) {
  const it = findItem(id); if (!it) return;
  let n = 0;
  it.tasks.forEach(t => { if (!t.done) { t.done = '✔'; t.by = session.name; t.at = isoD(TODAY); n++; } });
  stampReview(it); saveItem(it); render(); toast(n + ' tasks marked done on ' + (it.property || it.id) + '.');
}

// ── import: workbook + BuildOps JSON ─────────────────────────────────
// Merges by maintenance #. BuildOps fields are refreshed; checklist marks already
// entered in the portal are kept (a task is matched by asset + task + description).
function mergeItem(inc) {
  if (!inc.id) return 'skip';
  const k = K.item + safeId(inc.id);
  const ex = readJSON(k);
  if (!ex || ex.deleted) { inc.tasks = (inc.tasks || []).map(t => ({ ...t, done: t.done || '' })); inc.updatedAt = Date.now(); localStorage.setItem(k, JSON.stringify(inc)); return 'add'; }
  ['sa', 'customer', 'property', 'quarter', 'due', 'type', 'kind', 'status', 'budgetHrs'].forEach(f => { if (inc[f] !== undefined && inc[f] !== '') ex[f] = inc[f]; });
  if (Array.isArray(inc.tasks) && inc.tasks.length) {
    const pool = new Map();
    (ex.tasks || []).forEach(t => { const s = (t.asset + '|' + t.task + '|' + t.desc).toLowerCase(); if (!pool.has(s)) pool.set(s, []); pool.get(s).push(t); });
    ex.tasks = inc.tasks.map(t => {
      const s = (t.asset + '|' + t.task + '|' + t.desc).toLowerCase();
      const prev = pool.has(s) && pool.get(s).length ? pool.get(s).shift() : null;
      return prev && prev.done ? { ...t, done: prev.done, note: prev.note, by: prev.by, at: prev.at } : { ...t, done: t.done || '' };
    });
  }
  ex.updatedAt = Date.now(); localStorage.setItem(k, JSON.stringify(ex));
  return 'update';
}

function importWorkbook(file, year) {
  const reader = new FileReader();
  reader.onload = e => importWorkbookBuffer(e.target.result, year);
  reader.readAsArrayBuffer(file);
}
// Also callable directly (used when Claude loads the workbook from SharePoint in your browser).
window.srImportWorkbookBuffer = (buf, year) => importWorkbookBuffer(buf, year || TODAY.getFullYear());

function importWorkbookBuffer(buf, year) {
    try {
      const wb = XLSX.read(buf, { type: 'array', cellDates: true });
      const data = wb.Sheets['Data'], chk = wb.Sheets['Task Summary Checklist'];
      if (!data) { toast('No "Data" sheet found in that workbook.'); return; }
      const rows = XLSX.utils.sheet_to_json(data, { header: 1, raw: true });
      const hdr = rows[0].map(x => String(x || '').trim());
      const col = n => hdr.indexOf(n);
      const byId = {};
      rows.slice(1).forEach(r => {
        const id = String(r[col('Maintenance #')] || '').trim(); if (!id) return;
        const type = String(r[col('Maintenance Type')] || '').trim();
        const due = toIso(r[col('Due Date')]);
        const kind = /chiller/i.test(type) ? 'Chiller Log' : 'Maintenance';
        const qn = String(r[col('Quarter')] || '').replace(/\D/g, '');
        byId[id] = {
          id, sa: id.split('-')[0], customer: String(r[col('Customer')] || '').trim(), property: String(r[col('Property')] || '').trim(),
          due, type, kind, status: String(r[col('Status')] || '').trim(), budgetHrs: num(r[col('Budgeted Hours')]),
          quarter: kind === 'Chiller Log' ? (quarterOf(due) || (year + '-Q' + qn)) : (qn ? year + '-Q' + qn : quarterOf(due)), tasks: []
        };
      });
      if (chk) {
        let cur = null;
        XLSX.utils.sheet_to_json(chk, { header: 1, raw: true }).forEach(r => {
          const a = String(r[0] == null ? '' : r[0]).trim();
          if (a === 'Maintenance #') { cur = byId[String(r[1] || '').trim()] || null; return; }
          if (cur && /^\d+$/.test(a)) cur.tasks.push({ n: +a, asset: String(r[1] || '').trim(), task: String(r[2] || '').trim(), desc: String(r[3] || '').trim(), done: ['✔', 'Issue', 'N/A'].includes(String(r[4] || '').trim()) ? String(r[4]).trim() : '' });
        });
      }
      const res = { add: 0, update: 0, skip: 0 };
      Object.values(byId).forEach(it => res[mergeItem(it)]++);
      closeModal(); render();
      toast('Workbook imported: ' + res.add + ' items added, ' + res.update + ' updated.');
    } catch (err) { console.error(err); toast('Could not read that file. Check it is the maintenance report workbook (.xlsx).'); }
}

function importJSON(txt) {
  let d; try { d = JSON.parse(txt); } catch (e) { toast('That is not valid JSON.'); return; }
  const res = { add: 0, update: 0, skip: 0 };
  (d.items || []).forEach(it => res[mergeItem(it)]++);
  let j = 0;
  Object.entries(d.jobs || {}).forEach(([sa, v]) => { localStorage.setItem(K.jobs + sa, JSON.stringify({ sa, customer: v.customer || '', jobs: v.jobs || [], syncedAt: d.syncedAt || isoD(TODAY) })); j++; });
  meta.lastPull = d.syncedAt || isoD(TODAY); localStorage.setItem(K.meta, JSON.stringify(meta));
  closeModal(); render();
  toast('BuildOps data applied: ' + res.add + ' items added, ' + res.update + ' updated, service calls for ' + j + ' agreements.');
}

function openData() {
  $('modal-box').innerHTML = '<h3>Data</h3>' +
    '<p><b>Import maintenance workbook.</b> Reads the Data and Task Summary Checklist sheets (e.g. Alpine\'s Q3 Maintenance Report.xlsx). Checkmarks already entered here are kept.</p>' +
    '<div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap"><input type="file" id="wb-file" accept=".xlsx"><label class="muted" style="font-size:.78rem">Year <input class="inp" id="wb-year" type="number" value="' + TODAY.getFullYear() + '" style="width:80px"></label>' +
    '<button class="btn primary" data-act="wb-import">Import</button></div>' +
    '<p style="margin-top:1.25rem"><b>BuildOps pull.</b> Paste the JSON from a BuildOps pull (maintenance items, task lists, service calls).</p>' +
    '<textarea class="inp" id="bo-json" style="width:100%;min-height:120px;font-size:.74rem" placeholder=\'{"syncedAt":"2026-10-01","items":[...],"jobs":{"SA1023":{"customer":"Berg Equipment","jobs":[...]}}}\'></textarea>' +
    '<div class="modal-actions"><button class="btn" data-act="export">Download backup</button><button class="btn" data-act="close">Close</button><button class="btn primary" data-act="bo-apply">Apply BuildOps pull</button></div>';
  $('modal').classList.add('open');
}
function closeModal() { $('modal').classList.remove('open'); }

// ── events ───────────────────────────────────────────────────────────
document.addEventListener('click', e => {
  const b = e.target.closest('[data-act],[data-view]');
  if (!b) return;
  if (b.dataset.view) { ui.view = b.dataset.view; render(); window.scrollTo(0, 0); return; }
  const id = b.dataset.id;
  switch (b.dataset.act) {
    case 'toggle': ui.open.has(id) ? ui.open.delete(id) : ui.open.add(id); render(); break;
    case 'only-out': ui.outstandingOnly.has(id) ? ui.outstandingOnly.delete(id) : ui.outstandingOnly.add(id); render(); break;
    case 'mark': markTask(id, +b.dataset.i, b.dataset.v); break;
    case 'all-done': markAllDone(id); break;
    case 'call-done': { const c = getCall(); c.recs = ($('call-recs') || {}).value || c.recs; c.calledAt = isoD(TODAY); c.calledBy = session.name; saveCall(c); render(); toast('Call marked completed.'); break; }
    case 'call-undo': { const c = getCall(); c.calledAt = ''; c.calledBy = ''; saveCall(c); render(); break; }
    case 'wb-import': { const f = $('wb-file').files[0]; if (!f) { toast('Choose the workbook file first.'); return; } importWorkbook(f, parseInt($('wb-year').value, 10) || TODAY.getFullYear()); break; }
    case 'bo-apply': importJSON($('bo-json').value); break;
    case 'export': {
      loadAll();
      const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), items, jobs: jobsBySa, meta }, null, 2)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'alpine-site-reports-' + isoD(TODAY) + '.json'; document.body.appendChild(a); a.click(); a.remove();
      break;
    }
    case 'close': closeModal(); break;
  }
});
document.addEventListener('change', e => {
  const el = e.target;
  if (el.id === 'pick-customer') { ui.customer = el.value; ui.quarter = ''; ui.open.clear(); render(); }
  else if (el.id === 'pick-quarter') { ui.quarter = el.value; ui.open.clear(); render(); }
  else if (el.dataset.act === 'note') {
    const it = findItem(el.dataset.id); const t = it && it.tasks[+el.dataset.i];
    if (t) { t.note = el.value.trim(); t.by = session.name; t.at = isoD(TODAY); stampReview(it); saveItem(it); toast('Note saved.'); }
  } else if (el.id === 'call-recs') { const c = getCall(); c.recs = el.value; saveCall(c); toast('Talking points saved.'); }
  else if (el.id === 'call-notes') { const c = getCall(); c.callNotes = el.value; saveCall(c); toast('Call notes saved.'); }
});
$('btn-print').addEventListener('click', () => { if (ui.view !== 'customer') { ui.view = 'customer'; render(); } setTimeout(() => window.print(), 150); });
$('btn-data').addEventListener('click', openData);
$('modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

const qp = new URLSearchParams(location.search);
if (qp.get('c')) ui.customer = qp.get('c');
if (qp.get('q')) ui.quarter = qp.get('q');
render();
})();
