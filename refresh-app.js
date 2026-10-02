// ── Alpine HVAC — apply a BuildOps refresh ──────────────────────────
// The pull (refresh/buildops-refresh.js, run in a logged-in BuildOps tab) carries
// its result here in window.name as "ALPINEREFRESH:{json}". Nothing is written
// until someone clicks Apply.
(function () {
'use strict';
const PREFIX = 'ALPINEREFRESH:';
const session = (typeof apGetSession === 'function' && apGetSession()) || { name: 'Unknown' };
const out = document.getElementById('out');
const BUILDOPS_FIELDS = ['name', 'customer', 'type', 'billing', 'startDate', 'endDate', 'acv', 'soldBy', 'pm', 'status', 'draftDate', 'maint', 'buildopsId', 'work'];
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const readJSON = k => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

let payload = null;
if (typeof window.name === 'string' && window.name.startsWith(PREFIX)) {
  try { payload = JSON.parse(window.name.slice(PREFIX.length)); } catch (e) { payload = null; }
  window.name = '';
}
if (!payload) {
  out.innerHTML = '<p style="margin:0">No BuildOps pull waiting. Run the refresh script in a BuildOps tab first; it opens this page when it finishes.</p>';
  return;
}

const P = payload;
out.innerHTML =
  '<div class="row"><span>Pulled from BuildOps</span><b>' + esc(P.syncedAt) + '</b></div>' +
  '<div class="row"><span>Agreements</span><b>' + (P.agreements || []).length + '</b></div>' +
  '<div class="row"><span>Sites</span><b>' + (P.sites || []).length + '</b></div>' +
  '<div class="row"><span>Visits (all sites)</span><b>' + (P.sites || []).reduce((t, s) => t + (s.visits || []).length, 0) + '</b></div>' +
  '<div class="row"><span>Maintenance items</span><b>' + (P.siteItems || []).length + '</b></div>' +
  ((P.missing || []).length ? '<p class="warn" style="margin-top:.8rem">Could not load from BuildOps (' + P.missing.length + '): ' + esc(P.missing.slice(0, 20).join(', ')) + (P.missing.length > 20 ? '…' : '') + '. Everything else is complete; run the refresh again later to fill these in.</p>' : '<p class="ok" style="margin-top:.8rem">Every agreement, site and record loaded.</p>') +
  '<div style="margin-top:1rem"><button class="btn" id="apply">Apply refresh</button></div><div class="log" id="log" style="margin-top:1rem"></div>';

document.getElementById('apply').addEventListener('click', () => {
  const log = [];
  // 1. Agreement tracker (BuildOps fields only)
  let upd = 0, add = 0;
  (P.agreements || []).forEach(inc => {
    const k = 'sa_agr_' + inc.id;
    let a = readJSON(k);
    const isNew = !a || a.deleted;
    if (isNew) a = { id: inc.id, name: '', customer: '', type: '', billing: '', startDate: '', endDate: '', acv: null, soldBy: '', pm: '', status: 'Active', draftDate: '', maint: [], buildopsId: '', work: null, renewalStage: 'Not Started', renewalOwner: '', priceIncrease: null, notes: '', flag: '', history: [], deleted: false };
    const changed = [];
    BUILDOPS_FIELDS.forEach(f => { if (!(f in inc) || inc[f] === undefined) return; if (JSON.stringify(a[f] ?? '') !== JSON.stringify(inc[f] ?? '')) { changed.push(f); a[f] = inc[f]; } });
    if (isNew || changed.length) {
      (a.history = a.history || []).unshift({ at: P.syncedAt, by: session.name, text: isNew ? 'Added from BuildOps refresh' : 'BuildOps refresh updated ' + changed.filter(f => f !== 'work' && f !== 'maint').concat(changed.includes('maint') ? ['maintenance schedule'] : []).concat(changed.includes('work') ? ['work history'] : []).join(', ') });
      a.updatedAt = Date.now(); a.updatedBy = session.name + ' (BuildOps refresh)';
      localStorage.setItem(k, JSON.stringify(a)); isNew ? add++ : upd++;
    }
  });
  const st = readJSON('sa_settings') || {}; st.lastSync = P.syncedAt; localStorage.setItem('sa_settings', JSON.stringify(st));
  log.push('Agreement tracker: ' + upd + ' updated, ' + add + ' added.');
  // 2. Site Reports: maintenance item status/due (existing checklists only) + service calls
  let items = 0;
  (P.siteItems || []).forEach(it => {
    const k = 'sr_item_' + String(it.id).replace(/[^A-Za-z0-9\-]/g, '_');
    const ex = readJSON(k); if (!ex || ex.deleted) return;
    if ((it.status && it.status !== ex.status) || (it.due && it.due !== ex.due)) { ex.status = it.status || ex.status; ex.due = it.due || ex.due; ex.updatedAt = Date.now(); localStorage.setItem(k, JSON.stringify(ex)); items++; }
  });
  Object.entries(P.srJobs || {}).forEach(([sa, v]) => localStorage.setItem('sr_jobs_' + sa, JSON.stringify({ sa, customer: v.customer || '', jobs: v.jobs || [], syncedAt: P.syncedAt })));
  const meta = readJSON('sr_meta') || {}; meta.lastPull = P.syncedAt; localStorage.setItem('sr_meta', JSON.stringify(meta));
  log.push('Site Reports: ' + items + ' maintenance statuses changed, service calls for ' + Object.keys(P.srJobs || {}).length + ' agreements.');
  // 3. Site pages (fully replaced from BuildOps; CLEAR reports untouched)
  (P.sites || []).forEach(s => localStorage.setItem('st_site_' + s.id, JSON.stringify({ ...s, syncedAt: P.syncedAt })));
  log.push('Site pages: ' + (P.sites || []).length + ' sites refreshed.');
  document.getElementById('log').innerHTML = '<span class="ok">Done.</span>\n' + log.map(esc).join('\n') + '\n\nChanges save to the shared database in the background; keep this tab open for a few seconds.';
  document.getElementById('apply').disabled = true;
  window.__refreshApplied = log;
});
})();
