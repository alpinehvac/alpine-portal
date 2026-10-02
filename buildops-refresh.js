// ── Alpine HVAC — weekly BuildOps refresh (read-only) ───────────────
// Run in a logged-in live.buildops.com tab (Claude in Chrome: javascript_exec).
//
// What it reads:
//   1. Agreement list (Active/Draft), then each agreement: dates, ACV, sold by, PM,
//      maintenance schedule, and the site (property) of each maintenance item.
//   2. Each site: address, asset list, job list.
//   3. Every maintenance record and every job since Jan 1 of last year, opened
//      one by one, reading each visit (date, techs, description, equipment).
// Visits are classified from what they say: techs often log service calls as
// extra visits on the quarterly maintenance record, so a visit on a maintenance
// record that isn't maintenance work is filed under Service.
//
// Safety: never clicks Save/Edit/Delete; never reads property instructions
// (they hold site credentials); every page is confirmed loaded before reading,
// and pages that fail are retried. Progress lives in localStorage
// (__alpine_refresh); running the script again resumes.
// When finished it opens the portal's refresh.html, where a person clicks Apply.
(() => {
if (window.__alpineRefresh) return 'already running';
window.__alpineRefresh = true;
(async () => {
const PORTAL = 'https://alpinehvac.github.io/alpine-portal/refresh.html';
const SKIP = new Set(['SA1003', 'SA1011', 'SA1012', 'SA1013', 'SA1014', 'SA1015']); // test records
const KEY = '__alpine_refresh';
const VERSION = 3;
let S = JSON.parse(localStorage.getItem(KEY) || 'null');
if (!S || S.version !== VERSION) S = { version: VERSION, started: Date.now(), phase: 'list', list: null, agr: {}, props: {}, recs: {}, log: [], done: false, err: null };
const save = () => localStorage.setItem(KEY, JSON.stringify(S));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SINCE = new Date(new Date().getFullYear() - 1, 0, 1);
const pad = n => String(n).padStart(2, '0');
const iso = s => { if (!s || s === '-') return ''; const d = new Date(String(s).replace(/\s+\d{1,2}:\d{2}\s*[ap]m.*$/i, '').trim()); return isNaN(d) ? '' : d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
const parseD = s => { if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null; const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const clean = s => (!s || s === '-') ? '' : String(s).trim();
const num = v => { const n = parseFloat(String(v || '').replace(/[^0-9.\-]/g, '')); return isNaN(n) ? null : n; };
function nav(path) { history.pushState({}, '', path); window.dispatchEvent(new PopStateEvent('popstate', { state: {} })); }
async function waitFor(fn, max) { const t0 = Date.now(); while (Date.now() - t0 < (max || 20000)) { await sleep(400); try { if (fn()) { await sleep(700); return true; } } catch (e) {} } return false; }
function field(L) {
  const els = [...document.querySelectorAll('body *')].filter(e => e.children.length === 0 && e.textContent.trim().toUpperCase() === L);
  for (const e of els) { let n = e.parentElement; for (let i = 0; i < 4 && n; i++) { const t = n.innerText.trim().split('\n').map(s => s.trim()).filter(Boolean); const k = t.findIndex(s => s.toUpperCase() === L); if (k >= 0 && t[k + 1]) return t[k + 1]; n = n.parentElement; } }
  return '';
}
// The pager that belongs to this table: climb only while the container holds just this one table/grid.
function pagerFor(el) {
  let n = el.parentElement;
  for (let i = 0; i < 10 && n && n !== document.body; i++) {
    if (n.querySelectorAll('table,[role=grid]').length > 1) return null;
    const b = n.querySelector('button[aria-label="Go to next page"]');
    if (b) return b;
    n = n.parentElement;
  }
  return null;
}
async function pageThrough(getRoot, collect, max) {
  for (let p = 0; p < (max || 40); p++) {
    const root = getRoot(); if (!root) return;
    collect(root);
    const nb = pagerFor(root); if (!nb || nb.disabled) return;
    const sig = root.innerText.slice(-600);
    nb.click(); await sleep(2200);
    const after = getRoot(); if (!after || after.innerText.slice(-600) === sig) return;
  }
}
function clickTab(label) { const t = [...document.querySelectorAll('[role=tab]')].find(x => x.innerText && x.innerText.trim() === label); if (t) t.click(); return !!t; }
function parseVisits() {
  const out = [];
  [...document.querySelectorAll('body *')].filter(e => e.children.length === 0 && /^Visit #\d+$/.test(e.textContent.trim())).forEach(h => {
    let n = h.parentElement;
    for (let i = 0; i < 8 && n; i++) { const t = n.innerText; if (/Primary technician/i.test(t) && (t.match(/Visit #\d+/g) || []).length === 1) break; n = n.parentElement; }
    if (!n) return;
    const L = n.innerText.split('\n').map(s => s.trim()).filter(Boolean);
    const after = lab => { const k = L.findIndex(s => s.toLowerCase() === lab.toLowerCase()); return k >= 0 ? (L[k + 1] || '') : ''; };
    const vi = L.findIndex(s => /^Visit #\d+$/.test(s));
    out.push({ n: L[vi], status: L[vi + 1] || '', date: after('Scheduled for'), tech: after('Primary technician'), others: after('Additional technicians'), desc: after('Visit Description'), assets: after('Assets worked on') });
  });
  return out;
}
const MAINT_WORK = /maint|\bpm\b|preventa|start.?up|shut.?down|inspect|filter|seasonal|quarterly|\bq[1-4]\b|operational check|chiller log|log reading|readings|walk.?through|familiari|coil clean|belt/i;
function bucketFor(rec, desc) {
  if (rec.kind === 'maintenance') return (!desc || MAINT_WORK.test(desc)) ? 'Maintenance' : 'Service';
  return /quot|fixed|project|contract|install|bid|lump|change order|retrofit|replacement/i.test(rec.jobType || '') ? 'Jobs & projects' : 'Service';
}
async function readRecord(href, id) {
  nav(href);
  const ok = await waitFor(() => document.body.innerText.includes(id) && (/Visit #\d+/.test(document.body.innerText) || /No visits|Add Visit/i.test(document.body.innerText)), 20000);
  if (!ok) return null;
  await sleep(1200);
  const saBo = [...document.querySelectorAll('a[href*="/serviceAgreement/view/"]')].map(a => a.getAttribute('href').split('/').pop())[0] || '';
  const prop = [...document.querySelectorAll('a[href*="/property/view/"]')].map(a => a.getAttribute('href').split('/').pop())[0] || '';
  return { saBo, prop, type: field('JOB TYPE') || field('MAINTENANCE TYPE'), title: field('ISSUE DESCRIPTION'), visits: parseVisits() };
}
try {
  // 1. agreement list
  if (!S.list) {
    nav('/serviceAgreement/list');
    await waitFor(() => [...document.querySelectorAll('a')].some(a => /^SA\d+$/.test(a.textContent.trim())), 25000);
    const list = {};
    await pageThrough(() => document.querySelector('[role=grid]'), () => {
      [...document.querySelectorAll('[role=row]')].slice(1).forEach(r => { const a = [...r.querySelectorAll('a')].find(x => /^SA\d+$/.test(x.textContent.trim())); if (!a) return; const id = a.textContent.trim(); const status = (r.innerText.match(/\b(Active|Draft|Expired|Canceled|Cancelled)\b/) || [])[1] || ''; if (!SKIP.has(id) && /Active|Draft/.test(status)) list[id] = { bo: a.getAttribute('href').split('/').pop(), status }; });
    }, 10);
    if (!Object.keys(list).length) throw new Error('Agreement list did not load; is BuildOps logged in?');
    S.list = list; S.log.push('agreements: ' + Object.keys(list).length); save();
  }
  // 2. agreements (second pass retries any that didn't load)
  S.phase = 'agreements'; save();
  for (let pass = 0; pass < 2; pass++) for (const [sa, L] of Object.entries(S.list)) {
    if (S.agr[sa] && S.agr[sa].ok) continue;
    nav('/serviceAgreement/view/' + L.bo);
    const ok = await waitFor(() => new RegExp('Agreement No:\\s*' + sa + '\\b').test(document.body.innerText) && (document.querySelectorAll('[role=row]').length > 1 || /No (data|rows)/i.test(document.body.innerText)), 25000);
    const o = { id: sa, bo: L.bo, status: L.status, ok: ok || L.status === 'Draft' };
    for (const [lab, k] of [['START DATE', 'start'], ['END DATE', 'end'], ['ANNUAL CONTRACT VALUE', 'acv'], ['SOLD BY', 'soldBy'], ['PROJECT MANAGER', 'pm'], ['CUSTOMER', 'customer']]) o[k] = field(lab);
    const maint = {}, props = {};
    await pageThrough(() => document.querySelector('[role=grid]'), () => {
      [...document.querySelectorAll('[role=row]')].slice(1).forEach(r => {
        const x = [...r.querySelectorAll('[role=cell],[role=gridcell]')].map(c => c.innerText.trim().replace(/\n/g, ' '));
        const pa = r.querySelector('a[href*="/property/view/"]');
        if (pa) props[pa.getAttribute('href').split('/').pop()] = pa.innerText.trim();
        if (x[1]) maint[x[1]] = { id: x[1], due: iso(x[2]), status: x[3], property: x[4], propertyId: pa ? pa.getAttribute('href').split('/').pop() : '', type: x[6], budgetHrs: num(x[8]), visits: num(x[10]) };
      });
    }, 10);
    o.maint = Object.values(maint); o.props = props;
    if (o.status === 'Active' && !o.maint.length) o.ok = false;
    S.agr[sa] = o;
    Object.entries(props).forEach(([pid, name]) => { const P = S.props[pid] = S.props[pid] || { id: pid, name, sas: [], customer: o.customer }; if (!P.sas.includes(sa)) P.sas.push(sa); });
    S.log.push(sa + ': ' + o.maint.length + ' maint, ' + Object.keys(props).length + ' sites' + (o.ok ? '' : ' (retry)')); save();
  }
  // 3. sites: address, assets, job list
  S.phase = 'sites'; save();
  for (let pass = 0; pass < 2; pass++) for (const pid of Object.keys(S.props)) {
    const P = S.props[pid]; if (P.done) continue;
    nav('/property/view/' + pid);
    const ok = await waitFor(() => document.title.includes(P.name) || document.body.innerText.includes('Property: ' + P.name), 25000);
    if (!ok) { S.log.push('site ' + P.name + ': did not load'); save(); continue; }
    await sleep(2000);
    P.address = field('PROPERTY ADDRESS');
    clickTab('Jobs & Visits'); await sleep(3000);
    P.jobs = {};
    await pageThrough(() => [...document.querySelectorAll('table')].find(t => /Job Type/.test(t.innerText) && /Issue Description/.test(t.innerText)), tb => {
      const hdr = [...tb.querySelectorAll('tr')[0].children].map(h => h.innerText.trim());
      [...tb.querySelectorAll('tr')].slice(1).forEach(r => { const c = [...r.children].map(x => x.innerText.trim().replace(/\n/g, ' ')); const row = {}; hdr.forEach((h, i) => row[h] = c[i]); const a = r.querySelector('a[href*="/job/view/"]'); if (row.Job) P.jobs[row.Job] = { id: row.Job, href: a ? a.getAttribute('href') : '', type: row['Job Type'], status: row.Status, title: row['Issue Description'], created: row['Created On'] }; });
    }, 20);
    clickTab('Assets'); await sleep(3000);
    const assets = {};
    await pageThrough(() => document.querySelector('[role=grid]'), () => {
      const rows = [...document.querySelectorAll('[role=row]')]; if (rows.length < 2) return;
      const hdr = [...rows[0].querySelectorAll('[role=columnheader]')].map(c => c.innerText.trim());
      if (!hdr.includes('Asset')) return;
      rows.slice(1).forEach(r => { const c = [...r.querySelectorAll('[role=cell],[role=gridcell]')].map(x => x.innerText.trim()); const row = {}; hdr.forEach((h, i) => row[h] = c[i]); if (row.Asset) assets[row.Asset] = { tag: row.Asset, make: clean(row.Make), model: clean(row['Model No']), serial: clean(row['Serial No']), installDate: iso(row['Install Date']), location: clean(row.Location), type: clean(row['Asset Type']) }; });
    }, 15);
    P.assets = Object.values(assets);
    P.done = true;
    S.log.push('site ' + P.name + ': ' + Object.keys(P.jobs).length + ' jobs, ' + P.assets.length + ' assets'); save();
  }
  // 4. records: every maintenance item and job since SINCE
  S.phase = 'records'; save();
  const targets = [];
  Object.values(S.agr).forEach(o => (o.maint || []).forEach(m => { const d = parseD(m.due); if ((d && d >= SINCE && d <= new Date()) || (m.visits || 0) > 0) targets.push({ kind: 'maintenance', id: m.id, href: '/maintenance/view/' + m.id, sa: o.id, prop: m.propertyId, jobType: m.type }); }));
  Object.values(S.props).forEach(P => Object.values(P.jobs || {}).forEach(j => { const d = new Date(j.created); if (j.href && (isNaN(d) || d >= SINCE)) targets.push({ kind: 'job', id: j.id, href: j.href, prop: P.id, jobType: j.type, title: j.title, status: j.status }); }));
  S.targets = targets.length; save();
  for (let pass = 0; pass < 2; pass++) for (const t of targets) {
    if (S.recs[t.href]) continue;
    const r = await readRecord(t.href, t.id);
    if (r) { S.recs[t.href] = { ...t, ...r, prop: t.prop || r.prop, title: t.title || r.title }; save(); }
  }
  // 5. payload
  S.phase = 'payload'; save();
  const today = iso(new Date().toDateString());
  const boToSa = {}; Object.values(S.agr).forEach(o => boToSa[o.bo] = o.id);
  const visitsByProp = {};
  Object.values(S.recs).forEach(r => {
    const sa = r.kind === 'maintenance' ? r.sa : (boToSa[r.saBo] || '');
    (r.visits || []).forEach(v => {
      if (/cancel/i.test(v.status || '')) return;
      const date = iso(v.date); if (!date) return;
      (visitsByProp[r.prop] = visitsByProp[r.prop] || []).push({
        date, bucket: bucketFor(r, v.desc), job: r.id, url: r.href, title: clean(r.title) || clean(r.jobType) || clean(r.type), jobType: clean(r.jobType) || clean(r.type),
        jobStatus: r.status || '', status: v.status, desc: clean(v.desc), tech: clean(v.tech), others: clean(v.others), assets: clean(v.assets), sa, loggedOnMaintenance: r.kind === 'maintenance'
      });
    });
  });
  const sites = Object.values(S.props).map(P => ({ id: P.id, name: P.name, address: P.address || '', customer: clean(P.customer).replace(/^\*+/, ''), sas: P.sas, assets: P.assets || [],
    visits: (visitsByProp[P.id] || []).sort((a, b) => b.date.localeCompare(a.date)) }));
  const jobsBySa = {};
  sites.forEach(s => {
    const byJob = {};
    s.visits.filter(v => v.bucket !== 'Maintenance').forEach(v => {
      const key = v.job + '|' + (v.loggedOnMaintenance ? v.date + v.desc : '');
      const j = byJob[key] = byJob[key] || { id: v.job, url: v.url, kind: v.bucket === 'Jobs & projects' ? 'Project' : 'Service', type: v.loggedOnMaintenance ? 'Service visit on maintenance record' : v.jobType, title: v.loggedOnMaintenance ? v.desc : v.title, status: v.jobStatus, property: s.name, created: '', visits: [], sa: v.sa };
      j.visits.push({ date: v.date, status: v.status, tech: v.tech, others: v.others, desc: v.desc, assets: v.assets });
    });
    Object.values(byJob).forEach(j => (j.sa ? [j.sa] : s.sas).forEach(sa => (jobsBySa[sa] = jobsBySa[sa] || []).push(j)));
  });
  const agreements = Object.values(S.agr).map(o => {
    const rec = { id: o.id, buildopsId: o.bo, soldBy: clean(o.soldBy), pm: clean(o.pm), customer: clean(o.customer).replace(/^\*+/, ''), status: o.status, maint: o.maint,
      work: { syncedAt: today, jobs: o.maint.map(m => ({ id: m.id, kind: 'Maintenance', type: m.type, status: m.status, due: m.due, property: m.property, visits: [] })).concat(jobsBySa[o.id] || []) } };
    if (o.status !== 'Draft') { rec.startDate = iso(o.start); rec.endDate = iso(o.end); }
    const acv = num(o.acv); if (acv !== null) rec.acv = acv;
    return rec;
  });
  const srJobs = {};
  Object.entries(jobsBySa).forEach(([sa, jobs]) => { srJobs[sa] = { customer: clean((S.agr[sa] || {}).customer), jobs }; });
  const missing = Object.values(S.props).filter(p => !p.done).map(p => p.name).concat(targets.filter(t => !S.recs[t.href]).map(t => t.id));
  const payload = { syncedAt: today, agreements, siteItems: Object.values(S.agr).flatMap(o => o.maint.map(m => ({ id: m.id, status: m.status, due: m.due }))), srJobs, sites, missing };
  S.phase = 'done'; S.done = true; S.finished = Date.now(); S.missing = missing; save();
  window.name = 'ALPINEREFRESH:' + JSON.stringify(payload);
  location.href = PORTAL;
} catch (e) { S.err = String(e && e.stack || e); save(); }
window.__alpineRefresh = false;
})();
return 'started';
})()
