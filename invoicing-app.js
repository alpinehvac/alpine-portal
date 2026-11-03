// ── Alpine HVAC Internal Portal — Operations > Invoicing ─────────────
// See the comment at the top of invoicing.html for the data sources.
//
// How an invoice moves:
//   to invoice → queued (Ready for BuildOps) → drafted (Claude built the Draft in BuildOps) → in QuickBooks
// QuickBooks is the record of what was actually sent: Clarissa enters an invoice there once it has gone out, under the
// same number as BuildOps. BuildOps can't tell us: nearly every invoice stays "Draft" there even after it is sent.
import { doc, getDoc, setDoc, collection, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";
import { db, currentUser } from "./ap-firebase.js";

/* ---------- helpers ---------- */
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const parseD = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ""); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
const fmtD = s => { const d = parseD(s); return d ? d.toLocaleDateString("en-CA", { month: "short", day: "numeric", year: d.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined }) : "—"; };
const money = n => n == null || isNaN(n) ? "—" : (n < 0 ? "−$" : "$") + Math.abs(Math.round(n)).toLocaleString("en-CA");
const money2 = n => n == null || isNaN(n) ? "—" : (n < 0 ? "−$" : "$") + Math.abs(n).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const daysSince = s => { const d = parseD(s); return d ? Math.round((Date.now() - d) / 86400000) : null; };
const safeId = id => String(id).replace(/\//g, "_");
const HST = 0.13;
const FROM = "contact@alpinehvac.ca", CC = "admin@alpinehvac.ca";
const ME = (() => { const s = typeof apGetSession === "function" ? apGetSession() : null; return ((s && s.name) || "").split(" ")[0] || "Someone"; })();
const nowIso = () => new Date().toISOString();

/* ---------- state ---------- */
let D = null, BOARD = {}, REC = {}, SWEEP = {}, USER = null;
let TAB = "todo", BUCKET = "all";
let OPEN = null, DET = null, COST = null; // the job open in the review view
const BUCKETS = { complete: "Marked complete", service: "Service / T&M", progress: "Progress billing", sa: "Service agreements", flag: "Possibly missed" };
const BTAG = { complete: "green", service: "teal", progress: "purple", sa: "teal", flag: "amber" };

/* ---------- the queue ---------- */
const FULL = /fully invoiced|no charge|closed/i, NOBILL = /do not invoice/i;

/* Which bucket a board job belongs in, or null if nothing to bill. Exported on window for the daily sweep and the test. */
function bucketOf(j) {
  const S = BOARD[j.id] || {};
  if (S.removed || NOBILL.test(j.billingStatus || "") || FULL.test(j.billingStatus || "") || S.invoiced) return null;
  const left = j.quoted > 0 ? j.quoted - (j.billed || 0) : null;
  if (left != null && left < 1) return null; // billed to the quote: nothing left, whatever the BuildOps tag says
  if (S.stage === "completed" || j.stage === "completed" || /complete/i.test(j.status || "") || /ready to invoice/i.test(j.billingStatus || "")) return "complete";
  if (j.kind === "Project" || j.pipeline === true) {
    if (!(j.quoted > 0) || !(j.budgetHrs > 0)) return null;
    const earned = Math.min((j.actualHrs || 0) / j.budgetHrs, 1) * j.quoted;
    return earned - (j.billed || 0) > 500 ? "progress" : null;
  }
  const allDone = (j.visitsDone || 0) > 0 && j.visitsDone >= (j.visitsTotal || 0) && !j.nextVisit;
  if (!allDone) return null;
  return /site walk|estimate|warranty/i.test(j.type || "") ? "flag" : "service";
}

function itemFromJob(j, bucket) {
  const left = j.quoted > 0 ? j.quoted - (j.billed || 0) : null;
  const earned = bucket === "progress" ? Math.min((j.actualHrs || 0) / j.budgetHrs, 1) * j.quoted - (j.billed || 0) : null;
  const sw = (SWEEP.items || {})[j.id] || {};
  const why = sw.why || {
    complete: BOARD[j.id] && BOARD[j.id].stage === "completed" ? `Marked complete by ${BOARD[j.id].stageBy || "the team"}` : /ready to invoice/i.test(j.billingStatus || "") ? "BuildOps: Ready To Invoice" : "Complete in BuildOps, not fully invoiced",
    service: `All ${j.visitsDone} visit${j.visitsDone === 1 ? "" : "s"} done, nothing billed`,
    progress: `About ${money(earned)} earned past what's billed (hours used × quote)`,
    flag: `${j.type || "Job"} with visits done and no invoice. Billable?`,
  }[bucket];
  return { id: j.id, job: j, bucket, customer: (j.customer || "").replace(/^\*/, ""), property: j.property || "", title: j.title || "", po: j.po || "", type: j.type || "", last: j.lastVisit || j.completed || null, left, est: bucket === "progress" ? earned : left, why, url: j.url, hours: j.actualHrs };
}

/* Everything with a record or a reason to be here. */
function allItems() {
  const out = new Map();
  (D ? D.jobs || [] : []).forEach(j => { const b = bucketOf(j); if (b) out.set(j.id, itemFromJob(j, b)); });
  // Service agreement visits and anything else the daily sweep found.
  (SWEEP.extra || []).forEach(x => { if (!out.has(x.id)) out.set(x.id, { bucket: x.bucket || "flag", customer: "", property: "", title: "", po: "", type: "", last: null, left: null, est: null, why: "", ...x }); });
  // Anything already in progress stays visible even if the board has moved on.
  Object.entries(REC).forEach(([id, r]) => {
    if (out.has(id) || !r.state || r.state === "new") return;
    const j = D && (D.jobs || []).find(x => x.id === id);
    out.set(id, j ? itemFromJob(j, "complete") : { id, bucket: "complete", customer: r.customer || id, property: r.property || "", title: "", po: r.po || "", type: "", last: null, left: null, est: r.amount || null, why: "" });
  });
  return [...out.values()].map(it => ({ ...it, rec: REC[it.id] || {}, st: stateOf(it.id) }));
}

function qbOf(no) { return no ? (SWEEP.qb || {})[String(no).replace(/^INV-/i, "")] : null; }
function stateOf(id) {
  const r = REC[id] || {};
  if (r.state === "skip") return "skip";
  if (r.invNo && qbOf(r.invNo)) return "done";
  return r.state === "queued" || r.state === "drafted" ? r.state : "todo";
}

/* ---------- list view ---------- */
function renderList() {
  OPEN = null;
  const items = allItems();
  const by = st => items.filter(i => i.st === st);
  const todo = by("todo"), queued = by("queued"), drafted = by("drafted");
  const known = todo.reduce((s, i) => s + (i.est || 0), 0), unknown = todo.filter(i => i.est == null).length;
  const oldest = todo.map(i => daysSince(i.last)).filter(n => n != null).sort((a, b) => b - a)[0];
  const nq = (SWEEP.notInQB || []).length;
  const asOf = SWEEP.asOf || (D && D.asOf);
  const TABS = [["todo", "To invoice", todo.length], ["queued", "Queued for BuildOps", queued.length], ["drafted", "In BuildOps, not sent", drafted.length], ["recon", "Not in QuickBooks", nq], ["done", "Done", by("done").length], ["skip", "Not invoicing", by("skip").length]];
  const list = TAB === "recon" ? [] : by(TAB).filter(i => TAB !== "todo" || BUCKET === "all" || i.bucket === BUCKET)
    .sort((a, b) => (TAB === "todo" ? (parseD(a.last) || 0) - (parseD(b.last) || 0) : (b.rec.stateAt || "").localeCompare(a.rec.stateAt || "")));
  const counts = {}; todo.forEach(i => counts[i.bucket] = (counts[i.bucket] || 0) + 1);

  $("view").innerHTML = `
  <div class="head"><div><h1>Invoicing</h1><p class="sub">Work ready to bill, from BuildOps, Outlook and QuickBooks. Swept daily${asOf ? ` · as of <b>${esc(fmtD(asOf))}</b>` : ""}. Marked-complete jobs move here right away.</p></div>
    <div class="actions"><button class="btn primary" id="cmd" ${queued.length ? "" : "disabled"}>Copy Claude command (${queued.length})</button></div></div>
  <div class="kpis">
    <div class="kpi"><div class="k-label">To invoice</div><div class="k-value">${todo.length}</div><div class="k-sub">${money(known)} known${unknown ? ` + ${unknown} to price` : ""}</div></div>
    <div class="kpi"><div class="k-label">Oldest waiting</div><div class="k-value ${oldest > 30 ? "bad" : ""}">${oldest != null ? oldest + " d" : "—"}</div><div class="k-sub">since the last work</div></div>
    <div class="kpi"><div class="k-label">Queued for BuildOps</div><div class="k-value">${queued.length}</div><div class="k-sub">reviewed, waiting on Claude</div></div>
    <div class="kpi"><div class="k-label">In BuildOps, not sent</div><div class="k-value">${drafted.length}</div><div class="k-sub">Draft built, not in QuickBooks yet</div></div>
    <div class="kpi"><div class="k-label">Not in QuickBooks</div><div class="k-value ${nq ? "bad" : ""}">${nq}</div><div class="k-sub">BuildOps invoices with no match</div></div>
  </div>
  <div class="tabs">${TABS.map(([k, l, n]) => `<button data-tab="${k}" class="${TAB === k ? "on" : ""}">${l}<span class="n">${n}</span></button>`).join("")}</div>
  ${TAB === "todo" ? `<div class="chips"><button data-b="all" class="${BUCKET === "all" ? "on" : ""}">All ${todo.length}</button>${Object.keys(BUCKETS).filter(k => counts[k]).map(k => `<button data-b="${k}" class="${BUCKET === k ? "on" : ""}">${BUCKETS[k]} ${counts[k]}</button>`).join("")}</div>` : ""}
  ${TAB === "recon" ? reconTable() : listTable(list)}`;

  document.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { TAB = b.dataset.tab; renderList(); });
  document.querySelectorAll("[data-b]").forEach(b => b.onclick = () => { BUCKET = b.dataset.b; renderList(); });
  document.querySelectorAll("tr.go").forEach(tr => tr.onclick = e => { if (!e.target.closest("a")) location.hash = encodeURIComponent(tr.dataset.id); });
  const c = $("cmd"); if (c) c.onclick = () => copy(claudeCommand(queued.length), c);
}

