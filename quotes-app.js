// ── Alpine HVAC — Quotes (quotes.html) ───────────────────────────────
// Laid out like BuildOps Operations > Quotes, with the same fields, statuses and
// quote numbers, so Cole can carry on where BuildOps leaves off.
//
// Cole builds a quote: customer + property (BuildOps property list), issue and scope,
// lines from the Item List (cost → price with Jake's margin formula), labour at the
// labour rate, HST, and a customer PDF.
//
//   Selling price = cost ÷ (1 − margin %)        e.g. $100 cost at 35% margin → $153.85
//   Change the price instead and the margin is worked back: margin = 1 − cost ÷ price.
//
// Statuses (BuildOps names): Draft → Sent to customer → Approved → Approved & Job Added
// (once a job number is entered); Declined; a sent quote past its valid-until date shows
// Expired. Approved locks the price. "New version" keeps the same quote number, saves the
// current version underneath, and starts version 2, 3 … (like BuildOps Version / Version Title).
//
// Quote numbers continue BuildOps': Q + year + running number (Q20261189 → Q20261190).
//
// Data (Firestore):
//   quotes/{id}             one doc per quote (lines, totals, history, earlier versions)
//   quotes_meta/counter     { year, next } running number
//   quotes_meta/settings    company defaults (margin, labour rate, HST, terms, next number), owners edit
// Reads: items_data (Item List), account_data/ac_bo_lists (BuildOps property list).
// Cost, margin and profit stay inside Basecamp: the customer PDF shows prices only.
//
// Import from BuildOps: the button reads the CSV from BuildOps Quotes > Export and shows
// what would come across. Writing it into Basecamp is switched off (IMPORT_ON) until Dave
// gives the go-ahead.

