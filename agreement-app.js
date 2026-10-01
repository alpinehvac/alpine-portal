// ── Alpine HVAC — Service Agreement detail page ─────────────────────
// agreement.html?id=SA1023
// Reads the agreement (service_agreements_data) and its maintenance checklists
// (site_reports_data, keys sr_*) through cloud-sync routing. Edits here are
// limited to renewal fields; dates/ACV/renew/lost stay in the tracker drawer.

(function () {
'use strict';

const TODAY = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const STAGES = ['Not Started', 'Proposal Sent'];
const DONE_RE = /complete|converted|closed|finished|invoiced/i;
const BO = 'https://live.buildops.com';
const session = (typeof apGetSession === 'function' && apGetSession()) || { name: 'Unknown' };
const id = (new URLSearchParams(location.search).get('id') || '').toUpperCase();
const $ = x => document.getElementById(x);
let year = TODAY.getFullYear();

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function parseD(s) { if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null; const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function isoD(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function fmtD(s) { const d = parseD(s); return d ? MONTHS[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear() : '—'; }
function addDays(s, n) { const d = parseD(s); d.setDate(d.getDate() + n); return isoD(d); }
function addYears(s, n) { const d = parseD(s); const o = new Date(d.getFullYear() + n, d.getMonth(), d.getDate()); if (o.getMonth() !== d.getMonth()) o.setDate(0); return isoD(o); }
function effEnd(a) { return a.endDate || (a.startDate ? addDays(addYears(a.startDate, 1), -1) : ''); }
function money(n) { return n == null || n === '' || isNaN(n) ? '—' : '$' + Number(n).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function readJSON(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
function qIdx(iso) { const d = parseD(iso); return d ? Math.floor(d.getMonth() / 3) : -1; }
function inYear(iso) { const d = parseD(iso); return !!d && d.getFullYear() === year; }
let toastT; function toast(m) { const t = $('toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 3000); }

function load() {
  const a = readJSON('sa_agr_' + id);
  const sr = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k.startsWith('sr_item_')) { const it = readJSON(k); if (it && !it.deleted && it.sa === id) sr.push(it); }
  }
  const srJobs = readJSON('sr_jobs_' + id);
  return { a, sr, srJobs };
}

// Checklist stats for one site-report item (same rules as Site Reports).
function checklist(it) {
  const s = { total: 0, done: 0, issue: 0, na: 0 };
  const complete = /^complete/i.test(it.status || '');
  (it.tasks || []).forEach(t => { s.total++; if (t.done === 'N/A') s.na++; else if (t.done === 'Issue') s.issue++; else if (t.done === '✔' || complete) s.done++; });
  s.required = s.total - s.na; s.pct = s.required ? s.done / s.required : null;
  return s;
}

// Maintenance rows: BuildOps schedule, joined to portal checklists by maintenance #.
function maintRows(a, sr) {
  const byId = new Map(sr.map(it => [it.id, it]));
  const rows = [];
  const seen = new Set();
  (a.maint || []).forEach(m => {
    if (!m.id && !m.due) return;
    const it = m.id ? byId.get(m.id) : null;
    rows.push({ id: m.id || '', due: m.due, status: m.status, property: m.property || (it && it.property) || '', hrs: m.budgetHrs, kind: /chiller/i.test(m.type || '') ? 'Chiller Log' : ((it && it.kind) || 'Maintenance'), type: m.type || (it && it.type) || '', check: it && it.kind !== 'Chiller Log' ? checklist(it) : null });
    if (m.id) seen.add(m.id);
  });
  sr.forEach(it => {
    if (seen.has(it.id)) return;
    rows.push({ id: it.id, due: it.due, status: it.status, property: it.property, hrs: it.budgetHrs, kind: it.kind, type: it.type, check: it.kind !== 'Chiller Log' ? checklist(it) : null });
  });
  rows.forEach(r => { r.closeOut = !!(r.check && r.check.required && r.check.done >= r.check.required && !/^complete/i.test(r.status || '')); });
  return rows.sort((x, y) => (x.due || '').localeCompare(y.due || '') || (x.property || '').localeCompare(y.property || ''));
}

function serviceJobs(a, srJobs) {
  const src = (a.work && a.work.jobs) || (srJobs && srJobs.jobs) || [];
  return src.filter(j => j.kind !== 'Maintenance');
}

function render() {
  const { a, sr, srJobs } = load();
  if (!a || a.deleted) { $('main').innerHTML = '<p class="empty">Agreement ' + esc(id || '(none)') + ' not found. <a href="service-agreements.html">Back to agreements</a></p>'; return; }
  document.title = 'Alpine HVAC — ' + a.id + ' ' + a.name;
  $('lnk-bo').href = a.buildopsId ? BO + '/serviceAgreement/view/' + a.buildopsId : BO;
  $('lnk-edit').href = 'service-agreements.html#edit=' + encodeURIComponent(a.id);
  const custKey = String(sr[0] ? sr[0].customer : a.customer || '').replace(/^\*+/, '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
  const curQ = TODAY.getFullYear() + '-Q' + (Math.floor(TODAY.getMonth() / 3) + 1);
  $('lnk-site').href = 'site-reports.html?c=' + encodeURIComponent(custKey) + '&q=' + curQ;

  const end = effEnd(a);
  const days = parseD(end) ? Math.round((parseD(end) - TODAY) / 86400000) : null;
  const rb = days === null ? '' : days < 0 ? '<span class="badge b-red">Renewal overdue</span>' : days <= 30 ? '<span class="badge b-red">Renews in ' + days + ' days</span>' : days <= 60 ? '<span class="badge b-amber">Renews in ' + days + ' days</span>' : days <= 90 ? '<span class="badge b-purple">Renews in ' + days + ' days</span>' : '<span class="badge b-grey">Renews in ' + days + ' days</span>';
  const statusB = '<span class="badge ' + (a.status === 'Active' ? 'b-teal' : a.status === 'Draft' ? 'b-amber' : 'b-grey') + '">' + esc(a.status) + '</span>';

  const rows = maintRows(a, sr);
  const svc = serviceJobs(a, srJobs);
  const years = new Set([TODAY.getFullYear()]);
  rows.forEach(r => { const d = parseD(r.due); if (d) years.add(d.getFullYear()); });
  svc.forEach(j => (j.visits || []).forEach(v => { const d = parseD(v.date); if (d) years.add(d.getFullYear()); }));

  let h = '<div class="kicker"><span class="id">' + esc(a.id) + '</span>' + statusB + (a.status === 'Active' ? rb : '') + '</div>' +
    '<h1>' + esc(a.name) + '</h1><div class="cust">' + esc(String(a.customer || '').replace(/^\*+/, '')) + '</div>';
  h += '<div class="facts">' +
    fact('ACV (pre-tax)', money(a.acv), true) +
    fact('Start', fmtD(a.startDate)) +
    fact('End', fmtD(end) + (a.endDate ? '' : '<span class="rule" title="No end date in BuildOps: start + 1 year − 1 day">rule</span>')) +
    fact('Billing', esc(a.billing || '—')) +
    fact('Sold by', esc(a.soldBy || '—')) +
    fact('PM', esc(a.pm || '—')) +
    fact('Last BuildOps pull', a.work && a.work.syncedAt ? fmtD(a.work.syncedAt) : 'Not pulled') +
    '</div>';
  if (a.flag) h += '<div class="flag-box"><b>Review:</b> ' + esc(a.flag) + '</div>';

  // sites for this agreement
  const sites = [];
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith('st_site_')) { const st = readJSON(k); if (st && (st.sas || []).includes(a.id)) sites.push(st); } }
  if (sites.length) {
    h += '<div class="section"><div class="section-head"><h2>Sites <span class="note">Activity by bucket and CLEAR report per address</span></h2></div><div class="tbl-wrap"><table><tbody>' +
      sites.sort((x, y) => (x.name || '').localeCompare(y.name || '')).map(st => '<tr><td><b>' + esc(st.name) + '</b><div class="muted" style="font-size:.74rem">' + esc(st.address || '') + '</div></td>' +
        '<td style="white-space:nowrap;text-align:right"><a class="btn" href="site.html?p=' + encodeURIComponent(st.id) + '">Activity</a> <a class="btn" href="site.html?p=' + encodeURIComponent(st.id) + '&view=clear">CLEAR report</a></td></tr>').join('') +
      '</tbody></table></div></div>';
  }

  // quarter grid
  h += '<div class="section"><div class="section-head"><h2>Work by quarter <span class="note">Maintenance from BuildOps, checklist % from Site Reports</span></h2>' +
    '<select class="sel" id="year">' + [...years].sort((x, y) => y - x).map(y => '<option' + (y === year ? ' selected' : '') + '>' + y + '</option>').join('') + '</select></div>';
  const cq = year === TODAY.getFullYear() ? Math.floor(TODAY.getMonth() / 3) : (year < TODAY.getFullYear() ? 3 : -1);
  const Q = [0, 1, 2, 3].map(() => ({ mTot: 0, mDone: 0, cDone: 0, cReq: 0, svc: new Set(), visits: 0, close: 0 }));
  rows.filter(r => r.kind !== 'Chiller Log' && inYear(r.due)).forEach(r => {
    const q = Q[qIdx(r.due)]; q.mTot++; if (DONE_RE.test(r.status || '')) q.mDone++;
    if (r.check) { q.cDone += r.check.done; q.cReq += r.check.required; }
    if (r.closeOut) q.close++;
  });
  svc.forEach(j => {
    const vis = (j.visits || []).filter(v => inYear(v.date));
    vis.forEach(v => { const q = Q[qIdx(v.date)]; q.svc.add(j.id); q.visits++; });
    if (!(j.visits || []).length && inYear(j.created)) Q[qIdx(j.created)].svc.add(j.id);
  });
  const Y = Q.reduce((t, q) => { t.mTot += q.mTot; t.mDone += q.mDone; t.cDone += q.cDone; t.cReq += q.cReq; t.visits += q.visits; t.close += q.close; q.svc.forEach(x => t.svc.add(x)); return t; }, { mTot: 0, mDone: 0, cDone: 0, cReq: 0, svc: new Set(), visits: 0, close: 0 });
  const cell = (label, q, cls) => '<div class="qcell ' + cls + '"><div class="q-label"><span>' + label + '</span>' + (q.close ? '<span class="badge b-amber">' + q.close + ' to close out</span>' : '') + '</div>' +
    '<div class="q-row"><b>' + q.mDone + '/' + q.mTot + '</b><span>maintenance items closed</span></div>' +
    '<div class="q-row"><b>' + (q.cReq ? Math.round(q.cDone / q.cReq * 100) + '%' : '—') + '</b><span>checklist tasks done</span></div>' +
    (q.cReq ? '<div class="minibar"><i style="width:' + (q.cDone / q.cReq * 100) + '%"></i></div>' : '') +
    '<div class="q-row" style="margin-top:.35rem"><b>' + q.svc.size + '</b><span>service calls' + (q.visits ? ' · ' + q.visits + ' visits' : '') + '</span></div></div>';
  h += '<div class="qgrid">' + Q.map((q, i) => cell('Q' + (i + 1), q, i > cq ? 'future' : (i === cq && year === TODAY.getFullYear() ? 'current' : ''))).join('') +
    cell(year === TODAY.getFullYear() ? 'YTD' : year, Y, 'ytd') + '</div></div>';

  // maintenance table
  const yRows = rows.filter(r => inYear(r.due));
  h += '<div class="section"><div class="section-head"><h2>Maintenance <span class="note">' + yRows.length + ' items in ' + year + '</span></h2></div>';
  if (!yRows.length) h += '<div class="tbl-wrap"><p class="empty">No maintenance scheduled in ' + year + (a.maint && a.maint.length ? '' : ' (BuildOps schedule not pulled yet)') + '.</p></div>';
  else {
    h += '<div class="tbl-wrap"><table><thead><tr><th>Item</th><th>Site</th><th>Type</th><th>Due</th><th>BuildOps status</th><th class="num">Budget hrs</th><th>Checklist</th></tr></thead><tbody>';
    let lastQ = -1;
    yRows.forEach(r => {
      const q = qIdx(r.due);
      if (q !== lastQ) { h += '<tr class="qsep"><td colspan="7">Q' + (q + 1) + ' ' + year + '</td></tr>'; lastQ = q; }
      const late = !DONE_RE.test(r.status || '') && parseD(r.due) && parseD(r.due) < TODAY;
      h += '<tr><td style="white-space:nowrap">' + esc(r.id) + '</td><td>' + esc(r.property) + '</td><td>' + esc(r.kind === 'Chiller Log' ? 'Chiller log' : (r.type || 'Maintenance')) + '</td>' +
        '<td style="white-space:nowrap">' + fmtD(r.due) + '</td>' +
        '<td><span class="badge ' + (DONE_RE.test(r.status || '') ? 'b-teal' : late ? 'b-red' : 'b-grey') + '">' + esc(late && !/overdue/i.test(r.status || '') ? (r.status || 'Open') + ' · past due' : (r.status || '—')) + '</span></td>' +
        '<td class="num">' + (r.hrs != null && r.hrs !== '' ? esc(r.hrs) : '—') + '</td>' +
        '<td>' + (r.check ? (r.check.required ? Math.round(r.check.pct * 100) + '% <span class="muted">(' + r.check.done + '/' + r.check.required + ')</span>' : '<span class="muted">No tasks</span>') + (r.check.issue ? ' <span class="badge b-red">' + r.check.issue + ' issue' + (r.check.issue > 1 ? 's' : '') + '</span>' : '') + (r.closeOut ? ' <span class="badge b-amber">Close out in BuildOps</span>' : '') : '<span class="muted">—</span>') + '</td></tr>';
    });
    h += '</tbody></table></div>';
  }
  h += '</div>';

  // service calls
  const yJobs = svc.filter(j => (j.visits || []).some(v => inYear(v.date)) || (!(j.visits || []).length && inYear(j.created)));
  h += '<div class="section"><div class="section-head"><h2>Service calls <span class="note">' + yJobs.length + ' in ' + year + '</span></h2></div>';
  if (!yJobs.length) h += '<div class="tbl-wrap"><p class="empty">No service calls in ' + year + (a.work ? '' : ' (BuildOps not pulled yet)') + '.</p></div>';
  [3, 2, 1, 0].forEach(q => {
    const js = yJobs.filter(j => (j.visits || []).some(v => inYear(v.date) && qIdx(v.date) === q) || (!(j.visits || []).length && inYear(j.created) && qIdx(j.created) === q));
    if (!js.length) return;
    h += '<div class="q-head">Q' + (q + 1) + ' ' + year + '</div>';
    js.forEach(j => {
      const vis = (j.visits || []).filter(v => inYear(v.date) && qIdx(v.date) === q).sort((x, y) => (y.date || '').localeCompare(x.date || ''));
      const url = j.url ? (/^https?:/.test(j.url) ? j.url : BO + j.url) : '';
      h += '<div class="job"><div class="job-top">' + (url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(j.id) + ' ↗</a>' : '<b>' + esc(j.id) + '</b>') +
        '<span class="muted">' + esc(j.type || '') + (j.property ? ' · ' + esc(j.property) : '') + '</span>' +
        '<span class="badge ' + (/open|progress/i.test(j.status || '') ? 'b-amber' : 'b-grey') + '">' + esc(j.status || '') + '</span></div>' +
        (j.title ? '<div class="job-title">' + esc(j.title) + '</div>' : '') +
        (vis.length ? '<ul class="visits">' + vis.map(v => '<li><b>' + esc(fmtD(v.date)) + '</b> ' + esc([v.tech, v.others].filter(x => x && x !== '-').join(' + ')) + (v.desc && v.desc !== '-' ? ' · ' + esc(v.desc) : '') + (v.assets && v.assets !== '-' ? ' <span class="muted">(' + esc(v.assets) + ')</span>' : '') + '</li>').join('') + '</ul>' : '') +
        '</div>';
    });
  });
  h += '</div>';

  // renewal
  h += '<div class="section"><div class="section-head"><h2>Renewal <span class="note">Portal only · renew, mark lost, or change dates/ACV under Edit / renew</span></h2></div>' +
    '<div class="renew">' +
    '<div class="fld"><label for="r-stage">Stage</label><select class="sel" id="r-stage">' + STAGES.concat(STAGES.includes(a.renewalStage) ? [] : [a.renewalStage || 'Not Started']).map(s => '<option' + (s === a.renewalStage ? ' selected' : '') + '>' + esc(s) + '</option>').join('') + '</select></div>' +
    '<div class="fld"><label for="r-owner">Owner</label><input class="inp" id="r-owner" value="' + esc(a.renewalOwner || '') + '"></div>' +
    '<div class="fld"><label for="r-inc">Proposed increase %</label><input class="inp" id="r-inc" type="number" step="0.5" value="' + (a.priceIncrease ?? '') + '"></div>' +
    '<div class="fld"><label>Proposed renewal ACV</label><div style="padding:.4rem 0" id="r-prop"></div></div>' +
    '<div class="fld full"><label for="r-notes">Notes</label><textarea class="inp" id="r-notes">' + esc(a.notes || '') + '</textarea></div>' +
    '<div class="fld full" style="flex-direction:row;justify-content:flex-end"><button class="btn primary" id="r-save">Save renewal notes</button></div>' +
    '</div>' +
    (a.history && a.history.length ? '<ul class="hist">' + a.history.slice(0, 12).map(x => '<li><b>' + esc(fmtD(x.at)) + '</b> ' + esc(x.by) + ': ' + esc(x.text) + '</li>').join('') + '</ul>' : '') +
    '</div>';

  $('main').innerHTML = h;
  updProp(a);
}

function fact(label, val, big) { return '<div class="fact"><div class="f-label">' + esc(label) + '</div><div class="f-val' + (big ? ' big' : '') + '">' + val + '</div></div>'; }
function updProp(a) {
  const inc = parseFloat(($('r-inc') || {}).value);
  $('r-prop').textContent = a.acv && !isNaN(inc) && inc ? money(a.acv * (1 + inc / 100)) : '—';
}

document.addEventListener('change', e => { if (e.target.id === 'year') { year = parseInt(e.target.value, 10); render(); } });
document.addEventListener('input', e => { if (e.target.id === 'r-inc') { const { a } = load(); if (a) updProp(a); } });
document.addEventListener('click', e => {
  if (e.target.id !== 'r-save') return;
  const { a } = load(); if (!a) return;
  const stage = $('r-stage').value, owner = $('r-owner').value.trim(), incRaw = $('r-inc').value, notes = $('r-notes').value;
  const inc = incRaw === '' ? null : parseFloat(incRaw);
  const changed = [];
  if (stage !== a.renewalStage) changed.push('stage ' + (a.renewalStage || '—') + ' → ' + stage);
  if (owner !== (a.renewalOwner || '')) changed.push('owner');
  if (inc !== (a.priceIncrease ?? null)) changed.push('increase');
  if (notes !== (a.notes || '')) changed.push('notes');
  if (!changed.length) { toast('No changes.'); return; }
  Object.assign(a, { renewalStage: stage, renewalOwner: owner, priceIncrease: inc, notes });
  (a.history = a.history || []).unshift({ at: isoD(TODAY), by: session.name, text: 'Renewal ' + changed.join(', ') });
  a.updatedAt = Date.now(); a.updatedBy = session.name;
  localStorage.setItem('sa_agr_' + a.id, JSON.stringify(a));
  render(); toast('Saved.');
});

render();
})();
