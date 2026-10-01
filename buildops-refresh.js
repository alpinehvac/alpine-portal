// ── Alpine HVAC — weekly BuildOps refresh (read-only) ───────────────
// Run in a logged-in live.buildops.com tab (Claude in Chrome: javascript_exec).
// Reads every Active/Draft service agreement, each site (property) on them,
// the site's visit history, assets, jobs and projects, and visit details since
// Jan 1 of last year. It never clicks Save/Edit and never reads property
// instructions (they hold site credentials). Progress is kept in localStorage
// under __alpine_refresh so a crash or disconnect can resume where it stopped.
// When finished it opens the portal's refresh.html, where a person clicks Apply.
//
// Status while running:  JSON.parse(localStorage.__alpine_refresh).phase / .log
// Start over:            localStorage.removeItem('__alpine_refresh')
(() => {
if (window.__alpineRefresh) return 'already running';
window.__alpineRefresh = true;
(async () => {
const PORTAL = 'https://alpinehvac.github.io/alpine-portal/refresh.html';
const SKIP = new Set(['SA1003', 'SA1011', 'SA1012', 'SA1013', 'SA1014', 'SA1015']); // test records
const KEY = '__alpine_refresh';
const S = JSON.parse(localStorage.getItem(KEY) || 'null') || { started: Date.now(), phase: 'list', list: null, agr: {}, props: {}, detail: {}, log: [], done: false, err: null };
const save = () => localStorage.setItem(KEY, JSON.stringify(S));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SINCE = new Date(new Date().getFullYear() - 1, 0, 1);
const pad = n => String(n).padStart(2, '0');
const iso = s => { if (!s || s === '-') return ''; const d = new Date(String(s).replace(/\s+\d{1,2}:\d{2}\s*[ap]m.*$/i, '').trim()); return isNaN(d) ? '' : d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
const clean = s => (!s || s === '-') ? '' : String(s).trim();
const num = v => { const n = parseFloat(String(v || '').replace(/[^0-9.\-]/g, '')); return isNaN(n) ? null : n; };
function nav(path) { history.pushState({}, '', path); window.dispatchEvent(new PopStateEvent('popstate', { state: {} })); }
async function waitFor(fn, max) { const t0 = Date.now(); while (Date.now() - t0 < (max || 15000)) { await sleep(400); try { if (fn()) { await sleep(800); return true; } } catch (e) {} } return false; }
function field(L) {
  const els = [...document.querySelectorAll('body *')].filter(e => e.children.length === 0 && e.textContent.trim().toUpperCase() === L);
  for (const e of els) { let n = e.parentElement; for (let i = 0; i < 4 && n; i++) { const t = n.innerText.trim().split('\n').map(s => s.trim()).filter(Boolean); const k = t.findIndex(s => s.toUpperCase() === L); if (k >= 0 && t[k + 1]) return t[k + 1]; n = n.parentElement; } }
  return '';
}
const nextBtn = () => [...document.querySelectorAll('button[aria-label="Go to next page"]')].find(b => b.offsetParent && !b.disabled);
function nextIn(el) { let n = el; for (let i = 0; i < 8 && n; i++) { const b = n.querySelector && n.querySelector('button[aria-label="Go to next page"]'); if (b) return b.disabled ? null : b; n = n.parentElement; } return null; }
// Page through one table: stop at its last page, or when "next" didn't change it
// (pages have several tables and the nearest next button may belong to another one).
async function pageThrough(getRoot, collect, max) {
  for (let p = 0; p < (max || 40); p++) {
    const root = getRoot(); if (!root) return;
    collect(root);
    let n = root, pager = '';
    for (let i = 0; i < 6 && n && !pager; i++) { const m = (n.innerText || '').match(/(\d+)\s*[–-]\s*(\d+)\s+of\s+(\d+)/); if (m && n !== document.body) pager = m; n = n.parentElement; }
    if (pager && +pager[2] >= +pager[3]) return;
    const nb = nextIn(root); if (!nb) return;
    const sig = root.innerText.slice(0, 400);
    nb.click(); await sleep(2200);
    const after = getRoot(); if (!after || after.innerText.slice(0, 400) === sig) return;
  }
}
function clickTab(label) { const t = [...document.querySelectorAll('[role=tab]')].find(x => x.innerText && x.innerText.trim() === label) || [...document.querySelectorAll('button')].find(x => x.innerText && x.innerText.trim() === label && !x.closest('header,nav')); if (t) t.click(); return !!t; }
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
function bucket(event, jobType) {
  if (/maint/i.test(event || '')) return 'Maintenance';
  if (/project/i.test(event || '') || /quot|fixed|project|contract|install|bid|lump|change order|retrofit|replacement/i.test(jobType || '')) return 'Jobs & projects';
  return 'Service';
}
try {
  // 1. agreement list
  if (!S.list) {
    nav('/serviceAgreement/list');
    await waitFor(() => [...document.querySelectorAll('a')].some(a => /^SA\d+$/.test(a.textContent.trim())), 20000);
    const list = {};
    for (let p = 0; p < 10; p++) {
      [...document.querySelectorAll('[role=row]')].slice(1).forEach(r => { const a = [...r.querySelectorAll('a')].find(x => /^SA\d+$/.test(x.textContent.trim())); if (!a) return; const id = a.textContent.trim(); const status = (r.innerText.match(/\b(Active|Draft|Expired|Canceled|Cancelled)\b/) || [])[1] || ''; if (!SKIP.has(id) && /Active|Draft/.test(status)) list[id] = { bo: a.getAttribute('href').split('/').pop(), status }; });
      const nb = nextBtn(); if (!nb) break; nb.click(); await sleep(2500);
    }
    S.list = list; S.log.push('agreements: ' + Object.keys(list).length); save();
  }
  // 2. agreement pages
  S.phase = 'agreements'; save();
  for (const [sa, L] of Object.entries(S.list)) {
    if (S.agr[sa]) continue;
    nav('/serviceAgreement/view/' + L.bo);
    await waitFor(() => new RegExp('Agreement No:\\s*' + sa + '\\b').test(document.body.innerText), 20000);
    // wait for the maintenance grid itself (rows, or BuildOps' empty-table message)
    await waitFor(() => document.querySelectorAll('[role=row]').length > 1 || /No (data|rows)/i.test((document.querySelector('[role=grid]') || {}).innerText || ''), 20000);
    await sleep(1500);
    const o = { id: sa, bo: L.bo, status: L.status };
    for (const [lab, k] of [['START DATE', 'start'], ['END DATE', 'end'], ['ANNUAL CONTRACT VALUE', 'acv'], ['SOLD BY', 'soldBy'], ['PROJECT MANAGER', 'pm'], ['CUSTOMER', 'customer']]) o[k] = field(lab);
    o.name = (document.title.replace(/^BuildOps\s*-\s*/, '') || '').trim();
    const maint = {}, props = {};
    for (let p = 0; p < 10; p++) {
      [...document.querySelectorAll('[role=row]')].slice(1).forEach(r => {
        const x = [...r.querySelectorAll('[role=cell],[role=gridcell]')].map(c => c.innerText.trim().replace(/\n/g, ' '));
        const pa = r.querySelector('a[href*="/property/view/"]');
        if (pa) props[pa.getAttribute('href').split('/').pop()] = pa.innerText.trim();
        if (x[1]) maint[x[1]] = { id: x[1], due: iso(x[2]), status: x[3], property: x[4], propertyId: pa ? pa.getAttribute('href').split('/').pop() : '', type: x[6], budgetHrs: num(x[8]), visits: num(x[10]) };
      });
      const nb = nextBtn(); if (!nb) break; nb.click(); await sleep(2500);
    }
    o.maint = Object.values(maint); o.props = props;
    S.agr[sa] = o;
    Object.entries(props).forEach(([pid, name]) => { const P = S.props[pid] = S.props[pid] || { id: pid, name, sas: [], customer: o.customer }; if (!P.sas.includes(sa)) P.sas.push(sa); });
    S.log.push(sa + ': ' + o.maint.length + ' maintenance items, ' + Object.keys(props).length + ' sites'); save();
  }
  // 3. sites
  S.phase = 'sites'; save();
  for (const pid of Object.keys(S.props)) {
    const P = S.props[pid]; if (P.done) continue;
    nav('/property/view/' + pid);
    await waitFor(() => /Property:/.test(document.title) || /Property:/.test(document.body.innerText), 20000);
    await sleep(2500);
    P.address = field('PROPERTY ADDRESS');
    clickTab('Jobs & Visits'); await sleep(3500);
    const tables = () => [...document.querySelectorAll('table')];
    P.jobs = {};
    await pageThrough(() => tables().find(t => /Job Type/.test(t.innerText) && /Issue Description/.test(t.innerText)), tb => {
      const hdr = [...tb.querySelectorAll('tr')[0].children].map(h => h.innerText.trim());
      [...tb.querySelectorAll('tr')].slice(1).forEach(r => { const c = [...r.children].map(x => x.innerText.trim().replace(/\n/g, ' ')); const row = {}; hdr.forEach((h, i) => row[h] = c[i]); if (row.Job) P.jobs[row.Job] = { type: row['Job Type'], status: row.Status, title: row['Issue Description'], created: row['Created On'] }; });
    }, 15);
    const seenV = new Set(); P.visits = [];
    await pageThrough(() => tables().filter(t => /Event type/i.test(t.innerText) && !/No (upcoming|past) visits/i.test(t.innerText)).pop(), tb => {
      [...tb.querySelectorAll('tr')].slice(1).forEach(r => { const c = [...r.children].map(x => x.innerText.trim().replace(/\n/g, ' ')); const a = r.querySelector('a'); const sig = c.join('|'); if (c.length >= 5 && c[1] && !seenV.has(sig)) { seenV.add(sig); P.visits.push({ event: c[0], job: c[1], href: a ? a.getAttribute('href') : '', status: c[2], date: c[3], desc: c[4], assigned: c[5] || '' }); } });
    }, 40);
    save();
    clickTab('Assets'); await sleep(3500);
    const assets = {};
    await pageThrough(() => document.querySelector('[role=grid]') || (document.querySelector('[role=row]') || {}).parentElement, () => {
      const rows = [...document.querySelectorAll('[role=row]')]; if (rows.length < 2) return;
      const hdr = [...rows[0].querySelectorAll('[role=columnheader]')].map(c => c.innerText.trim());
      rows.slice(1).forEach(r => { const c = [...r.querySelectorAll('[role=cell],[role=gridcell]')].map(x => x.innerText.trim()); const row = {}; hdr.forEach((h, i) => row[h] = c[i]); if (row.Asset) assets[row.Asset] = { tag: row.Asset, make: clean(row.Make), model: clean(row['Model No']), serial: clean(row['Serial No']), installDate: iso(row['Install Date']), location: clean(row.Location), type: clean(row['Asset Type']) }; });
    }, 15);
    P.assets = Object.values(assets);
    if (clickTab('Projects')) { await sleep(3000); P.projects = [...document.querySelectorAll('[role=row]')].slice(1).map(r => [...r.querySelectorAll('[role=cell],[role=gridcell]')].map(x => x.innerText.trim().replace(/\n/g, ' ')).filter(Boolean).join(' | ')).filter(Boolean).slice(0, 25); }
    P.done = true;
    S.log.push('site ' + P.name + ': ' + P.visits.length + ' visits, ' + P.assets.length + ' assets'); save();
  }
  // 4. visit details
  S.phase = 'details'; save();
  const targets = new Set();
  Object.values(S.props).forEach(P => (P.visits || []).forEach(v => { const d = new Date(v.date); if (!isNaN(d) && d >= SINCE && v.href) targets.add(v.href); }));
  for (const href of targets) {
    if (S.detail[href]) continue;
    const key = href.split('/').pop();
    nav(href);
    await waitFor(() => document.body.innerText.includes(key) && /Visit #\d+/.test(document.body.innerText), 15000);
    await sleep(1200);
    const saBo = [...document.querySelectorAll('a[href*="/serviceAgreement/view/"]')].map(a => a.getAttribute('href').split('/').pop())[0] || '';
    S.detail[href] = { saBo, type: field('JOB TYPE') || field('MAINTENANCE TYPE'), visits: parseVisits() };
    save();
  }
  // 5. build the payload
  S.phase = 'payload'; save();
  const today = iso(new Date().toDateString());
  const boToSa = {}; Object.values(S.agr).forEach(o => boToSa[o.bo] = o.id);
  const sites = Object.values(S.props).map(P => {
    const used = new Set();
    const visits = (P.visits || []).filter(v => { const d = new Date(v.date); return !isNaN(d) && d >= SINCE; }).map(v => {
      const det = S.detail[v.href] || { visits: [] };
      const date = iso(v.date);
      const dv = det.visits.find((x, i) => !used.has(v.href + i) && iso(x.date) === date && used.add(v.href + i));
      const jm = P.jobs[v.job] || {};
      const jobType = jm.type || det.type || '';
      return { date, bucket: bucket(v.event, jobType), job: v.job, url: v.href, title: clean(jm.title) || clean(det.type), jobType, jobStatus: jm.status || '', status: v.status,
        desc: clean(dv && dv.desc) || clean(v.desc), tech: clean(dv && dv.tech) || clean(v.assigned), others: clean(dv && dv.others), assets: clean(dv && dv.assets), sa: boToSa[det.saBo] || '' };
    }).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    return { id: P.id, name: P.name, address: P.address || '', customer: clean(P.customer).replace(/^\*+/, ''), sas: P.sas, assets: P.assets || [], projects: P.projects || [], visits };
  });
  // jobs per agreement (service + projects), from site visits
  const jobsBySa = {};
  sites.forEach(s => {
    const byJob = {};
    s.visits.filter(v => v.bucket !== 'Maintenance').forEach(v => {
      const j = byJob[v.job] = byJob[v.job] || { id: v.job, url: v.url, kind: v.bucket === 'Jobs & projects' ? 'Project' : 'Service', type: v.jobType, title: v.title, status: v.jobStatus, property: s.name, created: '', visits: [], sa: v.sa };
      j.visits.push({ date: v.date, status: v.status, tech: v.tech, others: v.others, desc: v.desc, assets: v.assets });
    });
    Object.values(byJob).forEach(j => { const targetsSa = j.sa ? [j.sa] : s.sas; targetsSa.forEach(sa => (jobsBySa[sa] = jobsBySa[sa] || []).push(j)); });
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
  const payload = { syncedAt: today, agreements, siteItems: Object.values(S.agr).flatMap(o => o.maint.map(m => ({ id: m.id, status: m.status, due: m.due }))), srJobs, sites };
  S.phase = 'done'; S.done = true; S.finished = Date.now(); save();
  window.name = 'ALPINEREFRESH:' + JSON.stringify(payload);
  localStorage.removeItem(KEY);
  location.href = PORTAL;
} catch (e) { S.err = String(e && e.stack || e); save(); }
window.__alpineRefresh = false;
})();
return 'started';
})()
