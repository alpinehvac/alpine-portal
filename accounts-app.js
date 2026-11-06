// ── Alpine HVAC — Account Management ────────────────────────────────
// accounts.html            customer list (service agreement customers)
// accounts.html?c=<key>    one customer's file: properties, QTD / YTD activity,
//                          items needing attention, quarterly report + live link
//
// Reads (hydrated by cloud-sync.js before this runs):
//   sa_agr_<SA#>           service_agreements_data   agreements, tier, term, account manager
//   st_site_<pid>          site_data                 properties, assets, BuildOps visits
//   st_clearlive_<pid>     site_data                 live CLEAR report (colours, notes, last review)
//   st_clear_<pid>_<q>     site_data                 quarter snapshot of the CLEAR report
// Writes:
//   ac_acct_<key>          account_data              contact, notes, report history (+ last-generated stamp)
//   account_share/<token>  (direct Firestore write)  customer-facing snapshot behind the live link
// Reads on demand (direct Firestore): ops_job_detail/{JO…} for tech summaries, recommendations, photos.
//
// Customer-facing content never includes dollar amounts, costs, internal notes or
// BuildOps property instructions. Photos are only those BuildOps marks "include in job report".
//
// Automation hook (quarterly run, Claude in Chrome on this page):
//   apAccountReports.list(quarter)                 → [{key, customer, sites, visits, lastReport}]
//   apAccountReports.start(quarter, {key: {message, signer}}, keys?)  background; poll status()
//   apAccountReports.status() / result()