function listTable(list) {
  if (!list.length) return `<div class="table-wrap"><div class="empty">${TAB === "todo" ? "Nothing waiting to be invoiced." : "Nothing here."}</div></div>`;
  return `<div class="table-wrap"><table><thead><tr><th>Customer / site</th><th>Job</th><th>Why it's here</th><th>Last work</th><th class="num">To bill</th><th></th></tr></thead><tbody>${list.map(i => {
    const age = daysSince(i.last), r = i.rec;
    const status = i.st === "queued" ? `<span class="tag amber">Queued ${esc(r.stateBy || "")}</span>` : i.st === "drafted" ? `<span class="tag teal">${esc(r.invNo || "Draft")}</span>` : i.st === "done" ? `<span class="tag green">In QuickBooks</span>` : i.st === "skip" ? `<span class="tag grey">${esc(r.skipReason || "Not invoicing")}</span>` : r.updatedBy ? `<span class="tag grey">Started</span>` : "";
    return `<tr class="go" data-id="${esc(i.id)}"><td>${esc(i.customer)}<small>${esc(i.property)}</small></td>
      <td>${/^flag-/.test(i.id) ? "No job yet" : `<a href="job.html?id=${encodeURIComponent(i.id)}">${esc(i.id)}</a>`}${i.po ? `<small>PO ${esc(i.po)}</small>` : ""}${i.type ? `<small>${esc(i.type)}</small>` : ""}</td>
      <td><span class="tag ${BTAG[i.bucket]}">${BUCKETS[i.bucket]}</span><small style="margin-top:3px">${esc(i.why)}</small></td>
      <td>${fmtD(i.last)}${age != null ? `<small style="${age > 30 ? "color:var(--red)" : ""}">${age} days ago</small>` : ""}</td>
      <td class="num">${r.amount ? money(r.amount) : i.est != null ? money(i.est) : `<span class="note">${i.job ? `T&amp;M${i.hours ? ` · ${Math.round(i.hours * 10) / 10} h` : ""}` : "To price"}</span>`}${i.left != null && i.bucket === "progress" ? `<small>${money(i.left)} left on quote</small>` : ""}</td>
      <td>${status}</td></tr>`;
  }).join("")}</tbody></table></div>`;
}

