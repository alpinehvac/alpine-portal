// ── Alpine HVAC — Service Agreement Tracker ─────────────────────────
// Loaded by cloud-sync.js after Firestore hydrate (collection:
// service_agreements_data). One localStorage key per record so two
// people editing different agreements never overwrite each other.
//
//   sa_agr_<SA#>     agreement record
//   sa_acct_<id>     unactive account record
//   sa_settings      campaign windows + last BuildOps sync date
//   sa_seeded_v1     seed marker
//
// Records are soft-deleted (deleted:true) so a stale browser copy can't
// resurrect them after another user removes them.

(function () {
'use strict';

const KEY = { agr: 'sa_agr_', acct: 'sa_acct_', settings: 'sa_settings', seeded: 'sa_seeded_v1' };
const session = (typeof apGetSession === 'function' && apGetSession()) || { name: 'Unknown', roles: [] };
const TODAY = startOfDay(new Date());

// Fields owned by BuildOps. Imports overwrite these; portal-only fields are never touched.
const BUILDOPS_FIELDS = ['name', 'customer', 'type', 'billing', 'startDate', 'endDate', 'acv', 'soldBy', 'pm', 'status', 'draftDate', 'maint', 'buildopsId', 'work'];
const BUILDOPS_BASE = 'https://live.buildops.com';
// BuildOps record IDs, captured Sep 30 2026 (applied once to existing records).
const BUILDOPS_IDS = {
  SA1030: '8435fca6-890d-493b-ac2d-2c1e30592b7d', SA1029: '72657c7d-84ae-4645-a5e3-d1bfb56427c3',
  SA1028: 'c9eaa918-37b9-460b-a27d-721be247131e', SA1027: '77b0a687-d749-430a-898a-81ccc2da7e34',
  SA1026: '13371c9b-4b60-494d-b7e8-0ff2cdcec61b', SA1025: 'af608e20-1e97-45b1-a91d-06c60d1cf78a',
  SA1024: '4ef79a95-e05f-4ce0-996a-799a88a5199f', SA1023: '1e663e1d-c306-4d81-8832-6ddbaf638981',
  SA1022: '57237755-9a75-4df6-9ea3-408287a4eb4a', SA1021: 'b0ec30a3-e94c-4c81-8992-45f2716d6d02',
  SA1020: '603aded9-7779-41a4-a20a-fb54ef17b4e5', SA1019: '439db2c3-9e49-4731-b10d-21ab9d5ba197',
  SA1018: 'a6cf9827-dc53-4e2e-b728-0025056ca136', SA1017: '3cfc9984-0bf4-4857-a3cf-f9f41470e507',
  SA1016: 'de4a137b-ebaf-4334-9d14-33f8a722f8ab', SA1010: 'd09dee80-2637-4a5f-84f9-05e2ea7d09df',
  SA1009: '8f81b204-1be6-4e57-9bb7-fb073a187709', SA1008: 'a6e91aa5-45ff-4bd9-8dc6-73eac589ebf6'
};
// Visit statuses that count as work done.
const DONE_RE = /complete|converted|closed|finished|invoiced/i;
const STAGES = ['Not Started', 'Proposal Sent', 'Renewed', 'Lost'];
const OUTREACH = ['Due', 'Contacted', 'Quoted', 'Booked', 'No Interest'];
const MAINT_STATUS = ['Scheduled', 'Completed', 'Skipped'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const DEFAULT_SETTINGS = {
  campaigns: [
    { month: 1, label: 'Mid-winter check-in' },
    { month: 3, label: 'Spring cooling start-up' },
    { month: 7, label: 'Mid-summer cooling check' },
    { month: 8, label: 'Fall heating start-up' }
  ],
  lastSync: '2026-09-30'
};

// ── SEED DATA (BuildOps snapshot, Sep 30 2026) ──────────────────────
const MPM_NOTE = ' ~33% gap on all MPM agreements; monthly billing stepped down Jan and Aug 2026. Confirm the correct figure.';
const SEED_AGREEMENTS = [
  ['SA1030', '3050 Harvester Road RTU & Ductless Split', 'McNab Partners', 'Recurring', '', '2026-09-01', '2027-12-31', 6457.56],
  ['SA1029', 'Halton Chemical Inc Boiler & RTU', 'Halton Chemical', 'Recurring', '', '2026-09-01', '2027-12-31', 6193.53],
  ['SA1028', 'HCE Service Agreement', 'HCE Telecom', 'Recurring', '', '2026-08-01', '2027-12-31', 3600],
  ['SA1027', 'Victoria Ave', 'Matt Sikkema', 'Non-Billable', 'Non-Billable', '2026-05-21', '', 0],
  ['SA1026', 'Port Colborne BIC Church', '', 'Non-Billable', 'Non-Billable', '2026-05-20', '', 0],
  ['SA1025', 'Wainfleet BIC', '', 'Non-Billable', 'Non-Billable', '2026-05-20', '', 0],
  ['SA1024', 'Water Treatment - PACE Solutions', 'Halton Chemical', 'Recurring', 'Quarterly', '2026-05-01', '', 1350],
  ['SA1023', 'Berg Equipment', 'Berg Equipment', 'Recurring', 'Quarterly', '2026-04-22', '', 7832.50,
    'QuickBooks: May quarterly invoice of $2,554.40 incl. HST annualizes to ~$9,042 pre-tax vs $7,832.50 in BuildOps. Confirm the correct figure.'],
  ['SA1020', 'David H Blanchard (38 James)', 'MPM', '', 'Monthly', '2025-08-01', '2028-07-31', 14369.80,
    'QuickBooks bills $304,096.14/yr pre-tax for SA1017 + SA1020 combined ($28,635.72/mo incl. HST) vs $231,748.05 in BuildOps.' + MPM_NOTE],
  ['SA1019', 'Finer Space (35 Yale)', 'MPM', '', 'Monthly', '2025-08-01', '2028-07-31', 4462.06,
    'QuickBooks bills $345,482.44/yr pre-tax for SA1018 + SA1019 combined ($32,532.93/mo incl. HST) vs $259,800.90 in BuildOps.' + MPM_NOTE],
  ['SA1018', 'Finer Space', 'MPM', '', 'Monthly', '2025-08-01', '2028-07-31', 255338.84,
    'QuickBooks bills $345,482.44/yr pre-tax for SA1018 + SA1019 combined ($32,532.93/mo incl. HST) vs $259,800.90 in BuildOps.' + MPM_NOTE],
  ['SA1017', 'David H Blanchard', 'MPM', '', 'Monthly', '2025-08-01', '2028-07-31', 217378.25,
    'QuickBooks bills $304,096.14/yr pre-tax for SA1017 + SA1020 combined ($28,635.72/mo incl. HST) vs $231,748.05 in BuildOps.' + MPM_NOTE],
  ['SA1016', 'Hunter Vine', 'MPM', '', 'Monthly', '2025-08-01', '2028-07-31', 13670.20,
    'QuickBooks bills $18,222.48/yr pre-tax ($1,715.95/mo incl. HST) vs $13,670.20 in BuildOps.' + MPM_NOTE],
  ['SA1010', 'Wainfleet Fire Central Station', '', '', '', '2025-09-01', '', 3262.50],
  ['SA1009', 'Wainfleet Fire Station #4', '', '', '', '2025-09-01', '', 1305],
  ['SA1008', 'Wainfleet Fire Station #3', '', '', '', '2025-09-01', '', 1305]
];
const SEED_DRAFTS = [
  ['SA1022', 'Grimsby YMCA', '2026-04-23'],
  ['SA1021', 'Welland YMCA', '2026-04-23']
];
const SEED_ACCOUNTS = [
  'Eveley International', 'GMI Building Management', 'Yokyst Limited', 'ServiceMaster', 'Barton Glass',
  'Dixon Autobody', 'Net Access', 'Royal Bank of Canada',
  'Markland Capital / Markland Real Estate Partner ILP (Simcoe warehouse)', 'Moody Concrete',
  'Christ Community Church', "Smiling Turtle Food & Beverages (Turtle Jack's)", 'Niagara Plastic Surgery Centre',
  'ParemTech Inc.', 'Kelly Lukassen', 'James Samuel'
];

// ── STATE ────────────────────────────────────────────────────────────
let agreements = [];
let accounts = [];
let settings = null;
let ui = { tab: 'active', regSearch: '', regType: '', regFlag: '', acctSearch: '', acctStatus: '', drawerId: null, drawerKind: null };

// ── DATE HELPERS (local dates, no timezone drift) ────────────────────
function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function parseD(s) {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function isoD(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function fmtD(s) {
  const d = typeof s === 'string' ? parseD(s) : s;
  if (!d) return '—';
  return MONTHS[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
}
function addYears(s, n) {
  const d = parseD(s);
  const out = new Date(d.getFullYear() + n, d.getMonth(), d.getDate());
  if (out.getMonth() !== d.getMonth()) out.setDate(0); // Feb 29 → Feb 28
  return isoD(out);
}
function addDays(s, n) { const d = parseD(s); d.setDate(d.getDate() + n); return isoD(d); }
function diffDays(a, b) { return Math.round((a - b) / 86400000); }

// Jake's rule: no BuildOps end date → start + 1 year − 1 day.
function ruleEnd(start) { return start ? addDays(addYears(start, 1), -1) : ''; }
function effEnd(a) { return a.endDate || ruleEnd(a.startDate); }
function daysToEnd(a) { const e = parseD(effEnd(a)); return e ? diffDays(e, TODAY) : null; }

function renewalBadge(a) {
  const d = daysToEnd(a);
  if (d === null) return '<span class="badge b-ok">No dates</span>';
  if (d < 0) return '<span class="badge b-overdue">Renewal overdue</span>';
  if (d <= 30) return '<span class="badge b-30">' + d + ' days</span>';
  if (d <= 60) return '<span class="badge b-60">' + d + ' days</span>';
  if (d <= 90) return '<span class="badge b-90">' + d + ' days</span>';
  return '<span class="badge b-ok">' + d + ' days</span>';
}

// ── FORMAT HELPERS ───────────────────────────────────────────────────
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function money(n, cents) {
  if (n === null || n === undefined || n === '' || isNaN(n)) return '—';
  return '$' + Number(n).toLocaleString('en-CA', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
}
function num(v) { const n = parseFloat(String(v).replace(/[$,\s]/g, '')); return isNaN(n) ? null : n; }
function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || ('acct-' + Date.now()); }

// ── STORAGE ──────────────────────────────────────────────────────────
function readJSON(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
function stamp(r) { r.updatedAt = Date.now(); r.updatedBy = session.name; return r; }
function saveAgr(a) { localStorage.setItem(KEY.agr + a.id, JSON.stringify(stamp(a))); }
function saveAcct(a) { localStorage.setItem(KEY.acct + a.id, JSON.stringify(stamp(a))); }
function saveSettings() { localStorage.setItem(KEY.settings, JSON.stringify(settings)); }
function logHist(r, text) { (r.history = r.history || []).unshift({ at: isoD(new Date()), by: session.name, text }); }

function blankAgreement(id) {
  return {
    id, name: '', customer: '', type: '', billing: '', startDate: '', endDate: '', acv: null,
    soldBy: '', pm: '', status: 'Active', draftDate: '', maint: [], buildopsId: '', work: null,
    renewalStage: 'Not Started', renewalOwner: '', priceIncrease: null, notes: '', flag: '',
    history: [], deleted: false
  };
}

function seedIfNeeded() {
  if (localStorage.getItem(KEY.seeded)) return;
  SEED_AGREEMENTS.forEach(r => {
    if (localStorage.getItem(KEY.agr + r[0])) return;
    const a = blankAgreement(r[0]);
    Object.assign(a, { name: r[1], customer: r[2], type: r[3], billing: r[4], startDate: r[5], endDate: r[6], acv: r[7], flag: r[8] || '' });
    logHist(a, 'Imported from BuildOps snapshot');
    saveAgr(a);
  });
  SEED_DRAFTS.forEach(r => {
    if (localStorage.getItem(KEY.agr + r[0])) return;
    const a = blankAgreement(r[0]);
    Object.assign(a, { name: r[1], customer: 'YMCA', status: 'Draft', draftDate: r[2] });
    logHist(a, 'Imported from BuildOps snapshot (draft, quote date estimated from ~160 days open)');
    saveAgr(a);
  });
  SEED_ACCOUNTS.forEach(name => {
    const id = slug(name);
    if (localStorage.getItem(KEY.acct + id)) return;
    saveAcct({ id, name, contact: '', lastService: '', source: 'QuickBooks, last 14 mo', notes: '', campaigns: {}, history: [], deleted: false });
  });
  if (!localStorage.getItem(KEY.settings)) localStorage.setItem(KEY.settings, JSON.stringify(DEFAULT_SETTINGS));
  localStorage.setItem(KEY.seeded, new Date().toISOString());
}

function migrateBuildopsIds() {
  if (localStorage.getItem('sa_migrated_v2')) return;
  Object.keys(BUILDOPS_IDS).forEach(id => {
    const a = readJSON(KEY.agr + id);
    if (a && !a.deleted && !a.buildopsId) { a.buildopsId = BUILDOPS_IDS[id]; saveAgr(a); }
  });
  localStorage.setItem('sa_migrated_v2', new Date().toISOString());
}

function loadAll() {
  agreements = []; accounts = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k.startsWith(KEY.agr)) { const r = readJSON(k); if (r && !r.deleted) agreements.push(r); }
    else if (k.startsWith(KEY.acct)) { const r = readJSON(k); if (r && !r.deleted) accounts.push(r); }
  }
  settings = readJSON(KEY.settings) || JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  if (!Array.isArray(settings.campaigns) || !settings.campaigns.length) settings.campaigns = DEFAULT_SETTINGS.campaigns.slice();
  agreements.sort((a, b) => b.id.localeCompare(a.id, undefined, { numeric: true }));
  accounts.sort((a, b) => a.name.localeCompare(b.name));
}
const findAgr = id => agreements.find(a => a.id === id);
const findAcct = id => accounts.find(a => a.id === id);

// ── MAINTENANCE PROGRESS ─────────────────────────────────────────────
function maintStats(a) {
  const rows = a.maint || [];
  const s = { total: rows.length, done: 0, skipped: 0, late: 0, budget: 0, dueToDate: 0 };
  rows.forEach(r => {
    s.budget += num(r.budgetHrs) || 0;
    const due = parseD(r.due);
    if (due && due <= TODAY) s.dueToDate++;
    if (r.status === 'Completed') s.done++;
    else if (r.status === 'Skipped') s.skipped++;
    else if (due && due < TODAY) s.late++;
  });
  return s;
}
function progHTML(a) {
  const s = maintStats(a);
  if (!s.total) return '<span class="muted" style="font-size:.75rem">Not loaded</span>';
  const pct = n => (n / s.total * 100).toFixed(1) + '%';
  return '<div class="prog" title="' + s.done + ' completed, ' + s.skipped + ' skipped, ' + s.late + ' past due of ' + s.total + ' scheduled">' +
    '<div class="prog-track"><div class="prog-done" style="width:' + pct(s.done) + '"></div><div class="prog-skip" style="width:' + pct(s.skipped) + '"></div><div class="prog-late" style="width:' + pct(s.late) + '"></div></div>' +
    '<span class="prog-txt">' + s.done + '/' + s.total + (s.late ? ' · <span style="color:var(--red)">' + s.late + ' late</span>' : '') + '</span></div>';
}

// ── WORK COMPLETED (from BuildOps jobs & visits) ─────────────────────
// a.work = { syncedAt, jobs: [{ id, url, kind: 'Maintenance'|'Service', type, title,
//            status, created, due, visits: [{ date, status, tech, others, desc, assets }] }] }
// Dollar balances and property instructions are deliberately never stored.
function boAgreementUrl(a) { return a.buildopsId ? BUILDOPS_BASE + '/serviceAgreement/view/' + a.buildopsId : ''; }
function boJobUrl(j) { return j.url ? (/^https?:/.test(j.url) ? j.url : BUILDOPS_BASE + j.url) : ''; }
function quarterIdx(d) { return Math.floor(d.getMonth() / 3); }

function workSummary(a, year) {
  const qs = [0, 1, 2, 3].map(() => ({ maint: 0, svcJobs: new Set(), svcVisits: 0, jobs: new Set() }));
  const jobs = (a.work && a.work.jobs) || [];
  jobs.forEach(j => {
    const isMaint = j.kind === 'Maintenance';
    const visits = (j.visits || []).filter(v => { const d = parseD(v.date); return d && d.getFullYear() === year; });
    visits.forEach(v => {
      const qi = quarterIdx(parseD(v.date));
      qs[qi].jobs.add(j);
      if (isMaint) { if (DONE_RE.test(v.status || '')) qs[qi].maint++; }
      else { qs[qi].svcVisits++; qs[qi].svcJobs.add(j.id); }
    });
    if (!visits.length) {
      const ref = parseD(isMaint ? (j.due || j.created) : j.created);
      if (ref && ref.getFullYear() === year) {
        const qi = quarterIdx(ref);
        if (isMaint && DONE_RE.test(j.status || '')) { qs[qi].maint++; qs[qi].jobs.add(j); }
        else if (!isMaint) { qs[qi].svcJobs.add(j.id); qs[qi].jobs.add(j); }
      }
    }
  });
  const ytd = { maint: 0, svcJobs: new Set(), svcVisits: 0 };
  qs.forEach(q => { ytd.maint += q.maint; ytd.svcVisits += q.svcVisits; q.svcJobs.forEach(x => ytd.svcJobs.add(x)); });
  return { qs, ytd, hasData: !!(a.work && a.work.jobs) };
}

function workYears(a) {
  const ys = new Set([TODAY.getFullYear()]);
  ((a.work && a.work.jobs) || []).forEach(j => (j.visits || []).forEach(v => { const d = parseD(v.date); if (d) ys.add(d.getFullYear()); }));
  return [...ys].sort((x, y) => y - x);
}

function svcYtdCell(a) {
  if (!a.work || !a.work.jobs) return '<span class="muted" style="font-size:.75rem">Not pulled</span>';
  const s = workSummary(a, TODAY.getFullYear());
  return '<span class="nowrap" style="font-size:.78rem">' + s.ytd.maint + ' maint · ' + s.ytd.svcJobs.size + ' svc</span>';
}

function renderWork(a, year) {
  const wrap = document.getElementById('work-wrap');
  if (!wrap) return;
  if (!a.work || !a.work.jobs) {
    wrap.innerHTML = '<p class="muted" style="font-size:.8rem">No work pulled from BuildOps yet. It loads with the weekly BuildOps refresh.</p>';
    return;
  }
  const s = workSummary(a, year);
  const curQ = year === TODAY.getFullYear() ? quarterIdx(TODAY) : (year < TODAY.getFullYear() ? 3 : -1);
  const cell = (label, maint, svc, visits, cls) =>
    '<div class="qcell ' + cls + '"><div class="q-label">' + label + '</div>' +
    '<div class="q-num">' + maint + '<span>maint visits</span></div>' +
    '<div class="q-num">' + svc + '<span>service calls' + (visits ? ' · ' + visits + ' visits' : '') + '</span></div></div>';
  let html = '<div class="qgrid">' +
    s.qs.map((q, i) => cell('Q' + (i + 1), q.maint, q.svcJobs.size, q.svcVisits, i > curQ ? 'future' : (i === curQ && year === TODAY.getFullYear() ? 'current' : ''))).join('') +
    cell(year === TODAY.getFullYear() ? 'YTD' : year + ' total', s.ytd.maint, s.ytd.svcJobs.size, s.ytd.svcVisits, 'ytd') + '</div>';

  const quartersDesc = [3, 2, 1, 0].filter(i => s.qs[i].jobs.size);
  if (!quartersDesc.length) {
    html += '<p class="muted" style="font-size:.8rem;margin-top:.75rem">No completed maintenance or service calls in ' + year + '.</p>';
  }
  quartersDesc.forEach(i => {
    const jobs = [...s.qs[i].jobs].sort((x, y) => (x.kind === y.kind ? 0 : x.kind === 'Service' ? -1 : 1));
    html += '<div class="q-head">Q' + (i + 1) + ' ' + year + '</div>' + jobs.map(j => {
      const vis = (j.visits || []).filter(v => { const d = parseD(v.date); return d && d.getFullYear() === year && quarterIdx(d) === i; })
        .sort((x, y) => (y.date || '').localeCompare(x.date || ''));
      const url = boJobUrl(j);
      return '<div class="job">' +
        '<div class="job-top"><span class="badge ' + (j.kind === 'Maintenance' ? 'b-90' : 'b-60') + '">' + esc(j.kind) + '</span> ' +
        (url ? '<a class="id" href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(j.id) + '</a>' : '<span class="id">' + esc(j.id) + '</span>') +
        ' <span class="muted">' + esc(j.type || '') + (j.status ? ' · ' + esc(j.status) : '') + '</span></div>' +
        (j.title ? '<div class="job-title">' + esc(j.title) + '</div>' : '') +
        (vis.length ? '<ul class="visits">' + vis.map(v => '<li><b>' + esc(fmtD(v.date)) + '</b> ' +
          esc([v.tech, v.others].filter(Boolean).join(' + ')) + (v.desc ? ' · ' + esc(v.desc) : '') + (v.assets ? ' <span class="muted">(' + esc(v.assets) + ')</span>' : '') +
          (v.status && !DONE_RE.test(v.status) ? ' <span class="muted">[' + esc(v.status) + ']</span>' : '') + '</li>').join('') + '</ul>' : '') +
        '</div>';
    }).join('');
  });
  wrap.innerHTML = html;
}

// ── CAMPAIGNS ────────────────────────────────────────────────────────
function campaignWindows() { return settings.campaigns.slice().sort((a, b) => a.month - b.month); }
function currentCampaign() {
  const wins = campaignWindows();
  const m = TODAY.getMonth() + 1, y = TODAY.getFullYear();
  let cur = null;
  wins.forEach(w => { if (w.month <= m) cur = { ...w, year: y }; });
  if (!cur) { const last = wins[wins.length - 1]; cur = { ...last, year: y - 1 }; }
  cur.id = cur.year + '-' + String(cur.month).padStart(2, '0');
  return cur;
}
function nextCampaign() {
  const wins = campaignWindows();
  const m = TODAY.getMonth() + 1, y = TODAY.getFullYear();
  const n = wins.find(w => w.month > m);
  return n ? { ...n, year: y } : { ...wins[0], year: y + 1 };
}
function acctStatus(a, campId) { return (a.campaigns && a.campaigns[campId] && a.campaigns[campId].status) || 'Due'; }
function lastTouch(a) {
  const vals = Object.values(a.campaigns || {}).filter(c => c.status && c.status !== 'Due' && c.date);
  if (!vals.length) return null;
  return vals.map(c => c.date).sort().pop();
}

// ── RENDER: ACTIVE ───────────────────────────────────────────────────
function render() {
  loadAll();
  renderSyncLine();
  renderKPIs();
  renderPipeline();
  renderRegister();
  renderDrafts();
  renderEnded();
  renderUnactive();
  renderTabCounts();
}

function renderSyncLine() {
  const last = parseD(settings.lastSync);
  const age = last ? diffDays(TODAY, last) : null;
  const stale = age === null || age > 8;
  document.getElementById('sync-line').innerHTML =
    'BuildOps is the source of truth for agreement data. Last BuildOps refresh: <b' + (stale ? ' style="color:var(--amber)"' : '') + '>' +
    esc(fmtD(settings.lastSync)) + (age !== null ? ' (' + age + (age === 1 ? ' day' : ' days') + ' ago)' : '') + '</b>' +
    (stale ? '. <span style="color:var(--amber)">Overdue for the weekly refresh; dates, ACV and maintenance may be out of date.</span>' : '') +
    ' Renewal stage, owner, increase and notes live here only.';
}

function active() { return agreements.filter(a => a.status === 'Active'); }

function renderKPIs() {
  const act = active();
  const billable = act.filter(a => (num(a.acv) || 0) > 0);
  const acv = billable.reduce((s, a) => s + (num(a.acv) || 0), 0);
  const overdue = act.filter(a => { const d = daysToEnd(a); return d !== null && d < 0; });
  const due90 = act.filter(a => { const d = daysToEnd(a); return d !== null && d >= 0 && d <= 90; });
  const drafts = agreements.filter(a => a.status === 'Draft');
  const oldest = drafts.reduce((m, a) => { const p = parseD(a.draftDate); return p ? Math.max(m, diffDays(TODAY, p)) : m; }, 0);
  const flagged = act.filter(a => a.flag).length;
  const sum = arr => arr.reduce((s, a) => s + (num(a.acv) || 0), 0);

  document.getElementById('kpis').innerHTML = [
    kpi('Annual contract value', money(acv), billable.length + ' billable of ' + act.length + ' active', ''),
    kpi('Renewals overdue', overdue.length, money(sum(overdue)) + ' ACV unrenewed', overdue.length ? 'alert' : ''),
    kpi('Ending within 90 days', due90.length, money(sum(due90)) + ' ACV', due90.length ? 'warn' : ''),
    kpi('Open quotes', drafts.length, drafts.length ? 'Oldest ' + oldest + ' days' : 'None open', oldest > 90 ? 'warn' : ''),
    kpi('Flagged for review', flagged, 'ACV mismatch vs QuickBooks', flagged ? 'warn' : '')
  ].join('');
  function kpi(label, val, foot, cls) {
    return '<div class="kpi ' + cls + '"><div class="kpi-label">' + esc(label) + '</div><div class="kpi-val">' + esc(val) + '</div><div class="kpi-foot">' + esc(foot) + '</div></div>';
  }
}

function stageSelect(a) {
  return '<select class="sel mini" data-action="set-stage" data-id="' + esc(a.id) + '" aria-label="Renewal stage for ' + esc(a.id) + '">' +
    STAGES.map(s => '<option' + (a.renewalStage === s ? ' selected' : '') + '>' + s + '</option>').join('') + '</select>';
}

function renderPipeline() {
  const rows = active()
    .map(a => ({ a, d: daysToEnd(a) }))
    .filter(x => x.d !== null && (x.d <= 90 || (x.a.renewalStage && x.a.renewalStage !== 'Not Started')))
    .sort((x, y) => x.d - y.d);
  const body = document.getElementById('pipeline-body');
  if (!rows.length) {
    body.innerHTML = '<tr class="empty-row"><td colspan="9">No renewals due in the next 90 days.</td></tr>';
  } else {
    body.innerHTML = rows.map(({ a }) =>
      '<tr>' +
      '<td class="nowrap"><span class="id">' + esc(a.id) + '</span> ' + esc(a.name) + '</td>' +
      '<td>' + esc(a.customer || '—') + '</td>' +
      '<td class="nowrap">' + fmtD(effEnd(a)) + (a.endDate ? '' : '<span class="rule" title="No end date in BuildOps: start + 1 year − 1 day">rule</span>') + '</td>' +
      '<td>' + renewalBadge(a) + '</td>' +
      '<td class="num">' + money(a.acv, true) + '</td>' +
      '<td>' + stageSelect(a) + '</td>' +
      '<td><input class="inp mini" style="width:120px" data-action="set-owner" data-id="' + esc(a.id) + '" value="' + esc(a.renewalOwner) + '" placeholder="Assign" aria-label="Renewal owner"></td>' +
      '<td class="num"><input class="inp mini" type="number" step="0.5" data-action="set-increase" data-id="' + esc(a.id) + '" value="' + (a.priceIncrease ?? '') + '" placeholder="%" aria-label="Proposed increase percent"></td>' +
      '<td><button class="btn sm" data-action="open-agr" data-id="' + esc(a.id) + '">Open</button></td>' +
      '</tr>').join('');
  }
  const later = active().map(a => ({ a, d: daysToEnd(a) })).filter(x => x.d !== null && x.d > 90).sort((x, y) => x.d - y.d)[0];
  document.getElementById('pipeline-next').textContent = later
    ? 'Next renewal after this window: ' + later.a.id + ' ' + later.a.name + ', ' + fmtD(effEnd(later.a)) + ' (' + later.d + ' days).'
    : '';
}

function renderRegister() {
  const q = ui.regSearch.toLowerCase();
  const rows = active().filter(a => {
    if (q && !(a.id + ' ' + a.name + ' ' + a.customer).toLowerCase().includes(q)) return false;
    if (ui.regType === '__blank' && a.type) return false;
    if (ui.regType && ui.regType !== '__blank' && a.type !== ui.regType) return false;
    if (ui.regFlag === 'flagged' && !a.flag) return false;
    return true;
  });
  document.getElementById('reg-count').textContent = rows.length + ' of ' + active().length + ' active';
  const body = document.getElementById('reg-body');
  if (!rows.length) { body.innerHTML = '<tr class="empty-row"><td colspan="13">No agreements match these filters.</td></tr>'; return; }
  body.innerHTML = rows.map(a =>
    '<tr class="clickable" data-action="open-agr" data-id="' + esc(a.id) + '">' +
    '<td class="nowrap"><span class="id">' + esc(a.id) + '</span>' + (a.buildopsId ? ' <a class="bo-link" href="' + esc(boAgreementUrl(a)) + '" target="_blank" rel="noopener" title="Open in BuildOps" data-action="bo-link">↗</a>' : '') + '</td>' +
    '<td>' + esc(a.name) + (a.flag ? '<span class="flag" title="' + esc(a.flag) + '">⚑</span>' : '') + '</td>' +
    '<td>' + esc(a.customer || '—') + '</td>' +
    '<td>' + (a.type ? esc(a.type) : '<span class="muted">—</span>') + '</td>' +
    '<td>' + (a.billing ? esc(a.billing) : '<span class="muted">—</span>') + '</td>' +
    '<td class="nowrap">' + fmtD(a.startDate) + '</td>' +
    '<td class="nowrap">' + fmtD(effEnd(a)) + (a.endDate ? '' : '<span class="rule" title="No end date in BuildOps: start + 1 year − 1 day">rule</span>') + '</td>' +
    '<td class="num">' + money(a.acv, true) + '</td>' +
    '<td>' + (a.soldBy ? esc(a.soldBy) : '<span class="muted">—</span>') + '</td>' +
    '<td>' + (a.pm ? esc(a.pm) : '<span class="muted">—</span>') + '</td>' +
    '<td>' + progHTML(a) + '</td>' +
    '<td>' + svcYtdCell(a) + '</td>' +
    '<td>' + renewalBadge(a) + '</td>' +
    '</tr>').join('');
}

function renderDrafts() {
  const rows = agreements.filter(a => a.status === 'Draft')
    .map(a => ({ a, d: parseD(a.draftDate) ? diffDays(TODAY, parseD(a.draftDate)) : null }))
    .sort((x, y) => (y.d ?? -1) - (x.d ?? -1));
  const body = document.getElementById('draft-body');
  if (!rows.length) { body.innerHTML = '<tr class="empty-row"><td colspan="8">No open quotes.</td></tr>'; return; }
  body.innerHTML = rows.map(({ a, d }) => {
    const cls = d === null ? 'b-ok' : d > 90 ? 'b-overdue' : d > 30 ? 'b-60' : 'b-ok';
    return '<tr class="clickable" data-action="open-agr" data-id="' + esc(a.id) + '">' +
      '<td><span class="id">' + esc(a.id) + '</span></td>' +
      '<td>' + esc(a.name) + '</td>' +
      '<td>' + esc(a.customer || '—') + '</td>' +
      '<td class="nowrap">' + fmtD(a.draftDate) + '</td>' +
      '<td class="num"><span class="badge ' + cls + '">' + (d === null ? '—' : d) + '</span></td>' +
      '<td class="num">' + money(a.acv, true) + '</td>' +
      '<td class="muted" style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(a.notes || '') + '</td>' +
      '<td class="nowrap"><button class="btn sm" data-action="draft-won" data-id="' + esc(a.id) + '">Mark signed</button></td>' +
      '</tr>';
  }).join('');
}

function renderEnded() {
  const rows = agreements.filter(a => a.status === 'Ended');
  document.getElementById('ended-summary').textContent = 'Ended agreements (' + rows.length + ')';
  document.getElementById('ended-body').innerHTML = rows.length ? rows.map(a =>
    '<tr class="clickable" data-action="open-agr" data-id="' + esc(a.id) + '">' +
    '<td><span class="id">' + esc(a.id) + '</span></td><td>' + esc(a.name) + '</td><td>' + esc(a.customer || '—') + '</td>' +
    '<td class="nowrap">' + fmtD(effEnd(a)) + '</td><td class="num">' + money(a.acv, true) + '</td>' +
    '<td class="muted">' + esc(a.endReason || '') + '</td></tr>').join('')
    : '<tr class="empty-row"><td colspan="6">No ended agreements.</td></tr>';
}

function renderTabCounts() {
  const od = active().filter(a => { const d = daysToEnd(a); return d !== null && d < 0; }).length;
  const t1 = document.getElementById('tc-active');
  t1.hidden = !od; t1.textContent = od + ' overdue';
  const camp = currentCampaign();
  const due = accounts.filter(a => acctStatus(a, camp.id) === 'Due').length;
  const t2 = document.getElementById('tc-unactive');
  t2.hidden = !due; t2.textContent = due + ' due';
  t2.style.background = 'rgba(155,142,196,0.18)'; t2.style.color = 'var(--purple-light)';
}

// ── RENDER: UNACTIVE ─────────────────────────────────────────────────
function renderUnactive() {
  const camp = currentCampaign(), next = nextCampaign();
  const winMonths = campaignWindows().map(w => w.month);
  const nextDate = new Date(next.year, next.month - 1, 1);
  document.getElementById('campaign').innerHTML =
    '<div><div class="muted" style="font-size:.75rem">Current campaign</div>' +
    '<div class="camp-name">' + esc(camp.label) + '</div>' +
    '<div class="camp-meta">Opened ' + MONTHS_LONG[camp.month - 1] + ' 1, ' + camp.year + '. Next window: ' + esc(next.label) + ', ' + MONTHS_LONG[next.month - 1] + ' ' + next.year + ' (' + diffDays(nextDate, TODAY) + ' days).</div></div>' +
    '<div><div class="muted" style="font-size:.75rem">Outreach calendar</div><div class="cal">' +
    MONTHS.map((m, i) => '<div class="cal-m' + (winMonths.includes(i + 1) ? ' win' : '') + (camp.month === i + 1 ? ' cur' : '') + '" title="' +
      esc((settings.campaigns.find(c => c.month === i + 1) || {}).label || '') + '">' + m + '</div>').join('') + '</div></div>';

  const counts = {};
  OUTREACH.forEach(s => counts[s] = 0);
  accounts.forEach(a => counts[acctStatus(a, camp.id)]++);
  document.getElementById('status-chips').innerHTML =
    '<button class="chip' + (!ui.acctStatus ? ' on' : '') + '" data-action="filter-status" data-status="">All<b>' + accounts.length + '</b></button>' +
    OUTREACH.map(s => '<button class="chip' + (ui.acctStatus === s ? ' on' : '') + '" data-action="filter-status" data-status="' + s + '">' + s + '<b>' + counts[s] + '</b></button>').join('');

  const q = ui.acctSearch.toLowerCase();
  const rows = accounts.filter(a => (!q || (a.name + ' ' + a.contact).toLowerCase().includes(q)) && (!ui.acctStatus || acctStatus(a, camp.id) === ui.acctStatus));
  const body = document.getElementById('acct-body');
  if (!rows.length) { body.innerHTML = '<tr class="empty-row"><td colspan="8">No accounts match. Add past customers with the Add account button.</td></tr>'; return; }
  body.innerHTML = rows.map(a => {
    const st = acctStatus(a, camp.id);
    const lt = lastTouch(a);
    return '<tr>' +
      '<td>' + esc(a.name) + '</td>' +
      '<td>' + (a.contact ? esc(a.contact) : '<span class="muted">—</span>') + '</td>' +
      '<td class="nowrap">' + fmtD(a.lastService) + '</td>' +
      '<td class="muted" style="font-size:.76rem">' + esc(a.source || '') + '</td>' +
      '<td><select class="sel mini st-' + st.replace(' ', '-') + '" data-action="set-outreach" data-id="' + esc(a.id) + '" aria-label="Outreach status">' +
        OUTREACH.map(s => '<option' + (s === st ? ' selected' : '') + '>' + s + '</option>').join('') + '</select></td>' +
      '<td class="nowrap muted">' + (lt ? fmtD(lt) : '—') + '</td>' +
      '<td class="muted" style="max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(a.notes || '') + '</td>' +
      '<td><button class="btn sm" data-action="open-acct" data-id="' + esc(a.id) + '">Edit</button></td>' +
      '</tr>';
  }).join('');
}

// ── DRAWER: AGREEMENT ────────────────────────────────────────────────
function fld(label, field, val, opts) {
  opts = opts || {};
  const id = 'f-' + field;
  let ctrl;
  if (opts.options) {
    ctrl = '<select class="sel" id="' + id + '" data-field="' + field + '">' + opts.options.map(o => '<option' + (o === val ? ' selected' : '') + '>' + esc(o) + '</option>').join('') + '</select>';
  } else if (opts.textarea) {
    ctrl = '<textarea class="inp" id="' + id + '" data-field="' + field + '">' + esc(val) + '</textarea>';
  } else {
    ctrl = '<input class="inp" id="' + id + '" data-field="' + field + '" type="' + (opts.type || 'text') + '"' + (opts.step ? ' step="' + opts.step + '"' : '') + ' value="' + esc(val ?? '') + '"' + (opts.ph ? ' placeholder="' + esc(opts.ph) + '"' : '') + '>';
  }
  return '<div class="fld' + (opts.full ? ' full' : '') + '"><label for="' + id + '">' + esc(label) + '</label>' + ctrl + '</div>';
}

let drawerMaint = [];

function openAgreement(id, isNew) {
  const a = isNew ? blankAgreement(id) : findAgr(id);
  if (!a) return;
  ui.drawerId = a.id; ui.drawerKind = isNew ? 'new-agr' : 'agr';
  drawerMaint = JSON.parse(JSON.stringify(a.maint || []));
  document.getElementById('drawer-kicker').innerHTML = isNew ? 'New agreement' : esc(a.id) + ' · ' + (a.status === 'Active' ? renewalBadge(a) : '<span class="badge ' + (a.status === 'Draft' ? 'b-draft' : 'b-ended') + '">' + esc(a.status) + '</span>');
  document.getElementById('drawer-title').textContent = isNew ? 'Add agreement' : a.name;
  if (!isNew && a.buildopsId) {
    document.getElementById('drawer-kicker').insertAdjacentHTML('beforeend',
      ' · <a class="bo-link" href="' + esc(boAgreementUrl(a)) + '" target="_blank" rel="noopener">Open in BuildOps ↗</a>');
  }

  const ruleNote = a.startDate && !a.endDate ? 'Blank = rule applies: ' + fmtD(ruleEnd(a.startDate)) : 'Leave blank to apply start + 1 year − 1 day';
  document.getElementById('drawer-body').innerHTML =
    (a.flag ? '<div class="flag-box"><b>Review:</b> ' + esc(a.flag) + '</div>' : '') +
    '<div class="fs"><div class="fs-legend">BuildOps fields <span>Overwritten by each BuildOps refresh</span></div><div class="grid2">' +
      (isNew ? fld('Agreement #', 'id', '', { ph: 'SA1031' }) : '') +
      fld('Name', 'name', a.name, { full: !isNew }) +
      fld('Customer', 'customer', a.customer) +
      fld('Status', 'status', a.status, { options: ['Active', 'Draft', 'Ended'] }) +
      fld('Type', 'type', a.type, { options: ['', 'Recurring', 'Non-Billable'] }) +
      fld('Billing', 'billing', a.billing, { options: ['', 'Monthly', 'Quarterly', 'Semi-Annual', 'Annual', 'Non-Billable'] }) +
      fld('ACV (pre-tax)', 'acv', a.acv, { type: 'number', step: '0.01' }) +
      fld('Start date', 'startDate', a.startDate, { type: 'date' }) +
      fld('End date', 'endDate', a.endDate, { type: 'date' }) +
      '<div class="fld full muted" style="font-size:.72rem;margin-top:-.4rem">' + esc(ruleNote) + '</div>' +
      fld('Quote date (drafts)', 'draftDate', a.draftDate, { type: 'date' }) +
      fld('Sold by', 'soldBy', a.soldBy) +
      fld('PM', 'pm', a.pm) +
    '</div></div>' +
    '<div class="fs"><div class="fs-legend">Renewal <span>Portal only</span></div><div class="grid2">' +
      fld('Renewal stage', 'renewalStage', a.renewalStage, { options: STAGES.filter(x => (x !== 'Renewed' && x !== 'Lost') || x === a.renewalStage) }) +
      fld('Renewal owner', 'renewalOwner', a.renewalOwner) +
      fld('Proposed increase %', 'priceIncrease', a.priceIncrease, { type: 'number', step: '0.5' }) +
      '<div class="fld"><label>Proposed renewal ACV</label><div class="inp" style="background:none;border-color:transparent;padding-left:0" id="proposed-acv"></div></div>' +
      fld('Notes', 'notes', a.notes, { textarea: true, full: true }) +
      fld('Data flag', 'flag', a.flag, { full: true, ph: 'Leave blank when reconciled' }) +
    '</div></div>' +
    (isNew ? '' : '<div class="fs"><div class="fs-legend">Work completed <span>' +
      (a.work && a.work.syncedAt ? 'Pulled from BuildOps ' + esc(fmtD(a.work.syncedAt)) : 'From BuildOps') +
      ' <select class="sel mini" id="work-year" aria-label="Year">' + workYears(a).map(y => '<option>' + y + '</option>').join('') + '</select></span></div>' +
      '<div id="work-wrap"></div></div>') +
    '<div class="fs"><div class="fs-legend">Maintenance schedule <span id="maint-sum"></span></div><div id="maint-wrap"></div>' +
      '<button class="btn sm" style="margin-top:.6rem" data-action="maint-add">Add visit</button></div>' +
    (a.history && a.history.length ? '<div class="fs"><div class="fs-legend">History</div><ul class="hist">' +
      a.history.slice(0, 20).map(h => '<li><b>' + esc(fmtD(h.at)) + '</b> ' + esc(h.by) + ': ' + esc(h.text) + '</li>').join('') + '</ul></div>' : '');

  renderMaintEditor();
  updateProposed();
  if (!isNew) renderWork(a, TODAY.getFullYear());

  const foot = [];
  if (!isNew) foot.push('<button class="btn danger" data-action="delete-agr" style="margin-right:auto">Delete</button>');
  if (!isNew && a.status === 'Active') {
    foot.push('<button class="btn" data-action="mark-lost">Mark lost</button>');
    foot.push('<button class="btn" data-action="mark-renewed">Mark renewed</button>');
  }
  foot.push('<button class="btn primary" data-action="save-agr">Save</button>');
  document.getElementById('drawer-foot').innerHTML = foot.join('');
  openDrawer();
}

function renderMaintEditor() {
  const wrap = document.getElementById('maint-wrap');
  if (!drawerMaint.length) {
    wrap.innerHTML = '<p class="muted" style="font-size:.8rem">No visits loaded. Populated from the BuildOps maintenance schedule on each refresh, or add them here.</p>';
  } else {
    wrap.innerHTML = '<div class="tbl-wrap" style="border-radius:6px"><table><thead><tr><th>Due</th><th>Status</th><th class="num">Budget hrs</th><th class="num">Visits</th><th></th></tr></thead><tbody>' +
      drawerMaint.map((r, i) => '<tr>' +
        '<td><input class="inp mini" style="width:140px" type="date" data-maint="' + i + '" data-mf="due" value="' + esc(r.due || '') + '"></td>' +
        '<td><select class="sel mini" data-maint="' + i + '" data-mf="status">' + MAINT_STATUS.map(s => '<option' + (s === r.status ? ' selected' : '') + '>' + s + '</option>').join('') + '</select></td>' +
        '<td class="num"><input class="inp mini" type="number" step="0.5" data-maint="' + i + '" data-mf="budgetHrs" value="' + esc(r.budgetHrs ?? '') + '"></td>' +
        '<td class="num"><input class="inp mini" type="number" step="1" data-maint="' + i + '" data-mf="visits" value="' + esc(r.visits ?? '') + '"></td>' +
        '<td><button class="x-btn" style="font-size:1.1rem" data-action="maint-del" data-i="' + i + '" aria-label="Remove visit">×</button></td></tr>').join('') +
      '</tbody></table></div>';
  }
  const s = maintStats({ maint: drawerMaint });
  document.getElementById('maint-sum').textContent = s.total ? s.done + ' done, ' + s.skipped + ' skipped, ' + s.late + ' past due · ' + s.budget + ' budget hrs' : '';
}

function updateProposed() {
  const el = document.getElementById('proposed-acv');
  if (!el) return;
  const acv = num(document.getElementById('f-acv').value);
  const inc = num(document.getElementById('f-priceIncrease').value);
  el.textContent = acv && inc ? money(acv * (1 + inc / 100), true) + ' (+' + money(acv * inc / 100, true) + ')' : '—';
}

function collectAgrForm() {
  const out = {};
  document.querySelectorAll('#drawer-body [data-field]').forEach(el => { out[el.dataset.field] = el.value.trim(); });
  out.acv = out.acv === '' ? null : num(out.acv);
  out.priceIncrease = out.priceIncrease === '' ? null : num(out.priceIncrease);
  out.maint = drawerMaint.filter(r => r.due || r.budgetHrs || r.visits).map(r => ({
    due: r.due || '', status: r.status || 'Scheduled', budgetHrs: num(r.budgetHrs), visits: num(r.visits)
  })).sort((x, y) => (x.due || '').localeCompare(y.due || ''));
  return out;
}

function saveAgreementFromDrawer() {
  const f = collectAgrForm();
  let a;
  if (ui.drawerKind === 'new-agr') {
    const id = (f.id || '').toUpperCase();
    if (!/^SA\d+$/.test(id)) { toast('Enter the BuildOps agreement number, e.g. SA1031.'); return; }
    if (findAgr(id) || localStorage.getItem(KEY.agr + id)) { toast(id + ' already exists.'); return; }
    a = blankAgreement(id);
    delete f.id;
    Object.assign(a, f);
    logHist(a, 'Added in portal');
  } else {
    a = findAgr(ui.drawerId);
    const changed = Object.keys(f).filter(k => JSON.stringify(a[k] ?? '') !== JSON.stringify(f[k] ?? ''));
    if (!changed.length) { closeDrawer(); return; }
    if (changed.includes('renewalStage')) logHist(a, 'Renewal stage: ' + (a.renewalStage || '—') + ' → ' + f.renewalStage);
    const other = changed.filter(k => k !== 'renewalStage' && k !== 'maint');
    if (other.length) logHist(a, 'Edited ' + other.join(', '));
    if (changed.includes('maint')) logHist(a, 'Maintenance schedule updated');
    Object.assign(a, f);
  }
  if (!a.name) { toast('Name is required.'); return; }
  saveAgr(a);
  closeDrawer();
  render();
  toast('Saved ' + a.id + '.');
}

// ── RENEWAL ACTIONS ──────────────────────────────────────────────────
function markRenewed(id) {
  const a = findAgr(id);
  const oldEnd = effEnd(a);
  if (!oldEnd) { toast('Set a start or end date first.'); return; }
  const newEnd = addYears(oldEnd, 1);
  const inc = num(a.priceIncrease);
  const newAcv = inc && a.acv ? Math.round(a.acv * (1 + inc / 100) * 100) / 100 : a.acv;
  confirmModal('Mark ' + a.id + ' renewed',
    'End date moves ' + fmtD(oldEnd) + ' → ' + fmtD(newEnd) + '.' +
    (inc ? ' ACV moves ' + money(a.acv, true) + ' → ' + money(newAcv, true) + ' (+' + inc + '%).' : ' ACV unchanged.') +
    ' Update the agreement in BuildOps to match, or the next BuildOps refresh will revert it.',
    'Mark renewed', () => {
      logHist(a, 'Renewed: end ' + fmtD(oldEnd) + ' → ' + fmtD(newEnd) + (inc ? ', ACV +' + inc + '% to ' + money(newAcv, true) : ''));
      a.endDate = newEnd; a.acv = newAcv;
      a.renewalStage = 'Not Started'; a.priceIncrease = null;
      a.lastRenewed = isoD(TODAY);
      saveAgr(a); closeDrawer(); render();
      toast(a.id + ' renewed through ' + fmtD(newEnd) + '.');
    });
}

function markLost(id) {
  const a = findAgr(id);
  const acctName = a.customer || a.name;
  confirmModal('Mark ' + a.id + ' lost',
    'The agreement moves to Ended and ' + acctName + ' is added to Unactive Accounts for win-back outreach. Cancel it in BuildOps as well.',
    'Mark lost', () => {
      a.status = 'Ended'; a.renewalStage = 'Lost'; a.endReason = 'Renewal lost';
      logHist(a, 'Marked lost, moved to Unactive Accounts');
      saveAgr(a);
      addUnactiveFromAgreement(a, 'Lost renewal (' + a.id + ')');
      closeDrawer(); render();
      toast(a.id + ' ended. ' + acctName + ' added to Unactive Accounts.');
    });
}

function addUnactiveFromAgreement(a, source) {
  const name = a.customer || a.name;
  const id = slug(name);
  const existing = readJSON(KEY.acct + id);
  if (existing && !existing.deleted) return;
  saveAcct({ id, name, contact: '', lastService: effEnd(a), source, notes: '', campaigns: {}, history: [], deleted: false });
}

function draftSigned(id) {
  const a = findAgr(id);
  const today = isoD(TODAY);
  confirmModal('Mark ' + a.id + ' signed',
    'Moves to Active with a start date of ' + fmtD(today) + '. Edit the dates and ACV afterward to match BuildOps.',
    'Mark signed', () => {
      a.status = 'Active'; a.startDate = a.startDate || today;
      logHist(a, 'Quote signed after ' + (parseD(a.draftDate) ? diffDays(TODAY, parseD(a.draftDate)) + ' days' : 'unknown days'));
      saveAgr(a); render(); openAgreement(a.id);
    });
}

function deleteAgr(id) {
  const a = findAgr(id);
  confirmModal('Delete ' + a.id, 'Removes it from the tracker for everyone. Use this for test records only; ended agreements should be marked lost.', 'Delete', () => {
    a.deleted = true; logHist(a, 'Deleted'); saveAgr(a); closeDrawer(); render(); toast(a.id + ' deleted.');
  }, true);
}

// ── DRAWER: ACCOUNT ──────────────────────────────────────────────────
function openAccount(id) {
  const isNew = !id;
  const a = isNew ? { id: '', name: '', contact: '', lastService: '', source: 'Added manually', notes: '', campaigns: {}, history: [] } : findAcct(id);
  if (!a) return;
  ui.drawerId = a.id; ui.drawerKind = isNew ? 'new-acct' : 'acct';
  document.getElementById('drawer-kicker').textContent = isNew ? 'New account' : 'Unactive account';
  document.getElementById('drawer-title').textContent = isNew ? 'Add account' : a.name;
  const hist = Object.keys(a.campaigns || {}).sort().reverse().map(cid => {
    const c = a.campaigns[cid];
    const [y, m] = cid.split('-').map(Number);
    const w = settings.campaigns.find(x => x.month === m);
    return '<li><b>' + MONTHS[m - 1] + ' ' + y + '</b> ' + esc(w ? w.label : 'Campaign') + ': ' + esc(c.status) + (c.by ? ' (' + esc(c.by) + ', ' + esc(fmtD(c.date)) + ')' : '') + '</li>';
  }).join('');
  document.getElementById('drawer-body').innerHTML =
    '<div class="fs"><div class="grid2">' +
      fld('Account name', 'name', a.name, { full: true }) +
      fld('Contact (name, phone, email)', 'contact', a.contact, { full: true }) +
      fld('Last service date', 'lastService', a.lastService, { type: 'date' }) +
      fld('Source', 'source', a.source) +
      fld('Notes', 'notes', a.notes, { textarea: true, full: true }) +
    '</div></div>' +
    (hist ? '<div class="fs"><div class="fs-legend">Campaign history</div><ul class="hist">' + hist + '</ul></div>' : '');
  document.getElementById('drawer-foot').innerHTML =
    (isNew ? '' : '<button class="btn danger" data-action="delete-acct" style="margin-right:auto">Remove</button>') +
    '<button class="btn primary" data-action="save-acct">Save</button>';
  openDrawer();
}

function saveAccountFromDrawer() {
  const f = {};
  document.querySelectorAll('#drawer-body [data-field]').forEach(el => { f[el.dataset.field] = el.value.trim(); });
  if (!f.name) { toast('Account name is required.'); return; }
  let a;
  if (ui.drawerKind === 'new-acct') {
    const id = slug(f.name);
    const ex = readJSON(KEY.acct + id);
    if (ex && !ex.deleted) { toast(f.name + ' is already on the list.'); return; }
    a = { id, campaigns: {}, history: [], deleted: false };
  } else {
    a = findAcct(ui.drawerId);
  }
  Object.assign(a, f);
  saveAcct(a); closeDrawer(); render(); toast('Saved ' + a.name + '.');
}

function setOutreach(id, status) {
  const a = findAcct(id);
  const camp = currentCampaign();
  a.campaigns = a.campaigns || {};
  a.campaigns[camp.id] = { status, date: isoD(TODAY), by: session.name };
  saveAcct(a); render();
}

// ── CAMPAIGN WINDOWS MODAL ───────────────────────────────────────────
function openCampaignSettings() {
  const rows = campaignWindows();
  showModal('<h3>Campaign windows</h3><p>Each window opens on the 1st of its month and resets every account to Due. History from past windows is kept.</p>' +
    '<div id="camp-rows">' + rows.map(campRow).join('') + '</div>' +
    '<button class="btn sm" data-action="camp-add" style="margin-top:.5rem">Add window</button>' +
    '<div class="modal-actions"><button class="btn" data-action="close-modal">Cancel</button><button class="btn primary" data-action="camp-save">Save windows</button></div>');
}
function campRow(w) {
  return '<div class="camp-row" style="display:flex;gap:.5rem;margin-bottom:.5rem">' +
    '<select class="sel" data-cm="month" aria-label="Month">' + MONTHS_LONG.map((m, i) => '<option value="' + (i + 1) + '"' + (w.month === i + 1 ? ' selected' : '') + '>' + m + '</option>').join('') + '</select>' +
    '<input class="inp" style="flex:1" data-cm="label" value="' + esc(w.label) + '" aria-label="Campaign label">' +
    '<button class="x-btn" data-action="camp-del" aria-label="Remove window">×</button></div>';
}
function saveCampaigns() {
  const rows = [...document.querySelectorAll('#camp-rows .camp-row')].map(r => ({
    month: parseInt(r.querySelector('[data-cm="month"]').value, 10),
    label: r.querySelector('[data-cm="label"]').value.trim() || 'Outreach'
  }));
  if (!rows.length) { toast('Keep at least one window.'); return; }
  if (new Set(rows.map(r => r.month)).size !== rows.length) { toast('Each month can only hold one window.'); return; }
  settings.campaigns = rows.sort((a, b) => a.month - b.month);
  saveSettings(); closeModal(); render(); toast('Campaign windows saved.');
}

// ── DATA MODAL (BuildOps refresh import / export) ────────────────────
function openDataModal() {
  showModal('<h3>Data</h3>' +
    '<p><b>BuildOps refresh.</b> Paste the JSON produced from a BuildOps read. Matching agreements update BuildOps fields only (name, customer, type, billing, dates, ACV, sold by, PM, status, quote date, maintenance). Renewal stage, owner, increase and notes are never overwritten. New agreement numbers are added.</p>' +
    '<textarea class="inp" id="import-json" style="width:100%;min-height:160px;font-size:.75rem" placeholder=\'{"syncedAt":"2026-10-15","agreements":[{"id":"SA1030","endDate":"2027-12-31","acv":6457.56,"maint":[{"due":"2026-10-01","status":"Scheduled","budgetHrs":4,"visits":0}]}]}\'></textarea>' +
    '<div class="modal-actions" style="justify-content:space-between"><button class="btn" data-action="export-json">Download backup</button>' +
    '<span style="display:flex;gap:.6rem"><button class="btn" data-action="close-modal">Close</button><button class="btn primary" data-action="import-json">Apply refresh</button></span></div>');
}

function importJSON() {
  let data;
  try { data = JSON.parse(document.getElementById('import-json').value); }
  catch (e) { toast('That is not valid JSON. Check for a missing bracket or quote.'); return; }
  const list = Array.isArray(data) ? data : data.agreements;
  if (!Array.isArray(list) || !list.length) { toast('No agreements found. Expected an "agreements" array.'); return; }
  let updated = 0, added = 0, skipped = 0;
  list.forEach(inc => {
    const id = String(inc.id || '').toUpperCase();
    if (!/^SA\d+$/.test(id)) { skipped++; return; }
    let a = readJSON(KEY.agr + id);
    const isNew = !a || a.deleted;
    if (isNew) a = blankAgreement(id);
    const changed = [];
    BUILDOPS_FIELDS.forEach(k => {
      if (!(k in inc)) return;
      const v = (k === 'acv') ? num(inc[k]) : inc[k];
      if (JSON.stringify(a[k] ?? '') !== JSON.stringify(v ?? '')) { changed.push(k); a[k] = v; }
    });
    if (isNew) { logHist(a, 'Added from BuildOps refresh'); saveAgr(a); added++; }
    else if (changed.length) { logHist(a, 'BuildOps refresh updated ' + changed.join(', ')); saveAgr(a); updated++; }
  });
  settings.lastSync = data.syncedAt && parseD(data.syncedAt) ? data.syncedAt : isoD(TODAY);
  saveSettings();
  closeModal(); render();
  toast('BuildOps refresh applied: ' + updated + ' updated, ' + added + ' added' + (skipped ? ', ' + skipped + ' skipped (bad agreement #)' : '') + '.');
}

function exportJSON() {
  loadAll();
  const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), settings, agreements, accounts }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = 'alpine-service-agreements-' + isoD(TODAY) + '.json';
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── MODAL / DRAWER / TOAST PLUMBING ──────────────────────────────────
let modalConfirm = null;
function showModal(html) { document.getElementById('modal-box').innerHTML = html; document.getElementById('modal').classList.add('open'); }
function closeModal() { document.getElementById('modal').classList.remove('open'); modalConfirm = null; }
function confirmModal(title, body, okLabel, fn, danger) {
  modalConfirm = fn;
  showModal('<h3>' + esc(title) + '</h3><p>' + esc(body) + '</p><div class="modal-actions"><button class="btn" data-action="close-modal">Cancel</button>' +
    '<button class="btn ' + (danger ? 'danger' : 'primary') + '" data-action="modal-ok">' + esc(okLabel) + '</button></div>');
}
function openDrawer() {
  document.getElementById('scrim').classList.add('open');
  const d = document.getElementById('drawer'); d.classList.add('open'); d.setAttribute('aria-hidden', 'false');
  const first = d.querySelector('.drawer-body input, .drawer-body select, .drawer-body textarea'); if (first) first.focus();
}
function closeDrawer() {
  document.getElementById('scrim').classList.remove('open');
  const d = document.getElementById('drawer'); d.classList.remove('open'); d.setAttribute('aria-hidden', 'true');
  ui.drawerId = null; ui.drawerKind = null;
}
let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 4200);
}

// ── EVENTS ───────────────────────────────────────────────────────────
function switchTab(tab) {
  ui.tab = tab;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === 'panel-' + tab));
  history.replaceState(null, '', '#' + tab);
}

document.addEventListener('click', e => {
  const tabBtn = e.target.closest('.tab-btn[data-tab]');
  if (tabBtn) { switchTab(tabBtn.dataset.tab); return; }
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const act = el.dataset.action, id = el.dataset.id;
  if (act === 'bo-link') return; // plain link to BuildOps; don't open the drawer
  switch (act) {
    case 'open-agr': openAgreement(id); break;
    case 'new-agreement': openAgreement('', true); break;
    case 'save-agr': saveAgreementFromDrawer(); break;
    case 'mark-renewed': markRenewed(ui.drawerId); break;
    case 'mark-lost': markLost(ui.drawerId); break;
    case 'delete-agr': deleteAgr(ui.drawerId); break;
    case 'draft-won': e.stopPropagation(); draftSigned(id); break;
    case 'maint-add': drawerMaint.push({ due: '', status: 'Scheduled', budgetHrs: null, visits: 0 }); renderMaintEditor(); break;
    case 'maint-del': drawerMaint.splice(parseInt(el.dataset.i, 10), 1); renderMaintEditor(); break;
    case 'close-drawer': closeDrawer(); break;
    case 'open-acct': openAccount(id); break;
    case 'new-account': openAccount(null); break;
    case 'save-acct': saveAccountFromDrawer(); break;
    case 'delete-acct': {
      const a = findAcct(ui.drawerId);
      confirmModal('Remove ' + a.name, 'Removes the account from outreach for everyone. Use this when they sign a new agreement or should not be contacted.', 'Remove', () => {
        a.deleted = true; saveAcct(a); closeDrawer(); render(); toast(a.name + ' removed.');
      }, true);
      break;
    }
    case 'filter-status': ui.acctStatus = el.dataset.status; renderUnactive(); break;
    case 'open-campaigns': openCampaignSettings(); break;
    case 'camp-add': document.getElementById('camp-rows').insertAdjacentHTML('beforeend', campRow({ month: 1, label: '' })); break;
    case 'camp-del': el.closest('.camp-row').remove(); break;
    case 'camp-save': saveCampaigns(); break;
    case 'open-data': openDataModal(); break;
    case 'import-json': importJSON(); break;
    case 'export-json': exportJSON(); break;
    case 'close-modal': closeModal(); break;
    case 'modal-ok': { const fn = modalConfirm; closeModal(); if (fn) fn(); break; }
  }
});

document.addEventListener('change', e => {
  const el = e.target;
  if (el.dataset.maint !== undefined) { drawerMaint[+el.dataset.maint][el.dataset.mf] = el.value; renderMaintEditor(); return; }
  if (el.id === 'work-year') { const a = findAgr(ui.drawerId); if (a) renderWork(a, parseInt(el.value, 10)); return; }
  const act = el.dataset.action, id = el.dataset.id;
  if (act === 'set-stage') {
    const a = findAgr(id);
    if (el.value === 'Renewed') { el.value = a.renewalStage; markRenewed(id); return; }
    if (el.value === 'Lost') { el.value = a.renewalStage; markLost(id); return; }
    logHist(a, 'Renewal stage: ' + a.renewalStage + ' → ' + el.value);
    a.renewalStage = el.value; saveAgr(a); render();
  } else if (act === 'set-owner') {
    const a = findAgr(id); a.renewalOwner = el.value.trim(); saveAgr(a); toast('Owner saved.');
  } else if (act === 'set-increase') {
    const a = findAgr(id); a.priceIncrease = el.value === '' ? null : num(el.value); saveAgr(a); toast('Increase saved.');
  } else if (act === 'set-outreach') {
    setOutreach(id, el.value);
  }
});

document.addEventListener('input', e => {
  const el = e.target;
  if (el.id === 'reg-search') { ui.regSearch = el.value; renderRegister(); }
  else if (el.id === 'acct-search') { ui.acctSearch = el.value; renderUnactive(); }
  else if (el.id === 'f-acv' || el.id === 'f-priceIncrease') updateProposed();
});
document.getElementById('reg-type').addEventListener('change', e => { ui.regType = e.target.value; renderRegister(); });
document.getElementById('reg-flag').addEventListener('change', e => { ui.regFlag = e.target.value; renderRegister(); });
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (document.getElementById('modal').classList.contains('open')) closeModal();
  else if (ui.drawerKind) closeDrawer();
});

// ── BOOT ─────────────────────────────────────────────────────────────
seedIfNeeded();
migrateBuildopsIds();
render();
if (location.hash === '#unactive') switchTab('unactive');

})();
