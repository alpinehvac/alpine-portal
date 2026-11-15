// ── Alpine HVAC — Quotes (quotes.html) ───────────────────────────────
// Cole builds a quote: customer + property (BuildOps property list), scope of work,
// lines from the Item List (cost → price with Jake's margin formula), labour at the
// labour rate, HST, and a customer PDF. Statuses: Draft → Sent → Approved / Declined
// (a sent quote past its "valid until" date shows as Expired).
//
//   Selling price = cost ÷ (1 − margin %)        e.g. $100 cost at 35% margin → $153.85
//   Change the price instead and the margin is worked back: margin = 1 − cost ÷ price.
//
// Data (Firestore):
//   quotes/{id}             one doc per quote (lines, totals, history)
//   quotes_meta/counter     { next } for quote numbers Q-2026-0001 …
//   quotes_meta/settings    company defaults (margin, labour rate, HST, terms), owners edit
// Reads: items_data (Item List), account_data/ac_bo_lists (BuildOps property list).
// Cost, margin and profit stay inside Basecamp: the customer PDF shows prices only.

import { collection, doc, getDoc, getDocs, setDoc, deleteDoc, onSnapshot, runTransaction, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";
import { db, currentUser } from "./ap-firebase.js";

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const money = n => "$" + (Number(n) || 0).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = n => (n === null || n === undefined || !isFinite(n)) ? "–" : (Math.round(n * 10) / 10).toFixed(1) + "%";
const num = v => { const t = String(v ?? "").replace(/[$,%\s]/g, ""); return t === "" || isNaN(+t) ? null : +t; };
const ymd = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const TODAY = ymd(new Date());
const addDays = (s, n) => { const d = new Date(s + "T12:00:00"); d.setDate(d.getDate() + n); return ymd(d); };
const niceDate = s => s ? new Date(s + "T12:00:00").toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" }) : "";
const stamp = iso => { const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleDateString("en-CA", { month: "short", day: "numeric" }) + ", " + d.toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" }); };
const uid = () => Math.random().toString(36).slice(2, 10);
function toast(t) { const el = $("toast"); el.textContent = t; el.style.display = "block"; clearTimeout(toast._t); toast._t = setTimeout(() => el.style.display = "none", 3200); }

const SESSION = (typeof apGetSession === "function" && apGetSession()) || { name: "", email: "", roles: [] };
const IS_OWNER = (SESSION.roles || []).includes("owner");

// Company defaults. Placeholders until Jake confirms; owners change them on the Quote settings tab.
const DEFAULTS = {
  margin: 35,            // % applied to new lines (each line can differ)
  labourRate: 150,       // $/hr charged to the customer
  labourCost: null,      // $/hr cost to Alpine, for margin on labour; blank = not counted
  taxRate: 13,           // HST %
  validDays: 30,
  minMargin: 20,         // lines below this margin are flagged red
  hstNumber: "",
  terms: "Prices are valid for 30 days from the quote date and are subject to change after that.\n"
    + "Work is scheduled once this quote is approved in writing. Any work outside the scope above is quoted separately.\n"
    + "Equipment carries the manufacturer's warranty; Alpine HVAC warrants its workmanship for one year from completion.\n"
    + "Payment is due on completion unless other terms have been agreed in writing.",
};
const COMPANY = { name: "Alpine HVAC Service Inc.", address: "4241 Victoria Ave., Vineland, ON L0R 2E0", phone: "289-438-1175", web: "alpinehvac.ca" };

const TYPES = ["Material", "Equipment", "Labour", "Subcontractor", "Other"];
const STATUS = {
  draft:    { label: "Draft",    cls: "st-draft" },
  sent:     { label: "Sent",     cls: "st-sent" },
  approved: { label: "Approved", cls: "st-approved" },
  declined: { label: "Declined", cls: "st-declined" },
  expired:  { label: "Expired",  cls: "st-expired" },
};
// A sent quote past its valid-until date shows as Expired (it isn't stored that way, so re-sending fixes it).
const shownStatus = q => q.status === "sent" && q.validUntil && q.validUntil < TODAY ? "expired" : (q.status || "draft");

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
  subtotal = r2(subtotal);
  const tax = r2(subtotal * (Number(q.taxRate) || 0) / 100);
  const profit = r2(priceKnown - costKnown);
  return { subtotal, tax, total: r2(subtotal + tax), cost: r2(costKnown), profit, marginPct: priceKnown ? profit / priceKnown * 100 : null, unknown: r2(unknown) };
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
async function nextNumber() {
  const ref = doc(db, "quotes_meta", "counter"), yr = new Date().getFullYear();
  const n = await runTransaction(db, async tx => {
    const s = await tx.get(ref);
    const d = s.exists() ? s.data() : {};
    const next = d.year === yr ? (d.next || 1) : 1;
    tx.set(ref, { year: yr, next: next + 1 });
    return next;
  });
  return "Q-" + yr + "-" + String(n).padStart(4, "0");
}
function hist(q, action) { (q.history = q.history || []).push({ at: new Date().toISOString(), by: SESSION.email, byName: SESSION.name, action }); }

async function createQuote(from) {
  const number = await nextNumber();
  const q = from ? JSON.parse(JSON.stringify(from)) : {
    customer: "", property: "", propertyId: "", address: "", billTo: "", contactName: "", contactEmail: "", contactPhone: "", poNumber: "",
    title: "", scope: "", lines: [], showLinePrices: true, notes: "",
    margin: SETTINGS.margin, labourRate: SETTINGS.labourRate, labourCost: SETTINGS.labourCost, taxRate: SETTINGS.taxRate, terms: SETTINGS.terms,
  };
  Object.assign(q, { number, status: "draft", quoteDate: TODAY, validUntil: addDays(TODAY, SETTINGS.validDays || 30), history: [],
    createdBy: SESSION.email, createdByName: SESSION.name, createdAt: new Date().toISOString() });
  delete q.id; delete q.sentAt; delete q.approvedAt; delete q.declinedAt;
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

// ── List ──
let TAB = "open", SEARCH = "";
function renderList() {
  Q = null;
  $("app").innerHTML = `<div class="top"><div><div class="crumb">Operations</div><h1>Quotes</h1><div class="sub">Build a quote from the Item List, send the customer a PDF, and track it to approval.</div></div>
    <div style="display:flex;gap:.5rem">${IS_OWNER ? '<a class="btn ghost" href="#settings">Quote settings</a>' : ""}<button class="btn" id="new">New quote</button></div></div>
    <div class="kpis" id="kpis"></div>
    <div class="tabs" id="tabs"></div>
    <div style="margin-bottom:.8rem"><input class="search" id="q-search" placeholder="Search number, customer, property, title…" value="${esc(SEARCH)}"></div>
    <div class="panel" style="padding:.4rem .6rem"><table class="list" id="list"><tr><td class="empty">Loading…</td></tr></table></div>`;
  $("new").onclick = async () => { $("new").disabled = true; try { location.hash = "q=" + await createQuote(); } catch (e) { toast("Couldn't create the quote (" + (e.code || e.message) + ")."); $("new").disabled = false; } };
  $("q-search").oninput = e => { SEARCH = e.target.value; drawList(); };
  unsub = onSnapshot(collection(db, "quotes"), snap => { QUOTES = snap.docs.map(d => ({ id: d.id, ...d.data() })); drawList(); },
    e => { $("list").innerHTML = `<tr><td class="empty">Couldn't load quotes (${esc(e.code || e.message)}). If this is the first day, the updated database rules may not be published yet.</td></tr>`; });
}
function drawList() {
  if (!$("list")) return;
  const S = q => shownStatus(q);
  const tabs = [["open", "Open", q => ["draft", "sent", "expired"].includes(S(q))], ["draft", "Draft", q => S(q) === "draft"], ["sent", "Sent", q => S(q) === "sent"],
    ["approved", "Approved", q => S(q) === "approved"], ["declined", "Declined", q => S(q) === "declined"], ["expired", "Expired", q => S(q) === "expired"], ["all", "All", () => true]];
  $("tabs").innerHTML = tabs.map(([k, l, f]) => `<button data-t="${k}" class="${TAB === k ? "on" : ""}">${l}<small>${QUOTES.filter(f).length}</small></button>`).join("");
  $("tabs").querySelectorAll("button").forEach(b => b.onclick = () => { TAB = b.dataset.t; drawList(); });
  const month = TODAY.slice(0, 7);
  const sentOpen = QUOTES.filter(q => S(q) === "sent"), wonMonth = QUOTES.filter(q => q.status === "approved" && String(q.approvedAt || "").slice(0, 7) === month);
  const decided = QUOTES.filter(q => ["approved", "declined"].includes(q.status));
  $("kpis").innerHTML = `<div class="kpi"><b>${money(sentOpen.reduce((t, q) => t + ((q.totals || {}).subtotal || 0), 0))}</b><span>${sentOpen.length} sent, waiting on the customer</span></div>
    <div class="kpi"><b>${money(wonMonth.reduce((t, q) => t + ((q.totals || {}).subtotal || 0), 0))}</b><span>${wonMonth.length} approved this month</span></div>
    <div class="kpi"><b>${decided.length ? Math.round(decided.filter(q => q.status === "approved").length / decided.length * 100) + "%" : "–"}</b><span>won (approved ÷ decided)</span></div>`;
  const f = tabs.find(t => t[0] === TAB)[2], s = SEARCH.trim().toLowerCase();
  const rows = QUOTES.filter(f).filter(q => !s || [q.number, q.customer, q.property, q.title, q.address, q.poNumber].join(" ").toLowerCase().includes(s))
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  $("list").innerHTML = `<tr><th>Quote</th><th>Customer / property</th><th>For</th><th class="num">Before tax</th><th class="num">Margin</th><th>Status</th><th>Updated</th></tr>`
    + (rows.length ? rows.map(q => { const t = q.totals || {}, st = STATUS[S(q)];
      return `<tr class="row" data-id="${esc(q.id)}"><td><b>${esc(q.number)}</b><small>${esc(niceDate(q.quoteDate))}</small></td>
        <td>${esc(q.customer || "No customer yet")}<small>${esc(q.property || q.address || "")}</small></td><td>${esc(q.title || "")}</td>
        <td class="num">${money(t.subtotal)}</td><td class="num">${pct(t.marginPct)}</td><td><span class="tag ${st.cls}">${st.label}</span></td>
        <td>${esc(stamp(q.updatedAt))}<small>${esc((q.createdByName || "").split(" ")[0])}</small></td></tr>`; }).join("")
      : `<tr><td colspan="7" class="empty">${QUOTES.length ? "Nothing here." : "No quotes yet. Click New quote to start one."}</td></tr>`);
  $("list").querySelectorAll("tr.row").forEach(r => r.onclick = () => location.hash = "q=" + r.dataset.id);
}

// ── One quote ──
async function openQuote(id) {
  $("app").innerHTML = `<div class="empty">Loading quote…</div>`;
  try {
    const s = await getDoc(doc(db, "quotes", id));
    if (!s.exists()) { $("app").innerHTML = `<div class="empty">That quote doesn't exist. <a href="#">Back to Quotes</a></div>`; return; }
    Q = { id: s.id, ...s.data() };
  } catch (e) { $("app").innerHTML = `<div class="empty">Couldn't open the quote (${esc(e.code || e.message)}). <a href="#">Back</a></div>`; return; }
  dirty = false;
  renderQuote();
  loadProps().then(fillPropList);
}
const locked = () => ["approved", "declined"].includes(Q.status);

function renderQuote() {
  const st = STATUS[shownStatus(Q)], L = locked(), dis = L ? "disabled" : "";
  const fld = (k, label, attrs = "") => `<label class="f">${label}<input data-k="${k}" value="${esc(Q[k] ?? "")}" ${attrs} ${dis}></label>`;
  $("app").innerHTML = `<div class="crumb"><a href="#">Quotes</a> / ${esc(Q.number)}</div>
  <div class="qhead"><div><h1>${esc(Q.number)} <span class="tag ${st.cls}" style="vertical-align:middle;font-size:.8rem">${st.label}</span></h1>
    <div class="sub">${esc(Q.title || "New quote")}${Q.customer ? " · " + esc(Q.customer) : ""}</div></div>
    <div class="acts"><span class="saved" id="q-saved"></span>${statusButtons()}
      <button class="btn ghost" id="b-pdf">PDF / Print</button><button class="btn ghost" id="b-copy">Copy</button>
      ${Q.status === "draft" ? '<button class="btn danger" id="b-del">Delete</button>' : ""}</div></div>
  ${L ? `<div class="banner ${Q.status === "approved" ? "ok" : ""}">${Q.status === "approved"
      ? `Approved ${esc(stamp(Q.approvedAt))}. It's locked so the approved price can't change. Turning it into a job arrives with the job board (week of Nov 23). Use <b>Back to draft</b> only if the customer asked for changes.`
      : `Declined ${esc(stamp(Q.declinedAt))}${Q.declineReason ? ": " + esc(Q.declineReason) : ""}. Use <b>Back to draft</b> to revise and re-send, or <b>Copy</b> to start a fresh one.`}</div>` : ""}
  ${shownStatus(Q) === "expired" ? `<div class="banner">This quote passed its valid-until date (${esc(niceDate(Q.validUntil))}). Change the date and mark it sent again, or copy it to re-price.</div>` : ""}
  <div class="layout"><div>
    <div class="panel"><h2>Customer</h2>
      <div class="g g2">
        <label class="f">Customer or property <span style="opacity:.7">(type to search Alpine's property list)</span><input id="cust-pick" list="prop-list" placeholder="Start typing a customer or property…" ${dis}></label>
        <div></div>
        ${fld("customer", "Customer")}${fld("property", "Property / site")}
        ${fld("address", "Site address")}${fld("billTo", "Bill to")}
      </div>
      <div class="g g4" style="margin-top:.8rem">${fld("contactName", "Contact")}${fld("contactPhone", "Phone")}${fld("contactEmail", "Email")}${fld("poNumber", "Customer PO #")}</div>
      <datalist id="prop-list"></datalist>
    </div>
    <div class="panel"><h2>The work</h2>
      <div class="g">${fld("title", "Title (shows on the PDF)", 'placeholder="e.g. Replace RTU-2 condenser fan motor"')}
        <label class="f">Scope of work (what the customer reads)<textarea data-k="scope" rows="5" placeholder="What we'll do, what's included, what isn't." ${dis}>${esc(Q.scope || "")}</textarea></label></div>
    </div>
    <div class="panel"><h2>Lines</h2>
      <div style="overflow-x:auto"><table class="lines" id="lines"></table></div>
      ${L ? "" : `<div class="addrow"><button class="btn" id="add-item">+ From Item List</button><button class="btn ghost" id="add-lab">+ Labour</button><button class="btn ghost" id="add-line">+ Other line</button></div>
      <p class="note">Change the cost or margin and the price follows: price = cost ÷ (1 − margin%). Type a price instead and the margin is worked back. Lines under ${esc(SETTINGS.minMargin)}% margin show in red.</p>`}
    </div>
    <div class="panel"><h2>Terms on the PDF</h2><textarea data-k="terms" rows="5" ${dis}>${esc(Q.terms || "")}</textarea></div>
    <div class="panel"><h2>Internal notes</h2><textarea data-k="notes" rows="3" placeholder="Only Alpine sees these." ${dis}>${esc(Q.notes || "")}</textarea></div>
  </div>
  <div class="side">
    <div class="panel"><h2>Totals</h2><table class="totals" id="tot"></table>
      <div class="internal"><h3>Inside Alpine only</h3><table class="totals" id="tot-in"></table></div></div>
    <div class="panel"><h2>Quote details</h2><div class="g">
      <div class="g g2"><label class="f">Quote date<input type="date" data-k="quoteDate" value="${esc(Q.quoteDate || "")}" ${dis}></label><label class="f">Valid until<input type="date" data-k="validUntil" value="${esc(Q.validUntil || "")}" ${dis}></label></div>
      <div class="g g2"><label class="f">Default margin %<input data-k="margin" data-num value="${esc(Q.margin)}" ${dis}></label><label class="f">HST %<input data-k="taxRate" data-num value="${esc(Q.taxRate)}" ${dis}></label></div>
      <div class="g g2"><label class="f">Labour rate $/hr<input data-k="labourRate" data-num value="${esc(Q.labourRate)}" ${dis}></label><label class="f">Labour cost $/hr<input data-k="labourCost" data-num value="${esc(Q.labourCost ?? "")}" placeholder="not counted" ${dis}></label></div>
      <label class="f" style="display:flex;gap:.5rem;align-items:center;color:var(--white);font-size:.85rem"><input type="checkbox" data-k="showLinePrices" style="width:auto" ${Q.showLinePrices !== false ? "checked" : ""} ${dis}> Show each line's price on the PDF (off = one total)</label>
    </div></div>
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
  if (s === "sent" && !(Q.lines || []).length) { toast("Add at least one line before sending."); return; }
  if (s === "sent" && !Q.customer) { toast("Add the customer first."); return; }
  if (s === "declined") { const why = prompt("Why did they decline? (optional, e.g. price, went with another contractor)"); if (why === null) return; Q.declineReason = why.trim(); Q.declinedAt = now; }
  if (s === "approved") { if (!confirm(`Mark ${Q.number} approved for ${money(totals(Q).total)} including HST? It locks so the price can't change.`)) return; Q.approvedAt = now; }
  if (s === "sent") { Q.sentAt = now; if (Q.validUntil && Q.validUntil < TODAY) Q.validUntil = addDays(TODAY, SETTINGS.validDays || 30); }
  if (s === "draft" && before === "approved" && !confirm("Unlock this approved quote and move it back to draft?")) return;
  Q.status = s;
  hist(Q, { sent: "Marked sent", approved: "Approved", declined: "Declined" + (Q.declineReason ? " (" + Q.declineReason + ")" : ""), draft: "Back to draft" }[s]);
  dirty = true; saveNow().then(renderQuote);
}
function wireQuote() {
  $("b-pdf").onclick = printQuote;
  $("b-copy").onclick = async () => { await saveNow(); try { location.hash = "q=" + await createQuote(Q); toast("Copied to a new draft."); } catch (e) { toast("Couldn't copy (" + (e.code || e.message) + ")."); } };
  if ($("b-del")) $("b-del").onclick = async () => { if (!confirm(`Delete draft ${Q.number}? This can't be undone.`)) return; dirty = false; await deleteDoc(doc(db, "quotes", Q.id)); location.hash = ""; toast("Draft deleted."); };
  document.querySelectorAll("[data-st]").forEach(b => b.onclick = () => setStatus(b.dataset.st));
  document.querySelectorAll("#app [data-k]").forEach(el => {
    const k = el.dataset.k;
    el.addEventListener(el.type === "checkbox" || el.type === "date" ? "change" : "input", () => {
      Q[k] = el.type === "checkbox" ? el.checked : el.hasAttribute("data-num") ? num(el.value) : el.value;
      if (k === "labourRate" || k === "labourCost") (Q.lines || []).filter(l => l.type === "Labour" && l.fromRate).forEach(l => { l.price = Q.labourRate || 0; l.cost = Q.labourCost ?? null; });
      if (["margin", "taxRate", "labourRate", "labourCost"].includes(k)) { drawLines(); }
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
      : `<tr><td colspan="9" class="empty">No lines yet. Add items from the Item List, labour, or a custom line.</td></tr>`);
  $("lines").querySelectorAll("tr[data-i]").forEach(tr => {
    const l = Q.lines[+tr.dataset.i];
    tr.querySelectorAll("[data-f]").forEach(el => el.addEventListener(el.tagName === "SELECT" ? "change" : "input", () => {
      const f = el.dataset.f;
      if (f === "qty") l.qty = num(el.value) ?? 0;
      else if (f === "cost") { l.cost = num(el.value); if (l.cost !== null && !l.priceSet) { /* price follows margin */ } }
      else if (f === "margin") { l.margin = num(el.value) ?? 0; l.priceSet = false; l.fromRate = false; }
      else if (f === "price") { l.price = num(el.value) ?? 0; l.priceSet = true; l.fromRate = false; }
      else l[f] = el.value;
      if (f === "cost" && l.cost !== null && l.priceSet && !l.fromRate) { /* keep the typed price; margin is worked back */ }
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
  $("tot-in").innerHTML = `<tr><td>Cost</td><td class="num">${money(t.cost)}</td></tr><tr><td>Gross profit</td><td class="num">${money(t.profit)}</td></tr><tr><td><b>Margin</b></td><td class="num"><b>${pct(t.marginPct)}</b></td></tr>`
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
    const type = /labou?r/.test(ct) ? "Labour" : /equip/.test(ct) ? "Equipment" : /sub/.test(ct) ? "Subcontractor" : /material/.test(ct) ? "Material" : "Material";
    const cost = num(i.unitCost);
    addLine({ type, itemId: i.id, productCode: i.productCode || "", name: i.name, description: i.description || "", qty: 1, uom: i.uom || "ea",
      cost, margin: Q.margin, price: cost === null ? 0 : undefined, priceSet: cost === null });
    toast("Added " + i.name);
  });
}
$("pick-q").addEventListener("input", drawPick);
$("pick-close").onclick = () => $("pick").classList.remove("on");
$("pick").addEventListener("click", e => { if (e.target === $("pick")) $("pick").classList.remove("on"); });
document.addEventListener("keydown", e => { if (e.key === "Escape") $("pick").classList.remove("on"); });

// ── Customer PDF (browser print → Save as PDF) ──
async function printQuote() {
  await saveNow();
  const t = totals(Q), showLines = Q.showLinePrices !== false;
  const rows = (Q.lines || []).map(l => `<tr><td>${esc(l.name)}${l.description ? `<small>${esc(l.description)}</small>` : ""}</td><td class="num">${esc(l.qty)} ${esc(l.uom || "")}</td>
    ${showLines ? `<td class="num">${money(linePrice(l))}</td><td class="num">${money((Number(l.qty) || 0) * linePrice(l))}</td>` : ""}</tr>`).join("");
  $("doc").innerHTML = `<div class="band"><img src="images/alpine-logo-white.png" alt="Alpine HVAC"><div class="t"><b>QUOTE</b>${esc(Q.number)}</div></div>
    <div class="meta"><div><h4>Prepared for</h4><table>
      <tr><td><b>${esc(Q.billTo || Q.customer)}</b></td></tr>${Q.property && Q.property !== Q.customer ? `<tr><td>${esc(Q.property)}</td></tr>` : ""}
      ${Q.address ? `<tr><td>${esc(Q.address)}</td></tr>` : ""}${Q.contactName ? `<tr><td>Attn: ${esc(Q.contactName)}${Q.contactPhone ? " · " + esc(Q.contactPhone) : ""}</td></tr>` : ""}</table></div>
      <div><h4>Quote</h4><table><tr><td>Date</td><td>${esc(niceDate(Q.quoteDate))}</td></tr><tr><td>Valid until</td><td>${esc(niceDate(Q.validUntil))}</td></tr>
      ${Q.poNumber ? `<tr><td>Your PO</td><td>${esc(Q.poNumber)}</td></tr>` : ""}<tr><td>Prepared by</td><td>${esc(Q.createdByName || "")}</td></tr></table></div></div>
    ${Q.title ? `<h3>${esc(Q.title)}</h3>` : ""}${Q.scope ? `<div class="scope">${esc(Q.scope)}</div>` : ""}
    <h3>Pricing</h3><table class="items"><tr><th>Item</th><th class="num">Qty</th>${showLines ? '<th class="num">Unit price</th><th class="num">Amount</th>' : ""}</tr>${rows}</table>
    <table class="tot"><tr><td>Subtotal</td><td class="num">${money(t.subtotal)}</td></tr><tr><td>HST ${esc(Q.taxRate ?? 0)}%${SETTINGS.hstNumber ? " (" + esc(SETTINGS.hstNumber) + ")" : ""}</td><td class="num">${money(t.tax)}</td></tr><tr class="big"><td>Total</td><td class="num">${money(t.total)}</td></tr></table>
    ${Q.terms ? `<h3>Terms</h3><div class="terms">${esc(Q.terms)}</div>` : ""}
    <h3>Acceptance</h3><div style="font-size:9pt">To approve, sign below and return to Alpine HVAC, or reply to the email this quote came with.</div>
    <div class="sign"><div>Authorized signature and printed name</div><div>Date</div></div>
    <div class="foot">${esc(COMPANY.name)} · ${esc(COMPANY.address)} · ${esc(COMPANY.phone)} · ${esc(COMPANY.web)}</div>`;
  const img = $("doc").querySelector("img");
  const go = () => { const old = document.title; document.title = Q.number + " " + (Q.customer || "Quote"); window.print(); document.title = old; };
  if (img.complete) go(); else { img.onload = go; img.onerror = go; }
}

// ── Quote settings (owners) ──
async function renderSettings() {
  if (!IS_OWNER) { location.hash = ""; return; }
  await loadSettings();
  const s = SETTINGS;
  $("app").innerHTML = `<div class="crumb"><a href="#">Quotes</a> / Settings</div><div class="top"><div><h1>Quote settings</h1><div class="sub">Defaults for new quotes. Existing quotes keep what they were built with.</div></div></div>
    <div class="panel" style="max-width:760px"><div class="g g3">
      <label class="f">Default margin %<input id="s-margin" value="${esc(s.margin)}"></label>
      <label class="f">Flag lines below margin %<input id="s-minMargin" value="${esc(s.minMargin)}"></label>
      <label class="f">Quote valid for (days)<input id="s-validDays" value="${esc(s.validDays)}"></label>
      <label class="f">Labour rate $/hr (customer)<input id="s-labourRate" value="${esc(s.labourRate)}"></label>
      <label class="f">Labour cost $/hr (Alpine)<input id="s-labourCost" value="${esc(s.labourCost ?? "")}" placeholder="not counted"></label>
      <label class="f">HST %<input id="s-taxRate" value="${esc(s.taxRate)}"></label></div>
      <label class="f" style="margin-top:.8rem">HST registration number (printed on the PDF)<input id="s-hstNumber" value="${esc(s.hstNumber || "")}" placeholder="e.g. 12345 6789 RT0001"></label>
      <label class="f" style="margin-top:.8rem">Standard terms<textarea id="s-terms" rows="7">${esc(s.terms)}</textarea></label>
      <div style="margin-top:1rem;display:flex;gap:.6rem;align-items:center"><button class="btn" id="s-save">Save settings</button><span class="saved" id="s-msg" style="text-align:left"></span></div></div>`;
  $("s-save").onclick = async () => {
    const v = id => $("s-" + id).value;
    const next = { margin: num(v("margin")) ?? DEFAULTS.margin, minMargin: num(v("minMargin")) ?? DEFAULTS.minMargin, validDays: num(v("validDays")) ?? 30,
      labourRate: num(v("labourRate")) ?? DEFAULTS.labourRate, labourCost: num(v("labourCost")), taxRate: num(v("taxRate")) ?? 13,
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

// Test hook (headless checks of the margin maths).
window.__quotes = { linePrice, lineMargin, totals };