function reconTable() {
  const rows = SWEEP.notInQB || [], diff = SWEEP.amountDiff || [];
  return `<p class="note" style="margin-bottom:.7rem">Non-void BuildOps invoices from the last 120 days with no matching number in QuickBooks. Either never sent, or sent and not entered yet. Contract invoices (C-numbers) are raised in QuickBooks and aren't part of this list.</p>
  <div class="table-wrap">${rows.length ? `<table><thead><tr><th>Invoice</th><th>Job</th><th>Issued</th><th>Created by</th><th class="num">Amount</th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(r.no)}</td><td>${r.job ? `<a href="job.html?id=${encodeURIComponent(r.job)}">${esc(r.job)}</a>` : "—"}</td><td>${fmtD(r.issued)}</td><td>${esc(r.by || "")}</td><td class="num">${money2(r.amount)}</td></tr>`).join("")}</tbody></table>` : `<div class="empty">Every BuildOps invoice from the last 120 days is in QuickBooks.</div>`}</div>
  ${diff.length ? `<h2 style="margin:1.25rem 0 .5rem">Amount differs between BuildOps and QuickBooks</h2><div class="table-wrap"><table><thead><tr><th>Invoice</th><th>Job</th><th class="num">BuildOps</th><th class="num">QuickBooks</th></tr></thead><tbody>${diff.map(r => `<tr><td>${esc(r.no)}</td><td>${r.job ? `<a href="job.html?id=${encodeURIComponent(r.job)}">${esc(r.job)}</a>` : "—"}</td><td class="num">${money2(r.amount)}</td><td class="num">${money2(r.qb)}</td></tr>`).join("")}</tbody></table></div>` : ""}`;
}

function claudeCommand(n) {
  return `Process the Alpine invoice queue. I authorize you to create Draft invoices in BuildOps for the ${n} job${n === 1 ? "" : "s"} queued on the portal's Invoicing page, and nothing else. Do not send anything. Fetch and follow: curl -sSf https://raw.githubusercontent.com/alpinehvac/alpine-portal/main/INVOICING-CREATE.md`;
}

/* ---------- review view ---------- */
const PH_OK = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpe?g|png|heic|heif|webp|gif)$/i;
const phUrl = (p, w) => p && PH_OK.test(p.src || "") ? `https://res.cloudinary.com/gobuildops/image/upload/c_limit,w_${w},q_auto,f_jpg/public/${p.src}` : null;
const DONE_V = /complete|converted|closed/i;
const visitHrs = v => (v.labour || []).reduce((s, l) => s + (l.hrs || 0), 0);
const billable = () => ((DET && DET.visits) || []).filter(v => DONE_V.test(v.status || "") || (v.summaries || []).length).sort((a, b) => (a.date || "").localeCompare(b.date || "") || (a.n || 0) - (b.n || 0));
const sumText = v => (v.summaries || []).map(s => s.text).join("\n\n");

