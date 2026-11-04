// ── Alpine HVAC — Site page ─────────────────────────────────────────
// site.html?p=<BuildOps property id>&q=2026-Q3
// Activity: every visit at this address for the quarter, in three buckets
//           (Maintenance / Service / Jobs & projects), pulled from BuildOps.
// CLEAR report: live asset-by-asset condition (red / yellow / green). There is one running
//           report per site. The account manager changes colours and adds notes any time;
//           new BuildOps assets and visit notes are merged in as suggestions when the page opens.
//           Quarter snapshots freeze it for the quarterly review (sent / reviewed tracking).
//           Printable to PDF, plus an optional customer link (clear-report.html?t=<token>).
// Firestore collection site_data:
//   st_site_<pid>          site, assets, visits (refreshed weekly from BuildOps)
//   st_clearlive_<pid>     the live CLEAR report (rows, key findings, change history)
//   st_clear_<pid>_<qtr>   frozen quarter snapshot of the live report
//   st_clearbase_<pid>     baseline from a SharePoint CLEAR file or a Building Performance Audit
// account_share/<token> holds the customer's copy: only the colours, customer notes and key findings.

(function () {
'use strict';
const BO = 'https://live.buildops.com';
const session = (typeof apGetSession === 'function' && apGetSession()) || { name: 'Unknown' };
const TODAY = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const QM = ['Jan–Mar', 'Apr–Jun', 'Jul–Sep', 'Oct–Dec'];
const qp = new URLSearchParams(location.search);
const pid = qp.get('p') || '';
const $ = id => document.getElementById(id);
let view = qp.get('view') === 'clear' ? 'clear' : 'activity';
let quarter = qp.get('q') || '';

// Equipment catalog: matched against the BuildOps asset type (first match wins).
// img = photo already in the portal repo; life = expected service life in years.
const CATALOG = [
  [/rooftop|\brtu\b/i, 'rtu-large.jpg', 20, 'Packaged rooftop unit that heats, cools and ventilates the space below it.'],
  [/make.?up|\bmua\b/i, 'mua.jpg', 20, 'Make-up air unit that brings in and tempers fresh outdoor air to replace exhausted air.'],
  [/\berv\b|\bhrv\b|energy recovery|heat recovery/i, 'erv-light-commercial.jpg', 20, 'Energy recovery ventilator that brings in fresh air and recovers heat from exhaust air.'],
  [/chiller/i, 'chiller-air-cooled.jpg', 23, 'Chiller that produces chilled water for building cooling.'],
  [/cooling tower/i, 'cooling-tower-small-medium.jpg', 20, 'Cooling tower that rejects heat from the building cooling system.'],
  [/boiler/i, 'boiler-commercial-medium.jpg', 25, 'Boiler that produces hot water for building heating.'],
  [/furnace/i, 'furnace.jpg', 18, 'Gas furnace that heats air and distributes it through ductwork.'],
  [/ductless|mini.?split|split/i, 'ductless-split.jpg', 15, 'Ductless split system: indoor head with an outdoor condenser for heating and cooling.'],
  [/condenser/i, 'heat-pump.jpg', 20, 'Outdoor condenser unit that serves the indoor fan coils.'],
  [/heat pump/i, 'heat-pump.jpg', 15, 'Heat pump that moves heat in or out of the space for heating and cooling.'],
  [/fan coil|\bfcu\b/i, 'fcu.jpg', 20, 'Fan coil unit that heats or cools a room using building hot or chilled water.'],
  [/tube heater|radiant/i, 'tube-heater.jpg', 20, 'Gas-fired radiant tube heater that warms people and surfaces below it.'],
  [/unit heater/i, 'unit-heater.jpg', 20, 'Suspended unit heater that warms open areas like shops and warehouses.'],
  [/vestibule|cabinet heater/i, 'vestibule-heater.jpg', 20, 'Entrance heater that keeps vestibules and doorways warm.'],
  [/electric heat|baseboard/i, 'electric-heater.jpg', 15, 'Electric heater for spot or supplemental heating.'],
  [/water heater|hot water|\bhwt\b|tank/i, 'hot-water-tank.jpg', 15, 'Domestic hot water heater supplying taps and fixtures.'],
  [/exhaust/i, 'exhaust-fan.jpg', 15, 'Exhaust fan that removes stale or contaminated air from the building.'],
  [/fan/i, 'fan.jpg', 15, 'Fan that moves air for ventilation or circulation.'],
  [/glycol/i, 'glycol-pump.jpg', 20, 'Glycol pump that circulates freeze-protected fluid through the system.'],
  [/pump/i, 'pump-small-medium.jpg', 20, 'Circulating pump that moves water through the heating or cooling system.'],
  [/damper/i, 'damper.jpg', 20, 'Damper that opens and closes to control airflow in the ductwork.'],
  [/valve/i, 'valve.jpg', 20, 'Control valve that regulates water flow to heating or cooling equipment.'],
  [/dehumid/i, 'dehumidifier.jpg', 10, 'Dehumidifier that removes moisture from the air.'],
  [/humidifier/i, 'humidifier.jpg', 10, 'Humidifier that adds moisture to dry winter air.'],
  [/compressor/i, 'air-compressor.jpg', 15, 'Air compressor supplying compressed air to controls or equipment.'],
  [/water treat|filtration|filter/i, 'water-filtration.jpg', 10, 'Water treatment and filtration that protects the system from scale and corrosion.']
];
function catalog(type, tag) {
  const s = (type || '') + ' ' + (tag || '');
  for (const [re, img, life, desc] of CATALOG) if (re.test(s)) return { img: 'images/' + img, life, desc };
  return { img: '', life: 20, desc: '' };
}

// ── helpers ──────────────────────────────────────────────────────────
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function parseD(s) { if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null; const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function isoD(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function fmtD(s) { const d = parseD(s); return d ? MONTHS[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear() : '—'; }
function qOf(iso) { const d = parseD(iso); return d ? d.getFullYear() + '-Q' + (Math.floor(d.getMonth() / 3) + 1) : ''; }
function qLabel(q) { const [y, n] = q.split('-Q'); return 'Q' + n + ' ' + y + ' (' + QM[n - 1] + ')'; }
function prevQ(q) { let [y, n] = q.split('-Q').map(Number); n--; if (!n) { n = 4; y--; } return y + '-Q' + n; }
function readJSON(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
function custName(c) { return String(c || '').replace(/^\*+/, '').trim(); }
let toastT; function toast(m) { const t = $('toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 3200); }
function fmtStamp(ms) { if (!ms) return '—'; const d = new Date(ms); return MONTHS[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear() + ' at ' + d.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' }); }
function ageYears(iso) { const d = parseD(iso); return d ? (TODAY - d) / (365.25 * 86400000) : null; }

const siteKey = () => 'st_site_' + pid;
const clearKey = q => 'st_clear_' + pid + '_' + q;
const liveKey = () => 'st_clearlive_' + pid;
const REVIEW_DAYS = 30;      // a live report older than this shows "Review due"
const MAX_HISTORY = 200;
const FS_URL = 'https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js';
const canShare = () => (session.roles || []).some(x => x === 'owner' || x === 'field_ops'); // account_share write rule
function site() { return readJSON(siteKey()); }

// ── CLEAR report model ───────────────────────────────────────────────
// Keyword rules used only to SUGGEST a colour from visit notes; the account manager decides.
const RED_RE = /not operational|not operating|inoperable|offline|out of refrigerant|major leak|locked out|seized|failed|cracked heat exchanger|no heat|no cooling|unsafe|shut down|requires replacement|needs replacement/i;
const YEL_RE = /requires (future )?repair|future repair|monitor|worn|low (on )?(refrigerant|charge)|slight|recommend|suspect|minor|leak|replace (soon|filter)|noisy|vibration|corrosion|rust/i;

function suggestions(s, test) {
  // Visit text per asset tag for the visits that pass test(visit).
  const byTag = {};
  (s.visits || []).filter(test).forEach(v => {
    const tags = String(v.assets || '').split(',').map(x => x.trim()).filter(x => x && x !== '-');
    const text = [v.title, v.desc].filter(Boolean).filter((x, i, a) => a.findIndex(y => y.toLowerCase() === x.toLowerCase()) === i).join(' — ');
    tags.forEach(t => (byTag[t] = byTag[t] || []).push({ date: v.date, text, bucket: v.bucket }));
  });
  return byTag;
}
function newRow(a, prior) {
  const cat = catalog(a.type, a.tag);
  return {
    tag: a.tag, type: a.type || (prior && prior.type) || '', make: a.make || (prior && prior.make) || '', model: a.model || (prior && prior.model) || '',
    serial: a.serial || (prior && prior.serial) || '', installDate: toIso(a.installDate) || (prior && prior.installDate) || '', location: a.location || (prior && prior.location) || '',
    life: (prior && prior.life) || cat.life, desc: (prior && prior.desc) || cat.desc,
    condition: (prior && prior.condition) || 'green', notes: (prior && prior.notes) || '', internal: (prior && prior.internal) || '',
    include: prior ? prior.include !== false : !/damper|valve/i.test(a.type || ''), auto: false
  };
}
function latestVisit(s) { return (s.visits || []).map(v => v.date || '').sort().pop() || ''; }
function latestSnapshot() {
  let best = '';
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith('st_clear_' + pid + '_') && k > best) best = k; }
  return best ? readJSON(best) : null;
}
// First build: starts from the latest quarter report, else the baseline (SharePoint file or audit), else BuildOps.
function buildLive() {
  const s = site();
  const prev = latestSnapshot(), base = readJSON('st_clearbase_' + pid);
  const seed = prev || base;
  const seedRows = new Map(((seed && seed.rows) || []).map(r => [r.tag.toLowerCase(), r]));
  const yearAgo = isoD(new Date(TODAY.getFullYear() - 1, TODAY.getMonth(), TODAY.getDate()));
  const sug = suggestions(s, v => (v.date || '') >= yearAgo);
  const tags = new Set(), rows = [];
  (s.assets || []).forEach(a => {
    tags.add(a.tag.toLowerCase());
    const r = newRow(a, seedRows.get(a.tag.toLowerCase()));
    applySuggestion(r, sug[a.tag]);
    rows.push(r);
  });
  // Keep assets that exist only in the seed report (e.g. imported from SharePoint or an audit).
  ((seed && seed.rows) || []).forEach(p => { if (!tags.has(p.tag.toLowerCase())) { const r = { ...p, auto: false }; applySuggestion(r, sug[p.tag]); rows.push(r); } });
  rows.sort(byTag);
  return { pid, rows, summary: (seed && seed.summary) || '', createdAt: isoD(TODAY), createdBy: session.name, source: prev ? 'Last quarter report' : base ? (base.source || 'Imported baseline') : 'BuildOps asset list',
    visitsThru: latestVisit(s), reviewedAt: null, reviewedBy: '', history: [], unpublished: 0, share: null };
}
function byTag(a, b) { return a.tag.localeCompare(b.tag, undefined, { numeric: true }); }
// Brings a live report up to date with the latest BuildOps pull. Colours are only ever raised, and stay flagged
// as suggestions until someone confirms them. Notes and colours people set are never replaced.
function syncLive(r) {
  const s = site(); if (!s) return r;
  const tags = new Set(r.rows.map(x => x.tag.toLowerCase()));
  let changed = false;
  (s.assets || []).forEach(a => { if (!tags.has(a.tag.toLowerCase())) { r.rows.push(newRow(a)); logChange(r, { tag: a.tag, text: 'Added from BuildOps', by: 'BuildOps' }); changed = true; } });
  const thru = r.visitsThru || '';
  const latest = latestVisit(s);
  if (latest > thru) {
    const sug = suggestions(s, v => (v.date || '') > thru);
    r.rows.forEach(x => {
      if (!sug[x.tag]) return;
      const was = x.condition, n = x.notes;
      applySuggestion(x, sug[x.tag]);
      if (x.condition !== was || x.notes !== n) logChange(r, { tag: x.tag, from: was !== x.condition ? was : '', to: was !== x.condition ? x.condition : '', text: 'Visit notes added from BuildOps', by: 'BuildOps' });
    });
    r.visitsThru = latest; changed = true;
  }
  if (changed) { r.rows.sort(byTag); persistLive(r); }
  return r;
}
function logChange(r, c) { (r.history = r.history || []).unshift({ at: Date.now(), by: session.name, ...c }); r.history.length = Math.min(r.history.length, MAX_HISTORY); r.unpublished = (r.unpublished || 0) + 1; }
function persistLive(r) { r.updatedAt = Date.now(); r.updatedBy = session.name; localStorage.setItem(liveKey(), JSON.stringify(r)); }
function applySuggestion(r, hits) {
  if (!hits || !hits.length) return;
  const sorted = hits.slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  // Quote the visit that drives the colour (worst finding), otherwise the latest visit.
  const pick = sorted.find(h => RED_RE.test(h.text)) || sorted.find(h => YEL_RE.test(h.text)) || sorted[0];
  const lvl = RED_RE.test(pick.text) ? 'red' : YEL_RE.test(pick.text) ? 'yellow' : null;
  if (lvl && rank(lvl) > rank(r.condition)) { r.condition = lvl; r.auto = true; }
  const line = fmtD(pick.date) + ': ' + pick.text;
  if (!r.notes.includes(pick.text)) r.notes = (r.notes ? r.notes + '\n' : '') + line;
}
function rank(c) { return c === 'red' ? 2 : c === 'yellow' ? 1 : 0; }
function toIso(v) { if (!v) return ''; if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v; const d = new Date(v); return isNaN(d) ? '' : isoD(d); }

function getLive() { const r = readJSON(liveKey()); return r ? syncLive(r) : null; }
function getSnapshot(q) { return readJSON(clearKey(q)); }
function saveSnapshot(r) { r.updatedAt = Date.now(); r.updatedBy = session.name; localStorage.setItem(clearKey(r.quarter), JSON.stringify(r)); }
function reviewAge(r) { const d = parseD(r.reviewedAt); return d ? Math.floor((TODAY - d) / 86400000) : null; }

// ── render ───────────────────────────────────────────────────────────
function render() {
  const s = site();
  if (!s) { $('main').innerHTML = '<p class="empty">This site hasn\'t been pulled from BuildOps yet. <a href="site-reports.html">Back to Site Reports</a></p>'; return; }
  document.title = 'Alpine HVAC — ' + s.name;
  $('lnk-bo').href = BO + '/property/view/' + pid;
  const qs = new Set([qOf(isoD(TODAY)), prevQ(qOf(isoD(TODAY)))]);
  (s.visits || []).forEach(v => { const q = qOf(v.date); if (q) qs.add(q); });
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith('st_clear_' + pid + '_')) qs.add(k.split('_').pop()); }
  const list = [...qs].filter(Boolean).sort().reverse();
  // Default to last completed quarter (the one the account manager reviews), else the latest with visits.
  if (!quarter || !list.includes(quarter)) {
    const lastQ = prevQ(qOf(isoD(TODAY)));
    quarter = (s.visits || []).some(v => qOf(v.date) === lastQ) ? lastQ : (list.find(q => (s.visits || []).some(v => qOf(v.date) === q)) || lastQ);
  }
  $('pick-q').innerHTML = list.map(q => '<option value="' + q + '"' + (q === quarter ? ' selected' : '') + '>' + qLabel(q) + '</option>').join('');
  document.querySelectorAll('.seg button').forEach(b => b.classList.toggle('on', b.dataset.view === view));
  const head = '<div class="kicker">' + esc(custName(s.customer)) + ' · ' + (s.sas || []).map(sa => '<a href="agreement.html?id=' + esc(sa) + '">' + esc(sa) + '</a>').join(', ') + '</div>' +
    '<h1>' + esc(s.name) + '</h1><div class="sub">' + esc(s.address || '') + ' · BuildOps pulled ' + esc(fmtD(s.syncedAt)) + '</div>';
  $('main').innerHTML = head + (view === 'clear' ? clearHTML(s) : activityHTML(s));
}

function activityHTML(s) {
  const vis = (s.visits || []).filter(v => qOf(v.date) === quarter);
  const buckets = { Maintenance: [], Service: [], 'Jobs & projects': [] };
  const byJob = new Map();
  vis.forEach(v => {
    const onMaint = v.loggedOnMaintenance && v.bucket !== 'Maintenance';
    const k = v.bucket + '|' + v.job + (onMaint ? '|' + v.date + '|' + v.desc : '');
    if (!byJob.has(k)) byJob.set(k, { bucket: v.bucket, job: v.job, url: v.url, title: onMaint ? v.desc : v.title, jobType: onMaint ? 'Logged on maintenance record ' + v.job : v.jobType, status: onMaint ? '' : v.jobStatus, visits: [] });
    byJob.get(k).visits.push(v);
  });
  byJob.forEach(j => { j.visits.sort((a, b) => (a.date || '').localeCompare(b.date || '')); (buckets[j.bucket] || buckets.Service).push(j); });
  const n = k => buckets[k].reduce((t, j) => t + j.visits.length, 0);
  const techs = new Set(vis.flatMap(v => [v.tech, ...String(v.others || '').split(',')].map(x => (x || '').trim()).filter(x => x && x !== '-')));
  let h = '<div class="counts">' +
    '<div><b>' + n('Maintenance') + '</b><span>maintenance visits</span></div>' +
    '<div><b>' + buckets.Service.length + '</b><span>service calls · ' + n('Service') + ' visits</span></div>' +
    '<div><b>' + buckets['Jobs & projects'].length + '</b><span>jobs & projects · ' + n('Jobs & projects') + ' visits</span></div>' +
    '<div><b>' + techs.size + '</b><span>technicians on site</span></div></div>';
  Object.entries(buckets).forEach(([name, jobs]) => {
    h += '<h2>' + name + ' <span class="note">' + qLabel(quarter) + '</span></h2><div class="bucket">';
    if (!jobs.length) h += '<p class="empty">No ' + name.toLowerCase() + ' this quarter.</p>';
    jobs.forEach(j => {
      const url = j.url ? BO + j.url : '';
      h += '<div class="job"><div class="job-top">' + (url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(j.job) + ' ↗</a>' : '<b>' + esc(j.job) + '</b>') +
        (j.jobType ? '<span class="muted">' + esc(j.jobType) + '</span>' : '') + (j.status ? '<span class="badge ' + (/open|progress|scheduled/i.test(j.status) ? 'b-amber' : 'b-grey') + '">' + esc(j.status) + '</span>' : '') +
        (url ? '<a class="muted" style="font-family:Inter;font-size:.74rem" href="' + esc(url + '?tab=forms-attachments') + '" target="_blank" rel="noopener">Photos &amp; forms ↗</a>' : '') + '</div>' +
        (j.title ? '<div class="job-title">' + esc(j.title) + '</div>' : '') +
        '<ul class="visits">' + j.visits.map(v => '<li><b>' + esc(fmtD(v.date)) + '</b><span>' + esc([v.tech, v.others].filter(x => x && x !== '-').join(' + ')) +
          (v.desc && v.desc !== j.title ? ' · ' + esc(v.desc) : '') + (v.assets && v.assets !== '-' ? '<br><span class="eq">Equipment: ' + esc(v.assets) + '</span>' : '') + '</span></li>').join('') + '</ul></div>';
    });
    h += '</div>';
  });
  return h;
}

function clearHTML(s) {
  const r = getLive();
  if (!r) {
    return '<div class="clear-bar"><div><b>No live CLEAR report for this site yet.</b><div class="muted" style="font-size:.8rem">Starts from ' +
      (latestSnapshot() ? 'the last quarter report' : readJSON('st_clearbase_' + pid) ? 'the imported baseline' : 'the BuildOps asset list') +
      ', then suggests colours from the last 12 months of visit notes. You review and adjust before anything reaches the customer.</div></div><span class="spacer"></span><button class="btn primary" data-act="create">Start CLEAR report</button></div>';
  }
  const inc = r.rows.filter(x => x.include);
  const cnt = c => inc.filter(x => x.condition === c).length;
  const autoN = r.rows.filter(x => x.auto).length;
  const age = reviewAge(r), due = age == null || age > REVIEW_DAYS;
  let h = '<div class="clear-bar">' +
    '<div class="rygsum"><span class="badge b-red">' + cnt('red') + ' red</span><span class="badge b-amber">' + cnt('yellow') + ' yellow</span><span class="badge b-green">' + cnt('green') + ' green</span></div>' +
    '<span class="muted" style="font-size:.76rem">' + inc.length + ' of ' + r.rows.length + ' assets on the report · updated ' + esc(fmtStamp(r.updatedAt)) + (r.updatedBy ? ' by ' + esc(r.updatedBy) : '') + (autoN ? ' · ' + autoN + ' colour' + (autoN > 1 ? 's' : '') + ' to confirm' : '') + '</span>' +
    '<span class="spacer"></span>' +
    '<span class="badge ' + (due ? 'b-amber' : 'b-green') + '">' + (age == null ? 'Not reviewed yet' : due ? 'Review due · ' + age + ' days' : 'Reviewed ' + esc(fmtD(r.reviewedAt)) + (r.reviewedBy ? ' · ' + esc(r.reviewedBy) : '')) + '</span>' +
    '<button class="btn" data-act="review">Mark reviewed today</button>' +
    '<button class="btn primary" data-act="pdf">Download PDF</button></div>' +
    shareHTML(r) +
    '<h2>Key findings <span class="note">Site-wide notes at the top of the customer report (optional)</span></h2>' +
    '<textarea class="inp" id="clear-summary" style="width:100%;min-height:80px" placeholder="e.g. One RTU found with a cracked heat exchanger; replacement quote to follow.">' + esc(r.summary || '') + '</textarea>';
  ['red', 'yellow', 'green'].forEach(c => {
    const rows = r.rows.map((x, i) => ({ x, i })).filter(o => o.x.condition === c);
    if (!rows.length) return;
    h += '<h2>' + (c === 'red' ? 'Red: needs attention now' : c === 'yellow' ? 'Yellow: monitor / plan repair' : 'Green: good condition') + ' <span class="note">' + rows.length + '</span></h2>';
    rows.forEach(({ x, i }) => { h += assetHTML(x, i); });
  });
  return h + quarterHTML(r) + historyHTML(r);
}
function shareHTML(r) {
  if (!canShare()) return '';
  const url = r.share ? clearUrl(r.share.token) : '';
  const pending = r.unpublished || 0;
  return '<div class="clear-bar share"><div><b>Customer link</b><div class="muted" style="font-size:.78rem">' +
    (r.share ? 'Live since ' + esc(fmtD(r.share.firstAt)) + '. Last published ' + esc(fmtStamp(r.share.at)) + (pending ? ' · <b class="wait">' + pending + ' change' + (pending > 1 ? 's' : '') + ' not on the link yet</b>' : ' · up to date') : 'Not shared. Publishing creates a private link showing colours, customer notes and key findings only.') +
    '</div></div><span class="spacer"></span>' +
    (r.share ? '<input class="inp linkbox" id="clear-link" readonly value="' + esc(url) + '" aria-label="Customer link"><button class="btn" data-act="copy">Copy link</button><a class="btn" href="' + esc(url) + '" target="_blank" rel="noopener">Open ↗</a><button class="btn" data-act="unshare">Turn off</button>' : '') +
    '<button class="btn primary" data-act="publish"' + (r.share && !pending ? ' disabled' : '') + '>' + (r.share ? 'Publish changes' : 'Create customer link') + '</button></div>';
}
function quarterHTML(r) {
  const cur = getSnapshot(quarter);
  const cnt = (x, c) => x.rows.filter(a => a.include && a.condition === c).length;
  return '<h2>Quarter snapshot <span class="note">Freezes today\'s colours and notes for the quarterly review</span></h2>' +
    '<div class="clear-bar"><div><b>' + esc(qLabel(quarter)) + '</b><div class="muted" style="font-size:.78rem">' +
    (cur ? 'Saved ' + esc(fmtD(cur.createdAt)) + (cur.createdBy ? ' by ' + esc(cur.createdBy) : '') + ' · ' + cnt(cur, 'red') + ' red · ' + cnt(cur, 'yellow') + ' yellow · ' + cnt(cur, 'green') + ' green' : 'No snapshot saved for this quarter') +
    '</div></div><span class="spacer"></span>' +
    (cur ? chk('sent', 'Sent to customer', cur.sent) + chk('reviewed', 'Reviewed with customer', cur.reviewed) + '<button class="btn" data-act="pdf-q">Snapshot PDF</button>' : '') +
    '<button class="btn" data-act="snapshot">' + (cur ? 'Replace snapshot' : 'Save snapshot') + '</button></div>';
}
function historyHTML(r) {
  const log = (r.history || []).slice(0, 40);
  if (!log.length) return '';
  const lab = { red: 'Red', yellow: 'Yellow', green: 'Green' };
  return '<details class="hist"><summary>Change history <span class="note">' + (r.history || []).length + '</span></summary><ul>' +
    log.map(c => '<li><span class="when">' + esc(fmtStamp(c.at)) + '</span><span><b>' + esc(c.tag || 'Report') + '</b>' + (c.to ? ' ' + esc(lab[c.from] || c.from || '') + ' → ' + esc(lab[c.to] || c.to) : '') + (c.text ? ' · ' + esc(c.text) : '') + '</span><span class="muted">' + esc(c.by || '') + '</span></li>').join('') +
    '</ul></details>';
}
function chk(k, label, v) {
  return '<label class="chk' + (v ? ' on' : '') + '"><input type="checkbox" data-act="flag" data-k="' + k + '"' + (v ? ' checked' : '') + '> ' + label +
    (v ? ' <small>' + esc(fmtD(v.at)) + ' · ' + esc(v.by) + '</small>' : '') + '</label>';
}
function assetHTML(x, i) {
  const cat = catalog(x.type, x.tag);
  const age = ageYears(x.installDate);
  const remain = age == null ? null : Math.max(0, x.life - age);
  return '<div class="asset ' + x.condition + (x.include ? '' : ' off') + '">' +
    (cat.img ? '<img src="' + esc(cat.img) + '" alt="' + esc(x.type || 'Equipment') + '" loading="lazy">' : '<div style="width:88px;height:88px;border-radius:6px;background:#222"></div>') +
    '<div><div class="a-tag">' + esc(x.tag) + ' <span class="a-meta">' + esc(x.type || '') + '</span>' + (x.auto ? ' <span class="auto">· colour suggested from visit notes: confirm it</span>' : '') + '</div>' +
    '<div class="a-meta">' + esc([x.make, x.model && 'Model ' + x.model, x.serial && 'S/N ' + x.serial].filter(Boolean).join(' · ') || 'No make/model on file') +
      (x.installDate ? ' · Installed ' + esc(fmtD(x.installDate)) : '') + (remain != null ? ' · ~' + remain.toFixed(1) + ' yrs life remaining' : '') + '</div>' +
    '<div class="a-desc">' + esc(x.desc || cat.desc) + '</div>' +
    '<textarea class="inp" data-act="notes" data-i="' + i + '" aria-label="Customer notes for ' + esc(x.tag) + '" placeholder="Condition notes the customer sees">' + esc(x.notes) + '</textarea>' +
    '<div class="addnote"><input class="inp" data-note="' + i + '" aria-label="New note for ' + esc(x.tag) + '" placeholder="Add a dated note"><button class="btn sm" data-act="addnote" data-i="' + i + '">Add note</button></div>' +
    '<textarea class="inp internal" data-act="internal" data-i="' + i + '" aria-label="Internal note for ' + esc(x.tag) + '" placeholder="Internal note (never shown to the customer)">' + esc(x.internal || '') + '</textarea>' +
    (x.changedAt ? '<div class="a-meta" style="margin-top:.25rem">Colour last set ' + esc(fmtStamp(x.changedAt)) + (x.changedBy ? ' by ' + esc(x.changedBy) : '') + '</div>' : '') + '</div>' +
    '<div class="a-side"><div class="ryg"><button class="g' + (x.condition === 'green' ? ' on' : '') + '" data-act="cond" data-i="' + i + '" data-c="green">Green</button>' +
      '<button class="y' + (x.condition === 'yellow' ? ' on' : '') + '" data-act="cond" data-i="' + i + '" data-c="yellow">Yellow</button>' +
      '<button class="r' + (x.condition === 'red' ? ' on' : '') + '" data-act="cond" data-i="' + i + '" data-c="red">Red</button></div>' +
    (x.auto ? '<button class="btn sm" data-act="confirm" data-i="' + i + '">Confirm ' + esc(x.condition) + '</button>' : '') +
    '<label>Expected life (yrs) <input class="inp" type="number" min="1" max="50" data-act="life" data-i="' + i + '" value="' + esc(x.life) + '"></label>' +
    '<label><input type="checkbox" data-act="include" data-i="' + i + '"' + (x.include ? ' checked' : '') + '> Include on customer report</label></div></div>';
}

// ── PDF ──────────────────────────────────────────────────────────────
function printReport(r) {
  const s = site(); if (!r) return;
  const inc = r.rows.filter(x => x.include);
  const cnt = c => inc.filter(x => x.condition === c).length;
  const card = x => { const cat = catalog(x.type, x.tag); const age = ageYears(x.installDate); const remain = age == null ? null : Math.max(0, x.life - age);
    return '<div class="pr-card ' + x.condition + '">' + (cat.img ? '<img src="' + esc(cat.img) + '" alt="">' : '<div></div>') +
      '<div><div class="t">' + esc(x.tag) + '<span class="pr-pill ' + x.condition + '">' + x.condition.toUpperCase() + '</span></div>' +
      '<div class="m">' + esc([x.type, x.make, x.model && 'Model ' + x.model].filter(Boolean).join(' · ')) + (remain != null ? ' · ~' + remain.toFixed(0) + ' yrs remaining' : '') + '</div>' +
      '<div class="m">' + esc(x.desc || cat.desc) + '</div>' + (x.notes ? '<div class="n">' + esc(x.notes).replace(/\n/g, '<br>') + '</div>' : '') + '</div></div>'; };
  const sec = (c, title) => { const rows = inc.filter(x => x.condition === c); return rows.length ? '<div class="pr-h">' + title + '</div><div class="pr-grid">' + rows.map(card).join('') + '</div>' : ''; };
  const label = r.quarter ? qLabel(r.quarter) : 'Current condition';
  $('print-root').innerHTML =
    '<div class="pr-top"><img src="images/alpine-logo-white.png" alt="Alpine HVAC Service"><div class="pr-head"><div class="pr-title">CLEAR Report</div><div class="pr-meta">' + esc(custName(s.customer)) + ' · ' + esc(s.name) + (s.address ? ' · ' + esc(s.address) : '') + '</div></div>' +
    '<div class="pr-meta" style="text-align:right">' + esc(label) + '<br>Report date ' + esc(fmtD(isoD(TODAY))) + '</div></div>' +
    '<div class="pr-sum"><div class="r"><b>' + cnt('red') + '</b>Needs attention now</div><div class="y"><b>' + cnt('yellow') + '</b>Monitor / plan repair</div><div class="g"><b>' + cnt('green') + '</b>Good condition</div></div>' +
    (r.summary ? '<div class="pr-h">Key findings</div><div style="font-size:9pt;white-space:pre-wrap;margin-bottom:6px">' + esc(r.summary) + '</div>' : '') +
    '<div class="pr-legend">Condition is based on what our technicians found during maintenance and service visits. Remaining life is estimated from install date and typical service life.</div>' +
    sec('red', 'Needs attention now') + sec('yellow', 'Monitor / plan repair') + sec('green', 'Good condition') +
    '<div class="pr-foot"><span>Questions? Call 289-438-1175 · alpinehvac.ca</span><span>Prepared by ' + esc(session.name) + '</span></div>';
  const t = document.title; document.title = 'CLEAR Report - ' + s.name + (r.quarter ? ' - ' + r.quarter : '');
  setTimeout(() => { window.print(); document.title = t; }, 300);
}

// ── customer link ────────────────────────────────────────────────────
function token() { const b = new Uint8Array(18); crypto.getRandomValues(b); return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_'); }
function clearUrl(t) { return location.origin + location.pathname.replace(/[^/]*$/, '') + 'clear-report.html?t=' + encodeURIComponent(t); }
async function fsApi() { const [f, a] = await Promise.all([import(FS_URL), import('./ap-firebase.js')]); return { ...f, db: a.db }; }
// What the customer gets: colours, customer notes and key findings. Internal notes, serials, history and people are left out.
function customerSnapshot(r, s) {
  return { kind: 'clear', customer: custName(s.customer), site: s.name, address: s.address || '', updatedAt: Date.now(), reviewedAt: r.reviewedAt || null, summary: r.summary || '',
    rows: r.rows.filter(x => x.include).map(x => { const cat = catalog(x.type, x.tag); const age = ageYears(x.installDate);
      return { tag: x.tag, type: x.type || '', make: x.make || '', model: x.model || '', desc: x.desc || cat.desc, img: cat.img, condition: x.condition, notes: x.notes || '', remain: age == null ? null : Math.round(Math.max(0, x.life - age)) }; }) };
}
async function publish(r) {
  const money = r.rows.find(x => x.include && /\$\s?\d/.test(x.notes || ''));
  if (money || /\$\s?\d/.test(r.summary || '')) { toast('Remove the dollar amount' + (money ? ' on ' + money.tag : ' in key findings') + ' before publishing. Customer reports never show prices.'); return; }
  const unconfirmed = r.rows.filter(x => x.include && x.auto).length;
  if (unconfirmed) { toast('Confirm the ' + unconfirmed + ' suggested colour' + (unconfirmed > 1 ? 's' : '') + ' before publishing.'); return; }
  const s = site(), t = (r.share && r.share.token) || token();
  try {
    const F = await fsApi();
    await F.setDoc(F.doc(F.db, 'account_share', t), { json: JSON.stringify(customerSnapshot(r, s)), customer: custName(s.customer), quarter: 'live', updatedAt: F.serverTimestamp(), updatedBy: session.email || session.name });
    r.share = { token: t, at: Date.now(), by: session.name, firstAt: (r.share && r.share.firstAt) || isoD(TODAY) };
    r.unpublished = 0; persistLive(r); render(); toast('Customer link updated.');
  } catch (e) { console.warn(e); toast(e && e.code === 'permission-denied' ? 'Only Jake, Mike and Cole can publish customer links.' : 'Could not publish. Check your connection and try again.'); }
}
async function unshare(r) {
  if (!r.share) return;
  try {
    const F = await fsApi();
    await F.deleteDoc(F.doc(F.db, 'account_share', r.share.token));
    r.share = null; persistLive(r); render(); toast('Customer link turned off.');
  } catch (e) { console.warn(e); toast('Could not turn the link off. Try again.'); }
}

// ── events ───────────────────────────────────────────────────────────
document.addEventListener('click', e => {
  const b = e.target.closest('[data-view],[data-act]'); if (!b) return;
  if (b.dataset.view) { view = b.dataset.view; history.replaceState(null, '', '?p=' + encodeURIComponent(pid) + '&q=' + quarter + (view === 'clear' ? '&view=clear' : '')); render(); return; }
  const r = readJSON(liveKey()), i = +b.dataset.i;
  switch (b.dataset.act) {
    case 'create': { const n = buildLive(); persistLive(n); render(); toast('CLEAR report started. Review the colours and notes.'); break; }
    case 'cond': if (r) { const x = r.rows[i], was = x.condition, c = b.dataset.c; if (was === c && !x.auto) break; x.condition = c; x.auto = false; x.changedAt = Date.now(); x.changedBy = session.name; logChange(r, { tag: x.tag, from: was, to: c }); persistLive(r); render(); } break;
    case 'confirm': if (r) { const x = r.rows[i]; x.auto = false; x.changedAt = Date.now(); x.changedBy = session.name; logChange(r, { tag: x.tag, to: x.condition, text: 'Suggested colour confirmed' }); persistLive(r); render(); } break;
    case 'addnote': if (r) { const el = document.querySelector('[data-note="' + i + '"]'), t = el && el.value.trim(); if (!t) break; const x = r.rows[i]; x.notes = (x.notes ? x.notes + '\n' : '') + fmtD(isoD(TODAY)) + ': ' + t; logChange(r, { tag: x.tag, text: 'Note added' }); persistLive(r); render(); toast('Note added.'); } break;
    case 'review': if (r) { r.reviewedAt = isoD(TODAY); r.reviewedBy = session.name; persistLive(r); render(); toast('Marked reviewed.'); } break;
    case 'pdf': printReport(r); break;
    case 'pdf-q': printReport(getSnapshot(quarter)); break;
    case 'snapshot': if (r) { const old = getSnapshot(quarter); saveSnapshot({ pid, quarter, rows: r.rows.map(x => ({ ...x })), summary: r.summary || '', createdAt: isoD(TODAY), createdBy: session.name, source: 'Live CLEAR report', sent: old ? old.sent : null, reviewed: old ? old.reviewed : null }); render(); toast(qLabel(quarter) + ' snapshot saved.'); } break;
    case 'publish': if (r) publish(r); break;
    case 'unshare': if (r) unshare(r); break;
    case 'copy': if (r && r.share) navigator.clipboard.writeText(clearUrl(r.share.token)).then(() => toast('Link copied.')); break;
  }
});
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.dataset && e.target.dataset.note != null) { e.preventDefault(); const b = document.querySelector('[data-act="addnote"][data-i="' + e.target.dataset.note + '"]'); if (b) b.click(); } });
document.addEventListener('change', e => {
  const el = e.target, r = readJSON(liveKey()), i = +el.dataset.i;
  if (el.id === 'pick-q') { quarter = el.value; history.replaceState(null, '', '?p=' + encodeURIComponent(pid) + '&q=' + quarter + (view === 'clear' ? '&view=clear' : '')); render(); return; }
  if (el.dataset.act === 'flag') { const q = getSnapshot(quarter); if (!q) return; q[el.dataset.k] = el.checked ? { at: isoD(TODAY), by: session.name } : null; saveSnapshot(q); render(); toast(el.checked ? 'Marked ' + (el.dataset.k === 'sent' ? 'sent to customer.' : 'reviewed with customer.') : 'Cleared.'); return; }
  if (!r) return;
  if (el.id === 'clear-summary') { r.summary = el.value; logChange(r, { text: 'Key findings edited' }); persistLive(r); toast('Saved.'); return; }
  if (el.dataset.act === 'notes') { r.rows[i].notes = el.value; logChange(r, { tag: r.rows[i].tag, text: 'Notes edited' }); persistLive(r); toast('Saved.'); }
  else if (el.dataset.act === 'internal') { r.rows[i].internal = el.value; persistLive(r); toast('Saved.'); }
  else if (el.dataset.act === 'life') { r.rows[i].life = Math.max(1, parseInt(el.value, 10) || 20); logChange(r, { tag: r.rows[i].tag, text: 'Expected life set to ' + r.rows[i].life + ' yrs' }); persistLive(r); render(); }
  else if (el.dataset.act === 'include') { r.rows[i].include = el.checked; logChange(r, { tag: r.rows[i].tag, text: el.checked ? 'Added to customer report' : 'Removed from customer report' }); persistLive(r); render(); }
});

// ── import hooks (used when Claude applies a BuildOps pull or a SharePoint CLEAR file) ──
window.stImportSites = list => { let n = 0; (list || []).forEach(s => { if (s && s.id) { s.syncedAt = s.syncedAt || isoD(TODAY); localStorage.setItem('st_site_' + s.id, JSON.stringify(s)); n++; } }); render(); return n; };
window.stImportClearBase = (propId, rows, source, summary) => { localStorage.setItem('st_clearbase_' + propId, JSON.stringify({ rows, summary: summary || '', source: source || 'SharePoint', importedAt: isoD(TODAY) })); return rows.length; };

render();
})();
