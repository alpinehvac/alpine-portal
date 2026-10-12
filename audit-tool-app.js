// ── Alpine HVAC — Zero-Risk Building Performance Audit tool ─────────
// audit-tool.html            list of audits
// audit-tool.html?id=<id>    one audit: Setup · Assets · Checks · Findings · Claude · Report · Handoff
//
// Scoring rules are fixed and match the Audit Playbook (audit-playbook.html, section 8),
// so the same building gets the same score no matter who audits it.
//
// Storage
//   localStorage au_<id>              one audit (synced to Firestore audit_data by cloud-sync.js)
//   Firestore audit_photos/<photoId>  one compressed JPEG per doc, NOT pulled into localStorage
//   Firestore site_data/st_clearbase_<BuildOps property id>
//                                     written on handoff, becomes the site's CLEAR report baseline
//
// Claude drafting (V1): "Copy for Claude" exports the audit as JSON; Claude returns JSON in the
// schema in the ACQ Vantage project doc; "Import Claude draft" merges it back for review.

(function () {
'use strict';

// ── constants ────────────────────────────────────────────────────────
const KEY = 'au_';
const PHOTO_COLL = 'audit_photos';
const FS_URL = 'https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js';
const session = (typeof apGetSession === 'function' && apGetSession()) || { name: 'Unknown', roles: [] };
const $ = id => document.getElementById(id);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const TIERS = {
  standard:  { label: 'Standard',  fee: 1500, desc: 'Single building, up to ~50,000 sq ft, up to 10 major units' },
  complex:   { label: 'Complex',   fee: 2500, desc: '50,000–150,000 sq ft, or full BAS / central plant' },
  portfolio: { label: 'Portfolio', fee: 3500, desc: 'Over 150,000 sq ft or multi-building (custom, from $3,500)' }
};
const STATUS = {
  booked:    { label: 'Booked',        cls: 'b-grey' },
  onsite:    { label: 'Site visit done', cls: 'b-teal' },
  report:    { label: 'Report ready',  cls: 'b-teal' },
  debriefed: { label: 'Debriefed',     cls: 'b-purple' },
  won:       { label: 'Signed',        cls: 'b-low' },
  lost:      { label: 'Closed-lost',   cls: 'b-crit' }
};
const CATS = [
  { n: 1, key: 'equip',  label: 'Equipment Risk',       short: 'Equipment' },
  { n: 2, key: 'bas',    label: 'Controls & BAS',       short: 'Controls/BAS' },
  { n: 3, key: 'energy', label: 'Energy Efficiency',    short: 'Energy' },
  { n: 4, key: 'comfort',label: 'Comfort & IAQ',        short: 'Comfort/IAQ' },
  { n: 5, key: 'vendor', label: 'Vendor & Compliance',  short: 'Vendor/Compliance' }
];
// Deductions for categories 2–5 (playbook section 8). type 'n' = counted item.
const CHECKS = {
  bas: [
    ['eol', 4, 'BAS platform end-of-life / unsupported'],
    ['sched', 4, 'Schedules don’t match occupancy / units running 24/7'],
    ['overrides', 3, 'More than 10 manual overrides or points in hand'],
    ['alarms', 3, 'Unanswered or suppressed alarms'],
    ['sensors', 3, 'Sensor readings off by more than 2°C on sample'],
    ['trends', 3, 'No trends / no one using the system']
  ],
  energy: [
    ['unocc', 5, 'Equipment running during unoccupied hours'],
    ['simul', 5, 'Simultaneous heating and cooling'],
    ['econ', 4, 'Economizer failed or disabled'],
    ['setpts', 3, 'Poor setpoints / deadbands'],
    ['eui', 3, 'Energy intensity above benchmark (bills provided)']
  ],
  comfort: [
    ['zones', 5, 'Persistent complaint zones (−5 each, max −10)', 'n', 10],
    ['oa', 5, 'Outdoor air not operating / closed'],
    ['range', 5, 'Temperature or humidity out of range on spot checks']
  ],
  vendor: [
    ['nomaint', 6, 'No evidence of maintenance on stated scope'],
    ['tssa', 5, 'TSSA / regulatory record lapsed or missing'],
    ['refrig', 4, 'Refrigerant records missing where required'],
    ['docs', 3, 'No as-builts / sequences / points list'],
    ['nosa', 2, 'No service agreement in place']
  ]
};
const ASSET_TYPES = ['Rooftop unit', 'Make-up air unit', 'ERV / HRV', 'Boiler', 'Chiller', 'Cooling tower', 'Air handler', 'VAV box', 'Fan coil', 'Heat pump', 'Ductless split', 'Furnace', 'Unit heater', 'Radiant tube heater', 'Exhaust fan', 'Pump', 'Water heater', 'Dehumidification / pool unit', 'Computer room unit', 'BAS controller / front end', 'Other'];
const COND = { 5: 'Like new', 4: 'Good, minor wear', 3: 'Fair, serviceable', 2: 'Poor, near-term risk', 1: 'Failed / critical' };
const CRIT = { 5: 'Stops operations / safety', 4: 'Major tenant / large area', 3: 'One zone, workaround', 2: 'Minor comfort', 1: 'Redundant' };
const TIMING = { now: 'Now (0–3 mo)', next: 'Next (3–12 mo)', plan: 'Plan (12–24 mo)' };
const LIFE = [[/rooftop|make-up|erv|cooling tower|air handler|fan coil|unit heater|radiant|pump|chiller/i, 20], [/boiler/i, 25], [/furnace/i, 18], [/heat pump|split|exhaust|water heater/i, 15], [/dehumid/i, 10]];

// ── helpers ──────────────────────────────────────────────────────────
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function uid(p) { return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function parseD(s) { if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null; const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function isoD(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function fmtD(s) { const d = parseD(s); return d ? MONTHS[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear() : '—'; }
function addDays(s, n) { const d = parseD(s); if (!d) return ''; d.setDate(d.getDate() + n); return isoD(d); }
function today() { return isoD(new Date()); }
function daysUntil(s) { const d = parseD(s); if (!d) return null; const t = parseD(today()); return Math.round((d - t) / 86400000); }
function money(n) { return n == null || n === '' || isNaN(n) ? '—' : '$' + Math.round(Number(n)).toLocaleString('en-CA'); }
function num(v) { if (v === '' || v == null) return null; const n = Number(String(v).replace(/[$,\s]/g, '')); return isNaN(n) ? null : n; }
let toastT; function toast(m) { const t = $('toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 3600); }
function getPath(o, p) { return p.split('.').reduce((a, k) => (a == null ? a : a[k]), o); }
function setPath(o, p, v) { const ks = p.split('.'); let c = o; for (let i = 0; i < ks.length - 1; i++) { if (c[ks[i]] == null) c[ks[i]] = {}; c = c[ks[i]]; } c[ks[ks.length - 1]] = v; }
function lifeFor(type) { for (const [re, y] of LIFE) if (re.test(type || '')) return y; return 20; }

// ── data ─────────────────────────────────────────────────────────────
function blank() {
  return {
    id: uid('a'), createdAt: today(), createdBy: session.name, status: 'booked',
    client: { company: '', contact: '', title: '', email: '', phone: '', decisionMaker: '', building: '', address: '', sqft: '', yearBuilt: '', occupancy: '', critical: false, bas: '', contractor: '', hook: '', pains: '', source: 'Natalie' },
    tier: 'standard', fee: 1500, depositDate: '', balanceDate: '', visitDate: '', debriefDate: '',
    assets: [], checks: { bas: {}, energy: {}, comfort: {}, vendor: {} }, checkNotes: {},
    findings: [], summary: { working: '', risk: '', opportunity: '', ifNothing: '', careLevel: '' },
    energyNotes: '', complianceNotes: '', followups: {},
    outcome: { signedTier: '', signedDate: '', annualValue: '', lostReason: '', guaranteeClaimed: false },
    clearPid: '', clearExportedAt: ''
  };
}
function load(id) { try { const a = JSON.parse(localStorage.getItem(KEY + id)); return a && a.id ? normalize(a) : null; } catch (e) { return null; } }
function normalize(a) {
  const b = blank();
  for (const k in b) if (a[k] == null) a[k] = b[k];
  for (const k in b.client) if (a.client[k] == null) a.client[k] = b.client[k];
  for (const c in b.checks) if (!a.checks[c]) a.checks[c] = {};
  return a;
}
function list() {
  const out = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(KEY)) { const a = load(k.slice(KEY.length)); if (a) out.push(a); }
  }
  return out.sort((x, y) => (y.visitDate || y.createdAt).localeCompare(x.visitDate || x.createdAt));
}
let saveT = null, cur = null;
function save(now) {
  if (!cur) return;
  cur.updatedAt = Date.now(); cur.updatedBy = session.name;
  clearTimeout(saveT);
  const write = () => localStorage.setItem(KEY + cur.id, JSON.stringify(cur));
  if (now) write(); else saveT = setTimeout(write, 700);
}
window.addEventListener('beforeunload', () => { if (saveT) { clearTimeout(saveT); if (cur) localStorage.setItem(KEY + cur.id, JSON.stringify(cur)); } });

// ── scoring (playbook section 8) ─────────────────────────────────────
function risk(a) { return a.cond && a.crit ? (6 - a.cond) * a.crit : null; }
function band(r) { return r == null ? null : r >= 20 ? 'crit' : r >= 12 ? 'high' : r >= 6 ? 'mod' : 'low'; }
const BAND_LABEL = { crit: 'Critical', high: 'High', mod: 'Moderate', low: 'Low' };
function score(a) {
  const scored = a.assets.filter(x => risk(x) != null);
  const cnt = { crit: 0, high: 0, mod: 0, low: 0 };
  scored.forEach(x => cnt[band(risk(x))]++);
  const s = {};
  s.equip = Math.max(0, 20 - 5 * cnt.crit - 2 * cnt.high - Math.floor(cnt.mod / 3));
  for (const c of ['bas', 'energy', 'comfort', 'vendor']) {
    let d = 0;
    CHECKS[c].forEach(([k, pts, , type, max]) => {
      const v = a.checks[c][k];
      if (type === 'n') d += Math.min(max, pts * (Number(v) || 0)); else if (v) d += pts;
    });
    s[c] = Math.max(0, 20 - d);
  }
  const total = CATS.reduce((t, c) => t + s[c.key], 0);
  return { cats: s, total, grade: grade(total), cnt, scoredAssets: scored.length, unscored: a.assets.length - scored.length };
}
function grade(t) { return t >= 85 ? { l: 'A', d: 'Well maintained; optimize', c: '#2E7D57' } : t >= 70 ? { l: 'B', d: 'Stable; targeted fixes', c: '#27636C' } : t >= 55 ? { l: 'C', d: 'At risk; plan required within 12 months', c: '#A9821F' } : { l: 'D', d: 'Critical; immediate action required', c: '#9B2C2C' }; }
function catBand(v) { return v >= 17 ? 'Strong' : v >= 13 ? 'Stable' : v >= 9 ? 'At Risk' : 'Critical'; }
function catColor(v) { return v >= 17 ? '#2E7D57' : v >= 13 ? '#27636C' : v >= 9 ? '#A9821F' : '#9B2C2C'; }
function recTier(a, sc) {
  if (sc.cnt.crit > 0 || sc.cats.bas <= 8 || a.client.critical) return { t: 'Premium', why: sc.cnt.crit > 0 ? 'Critical-risk equipment on site' : sc.cats.bas <= 8 ? 'Controls & BAS scored Critical' : 'Critical occupancy' };
  if (sc.total >= 85) return { t: 'Minimum', why: 'Building scored 85+ with no critical assets — protect what’s working' };
  return { t: 'Core', why: 'Stable building that needs consistent maintenance and reporting' };
}
function actionable(a) { return a.findings.filter(f => f.agreed !== false && (f.title || f.observation)).length; }
function planTotals(a) {
  const t = { now: [0, 0], next: [0, 0], plan: [0, 0] };
  a.findings.forEach(f => { const k = t[f.timing] ? f.timing : 'plan'; t[k][0] += num(f.costLow) || 0; t[k][1] += num(f.costHigh) || num(f.costLow) || 0; });
  return t;
}

// ── photos (Firestore audit_photos, one doc per photo) ───────────────
const photoCache = {};          // id -> dataURL
let photosLoadedFor = '';
async function fsApi() { const fs = await import(FS_URL); const { db } = await import('./ap-firebase.js'); return { fs, db }; }
async function loadPhotos(auditId) {
  if (photosLoadedFor === auditId) return false;
  photosLoadedFor = auditId;            // one attempt per audit open (no retry loop on failure)
  try {
    const { fs, db } = await fsApi();
    const snap = await fs.getDocs(fs.query(fs.collection(db, PHOTO_COLL), fs.where('auditId', '==', auditId)));
    snap.forEach(d => { const v = d.data(); if (v && v.data) photoCache[d.id] = 'data:image/jpeg;base64,' + v.data; });
    return snap.size > 0;
  } catch (e) {
    console.warn('Audit photos: load failed', e);
    toast(e && e.code === 'permission-denied' ? 'Photos blocked: Firestore rules for audit_photos not published yet.' : 'Could not load photos.');
    return false;
  }
}
function compress(src, maxPx) {
  return new Promise((res, rej) => {
    const draw = (img, w, h) => {
      const sc = Math.min(1, maxPx / Math.max(w, h));
      const c = document.createElement('canvas'); c.width = Math.round(w * sc); c.height = Math.round(h * sc);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      let q = 0.72, out = c.toDataURL('image/jpeg', q);
      while (out.length > 420000 && q > 0.35) { q -= 0.1; out = c.toDataURL('image/jpeg', q); }
      res(out);
    };
    if (src instanceof HTMLVideoElement) return draw(src, src.videoWidth, src.videoHeight);
    const img = new Image();
    img.onload = () => { draw(img, img.naturalWidth, img.naturalHeight); URL.revokeObjectURL(img.src); };
    img.onerror = () => rej(new Error('Could not read image'));
    img.src = URL.createObjectURL(src);
  });
}
async function storePhoto(dataUrl, meta) {
  const id = uid('ph');
  photoCache[id] = dataUrl;
  try {
    const { fs, db } = await fsApi();
    await fs.setDoc(fs.doc(db, PHOTO_COLL, id), { auditId: cur.id, data: dataUrl.split(',')[1], createdAt: Date.now(), by: session.name, ...meta });
  } catch (e) {
    delete photoCache[id];
    toast(e && e.code === 'permission-denied' ? 'Photo not saved: Firestore rules for audit_photos not published yet.' : 'Photo not saved — check connection and retry.');
    throw e;
  }
  return id;
}
async function deletePhoto(id) {
  delete photoCache[id];
  try { const { fs, db } = await fsApi(); await fs.deleteDoc(fs.doc(db, PHOTO_COLL, id)); } catch (e) { console.warn('photo delete failed', e); }
}

// Pick files for a finding or asset: images are compressed and stored; videos open the frame grabber.
let pickTarget = null;   // { kind: 'finding'|'asset', id }
function pickFiles(target) { pickTarget = target; const fi = $('file-in'); fi.value = ''; fi.click(); }
$('file-in').addEventListener('change', async e => {
  const files = Array.from(e.target.files || []);
  const tgt = pickTarget; if (!tgt || !cur) return;
  for (const f of files) {
    if (f.type.startsWith('video/')) { openFrameGrabber(f, tgt); continue; }
    try { const d = await compress(f, 1400); const id = await storePhoto(d, { kind: tgt.kind, ref: tgt.id }); attach(tgt, id); } catch (err) { /* toast already shown */ }
  }
  save(true); render();
});
function attach(tgt, id) {
  const arr = tgt.kind === 'finding' ? cur.findings : cur.assets;
  const o = arr.find(x => x.id === tgt.id); if (!o) return;
  (o.photos = o.photos || []).push(id);
}
function openFrameGrabber(file, tgt) {
  const url = URL.createObjectURL(file);
  const m = document.createElement('div'); m.className = 'modal';
  m.innerHTML = '<div class="box"><h3>Pull photos from video</h3><p class="note" style="margin-bottom:.5rem">Scrub to the moment that shows the problem, then tap Grab frame. Grab as many as you need.</p>' +
    '<video playsinline controls muted preload="metadata" src="' + url + '"></video>' +
    '<div class="row" style="margin-top:.6rem"><button class="btn primary" data-g="grab">📸 Grab frame</button><span class="note" data-g="count">0 grabbed</span><span class="spacer"></span><button class="btn" data-g="done">Done</button></div></div>';
  document.body.appendChild(m);
  const v = m.querySelector('video'); let n = 0;
  v.addEventListener('loadedmetadata', () => { try { v.currentTime = Math.min(0.5, v.duration / 2); } catch (e) {} });
  m.addEventListener('click', async ev => {
    const g = ev.target.closest('[data-g]'); if (!g) return;
    if (g.dataset.g === 'done') { URL.revokeObjectURL(url); m.remove(); save(true); render(); return; }
    if (g.dataset.g === 'grab') {
      if (!v.videoWidth) { toast('Video still loading — press play once, then grab.'); return; }
      g.disabled = true;
      try { const d = await compress(v, 1400); const id = await storePhoto(d, { kind: tgt.kind, ref: tgt.id, fromVideo: file.name, t: Math.round(v.currentTime * 10) / 10 }); attach(tgt, id); n++; m.querySelector('[data-g=count]').textContent = n + ' grabbed'; save(); } catch (e) {}
      g.disabled = false;
    }
  });
}
function viewPhoto(id) {
  const m = document.createElement('div'); m.className = 'modal';
  m.innerHTML = '<div class="box"><img src="' + photoCache[id] + '" alt=""><div class="row" style="margin-top:.6rem"><span class="spacer"></span><button class="btn">Close</button></div></div>';
  m.addEventListener('click', () => m.remove()); document.body.appendChild(m);
}
function photoStrip(photos, tgt) {
  return '<div class="photos">' + (photos || []).map(id => photoCache[id]
    ? '<div class="photo"><img src="' + photoCache[id] + '" data-act="ph-view" data-id="' + id + '" alt=""><button data-act="ph-del" data-id="' + id + '" data-kind="' + tgt.kind + '" data-ref="' + tgt.id + '" aria-label="Remove photo">×</button></div>'
    : '<div class="photo" title="Loading or missing"></div>').join('') +
    '<button class="addph" data-act="ph-add" data-kind="' + tgt.kind + '" data-ref="' + tgt.id + '"><span style="font-size:1.2rem">＋</span>Photo / video</button></div>';
}

// ── UI state & routing ───────────────────────────────────────────────
const qp = new URLSearchParams(location.search);
const ui = { tab: qp.get('tab') || 'setup' };
const TABS = [['setup', 'Setup'], ['assets', 'Assets'], ['checks', 'Checks'], ['findings', 'Findings'], ['claude', 'Claude draft'], ['report', 'Report'], ['handoff', 'Debrief & handoff']];

async function render() {
  const id = qp.get('id');
  if (!id) return renderList();
  cur = cur && cur.id === id ? cur : load(id);
  if (!cur) { $('main').innerHTML = '<div class="empty">Audit not found. <a href="audit-tool.html">Back to all audits</a></div>'; return; }
  if (photosLoadedFor !== cur.id) { loadPhotos(cur.id).then(got => { if (got && cur) render(); }); }
  const sc = score(cur);
  const c = cur.client;
  let h = '<div class="kicker">Zero-Risk Building Performance Audit · ' + esc(TIERS[cur.tier].label) + ' · ' + money(cur.fee) + '</div>' +
    '<h1>' + esc(c.building || c.company || 'New audit') + '</h1>' +
    '<div class="row" style="font-size:.85rem"><span class="muted">' + esc([c.company, c.address].filter(Boolean).join(' · ')) + '</span>' +
    '<span class="badge ' + STATUS[cur.status].cls + '">' + STATUS[cur.status].label + '</span></div>' +
    scoreRow(sc) +
    '<div class="tabs" role="tablist">' + TABS.map(([k, l]) => '<button data-act="tab" data-tab="' + k + '" class="' + (ui.tab === k ? 'on' : '') + '">' + l + '</button>').join('') + '</div>';
  h += ({ setup: tabSetup, assets: tabAssets, checks: tabChecks, findings: tabFindings, claude: tabClaude, report: tabReport, handoff: tabHandoff }[ui.tab] || tabSetup)(sc);
  $('main').innerHTML = h;
}
function scoreRow(sc) {
  return '<div class="score-row">' + CATS.map(ct => '<div><b style="color:' + catColor(sc.cats[ct.key]) + '">' + sc.cats[ct.key] + '<small style="font-size:.8rem;color:rgba(16,68,78,.45)">/20</small></b><span>' + ct.short + '</span></div>').join('') +
    '<div class="total"><b>' + sc.total + ' · ' + sc.grade.l + '</b><span>Overall /100</span></div></div>';
}

// ── list view ────────────────────────────────────────────────────────
function renderList() {
  cur = null;
  const all = list();
  const open = all.filter(a => !['won', 'lost'].includes(a.status));
  const won = all.filter(a => a.status === 'won').length, closed = all.filter(a => ['won', 'lost'].includes(a.status)).length;
  let h = '<div class="kicker">Sales · Building Performance Audit</div><h1>Audits</h1>' +
    '<div class="row" style="margin-top:.6rem"><button class="btn primary" data-act="new">＋ New audit</button><span class="note">' + all.length + ' total · ' + open.length + ' open · ' +
    (closed ? Math.round(won / closed * 100) + '% audit → agreement' : 'no closed audits yet') + '</span></div>';
  if (!all.length) { $('main').innerHTML = h + '<div class="card empty" style="margin-top:1rem">No audits yet. Create one when a pre-call books.</div>'; return; }
  h += '<h2>All audits <span class="note">Credit deadline = debrief + 45 days</span></h2><div class="tbl-wrap"><table><thead><tr><th>Building</th><th>Client</th><th>Status</th><th>Visit</th><th>Debrief</th><th>Score</th><th>Fee</th><th>Credit deadline</th></tr></thead><tbody>' +
    all.map(a => {
      const sc = score(a); const dl = a.debriefDate ? addDays(a.debriefDate, 45) : ''; const left = daysUntil(dl);
      const dlCell = !dl ? '—' : a.status === 'won' || a.status === 'lost' ? fmtD(dl) : fmtD(dl) + ' <span class="badge ' + (left < 0 ? 'b-grey' : left <= 7 ? 'b-crit' : 'b-teal') + '">' + (left < 0 ? 'expired' : left + 'd') + '</span>';
      return '<tr class="clickable" data-act="open" data-id="' + a.id + '"><td><b>' + esc(a.client.building || '(unnamed)') + '</b></td><td>' + esc(a.client.company) + '</td><td><span class="badge ' + STATUS[a.status].cls + '">' + STATUS[a.status].label + '</span></td>' +
        '<td>' + fmtD(a.visitDate) + '</td><td>' + fmtD(a.debriefDate) + '</td><td>' + (a.assets.length ? sc.total + ' · ' + sc.grade.l : '—') + '</td><td>' + money(a.fee) + '</td><td>' + dlCell + '</td></tr>';
    }).join('') + '</tbody></table></div>';
  $('main').innerHTML = h;
}

// ── field builders ───────────────────────────────────────────────────
function fld(label, path, opts) {
  opts = opts || {};
  const v = getPath(cur, path);
  const attrs = 'data-f="' + path + '"' + (opts.num ? ' data-num="1"' : '') + (opts.rr ? ' data-rr="1"' : '');
  let ctl;
  if (opts.options) ctl = '<select class="sel" ' + attrs + '>' + opts.options.map(o => { const [val, lab] = Array.isArray(o) ? o : [o, o]; return '<option value="' + esc(val) + '"' + (String(v) === String(val) ? ' selected' : '') + '>' + esc(lab) + '</option>'; }).join('') + '</select>';
  else if (opts.area) ctl = '<textarea class="inp" ' + attrs + ' placeholder="' + esc(opts.ph || '') + '">' + esc(v) + '</textarea>';
  else ctl = '<input class="inp" type="' + (opts.type || 'text') + '" ' + attrs + ' value="' + esc(v) + '" placeholder="' + esc(opts.ph || '') + '"' + (opts.type === 'number' || opts.num ? ' inputmode="decimal"' : '') + '>';
  return '<label class="fld' + (opts.wide ? ' wide' : '') + '">' + esc(label) + ctl + '</label>';
}
function chk(label, path, opts) {
  const v = getPath(cur, path);
  return '<label class="chk"><input type="checkbox" data-f="' + path + '" data-rr="1"' + (v ? ' checked' : '') + '><span>' + esc(label) + '</span>' + (opts && opts.pts ? '<span class="pts">−' + opts.pts + '</span>' : '') + '</label>';
}

// ── tab: setup ───────────────────────────────────────────────────────
function tabSetup() {
  const dep = Math.round((num(cur.fee) || 0) * 0.1);
  return '<h2>Client & building</h2><div class="card"><div class="grid">' +
    fld('Company / owner', 'client.company') + fld('Building name', 'client.building') + fld('Address', 'client.address') +
    fld('Contact name', 'client.contact') + fld('Contact title', 'client.title') + fld('Email', 'client.email', { type: 'email' }) + fld('Phone', 'client.phone', { type: 'tel' }) +
    fld('Decision-maker (must attend debrief)', 'client.decisionMaker') +
    fld('Size (sq ft)', 'client.sqft', { num: true }) + fld('Year built', 'client.yearBuilt', { num: true }) + fld('Occupancy / tenants', 'client.occupancy', { ph: 'Office, data room, food service…' }) +
    fld('BAS platform', 'client.bas', { ph: 'Metasys, Niagara, Delta, none…' }) + fld('Current contractor', 'client.contractor') +
    fld('Hook used', 'client.hook', { options: [['', '—'], ['A', 'A — Risk'], ['B', 'B — Cost'], ['C', 'C — Vendor']] }) +
    fld('Booked by', 'client.source') +
    '</div><div style="margin-top:.6rem">' + chk('Critical occupancy (data, healthcare, food, process) — pushes recommendation to Premium', 'client.critical') + '</div>' +
    '<div class="grid" style="margin-top:.4rem">' + fld('Pains from the pre-call (their words)', 'client.pains', { area: true, wide: true, ph: 'Why now, last surprise, what it cost, contractor visibility…' }) + '</div></div>' +
    '<h2>Fee, deposit & dates</h2><div class="card"><div class="grid">' +
    fld('Audit tier', 'tier', { options: Object.keys(TIERS).map(k => [k, TIERS[k].label + ' — ' + money(TIERS[k].fee) + (k === 'portfolio' ? '+' : '')]), rr: true }) +
    fld('Audit fee ($)', 'fee', { num: true, rr: true }) +
    fld('10% deposit taken (date)', 'depositDate', { type: 'date' }) + fld('Balance paid (date)', 'balanceDate', { type: 'date' }) +
    fld('Site visit date', 'visitDate', { type: 'date', rr: true }) + fld('Debrief date', 'debriefDate', { type: 'date', rr: true }) +
    fld('Status', 'status', { options: Object.keys(STATUS).map(k => [k, STATUS[k].label]), rr: true }) +
    '</div><div class="callout info" style="margin-top:.7rem">' + esc(TIERS[cur.tier].desc) + '. Deposit <b>' + money(dep) + '</b> by credit card at booking; balance <b>' + money((num(cur.fee) || 0) - dep) + '</b> due on receipt with the report.' +
    (cur.debriefDate ? ' Credit deadline: <b>' + fmtD(addDays(cur.debriefDate, 45)) + '</b>.' : '') +
    (cur.visitDate && cur.debriefDate && daysUntil(cur.debriefDate) - daysUntil(cur.visitDate) > 7 ? '<br><b style="color:#7a3b10">Debrief is more than 5 business days after the visit — playbook SLA.</b>' : '') + '</div></div>' +
    '<div class="row" style="margin-top:1.4rem"><span class="spacer"></span><button class="btn danger sm" data-act="delete-audit">Delete audit</button></div>';
}

// ── tab: assets ──────────────────────────────────────────────────────
function tabAssets(sc) {
  const rows = cur.assets.map((x, i) => {
    const r = risk(x), b = band(r);
    return '<tr><td><input class="inp" style="width:84px" data-f="assets.' + i + '.tag" value="' + esc(x.tag) + '"></td>' +
      '<td><select class="sel" data-f="assets.' + i + '.type">' + ASSET_TYPES.map(t => '<option' + (t === x.type ? ' selected' : '') + '>' + t + '</option>').join('') + '</select></td>' +
      '<td><input class="inp" data-f="assets.' + i + '.make" value="' + esc(x.make) + '" placeholder="Make / model"></td>' +
      '<td><input class="inp" style="width:70px" data-f="assets.' + i + '.year" data-num="1" inputmode="numeric" value="' + esc(x.year) + '"></td>' +
      '<td><input class="inp" data-f="assets.' + i + '.serves" value="' + esc(x.serves) + '" placeholder="Area served"></td>' +
      '<td><select class="sel" data-f="assets.' + i + '.cond" data-num="1" data-rr="1"><option value="">—</option>' + [5, 4, 3, 2, 1].map(n => '<option value="' + n + '"' + (x.cond == n ? ' selected' : '') + '>' + n + ' · ' + COND[n] + '</option>').join('') + '</select></td>' +
      '<td><select class="sel" data-f="assets.' + i + '.crit" data-num="1" data-rr="1"><option value="">—</option>' + [5, 4, 3, 2, 1].map(n => '<option value="' + n + '"' + (x.crit == n ? ' selected' : '') + '>' + n + ' · ' + CRIT[n] + '</option>').join('') + '</select></td>' +
      '<td>' + (r == null ? '<span class="badge b-grey">Unscored</span>' : '<span class="badge b-' + b + '">' + r + ' · ' + BAND_LABEL[b] + '</span>') + (x.ai ? ' <span class="badge b-purple" title="Score suggested by Claude — confirm">AI</span>' : '') + '</td>' +
      '<td style="white-space:nowrap"><button class="btn sm" data-act="asset-more" data-i="' + i + '">' + (ui.assetOpen === x.id ? 'Less' : 'Notes · ' + ((x.photos || []).length) + '📷') + '</button> <button class="btn sm danger" data-act="asset-del" data-i="' + i + '" aria-label="Delete asset">×</button></td></tr>' +
      (ui.assetOpen === x.id ? '<tr><td colspan="9" style="background:var(--soft)"><div class="grid">' +
        '<label class="fld">Serial<input class="inp" data-f="assets.' + i + '.serial" value="' + esc(x.serial) + '"></label>' +
        '<label class="fld">Location<input class="inp" data-f="assets.' + i + '.location" value="' + esc(x.location) + '"></label>' +
        '<label class="fld wide">Notes (dictate on site)<textarea class="inp" data-f="assets.' + i + '.notes">' + esc(x.notes) + '</textarea></label></div>' +
        photoStrip(x.photos, { kind: 'asset', id: x.id }) + '</td></tr>' : '');
  }).join('');
  return '<h2>Asset register <span class="note">Risk = (6 − Condition) × Criticality · 20–25 Critical · 12–19 High · 6–11 Moderate · 1–5 Low</span></h2>' +
    '<div class="row" style="margin-bottom:.6rem"><button class="btn primary" data-act="asset-add">＋ Add asset</button><button class="btn" data-act="asset-add5">＋ Add 5</button>' +
    '<span class="note">' + cur.assets.length + ' assets · ' + sc.cnt.crit + ' critical · ' + sc.cnt.high + ' high · ' + sc.cnt.mod + ' moderate' + (sc.unscored ? ' · <b>' + sc.unscored + ' unscored</b>' : '') + '</span></div>' +
    (cur.assets.length ? '<div class="tbl-wrap"><table><thead><tr><th>Tag</th><th>Type</th><th>Make / model</th><th>Year</th><th>Serves</th><th>Condition</th><th>Criticality</th><th>Risk</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '<div class="card empty">No assets yet. Photograph every nameplate; one row per major unit.</div>') +
    '<div class="callout info">Equipment Risk score: 20 − 5 per Critical − 2 per High − 1 per 3 Moderate = <b>' + sc.cats.equip + '/20</b></div>';
}

// ── tab: checks ──────────────────────────────────────────────────────
function tabChecks(sc) {
  return '<p class="note" style="margin-top:1rem">Tick what you observed. Each category starts at 20; ticks deduct per the playbook. Equipment Risk is scored from the asset register.</p>' +
    ['bas', 'energy', 'comfort', 'vendor'].map(c => {
      const ct = CATS.find(x => x.key === c);
      return '<h2>' + ct.n + '. ' + ct.label + ' <span class="badge" style="background:' + catColor(sc.cats[c]) + '22;color:' + catColor(sc.cats[c]) + '">' + sc.cats[c] + '/20 · ' + catBand(sc.cats[c]) + '</span></h2><div class="card">' +
        CHECKS[c].map(([k, pts, label, type, max]) => type === 'n'
          ? '<label class="chk" style="cursor:default"><span>' + esc(label) + '</span><span class="pts"><select class="sel" style="width:auto" data-f="checks.' + c + '.' + k + '" data-num="1" data-rr="1">' + [0, 1, 2, 3].map(n => '<option value="' + n + '"' + ((Number(cur.checks[c][k]) || 0) === n ? ' selected' : '') + '>' + n + ' zone' + (n === 1 ? '' : 's') + '</option>').join('') + '</select></span></label>'
          : chk(label, 'checks.' + c + '.' + k, { pts })).join('') +
        '<div style="margin-top:.5rem">' + fld('Notes for this category', 'checkNotes.' + c, { area: true }) + '</div></div>';
    }).join('');
}

// ── tab: findings ────────────────────────────────────────────────────
function tabFindings() {
  const n = actionable(cur);
  const assetOpts = [['', '— none —']].concat(cur.assets.map(x => [x.id, (x.tag || '?') + ' · ' + x.type]));
  return '<div class="callout ' + (n >= 3 ? 'ok' : 'warn') + '" style="margin-top:1rem"><b>' + n + ' actionable finding' + (n === 1 ? '' : 's') + '.</b> ' +
    (n >= 3 ? 'Findings guarantee met.' : 'The guarantee needs at least 3 the client would act on.') + ' Use the iPhone keyboard mic to dictate observations on site.</div>' +
    '<div class="row"><button class="btn primary" data-act="f-add">＋ Add finding</button><button class="btn" data-act="f-fromassets">＋ Findings from Critical/High assets</button></div><div style="margin-top:.8rem">' +
    (cur.findings.length ? cur.findings.map((f, i) => '<div class="finding' + (f.ai ? ' ai' : '') + '">' +
      '<div class="top"><b style="font-family:Oswald;font-size:1rem">#' + (i + 1) + '</b>' + (f.ai ? '<span class="badge b-purple">Claude draft — review</span>' : '') +
      '<span class="spacer"></span><button class="btn sm" data-act="f-up" data-i="' + i + '" ' + (i ? '' : 'disabled') + '>↑</button><button class="btn sm" data-act="f-down" data-i="' + i + '" ' + (i < cur.findings.length - 1 ? '' : 'disabled') + '>↓</button>' +
      (f.ai ? '<button class="btn sm" data-act="f-ok" data-i="' + i + '">✓ Reviewed</button>' : '') + '<button class="btn sm danger" data-act="f-del" data-i="' + i + '">Delete</button></div>' +
      '<div class="grid">' +
      '<label class="fld wide">Finding (headline)<input class="inp" data-f="findings.' + i + '.title" value="' + esc(f.title) + '" placeholder="e.g. RTU-3 heat exchanger cracked — CO risk"></label>' +
      '<label class="fld">Category<select class="sel" data-f="findings.' + i + '.category" data-num="1">' + CATS.map(c => '<option value="' + c.n + '"' + (f.category == c.n ? ' selected' : '') + '>' + c.n + '. ' + c.label + '</option>').join('') + '</select></label>' +
      '<label class="fld">Asset<select class="sel" data-f="findings.' + i + '.assetId">' + assetOpts.map(([v, l]) => '<option value="' + esc(v) + '"' + (f.assetId === v ? ' selected' : '') + '>' + esc(l) + '</option>').join('') + '</select></label>' +
      '<label class="fld">Timing<select class="sel" data-f="findings.' + i + '.timing" data-rr="1">' + Object.keys(TIMING).map(k => '<option value="' + k + '"' + (f.timing === k ? ' selected' : '') + '>' + TIMING[k] + '</option>').join('') + '</select></label>' +
      '<label class="fld">Cost low ($)<input class="inp" inputmode="decimal" data-f="findings.' + i + '.costLow" data-num="1" value="' + esc(f.costLow) + '"></label>' +
      '<label class="fld">Cost high ($)<input class="inp" inputmode="decimal" data-f="findings.' + i + '.costHigh" data-num="1" value="' + esc(f.costHigh) + '"></label>' +
      '<label class="fld wide">What we found (dictate on site)<textarea class="inp" data-f="findings.' + i + '.observation">' + esc(f.observation) + '</textarea></label>' +
      '<label class="fld wide">Why it matters (cost, comfort, risk, compliance)<textarea class="inp" data-f="findings.' + i + '.why">' + esc(f.why) + '</textarea></label>' +
      '<label class="fld wide">Recommended action<textarea class="inp" data-f="findings.' + i + '.action" style="min-height:56px">' + esc(f.action) + '</textarea></label>' +
      '</div><label class="chk"><input type="checkbox" data-f="findings.' + i + '.agreed" data-rr="1"' + (f.agreed !== false ? ' checked' : '') + '><span>Actionable — counts toward the 3-finding guarantee</span></label>' +
      photoStrip(f.photos, { kind: 'finding', id: f.id }) + '</div>').join('') : '<div class="card empty">No findings yet.</div>') + '</div>';
}

// ── tab: Claude draft (V1 round trip) ────────────────────────────────
function claudePacket() {
  const byId = Object.fromEntries(cur.assets.map(x => [x.id, x]));
  return {
    alpine_audit_packet: 1,
    building: { name: cur.client.building, company: cur.client.company, sqft: cur.client.sqft, yearBuilt: cur.client.yearBuilt, occupancy: cur.client.occupancy, criticalOccupancy: !!cur.client.critical, bas: cur.client.bas, contractor: cur.client.contractor, pains: cur.client.pains, auditDate: cur.visitDate },
    assets: cur.assets.map(x => ({ tag: x.tag, type: x.type, make: x.make, year: x.year, serves: x.serves, location: x.location, cond: x.cond || null, crit: x.crit || null, notes: x.notes, photos: (x.photos || []).length })),
    checks: Object.fromEntries(['bas', 'energy', 'comfort', 'vendor'].map(c => [c, CHECKS[c].filter(([k]) => cur.checks[c][k]).map(([k, , l, type]) => type === 'n' ? l + ': ' + cur.checks[c][k] : l)])),
    checkNotes: cur.checkNotes,
    findings: cur.findings.map(f => ({ id: f.id, title: f.title, category: f.category, assetTag: f.assetId && byId[f.assetId] ? byId[f.assetId].tag : '', timing: f.timing, costLow: f.costLow, costHigh: f.costHigh, observation: f.observation, why: f.why, action: f.action })),
    summary: cur.summary, energyNotes: cur.energyNotes, complianceNotes: cur.complianceNotes,
    score: (() => { const s = score(cur); return { total: s.total, grade: s.grade.l, categories: s.cats }; })()
  };
}
function tabClaude() {
  return '<h2>1 · Send to Claude</h2><div class="card"><p style="font-size:.88rem">Copies the full audit (assets, ticks, dictated notes, findings) as text. In the <b>ACQ Vantage – Building Audit</b> Claude project, start a chat, paste it, and type <b>“Draft this audit.”</b> Add photos or video stills to the same chat if you want Claude to read them too.</p>' +
    '<div class="row" style="margin-top:.6rem"><button class="btn primary" data-act="cl-copy">Copy for Claude</button><span class="note">' + cur.findings.length + ' findings · ' + cur.assets.length + ' assets</span></div></div>' +
    '<h2>2 · Import Claude’s draft</h2><div class="card"><p style="font-size:.88rem">Paste Claude’s JSON reply. It fills empty condition/criticality scores, polishes finding text, adds cost ranges, and writes the executive summary. Everything it touches is marked <span class="badge b-purple">Claude draft</span> until you review it. Scores you already set are never overwritten.</p>' +
    '<textarea class="inp" id="cl-in" style="min-height:160px;margin-top:.6rem;font-family:ui-monospace,Menlo,monospace;font-size:.78rem" placeholder="{ &quot;alpine_audit_draft&quot;: 1, … }"></textarea>' +
    '<div class="row" style="margin-top:.6rem"><button class="btn primary" data-act="cl-import">Import draft</button></div></div>' +
    '<h2>Executive summary <span class="note">Edit here or let Claude draft it</span></h2><div class="card"><div class="grid">' +
    fld('What’s working', 'summary.working', { area: true }) + fld('Biggest risk', 'summary.risk', { area: true }) +
    fld('Biggest opportunity', 'summary.opportunity', { area: true }) + fld('“If you do nothing” — most likely costly event in 12 months + cost range', 'summary.ifNothing', { area: true }) +
    fld('Energy opportunities', 'energyNotes', { area: true }) + fld('Vendor & compliance notes (factual, never name the incumbent)', 'complianceNotes', { area: true }) +
    fld('Recommended care level — why this tier fits', 'summary.careLevel', { area: true, wide: true }) + '</div></div>';
}
function importDraft(txt) {
  let d;
  const m = String(txt).match(/\{[\s\S]*\}/);
  try { d = JSON.parse(m ? m[0] : txt); } catch (e) { toast('That isn’t valid JSON — paste Claude’s whole reply.'); return; }
  if (!d || d.alpine_audit_draft !== 1) { toast('Missing "alpine_audit_draft": 1 — is this Claude’s audit draft?'); return; }
  let na = 0, nf = 0, nu = 0;
  const byTag = Object.fromEntries(cur.assets.map(x => [String(x.tag).toLowerCase(), x]));
  (d.assets || []).forEach(s => {
    const x = byTag[String(s.tag || '').toLowerCase()]; if (!x) return;
    let hit = false;
    if (!x.cond && [1, 2, 3, 4, 5].includes(Number(s.cond))) { x.cond = Number(s.cond); hit = true; }
    if (!x.crit && [1, 2, 3, 4, 5].includes(Number(s.crit))) { x.crit = Number(s.crit); hit = true; }
    if (hit) { x.ai = true; na++; }
  });
  const tagToId = Object.fromEntries(cur.assets.map(x => [String(x.tag).toLowerCase(), x.id]));
  (d.findings || []).forEach(s => {
    const fields = {
      title: s.title, observation: s.observation, why: s.why, action: s.action,
      category: [1, 2, 3, 4, 5].includes(Number(s.category)) ? Number(s.category) : undefined,
      timing: TIMING[s.timing] ? s.timing : undefined, costLow: num(s.costLow), costHigh: num(s.costHigh),
      assetId: s.assetTag ? tagToId[String(s.assetTag).toLowerCase()] : undefined
    };
    let f = s.id && cur.findings.find(x => x.id === s.id);
    if (f) nu++; else { f = { id: uid('f'), photos: [], agreed: true, category: 1, timing: 'next' }; cur.findings.push(f); nf++; }
    for (const k in fields) if (fields[k] != null && fields[k] !== '') f[k] = fields[k];
    f.ai = true;
  });
  if (d.summary) for (const k of ['working', 'risk', 'opportunity', 'ifNothing', 'careLevel']) if (d.summary[k]) cur.summary[k] = d.summary[k];
  if (d.energyNotes) cur.energyNotes = d.energyNotes;
  if (d.complianceNotes) cur.complianceNotes = d.complianceNotes;
  save(true);
  ui.tab = 'findings'; render();
  toast('Imported: ' + nf + ' new findings, ' + nu + ' updated, ' + na + ' assets scored. Review the purple items.');
}

// ── tab: report ──────────────────────────────────────────────────────
function tabReport() {
  const sc = score(cur);
  const issues = [];
  if (sc.unscored) issues.push(sc.unscored + ' asset(s) unscored');
  if (actionable(cur) < 3) issues.push('fewer than 3 actionable findings');
  const noPhoto = cur.findings.filter(f => !(f.photos || []).length).length; if (noPhoto) issues.push(noPhoto + ' finding(s) without a photo');
  const aiLeft = cur.findings.filter(f => f.ai).length + cur.assets.filter(x => x.ai).length; if (aiLeft) issues.push(aiLeft + ' Claude draft item(s) not reviewed');
  const noCost = cur.findings.filter(f => num(f.costLow) == null).length; if (noCost) issues.push(noCost + ' finding(s) without a cost range');
  if (!cur.summary.risk) issues.push('executive summary empty');
  return '<div class="row" style="margin:1rem 0"><button class="btn primary" data-act="print">Download PDF</button><span class="note">Prints the report below — choose “Save as PDF”.</span></div>' +
    (issues.length ? '<div class="callout warn"><b>QA before the debrief:</b> ' + issues.join(' · ') + '</div>' : '<div class="callout ok"><b>QA passed.</b> Ready for Jake’s sign-off.</div>') +
    reportHtml(sc);
}
function reportHtml(sc) {
  const a = cur, c = a.client, g = sc.grade, rt = recTier(a, sc), pt = planTotals(a);
  const assetsById = Object.fromEntries(a.assets.map(x => [x.id, x]));
  const reg = a.assets.slice().sort((x, y) => (risk(y) || 0) - (risk(x) || 0));
  const tot = [pt.now[0] + pt.next[0] + pt.plan[0], pt.now[1] + pt.next[1] + pt.plan[1]];
  const rng = (lo, hi) => lo || hi ? money(lo) + (hi && hi !== lo ? ' – ' + money(hi) : '') : '—';
  const ordered = a.findings.slice().sort((x, y) => ['now', 'next', 'plan'].indexOf(x.timing) - ['now', 'next', 'plan'].indexOf(y.timing));
  const findBlock = f => {
    const as = f.assetId && assetsById[f.assetId];
    return '<div class="find"><h4>' + esc(f.title || 'Finding') + (as ? ' <span style="font-weight:400;color:#55666b">· ' + esc(as.tag) + '</span>' : '') + '</h4>' +
      (f.observation ? '<div><b>What we found:</b> ' + esc(f.observation) + '</div>' : '') +
      (f.why ? '<div><b>Why it matters:</b> ' + esc(f.why) + '</div>' : '') +
      (f.action ? '<div><b>Recommendation:</b> ' + esc(f.action) + ' <span style="color:#55666b">(' + TIMING[f.timing || 'plan'] + ' · ' + rng(num(f.costLow), num(f.costHigh)) + ')</span></div>' : '') +
      ((f.photos || []).filter(p => photoCache[p]).length ? '<div class="fphotos">' + f.photos.filter(p => photoCache[p]).map(p => '<img src="' + photoCache[p] + '" alt="">').join('') + '</div>' : '') + '</div>';
  };
  return '<div class="rpt" id="rpt">' +
    '<div class="head"><div><div style="font-family:Oswald;letter-spacing:.12em;color:#6C5D8D;font-size:11px">ALPINE HVAC SERVICE INC.</div><h1>Building Performance Audit</h1>' +
    '<div style="font-size:14px;margin-top:2px"><b>' + esc(c.building || c.company) + '</b></div><div style="color:#55666b">' + esc(c.address) + '</div></div>' +
    '<div class="meta">Audit date: ' + fmtD(a.visitDate) + '<br>Prepared for: ' + esc([c.contact, c.title].filter(Boolean).join(', ')) + '<br>' + esc(c.company) + '<br>Prepared by: Alpine HVAC</div></div>' +

    '<h2>Executive summary</h2>' +
    '<div class="grade"><span class="letter" style="background:' + g.c + '">' + g.l + '</span><b>' + sc.total + '<span style="font-size:18px;color:#7a888c">/100</span></b><span style="max-width:300px">' + esc(g.d) + '</span></div>' +
    (a.summary.working ? '<p><b>What’s working:</b> ' + esc(a.summary.working) + '</p>' : '') +
    (a.summary.risk ? '<p><b>Biggest risk:</b> ' + esc(a.summary.risk) + '</p>' : '') +
    (a.summary.opportunity ? '<p><b>Biggest opportunity:</b> ' + esc(a.summary.opportunity) + '</p>' : '') +
    (a.summary.ifNothing ? '<p><b>If nothing changes:</b> ' + esc(a.summary.ifNothing) + '</p>' : '') +
    '<p><b>24-month plan budget:</b> ' + rng(tot[0], tot[1]) + '</p>' +

    '<h2>Scorecard</h2><table><thead><tr><th>Category</th><th>Score</th><th style="width:40%"></th><th>Rating</th></tr></thead><tbody>' +
    CATS.map(ct => { const v = sc.cats[ct.key]; return '<tr><td>' + ct.n + '. ' + ct.label + '</td><td><b>' + v + '</b>/20</td><td><div class="bar"><i style="width:' + v * 5 + '%;background:' + catColor(v) + '"></i></div></td><td style="color:' + catColor(v) + ';font-weight:600">' + catBand(v) + '</td></tr>'; }).join('') +
    '<tr><td><b>Overall</b></td><td><b>' + sc.total + '</b>/100</td><td></td><td style="color:' + g.c + ';font-weight:700">Grade ' + g.l + '</td></tr></tbody></table>' +

    '<h2>Top findings</h2><table><thead><tr><th>#</th><th>Finding</th><th>Category</th><th>Cost range</th><th>Timing</th></tr></thead><tbody>' +
    (ordered.slice(0, 5).map((f, i) => '<tr><td>' + (i + 1) + '</td><td>' + esc(f.title) + '</td><td>' + esc((CATS.find(x => x.n == f.category) || CATS[0]).short) + '</td><td>' + rng(num(f.costLow), num(f.costHigh)) + '</td><td>' + TIMING[f.timing || 'plan'] + '</td></tr>').join('') || '<tr><td colspan="5">—</td></tr>') + '</tbody></table>' +

    '<h2 class="pb">Risk register</h2><p style="color:#55666b;font-size:11px">Risk = (6 − condition) × criticality. Condition and criticality on a 1–5 scale; higher risk first.</p>' +
    '<table><thead><tr><th>Asset</th><th>Type</th><th>Make / model</th><th>Year</th><th>Serves</th><th>Cond.</th><th>Crit.</th><th>Risk</th></tr></thead><tbody>' +
    (reg.map(x => { const r = risk(x), b = band(r); const col = { crit: '#9B2C2C', high: '#C2611F', mod: '#A9821F', low: '#2E7D57' }[b] || '#7a888c'; return '<tr><td><b>' + esc(x.tag) + '</b></td><td>' + esc(x.type) + '</td><td>' + esc(x.make) + '</td><td>' + esc(x.year) + '</td><td>' + esc(x.serves) + '</td><td>' + (x.cond || '—') + '</td><td>' + (x.crit || '—') + '</td><td style="color:' + col + ';font-weight:700">' + (r == null ? '—' : r + ' ' + BAND_LABEL[b]) + '</td></tr>'; }).join('') || '<tr><td colspan="8">—</td></tr>') + '</tbody></table>' +

    '<h2>Findings by category</h2>' +
    CATS.map(ct => { const fs = a.findings.filter(f => f.category == ct.n); const notes = ct.key === 'equip' ? '' : a.checkNotes[ct.key]; return fs.length || notes ? '<h4 style="font-size:13.5px;margin-top:16px">' + ct.n + '. ' + ct.label + ' — ' + sc.cats[ct.key] + '/20</h4>' + (notes ? '<p>' + esc(notes) + '</p>' : '') + fs.map(findBlock).join('') : ''; }).join('') +

    '<h2 class="pb">12–24 month prioritized plan</h2><table><thead><tr><th>Priority</th><th>Action</th><th>Category</th><th>Budget range</th></tr></thead><tbody>' +
    ['now', 'next', 'plan'].map((k, pi) => a.findings.filter(f => (f.timing || 'plan') === k).map(f => '<tr><td>' + (pi + 1) + ' — ' + TIMING[k] + '</td><td>' + esc(f.action || f.title) + '</td><td>' + esc((CATS.find(x => x.n == f.category) || CATS[0]).short) + '</td><td>' + rng(num(f.costLow), num(f.costHigh)) + '</td></tr>').join('')).join('') +
    '<tr><td colspan="3"><b>Total</b> (Now ' + rng(pt.now[0], pt.now[1]) + ' · Next ' + rng(pt.next[0], pt.next[1]) + ' · Plan ' + rng(pt.plan[0], pt.plan[1]) + ')</td><td><b>' + rng(tot[0], tot[1]) + '</b></td></tr></tbody></table>' +
    '<p style="color:#55666b;font-size:11px">Low end = repair / optimize; high end = replace. Labour at Alpine agreement rates ($130/hr Core &amp; Premium, $150/hr Minimum) vs $200/hr retail.</p>' +

    (a.energyNotes ? '<h2>Energy opportunities</h2><p>' + esc(a.energyNotes) + '</p>' : '') +
    (a.complianceNotes ? '<h2>Vendor &amp; compliance notes</h2><p>' + esc(a.complianceNotes) + '</p>' : '') +

    '<h2>Recommended care level: ' + rt.t + '</h2><p>' + esc(a.summary.careLevel || rt.why + '.') + '</p>' +
    '<p style="background:#F1EEF6;padding:8px 10px;border-radius:6px">Your audit fee of ' + money(a.fee) + ' is credited in full against the first year of an Alpine maintenance agreement signed by <b>' + (a.debriefDate ? fmtD(addDays(a.debriefDate, 45)) : '45 days after your debrief') + '</b>. This report is yours either way.</p>' +
    '<div class="foot"><span>Alpine HVAC Service Inc. · Commercial, Industrial &amp; Institutional · TSSA Reg. FS-R-51098</span><span>alpinehvac.ca</span></div></div>';
}
function printReport() {
  const t = document.title;
  $('print-root').innerHTML = reportHtml(score(cur));
  document.title = 'Building Performance Audit - ' + (cur.client.building || cur.client.company || 'Alpine');
  setTimeout(() => { window.print(); document.title = t; }, 150);
}

// ── tab: debrief & handoff ───────────────────────────────────────────
function tabHandoff(sc) {
  const rt = recTier(cur, sc);
  const dl = cur.debriefDate ? addDays(cur.debriefDate, 45) : '';
  const left = daysUntil(dl);
  const fu = [[3, 'Email recap — scorecard, recommended tier, credit deadline'], [10, 'Call — any questions from the decision-maker?'], [21, 'Email — seasonal risk tied to their top finding'], [40, 'Call — credit expires soon, lock it in?']];
  const annual = num(cur.outcome.annualValue);
  const credit = annual == null ? null : Math.min(num(cur.fee) || 0, annual);
  return '<h2>Recommendation</h2><div class="card"><div style="font-family:Oswald;font-size:1.5rem;color:var(--teal)">' + rt.t + '</div><div>' + esc(rt.why) + '.</div>' +
    '<div class="note" style="margin-top:.4rem">Premium: any Critical asset, Controls & BAS ≤ 8, or critical occupancy · Core: overall 55–84, no Critical · Minimum: 85+, low criticality</div></div>' +
    '<h2>Credit window</h2><div class="card">' + (dl
      ? '<div>Credit deadline <b>' + fmtD(dl) + '</b> ' + (left < 0 ? '<span class="badge b-grey">expired</span>' : '<span class="badge ' + (left <= 7 ? 'b-crit' : 'b-teal') + '">' + left + ' days left</span>') + '</div>' +
        '<h3 style="margin-top:.9rem">Follow-up cadence</h3>' + fu.map(([d, l]) => chk('Day ' + d + ' (' + fmtD(addDays(cur.debriefDate, d)) + ') — ' + l, 'followups.d' + d)).join('')
      : '<div class="muted">Set the debrief date on Setup to start the 45-day credit clock.</div>') + '</div>' +
    '<h2>Outcome</h2><div class="card"><div class="grid">' +
    fld('Status', 'status', { options: Object.keys(STATUS).map(k => [k, STATUS[k].label]), rr: true }) +
    fld('Signed tier', 'outcome.signedTier', { options: ['', 'Minimum', 'Core', 'Premium'] }) +
    fld('Signed date', 'outcome.signedDate', { type: 'date', rr: true }) +
    fld('First-year agreement value ($)', 'outcome.annualValue', { num: true, rr: true }) +
    fld('Lost reason', 'outcome.lostReason') + '</div>' +
    chk('Findings guarantee claimed (refund deposit + balance)', 'outcome.guaranteeClaimed') +
    (credit != null ? '<div class="callout info">Audit credit: <b>' + money(credit) + '</b>' + (credit < (num(cur.fee) || 0) ? ' (capped at annual agreement value)' : '') + ', applied evenly across first-year invoices — <b>' + money(credit / 4) + '</b> per quarterly invoice.' +
      (cur.outcome.signedDate && dl && cur.outcome.signedDate > dl ? '<br><b style="color:#7a3b10">Signed after the credit deadline — credit needs founder approval.</b>' : '') + '</div>' : '') + '</div>' +
    '<h2>Hand off to CLEAR reports <span class="note">Once signed and set up in BuildOps</span></h2><div class="card">' +
    '<p style="font-size:.88rem">Writes this audit’s asset register into the site’s CLEAR report as its starting baseline: condition 1–2 → red, 3 → yellow, 4–5 → green, with your notes. The first quarterly CLEAR report then builds from it — no re-survey. Audit findings are added to the notes of the asset they belong to.</p>' +
    '<div class="grid" style="margin-top:.6rem">' + fld('BuildOps property ID (from the site page URL, site.html?p=…)', 'clearPid') + '</div>' +
    '<div class="row" style="margin-top:.6rem"><button class="btn primary" data-act="clear-export"' + (cur.assets.length ? '' : ' disabled') + '>Create CLEAR baseline</button>' +
    (cur.clearExportedAt ? '<span class="note">Exported ' + esc(cur.clearExportedAt) + ' · <a href="site.html?p=' + encodeURIComponent(cur.clearPid) + '&view=clear">Open site CLEAR report</a></span>' : '') + '</div></div>';
}
async function exportClear() {
  const pid = String(cur.clearPid || '').trim();
  if (!pid) { toast('Enter the BuildOps property ID first.'); return; }
  const findingsByAsset = {};
  cur.findings.forEach(f => { if (f.assetId) (findingsByAsset[f.assetId] = findingsByAsset[f.assetId] || []).push(f); });
  const rows = cur.assets.filter(x => x.tag).map(x => {
    const notes = [x.notes].concat((findingsByAsset[x.id] || []).map(f => 'Audit ' + fmtD(cur.visitDate) + ': ' + (f.title || '') + (f.action ? ' — ' + f.action : ''))).filter(Boolean).join('\n');
    return { tag: x.tag, type: x.type, make: x.make, model: '', serial: x.serial || '', installDate: x.year ? x.year + '-01-01' : '', life: lifeFor(x.type),
      desc: '', condition: !x.cond ? 'green' : x.cond <= 2 ? 'red' : x.cond === 3 ? 'yellow' : 'green', notes, include: true, auto: false };
  });
  const base = { rows, summary: cur.summary.risk || '', source: 'Building Performance Audit ' + fmtD(cur.visitDate) };
  try {
    const { fs, db } = await fsApi();
    const ref = fs.doc(db, 'site_data', 'st_clearbase_' + pid);
    const ex = await fs.getDoc(ref);
    if (ex.exists() && !confirm('This site already has a CLEAR baseline. Replace it with the audit register?')) return;
    await fs.setDoc(ref, { value: JSON.stringify(base), updatedAt: Date.now() });
    cur.clearExportedAt = today(); save(true); render();
    toast('CLEAR baseline created for ' + rows.length + ' assets.');
  } catch (e) { toast(e && e.code === 'permission-denied' ? 'Not allowed to write site_data.' : 'Export failed — check connection.'); }
}

// ── events ───────────────────────────────────────────────────────────
function onField(el, final) {
  const p = el.dataset.f; if (!p || !cur) return;
  let v = el.type === 'checkbox' ? el.checked : el.value;
  if (el.dataset.num && el.type !== 'checkbox') v = v === '' ? '' : (num(v) == null ? v : num(v));
  setPath(cur, p, v);
  if (p === 'tier') { cur.fee = TIERS[v].fee; }
  if (/^assets\.\d+\.(cond|crit)$/.test(p)) { const x = cur.assets[Number(p.split('.')[1])]; if (x) x.ai = false; }
  save(!!el.dataset.rr);
  if (el.dataset.rr && final) render();
}
document.addEventListener('input', e => { if (e.target.dataset && e.target.dataset.f && e.target.tagName !== 'SELECT' && e.target.type !== 'checkbox') onField(e.target, false); });
document.addEventListener('change', e => { if (e.target.dataset && e.target.dataset.f) onField(e.target, true); });
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const act = el.dataset.act, i = Number(el.dataset.i);
  switch (act) {
    case 'new': { const a = blank(); localStorage.setItem(KEY + a.id, JSON.stringify(a)); location.href = 'audit-tool.html?id=' + a.id; break; }
    case 'open': location.href = 'audit-tool.html?id=' + el.dataset.id; break;
    case 'tab': ui.tab = el.dataset.tab; history.replaceState(null, '', 'audit-tool.html?id=' + cur.id + '&tab=' + ui.tab); render(); window.scrollTo(0, 0); break;
    case 'delete-audit':
      if (!confirm('Delete this audit and its photos? This cannot be undone.')) return;
      for (const id of cur.assets.flatMap(x => x.photos || []).concat(cur.findings.flatMap(f => f.photos || []))) await deletePhoto(id);
      localStorage.removeItem(KEY + cur.id); location.href = 'audit-tool.html'; break;
    case 'asset-add': case 'asset-add5': {
      const n = act === 'asset-add5' ? 5 : 1;
      for (let k = 0; k < n; k++) { const last = cur.assets[cur.assets.length - 1]; cur.assets.push({ id: uid('x'), tag: nextTag(last), type: last ? last.type : 'Rooftop unit', make: '', year: '', serves: '', location: '', serial: '', cond: '', crit: '', notes: '', photos: [] }); }
      save(true); render(); break;
    }
    case 'asset-del': if (confirm('Delete ' + (cur.assets[i].tag || 'this asset') + '?')) { for (const id of cur.assets[i].photos || []) await deletePhoto(id); cur.assets.splice(i, 1); save(true); render(); } break;
    case 'asset-more': ui.assetOpen = ui.assetOpen === cur.assets[i].id ? null : cur.assets[i].id; render(); break;
    case 'f-add': cur.findings.push({ id: uid('f'), title: '', category: 1, assetId: '', timing: 'next', costLow: '', costHigh: '', observation: '', why: '', action: '', agreed: true, photos: [] }); save(true); render(); setTimeout(() => window.scrollTo(0, document.body.scrollHeight), 50); break;
    case 'f-fromassets': {
      let n = 0;
      cur.assets.filter(x => ['crit', 'high'].includes(band(risk(x)))).forEach(x => {
        if (cur.findings.some(f => f.assetId === x.id)) return;
        cur.findings.push({ id: uid('f'), title: (x.tag || '') + ' — ' + BAND_LABEL[band(risk(x))].toLowerCase() + ' risk', category: 1, assetId: x.id, timing: band(risk(x)) === 'crit' ? 'now' : 'next', costLow: '', costHigh: '', observation: x.notes || '', why: '', action: '', agreed: true, photos: (x.photos || []).slice() }); n++;
      });
      save(true); render(); toast(n ? n + ' finding(s) added from high-risk assets.' : 'No Critical/High assets without a finding.'); break;
    }
    case 'f-del': if (confirm('Delete finding #' + (i + 1) + '?')) { for (const id of cur.findings[i].photos || []) if (!cur.assets.some(x => (x.photos || []).includes(id))) await deletePhoto(id); cur.findings.splice(i, 1); save(true); render(); } break;
    case 'f-up': if (i > 0) { [cur.findings[i - 1], cur.findings[i]] = [cur.findings[i], cur.findings[i - 1]]; save(true); render(); } break;
    case 'f-down': if (i < cur.findings.length - 1) { [cur.findings[i + 1], cur.findings[i]] = [cur.findings[i], cur.findings[i + 1]]; save(true); render(); } break;
    case 'f-ok': cur.findings[i].ai = false; save(true); render(); break;
    case 'ph-add': pickFiles({ kind: el.dataset.kind, id: el.dataset.ref }); break;
    case 'ph-view': viewPhoto(el.dataset.id); break;
    case 'ph-del': {
      if (!confirm('Remove this photo?')) return;
      const arr = el.dataset.kind === 'finding' ? cur.findings : cur.assets;
      const o = arr.find(x => x.id === el.dataset.ref); if (o) o.photos = (o.photos || []).filter(p => p !== el.dataset.id);
      const stillUsed = cur.assets.concat(cur.findings).some(x => (x.photos || []).includes(el.dataset.id));
      if (!stillUsed) await deletePhoto(el.dataset.id);
      save(true); render(); break;
    }
    case 'cl-copy': {
      const txt = 'Draft this audit.\n\n' + JSON.stringify(claudePacket(), null, 1);
      try { await navigator.clipboard.writeText(txt); toast('Copied. Paste it into the ACQ Vantage project chat.'); }
      catch (err) { const t = document.createElement('textarea'); t.value = txt; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); toast('Copied.'); }
      break;
    }
    case 'cl-import': importDraft($('cl-in').value); break;
    case 'print': printReport(); break;
    case 'clear-export': exportClear(); break;
  }
});
function nextTag(last) {
  if (!last || !last.tag) return 'RTU-1';
  const m = String(last.tag).match(/^(.*?)(\d+)$/);
  return m ? m[1] + (Number(m[2]) + 1) : last.tag + '-2';
}

// Expose pure functions for testing.
window.AP_AUDIT = { score, risk, band, recTier, grade, importDraft: t => importDraft(t), _set: a => { cur = normalize(a); } };

render();
})();