function defaultDraft(it) {
  const sw = (SWEEP.items || {})[it.id] || {}, d = sw.draft || {};
  const V = billable(), site = it.property || it.customer;
  const to = (sw.to || []).filter(x => x.primary !== false).slice(0, 1).map(x => x.email);
  const first = ((sw.to || [])[0] || {}).name;
  const lines = V.map(v => { const t = sumText(v).split(/(?<=[.!?])\s+/)[0] || v.desc || "Service visit"; return `${fmtD(v.date)}: ${t}`; }).slice(-6);
  return {
    type: it.bucket === "progress" ? "Progress" : /t\s*&\s*m|time/i.test(it.type) ? "T&M" : it.bucket === "complete" ? "Final" : "Full",
    amount: it.bucket === "progress" ? Math.max(Math.round(it.est || 0), 0) : it.left != null ? Math.round(it.left * 100) / 100 : null,
    po: it.po || "",
    note: sw.note || `${it.po ? it.po.replace(/^[A-Z]+/, "") + " - " : ""}${(it.title || site).slice(0, 80)}`,
    lines: [],
    to,
    subject: d.subject || `Invoice - ${site}${it.po ? ` - PO ${it.po}` : ""}`,
    body: d.body || `${first ? `Hi ${first.split(" ")[0]},\n\n` : ""}Please find attached our invoice for ${site}${it.title ? `: ${it.title.slice(0, 80)}` : ""}.\n\n${lines.length ? `Work completed:\n${lines.join("\n")}\n\n` : ""}The job report with visit summaries and photos is attached. Let us know if you have any questions.`,
    visits: V.map(v => v.id),
    opts: { hours: /t\s*&\s*m|time/i.test(it.type), mats: true, recs: true, sign: false, photos: true },
  };
}

let FORM = null, ITEM = null, saveTimer = null, dirty = {};
function setSave(t, err) { const s = $("save"); if (s) { s.textContent = t; s.className = "save" + (err ? " err" : ""); } }

function queueSave(patch) {
  Object.assign(FORM, patch); Object.assign(dirty, patch);
  setSave("Saving…");
  clearTimeout(saveTimer); saveTimer = setTimeout(flush, 600);
}
async function flush() {
  clearTimeout(saveTimer);
  const p = dirty; dirty = {};
  if (!Object.keys(p).length || !OPEN) return true;
  return write(OPEN, p);
}
async function write(id, patch) {
  try {
    await setDoc(doc(db, "invoicing_data", safeId(id)), { ...patch, jobId: id, customer: (ITEM && ITEM.customer) || patch.customer || "", property: (ITEM && ITEM.property) || patch.property || "", updatedAt: serverTimestamp(), updatedBy: USER.email }, { merge: true });
    setSave("Saved · shared with Jake, Mike and Cole");
    return true;
  } catch (e) { setSave("NOT SAVED (" + (e.code || e.message) + "). Copy your edits and refresh.", true); return false; }
}

async function openItem(id) {
  OPEN = id; DET = null; COST = null; dirty = {};
  $("view").innerHTML = '<p class="note">Loading job…</p>';
  try {
    const [a, b] = await Promise.all([getDoc(doc(db, "ops_job_detail", safeId(id))), getDoc(doc(db, "ops_job_costs", safeId(id)))]);
    if (a.exists()) DET = JSON.parse(a.data().json);
    if (b.exists()) COST = JSON.parse(b.data().json);
  } catch (e) { show("Job details couldn't load (" + (e.code || e.message) + ")."); }
  if (OPEN !== id) return;
  ITEM = allItems().find(i => i.id === id) || (() => { const j = D && (D.jobs || []).find(x => x.id === id); return j ? { ...itemFromJob(j, "complete"), rec: REC[id] || {} } : { id, bucket: "flag", customer: (DET && DET.customer) || id, property: (DET && DET.property) || "", title: "", po: (DET && DET.po) || "", type: (DET && DET.type) || "", why: "", rec: REC[id] || {} }; })();
  if (DET) { ITEM.customer = ITEM.customer || (DET.customer || "").replace(/^\*/, ""); ITEM.property = ITEM.property || DET.property || ""; ITEM.po = ITEM.po || DET.po || ""; ITEM.type = ITEM.type || DET.type || ""; }
  FORM = { ...defaultDraft(ITEM), ...stripMeta(REC[id] || {}) };
  renderReview();
}
/* Autosave sends only what changed, but the queue and the report need the whole reviewed draft, defaults included. */
const DRAFT_KEYS = ["type", "amount", "po", "note", "lines", "to", "subject", "body", "visits", "opts", "sumEdits", "phOff", "claudeNote"];
const fullDraft = () => { const o = {}; DRAFT_KEYS.forEach(k => { if (FORM[k] !== undefined) o[k] = FORM[k]; }); return o; };
const stripMeta = r => { const { updatedAt, updatedBy, jobId, customer, property, ...x } = r; return x; };

