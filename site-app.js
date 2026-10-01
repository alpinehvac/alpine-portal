// ── Alpine HVAC — Site page ─────────────────────────────────────────
// site.html?p=<BuildOps property id>&q=2026-Q3
// Activity: every visit at this address for the quarter, in three buckets
//           (Maintenance / Service / Jobs & projects), pulled from BuildOps.
// CLEAR report: asset-by-asset condition (red / yellow / green), editable by the
//           account manager, printable to PDF, with sent / reviewed tracking.
// Firestore collection site_data:
//   st_site_<pid>          site, assets, visits (refreshed weekly from BuildOps)
//   st_clear_<pid>_<qtr>   CLEAR report for that quarter
//   st_clearbase_<pid>     baseline imported from an existing SharePoint CLEAR file

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
function ageYears(iso) { const d = parseD(iso); return d ? (TODAY - d) / (365.25 * 86400000) : null; }

const siteKey = () => 'st_site_' + pid;
const clearKey = q => 'st_clear_' + pid + '_' + q;
function site() { return readJSON(siteKey()); }

// ── CLEAR report model ───────────────────────────────────────────────
// Keyword rules used only to SUGGEST a colour from visit notes; the account manager decides.
const RED_RE = /not operational|not operating|inoperable|offline|out of refrigerant|major leak|locked out|seized|failed|cracked heat exchanger|no heat|no cooling|unsafe|shut down|requires replacement|needs replacement/i;
const YEL_RE = /requires (future )?repair|future repair|monitor|worn|low (on )?(refrigerant|charge)|slight|recommend|suspect|minor|leak|replace (soon|filter)|noisy|vibration|corrosion|rust/i;

function suggestions(s, q) {
  // Visit text per asset tag for this quarter.
  const byTag = {};
  (s.visits || []).filter(v => qOf(v.date) === q).forEach(v => {
    const tags = String(v.assets || '').split(',').map(x => x.trim()).filter(x => x && x !== '-');
    const text = [v.title, v.desc].filter(Boolean).filter((x, i, a) => a.findIndex(y => y.toLowerCase() === x.toLowerCase()) === i).join(' — ');
    tags.forEach(t => (byTag[t] = byTag[t] || []).push({ date: v.date, text, bucket: v.bucket }));
  });
  return byTag;
}

function buildReport(q) {
  const s = site();
  const prev = readJSON(clearKey(prevQ(q)));
  const base = readJSON('st_clearbase_' + pid);
  const seed = prev || base;
  const seedRows = new Map(((seed && seed.rows) || []).map(r => [r.tag.toLowerCase(), r]));
  const sug = suggestions(s, q);
  const tags = new Set();
  const rows = [];
  (s.assets || []).forEach(a => {
    tags.add(a.tag.toLowerCase());
    const prior = seedRows.get(a.tag.toLowerCase());
    const cat = catalog(a.type, a.tag);
    const r = {
      tag: a.tag, type: a.type || (prior && prior.type) || '', make: a.make || (prior && prior.make) || '', model: a.model || (prior && prior.model) || '',
      serial: a.serial || (prior && prior.serial) || '', installDate: toIso(a.installDate) || (prior && prior.installDate) || '',
      life: (prior && prior.life) || cat.life, desc: (prior && prior.desc) || cat.desc,
      condition: (prior && prior.condition) || 'green', notes: (prior && prior.notes) || '', include: prior ? prior.include !== false : !/damper|valve/i.test(a.type || ''), auto: false
    };
    applySuggestion(r, sug[a.tag]);
    rows.push(r);
  });
  // Keep assets that exist only in the seed report (e.g. imported from SharePoint).
  ((seed && seed.rows) || []).forEach(p => { if (!tags.has(p.tag.toLowerCase())) { const r = { ...p, auto: false }; applySuggestion(r, sug[p.tag]); rows.push(r); } });
  rows.sort((a, b) => a.tag.localeCompare(b.tag, undefined, { numeric: true }));
  return { pid, quarter: q, rows, summary: (seed && seed.summary) || '', createdAt: isoD(TODAY), createdBy: session.name, source: prev ? 'Previous quarter' : base ? 'SharePoint CLEAR file' : 'BuildOps asset list', sent: null, reviewed: null };
}
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