import { collection, doc, getDoc, getDocs, setDoc, deleteDoc, onSnapshot, runTransaction, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";
import { db, currentUser } from "./ap-firebase.js";

const IMPORT_ON = false;   // flip to true (and push) when Dave says to bring BuildOps quotes across

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const money = n => "$" + (Number(n) || 0).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = n => (n === null || n === undefined || !isFinite(n)) ? "–" : (Math.round(n * 10) / 10).toFixed(1) + "%";
const num = v => { const t = String(v ?? "").replace(/[$,%\s]/g, ""); return t === "" || isNaN(+t) ? null : +t; };
const ymd = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const TODAY = ymd(new Date());
const addDays = (s, n) => { const d = new Date(s + "T12:00:00"); d.setDate(d.getDate() + n); return ymd(d); };
const niceDate = s => s ? new Date(String(s).slice(0, 10) + "T12:00:00").toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" }) : "";
const stamp = iso => { const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleDateString("en-CA", { month: "short", day: "numeric" }) + ", " + d.toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" }); };
const uid = () => Math.random().toString(36).slice(2, 10);
function toast(t) { const el = $("toast"); el.textContent = t; el.style.display = "block"; clearTimeout(toast._t); toast._t = setTimeout(() => el.style.display = "none", 3200); }

const SESSION = (typeof apGetSession === "function" && apGetSession()) || { name: "", email: "", roles: [] };
const IS_OWNER = (SESSION.roles || []).includes("owner");
// Alpine staff names for Sold By / Project Manager / Account Manager (built-in list in auth.js, plus whoever is signed in).
const STAFF = [...new Set([...(typeof AP_USERS === "object" ? Object.values(AP_USERS).map(u => u.name) : []), SESSION.name].filter(Boolean))].sort();

// Company defaults. Placeholders until Jake confirms; owners change them under Quote settings.
const DEFAULTS = {
  margin: 40,            // % applied to new lines (each line can differ); Cole prices materials at 40% in BuildOps
  labourRate: 150,       // $/hr charged to the customer
  labourCost: null,      // $/hr cost to Alpine, for margin on labour; blank = not counted
  taxRate: 13,           // HST %
  validDays: 30,
  minMargin: 20,         // lines below this margin are flagged red
  nextNumber: 1190,      // running part of the next quote number this year (BuildOps was at Q20261189 on Nov 11, 2026)
  departments: ["Service", "Construction", "Office", "Building Automation"],   // as set up in BuildOps
  hstNumber: "715482543",   // Alpine's HST #, from BuildOps company settings
  terms: "Prices are valid for 30 days from the quote date and are subject to change after that.\n"
    + "Work is scheduled once this quote is approved in writing. Any work outside the scope above is quoted separately.\n"
    + "Equipment carries the manufacturer's warranty; Alpine HVAC warrants its workmanship for one year from completion.\n"
    + "Payment is due on completion unless other terms have been agreed in writing.",
};
const COMPANY = { name: "Alpine HVAC Service Inc.", address: "4241 Victoria Ave., Vineland, ON L0R 2E0", phone: "289-438-1175", web: "alpinehvac.ca" };

const TYPES = ["Material", "Equipment", "Labour", "Subcontractor", "Other"];
const STATUS = {
  draft:    { label: "Draft",                cls: "st-draft" },
  sent:     { label: "Sent to customer",     cls: "st-sent" },
  approved: { label: "Approved",             cls: "st-approved" },
  jobadded: { label: "Approved & Job Added", cls: "st-jobadded" },
  expired:  { label: "Expired",              cls: "st-expired" },
  declined: { label: "Declined",             cls: "st-declined" },
};
// What the list shows: approved + a job number = Approved & Job Added; sent and past valid-until = Expired.
const shownStatus = q => {
  const s = q.status || "draft";
  if (s === "approved" && q.jobNumber) return "jobadded";
  if (s === "sent" && q.validUntil && q.validUntil < TODAY) return "expired";
  return STATUS[s] ? s : "draft";
};

let SETTINGS = { ...DEFAULTS };
let ITEMS = null, PROPS = null, QUOTES = [], unsub = null;
let Q = null, saveTimer = null, dirty = false, saving = false;

// ── Maths ──
function linePrice(l) {
  if (l.priceSet || l.cost === null || l.cost === undefined) return r2(l.price);
  const m = Math.min(Number(l.margin) || 0, 95);
  return r2(l.cost / (1 - m / 100));
}
function lineMargin(l) {
  const p = linePrice(l);
  if (l.cost === null || l.cost === undefined || !p) return null;
  return (1 - l.cost / p) * 100;
}
function totals(q) {
  let subtotal = 0, costKnown = 0, priceKnown = 0, unknown = 0;
  (q.lines || []).forEach(l => {
    const qty = Number(l.qty) || 0, p = linePrice(l), ext = r2(qty * p);
    subtotal += ext;
    if (l.cost === null || l.cost === undefined) unknown += ext; else { costKnown += qty * l.cost; priceKnown += ext; }
  });
  // A quote brought across from BuildOps as a summary has its amount but no lines.
  // BuildOps' Amount column is the total including HST, so work the subtotal back from it.
  if (!(q.lines || []).length && q.importedAmount !== null && q.importedAmount !== undefined) { subtotal = q.importedAmount / (1 + (Number(q.taxRate) || 0) / 100); unknown = r2(subtotal); }
  subtotal = r2(subtotal);
  const tax = r2(subtotal * (Number(q.taxRate) || 0) / 100);
  const profit = r2(priceKnown - costKnown);
  return { subtotal, tax, total: r2(subtotal + tax), cost: r2(costKnown), profit, marginPct: priceKnown ? profit / priceKnown * 100 : null,
    markupPct: costKnown ? profit / costKnown * 100 : null, unknown: r2(unknown) };
}

// ── Quote numbers: Q + year + running number, continuing BuildOps ──
const NUM_RE = /^Q(\d{4})(\d{3,})$/i;
const fmtNumber = (yr, n) => "Q" + yr + String(n).padStart(4, "0");
async function nextNumber() {
  const yr = new Date().getFullYear(), ref = doc(db, "quotes_meta", "counter");
  // Highest number already used this year (Basecamp quotes and, later, imported BuildOps ones).
  let all = QUOTES;
  try { all = (await getDocs(collection(db, "quotes"))).docs.map(d => d.data()); } catch (e) { /* use what's loaded */ }
  const used = new Set(all.map(q => String(q.number || "").toUpperCase()));
  const maxUsed = Math.max(0, ...all.map(q => NUM_RE.exec(String(q.number || ""))).filter(m => m && +m[1] === yr).map(m => +m[2]));
  // The "next number" setting applies to the year it was set for (the built-in default is for 2026, continuing BuildOps).
  const start = (SETTINGS.nextNumberYear || 2026) === yr ? (num(SETTINGS.nextNumber) || 1) : 1;
  return runTransaction(db, async tx => {
    const s = await tx.get(ref);
    const d = s.exists() ? s.data() : {};
    let n = Math.max(d.year === yr ? (d.next || 1) : 1, start, maxUsed + 1);
    while (used.has(fmtNumber(yr, n))) n++;
    tx.set(ref, { year: yr, next: n + 1 });
    return fmtNumber(yr, n);
  });
}

// ── Data ──
async function loadSettings() {
  try { const s = await getDoc(doc(db, "quotes_meta", "settings")); if (s.exists()) SETTINGS = { ...DEFAULTS, ...s.data() }; } catch (e) { /* defaults */ }
}
async function loadItems() {
  if (ITEMS) return ITEMS;
  try {
    const snap = await getDocs(collection(db, "items_data"));
    ITEMS = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(i => i.active !== false && i.name);
  } catch (e) { ITEMS = []; toast("Couldn't load the Item List (" + (e.code || e.message) + ")."); }
  return ITEMS;
}
async function loadProps() {
  if (PROPS) return PROPS;
  PROPS = [];
  try {
    const s = await getDoc(doc(db, "account_data", "ac_bo_lists"));
    const v = s.exists() ? s.data().value : null;
    const L = typeof v === "string" ? JSON.parse(v) : v;
    // props rows: [id, property, status, customer, type, address, billTo]
    PROPS = ((L && L.props) || []).filter(p => p && (p[1] || p[3])).map(p => ({ id: p[0] || "", property: p[1] || "", customer: p[3] || p[1] || "", address: p[5] || "", billTo: p[6] || "" }));
  } catch (e) { /* type it in */ }
  return PROPS;
}
function hist(q, action) { (q.history = q.history || []).push({ at: new Date().toISOString(), by: SESSION.email, byName: SESSION.name, action }); }

const BLANK = () => ({
  customer: "", property: "", propertyId: "", address: "", billTo: "", billingAddress: "",
  contactName: "", contactPhone: "", contactEmail: "", propertyRep: "", poNumber: "",
  title: "", issueDescription: "", scope: "", lines: [], showLinePrices: true, notes: "", comments: "", tags: "",
  department: "Service", soldBy: SESSION.name || "", projectManager: "", accountManager: "", dueDate: "", jobNumber: "",
  version: 1, versionTitle: "", versions: [],
  margin: SETTINGS.margin, labourRate: SETTINGS.labourRate, labourCost: SETTINGS.labourCost, taxRate: SETTINGS.taxRate, terms: SETTINGS.terms,
});
async function createQuote(from) {
  const number = await nextNumber();
  const q = from ? JSON.parse(JSON.stringify(from)) : BLANK();
  Object.assign(q, { number, status: "draft", quoteDate: TODAY, validUntil: addDays(TODAY, SETTINGS.validDays || 30), history: [],
    version: 1, versionTitle: "", versions: [], jobNumber: "", source: "basecamp",
    createdBy: SESSION.email, createdByName: SESSION.name, createdAt: new Date().toISOString() });
  ["id", "sentAt", "approvedAt", "declinedAt", "declineReason", "importedAmount", "importedAt", "statusRaw", "internalApproval"].forEach(k => delete q[k]);
  if (from) { q.lines = (q.lines || []).map(l => ({ ...l, id: uid() })); hist(q, "Copied from " + from.number); } else hist(q, "Created");
  q.totals = totals(q);
  const ref = doc(collection(db, "quotes"));
  await setDoc(ref, { ...q, updatedAt: new Date().toISOString(), updatedBy: SESSION.email, serverUpdatedAt: serverTimestamp() });
  return ref.id;
}
async function saveNow() {
  if (!Q || !dirty || saving) return;
  saving = true; dirty = false; showSaved("Saving…");
  try {
    Q.totals = totals(Q);
    const { id, ...data } = Q;
    await setDoc(doc(db, "quotes", id), { ...data, updatedAt: new Date().toISOString(), updatedBy: SESSION.email, serverUpdatedAt: serverTimestamp() });
    showSaved("Saved " + new Date().toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" }));
  } catch (e) {
    dirty = true; showSaved("Not saved: " + (e.code || e.message) + ". Retrying…", true);
    setTimeout(saveNow, 8000);
  } finally { saving = false; if (dirty) queueSave(); }
}
function queueSave() { dirty = true; showSaved("Unsaved changes"); clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 900); }
function showSaved(t, bad) { const el = $("q-saved"); if (el) { el.textContent = t; el.className = "saved" + (bad ? " bad" : ""); } }
window.addEventListener("beforeunload", e => { if (dirty) { saveNow(); e.preventDefault(); e.returnValue = ""; } });

// ── Router ──
function route() {
  if (unsub) { unsub(); unsub = null; }
  if (dirty) saveNow();
  const h = location.hash.slice(1), p = new URLSearchParams(h);
  if (p.get("q")) return openQuote(p.get("q"));
  if (h === "settings") return renderSettings();
  return renderList();
}
window.addEventListener("hashchange", route);

// ── List (like BuildOps Quotes: filter chips, the same columns, Export) ──
let TAB = "all", SEARCH = "", DEPT = "";
const isMine = q => q.createdBy === SESSION.email || (SESSION.name && [q.soldBy, q.projectManager, q.accountManager].includes(SESSION.name));
const CHIPS = [
  ["all", "All", () => true],
  ["draft", "Draft", q => shownStatus(q) === "draft"],
  ["sent", "Sent to customer", q => shownStatus(q) === "sent"],
  ["approved", "Approved", q => shownStatus(q) === "approved"],
  ["jobadded", "Approved & Job Added", q => shownStatus(q) === "jobadded"],
  ["mine", "My quotes", isMine],
  ["expired", "Expired", q => shownStatus(q) === "expired"],
  ["declined", "Declined", q => shownStatus(q) === "declined"],
];
function renderList() {
  Q = null;
  $("app").innerHTML = `<div class="top"><div><div class="crumb">Operations</div><h1>Quotes</h1><div class="sub">Build a quote from the Item List, send the customer a PDF, and track it to approval.</div></div>
    <div class="acts-top">${IS_OWNER ? '<a class="btn ghost" href="#settings">Quote settings</a>' : ""}<button class="btn ghost" id="imp">Import from BuildOps</button><button class="btn ghost" id="exp">Export</button><button class="btn" id="new">Create quote</button></div></div>
    <div class="kpis" id="kpis"></div>
    <div class="chips" id="chips"></div>
    <div class="toolbar"><input class="search" id="q-search" placeholder="Search quote #, customer, property, title, job, PO…" value="${esc(SEARCH)}">
      <select id="q-dept" class="dept"><option value="">All departments</option></select><span class="count" id="q-count"></span></div>
    <div class="panel tablewrap"><table class="list" id="list"><tr><td class="empty">Loading…</td></tr></table></div>`;
  $("new").onclick = async () => { $("new").disabled = true; try { location.hash = "q=" + await createQuote(); } catch (e) { toast("Couldn't create the quote (" + (e.code || e.message) + ")."); $("new").disabled = false; } };
  $("q-search").oninput = e => { SEARCH = e.target.value; drawList(); };
  $("q-dept").onchange = e => { DEPT = e.target.value; drawList(); };
  $("exp").onclick = exportCsv;
  $("imp").onclick = openImport;
  unsub = onSnapshot(collection(db, "quotes"), snap => { QUOTES = snap.docs.map(d => ({ id: d.id, ...d.data() })); drawList(); },
    e => { $("list").innerHTML = `<tr><td class="empty">Couldn't load quotes (${esc(e.code || e.message)}). If this is the first day, the updated database rules may not be published yet.</td></tr>`; });
}
const sortKey = q => { const m = NUM_RE.exec(String(q.number || "")); return m ? m[1] + m[2].padStart(8, "0") : "0" + String(q.createdAt || ""); };
function filtered() {
  const f = CHIPS.find(c => c[0] === TAB)[2], s = SEARCH.trim().toLowerCase();
  return QUOTES.filter(f).filter(q => !DEPT || q.department === DEPT)
    .filter(q => !s || [q.number, q.customer, q.property, q.title, q.address, q.poNumber, q.jobNumber, q.soldBy, q.projectManager, q.tags, q.issueDescription].join(" ").toLowerCase().includes(s))
    .sort((a, b) => sortKey(b).localeCompare(sortKey(a)));
}
function drawList() {
  if (!$("list")) return;
  $("chips").innerHTML = CHIPS.map(([k, l, f]) => `<button data-t="${k}" class="${TAB === k ? "on" : ""}">${TAB === k ? "✓ " : ""}${l}<small>${QUOTES.filter(f).length}</small></button>`).join("");
  $("chips").querySelectorAll("button").forEach(b => b.onclick = () => { TAB = b.dataset.t; drawList(); });
  const depts = [...new Set([...(SETTINGS.departments || []), ...QUOTES.map(q => q.department).filter(Boolean)])];
  const ds = $("q-dept"); if (ds.options.length !== depts.length + 1) ds.innerHTML = `<option value="">All departments</option>` + depts.map(d => `<option ${d === DEPT ? "selected" : ""}>${esc(d)}</option>`).join("");
  const month = TODAY.slice(0, 7), S = shownStatus;
  const sentOpen = QUOTES.filter(q => S(q) === "sent"), wonMonth = QUOTES.filter(q => ["approved", "jobadded"].includes(S(q)) && String(q.approvedAt || "").slice(0, 7) === month);
  const decided = QUOTES.filter(q => ["approved", "declined"].includes(q.status));
  $("kpis").innerHTML = `<div class="kpi"><b>${money(sentOpen.reduce((t, q) => t + ((q.totals || {}).subtotal || 0), 0))}</b><span>${sentOpen.length} sent, waiting on the customer</span></div>
    <div class="kpi"><b>${money(wonMonth.reduce((t, q) => t + ((q.totals || {}).subtotal || 0), 0))}</b><span>${wonMonth.length} approved this month</span></div>
    <div class="kpi"><b>${decided.length ? Math.round(decided.filter(q => q.status === "approved").length / decided.length * 100) + "%" : "–"}</b><span>won (approved ÷ decided)</span></div>`;
  const rows = filtered();
  $("q-count").textContent = rows.length + " of " + QUOTES.length;
  $("list").innerHTML = `<tr><th>Quote #</th><th>Title</th><th>Customer</th><th>Property</th><th>Created By</th><th>Created On</th><th>Due Date</th><th class="num" title="Total including HST, as in BuildOps">Amount</th><th>Status</th><th>Department</th><th>Sold By</th><th>Job</th><th class="num">Version</th><th class="num">Margin</th></tr>`
    + (rows.length ? rows.map(q => { const t = q.totals || {}, st = STATUS[S(q)];
      return `<tr class="row" data-id="${esc(q.id)}"><td><b class="qn">${esc(q.number)}</b>${q.source === "buildops" ? '<small>from BuildOps</small>' : ""}</td>
        <td class="clip">${esc(q.title || "")}</td><td class="clip">${esc(q.customer || "")}</td><td class="clip">${esc(q.property || "")}</td>
        <td>${esc(q.createdByName || "")}</td><td>${esc(niceDate(q.createdAt || q.quoteDate))}</td><td>${esc(niceDate(q.dueDate))}</td>
        <td class="num">${money(t.total)}</td><td><span class="tag ${st.cls}">${st.label}</span></td><td>${q.department ? `<span class="tag dept-tag">${esc(q.department)}</span>` : ""}</td>
        <td>${esc(q.soldBy || "")}</td><td>${esc(q.jobNumber || "")}</td><td class="num">${esc(q.version || 1)}</td><td class="num">${pct(t.marginPct)}</td></tr>`; }).join("")
      : `<tr><td colspan="14" class="empty">${QUOTES.length ? "Nothing matches." : "No quotes yet. Click Create quote to start one."}</td></tr>`);
  $("list").querySelectorAll("tr.row").forEach(r => r.onclick = () => location.hash = "q=" + r.dataset.id);
}
// Export the list as shown (same headings as BuildOps' Export, plus Margin).
function exportCsv() {
  const H = ["Quote #", "Title", "Customer", "Property", "Created By", "Created On", "Due Date", "Amount", "Status", "Tags", "Project Manager", "Account Manager", "Sold By",
    "Billing Address", "Comments", "Customer PO#", "Property Representative", "Customer Representative", "Job", "Version", "Version Title", "Department", "Notes", "Issue Description", "Subtotal before HST", "Margin %"];
  const cell = v => { const s = String(v ?? ""); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const rows = filtered().map(q => { const t = q.totals || {};
    return [q.number, q.title, q.customer, q.property, q.createdByName, String(q.createdAt || q.quoteDate || "").slice(0, 10), q.dueDate, (t.total ?? 0).toFixed(2), STATUS[shownStatus(q)].label,
      q.tags, q.projectManager, q.accountManager, q.soldBy, q.billingAddress, q.comments, q.poNumber, q.propertyRep, q.contactName, q.jobNumber, q.version || 1, q.versionTitle,
      q.department, q.notes, q.issueDescription, (t.subtotal ?? 0).toFixed(2), t.marginPct === null || t.marginPct === undefined ? "" : t.marginPct.toFixed(1)]; });
  const csv = [H, ...rows].map(r => r.map(cell).join(",")).join("\r\n");
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" }));
  a.download = "Basecamp quotes " + TODAY + ".csv"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ── One quote ──
async function openQuote(id) {
  $("app").innerHTML = `<div class="empty">Loading quote…</div>`;
  try {
    const s = await getDoc(doc(db, "quotes", id));
    if (!s.exists()) { $("app").innerHTML = `<div class="empty">That quote doesn't exist. <a href="#">Back to Quotes</a></div>`; return; }
    Q = { ...BLANK(), id: s.id, ...s.data() };
  } catch (e) { $("app").innerHTML = `<div class="empty">Couldn't open the quote (${esc(e.code || e.message)}). <a href="#">Back</a></div>`; return; }
  dirty = false;
  renderQuote();
  loadProps().then(fillPropList);
}
const locked = () => ["approved", "declined"].includes(Q.status);

function renderQuote() {
  const st = STATUS[shownStatus(Q)], L = locked(), dis = L ? "disabled" : "";
  const fld = (k, label, attrs = "", always) => `<label class="f">${label}<input data-k="${k}" value="${esc(Q[k] ?? "")}" ${attrs} ${always ? "" : dis}></label>`;
  const staff = (k, label) => fld(k, label, 'list="staff-list"');
  const depts = [...new Set([...(SETTINGS.departments || []), Q.department].filter(Boolean))];
  $("app").innerHTML = `<div class="crumb"><a href="#">Quotes</a> / ${esc(Q.number)}</div>
  <div class="qhead"><div><h1>${esc(Q.number)} <span class="tag ${st.cls}" style="vertical-align:middle;font-size:.8rem">${st.label}</span>${(Q.version || 1) > 1 ? ` <span class="tag st-draft" style="vertical-align:middle;font-size:.8rem">Version ${esc(Q.version)}</span>` : ""}</h1>
    <div class="sub">${esc(Q.title || "New quote")}${Q.customer ? " · " + esc(Q.customer) : ""}${Q.versionTitle ? " · " + esc(Q.versionTitle) : ""}</div></div>
    <div class="acts"><span class="saved" id="q-saved"></span>${statusButtons()}
      <button class="btn ghost" id="b-pdf">PDF / Print</button>${["sent", "declined"].includes(Q.status) || shownStatus(Q) === "expired" ? '<button class="btn ghost" id="b-ver">New version</button>' : ""}<button class="btn ghost" id="b-copy">Copy</button>
      ${Q.status === "draft" && !(Q.versions || []).length ? '<button class="btn danger" id="b-del">Delete</button>' : ""}</div></div>
  ${Q.source === "buildops" ? `<div class="banner">Brought across from BuildOps ${esc(niceDate(Q.importedAt))}${(Q.lines || []).length ? "" : `: the amount (${money(Q.importedAmount)}) and details came across, the line items stay in BuildOps`}.</div>` : ""}
  ${L ? `<div class="banner ${Q.status === "approved" ? "ok" : ""}">${Q.status === "approved"
      ? `Approved ${esc(stamp(Q.approvedAt).replace(/\.$/, ""))}. It's locked so the approved price can't change. ${Q.jobNumber ? `Job <b>${esc(Q.jobNumber)}</b> is attached.` : "Enter the job number under Quote details once the job is set up, and it becomes <b>Approved &amp; Job Added</b>."} Use <b>Back to draft</b> only if the customer asked for changes before work starts.`
      : `Declined ${esc(stamp(Q.declinedAt).replace(/\.$/, ""))}${Q.declineReason ? ": " + esc(Q.declineReason) : ""}. Use <b>New version</b> to revise and re-send, or <b>Copy</b> to start a fresh quote.`}</div>` : ""}
  ${shownStatus(Q) === "expired" ? `<div class="banner">This quote passed its valid-until date (${esc(niceDate(Q.validUntil))}). Change the date and mark it sent again, or start a new version to re-price.</div>` : ""}
  <div class="layout"><div>
    <div class="panel"><h2>Customer</h2>
      <div class="g g2">
        <label class="f">Customer or property <span style="opacity:.7">(type to search Alpine's property list)</span><input id="cust-pick" list="prop-list" placeholder="Start typing a customer or property…" ${dis}></label>
        <div></div>
        ${fld("customer", "Customer")}${fld("property", "Property")}
        ${fld("address", "Property address")}${fld("billTo", "Bill to")}
        ${fld("billingAddress", "Billing address")}${fld("poNumber", "Customer PO#")}
      </div>
      <div class="g g4" style="margin-top:.8rem">${fld("contactName", "Customer representative")}${fld("contactPhone", "Phone")}${fld("contactEmail", "Email")}${fld("propertyRep", "Property representative")}</div>
      <datalist id="prop-list"></datalist><datalist id="staff-list">${STAFF.map(n => `<option value="${esc(n)}">`).join("")}</datalist>
    </div>
    <div class="panel"><h2>The work</h2>
      <div class="g">${fld("title", "Title (shows on the PDF)", 'placeholder="e.g. Replace RTU-2 condenser fan motor"')}
        <label class="f">Issue description (what the customer reported; inside Alpine only)<textarea data-k="issueDescription" rows="2" placeholder="e.g. RTU-2 not cooling, 2nd floor east side warm" ${dis}>${esc(Q.issueDescription || "")}</textarea></label>
        <label class="f">Scope of work (what the customer reads on the PDF)<textarea data-k="scope" rows="5" placeholder="What we'll do, what's included, what isn't." ${dis}>${esc(Q.scope || "")}</textarea></label></div>
    </div>
    <div class="panel"><h2>Lines</h2>
      <div style="overflow-x:auto"><table class="lines" id="lines"></table></div>
      ${L ? "" : `<div class="addrow"><button class="btn" id="add-item">+ From Item List</button><button class="btn ghost" id="add-lab">+ Labour</button><button class="btn ghost" id="add-line">+ Other line</button></div>
      <p class="note">Change the cost or margin and the price follows: price = cost ÷ (1 − margin%). Type a price instead and the margin is worked back. Lines under ${esc(SETTINGS.minMargin)}% margin show in red.</p>`}
    </div>
    <div class="panel"><h2>Terms on the PDF</h2><textarea data-k="terms" rows="5" ${dis}>${esc(Q.terms || "")}</textarea></div>
    <div class="panel"><h2>Notes and comments</h2><div class="g">
      <label class="f">Notes (inside Alpine only)<textarea data-k="notes" rows="3" placeholder="Only Alpine sees these." ${dis}>${esc(Q.notes || "")}</textarea></label>
      <label class="f">Comments<textarea data-k="comments" rows="2" ${dis}>${esc(Q.comments || "")}</textarea></label></div></div>
  </div>
  <div class="side">
    <div class="panel"><h2>Totals</h2><table class="totals" id="tot"></table>
      <div class="internal"><h3>Inside Alpine only</h3><table class="totals" id="tot-in"></table></div></div>
    <div class="panel"><h2>Quote details</h2><div class="g">
      <label class="f">Department<select data-k="department" ${dis}>${depts.map(d => `<option ${d === Q.department ? "selected" : ""}>${esc(d)}</option>`).join("")}</select></label>
      ${staff("soldBy", "Sold by")}${staff("projectManager", "Project manager")}${staff("accountManager", "Account manager")}
      <div class="g g2"><label class="f">Created on<input value="${esc(niceDate(Q.createdAt || Q.quoteDate))}" disabled></label><label class="f">Due date<input type="date" data-k="dueDate" value="${esc(Q.dueDate || "")}" ${dis}></label></div>
      <div class="g g2"><label class="f">Quote date (on PDF)<input type="date" data-k="quoteDate" value="${esc(Q.quoteDate || "")}" ${dis}></label><label class="f">Valid until<input type="date" data-k="validUntil" value="${esc(Q.validUntil || "")}" ${dis}></label></div>
      <div class="g g2"><label class="f">Version<input value="${esc(Q.version || 1)}" disabled></label>${fld("versionTitle", "Version title")}</div>
      ${fld("jobNumber", "Job", 'placeholder="e.g. JO20261208"' + (Q.status === "approved" ? "" : ' title="Fills in once the quote is approved and a job is set up"'), Q.status === "approved")}
      ${fld("tags", "Tags", 'placeholder="comma separated"')}
    </div></div>
    <div class="panel"><h2>Pricing</h2><div class="g">
      <div class="g g2"><label class="f">Default margin %<input data-k="margin" data-num value="${esc(Q.margin)}" ${dis}></label><label class="f">HST %<input data-k="taxRate" data-num value="${esc(Q.taxRate)}" ${dis}></label></div>
      <div class="g g2"><label class="f">Labour rate $/hr<input data-k="labourRate" data-num value="${esc(Q.labourRate)}" ${dis}></label><label class="f">Labour cost $/hr<input data-k="labourCost" data-num value="${esc(Q.labourCost ?? "")}" placeholder="not counted" ${dis}></label></div>
      <label class="f" style="display:flex;gap:.5rem;align-items:center;color:var(--white);font-size:.85rem"><input type="checkbox" data-k="showLinePrices" style="width:auto" ${Q.showLinePrices !== false ? "checked" : ""} ${dis}> Show each line's price on the PDF (off = one total)</label>
    </div></div>
    ${(Q.versions || []).length ? `<div class="panel"><h2>Earlier versions</h2><ul class="hist">${Q.versions.slice().reverse().map((v, i) => `<li><b>Version ${esc(v.version)}</b>${v.versionTitle ? " · " + esc(v.versionTitle) : ""} · ${money((v.totals || {}).subtotal)} · ${esc(STATUS[v.status] ? STATUS[v.status].label : v.status || "")}<br>${esc(stamp(v.savedAt))} <button class="linkbtn" data-vpdf="${Q.versions.length - 1 - i}">PDF</button></li>`).join("")}</ul></div>` : ""}
    <div class="panel"><h2>History</h2><ul class="hist">${(Q.history || []).slice().reverse().map(h => `<li>${esc(stamp(h.at))} · ${esc((h.byName || "").split(" ")[0])}: ${esc(h.action)}</li>`).join("")}</ul></div>
  </div></div>`;
  wireQuote();
  drawLines(); drawTotals();
}
function statusButtons() {
  const s = Q.status || "draft";
  if (s === "draft") return `<button class="btn" data-st="sent">Mark as sent</button>`;
  if (s === "sent") return `<button class="btn green" data-st="approved">Approved</button><button class="btn ghost" data-st="declined">Declined</button><button class="btn ghost" data-st="draft">Back to draft</button>`;
  return `<button class="btn ghost" data-st="draft">Back to draft</button>`;
}
function setStatus(s) {
  const now = new Date().toISOString(), before = Q.status;
  if (s === "sent" && !(Q.lines || []).length && Q.importedAmount == null) { toast("Add at least one line before sending."); return; }
  if (s === "sent" && !Q.customer) { toast("Add the customer first."); return; }
  if (s === "declined") { const why = prompt("Why did they decline? (optional, e.g. price, went with another contractor)"); if (why === null) return; Q.declineReason = why.trim(); Q.declinedAt = now; }
  if (s === "approved") { if (!confirm(`Mark ${Q.number} approved for ${money(totals(Q).total)} including HST? It locks so the price can't change.`)) return; Q.approvedAt = now; }
  if (s === "sent") { Q.sentAt = now; if (Q.validUntil && Q.validUntil < TODAY) Q.validUntil = addDays(TODAY, SETTINGS.validDays || 30); }
  if (s === "draft" && before === "approved" && !confirm("Unlock this approved quote and move it back to draft?")) return;
  Q.status = s;
  hist(Q, { sent: "Sent to customer", approved: "Approved", declined: "Declined" + (Q.declineReason ? " (" + Q.declineReason + ")" : ""), draft: "Back to draft" }[s]);
  dirty = true; saveNow().then(renderQuote);
}
// New version: same quote number; the current version is kept underneath (with its own PDF), the new one opens as a draft.
function newVersion() {
  const title = prompt(`Start version ${(Q.version || 1) + 1} of ${Q.number}. Version title (optional, e.g. "Option B: high-efficiency unit"):`, "");
  if (title === null) return;
  const keep = ["version", "versionTitle", "status", "title", "scope", "issueDescription", "lines", "terms", "showLinePrices", "quoteDate", "validUntil", "taxRate", "declineReason"];
  const snap = Object.fromEntries(keep.map(k => [k, JSON.parse(JSON.stringify(Q[k] ?? null))]));
  snap.totals = totals(Q); snap.savedAt = new Date().toISOString(); snap.savedBy = SESSION.name;
  (Q.versions = Q.versions || []).push(snap);
  Q.version = (Q.version || 1) + 1; Q.versionTitle = title.trim(); Q.status = "draft";
  Q.quoteDate = TODAY; Q.validUntil = addDays(TODAY, SETTINGS.validDays || 30);
  delete Q.sentAt; delete Q.declinedAt; delete Q.declineReason;
  hist(Q, "Version " + Q.version + " started" + (Q.versionTitle ? " (" + Q.versionTitle + ")" : ""));
  dirty = true; saveNow().then(renderQuote);
}
function wireQuote() {
  $("b-pdf").onclick = () => printQuote(Q);
  if ($("b-ver")) $("b-ver").onclick = newVersion;
  $("b-copy").onclick = async () => { await saveNow(); try { location.hash = "q=" + await createQuote(Q); toast("Copied to a new draft."); } catch (e) { toast("Couldn't copy (" + (e.code || e.message) + ")."); } };
  if ($("b-del")) $("b-del").onclick = async () => { if (!confirm(`Delete draft ${Q.number}? This can't be undone.`)) return; dirty = false; await deleteDoc(doc(db, "quotes", Q.id)); location.hash = ""; toast("Draft deleted."); };
  document.querySelectorAll("[data-st]").forEach(b => b.onclick = () => setStatus(b.dataset.st));
  document.querySelectorAll("[data-vpdf]").forEach(b => b.onclick = () => { const v = Q.versions[+b.dataset.vpdf]; printQuote({ ...Q, ...v }); });
  document.querySelectorAll("#app [data-k]").forEach(el => {
    const k = el.dataset.k;
    el.addEventListener(el.type === "checkbox" || el.type === "date" || el.tagName === "SELECT" ? "change" : "input", () => {
      const before = Q[k];
      Q[k] = el.type === "checkbox" ? el.checked : el.hasAttribute("data-num") ? num(el.value) : el.value;
      if (k === "labourRate" || k === "labourCost") (Q.lines || []).filter(l => l.type === "Labour" && l.fromRate).forEach(l => { l.price = Q.labourRate || 0; l.cost = Q.labourCost ?? null; });
      if (["margin", "taxRate", "labourRate", "labourCost"].includes(k)) { drawLines(); }
      if (k === "jobNumber") {
        clearTimeout(wireQuote._job);
        wireQuote._job = setTimeout(() => { if (Q.jobNumber && Q.jobNumber !== before) { hist(Q, "Job " + Q.jobNumber + " added"); } queueSave(); setTimeout(renderQuote, 950); }, 1200);
      }
      drawTotals(); queueSave();
    });
  });
  const pick = $("cust-pick");
  if (pick) pick.addEventListener("change", () => {
    const p = (PROPS || []).find(x => label(x) === pick.value);
    if (!p) return;
    Object.assign(Q, { customer: p.customer, property: p.property, propertyId: p.id, address: p.address, billTo: p.billTo || p.customer });
    ["customer", "property", "address", "billTo"].forEach(k => { const el = document.querySelector(`#app [data-k="${k}"]`); if (el) el.value = Q[k] || ""; });
    pick.value = ""; queueSave();
  });
  if ($("add-item")) {
    $("add-item").onclick = openPicker;
    $("add-lab").onclick = () => addLine({ type: "Labour", name: "Labour", description: "", qty: 1, uom: "hr", cost: Q.labourCost ?? null, price: Q.labourRate || 0, priceSet: true, fromRate: true });
    $("add-line").onclick = () => addLine({ type: "Material", name: "", description: "", qty: 1, uom: "ea", cost: null, margin: Q.margin, price: 0, priceSet: true });
  }
}
const label = p => p.customer && p.property && p.customer !== p.property ? p.customer + " — " + p.property : (p.property || p.customer);
function fillPropList() {
  const dl = $("prop-list"); if (!dl || !PROPS) return;
  dl.innerHTML = PROPS.slice(0, 3000).map(p => `<option value="${esc(label(p))}">${esc(p.address)}</option>`).join("");
}
function addLine(l) { (Q.lines = Q.lines || []).push({ id: uid(), margin: Q.margin, ...l }); drawLines(); drawTotals(); queueSave(); }

function drawLines() {
  const L = locked(), dis = L ? "disabled" : "";
  const lines = Q.lines || [];
  $("lines").innerHTML = `<tr><th>Type</th><th>Item / description</th><th class="num">Qty</th><th>Unit</th><th class="num">Unit cost</th><th class="num">Margin %</th><th class="num">Unit price</th><th class="num">Total</th><th></th></tr>`
    + (lines.length ? lines.map((l, i) => {
      const m = lineMargin(l), low = m !== null && m < (SETTINGS.minMargin ?? 20);
      return `<tr data-i="${i}">
        <td class="w-type"><select data-f="type" ${dis}>${TYPES.map(t => `<option ${t === l.type ? "selected" : ""}>${t}</option>`).join("")}</select></td>
        <td style="min-width:240px"><input data-f="name" value="${esc(l.name)}" placeholder="Item" ${dis}><textarea data-f="description" rows="1" placeholder="Description (optional, shows on the PDF)" style="margin-top:.25rem" ${dis}>${esc(l.description || "")}</textarea>${l.productCode ? `<div class="note">${esc(l.productCode)}</div>` : ""}</td>
        <td><input class="n" data-f="qty" value="${esc(l.qty)}" ${dis}></td>
        <td><input data-f="uom" value="${esc(l.uom || "")}" style="width:58px" ${dis}></td>
        <td><input class="n" data-f="cost" value="${l.cost === null || l.cost === undefined ? "" : esc(l.cost)}" placeholder="?" ${dis}>${l.cost === null || l.cost === undefined ? '<div class="cost-unknown">no cost</div>' : ""}</td>
        <td class="${low ? "mlow" : ""}"><input class="n" data-f="margin" value="${m === null ? "" : esc(Math.round(m * 10) / 10)}" ${l.cost === null || l.cost === undefined ? "disabled title=\"Enter a cost to use a margin\"" : dis}></td>
        <td><input class="n" data-f="price" value="${esc(linePrice(l).toFixed(2))}" ${dis}></td>
        <td class="num tot" data-ext>${money((Number(l.qty) || 0) * linePrice(l))}</td>
        <td>${L ? "" : `<button class="x" data-del title="Remove line">✕</button>`}</td></tr>`; }).join("")
      : `<tr><td colspan="9" class="empty">${Q.source === "buildops" && Q.importedAmount != null ? "Line items stayed in BuildOps. Add lines here to re-price it in Basecamp." : "No lines yet. Add items from the Item List, labour, or a custom line."}</td></tr>`);
  $("lines").querySelectorAll("tr[data-i]").forEach(tr => {
    const l = Q.lines[+tr.dataset.i];
    tr.querySelectorAll("[data-f]").forEach(el => el.addEventListener(el.tagName === "SELECT" ? "change" : "input", () => {
      const f = el.dataset.f;
      if (f === "qty") l.qty = num(el.value) ?? 0;
      else if (f === "cost") l.cost = num(el.value);
      else if (f === "margin") { l.margin = num(el.value) ?? 0; l.priceSet = false; l.fromRate = false; }
      else if (f === "price") { l.price = num(el.value) ?? 0; l.priceSet = true; l.fromRate = false; }
      else l[f] = el.value;
      // Refresh the computed cells in this row without redrawing (keeps the cursor where it is).
      const m = lineMargin(l);
      if (f !== "margin") { const mi = tr.querySelector('[data-f="margin"]'); mi.value = m === null ? "" : Math.round(m * 10) / 10; mi.disabled = l.cost === null || locked(); }
      if (f !== "price") tr.querySelector('[data-f="price"]').value = linePrice(l).toFixed(2);
      tr.querySelector('[data-f="margin"]').parentElement.classList.toggle("mlow", m !== null && m < (SETTINGS.minMargin ?? 20));
      tr.querySelector("[data-ext]").textContent = money((Number(l.qty) || 0) * linePrice(l));
      const cu = tr.querySelector(".cost-unknown"); if (cu) cu.style.display = l.cost === null ? "" : "none";
      drawTotals(); queueSave();
    }));
    const x = tr.querySelector("[data-del]");
    if (x) x.onclick = () => { Q.lines.splice(+tr.dataset.i, 1); drawLines(); drawTotals(); queueSave(); };
  });
}
function drawTotals() {
  const t = totals(Q);
  $("tot").innerHTML = `<tr><td>Subtotal</td><td class="num">${money(t.subtotal)}</td></tr><tr><td>HST ${esc(Q.taxRate ?? 0)}%</td><td class="num">${money(t.tax)}</td></tr><tr class="big"><td>Total</td><td class="num">${money(t.total)}</td></tr>`;
  $("tot-in").innerHTML = `<tr><td>Cost</td><td class="num">${money(t.cost)}</td></tr><tr><td>Gross profit</td><td class="num">${money(t.profit)}</td></tr><tr><td><b>Margin</b></td><td class="num"><b>${pct(t.marginPct)}</b></td></tr><tr><td>Markup</td><td class="num">${pct(t.markupPct)}</td></tr>`
    + (t.unknown ? `<tr><td colspan="2" class="note">${money(t.unknown)} of lines have no cost, so they're left out of profit and margin.</td></tr>` : "");
}

// ── Item List picker ──
async function openPicker() {
  $("pick").classList.add("on"); $("pick-q").value = ""; $("pick-list").innerHTML = `<tr><td class="empty">Loading the Item List…</td></tr>`;
  await loadItems(); drawPick(); setTimeout(() => $("pick-q").focus(), 30);
}
function drawPick() {
  const s = $("pick-q").value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const hits = ITEMS.filter(i => { const h = [i.name, i.description, i.productCode, i.mfrPart, i.manufacturer, i.category, i.vendor].join(" ").toLowerCase(); return s.every(w => h.includes(w)); }).slice(0, 60);
  $("pick-list").innerHTML = hits.length ? hits.map(i => `<tr data-id="${esc(i.id)}"><td><b>${esc(i.name)}</b><small>${esc([i.description, i.productCode, i.manufacturer].filter(Boolean).join(" · ").slice(0, 160))}</small></td>
    <td><small>${esc(i.category || i.costType || "")}</small></td><td class="num">${i.unitCost === null || i.unitCost === undefined || i.unitCost === "" ? '<small>no cost</small>' : money(i.unitCost)}<small>${esc(i.uom || "")}</small></td></tr>`).join("")
    : `<tr><td class="empty">${ITEMS.length ? "No match. Try fewer words, or add an Other line." : "The Item List is empty or couldn't be loaded."}</td></tr>`;
  $("pick-list").querySelectorAll("tr[data-id]").forEach(r => r.onclick = () => {
    const i = ITEMS.find(x => x.id === r.dataset.id);
    const ct = String(i.costType || i.category || "").toLowerCase();
    const type = /labou?r/.test(ct) ? "Labour" : /equip/.test(ct) ? "Equipment" : /sub/.test(ct) ? "Subcontractor" : "Material";
    const cost = num(i.unitCost);
    addLine({ type, itemId: i.id, productCode: i.productCode || "", name: i.name, description: i.description || "", qty: 1, uom: i.uom || "ea",
      cost, margin: Q.margin, price: cost === null ? 0 : undefined, priceSet: cost === null });
    toast("Added " + i.name);
  });
}
$("pick-q").addEventListener("input", drawPick);
$("pick-close").onclick = () => $("pick").classList.remove("on");
$("pick").addEventListener("click", e => { if (e.target === $("pick")) $("pick").classList.remove("on"); });
document.addEventListener("keydown", e => { if (e.key === "Escape") { $("pick").classList.remove("on"); $("imp-back").classList.remove("on"); } });

// ── Customer PDF (browser print → Save as PDF) ──
async function printQuote(q) {
  if (q === Q) await saveNow();
  const t = totals(q), showLines = q.showLinePrices !== false;
  const rows = (q.lines || []).map(l => `<tr><td>${esc(l.name)}${l.description ? `<small>${esc(l.description)}</small>` : ""}</td><td class="num">${esc(l.qty)} ${esc(l.uom || "")}</td>
    ${showLines ? `<td class="num">${money(linePrice(l))}</td><td class="num">${money((Number(l.qty) || 0) * linePrice(l))}</td>` : ""}</tr>`).join("");
  const ver = (q.version || 1) > 1 ? `Version ${esc(q.version)}${q.versionTitle ? ": " + esc(q.versionTitle) : ""}` : (q.versionTitle ? esc(q.versionTitle) : "");
  $("doc").innerHTML = `<div class="band"><img src="images/alpine-logo-white.png" alt="Alpine HVAC"><div class="t"><b>QUOTE</b>${esc(q.number)}${ver ? `<br><span style="font-size:9pt">${ver}</span>` : ""}</div></div>
    <div class="meta"><div><h4>Prepared for</h4><table>
      <tr><td><b>${esc(q.billTo || q.customer)}</b></td></tr>${q.billingAddress ? `<tr><td>${esc(q.billingAddress)}</td></tr>` : ""}
      ${q.property && q.property !== q.customer ? `<tr><td style="padding-top:5px">Property: ${esc(q.property)}</td></tr>` : ""}${q.address ? `<tr><td>${esc(q.address)}</td></tr>` : ""}
      ${q.contactName ? `<tr><td style="padding-top:5px">Attn: ${esc(q.contactName)}${q.contactPhone ? " · " + esc(q.contactPhone) : ""}</td></tr>` : ""}</table></div>
      <div><h4>Quote</h4><table><tr><td>Date</td><td>${esc(niceDate(q.quoteDate))}</td></tr><tr><td>Valid until</td><td>${esc(niceDate(q.validUntil))}</td></tr>
      ${q.poNumber ? `<tr><td>Your PO</td><td>${esc(q.poNumber)}</td></tr>` : ""}<tr><td>Prepared by</td><td>${esc(q.soldBy || q.createdByName || "")}</td></tr></table></div></div>
    ${q.title ? `<h3>${esc(q.title)}</h3>` : ""}${q.scope ? `<div class="scope">${esc(q.scope)}</div>` : ""}
    <h3>Pricing</h3>${rows ? `<table class="items"><tr><th>Item</th><th class="num">Qty</th>${showLines ? '<th class="num">Unit price</th><th class="num">Amount</th>' : ""}</tr>${rows}</table>` : ""}
    <table class="tot"><tr><td>Subtotal</td><td class="num">${money(t.subtotal)}</td></tr><tr><td>HST ${esc(q.taxRate ?? 0)}%${SETTINGS.hstNumber ? " (" + esc(SETTINGS.hstNumber) + ")" : ""}</td><td class="num">${money(t.tax)}</td></tr><tr class="big"><td>Total</td><td class="num">${money(t.total)}</td></tr></table>
    ${q.terms ? `<h3>Terms</h3><div class="terms">${esc(q.terms)}</div>` : ""}
    <h3>Acceptance</h3><div style="font-size:9pt">To approve, sign below and return to Alpine HVAC, or reply to the email this quote came with.</div>
    <div class="sign"><div>Authorized signature and printed name</div><div>Date</div></div>
    <div class="foot">${esc(COMPANY.name)} · ${esc(COMPANY.address)} · ${esc(COMPANY.phone)} · ${esc(COMPANY.web)}</div>`;
  const img = $("doc").querySelector("img");
  const go = () => { const old = document.title; document.title = q.number + ((q.version || 1) > 1 ? " v" + q.version : "") + " " + (q.customer || "Quote"); window.print(); document.title = old; };
  if (img.complete) go(); else { img.onload = go; img.onerror = go; }
}

// ── Import from BuildOps (BuildOps Quotes > Export CSV) ──
// Reads the file and shows what would come across: summary per quote (number, customer, property,
// title, amount, status, people, dates, job, version). Line items stay in BuildOps. Writing is
// switched off (IMPORT_ON) until Dave says go; nothing is saved while it's off.
function parseCsv(text) {
  const rows = []; let row = [], cell = "", q = false;
  text = text.replace(/^﻿/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(x => String(x).trim() !== ""));
}
const HDR = { "quote": "number", "quote#": "number", "quotenumber": "number", "title": "title", "customer": "customer", "property": "property", "createdby": "createdByName",
  "createdon": "createdOn", "duedate": "dueDate", "amount": "amount", "status": "statusRaw", "internalapprovalstatus": "internalApproval", "tags": "tags",
  "projectmanager": "projectManager", "accountmanager": "accountManager", "soldby": "soldBy", "billingaddress": "billingAddress", "comments": "comments",
  "customerpo": "poNumber", "customerpo#": "poNumber", "propertyrepresentative": "propertyRep", "customerrepresentative": "contactName", "job": "jobNumber",
  "version": "version", "versiontitle": "versionTitle", "department": "department", "notes": "notes", "issuedescription": "issueDescription" };
const hkey = h => String(h || "").toLowerCase().replace(/[^a-z0-9#]/g, "");
function toYmd(s) {
  s = String(s || "").trim(); if (!s) return "";
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); if (m) return m[0];
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s); if (m) return m[3] + "-" + m[1].padStart(2, "0") + "-" + m[2].padStart(2, "0");
  const d = new Date(s); return isNaN(d) ? "" : ymd(d);
}
function mapStatus(raw) {
  const s = String(raw || "").toLowerCase();
  if (/job/.test(s) && /approv/.test(s)) return "approved";
  if (/approv|accept|won/.test(s)) return "approved";
  if (/sent|customer|pending|await/.test(s)) return "sent";
  if (/expir/.test(s)) return "expired";
  if (/declin|reject|lost|cancel|void/.test(s)) return "declined";
  return "draft";
}
function importRows(rows) {
  const head = rows[0].map(hkey), out = [], unknown = head.filter(h => h && !HDR[h]);
  rows.slice(1).forEach(r => {
    const o = {}; head.forEach((h, i) => { if (HDR[h]) o[HDR[h]] = String(r[i] ?? "").trim(); });
    if (!o.number) return;
    const status = mapStatus(o.statusRaw);
    out.push({ ...BLANK(), ...o, status: status === "expired" ? "sent" : status, validUntil: status === "expired" ? addDays(TODAY, -1) : "",
      importedAmount: num(o.amount), createdAt: o.createdOn ? toYmd(o.createdOn) + "T12:00:00" : "", quoteDate: toYmd(o.createdOn), dueDate: toYmd(o.dueDate),
      version: num(o.version) || 1, source: "buildops", lines: [], soldBy: o.soldBy || "" });
  });
  return { quotes: out, unknown };
}
function openImport() {
  $("imp-back").classList.add("on");
  $("imp-body").innerHTML = `<p>Bring Alpine's quotes across from BuildOps, so open quotes can be finished here and past ones count toward the history.</p>
    <ol class="steps"><li>In BuildOps, go to <b>Operations › Quotes</b>, choose <b>All</b>, then click <b>Export</b>.</li><li>Choose that file below. You'll see exactly what would come across before anything is saved.</li></ol>
    <label class="btn ghost" style="cursor:pointer">Choose the BuildOps export (.csv)<input type="file" id="imp-file" accept=".csv,text/csv" style="display:none"></label>
    <div id="imp-prev"></div>`;
  $("imp-file").onchange = async e => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    let parsed;
    try { const rows = parseCsv(await f.text()); if (rows.length < 2) throw new Error("no rows"); parsed = importRows(rows); }
    catch (err) { $("imp-prev").innerHTML = `<div class="banner">That file couldn't be read as a BuildOps quotes export (${esc(err.message)}).</div>`; return; }
    const have = new Set(QUOTES.map(q => String(q.number).toUpperCase()));
    const fresh = parsed.quotes.filter(q => !have.has(String(q.number).toUpperCase()));
    const by = {}; parsed.quotes.forEach(q => { const s = STATUS[shownStatus(q)].label; by[s] = (by[s] || 0) + 1; });
    const total = parsed.quotes.reduce((t, q) => t + (q.importedAmount || 0), 0);
    $("imp-prev").innerHTML = `<div class="kpis" style="margin-top:1rem"><div class="kpi"><b>${parsed.quotes.length}</b><span>quotes in the file</span></div><div class="kpi"><b>${fresh.length}</b><span>new to Basecamp</span></div><div class="kpi"><b>${money(total)}</b><span>total amount (incl. HST)</span></div></div>
      <p class="note">${Object.entries(by).map(([k, v]) => `${esc(k)}: ${v}`).join(" · ")}${parsed.unknown.length ? ` · Columns not used: ${esc(parsed.unknown.join(", "))}` : ""}</p>
      <div class="tablewrap" style="max-height:300px;overflow:auto;margin-top:.6rem"><table class="list"><tr><th>Quote #</th><th>Customer</th><th>Title</th><th class="num">Amount</th><th>Status</th><th>Sold by</th><th>Job</th></tr>
      ${parsed.quotes.slice(0, 200).map(q => `<tr><td>${esc(q.number)}${have.has(String(q.number).toUpperCase()) ? "<small>already here</small>" : ""}</td><td>${esc(q.customer)}</td><td class="clip">${esc(q.title)}</td><td class="num">${money(q.importedAmount)}</td><td><span class="tag ${STATUS[shownStatus(q)].cls}">${STATUS[shownStatus(q)].label}</span></td><td>${esc(q.soldBy)}</td><td>${esc(q.jobNumber)}</td></tr>`).join("")}</table></div>
      <div style="margin-top:1rem;display:flex;gap:.6rem;align-items:center;flex-wrap:wrap"><button class="btn" id="imp-go" ${IMPORT_ON && fresh.length ? "" : "disabled"}>Import ${fresh.length} quote${fresh.length === 1 ? "" : "s"}</button>
      <span class="note" style="margin:0">${IMPORT_ON ? "Quotes already in Basecamp are left alone." : "The import is switched off for now. This is a preview only; nothing has been saved."}</span></div>`;
    if (IMPORT_ON && $("imp-go")) $("imp-go").onclick = async () => {
      $("imp-go").disabled = true; let n = 0;
      for (const q of fresh) {
        q.totals = totals(q); q.importedAt = TODAY; q.history = [{ at: new Date().toISOString(), by: SESSION.email, byName: SESSION.name, action: "Brought across from BuildOps" }];
        q.createdByName = q.createdByName || ""; q.updatedAt = new Date().toISOString(); q.updatedBy = SESSION.email;
        try { await setDoc(doc(collection(db, "quotes")), q); n++; } catch (e) { toast("Stopped after " + n + " (" + (e.code || e.message) + ")."); return; }
      }
      // Carry the numbering on from the highest BuildOps number.
      try { await nextNumber(); } catch (e) { /* next create does it */ }
      toast(n + " quotes brought across."); $("imp-back").classList.remove("on");
    };
  };
}
$("imp-close").onclick = () => $("imp-back").classList.remove("on");
$("imp-back").addEventListener("click", e => { if (e.target === $("imp-back")) $("imp-back").classList.remove("on"); });

// ── Quote settings (owners) ──
async function renderSettings() {
  if (!IS_OWNER) { location.hash = ""; return; }
  await loadSettings();
  const s = SETTINGS, yr = new Date().getFullYear();
  $("app").innerHTML = `<div class="crumb"><a href="#">Quotes</a> / Settings</div><div class="top"><div><h1>Quote settings</h1><div class="sub">Defaults for new quotes. Existing quotes keep what they were built with.</div></div></div>
    <div class="panel" style="max-width:760px"><div class="g g3">
      <label class="f">Default margin %<input id="s-margin" value="${esc(s.margin)}"></label>
      <label class="f">Flag lines below margin %<input id="s-minMargin" value="${esc(s.minMargin)}"></label>
      <label class="f">Quote valid for (days)<input id="s-validDays" value="${esc(s.validDays)}"></label>
      <label class="f">Labour rate $/hr (customer)<input id="s-labourRate" value="${esc(s.labourRate)}"></label>
      <label class="f">Labour cost $/hr (Alpine)<input id="s-labourCost" value="${esc(s.labourCost ?? "")}" placeholder="not counted"></label>
      <label class="f">HST %<input id="s-taxRate" value="${esc(s.taxRate)}"></label></div>
      <div class="g g2" style="margin-top:.8rem">
        <label class="f">Next quote number (${yr})<input id="s-nextNumber" value="${esc(s.nextNumber)}"><span class="note">The next new quote is ${esc(fmtNumber(yr, (s.nextNumberYear || 2026) === yr ? (num(s.nextNumber) || 1) : 1))} (or higher if that's taken). Set it to one more than BuildOps' latest at cutover.</span></label>
        <label class="f">Departments (comma separated)<input id="s-departments" value="${esc((s.departments || []).join(", "))}"></label></div>
      <label class="f" style="margin-top:.8rem">HST registration number (printed on the PDF)<input id="s-hstNumber" value="${esc(s.hstNumber || "")}" placeholder="e.g. 12345 6789 RT0001"></label>
      <label class="f" style="margin-top:.8rem">Standard terms<textarea id="s-terms" rows="7">${esc(s.terms)}</textarea></label>
      <div style="margin-top:1rem;display:flex;gap:.6rem;align-items:center"><button class="btn" id="s-save">Save settings</button><span class="saved" id="s-msg" style="text-align:left"></span></div></div>`;
  $("s-save").onclick = async () => {
    const v = id => $("s-" + id).value;
    const next = { margin: num(v("margin")) ?? DEFAULTS.margin, minMargin: num(v("minMargin")) ?? DEFAULTS.minMargin, validDays: num(v("validDays")) ?? 30,
      labourRate: num(v("labourRate")) ?? DEFAULTS.labourRate, labourCost: num(v("labourCost")), taxRate: num(v("taxRate")) ?? 13,
      nextNumber: num(v("nextNumber")) ?? DEFAULTS.nextNumber, nextNumberYear: yr,
      departments: v("departments").split(",").map(x => x.trim()).filter(Boolean),
      hstNumber: v("hstNumber").trim(), terms: v("terms"), updatedAt: new Date().toISOString(), updatedBy: SESSION.email };
    try { await setDoc(doc(db, "quotes_meta", "settings"), next); SETTINGS = { ...DEFAULTS, ...next }; $("s-msg").textContent = "Saved."; }
    catch (e) { $("s-msg").textContent = "Couldn't save (" + (e.code || e.message) + ")."; }
  };
}

// ── Start ──
(async () => {
  const user = await currentUser();
  if (!user) { location.href = "index.html"; return; }
  await loadSettings();
  route();
})();

// Test hook (headless checks of the maths and the import mapping).
window.__quotes = { linePrice, lineMargin, totals, parseCsv, importRows, fmtNumber };