(function () {
'use strict';

const FS_URL = 'https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js';
const BO = 'https://live.buildops.com';
const session = (typeof apGetSession === 'function' && apGetSession()) || { name: 'Unknown', roles: [] };
const TODAY = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DONE_RE = /complete|converted|closed|finished|invoiced/i;
const BUCKETS = ['Maintenance', 'Service', 'Jobs & projects'];
const PH_OK = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpe?g|png|heic|heif|webp|gif)$/i;
const PHONE = '289-438-1175';
const qp = new URLSearchParams(location.search);
const $ = id => document.getElementById(id);

// ── helpers ──────────────────────────────────────────────────────────
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function parseD(s) { if (!s || !/^\d{4}-\d{2}-\d{2}/.test(s)) return null; const [y, m, d] = s.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); }
function isoD(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function fmtD(s) { const d = parseD(s); return d ? MONTHS[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear() : '—'; }
function fmtStamp(ms) { if (!ms) return '—'; const d = new Date(ms); return MONTHS[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear() + ' at ' + d.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' }); }
function qOf(iso) { const d = parseD(iso); return d ? d.getFullYear() + '-Q' + (Math.floor(d.getMonth() / 3) + 1) : ''; }
function qLabel(q) { const [y, n] = q.split('-Q'); return 'Q' + n + ' ' + y; }
function qMonths(q) { const n = +q.split('-Q')[1]; return ['January–March', 'April–June', 'July–September', 'October–December'][n - 1]; }
function prevQ(q) { let [y, n] = q.split('-Q').map(Number); n--; if (!n) { n = 4; y--; } return y + '-Q' + n; }
function qEnd(q) { const [y, n] = q.split('-Q').map(Number); return isoD(new Date(y, n * 3, 0)); }
function qYear(q) { return q.split('-Q')[0]; }
function readJSON(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
function custName(c) { return String(c || '').replace(/^\*+/, '').trim(); }
function custKey(c) { return custName(c).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50); }
function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
function firstName(s) { return String(s || '').trim().split(/\s+/)[0] || ''; }
function cleanTitle(s) { return String(s || '').replace(/\s+/g, ' ').replace(/^[-–\s]+/, '').trim(); }
let toastT; function toast(m) { const t = $('toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 3500); }
const CUR_Q = qOf(isoD(TODAY));
const LAST_Q = prevQ(CUR_Q);

// Live CLEAR status for a property card.
function clearBadge(s) {
  const r = readJSON('st_clearlive_' + s.id);
  if (!r) return '<span class="badge b-grey">CLEAR not started</span>';
  const n = c => r.rows.filter(x => x.include !== false && x.condition === c).length;
  const d = parseD(r.reviewedAt), days = d ? Math.floor((TODAY - d) / 86400000) : null;
  const newVisits = (s.visits || []).some(v => (v.date || '') > (r.visitsThru || ''));
  const due = days == null || days > 30 || newVisits;
  return '<span class="badge b-red">' + n('red') + ' red</span><span class="badge b-amber">' + n('yellow') + ' yellow</span><span class="badge b-green">' + n('green') + ' green</span>' +
    (due ? '<span class="badge b-amber">Review due</span>' : '<span class="badge b-grey">Reviewed ' + esc(fmtD(r.reviewedAt)) + '</span>');
}

function tierOf(type) {
  const t = String(type || '');
  if (/premium/i.test(t)) return 'Premium';
  if (/core/i.test(t)) return 'Core';
  if (/base|min/i.test(t)) return 'Base';
  if (/retail|one.?time/i.test(t)) return 'Retail';
  return t ? t : '';
}
function tierBadge(t) { return t ? '<span class="badge t-' + esc(t.toLowerCase().replace(/[^a-z]/g, '') || 'other') + '">' + esc(t) + '</span>' : ''; }

// ── data model ───────────────────────────────────────────────────────
function scanKeys(prefix) {
  const out = [];
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(prefix)) { const v = readJSON(k); if (v) out.push([k, v]); } }
  return out;
}
function accounts() {
  const map = new Map();
  const get = name => { const k = custKey(name); if (!k) return null; if (!map.has(k)) map.set(k, { key: k, customer: custName(name), agreements: [], sites: [] }); return map.get(k); };
  scanKeys('sa_agr_').forEach(([, a]) => { if (a.deleted || /lost|cancel/i.test(a.status || '')) return; const c = get(a.customer || a.name); if (c) c.agreements.push(a); });
  scanKeys('st_site_').forEach(([, s]) => { const c = get(s.customer); if (c) c.sites.push(s); });
  // Sites with no customer name: attach through their agreement numbers.
  map.forEach(c => c.sites.sort((a, b) => (a.name || '').localeCompare(b.name || '')));
  return [...map.values()].filter(c => c.sites.length || c.agreements.length).sort((a, b) => a.customer.localeCompare(b.customer));
}
function acctRec(key) { return readJSON('ac_acct_' + key) || { key, contactName: '', contactEmail: '', notes: '', reports: {} }; }
function saveAcct(r) { r.updatedAt = Date.now(); r.updatedBy = session.name; localStorage.setItem('ac_acct_' + r.key, JSON.stringify(r)); }
function tierFor(c) {
  const rank = { Premium: 3, Core: 2, Base: 1, Retail: 0 };
  return c.agreements.map(a => tierOf(a.type)).filter(Boolean).sort((a, b) => (rank[b] || 0) - (rank[a] || 0))[0] || '';
}
function activeAgreements(c) { return c.agreements.filter(a => !/draft/i.test(a.status || '')); }
function managerOf(c) { return (c.agreements.map(a => a.pm).find(Boolean)) || (c.agreements.map(a => a.soldBy).find(Boolean)) || ''; }

// Visits for a customer between two ISO dates (inclusive), each tagged with its site.
function visitsFor(c, from, to) {
  const out = [];
  c.sites.forEach(s => (s.visits || []).forEach(v => { if (v.date && v.date >= from && v.date <= to && !/cancel/i.test(v.status || '')) out.push({ ...v, site: s }); }));
  return out.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
}
function countVisits(vis) {
  const n = { Maintenance: 0, Service: 0, 'Jobs & projects': 0, calls: new Set(), projects: new Set(), techs: new Set() };
  vis.forEach(v => {
    const b = BUCKETS.includes(v.bucket) ? v.bucket : 'Service';
    n[b]++;
    if (b === 'Service') n.calls.add(v.job + (v.loggedOnMaintenance ? '|' + v.date : ''));
    if (b === 'Jobs & projects') n.projects.add(v.job);
    [v.tech, ...String(v.others || '').split(',')].map(x => (x || '').trim()).filter(x => x && x !== '-').forEach(x => n.techs.add(x));
  });
  return { maint: n.Maintenance, service: n.Service, project: n['Jobs & projects'], calls: n.calls.size, projects: n.projects.size, techs: n.techs.size, total: vis.length };
}
function qRangeISO(q) { const [y, n] = q.split('-Q').map(Number); return [isoD(new Date(y, (n - 1) * 3, 1)), qEnd(q)]; }
function ytdRangeISO(q) { return [qYear(q) + '-01-01', qEnd(q) < isoD(TODAY) ? qEnd(q) : isoD(TODAY)]; }

// Group visits into jobs (same rule as the Site page: service visits logged on a maintenance record stand alone).
function groupJobs(vis) {
  const by = new Map();
  vis.forEach(v => {
    const onMaint = v.loggedOnMaintenance && v.bucket !== 'Maintenance';
    const k = v.site.id + '|' + v.bucket + '|' + v.job + (onMaint ? '|' + v.date + '|' + v.desc : '');
    if (!by.has(k)) by.set(k, { key: k, site: v.site, bucket: BUCKETS.includes(v.bucket) ? v.bucket : 'Service', job: v.job, url: v.url, title: cleanTitle(onMaint ? v.desc : v.title), type: onMaint ? 'Service visit' : (v.jobType || ''), status: onMaint ? '' : (v.jobStatus || ''), visits: [] });
    by.get(k).visits.push(v);
  });
  return [...by.values()].sort((a, b) => (b.visits[b.visits.length - 1].date || '').localeCompare(a.visits[a.visits.length - 1].date || ''));
}

// Items needing attention: red / yellow assets on the live CLEAR report (past quarters use their snapshot;
// falls back to the latest snapshot for sites without a live report).
function attentionFor(c, q) {
  const out = [];
  c.sites.forEach(s => {
    let r = q === CUR_Q ? readJSON('st_clearlive_' + s.id) : readJSON('st_clear_' + s.id + '_' + q);
    if (!r) r = readJSON('st_clearlive_' + s.id) || readJSON('st_clear_' + s.id + '_' + q);
    if (!r) { const ks = scanKeys('st_clear_' + s.id + '_').map(([k]) => k).sort(); if (ks.length) r = readJSON(ks[ks.length - 1]); }
    ((r && r.rows) || []).filter(x => x.include !== false && (x.condition === 'red' || x.condition === 'yellow')).forEach(x => {
      const note = String(x.notes || '').split('\n').map(l => l.trim()).filter(Boolean).pop() || '';
      out.push({ site: s.name, tag: x.tag, type: x.type || '', condition: x.condition, note: note.replace(/^[A-Z][a-z]{2} \d{1,2}, \d{4}: /, ''), quarter: r.quarter || q });
    });
  });
  return out.sort((a, b) => (a.condition === b.condition ? 0 : a.condition === 'red' ? -1 : 1));
}

// Equipment condition counts (red / yellow / green) across the customer's sites for quarter q, same sources as attentionFor.
function conditionFor(c, q) {
  const n = { red: 0, yellow: 0, green: 0, assets: 0 };
  c.sites.forEach(s => {
    let r = q === CUR_Q ? readJSON('st_clearlive_' + s.id) : readJSON('st_clear_' + s.id + '_' + q);
    if (!r) r = readJSON('st_clearlive_' + s.id) || readJSON('st_clear_' + s.id + '_' + q);
    if (!r) { const ks = scanKeys('st_clear_' + s.id + '_').map(([k]) => k).sort(); if (ks.length) r = readJSON(ks[ks.length - 1]); }
    ((r && r.rows) || []).filter(x => x.include !== false).forEach(x => { n.assets++; if (x.condition in n) n[x.condition]++; });
  });
  return n;
}

// ── Firestore (direct) ───────────────────────────────────────────────
let FS = null;
async function fs() {
  if (FS) return FS;
  const m = await import(FS_URL), f = await import('./ap-firebase.js');
  FS = { ...m, db: f.db };
  return FS;
}
const detailCache = {};
// Job page id for a BuildOps job or maintenance record number (JO20261176, 20261176, SA1024-3).
function detId(id) { id = String(id || ''); return /^\d{6,}$/.test(id) ? 'JO' + id : /^(JO\d+|SA\d+-\d+)$/i.test(id) ? id.toUpperCase() : null; }
async function jobDetail(id) {
  const jid = detId(id);
  if (!jid) return null;
  if (jid in detailCache) return detailCache[jid];
  try {
    const F = await fs(); const s = await F.getDoc(F.doc(F.db, 'ops_job_detail', jid));
    detailCache[jid] = s.exists() ? JSON.parse(s.data().json) : null;
  } catch (e) { detailCache[jid] = null; }
  return detailCache[jid];
}
// Tech summaries, recommendations and report photos for a job, matched to visit dates.
function enrich(J, d) {
  if (!d) return;
  const dv = (d.visits || []);
  J.visits.forEach(v => {
    const m = dv.find(x => x.date === v.date) || (dv.length === 1 && J.visits.length === 1 ? dv[0] : null);
    if (!m) return;
    v.summary = (m.summaries || []).map(s => s.text).filter(Boolean).join('\n\n');
    v.recs = (m.recs || []).map(r => ({ title: r.title || r.asset || '', text: r.text || '', priority: r.priority || '' }));
    v.photos = (m.photos || []).filter(p => PH_OK.test(p.src || '')).map(p => ({ src: p.src, type: p.type || '', comment: p.comment || '', rep: p.rep !== false }));
  });
  J.jobRecs = (d.jobRecs || []).map(r => ({ title: r.title || r.asset || '', text: r.text || '', priority: r.priority || '' }));
}
const phUrl = (src, w) => 'https://res.cloudinary.com/gobuildops/image/upload/c_limit,w_' + w + ',q_auto,f_jpg/public/' + src;

// ── report snapshot (what the customer sees) ─────────────────────────
function token() { const b = new Uint8Array(18); crypto.getRandomValues(b); return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_'); }
function shareUrl(t) { return location.origin + location.pathname.replace(/[^/]*$/, '') + 'account-report.html?t=' + encodeURIComponent(t); }

// Account manager's choices (account_data ac_acct_<key>.custom), applied to every report for this customer:
//   hide.jobs / hide.visits / hide.att: keys left out; photos: { <src>: true | false } overrides
//   BuildOps' "include in job report" flag; show: section switches; notes[q]: note shown at the top.
const SHOW_DEFAULT = { stats: true, attention: true, ytd: true, techs: true, summaries: true, recs: true, photos: true };
const SHOW_LABEL = { stats: 'Visit counts', attention: 'Equipment to keep an eye on', ytd: 'Year-to-date view', techs: 'Technician names', summaries: 'Tech visit summaries', recs: 'Recommendations', photos: 'Photos' };
function customOf(rec) {
  const c = rec.custom || {};
  return { hide: { jobs: {}, visits: {}, att: {}, ...(c.hide || {}) }, photos: c.photos || {}, show: { ...SHOW_DEFAULT, ...(c.show || {}) }, notes: c.notes || {} };
}
const visitKey = (J, v) => J.key + '|' + v.date + '|' + String(v.desc || '').slice(0, 30);
const attKey = a => a.site + '|' + a.tag;
const photoOn = (cu, p) => p.src in cu.photos ? !!cu.photos[p.src] : p.rep !== false;

async function buildSnapshot(c, q, opts) {
  const raw = opts && opts.raw;
  const [yFrom, yTo] = ytdRangeISO(q), [qFrom, qTo] = qRangeISO(q);
  const cu = customOf(acctRec(c.key));
  const vis0 = visitsFor(c, yFrom, yTo);
  const jobs0 = groupJobs(vis0);
  jobs0.forEach(J => J.visits.forEach(v => { v.vkey = visitKey(J, v); }));
  const jobs = raw ? jobs0 : jobs0.filter(J => !cu.hide.jobs[J.key]).map(J => ({ ...J, visits: J.visits.filter(v => !cu.hide.visits[v.vkey]) })).filter(J => J.visits.length);
  const vis = jobs.flatMap(J => J.visits);
  // Pull tech summaries / photos for jobs on the job pages (skip pure maintenance routes with many visits? no: all).
  const ids = [...new Set(jobs.map(j => j.job).filter(Boolean))];
  for (let i = 0; i < ids.length; i += 8) await Promise.all(ids.slice(i, i + 8).map(jobDetail));
  jobs.forEach(J => enrich(J, detailCache[detId(J.job)]));
  const rec = acctRec(c.key);
  const S = raw ? SHOW_DEFAULT : cu.show;
  const sites = c.sites.map(s => ({
    id: s.id, name: s.name, address: s.address || '',
    jobs: jobs.filter(J => J.site.id === s.id).map(J => ({
      key: raw ? J.key : undefined, bucket: J.bucket, job: J.job, title: J.title, type: J.type, status: J.status,
      visits: J.visits.map(v => ({ key: raw ? v.vkey : undefined, date: v.date, q: qOf(v.date), tech: S.techs ? [v.tech, v.others].filter(x => x && x !== '-').join(', ') : '', desc: cleanTitle(v.desc), equipment: v.assets && v.assets !== '-' ? v.assets : '',
        summary: S.summaries ? v.summary || '' : '', recs: S.recs ? v.recs || [] : [],
        photos: raw ? (v.photos || []) : S.photos ? (v.photos || []).filter(p => photoOn(cu, p)).slice(0, 24).map(({ rep, ...p }) => p) : [] })),
      recs: S.recs ? J.jobRecs || [] : []
    }))
  }));
  const qVis = vis.filter(v => v.date >= qFrom && v.date <= qTo);
  const att = attentionFor(c, q);
  return {
    show: S, note: raw ? '' : (cu.notes[q] || ''),
    v: 1, customer: c.customer, quarter: q, quarterLabel: qLabel(q), months: qMonths(q), year: qYear(q), ytdTo: yTo,
    generatedAt: Date.now(), generatedBy: session.name, signer: (opts && opts.signer) || session.name,
    contactName: rec.contactName || '', tier: tierFor(c),
    agreements: activeAgreements(c).map(a => ({ id: a.id, tier: tierOf(a.type), start: a.startDate || '', end: a.endDate || '' })),
    stats: { quarter: countVisits(qVis), ytd: countVisits(vis) },
    attention: raw ? att : S.attention ? att.filter(a => !cu.hide.att[attKey(a)]) : [],
    condition: S.attention || raw ? conditionFor(c, q) : null,
    sites
  };
}

// Personalized message (template). The quarterly run replaces it with one Claude writes from all context.
function draftMessage(c, snap, link) {
  const rec = acctRec(c.key);
  const s = snap.stats.quarter, y = snap.stats.ytd;
  const hello = rec.contactName ? 'Hi ' + firstName(rec.contactName) + ',' : 'Hi there,';
  const nSites = snap.sites.length;
  const parts = [];
  if (s.maint) parts.push(plural(s.maint, 'maintenance visit'));
  if (s.calls) parts.push(plural(s.calls, 'service call'));
  if (s.projects) parts.push(plural(s.projects, 'project'));
  const did = parts.length ? parts.join(', ').replace(/, ([^,]*)$/, ' and $1') : 'no site visits';
  const qJobs = snap.sites.flatMap(si => si.jobs.filter(j => j.bucket !== 'Maintenance' && j.visits.some(v => v.q === snap.quarter)).map(j => ({ ...j, site: si.name, last: j.visits[j.visits.length - 1].date })))
    .sort((a, b) => b.last.localeCompare(a.last)).slice(0, 5);
  let m = hello + '\n\n' +
    'Here is your ' + snap.quarterLabel + ' summary for ' + snap.customer + (nSites > 1 ? ' across your ' + nSites + ' properties' : '') + '. ' +
    'This quarter our team completed ' + did + '. Year to date that brings us to ' + plural(y.total, 'site visit') + '.\n';
  if (qJobs.length) m += '\nHighlights from the quarter:\n' + qJobs.map((j, i) => (i + 1) + '. ' + (nSites > 1 ? j.site + ': ' : '') + (j.title || j.type || 'Service visit') + ' (' + fmtD(j.last) + ')').join('\n') + '\n';
  if (snap.attention.length) m += '\nItems we are keeping an eye on:\n' + snap.attention.slice(0, 5).map((a, i) => (i + 1) + '. ' + (nSites > 1 ? a.site + ', ' : '') + a.tag + (a.note ? ': ' + a.note : '')).join('\n') + '\n';
  m += '\nYour full report, with visit notes and photos for each property, is here:\n' + link + '\n\n' +
    'Happy to walk through any of it. I will give you a call this week, or reply with a time that suits you.\n\n' +
    snap.signer + '\nAlpine HVAC | ' + PHONE;
  return m;
}

async function generate(c, q, opts) {
  const rec = acctRec(c.key);
  const prev = (rec.reports || {})[q];
  const t = (prev && prev.token) || token();
  const snap = await buildSnapshot(c, q, opts);
  const link = shareUrl(t);
  const message = (opts && opts.message) ? opts.message.replace(/\{\{LINK\}\}/g, link) : (opts && opts.keepMessage && prev && prev.message) ? prev.message : draftMessage(c, snap, link);
  const json = JSON.stringify(snap);
  if (json.length > 900000) throw new Error('Report too large (' + Math.round(json.length / 1000) + ' KB)');
  const F = await fs();
  await F.setDoc(F.doc(F.db, 'account_share', t), { json, customer: snap.customer, quarter: q, updatedAt: F.serverTimestamp(), updatedBy: (session.email || session.name) });
  rec.reports = rec.reports || {};
  rec.reports[q] = { token: t, generatedAt: snap.generatedAt, by: session.name, message, stats: snap.stats, attention: snap.attention.length, source: (opts && opts.source) || (prev && opts && opts.keepMessage ? prev.source : 'on-demand'), sentAt: prev ? prev.sentAt || null : null, customizedAt: opts && opts.keepMessage ? Date.now() : (prev && prev.customizedAt) || null };
  rec.lastReport = { quarter: q, at: snap.generatedAt, by: session.name, token: t };
  saveAcct(rec);
  return { key: c.key, customer: c.customer, quarter: q, token: t, url: link, message, stats: snap.stats, attention: snap.attention };
}
async function revoke(c, q) {
  const rec = acctRec(c.key), r = (rec.reports || {})[q];
  if (!r) return;
  const F = await fs();
  await F.deleteDoc(F.doc(F.db, 'account_share', r.token));
  delete rec.reports[q];
  const left = Object.entries(rec.reports).sort((a, b) => (b[1].generatedAt || 0) - (a[1].generatedAt || 0))[0];
  rec.lastReport = left ? { quarter: left[0], at: left[1].generatedAt, by: left[1].by, token: left[1].token } : null;
  saveAcct(rec);
}

// ── every property Alpine has worked at ──────────────────────────────
// Built from (account_data, refreshed weekly by ACCOUNT-WEEKLY-REFRESH.md Part D):
//   ac_bo_lists   BuildOps list pages read by buildops-lists.js: every property, job, maintenance record, invoice
//   ac_qb_inv     QuickBooks invoices that are not BuildOps invoices (Windsor): work before BuildOps (Aug 2023 on)
//                 and agreement billing done in QuickBooks
// plus st_site_<pid> (agreement sites with every visit), ops_job_detail/_index (job pages) and
// ops_job_costs/{id}.emails (Outlook context per job, read when a property is opened).
const MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
function boD(s) { const m = String(s || '').match(/^([A-Za-z]{3})[a-z]*\.? (\d{1,2}), (\d{4})/); return m && m[1].toLowerCase() in MON ? isoD(new Date(+m[3], MON[m[1].toLowerCase()], +m[2])) : ''; }
function qbD(s) { s = String(s || ''); return /^\d{8}$/.test(s) ? s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6) : ''; }
function money(v) { const n = typeof v === 'number' ? v : parseFloat(String(v || '').replace(/[^0-9.\-]/g, '')); return isNaN(n) ? 0 : n; }
function fmt$(n) { return (n < 0 ? '−$' : '$') + Math.abs(n).toLocaleString('en-CA', { minimumFractionDigits: 0, maximumFractionDigits: 0 }); }
function fmt$c(n) { return (n < 0 ? '−$' : '$') + Math.abs(n).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
const STREET_ALIAS = { highway: 'hwy', ontario: 'hwy', on: 'hwy', regional: 'hwy', county: 'hwy', rr: 'hwy', mount: 'mt', saint: 'st' };
// Street number + first word of the street name ("25 Main St. West, Suite 125" → "25 main"): enough to match
// BuildOps addresses, QuickBooks ship-to lines and QuickBooks customers named by their address.
function addrKey(s) {
  const t = String(s || '').toLowerCase().replace(/\(|\)/g, ' ');
  const m = t.match(/(?:^|[^0-9a-z])(\d{1,6})(?:-\d{1,6})?\s+([a-z][a-z'.]*)/);
  if (!m) return '';
  let w = m[2].replace(/[^a-z]/g, ''); w = STREET_ALIAS[w] || w;
  return /^(unit|suite|ste|floor|fl)$/.test(w) ? '' : m[1] + ' ' + w;
}
function normName(s) {
  return String(s || '').toLowerCase().replace(/^\*+/, '').replace(/\bc\/o\b.*$/, '').replace(/#\s*\d+/g, '')
    .replace(/\bprop\b\.?/g, 'property').replace(/\bcorp\b\.?/g, 'corporation')
    .replace(/\b(inc|ltd|limited|corporation|co|the)\b\.?/g, '').replace(/[^a-z0-9]+/g, '');
}
const jobIdx = { rows: null, by: {} };   // ops_job_detail/_index: which jobs have a portal job page
let PX = null;
function propIndex() {
  if (PX) return PX;
  const L = readJSON('ac_bo_lists') || { props: [], jobs: [], maint: [], inv: [] };
  const Q = readJSON('ac_qb_inv') || { c: [], r: [] };
  const P = new Map(), today = isoD(TODAY);
  const add = (id, o) => { if (!P.has(id)) P.set(id, { id, name: '', customer: '', type: '', address: '', status: '', billTo: '', jobs: [], maint: [], inv: [], visits: [], account: null, site: null }); const p = P.get(id); Object.keys(o || {}).forEach(k => { if (o[k] && !p[k]) p[k] = o[k]; }); return p; };
  const TEST = /^zz ?test|delete me/i;
  (L.props || []).forEach(([id, name, status, customer, type, address, billTo]) => !TEST.test((name || '') + ' ' + (customer || '')) && add(id, { name, status, customer: custName(customer), type, address: String(address || '').replace(/\s+CA$/, ''), billTo: custName(billTo) }));
  const accts = accounts();
  accts.forEach(c => c.sites.forEach(s => { const p = add(s.id, { name: s.name, address: s.address, customer: custName(s.customer) || c.customer }); p.site = s; p.account = c;
    p.visits = (s.visits || []).filter(v => v.date && !/cancel/i.test(v.status || '')); }));
  (L.jobs || []).forEach(r => {
    const [id, boId, pid, pname, status, billing, issue, created, completed, type, po, customer, visits, invoices, sa, dept, soldBy, billed, quoted] = r;
    if (!id || !pid) return;
    if (boId) boJobPath[id] = '/job/view/' + boId;
    add(pid, { name: pname, customer: custName(customer) }).jobs.push({ id, status, billing, issue, created: boD(created), completed: boD(completed), type, po, customer: custName(customer), visits: +visits || 0, invoices: String(invoices || '').split(/[,\s]+/).filter(x => /\d/.test(x)), sa, dept, soldBy, billed: money(billed), quoted: money(quoted) });
  });
  (L.maint || []).forEach(r => {
    const [id, pid, pname, status, due, type, saName, customer, hrs] = r;
    if (!id || !pid) return;
    add(pid, { name: pname, customer: custName(customer) }).maint.push({ id, status, due: boD(due), type, saName, sa: String(id).replace(/-\d+$/, ''), hrs: money(hrs) });
  });
  const boNos = new Set(), unplaced = [], jobProp = {};
  P.forEach(p => p.jobs.forEach(j => { jobProp[j.id] = p.id; }));
  (L.inv || []).forEach(r => {
    const [no, , sa, job, amount, balance, pid, pname, issued, billTo, status] = r;
    if (!no) return; boNos.add(String(no).replace(/^INV-/, ''));
    const row = { no, date: boD(issued), amount: money(amount), balance: money(balance), job, sa, status, billTo: custName(billTo), src: 'BuildOps' };
    const id = pid && pid !== 'null' ? pid : jobProp[job];
    if (id) add(id, { name: pname }).inv.push(row); else unplaced.push(row);
  });
  // QuickBooks: match each invoice to a property by address, then by name; agreement billing addressed to the
  // owner (no property) goes to the customer's account; anything else becomes its own (older) property.
  const byAddr = new Map(), byName = new Map(), byCust = new Map();
  const custsOf = p => [p.customer, p.billTo, p.account && p.account.customer].map(normName).filter(Boolean);
  P.forEach(p => {
    [...new Set([addrKey(p.address), addrKey(p.name)].filter(Boolean))].forEach(k => { const a = byAddr.get(k) || []; a.push(p.id); byAddr.set(k, a); });
    const n = normName(p.name); if (n) byName.set(n, byName.has(n) && byName.get(n) !== p.id ? null : p.id);
    custsOf(p).forEach(n => { const a = byCust.get(n) || []; if (!a.includes(p.id)) a.push(p.id); byCust.set(n, a); });
  });
  const sameCust = (p, n) => n && custsOf(p).some(x => x === n || (x.length > 5 && n.length > 5 && (x.includes(n) || n.includes(x))));
  const rank = (a, b) => (P.get(b).account ? 1 : 0) - (P.get(a).account ? 1 : 0) || P.get(b).jobs.length - P.get(a).jobs.length;
  // An address only wins when the customer matches too: 25 Main St W is also Markland's billing office.
  function placeQB(k, n) {
    const cands = (k && byAddr.get(k)) || [], known = byCust.get(n) || [];
    const mine = cands.filter(id => sameCust(P.get(id), n)).sort(rank);
    if (mine.length) return mine[0];
    if (known.length === 1) return known[0];
    if (known.length > 1) return 'account';
    if (cands.length) return cands.slice().sort(rank)[0];
    return n && byName.get(n) || null;
  }
  const account = {};
  // BuildOps invoices with no property (agreement billing): the agreement's only site, else the customer's account.
  unplaced.forEach(row => {
    const c = row.sa && accts.find(a => a.agreements.some(g => g.id === row.sa));
    if (c && c.sites.length === 1 && P.has(c.sites[0].id)) { P.get(c.sites[0].id).inv.push(row); return; }
    const n = normName(c ? c.customer : row.billTo); (account[n] = account[n] || []).push(row);
  });
  (Q.r || []).forEach(([no, d, amt, bal, ci, addr]) => {
    if (boNos.has(String(no).replace(/^INV-/, ''))) return;
    const cust = custName((Q.c || [])[ci] || ''), n = normName(cust), k = addrKey(addr) || addrKey(cust);
    const row = { no, date: qbD(d), amount: amt || 0, balance: bal || 0, billTo: cust, src: 'QuickBooks' };
    const pid = placeQB(k, n);
    if (pid === 'account') { (account[n] = account[n] || []).push(row); return; }
    if (pid) { P.get(pid).inv.push(row); return; }
    const id = 'qb-' + (k || n || 'unknown').replace(/[^a-z0-9]+/g, '-');
    const label = /^[A-Z]{1,3}\d{4,}$/.test(cust) ? 'QuickBooks customer ' + cust : /^residential$/i.test(cust) ? 'Residential (no address on invoice)' : cust;
    const p = add(id, { name: k ? (/^\d/.test(cust) ? cust : (addr || cust)) : (label || 'Unknown customer'), customer: /^\d/.test(cust) ? '' : label, address: k ? (addr || cust) : '' });
    p.qbOnly = true; p.inv.push(row);
    if (k && !byAddr.has(k)) byAddr.set(k, [id]);
    if (n && !byCust.has(n) && !/^\d/.test(cust)) byCust.set(n, [id]);
  });
  // Agreement properties: listed on an active agreement (site page) or with maintenance on one.
  P.forEach(p => {
    if (!p.account) { const c = accts.find(a => a.sites.some(s => s.id === p.id)); if (c) p.account = c; }
    const dates = [];
    p.jobs.forEach(j => { const d = j.completed || j.created; if (d) dates.push(d); });
    p.visits.forEach(v => dates.push(v.date));
    p.maint.forEach(m => { if (m.due && /complete|progress|closed/i.test(m.status || '')) dates.push(m.due); });
    p.inv.forEach(i => { if (i.date) dates.push(i.date); });
    const past = dates.filter(d => d <= today).sort();
    p.first = past[0] || ''; p.last = past[past.length - 1] || '';
    p.billed = p.inv.reduce((t, i) => t + i.amount, 0); p.open = p.inv.reduce((t, i) => t + i.balance, 0);
    p.tier = p.account ? tierFor(p.account) : '';
    p.sa = !!(p.account && activeAgreements(p.account).length);
    p.accountBilling = p.sa || p.customer ? (account[normName(p.customer)] || account[normName(p.billTo)] || (p.account ? account[normName(p.account.customer)] : null) || []) : [];
  });
  PX = { list: [...P.values()].filter(p => p.last || p.sa || p.jobs.length || p.inv.length), asOf: L.asOf || '', qbAsOf: Q.asOf || '', account };
  return PX;
}
function propKey(p) { return encodeURIComponent(p.id); }
function saBadge(p) { return tierBadge(/^(Base|Core|Premium)$/.test(p.tier || '') ? p.tier : 'Agreement'); }
async function loadJobIndex() {
  if (jobIdx.rows) return;
  try { const F = await fs(); const s = await F.getDoc(F.doc(F.db, 'ops_job_detail', '_index')); jobIdx.rows = s.exists() ? JSON.parse(s.data().json) : []; }
  catch (e) { jobIdx.rows = []; }
  jobIdx.rows.forEach(r => { jobIdx.by[r.id] = r; });
}
const costsCache = {};
async function jobCosts(id) {
  if (id in costsCache) return costsCache[id];
  try { const F = await fs(); const s = await F.getDoc(F.doc(F.db, 'ops_job_costs', id)); costsCache[id] = s.exists() ? JSON.parse(s.data().json) : null; }
  catch (e) { costsCache[id] = null; }
  return costsCache[id];
}
const boJobPath = {};
const jobLink = id => jobIdx.by[id] ? 'job.html?id=' + encodeURIComponent(id) : BO + (boJobPath[id] || (/^SA/i.test(id) ? '/maintenance/view/' + encodeURIComponent(id) : '/job/view/' + encodeURIComponent(String(id).replace(/^JO/, ''))));
const jobAnchor = id => '<a class="jn" href="' + esc(jobLink(id)) + '"' + (jobIdx.by[id] ? '' : ' target="_blank" rel="noopener"') + '>' + esc(id) + (jobIdx.by[id] ? '' : ' ↗') + '</a>';

// ── property tabs (Account Management home) ──────────────────────────
function ago(iso) {
  const d = parseD(iso); if (!d) return 'no service date';
  const days = Math.round((TODAY - d) / 86400000);
  return days < 1 ? 'today' : days < 45 ? days + ' days ago' : days < 600 ? Math.round(days / 30.4) + ' months ago' : (days / 365).toFixed(1) + ' years ago';
}
function propTab(p) {
  const y = qYear(CUR_Q), ytdJobs = p.jobs.filter(j => (j.created || '') >= y).length;
  const ytdVis = p.visits.filter(v => v.date >= y + '-01-01' && v.date <= isoD(TODAY)).length;
  const bits = [p.sa ? plural(ytdVis, 'visit') + ' ' + y : '', plural(p.jobs.length, 'job'), p.maint.length ? plural(p.maint.length, 'maint. record') : ''].filter(Boolean);
  return '<a class="ptab' + (p.sa ? ' sa' : '') + (p.qbOnly ? ' qb' : '') + '" href="accounts.html?p=' + propKey(p) + '">' +
    '<span class="pt-top">' + (p.sa ? saBadge(p) : p.qbOnly ? '<span class="badge b-grey">QuickBooks only</span>' : '') + '<span class="pt-when">' + esc(p.last ? fmtD(p.last) : '—') + '</span></span>' +
    '<b class="pt-name">' + esc(p.name || p.address || 'Unnamed property') + '</b>' +
    '<span class="pt-cust">' + esc(p.customer && p.customer !== p.name ? p.customer : p.address.split(',')[0] || '') + '</span>' +
    '<span class="pt-meta">' + esc(bits.join(' · ')) + (ytdJobs ? '' : '') + '</span></a>';
}
let ui = { q: qp.get('q') || CUR_Q, filter: '', site: '', show: 'all' };
function renderProperties() {
  document.title = 'Alpine HVAC — Account Management';
  const IX = propIndex();
  const all = IX.list.slice().sort((a, b) => (b.last || '').localeCompare(a.last || '') || a.name.localeCompare(b.name));
  const sa = all.filter(p => p.sa), rest = all.filter(p => !p.sa);
  const due = accounts().filter(c => activeAgreements(c).length && !(acctRec(c.key).reports || {})[LAST_Q]).length;
  const yr = qYear(CUR_Q), active12 = all.filter(p => p.last && p.last >= isoD(new Date(TODAY.getTime() - 365 * 86400000))).length;
  let h = '<div class="head"><div><h1>Account Management</h1><div class="sub">Every property Alpine has worked at. Service agreement properties first, then everything else from most recent work to oldest.</div></div>' +
    '<div class="actions"><a class="btn" href="accounts.html?view=customers">Customers &amp; quarterly reports</a><a class="btn" href="service-agreements.html">Agreements</a><a class="btn" href="site-reports.html" title="Monthly maintenance checklist review">Maintenance checklists</a></div></div>';
  if (!(readJSON('ac_bo_lists') || {}).props) h += '<div class="banner">The full property list has not been pulled from BuildOps yet. It fills in on the next weekly refresh (ACCOUNT-WEEKLY-REFRESH.md Part D); until then only agreement properties show.</div>';
  h += '<div class="kpis"><div><b>' + all.length + '</b><span>properties worked at</span></div><div><b>' + sa.length + '</b><span>on a service agreement</span></div>' +
    '<div><b>' + active12 + '</b><span>serviced in the last 12 months</span></div><div><b>' + plural(due, 'customer') + '</b><span>' + qLabel(LAST_Q) + ' reports not generated</span></div></div>';
  h += '<div class="toolbar"><input class="inp" id="f-q" placeholder="Search property, address or customer" value="' + esc(ui.filter) + '" style="min-width:280px">' +
    '<div class="seg" role="group" aria-label="Show"><button data-show="all" class="' + (ui.show === 'all' ? 'on' : '') + '">All</button><button data-show="12" class="' + (ui.show === '12' ? 'on' : '') + '">Last 12 months</button></div>' +
    '<span class="spacer"></span><span class="muted" style="font-size:.76rem">BuildOps lists as of ' + esc(fmtD((IX.asOf || '').slice(0, 10))) + ' · QuickBooks since Aug 2023</span></div><div id="tabs"></div>';
  $('main').innerHTML = h;
  const draw = () => {
    const f = ui.filter.toLowerCase(), since = isoD(new Date(TODAY.getTime() - 365 * 86400000));
    const ok = p => (!f || (p.name + ' ' + p.address + ' ' + p.customer + ' ' + p.billTo).toLowerCase().includes(f)) && (ui.show === 'all' || p.sa || (p.last && p.last >= since));
    const s1 = sa.filter(ok), s2 = rest.filter(ok);
    $('tabs').innerHTML = '<h2>Service agreement properties <span class="note">' + plural(s1.length, 'property', 'properties') + ' · most recent work first</span></h2>' +
      (s1.length ? '<div class="ptabs">' + s1.map(propTab).join('') + '</div>' : '<div class="card empty">No match.</div>') +
      '<h2>All other properties <span class="note">' + plural(s2.length, 'property', 'properties') + ' · most recent work first, oldest at the bottom</span></h2>' +
      (s2.length ? '<div class="ptabs">' + s2.map(propTab).join('') + '</div>' : '<div class="card empty">No match.</div>');
  };
  $('f-q').oninput = e => { ui.filter = e.target.value; draw(); };
  document.querySelectorAll('[data-show]').forEach(b => b.onclick = () => { ui.show = b.dataset.show; document.querySelectorAll('[data-show]').forEach(x => x.classList.toggle('on', x === b)); draw(); });
  draw();
}

// ── one property: every job, maintenance quarter, invoice and email ──
let PP = null;
function renderProperty(id, mq) {
  const IX = propIndex();
  PP = IX.list.find(p => p.id === id);
  if (!PP) { $('main').innerHTML = '<p class="crumb"><a href="accounts.html">← Account Management</a></p><p class="empty">Property not found. It may have been merged or renamed in BuildOps.</p>'; return; }
  const p = PP, c = p.account;
  document.title = 'Alpine HVAC — ' + p.name;
  if (mq) return renderMaintQuarter(p, mq);
  const yr = qYear(CUR_Q), today = isoD(TODAY);
  const visY = p.visits.filter(v => v.date >= yr + '-01-01' && v.date <= today);
  const billedY = p.inv.filter(i => (i.date || '') >= yr).reduce((t, i) => t + i.amount, 0);
  const ag = c ? activeAgreements(c) : [];
  let h = '<div class="crumb"><a href="accounts.html">Account Management</a> / ' + esc(p.name) + '</div>' +
    '<div class="head"><div><h1>' + esc(p.name) + '</h1><div class="sub">' + esc(p.address || '') + (p.customer ? ' · ' + (c ? '<a href="accounts.html?c=' + esc(c.key) + '">' + esc(p.customer) + '</a>' : esc(p.customer)) : '') +
    (p.billTo && normName(p.billTo) !== normName(p.customer) ? ' · billed to ' + esc(p.billTo) : '') + '</div>' +
    '<div class="sub">' + (p.sa ? saBadge(p) + ' ' + ag.map(a => '<a href="agreement.html?id=' + esc(a.id) + '">' + esc(a.id) + '</a>' + (a.endDate ? ' <span class="muted">(to ' + esc(fmtD(a.endDate)) + ')</span>' : '')).join(', ') : '<span class="badge b-grey">No service agreement</span>') +
    (p.type ? ' <span class="muted">· ' + esc(p.type) + '</span>' : '') + '</div></div>' +
    '<div class="actions">' + (p.site ? '<a class="btn" href="site.html?p=' + esc(p.id) + '">Site page</a><a class="btn" href="site.html?p=' + esc(p.id) + '&view=clear">CLEAR report</a>' : '') +
    (p.qbOnly ? '' : '<a class="btn" href="' + BO + '/property/view/' + esc(p.id) + '" target="_blank" rel="noopener">BuildOps ↗</a>') + '</div></div>';
  h += '<div class="kpis"><div><b>' + esc(p.last ? fmtD(p.last) : '—') + '</b><span>last serviced · ' + esc(ago(p.last)) + '</span></div><div><b>' + esc(p.first ? fmtD(p.first) : '—') + '</b><span>first on record</span></div>' +
    '<div><b>' + p.jobs.length + '</b><span>jobs &amp; service calls</span></div><div><b>' + (p.sa ? visY.length : p.maint.length) + '</b><span>' + (p.sa ? 'site visits ' + yr + ' to date' : 'maintenance records') + '</span></div>' +
    '<div><b>' + fmt$(p.billed) + '</b><span>invoiced all time · ' + fmt$(billedY) + ' in ' + yr + '</span></div><div><b>' + fmt$(p.open) + '</b><span>open balance</span></div></div>';
  h += '<div class="grid2"><div>' +
    '<h2>Jobs <span class="note">every job at this property, newest first · open one for its emails</span></h2><div class="card" id="pp-jobs"></div>' +
    '<h2>Maintenance by quarter <span class="note">open a quarter for every maintenance visit in it</span></h2><div id="pp-maint"></div>' +
    '<h2>Invoices by month <span class="note">BuildOps and QuickBooks</span></h2><div id="pp-inv"></div></div>' +
    '<div>' + (c ? '<h2>Quarterly report <span class="note">' + esc(c.customer) + (c.sites.length > 1 ? ', all ' + c.sites.length + ' properties' : '') + '</span></h2><div class="card panel" id="pp-report"></div>' : '') +
    '<h2>Emails <span class="note">Jake, Mike and Cole\'s mailboxes, matched to each job</span></h2><div class="card panel" id="pp-mail"><p class="muted" style="font-size:.84rem">Loading…</p></div></div></div>';
  $('main').innerHTML = h;
  drawPropJobs(); drawPropMaint(); drawPropInv();
  if (c) drawPropReport();
  loadJobIndex().then(async () => {
    drawPropJobs(); drawPropMaint();
    const ids = [...new Set(p.jobs.map(j => j.id).concat(p.maint.map(m => m.id)).filter(x => jobIdx.by[x]))];
    for (let i = 0; i < ids.length; i += 8) await Promise.all(ids.slice(i, i + 8).map(jobCosts));
    if (PP !== p) return;
    drawPropJobs(); drawPropMail();
  });
}
function emailsOf(id) { const c = costsCache[id]; return (c && c.emails) || []; }
function mailRow(m) {
  return '<li><span class="muted">' + esc(fmtD(m.date)) + '</span> <b>' + (m.link ? '<a href="' + esc(m.link) + '" data-search="' + esc(m.subject || '') + '" target="_blank" rel="noopener">' + esc(m.subject || '(no subject)') + '</a>' : esc(m.subject || '(no subject)')) + '</b>' +
    (m.from ? ' <span class="muted">· ' + esc(m.from) + '</span>' : '') + (m.summary ? '<div>' + esc(m.summary) + '</div>' : '') + '</li>';
}
function drawPropJobs() {
  const p = PP, box = $('pp-jobs'); if (!box) return;
  const js = p.jobs.slice().sort((a, b) => (b.created || '').localeCompare(a.created || ''));
  if (!js.length) { box.innerHTML = '<div class="empty">No jobs in BuildOps for this property' + (p.qbOnly ? ' (this work predates BuildOps; see invoices)' : '') + '.</div>'; return; }
  box.innerHTML = js.map(j => {
    const em = emailsOf(j.id), open = DONE_RE.test(j.status || '') ? 'b-grey' : 'b-amber';
    return '<details class="pjob"><summary><span class="pj-id">' + jobAnchor(j.id) + '</span><span class="pj-t"><b>' + esc(cleanTitle(j.issue) || j.type || 'Job') + '</b><span class="muted">' + esc([j.type, j.po, j.dept].filter(Boolean).join(' · ')) + '</span></span>' +
      '<span class="pj-d">' + esc(fmtD(j.created)) + (j.completed ? '<br><span class="muted">done ' + esc(fmtD(j.completed)) + '</span>' : '') + '</span>' +
      '<span class="pj-s"><span class="badge ' + open + '">' + esc(j.status || '—') + '</span>' + (j.billing ? '<br><span class="muted">' + esc(j.billing) + '</span>' : '') + '</span>' +
      '<span class="pj-b num">' + (j.billed ? fmt$(j.billed) : '') + (em.length ? '<br><span class="muted">' + plural(em.length, 'email') + '</span>' : '') + '</span></summary>' +
      '<div class="pj-body">' + (j.invoices.length ? '<div class="muted" style="font-size:.78rem">Invoices: ' + esc(j.invoices.join(', ')) + '</div>' : '') +
      (j.visits ? '<div class="muted" style="font-size:.78rem">' + plural(j.visits, 'visit') + (j.soldBy ? ' · sold by ' + esc(j.soldBy) : '') + (j.quoted ? ' · quoted ' + fmt$(j.quoted) : '') + '</div>' : '') +
      (em.length ? '<ul class="mails">' + em.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '')).map(mailRow).join('') + '</ul>'
        : '<p class="muted" style="font-size:.8rem;margin-top:.35rem">' + (jobIdx.by[j.id] ? 'No emails matched to this job yet.' : 'Emails are matched for jobs on Field Operations; this job has no job page.') + '</p>') +
      '</div></details>';
  }).join('');
}
// Maintenance quarters: BuildOps maintenance records by due date, with the visits the weekly refresh read.
function maintQuarters(p) {
  const qs = {};
  p.maint.forEach(m => { const q = qOf(m.due); if (q) (qs[q] = qs[q] || { recs: [], visits: [] }).recs.push(m); });
  p.visits.filter(v => v.bucket === 'Maintenance').forEach(v => { const q = qOf(v.date); if (q) (qs[q] = qs[q] || { recs: [], visits: [] }).visits.push(v); });
  return Object.entries(qs).sort((a, b) => b[0].localeCompare(a[0]));
}
function drawPropMaint() {
  const p = PP, box = $('pp-maint'); if (!box) return;
  const qs = maintQuarters(p).filter(([q]) => q <= CUR_Q || true);
  if (!qs.length) { box.innerHTML = '<div class="card empty">No maintenance records for this property.</div>'; return; }
  box.innerHTML = '<div class="mq">' + qs.map(([q, x]) => {
    const done = x.recs.filter(m => /complete|closed/i.test(m.status || '')).length, fut = q > CUR_Q;
    return '<a class="mqt' + (q === CUR_Q ? ' cur' : '') + (fut ? ' fut' : '') + '" href="accounts.html?p=' + propKey(p) + '&mq=' + q + '"><b>' + esc(qLabel(q)) + '</b><span>' + plural(x.recs.length, 'record') + ' · ' + plural(x.visits.length, 'visit') + '</span><span class="muted">' + (fut ? 'scheduled' : done + ' of ' + x.recs.length + ' complete') + '</span></a>';
  }).join('') + '</div>';
}
function drawPropInv() {
  const p = PP, box = $('pp-inv'); if (!box) return;
  const by = {};
  p.inv.forEach(i => { const m = (i.date || '').slice(0, 7) || 'undated'; (by[m] = by[m] || []).push(i); });
  const months = Object.keys(by).sort().reverse();
  const invRow = i => '<tr><td>' + esc(i.no) + '</td><td>' + esc(fmtD(i.date)) + '</td><td>' + (i.job ? jobAnchor(i.job) : i.sa ? esc(i.sa) : '') + '</td><td><span class="src' + (i.src === 'QuickBooks' ? ' man' : '') + '">' + esc(i.src) + '</span>' + (i.status ? ' <span class="muted">' + esc(i.status) + '</span>' : '') + '</td><td class="num">' + fmt$c(i.amount) + '</td><td class="num' + (i.balance > 0.005 ? '" style="color:var(--red)' : '') + '">' + (i.balance > 0.005 ? fmt$c(i.balance) : 'paid') + '</td></tr>';
  let h = months.length ? months.map((m, k) => {
    const rows = by[m].sort((a, b) => (b.date || '').localeCompare(a.date || '')), tot = rows.reduce((t, i) => t + i.amount, 0);
    const [y, mo] = m.split('-');
    return '<details class="card imonth"' + (k < 3 ? ' open' : '') + '><summary><b>' + esc(mo ? MONTHS[+mo - 1] + ' ' + y : 'Undated') + '</b><span class="muted">' + plural(rows.length, 'invoice') + '</span><span class="num">' + fmt$c(tot) + '</span></summary>' +
      '<table class="list inv"><thead><tr><th>Invoice</th><th>Date</th><th>Job</th><th>Source</th><th class="num">Amount</th><th class="num">Balance</th></tr></thead><tbody>' + rows.map(invRow).join('') + '</tbody></table></details>';
  }).join('') : '<div class="card empty">No invoices found for this property.</div>';
  const acc = p.accountBilling || [];
  if (acc.length) {
    const tot = acc.reduce((t, i) => t + i.amount, 0);
    h += '<details class="card imonth"><summary><b>Account billing</b><span class="muted">' + plural(acc.length, 'invoice') + ' to ' + esc(acc[0].billTo) + ' covering all their properties (agreement billing in QuickBooks)</span><span class="num">' + fmt$c(tot) + '</span></summary>' +
      '<table class="list inv"><thead><tr><th>Invoice</th><th>Date</th><th></th><th>Source</th><th class="num">Amount</th><th class="num">Balance</th></tr></thead><tbody>' + acc.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '')).map(invRow).join('') + '</tbody></table></details>';
  }
  box.innerHTML = h;
}
function drawPropMail() {
  const p = PP, box = $('pp-mail'); if (!box) return;
  const rows = p.jobs.concat(p.maint).flatMap(j => emailsOf(j.id).map(m => ({ ...m, job: j.id }))).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  box.innerHTML = rows.length ? '<ul class="mails">' + rows.slice(0, 40).map(m => mailRow(m).replace('</b>', '</b> <span class="badge b-grey">' + esc(m.job) + '</span>')).join('') + '</ul>' + (rows.length > 40 ? '<p class="muted" style="font-size:.76rem">Showing the latest 40 of ' + rows.length + '; each job lists all of its own.</p>' : '')
    : '<p class="muted" style="font-size:.84rem">No emails matched to this property\'s jobs yet. The daily job refresh matches Jake\'s, Mike\'s and Cole\'s email to jobs on Field Operations.</p>';
}
function drawPropReport() {
  const c = PP.account, box = $('pp-report'); if (!box) return;
  const rec = acctRec(c.key), q = LAST_Q, r = (rec.reports || {})[q], l = rec.lastReport;
  box.innerHTML = (l ? '<div class="rep-stamp">Last generated <b>' + esc(qLabel(l.quarter)) + '</b> on ' + esc(fmtStamp(l.at)) + ' by ' + esc(l.by) + '</div>' : '<div class="rep-stamp none">No report generated yet.</div>') +
    '<div class="actions"><button class="btn primary" id="pp-gen">' + (r ? 'Regenerate ' : 'Generate ') + esc(qLabel(q)) + ' report</button>' +
    (r ? '<a class="btn" href="' + esc(shareUrl(r.token)) + '" target="_blank" rel="noopener">Open live report ↗</a><a class="btn" href="' + esc(shareUrl(r.token)) + '&print=1" target="_blank" rel="noopener">PDF</a>' : '') +
    '<a class="btn" href="accounts.html?c=' + esc(c.key) + '">Message, customize &amp; history</a></div>' +
    '<p class="muted" style="font-size:.74rem;margin-top:.6rem">Covers every property on ' + esc(c.customer) + '\'s agreement. Each quarter the report is generated automatically and emailed to Mike (Jake CC\'d) to review and forward.</p>';
  $('pp-gen').onclick = async () => {
    if (r && !confirm('Regenerate ' + qLabel(q) + ' for ' + c.customer + '? The same customer link updates and the message is rewritten.')) return;
    const b = $('pp-gen'); b.disabled = true; b.textContent = 'Generating…';
    try { await generate(c, q, { source: 'on-demand' }); toast('Report generated'); }
    catch (e) { console.error(e); toast(/permission/i.test(e.message) ? 'Not saved: only Jake, Mike and Cole can publish reports' : 'Could not generate: ' + e.message); }
    drawPropReport();
  };
}
// One maintenance quarter at a property: every record due in it and every maintenance visit, with tech notes.
async function renderMaintQuarter(p, q) {
  const x = (maintQuarters(p).find(([k]) => k === q) || [q, { recs: [], visits: [] }])[1];
  const qs = maintQuarters(p).map(([k]) => k);
  let h = '<div class="crumb"><a href="accounts.html">Account Management</a> / <a href="accounts.html?p=' + propKey(p) + '">' + esc(p.name) + '</a> / ' + esc(qLabel(q)) + ' maintenance</div>' +
    '<div class="head"><div><h1>' + esc(qLabel(q)) + ' maintenance</h1><div class="sub">' + esc(p.name) + (p.address ? ' · ' + esc(p.address) : '') + ' · ' + esc(qMonths(q)) + '</div></div>' +
    '<div class="actions">' + (qs.length > 1 ? '<select class="sel" id="mq-sel">' + qs.map(k => '<option value="' + k + '"' + (k === q ? ' selected' : '') + '>' + qLabel(k) + '</option>').join('') + '</select>' : '') +
    (p.site ? '<a class="btn" href="site.html?p=' + esc(p.id) + '&q=' + esc(q) + '">Site page</a>' : '') + '</div></div>';
  h += '<h2>Maintenance records <span class="note">' + plural(x.recs.length, 'record') + ' due this quarter</span></h2><div class="card">' +
    (x.recs.length ? '<table class="list"><thead><tr><th>Record</th><th>Type</th><th>Due</th><th>Status</th><th class="num">Budget hrs</th></tr></thead><tbody>' +
      x.recs.sort((a, b) => (a.due || '').localeCompare(b.due || '')).map(m => '<tr><td>' + jobAnchor(m.id) + '</td><td>' + esc(m.type || m.saName || '') + '</td><td>' + esc(fmtD(m.due)) + '</td><td><span class="badge ' + (/complete|closed/i.test(m.status || '') ? 'b-green' : 'b-amber') + '">' + esc(m.status || '—') + '</span></td><td class="num">' + (m.hrs || '') + '</td></tr>').join('') + '</tbody></table>'
      : '<div class="empty">No maintenance records due this quarter.</div>') + '</div>';
  h += '<h2>Maintenance visits <span class="note">' + plural(x.visits.length, 'visit') + ' · tech summaries and photos from the job pages</span></h2><div class="card" id="mq-visits"></div>';
  $('main').innerHTML = h;
  if ($('mq-sel')) $('mq-sel').onchange = e => { location.href = 'accounts.html?p=' + propKey(p) + '&mq=' + e.target.value; };
  const groups = groupJobs(x.visits.map(v => ({ ...v, site: p.site || { id: p.id, name: p.name } })));
  const draw = () => {
    $('mq-visits').innerHTML = groups.length ? groups.map(J => {
      const jid = detId(J.job);
      return '<div class="job"><div class="job-top">' + (jid ? jobAnchor(jid) : '<b class="jn">' + esc(J.job || '') + '</b>') + (J.title ? '<span class="muted">' + esc(J.title) + '</span>' : '') + '</div>' +
        '<ul class="visits">' + J.visits.map(v => '<li><b>' + esc(fmtD(v.date)) + '</b><div><span class="sm">' + esc([v.tech, v.others].filter(z => z && z !== '-').join(' + ')) + '</span>' +
          (v.desc && cleanTitle(v.desc) !== J.title ? '<div>' + esc(v.desc) + '</div>' : '') + (v.assets && v.assets !== '-' ? '<div class="sm">Equipment: ' + esc(v.assets) + '</div>' : '') +
          (v.summary ? '<div class="sumtxt">' + esc(v.summary) + '</div>' : '') +
          ((v.recs || []).length ? '<div class="sm" style="margin-top:.3rem"><b>Recommended:</b> ' + v.recs.map(r => esc(r.title + (r.text ? ' — ' + r.text : ''))).join('; ') + '</div>' : '') +
          ((v.photos || []).length ? '<div class="thumbs">' + v.photos.slice(0, 8).map(ph => '<a href="' + esc(phUrl(ph.src, 1600)) + '" target="_blank" rel="noopener"><img loading="lazy" src="' + esc(phUrl(ph.src, 160)) + '" alt="' + esc(ph.comment || ph.type || 'Visit photo') + '"></a>').join('') + '</div>' : '') +
          '</div></li>').join('') + '</ul></div>';
    }).join('') : '<div class="empty">No maintenance visits recorded' + (p.site ? '' : ' (visit detail is read for agreement properties)') + ' this quarter.</div>';
  };
  draw();
  await loadJobIndex();
  const ids = [...new Set(groups.map(J => J.job).filter(Boolean))];
  for (let i = 0; i < ids.length; i += 8) await Promise.all(ids.slice(i, i + 8).map(jobDetail));
  groups.forEach(J => enrich(J, detailCache[detId(J.job)]));
  draw();
}

// ── customer list (quarterly reports) ────────────────────────────────
function stampHTML(rec) {
  const l = rec.lastReport;
  if (!l) return '<span class="stamp none">Never generated</span>';
  const stale = l.quarter < LAST_Q;
  return '<span class="stamp' + (stale ? ' stale' : '') + '">' + esc(qLabel(l.quarter)) + ' · ' + esc(fmtD(isoD(new Date(l.at)))) + '</span>';
}
function renderCustomers() {
  document.title = 'Alpine HVAC — Customers & quarterly reports';
  const all = accounts();
  const [qf, qt] = qRangeISO(CUR_Q), [yf, yt] = ytdRangeISO(CUR_Q);
  const due = all.filter(c => !(acctRec(c.key).reports || {})[LAST_Q]).length;
  let h = '<div class="crumb"><a href="accounts.html">Account Management</a> / Customers</div><div class="head"><div><h1>Customers &amp; quarterly reports</h1><div class="sub">Service agreement customers: what happened this quarter and year to date, and the quarterly account review for all of their properties.</div></div>' +
    '<div class="actions"><a class="btn" href="accounts.html">All properties</a><a class="btn" href="service-agreements.html">Agreements</a></div></div>';
  if (!all.length) return $('main').innerHTML = h + '<p class="empty">No customers yet. Customers appear here once the weekly BuildOps refresh has pulled their agreements and sites (Service Agreements &gt; Refresh).</p>';
  h += '<div class="kpis"><div><b>' + all.length + '</b><span>customers</span></div>' +
    '<div><b>' + all.reduce((t, c) => t + c.sites.length, 0) + '</b><span>properties</span></div>' +
    '<div><b>' + all.reduce((t, c) => t + visitsFor(c, qf, qt).length, 0) + '</b><span>visits ' + qLabel(CUR_Q) + ' to date</span></div>' +
    '<div><b>' + all.reduce((t, c) => t + visitsFor(c, yf, yt).length, 0) + '</b><span>visits ' + qYear(CUR_Q) + ' to date</span></div>' +
    '<div><b>' + due + '</b><span>' + qLabel(LAST_Q) + ' reports not generated</span></div></div>';
  h += '<div class="toolbar"><input class="inp" id="f-q" placeholder="Search customer or property" value="' + esc(ui.filter) + '" style="min-width:260px"><span class="spacer"></span><span class="muted" style="font-size:.78rem">BuildOps data as of ' +
    esc(fmtD(all.flatMap(c => c.sites.map(s => s.syncedAt || '')).sort().pop() || '')) + '</span></div>';
  h += '<div class="card"><table class="list"><thead><tr><th>Customer</th><th>Tier</th><th class="hide-sm">Properties</th><th class="num">' + qLabel(CUR_Q) + ' QTD</th><th class="num hide-sm">YTD</th><th class="hide-sm">Account manager</th><th>Last report</th></tr></thead><tbody id="rows"></tbody></table></div>';
  $('main').innerHTML = h;
  const rows = () => {
    const f = ui.filter.toLowerCase();
    $('rows').innerHTML = all.filter(c => !f || (c.customer + ' ' + c.sites.map(s => s.name + ' ' + s.address).join(' ')).toLowerCase().includes(f)).map(c => {
      const qs = countVisits(visitsFor(c, qf, qt)), ys = countVisits(visitsFor(c, yf, yt)), rec = acctRec(c.key);
      return '<tr data-k="' + esc(c.key) + '"><td><div class="cname">' + esc(c.customer) + '</div><div class="muted" style="font-size:.76rem">' + esc(activeAgreements(c).map(a => a.id).join(', ')) + '</div></td>' +
        '<td>' + tierBadge(tierFor(c)) + '</td><td class="hide-sm">' + esc(c.sites.map(s => s.name).join(', ') || '—') + '</td>' +
        '<td class="num">' + qs.total + ' <span class="muted" style="font-size:.72rem">(' + qs.maint + 'M · ' + qs.calls + 'S · ' + qs.projects + 'P)</span></td>' +
        '<td class="num hide-sm">' + ys.total + '</td><td class="hide-sm">' + esc(managerOf(c) || '—') + '</td><td>' + stampHTML(rec) + '</td></tr>';
    }).join('') || '<tr><td colspan="7" class="empty">No match.</td></tr>';
    $('rows').querySelectorAll('tr[data-k]').forEach(tr => tr.onclick = () => { location.href = 'accounts.html?c=' + encodeURIComponent(tr.dataset.k); });
  };
  $('f-q').oninput = e => { ui.filter = e.target.value; rows(); };
  rows();
}

// ── customer file ────────────────────────────────────────────────────
let C = null, repQ = LAST_Q, liveJobs = [];
function quartersFor(c) {
  const qs = new Set([CUR_Q, LAST_Q]);
  c.sites.forEach(s => (s.visits || []).forEach(v => { const q = qOf(v.date); if (q) qs.add(q); }));
  Object.keys(acctRec(c.key).reports || {}).forEach(q => qs.add(q));
  return [...qs].filter(q => q <= CUR_Q).sort().reverse();
}
function renderFile(key) {
  C = accounts().find(c => c.key === key);
  if (!C) { $('main').innerHTML = '<p class="crumb"><a href="accounts.html">← Account Management</a></p><p class="empty">Customer not found. It may have been renamed in BuildOps.</p>'; return; }
  document.title = 'Alpine HVAC — ' + C.customer;
  const rec = acctRec(C.key);
  const qs = quartersFor(C);
  if (!qs.includes(ui.q)) ui.q = CUR_Q;
  const [qf, qt] = qRangeISO(ui.q), [yf, yt] = ytdRangeISO(ui.q);
  const isCur = ui.q === CUR_Q;
  const qS = countVisits(visitsFor(C, qf, qt).filter(v => !ui.site || v.site.id === ui.site)), yS = countVisits(visitsFor(C, yf, yt).filter(v => !ui.site || v.site.id === ui.site));
  const ag = activeAgreements(C);
  let h = '<div class="crumb"><a href="accounts.html">Account Management</a> / <a href="accounts.html?view=customers">Customers</a> / ' + esc(C.customer) + '</div>' +
    '<div class="head"><div><h1>' + esc(C.customer) + '</h1><div class="sub">' + tierBadge(tierFor(C)) + ' ' +
    (ag.length ? ag.map(a => '<a href="agreement.html?id=' + esc(a.id) + '">' + esc(a.id) + '</a>' + (a.endDate ? ' <span class="muted">(to ' + esc(fmtD(a.endDate)) + ')</span>' : '')).join(', ') : '<span class="muted">No active agreement</span>') +
    (managerOf(C) ? ' · Account manager: <b>' + esc(managerOf(C)) + '</b>' : '') + '</div></div>' +
    '<div class="actions"><select class="sel" id="pick-q" aria-label="Quarter">' + qs.map(q => '<option value="' + q + '"' + (q === ui.q ? ' selected' : '') + '>' + qLabel(q) + (q === CUR_Q ? ' (to date)' : '') + '</option>').join('') + '</select></div></div>';

  h += '<div class="kpis">' +
    '<div><b>' + qS.maint + '</b><span>maintenance visits</span><small>' + qLabel(ui.q) + (isCur ? ' to date' : '') + '</small></div>' +
    '<div><b>' + qS.calls + '</b><span>service calls · ' + plural(qS.service, 'visit') + '</span><small>' + qLabel(ui.q) + '</small></div>' +
    '<div><b>' + qS.projects + '</b><span>jobs &amp; projects · ' + plural(qS.project, 'visit') + '</span><small>' + qLabel(ui.q) + '</small></div>' +
    '<div><b>' + yS.total + '</b><span>total visits YTD</span><small>' + yS.maint + ' maint · ' + plural(yS.calls, 'call') + ' · ' + plural(yS.projects, 'project') + '</small></div>' +
    '<div><b>' + C.sites.length + '</b><span>' + (C.sites.length === 1 ? 'property' : 'properties') + '</span><small>' + plural(C.sites.reduce((t, s) => t + (s.assets || []).length, 0), 'asset') + '</small></div></div>';

  h += '<h2>Properties <span class="note">click one to filter the activity below</span></h2><div class="props">' + C.sites.map(s => {
    const a = countVisits((s.visits || []).filter(v => v.date >= qf && v.date <= qt)), y = countVisits((s.visits || []).filter(v => v.date >= yf && v.date <= yt));
    return '<div class="card prop' + (ui.site === s.id ? ' on' : '') + '" data-site="' + esc(s.id) + '" style="cursor:pointer"><div class="pn">' + esc(s.name) + '</div><div class="pa">' + esc(s.address || '') + '</div>' +
      '<div class="pc"><span class="badge b-grey">' + qLabel(ui.q) + ': ' + plural(a.total, 'visit') + '</span><span class="badge b-grey">YTD ' + y.total + '</span><span class="badge b-grey">' + plural((s.assets || []).length, 'asset') + '</span></div>' +
      '<div class="pc">' + clearBadge(s) + '</div>' +
      '<div class="pl"><a href="accounts.html?p=' + encodeURIComponent(s.id) + '">Property file</a><a href="site.html?p=' + esc(s.id) + '&q=' + esc(ui.q) + '">Site page</a><a href="site.html?p=' + esc(s.id) + '&q=' + esc(ui.q) + '&view=clear">CLEAR report</a><a href="' + BO + '/property/view/' + esc(s.id) + '" target="_blank" rel="noopener">BuildOps ↗</a></div></div>';
  }).join('') + (C.sites.length ? '' : '<p class="empty">No properties pulled from BuildOps yet.</p>') + '</div>';

  h += '<div class="grid2"><div><h2>Activity <span class="note">' + esc(qLabel(ui.q)) + (ui.site ? ' · ' + esc((C.sites.find(s => s.id === ui.site) || {}).name || '') + ' <a href="#" id="clr-site">show all properties</a>' : ' · all properties') + '</span></h2><div id="activity"></div>' +
    '<h2>Needs attention <span class="note">red / yellow equipment on the CLEAR reports</span></h2><div class="card panel" id="attn"></div></div>' +
    '<div><h2>Quarterly report</h2><div class="card panel" id="report"></div>' +
    '<h2>Customer contact <span class="note">filled weekly from BuildOps, QuickBooks and Outlook; your edits are kept</span></h2><div class="card panel" id="contact"></div></div></div>' +
    '<div id="customize"></div>';
  $('main').innerHTML = h;

  $('pick-q').onchange = e => { ui.q = e.target.value; history.replaceState(null, '', 'accounts.html?c=' + encodeURIComponent(C.key) + '&q=' + ui.q); renderFile(C.key); };
  document.querySelectorAll('.prop[data-site]').forEach(p => p.onclick = e => { if (e.target.closest('a')) return; ui.site = ui.site === p.dataset.site ? '' : p.dataset.site; renderFile(C.key); });
  if ($('clr-site')) $('clr-site').onclick = e => { e.preventDefault(); ui.site = ''; renderFile(C.key); };
  renderContact();
  renderAttention();
  renderReport();
  renderActivity();
}

// ── contact (editable; backfilled weekly) ────────────────────────────
const CFIELDS = [['contactName', 'Contact name', 'Who receives the quarterly report', 'text'], ['contactTitle', 'Title / role', 'Property manager, facilities manager…', 'text'],
  ['contactEmail', 'Email', 'name@company.com', 'email'], ['contactPhone', 'Phone', 'Direct line', 'tel']];
function srcTag(rec, f) {
  const src = (rec.contactSrc || {})[f];
  if (!rec[f]) return '';
  return '<span class="src' + ((rec.edited || {})[f] ? ' man' : '') + '">' + esc((rec.edited || {})[f] ? 'Edited' : src || 'Manual') + '</span>';
}
function renderContact() {
  const rec = acctRec(C.key);
  const cands = (rec.candidates || []).filter(x => x.name || x.email);
  let h = CFIELDS.map(([f, l, ph, t]) => '<label class="field">' + l + ' ' + srcTag(rec, f) + '<input class="inp wide" data-f="' + f + '" type="' + t + '" value="' + esc(rec[f] || '') + '" placeholder="' + esc(ph) + '"></label>').join('') +
    '<label class="field">Account notes (internal)<textarea class="inp" id="c-notes" style="min-height:90px" placeholder="Preferences, decision makers, open quotes, renewal notes">' + esc(rec.notes || '') + '</textarea></label>' +
    '<button class="btn" id="c-save">Save contact &amp; notes</button>';
  if (cands.length) h += '<div class="muted" style="font-size:.74rem;margin:1rem 0 .35rem">Other contacts found' + (rec.backfilledAt ? ' (updated ' + esc(fmtD(rec.backfilledAt)) + ')' : '') + '</div><ul class="cands">' +
    cands.slice(0, 12).map((x, i) => '<li><div><b>' + esc(x.name || x.email) + '</b>' + (x.title ? ' <span class="muted">' + esc(x.title) + '</span>' : '') +
      '<div class="muted">' + esc([x.email, x.phone].filter(Boolean).join(' · ')) + '</div><div class="srcs">' + esc((x.sources || [x.source]).filter(Boolean).join(', ')) + (x.note ? ' · ' + esc(x.note) : '') + '</div></div>' +
      '<button class="btn sm" data-use="' + i + '">Use</button></li>').join('') + '</ul>';
  else h += '<p class="muted" style="font-size:.74rem;margin-top:.8rem">No contacts found yet. The weekly refresh fills this from BuildOps customer contacts, QuickBooks and Outlook.</p>';
  $('contact').innerHTML = h;
  $('c-save').onclick = () => {
    const r = acctRec(C.key); r.edited = r.edited || {}; r.contactSrc = r.contactSrc || {};
    document.querySelectorAll('#contact [data-f]').forEach(i => { const f = i.dataset.f, v = i.value.trim(); if (v !== (r[f] || '')) { r[f] = v; r.edited[f] = true; r.contactSrc[f] = 'Edited by ' + session.name; } });
    r.notes = $('c-notes').value; saveAcct(r); toast('Saved'); renderContact(); renderReport();
  };
  document.querySelectorAll('#contact [data-use]').forEach(b => b.onclick = () => {
    const x = cands[+b.dataset.use], r = acctRec(C.key); r.edited = r.edited || {}; r.contactSrc = r.contactSrc || {};
    [['contactName', x.name], ['contactTitle', x.title], ['contactEmail', x.email], ['contactPhone', x.phone]].forEach(([f, v]) => { if (v) { r[f] = v; r.edited[f] = true; r.contactSrc[f] = 'Chosen by ' + session.name; } });
    saveAcct(r); toast('Contact updated'); renderContact(); renderReport();
  });
}
// Merge contacts found by the weekly refresh. Fields someone edited by hand are never overwritten.
function backfillOne(c, row) {
  const r = acctRec(c.key); r.edited = r.edited || {}; r.contactSrc = r.contactSrc || {};
  const norm = x => ({ name: String(x.name || '').trim(), title: String(x.title || x.role || '').trim(), email: String(x.email || '').trim().toLowerCase(), phone: String(x.phone || x.mobile || '').trim(), source: x.source || '', note: x.note || '' });
  const map = new Map();
  [...(r.candidates || []), ...(row.candidates || []).map(norm)].forEach(x => {
    if (!x.name && !x.email) return;
    const k = x.email || x.name.toLowerCase();
    const o = map.get(k) || { name: '', title: '', email: '', phone: '', sources: [], note: '' };
    ['name', 'title', 'email', 'phone', 'note'].forEach(f => { if (x[f] && !o[f]) o[f] = x[f]; });
    [...(x.sources || []), x.source].filter(Boolean).forEach(s2 => { if (!o.sources.includes(s2)) o.sources.push(s2); });
    map.set(k, o);
  });
  r.candidates = [...map.values()].slice(0, 25);
  const p = row.primary ? norm(row.primary) : null, filled = [];
  if (p) [['contactName', p.name], ['contactTitle', p.title], ['contactEmail', p.email], ['contactPhone', p.phone]].forEach(([f, v]) => {
    if (v && !r.edited[f] && r[f] !== v) { r[f] = v; r.contactSrc[f] = p.source || 'Backfill'; filled.push(f); }
  });
  r.backfilledAt = isoD(TODAY);
  saveAcct(r);
  return filled;
}

function renderAttention() {
  const a = attentionFor(C, ui.q).filter(x => !ui.site || x.site === (C.sites.find(s => s.id === ui.site) || {}).name);
  $('attn').innerHTML = a.length ? '<ul class="att">' + a.map(x => '<li><span class="badge ' + (x.condition === 'red' ? 'b-red' : 'b-amber') + '">' + (x.condition === 'red' ? 'Red' : 'Yellow') + '</span><div><b>' + esc(x.tag) + '</b>' + (x.type ? ' <span class="muted">' + esc(x.type) + '</span>' : '') +
    (C.sites.length > 1 ? ' · <span class="muted">' + esc(x.site) + '</span>' : '') + (x.note ? '<div>' + esc(x.note) + '</div>' : '') + (x.quarter !== ui.q ? '<div class="muted" style="font-size:.72rem">from ' + esc(qLabel(x.quarter)) + ' CLEAR report</div>' : '') + '</div></li>').join('') + '</ul>'
    : '<p class="muted" style="font-size:.84rem">Nothing flagged red or yellow. CLEAR reports are on each Site page.</p>';
}

async function renderActivity() {
  const [qf, qt] = qRangeISO(ui.q);
  const vis = visitsFor(C, qf, qt).filter(v => !ui.site || v.site.id === ui.site);
  const jobs = groupJobs(vis);
  liveJobs = jobs;
  const draw = () => {
    if (!jobs.length) { $('activity').innerHTML = '<div class="card empty">No visits recorded ' + (ui.q === CUR_Q ? 'yet this quarter' : 'in ' + qLabel(ui.q)) + '.</div>'; return; }
    $('activity').innerHTML = BUCKETS.map(b => {
      const js = jobs.filter(j => j.bucket === b);
      return '<div class="muted" style="font:600 .74rem Oswald,sans-serif;letter-spacing:.08em;text-transform:uppercase;margin:.9rem 0 .35rem">' + esc(b) + ' · ' + js.length + '</div><div class="card bucket">' +
        (js.length ? js.map(jobHTML).join('') : '<div class="empty">None this quarter.</div>') + '</div>';
    }).join('');
  };
  draw();
  const ids = [...new Set(jobs.map(j => j.job).filter(Boolean))];
  for (let i = 0; i < ids.length; i += 8) await Promise.all(ids.slice(i, i + 8).map(jobDetail));
  if (liveJobs !== jobs) return;
  jobs.forEach(J => enrich(J, detailCache[detId(J.job)]));
  draw();
}
function jobHTML(J) {
  const url = J.url ? BO + J.url : '';
  const jid = detId(J.job), hasPage = jid && detailCache[jid];
  return '<div class="job"><div class="job-top">' +
    (hasPage ? '<a class="jn" href="job.html?id=' + esc(jid) + '">' + esc(J.job) + '</a>' : url ? '<a class="jn" href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(J.job) + ' ↗</a>' : '<b class="jn">' + esc(J.job || '') + '</b>') +
    (J.type ? '<span class="muted">' + esc(J.type) + '</span>' : '') + (J.status ? '<span class="badge ' + (DONE_RE.test(J.status) ? 'b-grey' : 'b-amber') + '">' + esc(J.status) + '</span>' : '') +
    (C.sites.length > 1 && !ui.site ? '<span class="muted">· ' + esc(J.site.name) + '</span>' : '') + '</div>' +
    (J.title ? '<div class="job-title">' + esc(J.title) + '</div>' : '') +
    '<ul class="visits">' + J.visits.map(v => '<li><b>' + esc(fmtD(v.date)) + '</b><div><span class="sm">' + esc([v.tech, v.others].filter(x => x && x !== '-').join(' + ')) + '</span>' +
      (v.desc && cleanTitle(v.desc) !== J.title ? '<div>' + esc(v.desc) + '</div>' : '') +
      (v.assets && v.assets !== '-' ? '<div class="sm">Equipment: ' + esc(v.assets) + '</div>' : '') +
      (v.summary ? '<div class="sumtxt">' + esc(v.summary) + '</div>' : '') +
      ((v.photos || []).length ? '<div class="thumbs">' + v.photos.filter(p => photoOn(customOf(acctRec(C.key)), p)).slice(0, 6).map(p => '<a href="' + esc(phUrl(p.src, 1600)) + '" target="_blank" rel="noopener"><img loading="lazy" src="' + esc(phUrl(p.src, 160)) + '" alt="' + esc(p.comment || p.type || 'Visit photo') + '"></a>').join('') + '</div>' : '') +
      '</div></li>').join('') + '</ul></div>';
}

function renderReport() {
  const rec = acctRec(C.key);
  const qs = quartersFor(C).filter(q => q <= LAST_Q || q === CUR_Q);
  if (!qs.includes(repQ)) repQ = LAST_Q;
  const r = (rec.reports || {})[repQ];
  let h = '<label class="field">Report quarter<select class="sel" id="rep-q">' + qs.map(q => '<option value="' + q + '"' + (q === repQ ? ' selected' : '') + '>' + qLabel(q) + (q === CUR_Q ? ' (to date)' : '') + '</option>').join('') + '</select></label>';
  h += r ? '<div class="rep-stamp">Last generated <b>' + esc(fmtStamp(r.generatedAt)) + '</b> by ' + esc(r.by) + (r.source === 'quarterly' ? ' (quarterly run)' : '') + (r.sentAt ? '<br>Marked sent ' + esc(fmtD(r.sentAt)) : '') + '</div>'
    : '<div class="rep-stamp none">No ' + esc(qLabel(repQ)) + ' report generated yet.</div>';
  h += '<div class="actions"><button class="btn primary" id="rep-gen">' + (r ? 'Regenerate report' : 'Generate report') + '</button>' +
    '<button class="btn" id="rep-cust">Customize</button>' +
    (r ? '<a class="btn" href="' + esc(shareUrl(r.token)) + '" target="_blank" rel="noopener">Open live report ↗</a><a class="btn" href="' + esc(shareUrl(r.token)) + '&print=1" target="_blank" rel="noopener">PDF</a>' : '') + '</div>' +
    (r && r.customizedAt ? '<div class="muted" style="font-size:.74rem;margin-top:.4rem">Customized ' + esc(fmtStamp(r.customizedAt)) + '</div>' : '');
  if (r) {
    h += '<div class="linkrow"><input class="inp" id="rep-link" readonly value="' + esc(shareUrl(r.token)) + '"><button class="btn sm" id="rep-copylink">Copy link</button></div>' +
      '<label class="field" style="margin-top:.6rem">Message to customer (edit, then copy into your email)<textarea class="inp" id="rep-msg">' + esc(r.message || '') + '</textarea></label>' +
      '<div class="actions"><button class="btn" id="rep-copy">Copy message</button><button class="btn" id="rep-savemsg">Save edits</button>' +
      (rec.contactEmail ? '<a class="btn" id="rep-mail" href="#">Open in email</a>' : '') +
      '<button class="btn" id="rep-sent">' + (r.sentAt ? 'Sent ✓' : 'Mark sent') + '</button><button class="btn danger" id="rep-revoke" title="Turns the customer link off">Turn off link</button></div>';
  }
  const hist = Object.entries(rec.reports || {}).sort((a, b) => b[0].localeCompare(a[0]));
  if (hist.length) h += '<div class="muted" style="font-size:.74rem;margin-top:1rem">Report history</div><ul class="hist">' + hist.map(([q, x]) => '<li><a href="' + esc(shareUrl(x.token)) + '" target="_blank" rel="noopener">' + esc(qLabel(q)) + '</a> · ' + esc(fmtD(isoD(new Date(x.generatedAt)))) + ' · ' + esc(x.by) + (x.sentAt ? ' · sent' : '') + '</li>').join('') + '</ul>';
  h += '<p class="muted" style="font-size:.72rem;margin-top:.9rem">The live link needs no login and shows only this customer\'s visits, notes and report photos for ' + esc(qYear(repQ)) + ' (no dollar amounts). Anyone with the link can open it; turn it off any time.</p>';
  $('report').innerHTML = h;

  $('rep-q').onchange = e => { repQ = e.target.value; renderReport(); };
  $('rep-gen').onclick = async () => {
    if (r && !confirm('Regenerate ' + qLabel(repQ) + '? This pulls the latest data into the same customer link and rewrites the message (edits to the current message are replaced).')) return;
    const b = $('rep-gen'); b.disabled = true; b.textContent = 'Generating…';
    try { await generate(C, repQ, { source: 'on-demand' }); toast('Report generated'); }
    catch (e) { console.error(e); toast(/permission/i.test(e.message) ? 'Not saved: only Jake, Mike and Cole can publish reports' : 'Could not generate: ' + e.message); }
    renderReport();
  };
  $('rep-cust').onclick = () => openCustomize();
  if (!r) return;
  const msg = () => $('rep-msg').value;
  $('rep-copylink').onclick = () => navigator.clipboard.writeText(shareUrl(r.token)).then(() => toast('Link copied'));
  $('rep-copy').onclick = () => navigator.clipboard.writeText(msg()).then(() => toast('Message copied'));
  $('rep-savemsg').onclick = () => { const x = acctRec(C.key); x.reports[repQ].message = msg(); saveAcct(x); toast('Saved'); };
  if ($('rep-mail')) $('rep-mail').onclick = e => { e.preventDefault(); location.href = 'mailto:' + encodeURIComponent(rec.contactEmail) + '?subject=' + encodeURIComponent(C.customer + ' — ' + qLabel(repQ) + ' service summary') + '&body=' + encodeURIComponent(msg()); };
  $('rep-sent').onclick = () => { const x = acctRec(C.key); x.reports[repQ].sentAt = x.reports[repQ].sentAt ? null : isoD(TODAY); saveAcct(x); renderReport(); };
  $('rep-revoke').onclick = async () => {
    if (!confirm('Turn off the ' + qLabel(repQ) + ' link for ' + C.customer + '? Anyone who has it will no longer be able to open it.')) return;
    try { await revoke(C, repQ); toast('Link turned off'); } catch (e) { toast('Could not turn off: ' + e.message); }
    renderReport();
  };
}

// ── customize the live report (include / exclude anything) ───────────
let CU = null, RAW = null;
async function openCustomize() {
  const box = $('customize');
  box.innerHTML = '<h2>Customize ' + esc(qLabel(repQ)) + ' report</h2><div class="card panel muted">Loading every visit and photo…</div>';
  box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  CU = JSON.parse(JSON.stringify(customOf(acctRec(C.key))));
  RAW = await buildSnapshot(C, repQ, { raw: true });
  drawCustomize();
}
function drawCustomize() {
  const box = $('customize'), S = CU.show;
  const nPh = RAW.sites.reduce((t, s) => t + s.jobs.reduce((u, j) => u + j.visits.reduce((w, v) => w + v.photos.length, 0), 0), 0);
  let h = '<h2>Customize ' + esc(qLabel(repQ)) + ' report <span class="note">untick anything to leave it out; click a photo to include or exclude it. Choices are kept for future reports.</span></h2><div class="card panel cust">' +
    '<div class="cust-bar"><button class="btn primary" id="cu-save">Save &amp; update live report</button><button class="btn" id="cu-all">Include all work</button><button class="btn" id="cu-close">Close</button><span class="muted" style="font-size:.76rem">' + plural(nPh, 'photo') + ' available · BuildOps report photos are on by default</span></div>' +
    '<h3>Sections</h3><div class="cu-sec">' + Object.keys(SHOW_LABEL).map(k => '<label class="chk"><input type="checkbox" data-show="' + k + '"' + (S[k] ? ' checked' : '') + '> ' + esc(SHOW_LABEL[k]) + '</label>').join('') + '</div>' +
    '<h3>Note at the top of the report <span class="muted" style="font-weight:400;text-transform:none;letter-spacing:0">(optional, ' + esc(qLabel(repQ)) + ' only)</span></h3><textarea class="inp" id="cu-note" style="min-height:70px" placeholder="e.g. Thanks for approving the boiler work. Here is everything we did this quarter.">' + esc(CU.notes[repQ] || '') + '</textarea>';
  if (RAW.attention.length) h += '<h3>Equipment to keep an eye on</h3><div class="cu-att">' + RAW.attention.map(a => '<label class="chk"><input type="checkbox" data-att="' + esc(attKey(a)) + '"' + (CU.hide.att[attKey(a)] ? '' : ' checked') + '> <span class="badge ' + (a.condition === 'red' ? 'b-red' : 'b-amber') + '">' + esc(a.condition) + '</span> ' + esc(a.tag) + (RAW.sites.length > 1 ? ' · ' + esc(a.site) : '') + (a.note ? ' <span class="muted">' + esc(a.note) + '</span>' : '') + '</label>').join('') + '</div>';
  h += '<h3>Work <span class="muted" style="font-weight:400;text-transform:none;letter-spacing:0">' + esc(RAW.year) + ' to the end of ' + esc(qLabel(repQ)) + '; earlier quarters show in the year-to-date view</span></h3>';
  RAW.sites.forEach(s => {
    if (!s.jobs.length) return;
    h += '<div class="cu-site">' + esc(s.name) + ' <span class="muted">' + esc(s.address) + '</span></div>';
    s.jobs.forEach(j => {
      const jOff = !!CU.hide.jobs[j.key];
      h += '<div class="cu-job' + (jOff ? ' off' : '') + '"><label class="cu-jh"><input type="checkbox" data-job="' + esc(j.key) + '"' + (jOff ? '' : ' checked') + '> <span class="badge b-grey">' + esc(j.bucket === 'Jobs & projects' ? 'Project' : j.bucket === 'Service' ? 'Service call' : 'Maintenance') + '</span> <b>' + esc(j.title || j.type || 'Site visit') + '</b> <span class="muted">' + esc(j.job) + '</span></label>' +
        j.visits.map(v => {
          const vOff = !!CU.hide.visits[v.key], other = v.q !== RAW.quarter;
          return '<div class="cu-visit' + (vOff ? ' off' : '') + '"><label><input type="checkbox" data-visit="' + esc(v.key) + '"' + (vOff ? '' : ' checked') + (jOff ? ' disabled' : '') + '> <b>' + esc(fmtD(v.date)) + '</b>' + (other ? ' <span class="muted">(' + esc(qLabel(v.q)) + ')</span>' : '') + ' ' + esc(v.desc || '') + (v.summary ? ' <span class="muted">· tech summary</span>' : '') + '</label>' +
            (v.photos.length ? '<div class="cu-ph">' + v.photos.map(p => '<button type="button" class="' + (photoOn(CU, p) ? 'on' : '') + '" data-ph="' + esc(p.src) + '" title="' + esc((p.comment || p.type || 'Photo') + (p.rep ? ' · BuildOps report photo' : '')) + '"><img loading="lazy" src="' + esc(phUrl(p.src, 160)) + '" alt=""></button>').join('') + '</div>' : '') + '</div>';
        }).join('') + '</div>';
    });
  });
  if (!RAW.sites.some(s => s.jobs.length)) h += '<p class="muted">No visits this year yet.</p>';
  h += '</div>';
  box.innerHTML = h;
  box.querySelectorAll('[data-show]').forEach(i => i.onchange = () => { CU.show[i.dataset.show] = i.checked; });
  box.querySelectorAll('[data-att]').forEach(i => i.onchange = () => { if (i.checked) delete CU.hide.att[i.dataset.att]; else CU.hide.att[i.dataset.att] = true; });
  box.querySelectorAll('[data-job]').forEach(i => i.onchange = () => { if (i.checked) delete CU.hide.jobs[i.dataset.job]; else CU.hide.jobs[i.dataset.job] = true; keepNote(); drawCustomize(); });
  box.querySelectorAll('[data-visit]').forEach(i => i.onchange = () => { if (i.checked) delete CU.hide.visits[i.dataset.visit]; else CU.hide.visits[i.dataset.visit] = true; i.closest('.cu-visit').classList.toggle('off', !i.checked); });
  box.querySelectorAll('[data-ph]').forEach(b => b.onclick = () => {
    const src = b.dataset.ph, p = RAW.sites.flatMap(s => s.jobs.flatMap(j => j.visits.flatMap(v => v.photos))).find(x => x.src === src);
    const on = !photoOn(CU, p);
    if (on === (p.rep !== false)) delete CU.photos[src]; else CU.photos[src] = on;
    b.classList.toggle('on', on);
  });
  const keepNote = () => { const t = $('cu-note'); if (t) CU.notes[repQ] = t.value; };
  $('cu-note').oninput = keepNote;
  $('cu-all').onclick = () => { CU.hide.jobs = {}; CU.hide.visits = {}; keepNote(); drawCustomize(); };
  $('cu-close').onclick = () => { box.innerHTML = ''; };
  $('cu-save').onclick = async () => {
    keepNote();
    const b = $('cu-save'); b.disabled = true; b.textContent = 'Saving…';
    const r = acctRec(C.key); r.custom = CU; saveAcct(r);
    try { await generate(C, repQ, { keepMessage: true }); toast('Live report updated'); box.innerHTML = ''; }
    catch (e) { console.error(e); toast(/permission/i.test(e.message) ? 'Not saved: only Jake, Mike and Cole can publish reports' : 'Could not update: ' + e.message); b.disabled = false; b.textContent = 'Save & update live report'; }
    renderReport(); renderActivity();
  };
}

// ── automation hook (quarterly run) ──────────────────────────────────
const RUN = { running: false, done: [], errors: [], left: 0, quarter: '' };
window.apAccountReports = {
  list(q) {
    q = q || LAST_Q; const [f, t] = qRangeISO(q);
    return accounts().map(c => {
      const rec = acctRec(c.key), vis = visitsFor(c, f, t);
      return { key: c.key, customer: c.customer, tier: tierFor(c), manager: managerOf(c), agreements: activeAgreements(c).map(a => a.id), sites: c.sites.map(s => s.name),
        visits: vis.length, jobs: [...new Set(vis.map(v => v.job))], contactName: rec.contactName, contactTitle: rec.contactTitle || '', contactEmail: rec.contactEmail, contactPhone: rec.contactPhone || '', notes: rec.notes, customized: !!rec.custom, lastReport: rec.lastReport || null };
    });
  },
  // messages: { key: { message, signer } }  (message may contain {{LINK}}, replaced with the live link)
  start(q, messages, keys) {
    if (RUN.running) return 'already running';
    q = q || LAST_Q; messages = messages || {};
    const list = accounts().filter(c => !keys || keys.includes(c.key));
    Object.assign(RUN, { running: true, done: [], errors: [], left: list.length, quarter: q });
    (async () => {
      for (const c of list) {
        try {
          const m = messages[c.key] || {};
          RUN.done.push(await generate(c, q, { source: 'quarterly', signer: m.signer, message: m.message }));
        } catch (e) { RUN.errors.push({ key: c.key, error: String(e && e.message || e) }); }
        RUN.left--;
      }
      RUN.running = false;
    })();
    return 'started ' + list.length;
  },
  status() { return { running: RUN.running, left: RUN.left, done: RUN.done.length, errors: RUN.errors, quarter: RUN.quarter }; },
  // Quarterly run: every job / maintenance number with a visit at a customer site in quarter q.
  quarterJobs(q) { const [f, t] = qRangeISO(q || LAST_Q); return [...new Set(accounts().flatMap(c => visitsFor(c, f, t).map(v => detId(v.job)).filter(Boolean)))]; },
  // Weekly refresh: agreements to read contacts for in BuildOps (buildops-contacts.js).
  agreementIds() { return accounts().flatMap(c => activeAgreements(c).filter(a => a.buildopsId).map(a => ({ sa: a.id, bo: a.buildopsId, key: c.key, customer: c.customer }))); },
  // Every BuildOps job / maintenance number with a visit at a customer site in the last N days (for the job reader).
  recentJobs(days) { const from = isoD(new Date(TODAY.getTime() - (days || 14) * 86400000)); return [...new Set(accounts().flatMap(c => visitsFor(c, from, isoD(TODAY)).map(v => detId(v.job)).filter(Boolean)))]; },
  // rows: [{ key | customer, primary: {name, title, email, phone, source}, candidates: [{name, title, email, phone, source, note}] }]
  backfillContacts(rows) {
    const all = accounts(), out = { updated: 0, filled: {}, unmatched: [] };
    (rows || []).forEach(row => {
      const c = all.find(x => x.key === row.key) || all.find(x => x.key === custKey(row.customer || ''));
      if (!c) { out.unmatched.push(row.key || row.customer); return; }
      const f = backfillOne(c, row); out.updated++; if (f.length) out.filled[c.key] = f;
    });
    return out;
  },
  result() { return RUN.done.map(r => ({ key: r.key, customer: r.customer, quarter: r.quarter, url: r.url, message: r.message, stats: r.stats, attention: r.attention })); },
  // Weekly refresh Part D. lists: alpineLists compact payload {asOf, props, jobs, maint, inv} (normally handed over
  // in window.name by buildops-lists.js and saved on load). Never deletes: a smaller pull than last time is refused.
  importLists(lists) {
    const L = typeof lists === 'string' ? JSON.parse(lists) : lists, old = readJSON('ac_bo_lists');
    if (!L || !Array.isArray(L.props) || !L.props.length || !Array.isArray(L.jobs)) throw new Error('not a BuildOps list payload');
    if (old && old.props && (L.props.length < old.props.length * 0.9 || L.jobs.length < (old.jobs || []).length * 0.9)) throw new Error('refused: fewer properties/jobs than the saved pull (' + L.props.length + ' vs ' + old.props.length + ')');
    localStorage.setItem('ac_bo_lists', JSON.stringify(L)); PX = null;
    return { properties: L.props.length, jobs: L.jobs.length, maintenance: (L.maint || []).length, invoices: (L.inv || []).length };
  },
  // rows: [[docnumber, 'YYYYMMDD' | 'YYYY-MM-DD', total, balance, customer name, ship-to line 1], ...] from Windsor (QuickBooks).
  // Merges by invoice number (newer values win); BuildOps invoice numbers (2026xxxx) are skipped because BuildOps lists them.
  importQB(rows, asOf) {
    const Q = readJSON('ac_qb_inv') || { v: 2, c: [], r: [] }, by = new Map(Q.r.map(r => [r[0], r]));
    let added = 0, updated = 0;
    (rows || []).forEach(([no, d, amt, bal, cust, addr]) => {
      if (!no || /^(INV-)?2026\d{4}$/.test(no)) return;
      let ci = Q.c.indexOf(cust || ''); if (ci < 0) { Q.c.push(cust || ''); ci = Q.c.length - 1; }
      const row = [String(no), String(d || '').replace(/-/g, ''), +amt || 0, +bal || 0, ci, (addr || '') === (cust || '') ? '' : (addr || '')];
      if (by.has(row[0])) updated++; else added++;
      by.set(row[0], row);
    });
    Q.r = [...by.values()]; Q.asOf = asOf || isoD(TODAY);
    localStorage.setItem('ac_qb_inv', JSON.stringify(Q)); PX = null;
    return { added, updated, total: Q.r.length };
  },
  // Weekly Part E: jobs / finished maintenance records with no job page yet (agreement properties first, newest first).
  async backfillJobs(n) {
    await loadJobIndex();
    const out = [];
    propIndex().list.slice().sort((a, b) => (b.sa - a.sa) || (b.last || '').localeCompare(a.last || '')).forEach(p => {
      p.jobs.slice().sort((a, b) => (b.created || '').localeCompare(a.created || '')).forEach(j => { if (!jobIdx.by[j.id]) out.push(j.id); });
      p.maint.filter(m => /complete|progress|closed/i.test(m.status || '') && (m.due || '') <= isoD(TODAY)).forEach(m => { if (!jobIdx.by[m.id]) out.push(m.id); });
    });
    const ids = [...new Set(out)];
    return { ids: ids.slice(0, n || 40), left: ids.length };
  },
  // Weekly Part E: jobs with a page but never email-matched, with what to search for.
  async emailBackfill(n) {
    await loadJobIndex();
    const P = propIndex().list, rows = [];
    for (const p of P.slice().sort((a, b) => (b.sa - a.sa) || (b.last || '').localeCompare(a.last || ''))) {
      for (const j of p.jobs.concat(p.maint.map(m => ({ id: m.id, created: m.due, completed: m.due, po: '' })))) {
        if (!jobIdx.by[j.id]) continue;
        rows.push({ id: j.id, property: p.name, address: p.address, customer: p.customer, po: j.po || '', from: j.created || '', to: j.completed || j.created || '' });
      }
    }
    const out = [];
    for (const r of rows) {
      if (out.length >= (n || 40)) break;
      const c = await jobCosts(r.id);
      if (!c || !c.emailAt) out.push(r);
    }
    return out;
  },
  // Every property with its last service date, for checks and summaries.
  properties() { return propIndex().list.map(p => ({ id: p.id, name: p.name, customer: p.customer, address: p.address, sa: p.sa, qbOnly: !!p.qbOnly, first: p.first, last: p.last, jobs: p.jobs.length, maint: p.maint.length, invoices: p.inv.length, billed: Math.round(p.billed), open: Math.round(p.open) })); }
};
// Hand-off from buildops-lists.js (window.name = "ALPINELISTS:{json}").
if (typeof window.name === 'string' && window.name.startsWith('ALPINELISTS:')) {
  try { const r = window.apAccountReports.importLists(window.name.slice(12)); window.name = ''; setTimeout(() => toast('BuildOps lists saved: ' + r.properties + ' properties, ' + r.jobs + ' jobs, ' + r.invoices + ' invoices'), 300); }
  catch (e) { window.name = ''; setTimeout(() => toast('BuildOps lists not saved: ' + e.message), 300); }
}

// ── boot ─────────────────────────────────────────────────────────────
if (qp.get('c')) { ui.q = qp.get('q') || CUR_Q; renderFile(qp.get('c')); }
else if (qp.get('p')) renderProperty(qp.get('p'), qp.get('mq'));
else if (qp.get('view') === 'customers') renderCustomers();
else renderProperties();
})();