function getReport(create) {
  let r = readJSON(clearKey(quarter));
  if (!r && create) { r = buildReport(quarter); saveReport(r); }
  return r;
}
function saveReport(r) { r.updatedAt = Date.now(); r.updatedBy = session.name; localStorage.setItem(clearKey(r.quarter), JSON.stringify(r)); }

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
    const k = v.bucket + '|' + v.job;
    if (!byJob.has(k)) byJob.set(k, { bucket: v.bucket, job: v.job, url: v.url, title: v.title, jobType: v.jobType, status: v.jobStatus, visits: [] });
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
  const r = getReport(false);
  if (!r) {
    return '<div class="clear-bar"><div><b>No CLEAR report for ' + qLabel(quarter) + ' yet.</b><div class="muted" style="font-size:.8rem">Builds from ' +
      (readJSON(clearKey(prevQ(quarter))) ? 'last quarter\'s report' : readJSON('st_clearbase_' + pid) ? 'the existing SharePoint CLEAR file' : 'the BuildOps asset list') +
      ', then suggests colours from this quarter\'s visit notes. You review and adjust before sending.</div></div><span class="spacer"></span><button class="btn primary" data-act="create">Create report</button></div>';
  }
  const inc = r.rows.filter(x => x.include);
  const cnt = c => inc.filter(x => x.condition === c).length;
  const autoN = r.rows.filter(x => x.auto).length;
  let h = '<div class="clear-bar">' +
    '<div class="rygsum"><span class="badge b-red">' + cnt('red') + ' red</span><span class="badge b-amber">' + cnt('yellow') + ' yellow</span><span class="badge b-green">' + cnt('green') + ' green</span></div>' +
    '<span class="muted" style="font-size:.76rem">' + inc.length + ' of ' + r.rows.length + ' assets on the report · from ' + esc(r.source) + (autoN ? ' · ' + autoN + ' colour' + (autoN > 1 ? 's' : '') + ' suggested from visits' : '') + '</span>' +
    '<span class="spacer"></span>' +
    chk('sent', 'Sent to customer', r.sent) + chk('reviewed', 'Reviewed with customer', r.reviewed) +
    '<button class="btn" data-act="rebuild" title="Re-apply this quarter\'s visit notes; keeps your edits">Refresh suggestions</button>' +
    '<button class="btn primary" data-act="pdf">Download PDF</button></div>' +
    '<h2>Key findings <span class="note">Site-wide notes shown at the top of the customer PDF (optional)</span></h2>' +
    '<textarea class="inp" id="clear-summary" style="width:100%;min-height:80px" placeholder="e.g. One RTU found with a cracked heat exchanger; replacement quote to follow.">' + esc(r.summary || '') + '</textarea>';
  ['red', 'yellow', 'green'].forEach(c => {
    const rows = r.rows.map((x, i) => ({ x, i })).filter(o => o.x.condition === c);
    if (!rows.length) return;
    h += '<h2>' + (c === 'red' ? 'Red: needs attention now' : c === 'yellow' ? 'Yellow: monitor / plan repair' : 'Green: good condition') + ' <span class="note">' + rows.length + '</span></h2>';
    rows.forEach(({ x, i }) => { h += assetHTML(x, i); });
  });
  return h;
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
    '<div><div class="a-tag">' + esc(x.tag) + ' <span class="a-meta">' + esc(x.type || '') + '</span>' + (x.auto ? ' <span class="auto">· colour suggested from visit notes</span>' : '') + '</div>' +
    '<div class="a-meta">' + esc([x.make, x.model && 'Model ' + x.model, x.serial && 'S/N ' + x.serial].filter(Boolean).join(' · ') || 'No make/model on file') +
      (x.installDate ? ' · Installed ' + esc(fmtD(x.installDate)) : '') + (remain != null ? ' · ~' + remain.toFixed(1) + ' yrs life remaining' : '') + '</div>' +
    '<div class="a-desc">' + esc(x.desc || cat.desc) + '</div>' +
    '<textarea class="inp" data-act="notes" data-i="' + i + '" placeholder="Condition notes for the customer">' + esc(x.notes) + '</textarea></div>' +
    '<div class="a-side"><div class="ryg"><button class="g' + (x.condition === 'green' ? ' on' : '') + '" data-act="cond" data-i="' + i + '" data-c="green">Green</button>' +
      '<button class="y' + (x.condition === 'yellow' ? ' on' : '') + '" data-act="cond" data-i="' + i + '" data-c="yellow">Yellow</button>' +
      '<button class="r' + (x.condition === 'red' ? ' on' : '') + '" data-act="cond" data-i="' + i + '" data-c="red">Red</button></div>' +
    '<label>Expected life (yrs) <input class="inp" type="number" min="1" max="50" data-act="life" data-i="' + i + '" value="' + esc(x.life) + '"></label>' +
    '<label><input type="checkbox" data-act="include" data-i="' + i + '"' + (x.include ? ' checked' : '') + '> Include on customer PDF</label></div></div>';
}

