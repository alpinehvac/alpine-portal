// ── Alpine HVAC — Outbound territory map ─────────────────────────────
// Loaded by outbound.html after cloud-sync.js has pulled outbound_data and
// site_data into localStorage. Keys (outbound_data):
//   ob_leads      lead sheet rows, written by the daily refresh (outbound-build.py)
//   ob_customers  BuildOps property list, written by the daily refresh
//   ob_targets    researched buildings not yet contacted
//   ob_claims     { targetId: { by, at } } — who is going after which target
//   ob_geo        geocode cache { addressKey: { lat, lng, src, muni, t } }
// st_site_* (site_data) adds agreement sites from the weekly BuildOps refresh.
// Addresses are geocoded in the browser (OpenStreetMap Nominatim, 1 request/second)
// the first time they appear, and cached for everyone in ob_geo.
(function () {
'use strict';

const SHEET_URL = 'https://netorg13787440-my.sharepoint.com/:x:/g/personal/natalie_townsend_alpinehvac_ca/IQDFyXX0JO36RaKmRK5rUj8TATpMgjfqE_WIuufYkn7YIIw?e=cX7qOq';
const SHOP = { name: 'Alpine HVAC shop', address: '4241 Victoria Ave, Vineland Station', lat: 43.1786, lng: -79.3925 };
const HAMILTON = [43.2557, -79.8711];
const STATUSES = [
  { k: 'Not contacted', v: '--s-not' }, { k: 'Contacted', v: '--s-contacted' },
  { k: 'Follow-up booked', v: '--s-follow' }, { k: 'Quoted', v: '--s-quoted' },
  { k: 'Bid list', v: '--s-bid' }, { k: 'Bids & tenders only', v: '--s-tender' },
  { k: 'Converted', v: '--s-converted' }, { k: 'Dead', v: '--s-dead' },
];
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const COLOR = {}; STATUSES.forEach(s => COLOR[s.k] = css(s.v));
const REPS = ['All', 'Natalie', 'Jake', 'Mike'];
const AGES = [['any', 'Any'], ['30', '< 30 days'], ['90', '30–90 days'], ['old', '> 90 days'], ['never', 'Never']];
const DAY = 86400000;

const session = (typeof apGetSession === 'function' && apGetSession()) || { name: 'Unknown', roles: [] };
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const readJSON = k => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
const todayISO = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const daysSince = iso => iso ? Math.floor((Date.now() - new Date(iso + 'T12:00:00').getTime()) / DAY) : null;
const fmtDate = iso => iso ? new Date(iso + 'T12:00:00').toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
const normName = s => String(s || '').toLowerCase().replace(/\b(inc|ltd|limited|corp|corporation|co|the|ltee|llc)\b\.?/g, '').replace(/[^a-z0-9]/g, '');
function cleanAddr(a) {
  return String(a || '')
    .replace(/\(.*?\)/g, ' ')
    .replace(/\bHQ\b\s*=?/gi, ' ')
    .replace(/\b(suite|unit|ste|bldg|building|floor)\s*#?\s*[\w-]+/gi, ' ')
    .replace(/#\s*\w+/g, ' ')
    .replace(/\b[A-Z]\d[A-Z]\s?-?\d[A-Z]\d\b/gi, ' ')
    .replace(/^\s*\d+\s*-\s*(?=\d)/, '')
    .replace(/(\d)-(?=[A-Za-z])/g, '$1 ')
    .replace(/\s+/g, ' ').replace(/[,\s.]+$/, '').trim();
}
const addrKey = a => cleanAddr(a).toLowerCase().replace(/\b(road)\b/g, 'rd').replace(/\b(street)\b/g, 'st').replace(/\b(avenue)\b/g, 'ave').replace(/\b(drive)\b/g, 'dr').replace(/\b(east)\b/g, 'e').replace(/\b(west)\b/g, 'w').replace(/\b(north)\b/g, 'n').replace(/\b(south)\b/g, 's').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
function km(a, b) {
  const R = 6371, t = x => x * Math.PI / 180;
  const dLat = t(b.lat - a.lat), dLng = t(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(t(a.lat)) * Math.cos(t(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const repOf = r => { const s = (r || '').toLowerCase(); const out = []; if (/nat/.test(s)) out.push('Natalie'); if (/jake/.test(s)) out.push('Jake'); if (/mike/.test(s)) out.push('Mike'); return out; };
const myName = session.name ? session.name.split(' ')[0] : 'Me';
// Focus view (default for everyone but Natalie): only the knock list, map and your door-knock follow-ups.
// Lead-sheet sections stay one click away under "Show full team view". Remembered per browser.
let focusView = (() => { try { const v = localStorage.getItem('ob_focus_view'); if (v !== null) return v === '1'; } catch (e) {} return myName !== 'Natalie'; })();
function applyFocus() {
  document.body.classList.toggle('focus', focusView);
  const b = document.getElementById('view-toggle'); if (b) b.textContent = focusView ? 'Show full team view' : 'Back to my focus view';
}
document.getElementById('view-toggle')?.addEventListener('click', () => {
  focusView = !focusView; try { localStorage.setItem('ob_focus_view', focusView ? '1' : '0'); } catch (e) {}
  applyFocus(); renderFollowReq();
});
applyFocus();

// ── Collapsible sections ────────────────────────────────────────────
// Every section (and each half of the two-column section) opens from its title and starts
// condensed, so the whole page fits on one screen. The embedded map view stays open.
const EMBED = document.documentElement.classList.contains('ap-embed');
const czUnits = [];
document.querySelectorAll('main .h2-row').forEach(hr => {
  const unit = hr.parentElement, h2 = hr.querySelector('h2'); if (!h2) return;
  unit.classList.add('cz-unit'); if (!EMBED) unit.classList.add('collapsed');
  h2.classList.add('cz-head'); h2.setAttribute('role', 'button'); h2.tabIndex = 0;
  h2.setAttribute('aria-expanded', EMBED ? 'true' : 'false');
  czUnits.push(unit);
});
function czSet(unit, open) {
  if (!unit) return;
  unit.classList.toggle('collapsed', !open);
  const h2 = unit.querySelector('.cz-head'); if (h2) h2.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open && unit.contains(document.getElementById('map'))) mapShown();
}
document.addEventListener('click', e => {
  const h = e.target.closest('.cz-head'); if (!h || e.target.closest('a,button,select,input')) return;
  const u = h.closest('.cz-unit'); czSet(u, u.classList.contains('collapsed'));
});
document.addEventListener('keydown', e => {
  const h = e.target.closest && e.target.closest('.cz-head'); if (!h || (e.key !== 'Enter' && e.key !== ' ')) return;
  e.preventDefault(); const u = h.closest('.cz-unit'); czSet(u, u.classList.contains('collapsed'));
});
if (!EMBED) {
  const bar = document.createElement('div'); bar.className = 'cz-bar';
  bar.innerHTML = '<button class="btn sm ghost" id="cz-open">Expand all</button><button class="btn sm ghost" id="cz-close">Collapse all</button>';
  const first = document.querySelector('main > section'); first.parentNode.insertBefore(bar, first);
  bar.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; czUnits.forEach(u => czSet(u, b.id === 'cz-open')); });
}
// Open the map section (if collapsed) and let Leaflet re-measure before any fly-to.
function showMap() { czSet(document.getElementById('map').closest('.cz-unit'), true); }

// ── Data ────────────────────────────────────────────────────────────
const leadsDoc = readJSON('ob_leads') || { rows: [] };
const custDoc = readJSON('ob_customers') || { rows: [] };
const targetsDoc = readJSON('ob_targets') || { rows: [] };
let claims = readJSON('ob_claims') || {};
let geo = readJSON('ob_geo') || {};
// Door-knock conversations from Jake's Fireflies recordings (daily refresh): { rows: [ … ] }
const knocks = ((readJSON('ob_knocks') || {}).rows || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
const knocksFor = (kind, id) => (kind === 'lead' ? knockIdx().byLead : knockIdx().byTarget)[id] || [];
// ob_reports: { rows: [ { id, rep, sent, subject, days: [{date, items: [..]}], highlights: [{company, note}], next } ] }
// written by the morning refresh from the daily report emails reps send Jake (merged by email id).
const reports = ((readJSON('ob_reports') || {}).rows || []).slice().sort((a, b) => (b.sent || '').localeCompare(a.sent || ''));
const INTEREST = { Hot: '#B83227', Warm: '#D9A441', Cold: '#5A7A80', 'Not interested': '#8A8A8A' };
function knockHTML(list) {
  if (!list.length) return '';
  return '<div class="knocks"><div class="kh">Door-knock conversations</div>' + list.map(k =>
    '<div class="kn"><b>' + fmtDate(k.date) + '</b>' + (k.interest ? ' <span class="chip" style="background:' + (INTEREST[k.interest] || '#5A7A80') + '">' + esc(k.interest) + '</span>' : '') +
    (k.contact ? ' · ' + esc(k.contact) + (k.role ? ' (' + esc(k.role) + ')' : '') : '') +
    '<p>' + esc(k.summary || '') + '</p>' + (k.nextStep ? '<p><i>Next:</i> ' + esc(k.nextStep) + (k.followUp ? ' · ' + fmtDate(k.followUp) : '') + '</p>' : '') +
    (k.url ? '<a href="' + esc(k.url) + '" target="_blank" rel="noopener">Recording ↗</a>' : '') + '</div>').join('') + '</div>';
}

const leads = (leadsDoc.rows || []).map(r => ({ ...r, kind: 'lead', reps: repOf(r.rep), gkey: r.mappable ? addrKey(r.address) + '|' + addrKey(r.city) : 'id:' + r.id }));

// Customers: BuildOps property list + agreement sites, de-duplicated by address
const customers = [];
const custSeen = new Set();
function addCustomer(c) {
  if (!c || !c.address) return;
  const k = addrKey(c.address);
  if (!k || custSeen.has(k)) return;
  custSeen.add(k);
  customers.push({ kind: 'customer', id: c.id || k, name: c.name || c.customer || '', customer: c.customer || '', address: c.address, sas: c.sas || [], gkey: k + '|' });
}
(custDoc.rows || []).forEach(addCustomer);
Object.keys(localStorage).filter(k => k.startsWith('st_site_')).forEach(k => addCustomer(readJSON(k)));

// Targets, minus anything already on the sheet or in BuildOps
const leadNames = new Set(leads.map(l => normName(l.company)).filter(n => n.length > 3));
const leadAddrs = new Set(leads.map(l => addrKey(l.address)).filter(Boolean));
const custNames = new Set(customers.map(c => normName(c.customer || c.name)).filter(n => n.length > 3));
// Area for a point: nearest community centre (matches how the lead sheet names areas)
const CENTROIDS = [['Hamilton', 43.2557, -79.8711], ['Stoney Creek', 43.2177, -79.7600], ['Ancaster', 43.2177, -79.9870], ['Dundas', 43.2650, -79.9550], ['Waterdown', 43.3330, -79.8930], ['Binbrook', 43.1220, -79.8090], ['Mount Hope', 43.1510, -79.9060], ['Burlington', 43.3255, -79.7990], ['Oakville', 43.4675, -79.6877], ['Milton', 43.5183, -79.8774], ['Georgetown', 43.6500, -79.9170], ['Grimsby', 43.2000, -79.5600], ['Beamsville', 43.1650, -79.4760], ['Vineland', 43.1540, -79.3930], ['Jordan', 43.1440, -79.3700], ['Smithville', 43.0940, -79.5490], ['St. Catharines', 43.1594, -79.2469], ['Thorold', 43.1250, -79.1990], ['Niagara-on-the-Lake', 43.2550, -79.0710], ['Niagara Falls', 43.0896, -79.0849], ['Welland', 42.9920, -79.2483], ['Fonthill', 43.0430, -79.2840], ['Port Colborne', 42.8860, -79.2500], ['Fort Erie', 42.9050, -78.9260], ['Wainfleet', 42.9200, -79.3800], ['Caledonia', 43.0730, -79.9530]];
function nearestArea(p) { let best = null, bd = 1e9; CENTROIDS.forEach(([n, la, ln]) => { const d = km(p, { lat: la, lng: ln }); if (d < bd) { bd = d; best = n; } }); return best; }

// OpenStreetMap building list (compact rows, one key per sector, built by obBuildTargets)
const OSM_KEYS = ['ob_targets_osm_ind', 'ob_targets_osm_com', 'ob_targets_osm_res', 'ob_targets_osm_inst'];
const fmtSqft = n => n ? '≈ ' + (Math.round(n / 1000) * 1000).toLocaleString('en-CA') + ' sq ft' : '';
function fromOsm(r) {
  return { id: r.i, name: r.n, address: r.a || '', area: r.c || nearestArea({ lat: r.y, lng: r.x }), sector: r.s, type: r.t, sqft: r.q || null, levels: r.l || null,
    size: r.q ? fmtSqft(r.q) + (r.l > 1 ? ' (' + r.l + ' floors)' : '') : '', why: r.w || '', lat: r.y, lng: r.x, osm: true, source: 'https://www.openstreetmap.org/' + r.i.replace(/^o([nwr])/, (m, k) => ({ n: 'node/', w: 'way/', r: 'relation/' })[k]) };
}
const osmDocs = OSM_KEYS.map(k => readJSON(k)).filter(Boolean);
const targetsAll = (targetsDoc.rows || []).map(t => ({ ...t, sqft: t.sqft || null }))
  .concat(...osmDocs.map(d => (d.rows || []).map(fromOsm)))
  .map(t => ({ ...t, kind: 'target', gkey: t.address ? addrKey(t.address) + '|' + addrKey(t.area) : 'n:' + normName(t.name) + '|' + addrKey(t.area) }));
const isCoveredByName = t => (t.address && (leadAddrs.has(addrKey(t.address)) || custSeen.has(addrKey(t.address)))) || leadNames.has(normName(t.name)) || custNames.has(normName(t.name));

// ── Geocoding (browser-side, cached for everyone in ob_geo) ──────────
const posOf = x => { if (x.lat != null && x.lng != null) return { lat: +x.lat, lng: +x.lng }; const g = geo[x.gkey]; return g && g.src !== 'fail' ? { lat: g.lat, lng: g.lng } : null; };
const muniOf = x => (geo[x.gkey] && geo[x.gkey].muni) || '';
let geoBusy = false, geoDirty = 0;
function saveGeo() { localStorage.setItem('ob_geo', JSON.stringify(geo)); geoDirty = 0; }
async function nominatim(q) {
  const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=1&countrycodes=ca&viewbox=-81.4,44.3,-78.7,42.7&q=' + encodeURIComponent(q);
  const r = await fetch(url, { headers: { 'Accept-Language': 'en' } });
  if (!r.ok) throw new Error('geocoder ' + r.status);
  const j = await r.json();
  if (!j.length) return null;
  const a = j[0].address || {};
  return { lat: +j[0].lat, lng: +j[0].lon, muni: a.city || a.town || a.village || a.municipality || a.county || '', exact: !!a.house_number };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
function attemptsFor(x) {
  if (x.kind === 'shop') return ['4241 Victoria Avenue, Vineland Station, Ontario', '4241 Victoria Avenue, Lincoln, Ontario'];
  const a = cleanAddr(x.address);
  const city = x.kind === 'lead' ? x.city : (x.area || '');
  const out = [];
  if (a) {
    out.push(a + (city && !a.toLowerCase().includes(city.toLowerCase()) ? ', ' + city : '') + ', Ontario');
    out.push(a + ', Ontario');
  }
  const name = x.company || x.name;
  if (name && city && x.kind !== 'knock') out.push(name + ', ' + city + ', Ontario');
  return [...new Set(out)];
}
async function runGeocoder() {
  if (geoBusy) return;
  const queue = [];
  const want = (x) => {
    if (x.lat != null) return;
    if (x.kind === 'lead' && !x.mappable) return;
    if (x.kind === 'knock' && !x.address) return;
    const g = geo[x.gkey];
    if (g && (g.src !== 'fail' || Date.now() - (g.t || 0) < 14 * DAY)) return;
    if (!queue.some(q => q.gkey === x.gkey)) queue.push(x);
  };
  if (!geo.__shop) queue.push({ kind: 'shop', gkey: '__shop', address: '4241 Victoria Ave', area: 'Lincoln', name: '' });
  leads.forEach(want); customers.forEach(want); targetsAll.forEach(want); knockSites().forEach(want);
  if (!queue.length) { $('geo-hint').textContent = ''; return; }
  geoBusy = true;
  let done = 0, failed = 0;
  for (const x of queue) {
    $('geo-hint').textContent = 'Placing new addresses on the map: ' + done + ' of ' + queue.length + ' (about ' + Math.ceil((queue.length - done) * 1.2 / 60) + ' min). Keep this tab open; results save for everyone.';
    let hit = null;
    for (const q of attemptsFor(x)) {
      try { hit = await nominatim(q); } catch (e) { await sleep(5000); }
      await sleep(1150);
      if (hit) break;
    }
    if (hit && x.kind === 'shop' && km(hit, SHOP) > 8) hit = null;
    if (hit) geo[x.gkey] = { lat: hit.lat, lng: hit.lng, muni: hit.muni, exact: hit.exact, src: 'osm', t: Date.now() };
    else { geo[x.gkey] = { src: 'fail', t: Date.now() }; failed++; }
    done++; geoDirty++;
    if (geoDirty >= 10) { saveGeo(); renderAll(false); }
  }
  saveGeo();
  geoBusy = false;
  $('geo-hint').textContent = failed ? failed + ' address' + (failed > 1 ? 'es' : '') + ' could not be found; see "Not on the map" below.' : '';
  renderAll(false);
}

// ── Map ─────────────────────────────────────────────────────────────
const map = L.map('map', { zoomControl: true, preferCanvas: true }).setView(HAMILTON, 10);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom: 19
}).addTo(map);
const layers = {
  grid: L.layerGroup(), rings: L.layerGroup(), customers: L.layerGroup(), targets: L.layerGroup(), knocks: L.layerGroup(), leads: L.layerGroup(),
};
const LAYER_DEFS = [
  { k: 'customers', label: 'Existing customers', on: true, cls: 'sq', color: '--s-customer' },
  { k: 'targets', label: 'Targets not yet contacted', on: true, cls: 'tgt' },
  { k: 'knocks', label: 'Door knocks off the list', on: true, cls: 'kn' },
  { k: 'grid', label: 'Coverage grid (worked areas)', on: false, cls: 'grid' },
  { k: 'rings', label: 'Distance from shop (20 / 40 / 60 km)', on: false, cls: '', color: '--teal' },
];
const state = { status: new Set(STATUSES.map(s => s.k)), layers: new Set(LAYER_DEFS.filter(d => d.on).map(d => d.k)), rep: 'All', age: 'any' };
const shopIcon = L.divIcon({ className: '', html: '<div class="shop-pin" title="Alpine HVAC shop"><svg viewBox="0 0 24 24"><path d="M3 20 L9 9 L13 15 L16 11 L21 20 Z"/></svg></div>', iconSize: [34, 34], iconAnchor: [17, 17] });
const custIcon = L.divIcon({ className: '', html: '<div class="cust-pin"></div>', iconSize: [13, 13], iconAnchor: [6, 6] });
const targetIcon = (claimed) => L.divIcon({ className: '', html: '<div class="dot dia" style="' + (claimed ? 'background:var(--s-target) !important' : '') + '"></div>', iconSize: [12, 12], iconAnchor: [6, 6] });
const knockIcon = interest => L.divIcon({ className: '', html: '<div class="knock-pin" style="background:' + (INTEREST[interest] || css('--s-contacted')) + '"></div>', iconSize: [16, 16], iconAnchor: [8, 8] });
let shopMarker = null;
const markerById = {};

function shopPos() { const g = geo.__shop; return g && g.src !== 'fail' ? { lat: g.lat, lng: g.lng } : { lat: SHOP.lat, lng: SHOP.lng }; }

function leadVisible(l) {
  if (!state.status.has(l.status)) return false;
  if (state.rep !== 'All' && !l.reps.includes(state.rep)) return false;
  if (state.age !== 'any') {
    const d = daysSince(l.lastTouch);
    if (state.age === 'never' && d !== null) return false;
    if (state.age === '30' && !(d !== null && d < 30)) return false;
    if (state.age === '90' && !(d !== null && d >= 30 && d <= 90)) return false;
    if (state.age === 'old' && !(d !== null && d > 90)) return false;
  }
  return true;
}

// Spread pins that share a building so each stays clickable
function spread(items) {
  const groups = {};
  items.forEach(it => { const p = posOf(it); if (!p) return; const k = p.lat.toFixed(4) + ',' + p.lng.toFixed(4); (groups[k] = groups[k] || []).push([it, p]); });
  const out = [];
  Object.values(groups).forEach(g => g.forEach(([it, p], i) => {
    if (g.length === 1) return out.push([it, p]);
    const ang = (2 * Math.PI * i) / g.length, r = 0.00018 * Math.ceil(g.length / 6);
    out.push([it, { lat: p.lat + r * Math.sin(ang), lng: p.lng + r * Math.cos(ang) * 1.4 }]);
  }));
  return out;
}

function chip(status) { return '<span class="chip" style="background:' + (COLOR[status] || '#5A7A80') + '">' + esc(status) + '</span>'; }
function leadPopup(l) {
  const d = daysSince(l.lastTouch);
  return '<div class="pop"><h4>' + esc(l.company || '(no company)') + '</h4>' +
    '<div class="meta">' + chip(l.status) + (l.statusSet ? '' : ' <span title="Set from the Contacted/Quoted columns until the Status column is filled in">(derived)</span>') + '</div>' +
    '<dl><dt>Address</dt><dd>' + esc(l.address || '—') + (l.city ? ', ' + esc(l.city) : '') + (geo[l.gkey] && geo[l.gkey].exact === false ? ' <i>(pin is approximate)</i>' : '') + '</dd>' +
    (l.type ? '<dt>Type</dt><dd>' + esc(l.type) + '</dd>' : '') +
    (l.contact ? '<dt>Contact</dt><dd>' + esc(l.contact) + '</dd>' : '') +
    (l.phone ? '<dt>Phone</dt><dd>' + esc(l.phone) + '</dd>' : '') +
    (l.email ? '<dt>Email</dt><dd><a href="mailto:' + esc(l.email) + '">' + esc(l.email) + '</a></dd>' : '') +
    '<dt>Worked by</dt><dd>' + esc(l.rep || '—') + (l.incoming ? ' · ' + esc(l.incoming) : '') + '</dd>' +
    '<dt>Last touch</dt><dd>' + (l.lastTouch ? fmtDate(l.lastTouch) + ' (' + d + ' days ago)' : esc(l.lastTouchRaw || '—')) + '</dd>' +
    (l.followUp || l.followUpRaw ? '<dt>Follow-up</dt><dd>' + (l.followUp ? fmtDate(l.followUp) : esc(l.followUpRaw)) + '</dd>' : '') +
    '</dl>' + (l.notes ? '<div class="notes">' + esc(l.notes) + '</div>' : '') +
    knockHTML(knocksFor('lead', l.id)) +
    '<div class="acts"><a class="btn sm" href="' + SHEET_URL + '" target="_blank" rel="noopener">Open lead sheet (row ' + l.row + ')</a></div></div>';
}
function custPopup(c) {
  return '<div class="pop"><h4>' + esc(c.name) + '</h4><div class="meta"><span class="chip" style="background:' + css('--s-customer') + '">Existing customer</span></div>' +
    '<dl><dt>Customer</dt><dd>' + esc(c.customer || '—') + '</dd><dt>Address</dt><dd>' + esc(c.address) + '</dd>' +
    (c.sas && c.sas.length ? '<dt>Agreement</dt><dd>' + esc(c.sas.join(', ')) + '</dd>' : '') + '</dl></div>';
}
function targetPopup(t) {
  const c = claims[t.id];
  const p = posOf(t);
  const tk = knocksForTarget(t);
  return '<div class="pop"><h4>' + esc(t.name) + '</h4><div class="meta">' + (tk.length ? '<span class="chip" style="background:' + css('--s-contacted') + '">Knocked ' + fmtDate(tk[0].date) + '</span> ' : '<span class="chip" style="background:' + css('--s-target') + '">Not yet contacted</span> ') + esc(t.sector || '') + '</div>' +
    '<dl><dt>Address</dt><dd>' + (t.address || (geo['rev:' + t.id] && geo['rev:' + t.id].addr) ? esc(t.address || geo['rev:' + t.id].addr) : '<button class="btn sm ghost" data-revgeo="' + esc(t.id) + '">Look up address</button>') + (t.area ? ', ' + esc(t.area) : '') + '</dd>' +
    (t.type ? '<dt>Type</dt><dd>' + esc(t.type) + '</dd>' : '') +
    (t.size ? '<dt>Size</dt><dd>' + esc(t.size) + '</dd>' : '') +
    (t.why ? '<dt>Why</dt><dd>' + esc(t.why) + '</dd>' : '') +
    (p ? '<dt>From shop</dt><dd>' + km(shopPos(), p).toFixed(0) + ' km</dd>' : '') +
    '<dt>Claimed</dt><dd>' + (c ? esc(c.by) + ' · ' + fmtDate(c.at) : 'No') + '</dd></dl>' +
    (t.source ? '<div class="meta"><a href="' + esc(t.source) + '" target="_blank" rel="noopener">' + (t.osm ? 'Building on OpenStreetMap' : 'Source') + '</a></div>' : '') +
    contactHTML(t.id, 'meta') + knockHTML(tk) +
    '<div class="acts">' + claimButton(t) + '</div></div>';
}
function knockPopup(s) {
  const p = posOf(s), g = geo[s.gkey] || {};
  return '<div class="pop"><h4>' + esc(s.name) + '</h4><div class="meta"><span class="chip" style="background:' + css('--s-customer') + '">Door knock · off the list</span></div>' +
    '<dl><dt>Address</dt><dd>' + esc(s.address || '—') + (g.src === 'osm' && g.exact === false ? ' <i>(pin is approximate)</i>' : g.src === 'manual' ? ' <i>(pin placed by hand)</i>' : '') + '</dd>' +
    '<dt>Knocked by</dt><dd>' + esc(s.rep) + '</dd>' +
    '<dt>Last knock</dt><dd>' + fmtDate(s.date) + (s.knocks.length > 1 ? ' · ' + s.knocks.length + ' visits' : '') + '</dd>' +
    (p ? '<dt>From shop</dt><dd>' + km(shopPos(), p).toFixed(0) + ' km</dd>' : '') + '</dl>' +
    '<div class="notes">Not on the lead sheet or the target list. If it\'s worth working, add it to the lead sheet; it becomes a lead pin on the next refresh.</div>' +
    knockHTML(s.knocks) +
    '<div class="acts"><a class="btn sm" href="' + SHEET_URL + '" target="_blank" rel="noopener">Open lead sheet</a><button class="btn sm ghost" data-place="' + esc(s.gkey) + '">Move pin</button></div></div>';
}
function claimButton(t) {
  const c = claims[t.id];
  if (!c) return '<button class="btn sm" data-claim="' + esc(t.id) + '">Claim</button>';
  if (c.by === session.name) return '<button class="btn sm ghost" data-release="' + esc(t.id) + '">Release</button>';
  return '<span class="claimed">' + esc(c.by.split(' ')[0]) + ' has it</span>';
}

function drawMap() {
  Object.values(layers).forEach(l => l.clearLayers());
  Object.keys(markerById).forEach(k => delete markerById[k]);
  const sp = shopPos();
  if (shopMarker) shopMarker.setLatLng([sp.lat, sp.lng]);
  else shopMarker = L.marker([sp.lat, sp.lng], { icon: shopIcon, zIndexOffset: 1000, keyboard: true, title: 'Alpine HVAC shop' })
    .bindPopup('<div class="pop"><h4>Alpine HVAC shop</h4><div class="meta">4241 Victoria Ave, Vineland</div></div>').addTo(map);

  spread(customers).forEach(([c, p]) => {
    const m = L.marker([p.lat, p.lng], { icon: custIcon, title: c.name, zIndexOffset: 500 }).bindPopup(() => custPopup(c));
    m.addTo(layers.customers); markerById['c:' + c.id] = m;
  });
  openTargets().forEach(t => {
    const p = posOf(t); if (!p) return;
    const tk = knocksForTarget(t), kc = tk.length ? (INTEREST[(tk.find(k => k.interest) || {}).interest] || css('--s-contacted')) : null;
    const m = L.circleMarker([p.lat, p.lng], { radius: t.sqft >= 50000 ? 6 : 4.5, color: css('--s-target'), weight: 1.6, fillColor: kc || (claims[t.id] ? css('--s-target') : '#fff'), fillOpacity: 0.9 })
      .bindPopup(() => targetPopup(t), { maxWidth: 320 }).bindTooltip(esc(t.name), { direction: 'top', offset: [0, -4] });
    m.addTo(layers.targets); markerById['t:' + t.id] = m;
  });
  spread(knockSites()).forEach(([s, p]) => {
    const m = L.marker([p.lat, p.lng], { icon: knockIcon(s.interest), title: s.name, zIndexOffset: 800 })
      .bindPopup(() => knockPopup(s), { maxWidth: 340 }).bindTooltip(esc(s.name), { direction: 'top', offset: [0, -8] });
    m.addTo(layers.knocks); markerById['k:' + s.id] = m;
  });
  spread(leads.filter(leadVisible)).forEach(([l, p]) => {
    const m = L.circleMarker([p.lat, p.lng], { radius: 6.5, color: '#fff', weight: 1.6, fillColor: COLOR[l.status], fillOpacity: 0.95 })
      .bindPopup(() => leadPopup(l), { maxWidth: 340 }).bindTooltip(esc(l.company), { direction: 'top', offset: [0, -6] });
    m.addTo(layers.leads); markerById['l:' + l.id] = m;
  });
  drawGrid();
  [20, 40, 60].forEach(r => {
    L.circle([sp.lat, sp.lng], { radius: r * 1000, color: css('--teal'), weight: 1, fill: false, dashArray: '5 6', interactive: false }).addTo(layers.rings);
    L.marker([sp.lat + r / 111, sp.lng], { icon: L.divIcon({ className: '', html: '<span class="hq-label">' + r + ' km</span>', iconSize: [40, 16], iconAnchor: [20, 8] }), interactive: false }).addTo(layers.rings);
  });
  Object.entries(layers).forEach(([k, lg]) => {
    const on = k === 'leads' || state.layers.has(k);
    if (on && !map.hasLayer(lg)) lg.addTo(map);
    if (!on && map.hasLayer(lg)) map.removeLayer(lg);
  });
}

// Coverage grid: ~1.6 km cells. Green = worked (contacted leads / customers); orange outline = targets left there.
function drawGrid() {
  const H = 0.0145, W = 0.0195, cells = {};
  const cell = p => Math.floor(p.lat / H) + ':' + Math.floor(p.lng / W);
  const bump = (p, f) => { const k = cell(p); const c = cells[k] = cells[k] || { worked: 0, leads: 0, cust: 0, targets: 0, knocks: 0 }; f(c); };
  leads.forEach(l => { const p = posOf(l); if (!p) return; bump(p, c => { c.leads++; if (l.status !== 'Not contacted') c.worked++; }); });
  customers.forEach(x => { const p = posOf(x); if (p) bump(p, c => c.cust++); });
  knockSites().forEach(x => { const p = posOf(x); if (p) bump(p, c => { c.knocks++; c.worked++; }); });
  openTargets().forEach(t => { const p = posOf(t); if (p) bump(p, c => c.targets++); });
  Object.entries(cells).forEach(([k, c]) => {
    const [a, b] = k.split(':').map(Number);
    const worked = c.worked + c.cust;
    const op = worked ? Math.min(0.55, 0.15 + worked * 0.05) : 0;
    L.rectangle([[a * H, b * W], [(a + 1) * H, (b + 1) * W]], {
      color: c.targets && !worked ? css('--s-not') : 'rgba(46,125,87,.55)', weight: c.targets && !worked ? 1.5 : 0.6,
      fillColor: css('--s-converted'), fillOpacity: op, interactive: true,
    }).bindTooltip(c.leads + ' lead' + (c.leads === 1 ? '' : 's') + ' (' + c.worked + ' worked) · ' + c.cust + ' customer site' + (c.cust === 1 ? '' : 's') + ' · ' + c.targets + ' target' + (c.targets === 1 ? '' : 's') + ' left' + (c.knocks ? ' · ' + c.knocks + ' off-list knock' + (c.knocks === 1 ? '' : 's') : ''), { sticky: true }).addTo(layers.grid);
  });
}

// A target is covered when it's on the sheet / in BuildOps by name or address, or when a lead or
// customer pin sits within 60 m (same building). OSM buildings next to a researched target are dropped.
let _open = null;
function openTargets() {
  if (_open) return _open;
  const idx = {}, cellOf = p => Math.round(p.lat * 1500) + ':' + Math.round(p.lng * 1100);
  const index = (p, tag) => { const k = cellOf(p); (idx[k] = idx[k] || []).push([p, tag]); };
  const near = (p, m, tag) => { const a = Math.round(p.lat * 1500), b = Math.round(p.lng * 1100); for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const [q, tg] of (idx[(a + i) + ':' + (b + j)] || [])) if ((!tag || tg === tag) && km(p, q) * 1000 < m) return true; return false; };
  leads.forEach(l => { const p = posOf(l); if (p) index(p, 'x'); });
  customers.forEach(c => { const p = posOf(c); if (p) index(p, 'x'); });
  const curated = targetsAll.filter(t => !t.osm);
  curated.forEach(t => { const p = posOf(t); if (p) index(p, 'c'); });
  _open = targetsAll.filter(t => {
    if (isCoveredByName(t)) return false;
    const p = posOf(t);
    if (p && near(p, 60, 'x')) return false;
    if (t.osm && p && near(p, 60, 'c')) return false;
    return true;
  });
  return _open;
}

// ── Side panel controls ─────────────────────────────────────────────
function renderControls() {
  const counts = {}; leads.forEach(l => counts[l.status] = (counts[l.status] || 0) + 1);
  $('tg-status').innerHTML = STATUSES.map(s => '<li data-s="' + esc(s.k) + '" class="' + (state.status.has(s.k) ? '' : 'off') + '" role="checkbox" aria-checked="' + state.status.has(s.k) + '" tabindex="0"><span class="dot" style="background:' + COLOR[s.k] + '"></span>' + esc(s.k) + '<span class="n">' + (counts[s.k] || 0) + '</span></li>').join('');
  const lc = { customers: customers.length, targets: openTargets().length, knocks: knockSites().length };
  $('tg-layers').innerHTML = LAYER_DEFS.map(d => '<li data-l="' + d.k + '" class="' + (state.layers.has(d.k) ? '' : 'off') + '" role="checkbox" aria-checked="' + state.layers.has(d.k) + '" tabindex="0"><span class="dot ' + d.cls + '" style="' + (d.color ? 'background:' + css(d.color) : '') + '"></span>' + esc(d.label) + '<span class="n">' + (lc[d.k] != null ? lc[d.k] : '') + '</span></li>').join('');
  $('tg-rep').innerHTML = REPS.map(r => '<button data-rep="' + r + '" class="' + (state.rep === r ? 'on' : '') + '">' + r + '</button>').join('');
  $('tg-age').innerHTML = AGES.map(([k, l]) => '<button data-age="' + k + '" class="' + (state.age === k ? 'on' : '') + '">' + l + '</button>').join('');
}
function toggle(set, k) { set.has(k) ? set.delete(k) : set.add(k); }
document.addEventListener('click', e => {
  const s = e.target.closest('[data-s]'), l = e.target.closest('[data-l]'), rep = e.target.closest('[data-rep]'), age = e.target.closest('[data-age]');
  if (s) { if (e.altKey || e.metaKey) { state.status = new Set([s.dataset.s]); } else toggle(state.status, s.dataset.s); renderControls(); drawMap(); }
  if (l) { toggle(state.layers, l.dataset.l); renderControls(); drawMap(); }
  if (rep) { state.rep = rep.dataset.rep; renderControls(); drawMap(); }
  if (age) { state.age = age.dataset.age; renderControls(); drawMap(); }
  const c = e.target.closest('[data-claim]'), r = e.target.closest('[data-release]');
  if (c) setClaim(c.dataset.claim, true);
  if (r) setClaim(r.dataset.release, false);
  const fly = e.target.closest('[data-fly]');
  if (fly) { e.preventDefault(); flyTo(fly.dataset.fly); }
  const place = e.target.closest('[data-place]');
  if (place) startPlacing(place.dataset.place);
  const area = e.target.closest('[data-area]');
  if (area) fitArea(area.dataset.area);
  const rg = e.target.closest('[data-revgeo]');
  if (rg) reverseAddress(rg.dataset.revgeo, rg);
  if (e.target.closest('#osm-build')) startOsmBuild();
});
async function reverseAddress(id, btn) {
  const t = targetsAll.find(x => x.id === id); const p = t && posOf(t); if (!p) return;
  btn.disabled = true; btn.textContent = 'Looking up…';
  try {
    const r = await fetch('https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&lat=' + p.lat + '&lon=' + p.lng);
    const j = await r.json(); const a = j.address || {};
    const addr = [a.house_number, a.road].filter(Boolean).join(' ') || (j.display_name || '').split(',').slice(0, 2).join(',');
    geo = readJSON('ob_geo') || geo; geo['rev:' + id] = { src: 'rev', addr, t: Date.now() }; saveGeo();
    btn.outerHTML = esc(addr + (a.house_number ? '' : ' (nearest street)'));
  } catch (err) { btn.textContent = 'Not found'; }
}
document.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.toggles li')) { e.preventDefault(); e.target.click(); } });

function setClaim(id, on) {
  claims = readJSON('ob_claims') || {};
  if (on) { if (claims[id] && claims[id].by !== session.name) return; claims[id] = { by: session.name, at: todayISO() }; }
  else delete claims[id];
  localStorage.setItem('ob_claims', JSON.stringify(claims));
  map.closePopup();
  renderAll(true);
}

function flyTo(ref) {
  const m = markerById[ref];
  const kind = ref[0];
  if (kind === 'l') { const l = leads.find(x => 'l:' + x.id === ref); if (l && !state.status.has(l.status)) { state.status.add(l.status); renderControls(); } state.rep = 'All'; state.age = 'any'; renderControls(); drawMap(); }
  if (kind === 't' && !state.layers.has('targets')) { state.layers.add('targets'); renderControls(); drawMap(); }
  if (kind === 'c' && !state.layers.has('customers')) { state.layers.add('customers'); renderControls(); drawMap(); }
  if (kind === 'k' && !state.layers.has('knocks')) { state.layers.add('knocks'); renderControls(); drawMap(); }
  const mk = markerById[ref] || m;
  if (!mk) return;
  showMap(); document.getElementById('map').scrollIntoView({ behavior: 'smooth', block: 'center' });
  map.flyTo(mk.getLatLng(), Math.max(map.getZoom(), 16), { duration: 0.8 });
  setTimeout(() => mk.openPopup(), 850);
}

function fitArea(area) {
  const pts = [];
  leads.forEach(l => { if (areaOfLead(l) === area) { const p = posOf(l); if (p) pts.push([p.lat, p.lng]); } });
  openTargets().forEach(t => { if (t.area === area) { const p = posOf(t); if (p) pts.push([p.lat, p.lng]); } });
  customers.forEach(c => { if (areaOfCust(c) === area) { const p = posOf(c); if (p) pts.push([p.lat, p.lng]); } });
  if (!pts.length) return;
  showMap(); document.getElementById('map').scrollIntoView({ behavior: 'smooth', block: 'center' });
  map.fitBounds(pts, { padding: [40, 40], maxZoom: 15 });
}

// Manual pin placement for addresses the geocoder couldn't find
let placing = null;
function startPlacing(gkey) {
  placing = gkey;
  showMap(); document.getElementById('map').scrollIntoView({ behavior: 'smooth', block: 'center' });
  $('geo-hint').innerHTML = '<b>Click the map where this building is.</b> <a href="#" id="cancel-place">Cancel</a>';
  $('cancel-place').onclick = ev => { ev.preventDefault(); placing = null; $('geo-hint').textContent = ''; };
  map.getContainer().style.cursor = 'crosshair';
}
map.on('click', e => {
  if (!placing) return;
  geo = readJSON('ob_geo') || geo;
  geo[placing] = { lat: e.latlng.lat, lng: e.latlng.lng, src: 'manual', by: session.name, t: Date.now() };
  saveGeo();
  placing = null; map.getContainer().style.cursor = ''; $('geo-hint').textContent = 'Pin saved.';
  renderAll(true);
});

// ── Check before you knock ──────────────────────────────────────────
let searchSeq = 0;
$('q').addEventListener('input', () => { clearTimeout($('q')._t); $('q')._t = setTimeout(doSearch, 220); });
async function doSearch() {
  const q = $('q').value.trim().toLowerCase();
  const out = $('results');
  if (q.length < 2) { out.innerHTML = ''; return; }
  const words = q.split(/\s+/);
  const hit = s => { const t = String(s || '').toLowerCase(); return words.every(w => t.includes(w)); };
  const res = [];
  leads.forEach(l => { if (hit(l.company + ' ' + l.address + ' ' + l.city)) res.push({ ref: 'l:' + l.id, title: l.company, sub: chip(l.status) + ' ' + esc(l.address) + ' · ' + esc(l.rep) + (l.lastTouch ? ' · ' + fmtDate(l.lastTouch) : '') }); });
  customers.forEach(c => { if (hit(c.name + ' ' + c.customer + ' ' + c.address)) res.push({ ref: 'c:' + c.id, title: c.name, sub: '<span class="chip" style="background:' + css('--s-customer') + '">Customer</span> ' + esc(c.address) }); });
  knockSites().forEach(s => { if (hit(s.name + ' ' + s.address)) res.push({ ref: 'k:' + s.id, title: s.name, sub: '<span class="chip" style="background:' + css('--s-customer') + '">Door knock</span> ' + esc(s.address || 'no address') + ' · ' + esc(s.rep) + ' · ' + fmtDate(s.date) }); });
  openTargets().forEach(t => { if (hit(t.name + ' ' + t.address + ' ' + t.area)) res.push({ ref: 't:' + t.id, title: t.name, sub: '<span class="chip" style="background:' + css('--s-target') + '">Target</span> ' + esc(t.address) + (claims[t.id] ? ' · claimed by ' + esc(claims[t.id].by.split(' ')[0]) : '') }); });
  if (res.length) {
    out.innerHTML = res.slice(0, 12).map(r => '<li data-fly="' + r.ref + '"><b>' + esc(r.title) + '</b><small>' + r.sub + '</small></li>').join('') + (res.length > 12 ? '<li class="none">' + (res.length - 12) + ' more; keep typing</li>' : '');
    return;
  }
  if (!/\d/.test(q) || q.length < 6) { out.innerHTML = '<li class="none">Not on the sheet, in BuildOps or on the target list.</li>'; return; }
  const seq = ++searchSeq;
  out.innerHTML = '<li class="none">Not on the sheet. Looking up the address…</li>';
  let p = null;
  try { p = await nominatim(cleanAddr($('q').value) + ', Ontario'); } catch (e) { /* offline */ }
  if (seq !== searchSeq) return;
  if (!p) { out.innerHTML = '<li class="none">Not on the sheet, and the address wasn\'t found on the map.</li>'; return; }
  const near = leads.map(l => [l, posOf(l)]).filter(([, lp]) => lp && km(p, lp) < 0.3).sort((a, b) => km(p, a[1]) - km(p, b[1]));
  out.innerHTML = '<li class="none"><b>Not on the sheet.</b> ' + (near.length ? near.length + ' lead' + (near.length > 1 ? 's' : '') + ' within 300 m:' : 'Nothing logged within 300 m; this one is open.') + '</li>' +
    near.slice(0, 8).map(([l, lp]) => '<li data-fly="l:' + l.id + '"><b>' + esc(l.company) + '</b><small>' + chip(l.status) + ' ' + Math.round(km(p, lp) * 1000) + ' m away · ' + esc(l.rep) + '</small></li>').join('');
  map.flyTo([p.lat, p.lng], 16);
}

// ── Tables ──────────────────────────────────────────────────────────
const HAM_COMMUNITIES = ['stoney creek', 'ancaster', 'dundas', 'waterdown', 'binbrook', 'flamborough', 'glanbrook', 'mount hope'];
function tidyArea(a) { a = (a || '').trim(); if (!a) return ''; return a.split(/\s+/).map(w => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(' '); }
function areaOfLead(l) { return tidyArea(l.city) || tidyArea(muniOf(l)) || 'Unknown'; }
function areaOfCust(c) {
  const m = muniOf(c); if (m) return tidyArea(m);
  const parts = String(c.address).split(',').map(s => s.trim()).filter(Boolean);
  return tidyArea(parts.length > 1 ? parts[parts.length - 2].replace(/\b(ON|Ontario)\b.*$/i, '').trim() : '') || 'Unknown';
}

const sortState = { areas: { k: 'targets', d: -1 }, targets: { k: 'dist', d: 1 } };
function sortable(id, cols, rows, key, render, cap) {
  const st = sortState[key];
  rows.sort((a, b) => { const x = a[st.k], y = b[st.k]; if (x === y) return 0; if (x == null || x === '') return 1; if (y == null || y === '') return -1; return (x > y ? 1 : -1) * st.d; });
  $(id).innerHTML = '<thead><tr>' + cols.map(c => '<th data-sort="' + key + ':' + c[0] + '" class="' + (c[2] || '') + '">' + c[1] + (st.k === c[0] ? (st.d > 0 ? ' ↑' : ' ↓') : '') + '</th>').join('') + '</tr></thead><tbody>' + (rows.length ? rows.slice(0, cap || rows.length).map(render).join('') : '<tr><td colspan="' + cols.length + '" class="empty-row">Nothing here yet.</td></tr>') + '</tbody>';
}
document.addEventListener('click', e => {
  const th = e.target.closest('th[data-sort]'); if (!th) return;
  const [key, k] = th.dataset.sort.split(':'); const st = sortState[key];
  st.d = st.k === k ? -st.d : (['area', 'name', 'sector'].includes(k) ? 1 : -1); st.k = k;
  key === 'areas' ? renderAreas() : renderTargets();
});

function renderAreas() {
  const A = {};
  const get = a => A[a] = A[a] || { area: a, leads: 0, worked: 0, follow: 0, quoted: 0, converted: 0, dead: 0, notc: 0, cust: 0, targets: 0, last: '' };
  leads.forEach(l => {
    const r = get(areaOfLead(l)); r.leads++;
    if (l.status !== 'Not contacted') r.worked++; else r.notc++;
    if (l.status === 'Follow-up booked') r.follow++;
    if (l.status === 'Quoted' || l.status === 'Bid list') r.quoted++;
    if (l.status === 'Converted') r.converted++;
    if (l.status === 'Dead') r.dead++;
    if (l.lastTouch && l.lastTouch > r.last) r.last = l.lastTouch;
  });
  customers.forEach(c => get(areaOfCust(c)).cust++);
  openTargets().forEach(t => get(tidyArea(t.area) || 'Unknown').targets++);
  const rows = Object.values(A).map(r => ({ ...r, pct: r.leads ? r.worked / r.leads : 0 }));
  sortable('t-areas', [['area', 'Area'], ['leads', 'Leads', 'num'], ['worked', 'Contacted', 'num'], ['notc', 'Not yet', 'num'], ['follow', 'Follow-ups', 'num'], ['quoted', 'Quoted / bid', 'num'], ['converted', 'Converted', 'num'], ['dead', 'Dead', 'num'], ['cust', 'Customer sites', 'num'], ['targets', 'Targets left', 'num'], ['last', 'Last activity'], ['pct', 'Mix', 'nosort']], rows, 'areas', r => {
    const seg = (n, v) => n ? '<i style="width:' + (100 * n / Math.max(1, r.leads)) + '%;background:' + css(v) + '"></i>' : '';
    const d = daysSince(r.last);
    return '<tr><td><a data-area="' + esc(r.area) + '">' + esc(r.area) + '</a></td><td class="num">' + r.leads + '</td><td class="num">' + r.worked + '</td><td class="num">' + r.notc + '</td><td class="num">' + r.follow + '</td><td class="num">' + r.quoted + '</td><td class="num">' + r.converted + '</td><td class="num">' + r.dead + '</td><td class="num">' + r.cust + '</td><td class="num"><b>' + r.targets + '</b></td><td>' + (r.last ? fmtDate(r.last) + '<small>' + d + ' days ago</small>' : '<small>—</small>') + '</td>' +
      '<td><div class="bar" title="Converted / quoted / follow-up / contacted / dead / not contacted">' + seg(r.converted, '--s-converted') + seg(r.quoted, '--s-quoted') + seg(r.follow, '--s-follow') + seg(r.worked - r.converted - r.quoted - r.follow - r.dead, '--s-contacted') + seg(r.dead, '--s-dead') + seg(r.notc, '--s-not') + '</div></td></tr>';
  });
}

function renderTargets() {
  const sp = shopPos();
  const q = $('tq').value.trim().toLowerCase(), fa = $('tf-area').value, fs = $('tf-sector').value, fc = $('tf-claim').value;
  const open = openTargets();
  const rows = open.filter(t => {
    if (fa && t.area !== fa) return false;
    if (fs && t.sector !== fs) return false;
    if (fc === 'open' && claims[t.id]) return false;
    if (fc === 'mine' && !(claims[t.id] && claims[t.id].by === session.name)) return false;
    if (q && !(t.name + ' ' + t.address + ' ' + t.type + ' ' + t.why).toLowerCase().includes(q)) return false;
    return true;
  }).map(t => { const p = posOf(t); return { ...t, dist: p ? km(sp, p) : null, claim: claims[t.id] ? claims[t.id].by : '' }; });
  const CAP = 300;
  $('t-count').textContent = rows.length.toLocaleString('en-CA') + ' of ' + open.length.toLocaleString('en-CA') + ' targets' + (rows.length > CAP ? ' · showing ' + CAP + ' (sort or filter to narrow)' : '') + (targetsAll.length > open.length ? ' · ' + (targetsAll.length - open.length).toLocaleString('en-CA') + ' already on the sheet, in BuildOps or beside a lead' : '');
  sortable('t-targets', [['name', 'Building'], ['sector', 'Sector'], ['area', 'Area'], ['sqft', 'Size', 'num'], ['why', 'Why it fits', 'nosort'], ['dist', 'From shop', 'num'], ['claim', 'Claimed']], rows, 'targets', t =>
    '<tr><td><a data-fly="t:' + esc(t.id) + '">' + esc(t.name) + '</a><small>' + esc(t.address || (geo['rev:' + t.id] && geo['rev:' + t.id].addr) || 'address: click the pin') + '</small></td><td>' + esc(t.sector) + '<small>' + esc(t.type || '') + '</small></td><td>' + esc(t.area) + '</td><td class="num">' + (t.sqft ? (Math.round(t.sqft / 1000)).toLocaleString('en-CA') + 'k' : '') + (t.levels > 1 ? '<small>' + t.levels + ' floors</small>' : '') + '</td><td><small style="color:inherit">' + esc(t.why || '') + '</small></td><td class="num">' + (t.dist != null ? t.dist.toFixed(0) + ' km' : '…') + '</td><td>' + claimButton(t) + '</td></tr>', CAP);
}
function fillTargetFilters() {
  const open = openTargets();
  const areas = [...new Set(open.map(t => t.area).filter(Boolean))].sort();
  const sectors = [...new Set(open.map(t => t.sector).filter(Boolean))].sort();
  const keep = (id, vals, label) => { const cur = $(id).value; $(id).innerHTML = '<option value="">' + label + '</option>' + vals.map(v => '<option' + (v === cur ? ' selected' : '') + '>' + esc(v) + '</option>').join(''); };
  keep('tf-area', areas, 'All areas'); keep('tf-sector', sectors, 'All sectors');
}
['tq', 'tf-area', 'tf-sector', 'tf-claim'].forEach(id => $(id).addEventListener(id === 'tq' ? 'input' : 'change', renderTargets));

// A follow-up counts only if nothing was logged on or after its date.
// Overdue = due in the last 45 days; older ones are "stale" (date on the sheet was never cleared).
function renderFollow() {
  const today = todayISO();
  const iso = ms => new Date(ms).toISOString().slice(0, 10);
  const lim = iso(Date.now() + 14 * DAY), staleBefore = iso(Date.now() - 45 * DAY), week = iso(Date.now() + 7 * DAY);
  const open = leads.filter(l => l.followUp && !['Dead', 'Converted'].includes(l.status) && !(l.lastTouch && l.lastTouch >= l.followUp));
  const rows = open.filter(l => l.followUp <= lim && l.followUp >= staleBefore).sort((a, b) => a.followUp.localeCompare(b.followUp));
  const stale = open.filter(l => l.followUp < staleBefore).length;
  $('t-follow').innerHTML = '<thead><tr><th class="nosort">Due</th><th class="nosort">Company</th><th class="nosort">Rep</th><th class="nosort">Status</th></tr></thead><tbody>' +
    (rows.length ? rows.map(l => '<tr><td class="' + (l.followUp < today ? 'due' : 'soon') + '">' + fmtDate(l.followUp) + '</td><td><a data-fly="l:' + esc(l.id) + '">' + esc(l.company) + '</a><small>' + esc(areaOfLead(l)) + '</small></td><td>' + esc(l.rep) + '</td><td>' + chip(l.status) + '</td></tr>').join('') : '<tr><td colspan="4" class="empty-row">No follow-ups due in the next 14 days.</td></tr>') +
    (stale ? '<tr><td colspan="4" class="empty-row">' + stale + ' older follow-up date' + (stale > 1 ? 's' : '') + ' (45+ days, nothing logged since) are left on the sheet; clear or reset them there.</td></tr>' : '') + '</tbody>';
  return { overdue: rows.filter(l => l.followUp < today).length, week: rows.filter(l => l.followUp >= today && l.followUp <= week).length, stale };
}

function renderUnplaced() {
  const rows = [];
  leads.forEach(l => { const g = geo[l.gkey]; if (l.mappable && !g) return; if (!posOf(l)) rows.push(l); });
  $('t-unplaced').innerHTML = '<thead><tr><th class="nosort">Company</th><th class="nosort">Address on sheet</th><th class="nosort"></th></tr></thead><tbody>' +
    (rows.length ? rows.map(l => '<tr><td>' + esc(l.company) + '<small>Row ' + l.row + ' · ' + esc(l.cityRaw || '') + '</small></td><td>' + esc(l.address || '(blank)') + '</td><td><button class="btn sm ghost" data-place="' + esc(l.gkey) + '">Place pin</button></td></tr>').join('') : '<tr><td colspan="3" class="empty-row">Every lead is on the map.</td></tr>') + '</tbody>';
  return rows.length;
}

// ── This week's knock list (live field sheet) ───────────────────────
// ob_knock_weeks: { rows: [ { week, sent, areas, ids: [target ids in route order] } ] }, written by the
// Monday "100 new knocks" task. A building counts as knocked when a Fireflies conversation is filed
// against it (targetId) or names the same street address or building.
const weeksDoc = readJSON('ob_knock_weeks') || { rows: [] };
// Public contact details found online per target: { rows: { <targetId>: { phone, email, website, note, src, at } } }
const contactsDoc = readJSON('ob_target_contacts') || { rows: {} };
function contactHTML(id, cls) {
  const c = (contactsDoc.rows || {})[id]; if (!c) return '';
  const tel = c.phone ? '<a href="tel:' + esc(c.phone.replace(/[^0-9+]/g, '')) + '">' + esc(c.phone) + '</a>' : '';
  const em = c.email ? '<a href="mailto:' + esc(c.email) + '">' + esc(c.email) + '</a>' : '';
  const web = c.website ? '<a href="' + esc(c.website) + '" target="_blank" rel="noopener">website</a>' : '';
  const parts = [tel, em, web].filter(Boolean);
  return parts.length || c.note ? '<div class="' + (cls || 'wk-sub') + '">☎ ' + parts.join(' · ') + (c.note ? (parts.length ? ' · ' : '') + esc(c.note) : '') + '</div>' : '';
}
const targetById = {}; targetsAll.forEach(t => { targetById[t.id] = t; });
const CHAINS = /walmart|no frills|food basics|zehrs|home depot|dollarama|value village|shoppers|wholesale club|canadian tire/i;
const TOWERS = /marriott|hilton|sheraton|crowne|embassy|fallsview casino|doubletree/i;
function fieldNote(t) {
  const ty = (t.type || '') + ' ' + (t.sector || ''), n = t.name || '', big = (t.sqft || 0) >= 100000;
  if (/municipal|tender|region/i.test(ty + ' ' + n)) return 'Public owner: buys by tender. Get the facilities contact and onto the bid list.';
  if (/long-term|nursing|senior|lodge|manor|retirement|care/i.test(ty + ' ' + n)) return 'Long-term care, occupied 24/7: boilers, make-up air, comfort complaints. Ask for the administrator or maintenance lead.';
  if (/hotel|motel|inn\b/i.test(ty + ' ' + n)) {
    if (TOWERS.test(n) || big) return 'Tower hotel: central plant, chillers and boilers, likely a BAS. Ask for the chief engineer; lead with BAS + mechanical.';
    if (/motel|inn\b|lodge/i.test(n) && (t.sqft || 0) < 25000) return 'Motel: owner-operated, wall units and a hot-water boiler. Owner decides on the spot.';
    return 'Hotel: PTACs or rooftops, hot-water boilers. Ask for the chief engineer or GM; guest complaints cost them rooms.';
  }
  if (CHAINS.test(n)) return 'National chain: HVAC bought by head office or a facilities firm. Ask who services the rooftops and get the FM company name.';
  if (/supermarket|grocery/i.test(ty)) return 'Grocery: rooftops plus refrigeration. Ask the store manager who they call for HVAC.';
  if (/shopping|mall|centre/i.test(ty + ' ' + n) && /retail|shopping|mall/i.test(ty)) return 'Shopping centre: go to the management office; ask for the operations manager.';
  if (/factory|plant|steel|forge|casting|manufactur/i.test(ty + ' ' + n)) return 'Plant: unit heaters, make-up air, process cooling. Ask for the plant or maintenance manager.';
  if (/warehouse|logistics|delivery|distribution/i.test(ty + ' ' + n)) return 'Warehouse: gas unit heaters, dock-door heat loss. Ask for the operations manager.';
  if (/industrial/i.test(ty)) return 'Industrial: unit heaters, rooftops, shop exhaust. Ask for the owner or plant manager.';
  if (/office/i.test(ty)) return 'Office: rooftops or a BAS. Ask who manages the building.';
  if (/retail/i.test(ty)) return 'Retail: one landlord for the plaza. Get the property manager\'s name from a tenant.';
  if (/school|church|court|government|hydro|utility/i.test(ty + ' ' + n)) return 'Institutional: may buy by tender or central contract. Ask for facilities.';
  return 'Find the owner or property manager (tenant board, front desk); ask who services the rooftops.';
}
const numKey = a => { const m = cleanAddr(a || '').toLowerCase().match(/^(\d+)\s+([a-z]+)/); return m ? m[1] + ' ' + m[2] : ''; };
// Every knock is matched to the map once per render: by its lead/target id, else by street number +
// street or company name against the lead sheet and the target list. A knock that matches neither
// (a building outside the weekly list, e.g. Canforge or Goodwill) gets its own "off the list" pin,
// grouped by building, so every conversation shows on the territory map.
let _kidx = null;
function knockIdx() {
  if (_kidx) return _kidx;
  const byLead = {}, byTarget = {}, ref = {}, sites = {}, lA = {}, lN = {}, tA = {}, tN = {};
  const add = (m, k, v) => { if (k) (m[k] = m[k] || []).push(v); };
  leads.forEach(l => { add(lA, numKey(l.address), l); const n = normName(l.company); if (n.length > 5) add(lN, n, l); });
  targetsAll.forEach(t => { add(tA, numKey(t.address || (geo['rev:' + t.id] || {}).addr), t); const n = normName(t.name); if (n.length > 5) add(tN, n, t); });
  const open = new Set(openTargets().map(t => t.id));
  knocks.forEach(k => {
    if (k.leadId) { add(byLead, k.leadId, k); ref[k.id] = 'l:' + k.leadId; return; }
    if (k.targetId) { add(byTarget, k.targetId, k); ref[k.id] = 't:' + k.targetId; return; }
    const a = numKey(k.address), n = normName(k.company), nOk = n.length > 5;
    const ls = (a && lA[a]) || (nOk && lN[n]) || [];
    const ts = [...new Set([...((a && tA[a]) || []), ...((nOk && tN[n]) || [])])];
    ls.forEach(l => add(byLead, l.id, k)); ts.forEach(t => add(byTarget, t.id, k));
    if (ls.length) { ref[k.id] = 'l:' + ls[0].id; return; }
    const ot = ts.find(t => open.has(t.id));
    if (ot) { ref[k.id] = 't:' + ot.id; return; }
    const key = a ? 'a:' + a : n ? 'n:' + n : 'k:' + k.id;
    (sites[key] = sites[key] || { kind: 'knock', id: key, knocks: [] }).knocks.push(k);
    ref[k.id] = 'k:' + key;
  });
  const list = Object.values(sites).map(s => {       // knocks are sorted newest first
    const latest = s.knocks[0], address = (s.knocks.find(k => k.address) || {}).address || '';
    return { ...s, name: latest.company || '(no company)', address, area: '', date: latest.date, rep: latest.rep || 'Jake',
      interest: (s.knocks.find(k => k.interest) || {}).interest || '', gkey: 'knock|' + (address ? addrKey(address) : s.id) };
  });
  return (_kidx = { byLead, byTarget, ref, sites: list });
}
function knockSites() { return knockIdx().sites; }
function knockRef(k) { return knockIdx().ref[k.id] || ''; }
function knocksForTarget(t) { return knockIdx().byTarget[t.id] || []; }
// Off-list knocks the map can't place: no address in the recording, or the address wasn't found.
function renderKnockPlace() {
  const el = $('kn-place'); if (!el) return;
  const rows = knockSites().filter(s => !posOf(s) && (!s.address || (geo[s.gkey] && geo[s.gkey].src === 'fail')));
  el.innerHTML = rows.length ? '<h3>Knocks not on the map (' + rows.length + ')</h3><ul class="results">' + rows.map(s =>
    '<li class="none"><b>' + esc(s.name) + '</b><small>' + (s.address ? esc(s.address) + ' · address not found' : 'No address in the recording') + ' · ' + fmtDate(s.date) + '</small>' +
    '<button class="btn sm ghost" style="margin-top:.3rem" data-place="' + esc(s.gkey) + '">Place pin</button></li>').join('') + '</ul>' : '';
}
// ── Follow-ups required: open actions from knock conversations + lead-sheet follow-ups due ──
// Knock rows carry actions [{text, due}] flagged from the Fireflies transcript; "Done" stamps doneAt
// on the knock (saved to the cloud for everyone) and the next transcript refresh never clears it.
function knockActions(k) {
  if (Array.isArray(k.actions) && k.actions.length) return k.actions;  // done ones are kept but skipped below
  return k.nextStep ? [{ text: k.nextStep, due: k.followUp || null }] : [];
}
// Removed follow-ups (not relevant any more): { <key>: { by, at } }, saved to the cloud for everyone.
// A lead-sheet key includes its follow-up date, so a new date on the sheet brings it back.
let fuDismissed = readJSON('ob_fu_dismissed') || {};
let fuSort = 'recent', fuOpen = null, fuUndo = null, fuItems = {};
const fuKey = x => x.src === 'knock' ? 'k:' + x.k.id + ':' + x.i : x.ref + ':' + (x.due || '');
function renderFollowReq() {
  const el = $('fr-list'); if (!el) return;
  const today = todayISO(), wk = new Date(Date.now() + 7 * DAY).toISOString().slice(0, 10), old = new Date(Date.now() - 45 * DAY).toISOString().slice(0, 10);
  let stale = 0;
  const items = [];
  knocks.forEach(k => { if (k.doneAt) return; knockActions(k).forEach((a, i) => !a.done && items.push({ src: 'knock', k, i, due: a.due || k.followUp || '', when: k.date || '', text: a.text, who: 'Jake', company: k.company, contact: k.contact || '', email: k.email || '', address: k.address || '', sub: (k.contact ? k.contact + ' · ' : '') + (k.address || ''), interest: k.interest, ref: knockRef(k) })); });
  leads.forEach(l => { if (!l.followUp || ['Dead', 'Converted'].includes(l.status) || (l.lastTouch && l.lastTouch >= l.followUp) || l.followUp > wk) return;
    if (l.followUp < old) { stale++; return; }   // same 45-day window as the Monday email; older ones are counted, not listed
    items.push({ src: 'lead', l, due: l.followUp, when: l.lastTouch || l.followUp, text: (l.notes || '').split(/\n/)[0].slice(0, 160) || 'Follow up', who: l.rep || '', company: l.company, contact: l.contact || '', email: l.email || '', address: l.address || '', sub: [l.contact, l.phone].filter(Boolean).join(' · '), ref: 'l:' + l.id }); });
  fuItems = {};
  const live = items.filter(x => { const key = fuKey(x); x.key = key; fuItems[key] = x; return !fuDismissed[key]; });
  // Most recent: newest conversation / touch first. Due date: overdue first, oldest first.
  live.sort(fuSort === 'due' ? (a, b) => (a.due || '9999').localeCompare(b.due || '9999') : (a, b) => (b.when || '').localeCompare(a.when || '') || (a.due || '9999').localeCompare(b.due || '9999'));
  const row = x => {
    const late = x.due && x.due < today, dueTxt = x.due ? fmtDate(x.due) : 'No date';
    // Contact found online for an off-sheet target, if the knock recording didn't carry an email.
    const tc = !x.email && x.ref && x.ref.startsWith('t:') ? contactHTML(x.ref.slice(2)) : '';
    return '<li class="fu' + (x.key === fuOpen ? ' open' : '') + '" data-key="' + esc(x.key) + '"><div class="fu-head wk-top"><span class="fr-due' + (late ? ' late' : x.due === today ? ' today' : '') + '">' + dueTxt + '</span>' +
      (x.ref ? '<a class="wk-name" data-fly="' + esc(x.ref) + '">' + esc(x.company || '—') + '</a>' : '<b>' + esc(x.company || '—') + '</b>') +
      (x.interest ? '<span class="chip" style="background:' + (INTEREST[x.interest] || '#5A7A80') + '">' + esc(x.interest) + '</span>' : '') +
      '<span class="wk-type">' + (x.src === 'knock' ? 'Door knock' + (x.when ? ' ' + fmtDate(x.when) : '') : 'Lead sheet') + (x.who ? ' · ' + esc(x.who) : '') + '</span>' +
      '<div class="fu-gist">' + esc(x.text) + '</div></div>' +
      '<div class="fu-body"><div class="wk-note"><b>' + esc(x.text) + '</b></div>' + (x.sub ? '<div class="wk-sub">' + esc(x.sub) + (x.email ? ' · <a href="mailto:' + esc(x.email) + '">' + esc(x.email) + '</a>' : '') + '</div>' : '') + tc +
      '<div class="fu-acts"><button class="btn sm fu-mail">Email draft to me</button>' +
      (x.src === 'knock' ? '<button class="btn sm ghost fr-done" data-k="' + esc(x.k.id) + '" data-i="' + x.i + '">Done</button>' : '') +
      '<button class="btn sm ghost fu-del">Remove</button><button class="btn sm ghost fu-next">Next ›</button></div></div></li>';
  };
  const list = arr => '<ol class="wk fr">' + arr.map(row).join('') + '</ol>';
  // Each person sees their own first; everyone else's sits in a collapsed "Team" section.
  const mine = x => x.src === 'knock' ? (x.k.rep || 'Jake') === myName || new RegExp('\\b' + myName + '\\b', 'i').test(x.k.rep || 'Jake') : repOf(x.who).includes(myName);
  const my = live.filter(mine), team = live.filter(x => !mine(x));
  const kn = my.filter(x => x.src === 'knock'), ld = my.filter(x => x.src === 'lead');
  const teamNames = [...new Set(team.map(x => x.src === 'knock' ? (x.k.rep || '') : repOf(x.who).filter(n => n !== myName).join('/') || x.who).filter(Boolean))].join(', ');
  const removed = items.filter(x => fuDismissed[x.key]).length;
  const tools = '<div class="fu-tools"><div class="seg" id="fu-sort"><button data-s="recent" class="' + (fuSort === 'recent' ? 'on' : '') + '">Most recent</button><button data-s="due" class="' + (fuSort === 'due' ? 'on' : '') + '">Due date</button></div>' +
    (removed ? '<span>' + removed + ' removed</span>' : '') +
    (fuUndo ? '<span class="fu-undo">Removed ' + esc((fuItems[fuUndo] || {}).company || 'follow-up') + ' <a id="fu-undo">Undo</a></span>' : '') + '</div>';
  const shown = focusView ? kn : my;
  $('fr-n').textContent = shown.length ? shown.length + ' open · ' + shown.filter(x => x.due && x.due < today).length + ' overdue' : '';
  $('fr-note').textContent = focusView ? '' : (stale ? stale + ' older lead-sheet follow-ups not shown (update or close them on the sheet).' : '');
  if (focusView) {
    el.innerHTML = tools + (kn.length ? list(kn) : '<p class="hint">No open actions from your knock recordings.</p>');
    return;
  }
  el.innerHTML = tools + '<h3 class="wk-h">From your door knocks (' + kn.length + ')</h3>' + (kn.length ? list(kn) : '<p class="hint">No open actions from your knock recordings.</p>') +
    '<h3 class="wk-h">Your lead-sheet follow-ups, last 45 days to next 7 (' + ld.length + ')</h3>' + (ld.length ? list(ld) : '<p class="hint">None due.</p>') +
    (team.length ? '<details class="fr-team"><summary>Team follow-ups' + (teamNames ? ' (' + esc(teamNames) + ')' : '') + ' · ' + team.length + '</summary>' + list(team) + '</details>' : '');
}
// One-by-one: open a row; Done / Remove / Next move to the row below it.
function fuRows() { return [...document.querySelectorAll('#fr-list li.fu')].filter(li => li.offsetParent !== null || li.classList.contains('open')); }
function fuGoNext(li, rerender) {
  const rows = fuRows(), i = rows.indexOf(li), nx = rows[i + 1] || null;
  fuOpen = nx ? nx.dataset.key : null;
  if (rerender) renderFollowReq();
  else { rows.forEach(r => r.classList.toggle('open', r.dataset.key === fuOpen)); }
  const el = fuOpen && document.querySelector('#fr-list li.fu[data-key="' + CSS.escape(fuOpen) + '"]');
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function fuSave() { localStorage.setItem('ob_fu_dismissed', JSON.stringify(fuDismissed)); }
// Generic follow-up, addressed to the signed-in user so it lands in their inbox to forward.
function fuMail(x) {
  const me = session.email || '', name = session.name || 'Alpine HVAC';
  const first = (x.contact || '').trim().split(/[\s,(]/)[0];
  const tc = x.ref && x.ref.startsWith('t:') ? (contactsDoc.rows || {})[x.ref.slice(2)] || {} : {};
  const to = x.email || tc.email || '';
  const met = x.src === 'knock' && x.when ? 'when I stopped by on ' + fmtDate(x.when).replace(/, \d{4}$/, '') : 'recently';
  const site = x.address ? ' at ' + cleanAddr(x.address) : '';
  const body = 'FORWARD TO: ' + ([x.contact, to].filter(Boolean).join(' <') + (to && x.contact ? '>' : '') || '(no contact on file)') + ' · ' + (x.company || '') + '\n' +
    '----------------------------------------\n\n' +
    'Hi ' + (first || 'there') + ',\n\n' +
    'Thank you for taking the time to speak with me ' + met + '. I wanted to follow up on our conversation about the HVAC and building systems' + site + '.\n\n' +
    'Alpine HVAC looks after commercial, industrial and institutional buildings across Niagara and Hamilton: planned maintenance, 24/7 emergency service, and building automation alongside the mechanical work, all from one team.\n\n' +
    'Would you have 15 minutes in the next week or two for a quick walk through your mechanical room? We would take a look at your equipment and put together a maintenance plan that fits the building, at no charge.\n\n' +
    'Thanks again, and I look forward to hearing from you.\n\n' +
    name + '\nAlpine HVAC Service Inc.\n' + me + '\n';
  location.href = 'mailto:' + encodeURIComponent(me) + '?subject=' + encodeURIComponent('Following up — ' + (x.company || 'our conversation')) + '&body=' + encodeURIComponent(body);
}
document.addEventListener('click', e => {
  if (!e.target.closest('#fr-list')) return;
  const sb = e.target.closest('#fu-sort button'); if (sb) { fuSort = sb.dataset.s; renderFollowReq(); return; }
  if (e.target.closest('#fu-undo')) { delete fuDismissed[fuUndo]; fuOpen = fuUndo; fuUndo = null; fuSave(); renderFollowReq(); return; }
  const li = e.target.closest('li.fu'); if (!li) return;
  const x = fuItems[li.dataset.key];
  if (e.target.closest('.fu-mail')) { if (x) fuMail(x); return; }
  if (e.target.closest('.fu-next')) { fuGoNext(li, false); return; }
  if (e.target.closest('.fu-del')) { fuDismissed[li.dataset.key] = { by: session.name, at: todayISO() }; fuUndo = li.dataset.key; fuSave(); fuGoNext(li, true); return; }
  const b = e.target.closest('.fr-done');
  if (b) {
    const cur = readJSON('ob_knocks') || { rows: [] }, k = (cur.rows || []).find(r => r.id === b.dataset.k); if (!k) return;
    const acts = knockActions(k).map((a, i) => i === +b.dataset.i ? { ...a, done: todayISO(), doneBy: session.name } : a);
    k.actions = acts; if (acts.every(a => a.done)) { k.doneAt = todayISO(); k.doneBy = session.name; }
    localStorage.setItem('ob_knocks', JSON.stringify(cur));
    const mem = knocks.find(r => r.id === k.id); if (mem) Object.assign(mem, k);
    fuGoNext(li, true); return;
  }
  if (e.target.closest('.fu-head') && !e.target.closest('a')) {
    const open = !li.classList.contains('open'); fuOpen = open ? li.dataset.key : null;
    fuRows().forEach(r => r.classList.toggle('open', r.dataset.key === fuOpen));
  }
});

let weekSel = null;
function renderWeek() {
  const el = $('wk-list'); if (!el) return;
  const weeks = (weeksDoc.rows || []).slice().sort((a, b) => b.week - a.week);
  if (!weeks.length) { el.innerHTML = '<p class="hint">No weekly knock list saved yet. The Monday "100 new knocks" run saves it here.</p>'; return; }
  const W = weeks.find(w => w.week === weekSel) || weeks[0]; weekSel = W.week;
  const rows = W.ids.map((id, i) => ({ n: i + 1, t: targetById[id] })).filter(r => r.t);
  rows.forEach(r => { r.k = knocksForTarget(r.t); });
  const next = rows.filter(r => !r.k.length);
  // Knocks outside the list (off-list buildings, or leads not on this week's route) dated within this
  // week's window join the Knocked group, so the list shows every door knocked that week.
  const nextSent = (weeks.filter(w => (w.sent || '') > (W.sent || '')).map(w => w.sent).sort()[0]) || '9999';
  const onList = new Set(rows.flatMap(r => r.k.map(k => k.id)));
  const extra = knocks.filter(k => k.date && k.date >= (W.sent || '').slice(0, 10) && k.date < nextSent.slice(0, 10) && !onList.has(k.id))
    .map(k => ({ x: true, k: [k], ref: knockRef(k) }));
  const done = rows.filter(r => r.k.length).concat(extra).sort((a, b) => (b.k[0].date || '').localeCompare(a.k[0].date || ''));
  const mapLink = t => { const a = t.address || (geo['rev:' + t.id] || {}).addr; return a ? '<a href="https://maps.google.com/?q=' + encodeURIComponent(a + ', ' + (t.area || '') + ', ON') + '" target="_blank" rel="noopener">' + esc(a) + '</a>' : (t.lat != null ? '<a href="https://maps.google.com/?q=' + t.lat + ',' + t.lng + '" target="_blank" rel="noopener">map pin</a>' : ''); };
  const sz = t => t.sqft ? ' · ' + fmtSqft(t.sqft) : '';
  if ($('wk-n')) $('wk-n').textContent = 'Week ' + W.week + ' · ' + done.length + ' knocked · ' + next.length + ' to go';
  let h = '<div class="wk-head">' + (weeks.length > 1 ? '<select id="wk-sel">' + weeks.map(w => '<option value="' + w.week + '"' + (w.week === W.week ? ' selected' : '') + '>Week ' + w.week + ' · ' + fmtDate(w.sent) + '</option>').join('') + '</select>' : '<b>Week ' + W.week + '</b> · sent ' + fmtDate(W.sent)) +
    ' <span class="wk-count">' + done.length + ' knocked' + (extra.length ? ' (' + extra.length + ' off the list)' : '') + ' · ' + next.length + ' to go</span></div>';
  h += '<h3 class="wk-h">Knocked (' + done.length + ')</h3>' + (done.length ? '<ol class="wk">' + done.map(r => {
    const k = r.k[0];
    if (r.x) return '<li class="done"><div class="wk-top"><span class="wk-n" title="Not on this week\'s list">+</span>' +
      (r.ref ? '<a class="wk-name" data-fly="' + esc(r.ref) + '">' + esc(k.company || '—') + '</a>' : '<b class="wk-name">' + esc(k.company || '—') + '</b>') +
      '<span class="wk-type">' + (r.ref.startsWith('l:') ? 'Lead, off this week\'s list' : 'Off the list') + '</span>' +
      (k.interest ? '<span class="chip" style="background:' + (INTEREST[k.interest] || '#5A7A80') + '">' + esc(k.interest) + '</span>' : '') + '<span class="wk-date">' + fmtDate(k.date) + '</span></div>' +
      '<div class="wk-sub">' + (k.address ? '<a href="https://maps.google.com/?q=' + encodeURIComponent(k.address + ', ON') + '" target="_blank" rel="noopener">' + esc(k.address) + '</a>' : 'No address in the recording') + (k.contact ? ' · ' + esc(k.contact) + (k.role ? ' (' + esc(k.role) + ')' : '') : '') + '</div>' +
      '<div class="wk-sum">' + esc(k.summary || '') + (k.nextStep ? ' <b>Next:</b> ' + esc(k.nextStep) + (k.followUp ? ' (' + fmtDate(k.followUp) + ')' : '') : '') + (k.url ? ' <a href="' + esc(k.url) + '" target="_blank" rel="noopener">Recording ↗</a>' : '') + '</div></li>';
    return '<li class="done"><div class="wk-top"><span class="wk-n">' + r.n + '</span><a class="wk-name" data-fly="t:' + esc(r.t.id) + '">' + esc(r.t.name) + '</a>' +
      (k.interest ? '<span class="chip" style="background:' + (INTEREST[k.interest] || '#5A7A80') + '">' + esc(k.interest) + '</span>' : '') + '<span class="wk-date">' + fmtDate(k.date) + '</span></div>' +
      '<div class="wk-sub">' + mapLink(r.t) + (r.t.area ? ', ' + esc(r.t.area) : '') + sz(r.t) + '</div>' + contactHTML(r.t.id) +
      '<div class="wk-sum">' + esc(k.summary || '') + (k.nextStep ? ' <b>Next:</b> ' + esc(k.nextStep) + (k.followUp ? ' (' + fmtDate(k.followUp) + ')' : '') : '') + (k.url ? ' <a href="' + esc(k.url) + '" target="_blank" rel="noopener">Recording ↗</a>' : '') + '</div></li>';
  }).join('') + '</ol>' : '<p class="hint">Nothing knocked from this list yet. Record each knock in Fireflies; it lands here the same evening.</p>');
  h += '<h3 class="wk-h">Next up, in route order (' + next.length + ')</h3>';
  let area = null;
  h += next.map(r => {
    const a = r.t.area || 'Other', head = a !== area ? (area === null ? '' : '</ol>') + '<div class="wk-area">' + esc(a) + '</div><ol class="wk">' : '';
    area = a;
    return head + '<li><div class="wk-top"><span class="wk-n">' + r.n + '</span><a class="wk-name" data-fly="t:' + esc(r.t.id) + '">' + esc(r.t.name) + '</a><span class="wk-type">' + esc(r.t.type || '') + '</span></div>' +
      '<div class="wk-sub">' + mapLink(r.t) + sz(r.t) + '</div>' + contactHTML(r.t.id) + '<div class="wk-note">' + esc(fieldNote(r.t)) + '</div></li>';
  }).join('') + (next.length ? '</ol>' : '');
  el.innerHTML = h;
  const sel = $('wk-sel'); if (sel) sel.onchange = () => { weekSel = +sel.value; renderWeek(); };
}

// Door-knock conversations table (Fireflies). Clicking a matched row flies to its pin.
function renderKnocks() {
  const el = $('t-knocks'); if (!el) return;
  const note = $('knock-note');
  if (note) note.textContent = knocks.length ? knocks.length + ' conversation' + (knocks.length === 1 ? '' : 's') + ' · ' + knocks.filter(k => knockRef(k).startsWith('k:')).length + ' off the list (own pin on the map)' : '';
  el.innerHTML = '<thead><tr><th class="nosort">Date</th><th class="nosort">Company</th><th class="nosort">Contact</th><th class="nosort">Interest</th><th class="nosort">Summary</th><th class="nosort">Next step</th><th class="nosort"></th></tr></thead><tbody>' +
    (knocks.length ? knocks.slice(0, 200).map(k => {
      const ref = knockRef(k), off = ref.startsWith('k:');
      return '<tr><td>' + fmtDate(k.date) + '</td><td>' + (ref ? '<a data-fly="' + esc(ref) + '">' + esc(k.company || '—') + '</a>' : esc(k.company || '—')) + (off ? ' <span class="due" title="Not on the lead sheet or target list yet; shown on the map as an off-list knock">off list</span>' : '') +
        '<small style="display:block;color:var(--light-grey)">' + esc(k.address || '') + '</small></td><td>' + esc(k.contact || '') + (k.role ? '<small style="display:block;color:var(--light-grey)">' + esc(k.role) + '</small>' : '') + '</td>' +
        '<td>' + (k.interest ? '<span class="chip" style="background:' + (INTEREST[k.interest] || '#5A7A80') + '">' + esc(k.interest) + '</span>' : '') + '</td>' +
        '<td style="max-width:420px">' + esc(k.summary || '') + '</td><td>' + esc(k.nextStep || '') + (k.followUp ? '<small style="display:block">' + fmtDate(k.followUp) + '</small>' : '') + '</td>' +
        '<td>' + (k.url ? '<a href="' + esc(k.url) + '" target="_blank" rel="noopener">Recording ↗</a>' : '') + '</td></tr>';
    }).join('') : '<tr><td colspan="7" class="none" style="padding:1rem;color:var(--light-grey)">No door-knock recordings yet. Record each knock in the Fireflies app; the daily refresh transcribes, summarizes and files it here.</td></tr>') + '</tbody>';
}

function renderReports() {
  const el = $('nr-list'); if (!el) return;
  const rows = reports.filter(r => (r.rep || 'Natalie') === 'Natalie');
  const note = $('nr-note');
  const last = rows[0], since = d => { const x = new Date(); x.setDate(x.getDate() - d); return x.toISOString().slice(0, 10); };
  if (note) note.textContent = rows.length ? rows.filter(r => (r.sent || '') >= since(14)).length + ' report' + (rows.filter(r => (r.sent || '') >= since(14)).length === 1 ? '' : 's') + ' in the last 14 days · last ' + fmtDate((last.sent || '').slice(0, 10)) : '';
  const leadBy = {}; leads.forEach(l => { const n = normName(l.company); if (n.length > 3) leadBy[n] = l; });
  const co = c => { const l = leadBy[normName(c)]; return l ? '<a data-fly="l:' + esc(l.id) + '">' + esc(c) + '</a>' : '<b>' + esc(c) + '</b>'; };
  const dayLbl = d => { const x = new Date(d + 'T12:00:00'); return '<small>' + x.toLocaleDateString('en-CA', { weekday: 'short' }) + '</small>' + x.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }); };
  el.innerHTML = rows.length ? rows.slice(0, 120).map(r => (r.days || []).map((d, i) => '<div class="nr-row"><div class="nr-date">' + dayLbl(d.date) + '</div><div>' +
      '<ul class="nr-items">' + (d.items || []).map(t => '<li>' + esc(t) + '</li>').join('') + '</ul>' +
      (i === (r.days.length - 1) && (r.highlights || []).length ? '<div class="nr-hl">' + r.highlights.map(h => '<div>' + co(h.company) + ' — ' + esc(h.note) + '</div>').join('') + '</div>' : '') +
      (i === (r.days.length - 1) && r.next ? '<div class="nr-next">Next: ' + esc(r.next) + '</div>' : '') +
      '</div></div>').reverse().join('')).join('')
    : '<p class="nr-meta">No daily reports filed yet. The morning refresh files each report Natalie emails Jake.</p>';
}

function renderMetrics(fu, unplaced) {
  const n = leads.length, c = s => leads.filter(l => l.status === s).length;
  const worked = leads.filter(l => l.status !== 'Not contacted').length;
  const t = openTargets(), unclaimed = t.filter(x => !claims[x.id]).length;
  const last30 = leads.filter(l => { const d = daysSince(l.lastTouch); return d !== null && d < 30; }).length;
  const M = [
    ['Leads on the sheet', n, last30 + ' touched in the last 30 days'],
    ['Contacted', worked, n ? Math.round(100 * worked / n) + '% of leads' : ''],
    ['Follow-ups due', fu.overdue + fu.week, '<span class="' + (fu.overdue ? 'due' : '') + '">' + fu.overdue + ' overdue</span> · ' + fu.week + ' this week' + (fu.stale ? ' · ' + fu.stale + ' stale' : '')],
    ['Quoted / bid list', c('Quoted') + c('Bid list'), c('Bids & tenders only') + ' tenders only'],
    ['Converted', c('Converted'), c('Dead') + ' dead'],
    ['Customer sites', customers.length, custDoc.syncedAt ? 'BuildOps ' + fmtDate(custDoc.syncedAt) : 'agreement sites only'],
    ['Targets left', t.length, unclaimed + ' unclaimed'],
  ];
  $('metrics').innerHTML = M.map(m => '<div class="metric"><div class="m-label">' + m[0] + '</div><div class="m-value">' + m[1] + '</div><div class="m-sub">' + m[2] + '</div></div>').join('');
}

function renderHeader(unplaced) {
  const s = leadsDoc.syncedAt;
  $('asof').innerHTML = s ? 'Lead sheet as of <b>' + fmtDate(s) + '</b> · refreshed daily<br><a href="' + SHEET_URL + '" target="_blank" rel="noopener">Open lead sheet</a>' : '<a href="' + SHEET_URL + '" target="_blank" rel="noopener">Open lead sheet</a>';
  const b = [];
  if (!s) b.push('<div class="banner warn">No lead data yet. The daily refresh loads the lead sheet here; ask Claude to "refresh the outbound map".</div>');
  else if (daysSince(s) > 2) b.push('<div class="banner bad">The lead sheet was last pulled ' + daysSince(s) + ' days ago. Recent changes on the sheet aren\'t shown.</div>');
  if (s && !leadsDoc.hasStatusColumn) b.push('<div class="banner warn">The lead sheet has no <b>Status</b> column yet, so pins show Contacted / Not contacted / Quoted only. Follow-up, bid list, tender, converted and dead colours appear once that column is filled in.</div>');
  else if (s && leads.some(l => !l.statusSet)) b.push('<div class="banner info">' + leads.filter(l => !l.statusSet).length + ' leads have a blank Status; their colour comes from the Contacted / Quoted columns.</div>');
  if ((leadsDoc.warnings || []).length) b.push('<div class="banner info">' + esc(leadsDoc.warnings.slice(0, 3).join(' · ')) + (leadsDoc.warnings.length > 3 ? ' …' : '') + '</div>');
  $('banners').innerHTML = b.join('');
}

let fitted = false;
function mapVisible() { return document.getElementById('map').offsetWidth > 0; }
function fitInitial() {
  if (fitted || !mapVisible()) return;
  const pts = leads.concat(customers).map(posOf).filter(Boolean).filter(p => km({ lat: HAMILTON[0], lng: HAMILTON[1] }, p) < 90).map(p => [p.lat, p.lng]);
  pts.push([shopPos().lat, shopPos().lng]);
  if (pts.length > 3) { map.fitBounds(pts, { padding: [30, 30], maxZoom: 12 }); fitted = true; }
}
function mapShown() { map.invalidateSize(); fitInitial(); }
function renderAll(redrawMap) {
  _open = null; _kidx = null;
  renderHeader();
  renderControls();
  drawMap();
  renderKnockPlace();
  renderAreas();
  fillTargetFilters();
  renderTargets();
  const fu = renderFollow();
  const un = renderUnplaced();
  renderMetrics(fu, un);
  renderKnocks();
  renderReports();
  renderWeek();
  renderFollowReq();
  fitInitial();
}

// Knocks merge by Fireflies id; automatic touch counts merge by week + rep + source.
// Nothing already saved is dropped, so a partial run can never erase history.
async function mergeImport(P) {
  if (P.kind === 'contacts') {           // rows: { <targetId>: {phone, email, website, note, src} }
    const cur = readJSON('ob_target_contacts') || { rows: {} }; let n = 0;
    Object.entries(P.data.rows || {}).forEach(([id, c]) => { cur.rows[id] = { ...(cur.rows[id] || {}), ...c, at: todayISO() }; n++; });
    localStorage.setItem('ob_target_contacts', JSON.stringify(cur));
    await new Promise(r => setTimeout(r, 2500));
    return 'contacts: ' + n + ' rows merged to the cloud.';
  }
  if (!P.data || !Array.isArray(P.data.rows)) throw new Error('Unrecognised payload');
  let n = 0;
  if (P.kind === 'knocks') {
    const cur = readJSON('ob_knocks') || { rows: [] }, by = {};
    (cur.rows || []).forEach(r => by[r.id] = r);
    P.data.rows.forEach(r => { if (!r.id) return; const old = by[r.id] || {};
      const m = { ...old, ...r };
      if (old.doneAt) { m.doneAt = old.doneAt; m.doneBy = old.doneBy; }           // a re-import never reopens finished work
      if (Array.isArray(old.actions) && Array.isArray(r.actions)) m.actions = r.actions.map(a => { const o = old.actions.find(x => x.text === a.text); return o && o.done ? { ...a, done: o.done, doneBy: o.doneBy } : a; });
      by[r.id] = m; n++; });
    localStorage.setItem('ob_knocks', JSON.stringify({ rows: Object.values(by), importedAt: Date.now(), importedBy: session.name }));
  } else if (P.kind === 'reports') {
    const cur = readJSON('ob_reports') || { rows: [] }, by = {};
    (cur.rows || []).forEach(r => by[r.id] = r);
    P.data.rows.forEach(r => { if (!r.id || !Array.isArray(r.days)) return; by[r.id] = { rep: 'Natalie', ...r }; n++; });
    localStorage.setItem('ob_reports', JSON.stringify({ rows: Object.values(by), importedAt: Date.now(), importedBy: session.name }));
  } else if (P.kind === 'weeks') {
    const cur = readJSON('ob_knock_weeks') || { rows: [] }, by = {};
    (cur.rows || []).forEach(r => by[r.week] = r);
    P.data.rows.forEach(r => { if (!r.week || !Array.isArray(r.ids)) return; by[r.week] = r; n++; });
    localStorage.setItem('ob_knock_weeks', JSON.stringify({ rows: Object.values(by).sort((a, b) => a.week - b.week) }));
  } else {
    const cur = readJSON('ob_touch_log') || [], key = r => r.wk + '|' + r.rep + '|' + (r.src || '');
    const by = {}; cur.forEach(r => by[key(r)] = r);
    P.data.rows.forEach(r => { if (!r.wk || !r.rep) return; r.src = r.src || 'auto'; by[key(r)] = { ...r, at: new Date().toISOString() }; n++; });
    localStorage.setItem('ob_touch_log', JSON.stringify(Object.values(by)));
  }
  await new Promise(r => setTimeout(r, 2500));
  const k = { knocks: 'ob_knocks', weeks: 'ob_knock_weeks', reports: 'ob_reports' }[P.kind] || 'ob_touch_log';
  const st = typeof apSyncStatus === 'function' ? apSyncStatus() : { unsynced: [] };
  return P.kind + ': ' + n + ' rows merged' + (st.unsynced.includes(k) ? ' locally; cloud save still pending' : ' to the cloud') + '.';
}

// ── Import (used by the daily refresh via Claude in Chrome) ──────────
// obImport.start(); obImport.add(base64Chunk) ...; await obImport.finish()
// The chunks join into base64 of gzip(JSON {kind: 'leads'|'customers'|'targets'|'knocks'|'touches'|'weeks'|'contacts'|'reports', data}).
window.obImport = (() => {
  let parts = [];
  return {
    start() { parts = []; return 'ready'; },
    add(chunk) { parts.push(chunk); return parts.length; },
    async finish() {
      const bin = Uint8Array.from(atob(parts.join('')), c => c.charCodeAt(0));
      parts = [];
      const text = await new Response(new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
      const P = JSON.parse(text);
      if (P.kind === 'knocks' || P.kind === 'touches' || P.kind === 'weeks' || P.kind === 'contacts' || P.kind === 'reports') return mergeImport(P);
      const key = { leads: 'ob_leads', customers: 'ob_customers', targets: 'ob_targets' }[P.kind];
      if (!key || !P.data || !Array.isArray(P.data.rows)) throw new Error('Unrecognised payload');
      if (P.kind === 'leads' && P.data.rows.length < 0.8 * ((readJSON('ob_leads') || { rows: [] }).rows.length)) throw new Error('Refusing: new lead list is more than 20% shorter than the current one (' + P.data.rows.length + ' rows). Check the sheet read.');
      P.data.importedAt = Date.now(); P.data.importedBy = session.name;
      localStorage.setItem(key, JSON.stringify(P.data));
      await new Promise(r => setTimeout(r, 2500));
      const st = typeof apSyncStatus === 'function' ? apSyncStatus() : { unsynced: [] };
      return P.kind + ': ' + P.data.rows.length + ' rows saved' + (st.unsynced.includes(key) ? ' locally; cloud save still pending' : ' to the cloud') + '. Reload to see them.';
    },
  };
})();
// ── Building list from OpenStreetMap (owners; runs in this tab, 10–30 min) ──────────
// Pulls industrial, commercial, residential high-rise and institutional buildings across
// Hamilton, Halton and Niagara; keeps buildings of 10,000 sq ft and up (footprint × floors).
const OSM_EPS = ['https://overpass.private.coffee/api/interpreter', 'https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const OSM_REGIONS = [['Hamilton', '43.05,-80.10,43.40,-79.62'], ['Halton', '43.30,-80.05,43.62,-79.62'], ['Niagara west', '42.84,-79.62,43.30,-79.30'], ['Niagara east', '42.84,-79.30,43.30,-78.90']];
const OSM_SECTORS = {
  ind: { label: 'Industrial', q: b => 'way["building"~"^(industrial|warehouse|manufacture|factory)$"](' + b + ');out tags geom qt;' },
  com: { label: 'Commercial', q: b => 'way["building"~"^(office|commercial|retail|hotel|supermarket)$"](' + b + ');out tags geom qt;' },
  res: { label: 'Residential high-rise', q: b => 'way["building"~"^(apartments|residential)$"]["building:levels"](if:number(t["building:levels"])>=6)(' + b + ');out tags geom qt;' },
  inst: { label: 'Institutional', q: b => 'nwr["amenity"~"^(school|college|university|fire_station|hospital|nursing_home|community_centre|library|townhall|police)$"](' + b + ');out tags center qt;' },
};
const MIN_SQFT = 10000;
const INST_TYPE = { school: 'School', college: 'College', university: 'University', fire_station: 'Fire station', hospital: 'Hospital', nursing_home: 'Long-term care', community_centre: 'Community centre', library: 'Library', townhall: 'Municipal building', police: 'Police station' };
function osmWhy(type, tags) {
  if (/Factory|Industrial|Warehouse/.test(type)) return 'Owner-operated plant: unit heaters, MUAs, RTUs, process cooling; buys direct';
  if (/Office/.test(type)) return 'Tenant comfort + BAS; property manager decides';
  if (/Hotel/.test(type)) return 'Guest comfort drives reviews; PTACs + central plant';
  if (/Condo/.test(type)) return 'Condo corp via property manager: boilers, MUA, garage exhaust, common areas';
  if (/Retail|Commercial|Supermarket/.test(type)) return 'RTU fleet; landlord or tenant contracts';
  if (type === 'School') return /district school board|catholic/i.test(tags.operator || tags.name || '') ? 'School board: bids & tenders' : 'Check board vs independent (independents buy direct)';
  if (/Fire station|Library|Municipal|Police|Community centre/.test(type)) return 'Municipal: get on the bids & tenders list';
  if (/Long-term care/.test(type)) return '24/7 occupied; regulated temps; maintenance contracts';
  return 'Large campus: in-house staff + tendered sub-trade work';
}
function footprintM2(g) {
  if (!g || g.length < 3) return 0;
  const lat0 = g[0].lat * Math.PI / 180, kx = 111320 * Math.cos(lat0), ky = 110540;
  let a = 0; for (let i = 0; i < g.length; i++) { const p = g[i], q = g[(i + 1) % g.length]; a += (p.lon * kx) * (q.lat * ky) - (q.lon * kx) * (p.lat * ky); }
  return Math.abs(a) / 2;
}
async function overpass(query) {
  let last = '';
  for (let attempt = 0; attempt < 2; attempt++) for (const ep of OSM_EPS) {
    const ac = new AbortController(), to = setTimeout(() => ac.abort(), 240000);
    try {
      const r = await fetch(ep, { method: 'POST', body: 'data=' + encodeURIComponent('[out:json][timeout:220];' + query), signal: ac.signal });
      const txt = await r.text();
      if (r.ok) { const j = JSON.parse(txt); if (j.elements) return j.elements; }
      last = r.status + ' ' + txt.slice(0, 60);
    } catch (e) { last = String(e); } finally { clearTimeout(to); }
    await sleep(3000);
  }
  throw new Error('Overpass failed: ' + last);
}
function osmRow(e, sector) {
  const t = e.tags || {};
  const y = e.center ? e.center.lat : e.lat != null ? e.lat : e.geometry ? e.geometry.reduce((s, g) => s + g.lat, 0) / e.geometry.length : null;
  const x = e.center ? e.center.lon : e.lon != null ? e.lon : e.geometry ? e.geometry.reduce((s, g) => s + g.lon, 0) / e.geometry.length : null;
  if (y == null) return null;
  const lv = Math.max(1, Math.min(60, parseInt(t['building:levels'], 10) || 1));
  const area = e.geometry ? footprintM2(e.geometry) : 0;
  const sqft = area ? Math.round(area * lv * 10.764) : 0;
  let type;
  if (sector === 'ind') type = /factory|manufacture/.test(t.building) ? 'Factory' : t.building === 'warehouse' ? 'Warehouse' : 'Industrial building';
  else if (sector === 'com') type = t.building === 'office' ? (lv >= 8 ? 'Office high-rise' : 'Office building') : t.building === 'hotel' || t.tourism === 'hotel' ? 'Hotel' : t.building === 'supermarket' ? 'Supermarket' : t.building === 'retail' ? 'Retail' : 'Commercial building';
  else if (sector === 'res') type = 'Condo / apartment tower';
  else type = INST_TYPE[t.amenity] || 'Institutional';
  if (sector !== 'inst' && sqft < MIN_SQFT) return null;
  const address = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ');
  const name = t.name || t.brand || t.operator || (type + (address ? ' at ' + address : ''));
  const r = { i: 'o' + e.type[0] + e.id, n: name, a: address, s: OSM_SECTORS[sector].label, t: type, y: +y.toFixed(5), x: +x.toFixed(5), w: osmWhy(type, t) };
  if (sqft) r.q = sqft; if (lv > 1) r.l = lv;
  return r;
}
let osmBusy = false;
async function startOsmBuild() {
  if (osmBusy) return;
  if (!confirmBuild()) return;
  osmBusy = true;
  const btn = $('osm-build'); if (btn) btn.disabled = true;
  const status = m => { const el = $('osm-status'); if (el) el.textContent = m; window.__obBuild = m; };
  try {
    for (const [key, sec] of Object.entries(OSM_SECTORS)) {
      const rows = {};
      for (const [rname, bbox] of OSM_REGIONS) {
        status('Pulling ' + sec.label.toLowerCase() + ' buildings: ' + rname + '… keep this tab open.');
        const els = await overpass(sec.q(bbox));
        els.forEach(e => { const r = osmRow(e, key); if (r) rows[r.i] = r; });
      }
      const list = Object.values(rows);
      localStorage.setItem('ob_targets_osm_' + key, JSON.stringify({ builtAt: todayISO(), builtBy: session.name, rows: list }));
      status(sec.label + ': ' + list.length + ' buildings saved.');
    }
    status('Done. Reload the page to see the new list.');
  } catch (e) { status('Stopped: ' + e.message + '. Sectors already saved are kept; run again later.'); }
  osmBusy = false; if (btn) btn.disabled = false;
}
function confirmBuild() { return true; }
window.obBuildTargets = startOsmBuild;
window.obBuildStatus = () => window.__obBuild || 'idle';

window.obGeocodeStatus = () => ({ busy: geoBusy, cached: Object.keys(geo).length, failed: Object.values(geo).filter(g => g.src === 'fail').length });

if (session.roles && session.roles.includes('owner')) { const w = $('osm-wrap'); if (w) w.style.display = ''; const st = $('osm-status'); const d = readJSON('ob_targets_osm_ind'); if (st && d) st.textContent = 'Building list from OpenStreetMap, ' + fmtDate(d.builtAt) + '. Takes 10–30 min; keep the tab open.'; else if (st) st.textContent = 'Pulls buildings from OpenStreetMap. Takes 10–30 min; keep the tab open.'; }
renderAll(true);
runGeocoder();
})();