function renderReview() {
  const it = ITEM, F = FORM, st = stateOf(it.id), sw = (SWEEP.items || {})[it.id] || {};
  const j = it.job || {}, V = billable(), locked = st === "queued" || st === "drafted" || st === "done";
  const inv = (COST && COST.invoices) || [], qbi = (COST && COST.qbInvoices) || [], bills = (COST && COST.bills) || [], em = ((COST && COST.emails) || []).slice(0, 6);
  const billed = j.billed != null ? j.billed : (COST && COST.billedQB);
  const amt = +F.amount || 0;
  const hrs = V.filter(v => (F.visits || []).includes(v.id)).reduce((s, v) => s + visitHrs(v), 0);
  const flags = [...(sw.flags || [])];
  if (!it.po) flags.push("No PO on this job. Confirm with the customer whether the invoice needs one.");
  if (it.left != null && amt > it.left + 1) flags.push(`Amount is ${money(amt - it.left)} over what's left on the quote. Check there's a change order.`);
  const ppl = sw.to || [];
  const extra = (F.to || []).filter(e => !ppl.some(p => p.email === e));

  $("view").innerHTML = `
  <div class="crumb"><a id="back">Invoicing</a> · ${esc(it.id)}</div>
  <div class="head"><div><h1>${esc(it.customer)}</h1>
    <p class="sub"><b>${esc(it.id)}</b>${it.po ? ` · PO <b>${esc(it.po)}</b>` : ""}${it.type ? ` · ${esc(it.type)}` : ""}${it.title ? ` · ${esc(it.title.slice(0, 90))}` : ""}</p>
    <p class="sub">${esc(it.property)}</p></div>
    <div class="actions"><a class="btn" href="job.html?id=${encodeURIComponent(it.id)}">Job page</a>${(DET && DET.reportUrl) ? `<a class="btn" href="${esc(DET.reportUrl)}" target="_blank" rel="noopener">BuildOps report ↗</a>` : ""}${(it.url || (DET && DET.url)) ? `<a class="btn" href="${esc(it.url || DET.url)}" target="_blank" rel="noopener">BuildOps ↗</a>` : ""}</div></div>
  ${flags.map(f => `<div class="flag">${esc(f)}</div>`).join("")}
  ${st === "queued" ? `<div class="banner info">Queued by ${esc(F.stateBy || "")}. Waiting for Claude to build the Draft in BuildOps. Take it back to change anything.</div>` : ""}
  ${st === "drafted" ? `<div class="banner info">${esc(F.invNo || "Draft")} built in BuildOps${F.invTotal ? ` for ${money2(F.invTotal)}` : ""}. Review it, send it, and it moves to Done when ${esc(F.invNo || "it")} shows up in QuickBooks.${F.invUrl ? ` <a href="${esc(F.invUrl)}" target="_blank" rel="noopener"><b>Open in BuildOps ↗</b></a>` : ""}</div>` : ""}
  ${st === "done" ? `<div class="banner info">In QuickBooks as ${esc((qbOf(F.invNo) || {}).doc)} · ${money2((qbOf(F.invNo) || {}).total)} · ${(qbOf(F.invNo) || {}).balance === 0 ? "paid" : "open with Clarissa"}.</div>` : ""}
  ${F.claudeError ? `<div class="banner">Claude couldn't build this one: ${esc(F.claudeError)}</div>` : ""}
  <div class="grid"><div>
    <section class="panel"><h2>Visits and job report<span class="actions"><button class="btn primary" id="preview" type="button">Preview report</button></span></h2>
      <p class="note">Tick what goes in the customer report. Edits to a summary change the report only, not BuildOps.</p>
      <div class="opts">${[["hours", "Hours on site"], ["mats", "Materials"], ["recs", "Recommendations"], ["photos", "Photos"], ["sign", "Signature lines"]].map(([k, l]) => `<label class="chk"><input type="checkbox" data-opt="${k}" ${(F.opts || {})[k] ? "checked" : ""}> ${l}</label>`).join("")}</div>
      ${V.length ? V.map(v => visitRow(v)).join("") : '<div class="empty">No visit reports yet. The daily refresh adds them.</div>'}
    </section>
    <section class="panel"><h2>Billing so far</h2>
      <div class="row2 mini"><div>Quoted <b>${money(j.quoted)}</b> · Billed <b>${money(billed)}</b>${it.left != null ? ` · Left <b>${money(it.left)}</b>` : ""}</div><div>Hours <b>${Math.round((j.actualHrs || 0) * 10) / 10}</b>${j.budgetHrs ? ` of ${j.budgetHrs}` : ""} · Supplier bills <b>${money(bills.reduce((s, x) => s + (x.amount || 0), 0))}</b></div></div>
      ${inv.length || qbi.length ? `<table class="mini" style="margin-top:.5rem"><thead><tr><th>Invoice</th><th>Issued</th><th>QuickBooks</th><th class="num">Amount</th></tr></thead><tbody>${mergeInv(inv, qbi).map(i => `<tr><td>${esc(i.no)}</td><td>${fmtD(i.issued)}</td><td>${i.qb ? (i.qb.balance === 0 ? '<span class="tag green">Paid</span>' : `<span class="tag amber">${money2(i.qb.balance)} open</span>`) : '<span class="tag red">Not in QuickBooks</span>'}</td><td class="num">${money2(i.amount ?? (i.qb && i.qb.total))}</td></tr>`).join("")}</tbody></table>` : '<p class="note" style="margin-top:.4rem">No invoices on this job yet.</p>'}
    </section>
    ${em.length ? `<section class="panel"><h2>Recent emails</h2><table class="mini"><tbody>${em.map(e => `<tr><td style="white-space:nowrap">${fmtD(e.date)}</td><td>${e.link ? `<a href="${esc(e.link)}" target="_blank" rel="noopener">${esc(e.subject || "(no subject)")}</a>` : esc(e.subject || "")}<small>${esc(e.from || "")}${e.summary ? " · " + esc(e.summary) : ""}</small></td></tr>`).join("")}</tbody></table></section>` : ""}
  </div>
  <div class="side">
    <section class="panel"><h2>Invoice</h2>
      <div class="row2"><div><label class="lab" for="f-type">Type</label><select class="in" id="f-type" ${locked ? "disabled" : ""}>${["Full", "Progress", "Final", "T&M"].map(t => `<option ${F.type === t ? "selected" : ""}>${t}</option>`).join("")}</select></div>
        <div><label class="lab" for="f-po">PO</label><input class="in" id="f-po" value="${esc(F.po || "")}" ${locked ? "disabled" : ""}></div></div>
      <label class="lab" for="f-amt">Amount before HST${F.type === "T&M" ? " (leave blank: BuildOps prices it from the pricebook)" : ""}</label>
      <input class="in" id="f-amt" inputmode="decimal" value="${F.amount ?? ""}" ${locked ? "disabled" : ""}>
      <div class="totals" id="totals"></div>
      <label class="lab" for="f-note">Invoice note (shows in BuildOps and QuickBooks)</label>
      <textarea class="in" id="f-note" rows="2" ${locked ? "disabled" : ""}>${esc(F.note || "")}</textarea>
      <label class="lab">Line items for Claude (optional)${hrs ? ` · ${Math.round(hrs * 10) / 10} h on the ticked visits` : ""}</label>
      <div id="lines"></div>
      ${locked ? "" : '<button class="btn ghost" id="add-line" type="button">+ Add line</button>'}
      <label class="lab" for="f-claude">Anything else Claude should know</label>
      <textarea class="in" id="f-claude" rows="2" placeholder="e.g. Bill the balance after the deposit on INV-20261142" ${locked ? "disabled" : ""}>${esc(F.claudeNote || "")}</textarea>
      <div class="foot" id="acts"></div>
      <div class="save" id="save"></div>
    </section>
    <section class="panel"><h2>Email</h2>
      <p class="note">From <b>${FROM}</b> · CC <b>${CC}</b>, always. Send from BuildOps or Outlook, then attach the invoice and report PDFs.</p>
      <label class="lab">To</label>
      <div class="who">${ppl.map(p => `<label title="${esc(p.src || "")}"><input type="checkbox" data-to="${esc(p.email)}" ${(F.to || []).includes(p.email) ? "checked" : ""}>${esc(p.name || p.email)}${p.role ? ` · ${esc(p.role)}` : ""} <a href="mailto:${esc(p.email)}?cc=${CC}">${esc(p.email)}</a></label>`).join("") || '<span class="note">No contacts found yet. The daily sweep fills these in.</span>'}</div>
      <input class="in" id="f-to-x" placeholder="Other addresses, separated by commas" value="${esc(extra.join(", "))}">
      <label class="lab" for="f-subj">Subject</label><input class="in" id="f-subj" value="${esc(F.subject || "")}">
      <label class="lab" for="f-body">Message</label><textarea class="in" id="f-body" rows="9">${esc(F.body || "")}</textarea>
      <div class="foot"><a class="btn primary" id="mail" href="#">Open email</a><button class="btn" id="c-to" type="button">Copy To</button><button class="btn" id="c-subj" type="button">Copy subject</button><button class="btn" id="c-body" type="button">Copy message</button></div>
      <p class="note" id="mail-note" style="margin-top:.4rem">Pick contact@ in the From field: an email link can't set it.</p>
    </section>
  </div></div>`;
  bindReview(it, st, locked);
}

function mergeInv(inv, qbi) {
  const out = inv.map(i => ({ ...i, qb: qbi.find(q => String(q.doc) === String(i.no).replace(/^INV-/i, "")) }));
  qbi.filter(q => !out.some(o => o.qb === q)).forEach(q => out.push({ no: q.doc, issued: q.date, qb: q }));
  return out;
}

function visitRow(v) {
  const F = FORM, on = (F.visits || []).includes(v.id), P = (v.photos || []).filter(p => phUrl(p, 200) && p.rep !== false), off = F.phOff || [];
  const edit = (F.sumEdits || {})[v.id];
  return `<div class="visit ${on ? "" : "off"}"><div class="vh"><input type="checkbox" data-v="${esc(v.id)}" ${on ? "checked" : ""} aria-label="Include this visit">
    <div>${esc(v.desc || "Visit")}<small>${fmtD(v.date)} · ${esc([v.tech, ...(v.others || [])].filter(Boolean).join(", "))} · ${Math.round(visitHrs(v) * 10) / 10} h${(v.photos || []).length ? ` · ${(v.photos || []).length} photo${v.photos.length === 1 ? "" : "s"}` : ""}</small></div></div>
    <div class="vbody"><textarea class="in" rows="3" data-sum="${esc(v.id)}" aria-label="Visit summary">${esc(edit != null ? edit : sumText(v))}</textarea>
    ${(v.recs || []).length ? `<p class="note" style="margin-top:.3rem">Recommendations: ${v.recs.map(r => esc(r.title || r.asset || "")).filter(Boolean).join("; ")}</p>` : ""}
    ${P.length ? `<div class="ph-grid">${P.slice(0, 12).map(p => `<label class="ph ${off.includes(p.src) ? "off" : ""}"><img loading="lazy" src="${esc(phUrl(p, 220))}" alt="${esc(p.comment || "Visit photo")}"><input type="checkbox" data-ph="${esc(p.src)}" ${off.includes(p.src) ? "" : "checked"} aria-label="Include photo"></label>`).join("")}</div>` : ""}</div></div>`;
}

function bindReview(it, st, locked) {
  const F = FORM;
  const back = () => { flush(); location.hash = ""; };
  $("back").onclick = back;
  const bind = (id, key, fn) => { const el = $(id); if (el) el.oninput = () => queueSave({ [key]: fn ? fn(el.value) : el.value }); };
  bind("f-type", "type"); bind("f-po", "po"); bind("f-note", "note"); bind("f-claude", "claudeNote"); bind("f-subj", "subject"); bind("f-body", "body");
  $("f-type").onchange = () => { queueSave({ type: $("f-type").value }); drawTotals(); };
  $("f-amt").oninput = () => { const v = $("f-amt").value.replace(/[$,\s]/g, ""); queueSave({ amount: v === "" || isNaN(+v) ? null : +v }); drawTotals(); };
  const toX = () => { const ticked = [...document.querySelectorAll("[data-to]:checked")].map(c => c.dataset.to), more = $("f-to-x").value.split(/[,;\s]+/).map(s => s.trim()).filter(s => /@/.test(s)); queueSave({ to: [...new Set([...ticked, ...more])] }); };
  document.querySelectorAll("[data-to]").forEach(c => c.onchange = toX); $("f-to-x").oninput = toX;
  document.querySelectorAll("[data-opt]").forEach(c => c.onchange = () => queueSave({ opts: { ...(F.opts || {}), [c.dataset.opt]: c.checked } }));
  document.querySelectorAll("[data-v]").forEach(c => c.onchange = () => {
    const ids = new Set(F.visits || []); c.checked ? ids.add(c.dataset.v) : ids.delete(c.dataset.v);
    queueSave({ visits: [...ids] }); c.closest(".visit").classList.toggle("off", !c.checked);
  });
  document.querySelectorAll("[data-sum]").forEach(t => t.oninput = () => queueSave({ sumEdits: { ...(F.sumEdits || {}), [t.dataset.sum]: t.value } }));
  document.querySelectorAll("[data-ph]").forEach(c => c.onchange = () => {
    const s = new Set(F.phOff || []); c.checked ? s.delete(c.dataset.ph) : s.add(c.dataset.ph);
    queueSave({ phOff: [...s] }); c.closest(".ph").classList.toggle("off", !c.checked);
  });
  drawLines(locked); drawTotals(); drawActs(it, st);
  $("preview").onclick = async () => {
    const w = window.open("about:blank", "_blank"); // opened before the save, or the browser treats it as a popup
    await flush();
    const ok = await write(OPEN, fullDraft());
    if (ok && w) w.location.href = `job.html?id=${encodeURIComponent(it.id)}&inv=1`; else if (w) w.close();
  };
  const al = $("add-line"); if (al) al.onclick = () => { FORM.lines = [...(FORM.lines || []), { desc: "", qty: "", amount: "" }]; drawLines(false); };
  const mail = $("mail");
  mail.onclick = async e => {
    e.preventDefault(); await flush();
    const to = (FORM.to || []).join(",");
    const q = t => encodeURIComponent(t || "");
    let url = `mailto:${to}?cc=${CC}&subject=${q(FORM.subject)}&body=${q(FORM.body)}`;
    if (url.length > 1900) { url = `mailto:${to}?cc=${CC}&subject=${q(FORM.subject)}`; $("mail-note").textContent = "Message too long for an email link: use Copy message and paste it in. Pick contact@ in the From field."; }
    location.href = url;
  };
  $("c-to").onclick = e => copy([...(FORM.to || [])].join("; "), e.target);
  $("c-subj").onclick = e => copy(FORM.subject, e.target);
  $("c-body").onclick = e => copy(FORM.body, e.target);
}

function drawTotals() {
  const a = +FORM.amount || 0, el = $("totals"); if (!el) return;
  el.innerHTML = a ? `<span>HST 13%</span><span>${money2(a * HST)}</span><b>Total</b><b>${money2(a * (1 + HST))}</b>` : "";
}
function drawLines(locked) {
  const el = $("lines"), L = FORM.lines || [];
  el.innerHTML = L.map((l, i) => `<div class="line"><input class="in" data-l="${i}" data-k="desc" placeholder="Description" value="${esc(l.desc)}" ${locked ? "disabled" : ""}><input class="in" data-l="${i}" data-k="qty" placeholder="Qty" value="${esc(l.qty)}" ${locked ? "disabled" : ""}><input class="in" data-l="${i}" data-k="amount" placeholder="Amount" value="${esc(l.amount)}" ${locked ? "disabled" : ""}>${locked ? "<span></span>" : `<button class="x" data-del="${i}" type="button" aria-label="Remove line">×</button>`}</div>`).join("");
  el.querySelectorAll("[data-l]").forEach(inp => inp.oninput = () => { const n = FORM.lines.map(x => ({ ...x })); n[+inp.dataset.l][inp.dataset.k] = inp.value; queueSave({ lines: n }); });
  el.querySelectorAll("[data-del]").forEach(b => b.onclick = () => { queueSave({ lines: FORM.lines.filter((_, i) => i !== +b.dataset.del) }); drawLines(false); });
}
function drawActs(it, st) {
  const el = $("acts"), set = async (patch, done) => { await flush(); Object.assign(FORM, patch); const ok = await write(OPEN, patch); if (ok && done) done(); };
  const stamp = state => ({ state, stateBy: ME, stateAt: nowIso() });
  if (st === "todo") {
    el.innerHTML = `<button class="btn primary" id="go">Ready for BuildOps</button><button class="btn ghost warn" id="skip">Not invoicing</button>`;
    $("go").onclick = () => {
      if (!(FORM.visits || []).length && !FORM.amount) { setSave("Tick at least one visit or enter an amount.", true); return; }
      if (FORM.type !== "T&M" && !FORM.amount) { setSave("Enter the amount, or set the type to T&M.", true); return; }
      set({ ...fullDraft(), ...stamp("queued"), claudeError: null, customer: it.customer, property: it.property, jobId: it.id }, () => { location.hash = ""; });
    };
    $("skip").onclick = () => {
      el.innerHTML = `<input class="in" id="why" placeholder="Why? e.g. covered by service agreement, warranty, no charge" style="flex:1 1 100%"><button class="btn primary" id="why-ok">Save</button><button class="btn ghost" id="why-no">Cancel</button>`;
      $("why").focus();
      $("why-no").onclick = () => drawActs(it, st);
      $("why-ok").onclick = () => { const w = $("why").value.trim(); if (!w) { $("why").focus(); return; } set({ ...stamp("skip"), skipReason: w }, () => { location.hash = ""; }); };
    };
  } else if (st === "queued") {
    el.innerHTML = `<button class="btn" id="undo">Take back to edit</button>`;
    $("undo").onclick = () => set(stamp("new"), () => { renderReview(); });
  } else if (st === "skip") {
    el.innerHTML = `<span class="note" style="flex:1 1 100%">Not invoicing: ${esc(FORM.skipReason || "")} · ${esc(FORM.stateBy || "")}</span><button class="btn" id="undo">Put back</button>`;
    $("undo").onclick = () => set({ ...stamp("new"), skipReason: null }, () => { renderReview(); });
  } else if (st === "drafted") {
    el.innerHTML = `<label class="lab" style="flex:1 1 100%">BuildOps invoice number</label><input class="in" id="no" value="${esc(FORM.invNo || "")}" style="flex:1"><button class="btn" id="no-ok">Save</button>`;
    $("no-ok").onclick = () => set({ invNo: $("no").value.trim() }, () => renderReview());
  } else el.innerHTML = "";
}

/* ---------- small things ---------- */
function copy(text, btn) {
  const label = btn.textContent, done = ok => { btn.textContent = ok ? "Copied ✓" : "Copy failed"; setTimeout(() => { btn.textContent = label; }, 1500); };
  if (navigator.clipboard) navigator.clipboard.writeText(text || "").then(() => done(true), () => done(false)); else done(false);
}
function show(msg, info) { $("banner").innerHTML = `<div class="banner ${info ? "info" : ""}">${esc(msg)}</div>`; }
function route() {
  const id = decodeURIComponent(location.hash.slice(1));
  if (!D) return;
  if (id) { if (id !== OPEN) openItem(id); } else { flush(); renderList(); }
}

/* ---------- used by Claude: the daily sweep (read only) and INVOICING-CREATE.md ---------- */
window.apInvoiceQueue = () => allItems().map(({ job, rec, ...i }) => ({ ...i, stateNow: i.st }));
window.apInvoiceSweep = () => ({ asOf: SWEEP.asOf || "", items: SWEEP.items || {}, extra: SWEEP.extra || [] });
window.apInvoiceQueued = () => Object.entries(REC).filter(([id]) => stateOf(id) === "queued").map(([id, r]) => ({ id, type: r.type, amount: r.amount ?? null, po: r.po || "", note: r.note || "", lines: r.lines || [], claudeNote: r.claudeNote || "", visits: r.visits || [], customer: r.customer || "", property: r.property || "", queuedBy: r.stateBy || "" }));
window.apInvoiceDrafted = async (id, res) => {
  if (!REC[id] || REC[id].state !== "queued") throw new Error(id + " is not queued");
  if (!/^INV-?\d+$/i.test(res.invNo || "")) throw new Error("invNo must look like INV-20261301");
  await setDoc(doc(db, "invoicing_data", safeId(id)), { state: "drafted", stateBy: "Claude", stateAt: nowIso(), invNo: res.invNo, invUrl: res.invUrl || "", invTotal: res.invTotal ?? null, claudeError: null, updatedAt: serverTimestamp(), updatedBy: USER.email }, { merge: true });
  return { id, saved: true };
};
window.apInvoiceFailed = async (id, why) => {
  await setDoc(doc(db, "invoicing_data", safeId(id)), { state: "new", stateBy: "Claude", stateAt: nowIso(), claudeError: String(why).slice(0, 300), updatedAt: serverTimestamp(), updatedBy: USER.email }, { merge: true });
  return { id, saved: true };
};

/* ---------- start ---------- */
const user = await currentUser();
if (!user) { sessionStorage.clear(); window.location.href = "index.html"; }
else {
  USER = user;
  const denied = e => /permission/i.test((e && (e.code || e.message)) || "");
  const redraw = () => { if (D && !OPEN && !location.hash.slice(1)) renderList(); };
  try {
    const s = await getDoc(doc(db, "ops_dashboard", "latest"));
    D = s.exists() ? JSON.parse(s.data().json) : { jobs: [] };
  } catch (e) { $("view").innerHTML = ""; show(denied(e) ? "This page is limited to Jake, Mike and Cole." : "Jobs couldn't load: " + (e.code || e.message)); }
  if (D) {
    onSnapshot(collection(db, "ops_jobs"), snap => { const m = {}; snap.forEach(d => { const x = d.data(); m[x.jobId || d.id] = x; }); BOARD = m; redraw(); }, () => show("Board changes aren't loading. Refresh the page."));
    onSnapshot(collection(db, "invoicing_data"), snap => {
      const m = {}; snap.forEach(d => {
        if (d.id === "sweep") { try { SWEEP = JSON.parse(d.data().json); } catch (e) { SWEEP = {}; } }
        else { const x = d.data(); m[x.jobId || d.id] = x; }
      });
      REC = m; if (location.hash.length > 1 && !OPEN) route(); else redraw();
    }, e => show(denied(e) ? "Invoicing data is blocked: publish the updated Firestore rules (firestore.rules in the repo)." : "Invoicing data couldn't load: " + (e.code || e.message)));
    window.addEventListener("hashchange", route);
    window.addEventListener("beforeunload", () => { flush(); });
    route();
  }
}