// ── PDF ──────────────────────────────────────────────────────────────
function printReport() {
  const s = site(), r = getReport(false); if (!r) return;
  const inc = r.rows.filter(x => x.include);
  const cnt = c => inc.filter(x => x.condition === c).length;
  const card = x => { const cat = catalog(x.type, x.tag); const age = ageYears(x.installDate); const remain = age == null ? null : Math.max(0, x.life - age);
    return '<div class="pr-card ' + x.condition + '">' + (cat.img ? '<img src="' + esc(cat.img) + '" alt="">' : '<div></div>') +
      '<div><div class="t">' + esc(x.tag) + '<span class="pr-pill ' + x.condition + '">' + x.condition.toUpperCase() + '</span></div>' +
      '<div class="m">' + esc([x.type, x.make, x.model && 'Model ' + x.model].filter(Boolean).join(' · ')) + (remain != null ? ' · ~' + remain.toFixed(0) + ' yrs remaining' : '') + '</div>' +
      '<div class="m">' + esc(x.desc || cat.desc) + '</div>' + (x.notes ? '<div class="n">' + esc(x.notes).replace(/\n/g, '<br>') + '</div>' : '') + '</div></div>'; };
  const sec = (c, title) => { const rows = inc.filter(x => x.condition === c); return rows.length ? '<div class="pr-h">' + title + '</div><div class="pr-grid">' + rows.map(card).join('') + '</div>' : ''; };
  $('print-root').innerHTML =
    '<div class="pr-top"><div><div class="pr-brand">Alpine HVAC<small>Hydronics · Controls · Building Systems</small></div>' +
    '<div class="pr-title">CLEAR Report</div><div class="pr-meta">' + esc(custName(s.customer)) + ' · ' + esc(s.name) + (s.address ? ' · ' + esc(s.address) : '') + '</div></div>' +
    '<div class="pr-meta" style="text-align:right">' + esc(qLabel(r.quarter)) + '<br>Report date ' + esc(fmtD(isoD(TODAY))) + '</div></div>' +
    '<div class="pr-sum"><div class="r"><b>' + cnt('red') + '</b>Needs attention now</div><div class="y"><b>' + cnt('yellow') + '</b>Monitor / plan repair</div><div class="g"><b>' + cnt('green') + '</b>Good condition</div></div>' +
    (r.summary ? '<div class="pr-h">Key findings</div><div style="font-size:9pt;white-space:pre-wrap;margin-bottom:6px">' + esc(r.summary) + '</div>' : '') +
    '<div class="pr-legend">Condition is based on what our technicians found during this quarter\'s maintenance and service visits. Remaining life is estimated from install date and typical service life.</div>' +
    sec('red', 'Needs attention now') + sec('yellow', 'Monitor / plan repair') + sec('green', 'Good condition') +
    '<div class="pr-foot"><span>Questions? Call 289 438 1175 · alpinehvac.ca</span><span>Prepared by ' + esc(session.name) + '</span></div>';
  const t = document.title; document.title = 'CLEAR Report - ' + s.name + ' - ' + r.quarter;
  setTimeout(() => { window.print(); document.title = t; }, 300);
}

// ── events ───────────────────────────────────────────────────────────
document.addEventListener('click', e => {
  const b = e.target.closest('[data-view],[data-act]'); if (!b) return;
  if (b.dataset.view) { view = b.dataset.view; history.replaceState(null, '', '?p=' + encodeURIComponent(pid) + '&q=' + quarter + (view === 'clear' ? '&view=clear' : '')); render(); return; }
  const r = getReport(false), i = +b.dataset.i;
  switch (b.dataset.act) {
    case 'create': getReport(true); render(); toast('CLEAR report created. Review the colours and notes, then download the PDF.'); break;
    case 'cond': if (r) { r.rows[i].condition = b.dataset.c; r.rows[i].auto = false; saveReport(r); render(); } break;
    case 'pdf': printReport(); break;
    case 'rebuild': if (r) { const sug = suggestions(site(), quarter); r.rows.forEach(x => applySuggestion(x, sug[x.tag])); saveReport(r); render(); toast('Visit notes re-applied. Your edits were kept.'); } break;
  }
});
document.addEventListener('change', e => {
  const el = e.target, r = getReport(false), i = +el.dataset.i;
  if (el.id === 'clear-summary') { const rr = getReport(false); if (rr) { rr.summary = el.value; saveReport(rr); toast('Saved.'); } return; }
  if (el.id === 'pick-q') { quarter = el.value; history.replaceState(null, '', '?p=' + encodeURIComponent(pid) + '&q=' + quarter + (view === 'clear' ? '&view=clear' : '')); render(); return; }
  if (!r) return;
  if (el.dataset.act === 'notes') { r.rows[i].notes = el.value; saveReport(r); toast('Saved.'); }
  else if (el.dataset.act === 'life') { r.rows[i].life = Math.max(1, parseInt(el.value, 10) || 20); saveReport(r); render(); }
  else if (el.dataset.act === 'include') { r.rows[i].include = el.checked; saveReport(r); render(); }
  else if (el.dataset.act === 'flag') { r[el.dataset.k] = el.checked ? { at: isoD(TODAY), by: session.name } : null; saveReport(r); render(); toast(el.checked ? 'Marked ' + (el.dataset.k === 'sent' ? 'sent to customer.' : 'reviewed with customer.') : 'Cleared.'); }
});

// ── import hooks (used when Claude applies a BuildOps pull or a SharePoint CLEAR file) ──
window.stImportSites = list => { let n = 0; (list || []).forEach(s => { if (s && s.id) { s.syncedAt = s.syncedAt || isoD(TODAY); localStorage.setItem('st_site_' + s.id, JSON.stringify(s)); n++; } }); render(); return n; };
window.stImportClearBase = (propId, rows, source, summary) => { localStorage.setItem('st_clearbase_' + propId, JSON.stringify({ rows, summary: summary || '', source: source || 'SharePoint', importedAt: isoD(TODAY) })); return rows.length; };

render();
})();
