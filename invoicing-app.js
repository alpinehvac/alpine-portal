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
const CHECK_DAYS = 14; // contract-site visits older than this stay under Possibly missed, even with parts on them
const PARTS = {}; // jobs at contract customers with parts or supplier bills: {count, bills}
const BUCKETS = { service: "Service / T&M", progress: "Progress billing", parts: "Parts only", flag: "Possibly missed" };
const BTAG = { service: "teal", progress: "purple", parts: "teal", flag: "amber" };

/* ---------- the queue ---------- */
const FULL = /fully invoiced|no charge|closed/i, NOBILL = /do not invoice/i;

/* Which bucket a board job belongs in, or null if nothing to bill. Exported on window for the daily sweep and the test. */
function bucketOf(j) {
  const S = BOARD[j.id] || {};
  if (S.removed || NOBILL.test(j.billingStatus || "") || FULL.test(j.billingStatus || "") || S.invoiced) return null;
  const left = j.quoted > 0 ? j.quoted - (j.billed || 0) : null;
  if (left != null && left < 1) return null; // billed to the quote: nothing left, whatever the BuildOps tag says
  const project = j.kind === "Project" || j.pipeline === true;
  if (isDone(j)) return project ? "progress" : "service";
  if (project) {
    if (!(j.quoted > 0) || !(j.budgetHrs > 0)) return null;
    const earned = Math.min((j.actualHrs || 0) / j.budgetHrs, 1) * j.quoted;
    return earned - (j.billed || 0) > 500 ? "progress" : null;
  }
  const allDone = (j.visitsDone || 0) > 0 && j.visitsDone >= (j.visitsTotal || 0) && !j.nextVisit;
  if (!allDone) return null;
  if (!j.po && isContract(j.customer)) return PARTS[j.id] && (daysSince(j.lastVisit) ?? 0) <= CHECK_DAYS ? "parts" : "flag";
  return /site walk|estimate|warranty/i.test(j.type || "") ? "flag" : "service";
}
const isDone = j => (BOARD[j.id] || {}).stage === "completed" || j.stage === "completed" || /complete/i.test(j.status || "") || /ready to invoice/i.test(j.billingStatus || "");

/* Customers billed by contract (QuickBooks C-numbers, raised by Clarissa). A service call with no PO for one of these is often
   covered by the contract or a monthly parts PO, so it asks a person first. */
const custKey = s => String(s || "").replace(/^\*/, "").split(/\s+c\/o\s+/i)[0].toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\b(inc|ltd|corp|corporation|limited)\b/g, "").replace(/\s+/g, " ").trim();
const isContract = name => { const k = custKey(name); return !!k && (SWEEP.contractCustomers || []).some(c => { const x = custKey(c); return x.length > 5 && (x.startsWith(k) || k.startsWith(x)); }); };

const CONTRACT_WHY = "Contract customer, no PO. Labour is usually covered by the contract. Materials bill separately unless a QuickBooks estimate covers them.";

function itemFromJob(j, bucket) {
  const left = j.quoted > 0 ? j.quoted - (j.billed || 0) : null, done = isDone(j), S = BOARD[j.id] || {};
  const earned = bucket === "progress" && !done ? Math.min((j.actualHrs || 0) / j.budgetHrs, 1) * j.quoted - (j.billed || 0) : null;
  const sw = (SWEEP.items || {})[j.id] || {}, p = PARTS[j.id];
  const doneWhy = S.stage === "completed" ? `Marked complete by ${S.stageBy || "the team"}` : /ready to invoice/i.test(j.billingStatus || "") ? "BuildOps: Ready To Invoice" : "Complete in BuildOps, not fully invoiced";
  const why = sw.why || (done ? doneWhy : {
    service: `All ${j.visitsDone} visit${j.visitsDone === 1 ? "" : "s"} done, nothing billed`,
    progress: `About ${money(earned)} earned past what's billed (hours used × quote)`,
    parts: `${CONTRACT_WHY} ${p ? `${p.count} part${p.count === 1 ? "" : "s"} or bills on this job.` : ""}`,
    flag: !j.po && isContract(j.customer) ? CONTRACT_WHY : `${j.type || "Job"} with visits done and no invoice. Billable?`,
  }[bucket]);
  return { id: j.id, job: j, bucket, done, customer: (j.customer || "").replace(/^\*/, ""), property: j.property || "", title: j.title || "", po: j.po || "", type: j.type || "", last: j.lastVisit || j.completed || null, left, est: earned != null ? earned : left, why, url: j.url, hours: j.actualHrs };
}

/* Everything with a record or a reason to be here. */
function allItems() {
  const out = new Map();
  (D ? D.jobs || [] : []).forEach(j => { const b = bucketOf(j); if (b) out.set(j.id, itemFromJob(j, b)); });
  // Anything else the daily sweep found. Service agreement billing is not on this page yet.
  (SWEEP.extra || []).filter(x => x.bucket !== "sa").forEach(x => { if (!out.has(x.id)) out.set(x.id, { bucket: "flag", customer: "", property: "", title: "", po: "", type: "", last: null, left: null, est: null, why: "", ...x }); });
  // Anything already in progress stays visible even if the board has moved on.
  Object.entries(REC).forEach(([id, r]) => {
    if (out.has(id) || !r.state || r.state === "new") return;
    const j = D && (D.jobs || []).find(x => x.id === id);
    out.set(id, j ? itemFromJob(j, j.kind === "Project" ? "progress" : "service") : { id, bucket: "service", customer: r.customer || id, property: r.property || "", title: "", po: r.po || "", type: "", last: null, left: null, est: r.amount || null, why: "" });
  });
  return [...out.values()].map(it => ({ ...it, rec: REC[it.id] || {}, st: stateOf(it.id) }));
}

function qbOf(no) { return no ? (SWEEP.qb || {})[String(no).replace(/^INV-/i, "")] : null; }
function stateOf(id) {
  const r = REC[id] || {};
  if (r.state === "skip") {
    // New work after it was marked not billable puts it back, so nothing gets missed.
    const j = D && (D.jobs || []).find(x => x.id === id);
    return j && j.lastVisit && r.stateAt && j.lastVisit > r.stateAt.slice(0, 10) ? "todo" : "skip";
  }
  if (r.invNo && qbOf(r.invNo)) return "done";
  return r.state === "queued" || r.state === "drafted" ? r.state : "todo";
}

/* ---------- board: same pipeline and job cards as Field Operations ---------- */
const OPEN_CARDS = new Set();
function card(i) {
  const j = i.job || {}, r = i.rec, age = daysSince(i.last), hrsPct = j.budgetHrs > 0 ? Math.round((j.actualHrs || 0) / j.budgetHrs * 100) : null;
  const amt = r.amount ? money(r.amount) : i.est != null ? money(i.est) : (j.actualHrs ? `${Math.round(j.actualHrs * 10) / 10} h` : "To price");
  const ctx = (BOARD[i.id] || {}).context || [];
  const tags = [
    i.done ? '<span class="tag green">Completed</span>' : "",
    i.bucket === "parts" || PARTS[i.id] ? `<span class="tag teal">${PARTS[i.id] ? PARTS[i.id].count + (PARTS[i.id].count === 1 ? " part" : " parts") : "Parts"}</span>` : "",
    age != null ? `<span class="tag ${age > 30 ? "red" : age > 14 ? "amber" : "grey"}">Last work ${fmtD(i.last)} · ${age}d</span>` : "",
    j.budgetHrs ? `<span class="tag ${hrsPct > 100 ? "red" : "grey"}">${j.actualHrs ?? 0} / ${j.budgetHrs} hrs used</span>` : "",
    i.left != null && i.bucket === "progress" ? `<span class="tag grey">${money(i.left)} left on quote</span>` : "",
    i.st === "queued" ? `<span class="tag amber">Queued by ${esc(r.stateBy || "")}</span>` : "",
    i.st === "drafted" ? `<span class="tag teal">${esc(r.invNo || "Draft")}</span>` : "",
    r.claudeError ? `<span class="tag red">Claude couldn't build this</span>` : "",
  ].join("");
  return `<details class="jc" data-card="${esc(i.id)}" ${OPEN_CARDS.has(i.id) ? "open" : ""}><summary>
    <div class="jc-top"><span class="jc-id">${isJob(i.id) ? `<a href="job.html?id=${encodeURIComponent(i.id)}" onclick="event.stopPropagation()">${esc(i.id)}</a>` : "No job yet"}${i.po ? ` · PO ${esc(i.po)}` : ""}</span><span class="jc-amt">${amt}</span></div>
    <div class="jc-cust">${esc(j.customer || i.customer)}</div><div class="jc-site">${esc(i.property)}</div>
    ${i.title ? `<div class="jc-scope">${esc(i.title)}</div>` : ""}
    ${hrsPct != null ? `<div class="pbar"><i class="${hrsPct > 100 ? "over" : hrsPct === 100 ? "full" : ""}" style="width:${Math.min(100, hrsPct)}%"></i></div>` : ""}
    <div class="jc-meta">${tags}${(i.bucket === "flag" || i.bucket === "parts") && i.st === "todo" ? `<button class="tag grey nb" type="button" data-nb="${esc(i.id)}">Not billable ✕</button>` : ""}</div><span class="chev">▾</span>
  </summary><div class="jc-body">
    <div class="jc-why">${esc(i.why)}</div>
    ${((SWEEP.items || {})[i.id] || {}).flags ? SWEEP.items[i.id].flags.map(f => `<div class="note-line">${esc(f)}</div>`).join("") : ""}
    ${ctx.length ? `<div class="jc-sec"><span>Context</span><span>${ctx.length}</span></div>${ctx.map(c => `<div class="note-line">${esc(c.text || "")}</div>`).join("")}` : ""}
    <div class="jc-act">${i.st === "todo" ? `<button class="btn ghost warn" type="button" data-nb="${esc(i.id)}">Not billable</button>` : "<span></span>"}<span class="actions">${isJob(i.id) ? `<a class="btn" href="job.html?id=${encodeURIComponent(i.id)}">Job page</a>` : ""}<button class="btn done" type="button" data-open="${esc(i.id)}">${i.st === "todo" ? "Review invoice" : "Open"}</button></span></div>
  </div></details>`;
}
const isJob = id => /^(JO\d+|SA\d+-\d+)$/.test(id);
const colHead = (title, list, sub) => `<div class="col-h"><h3>${title}<span class="n">${list.length}</span></h3><div class="tot">${money(list.reduce((s, i) => s + (i.rec.amount || i.est || 0), 0))}${sub ? `<small>${sub}</small>` : ""}</div></div>`;

function renderList() {
  OPEN = null;
  const items = allItems();
  const live = items.filter(i => i.st === "todo" || i.st === "queued" || i.st === "drafted");
  const ST = { queued: 1, drafted: 2, todo: 0 };
  const col = b => live.filter(i => i.bucket === b).sort((x, y) => ST[x.st] - ST[y.st] || (parseD(x.last) || 0) - (parseD(y.last) || 0));
  const svc = col("service"), prog = col("progress"), parts = col("parts"), missed = col("flag");
  const skip = items.filter(i => i.st === "skip"), queued = live.filter(i => i.st === "queued");
  const conf = SWEEP.confirmed || [], nq = (SWEEP.notInQB || []).length, asOf = SWEEP.asOf || (D && D.asOf);
  const sub = list => { const o = list.map(i => daysSince(i.last)).filter(n => n != null).sort((a, b) => b - a)[0], u = list.filter(i => i.est == null).length; return [u ? u + " to price" : "", o != null ? "oldest " + o + "d" : ""].filter(Boolean).join(" · "); };
  const body = (list, none) => list.map(card).join("") || `<div class="col-empty">${none}</div>`;

  $("view").innerHTML = `
  <div class="head"><div><h1>Invoicing</h1><p class="sub">The next stop after Field Operations: jobs and projects ready to bill. Swept daily${asOf ? ` · as of <b>${esc(fmtD(asOf))}</b>` : ""}. Marked-complete jobs land here right away.</p></div>
    <div class="actions"><button class="btn primary" id="cmd" ${queued.length ? "" : "disabled"}>Copy Claude command (${queued.length})</button></div></div>
  <div class="pipe">
    <div class="col a">${colHead("Service / T&amp;M", svc, sub(svc))}${body(svc, "No service or T&amp;M jobs waiting.")}</div>
    <div class="col p">${colHead("Progress billing", prog, sub(prog))}${body(prog, "No project billing due.")}</div>
    <div class="col q">${colHead("Parts only", parts, `contract sites, last ${CHECK_DAYS} days`)}${body(parts, "No materials to bill on contract sites.")}</div>
  </div>
  <details class="rem-list" data-card="__miss" ${OPEN_CARDS.has("__miss") ? "open" : ""}><summary>Possibly missed (${missed.length})</summary><p class="note" style="margin:.4rem 0 .7rem">Work that may or may not be billable. Open one to bill it, or mark it not billable.</p><div class="cards">${body(missed, "Nothing to check.")}</div></details>
  <details class="rem-list" data-card="__conf" ${OPEN_CARDS.has("__conf") ? "open" : ""}><summary>Confirmed invoiced (${conf.length})</summary>${confirmedTable(conf)}</details>
  <details class="rem-list" data-card="__nq" ${OPEN_CARDS.has("__nq") ? "open" : ""}><summary>Not in QuickBooks (${nq})</summary>${reconTable()}</details>
  <details class="rem-list" data-card="__skip" ${OPEN_CARDS.has("__skip") ? "open" : ""}><summary>Not invoicing (${skip.length})</summary>${doneTable(skip, true)}</details>`;

  const find = id => items.find(i => i.id === id) || {};
  const quick = (e, id, patch) => { e.preventDefault(); e.stopPropagation(); const i = find(id); write(id, { state: patch.state, stateBy: ME, stateAt: nowIso(), skipReason: patch.reason, customer: i.customer || "", property: i.property || "" }); };
  document.querySelectorAll("[data-nb]").forEach(b => b.onclick = e => quick(e, b.dataset.nb, { state: "skip", reason: "Not billable" }));
  document.querySelectorAll("[data-back]").forEach(b => b.onclick = e => quick(e, b.dataset.back, { state: "new", reason: null }));
  document.querySelectorAll("[data-open],tr.go").forEach(el => el.onclick = e => { if (!e.target.closest("a")) location.hash = encodeURIComponent(el.dataset.open || el.dataset.id); });
  document.querySelectorAll("details[data-card]").forEach(d => d.ontoggle = () => { d.open ? OPEN_CARDS.add(d.dataset.card) : OPEN_CARDS.delete(d.dataset.card); });
  const c = $("cmd"); if (c) c.onclick = () => copy(claudeCommand(queued.length), c);
}

function confirmedTable(rows) {
  if (!rows.length) return '<div class="table-wrap"><p class="empty" style="padding:1rem">Nothing yet. The daily sweep fills this from QuickBooks.</p></div>';
  return `<p class="note" style="margin:.4rem 0 .6rem">Job invoices in QuickBooks from the last 60 days, newest first.</p><div class="table-wrap"><table><thead><tr><th>Date</th><th>Invoice</th><th>Job</th><th>Customer</th><th>For</th><th>QuickBooks</th><th class="num">Total</th></tr></thead><tbody>${rows.map(r => `<tr><td style="white-space:nowrap">${fmtD(r.date)}</td><td>${esc(r.no)}</td><td>${r.job ? `<a href="job.html?id=${encodeURIComponent(r.job)}">${esc(r.job)}</a>` : "—"}</td><td>${esc((r.customer || "").replace(/^\*/, ""))}</td><td>${esc(r.note || "")}</td><td>${r.balance === 0 ? '<span class="tag green">Paid</span>' : `<span class="tag amber">${money2(r.balance)} open</span>`}</td><td class="num">${money2(r.total)}</td></tr>`).join("")}</tbody></table></div>`;
}

function doneTable(list, acts) {
  if (!list.length) return '<div class="table-wrap"><p class="empty" style="padding:1rem">Nothing here.</p></div>';
  return `<div class="table-wrap"><table><thead><tr><th>Job</th><th>Customer / site</th><th>Invoice</th><th>By</th><th class="num">Amount</th>${acts ? "<th></th>" : ""}</tr></thead><tbody>${list.map(i => `<tr class="go" data-id="${esc(i.id)}"><td>${esc(i.id)}</td><td>${esc(i.customer)}<small>${esc(i.property)}</small></td><td>${esc(i.rec.invNo || i.rec.skipReason || (i.last ? "Last visit " + fmtD(i.last) : ""))}</td><td>${esc(i.rec.stateBy || "")}</td><td class="num">${i.rec.amount ? money(i.rec.amount) : "—"}</td>${acts ? `<td class="num">${i.st === "skip" ? `<button class="btn" type="button" data-back="${esc(i.id)}">Put back</button>` : `<button class="btn ghost warn" type="button" data-nb="${esc(i.id)}">Not billable</button>`}</td>` : ""}</tr>`).join("")}</tbody></table></div>`;
}

function reconTable() {
  const rows = SWEEP.notInQB || [], diff = SWEEP.amountDiff || [];
  return `<p class="note" style="margin:.4rem 0 .6rem">BuildOps job invoices from the last 120 days with no match in QuickBooks. Either never sent, or sent and not entered yet.</p>
  <div class="table-wrap">${rows.length ? `<table><thead><tr><th>Invoice</th><th>Job</th><th>Issued</th><th>Created by</th><th class="num">Amount</th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(r.no)}</td><td>${r.job ? `<a href="job.html?id=${encodeURIComponent(r.job)}">${esc(r.job)}</a>` : "—"}</td><td>${fmtD(r.issued)}</td><td>${esc(r.by || "")}</td><td class="num">${money2(r.amount)}</td></tr>`).join("")}</tbody></table>` : `<p class="empty" style="padding:1rem">Every BuildOps invoice from the last 120 days is in QuickBooks.</p>`}</div>
  ${diff.length ? `<h2 style="margin:1.1rem 0 .5rem">Amount differs between BuildOps and QuickBooks</h2><div class="table-wrap"><table><thead><tr><th>Invoice</th><th>Job</th><th class="num">BuildOps</th><th class="num">QuickBooks</th></tr></thead><tbody>${diff.map(r => `<tr><td>${esc(r.no)}</td><td>${r.job ? `<a href="job.html?id=${encodeURIComponent(r.job)}">${esc(r.job)}</a>` : "—"}</td><td class="num">${money2(r.amount)}</td><td class="num">${money2(r.qb)}</td></tr>`).join("")}</tbody></table></div>` : ""}`;
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
    type: it.bucket === "parts" ? "Parts" : it.bucket === "progress" && !it.done ? "Progress" : /t\s*&\s*m|time/i.test(it.type) ? "T&M" : it.done ? "Final" : "Full",
    amount: it.bucket === "parts" ? null : it.bucket === "progress" ? Math.max(Math.round(it.est || 0), 0) : it.left != null ? Math.round(it.left * 100) / 100 : null,
    po: it.po || "",
    note: sw.note || `${it.po ? it.po.replace(/^[A-Z]+/, "") + " - " : ""}${(it.title || site).slice(0, 80)}`,
    lines: it.bucket === "parts" ? V.flatMap(v => v.parts || []).map(p => ({ desc: p.name || "", qty: p.qty ?? "", amount: "" })) : [],
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
    const it = ITEM && ITEM.id === id ? ITEM : {};
    await setDoc(doc(db, "invoicing_data", safeId(id)), { ...patch, jobId: id, customer: patch.customer || it.customer || "", property: patch.property || it.property || "", updatedAt: serverTimestamp(), updatedBy: USER.email }, { merge: true });
    setSave("Saved · shared with Jake, Mike and Cole");
    return true;
  } catch (e) {
    const m = "NOT SAVED (" + (e.code || e.message) + "). Copy your edits and refresh.";
    if ($("save")) setSave(m, true); else show(m);
    return false;
  }
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
  ITEM = allItems().find(i => i.id === id) || (() => { const j = D && (D.jobs || []).find(x => x.id === id); return j ? { ...itemFromJob(j, j.kind === "Project" ? "progress" : "service"), rec: REC[id] || {} } : { id, bucket: "flag", customer: (DET && DET.customer) || id, property: (DET && DET.property) || "", title: "", po: (DET && DET.po) || "", type: (DET && DET.type) || "", why: "", rec: REC[id] || {} }; })();
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
  const j = it.job || {}, B = (DET && DET.board) || {}, V = billable(), locked = st === "queued" || st === "drafted" || st === "done";
  const inv = (COST && COST.invoices) || [], qbi = (COST && COST.qbInvoices) || [], bills = (COST && COST.bills) || [], em = ((COST && COST.emails) || []).slice(0, 8);
  const billed = j.billed != null ? j.billed : (COST && COST.billedQB);
  const amt = +F.amount || 0;
  const actual = V.reduce((s, v) => s + visitHrs(v), 0) || j.actualHrs || 0, budget = j.budgetHrs || (DET && DET.budgetHrs) || null;
  const flags = [...(sw.flags || [])];
  if (!it.po) flags.push("No PO on this job. Confirm whether the customer needs one on the invoice.");
  if (it.left != null && amt > it.left + 1) flags.push(`Amount is ${money(amt - it.left)} over what's left on the quote. Check there's a change order.`);
  const ppl = sw.to || [], extra = (F.to || []).filter(e => !ppl.some(p => p.email === e));
  const billing = j.billingStatus || B.billingStatus, status = j.status || B.status;
  const title = it.title || (DET && (DET.issue || "").split("\n")[0].slice(0, 90)) || "";
  const addr = DET && DET.address ? DET.address.replace(/,\s*CA$/, "") : "";
  const last = j.lastVisit || (V.length ? V[V.length - 1].date : null);

  $("view").innerHTML = `
  <div class="crumb"><a id="back" href="#">Invoicing</a> · ${esc(it.id)}</div>
  <div class="head"><div>
    <h1>${esc(j.customer || (DET && DET.customer) || it.customer)}</h1>
    <p class="sub"><b>${esc(it.id)}</b>${it.po ? ` · PO <b>${esc(it.po)}</b>` : ""}${it.type ? ` · ${esc(it.type)}` : ""}${title ? ` · ${esc(title)}` : ""}</p>
    <p class="sub">${esc(it.property)}${addr ? ` · ${esc(addr)}` : ""}</p>
    <div class="tags">${it.done ? '<span class="tag green">Completed</span>' : ""}<span class="tag ${BTAG[it.bucket]}">${BUCKETS[it.bucket]}</span>${status ? `<span class="tag grey">BuildOps: ${esc(status)}</span>` : ""}${billing ? `<span class="tag ${/fully|paid/i.test(billing) ? "green" : /partial|ready/i.test(billing) ? "amber" : "red"}">${esc(billing)}</span>` : ""}${(DET && DET.department) ? `<span class="tag purple">${esc(DET.department)}</span>` : ""}</div>
  </div>
  <div class="actions"><button class="btn primary" id="preview" type="button">Job report</button>${isJob(it.id) ? `<a class="btn" href="job.html?id=${encodeURIComponent(it.id)}">Job page</a>` : ""}${(it.url || (DET && DET.url)) ? `<a class="btn" href="${esc(it.url || DET.url)}" target="_blank" rel="noopener">BuildOps ↗</a>` : ""}</div></div>
  ${flags.map(f => `<div class="flag">${esc(f)}</div>`).join("")}
  ${st === "queued" ? `<div class="banner info">Queued by ${esc(F.stateBy || "")}. Waiting for Claude to build the Draft in BuildOps. Take it back to change anything.</div>` : ""}
  ${st === "drafted" ? `<div class="banner info">${esc(F.invNo || "Draft")} built in BuildOps${F.invTotal ? ` for ${money2(F.invTotal)}` : ""}. Review it and send it. It moves to Done when ${esc(F.invNo || "it")} shows up in QuickBooks.${F.invUrl ? ` <a href="${esc(F.invUrl)}" target="_blank" rel="noopener"><b>Open in BuildOps ↗</b></a>` : ""}</div>` : ""}
  ${st === "done" ? `<div class="banner info">In QuickBooks as ${esc((qbOf(F.invNo) || {}).doc)} · ${money2((qbOf(F.invNo) || {}).total)} · ${(qbOf(F.invNo) || {}).balance === 0 ? "paid" : "open with Clarissa"}.</div>` : ""}
  ${F.claudeError ? `<div class="banner">Claude couldn't build this one: ${esc(F.claudeError)}</div>` : ""}
  <div class="kpis">
    <div class="kpi"><div class="k-label">Visits</div><div class="k-value">${V.length}<span class="dim" style="font-size:1rem"> / ${((DET && DET.visits) || []).length}</span></div><div class="k-sub">completed / logged</div></div>
    <div class="kpi"><div class="k-label">Hours on site</div><div class="k-value">${Math.round(actual * 10) / 10} h</div><div class="k-sub">${budget ? `${Math.round(actual / budget * 100)}% of ${budget} budgeted` : "no budgeted hours"}</div></div>
    <div class="kpi"><div class="k-label">Last visit</div><div class="k-value" style="font-size:1.2rem">${fmtD(last)}</div><div class="k-sub">${daysSince(last) != null ? daysSince(last) + " days ago" : ""}</div></div>
    <div class="kpi"><div class="k-label">Quoted (pre-HST)</div><div class="k-value">${money(j.quoted || 0)}</div><div class="k-sub">${it.left != null ? money(it.left) + " left to bill" : "&nbsp;"}</div></div>
    <div class="kpi"><div class="k-label">Supplier bills</div><div class="k-value">${money(bills.reduce((s, x) => s + (x.amount || 0), 0))}</div><div class="k-sub">${bills.length} on this PO</div></div>
    <div class="kpi"><div class="k-label">Billed (pre-HST)</div><div class="k-value">${money(billed || 0)}</div><div class="k-sub">${billed ? "" : "nothing billed yet"}</div></div>
  </div>
  ${DET && DET.issue ? `<section><h2>Scope</h2><div class="panel scope">${esc(DET.issue)}</div></section>` : ""}
  <section>
    <div class="h2-row"><div><h2>Visits</h2><p class="note">Tick what goes in the customer report. Open a visit to edit its summary or choose photos. Edits change the report only, not BuildOps.</p></div></div>
    <div class="opts">${[["hours", "Hours on site"], ["mats", "Materials"], ["recs", "Recommendations"], ["photos", "Photos"], ["sign", "Signature lines"]].map(([k, l]) => `<label><input type="checkbox" data-opt="${k}" ${(F.opts || {})[k] ? "checked" : ""}> ${l}</label>`).join("")}</div>
    ${V.length ? V.slice().reverse().map(visitRow).join("") : '<div class="panel empty">No visit reports yet. The daily refresh adds them.</div>'}
  </section>
  <section><div class="two">
    <div class="panel"><h2>Invoice</h2>
      <div class="row2"><div><label class="lab" for="f-type">Type</label><select class="in" id="f-type" ${locked ? "disabled" : ""}>${["Full", "Progress", "Final", "T&M", "Parts"].map(t => `<option ${F.type === t ? "selected" : ""}>${t}</option>`).join("")}</select></div>
        <div><label class="lab" for="f-po">PO</label><input class="in" id="f-po" value="${esc(F.po || "")}" ${locked ? "disabled" : ""}></div></div>
      <label class="lab" for="f-amt">Amount before HST${F.type === "T&M" || F.type === "Parts" ? " (leave blank: BuildOps prices it from the pricebook)" : ""}</label>
      <input class="in" id="f-amt" inputmode="decimal" value="${F.amount ?? ""}" ${locked ? "disabled" : ""}>
      <div class="totals" id="totals"></div>
      <label class="lab" for="f-note">Invoice note (shows in BuildOps and QuickBooks)</label>
      <textarea class="in" id="f-note" rows="2" ${locked ? "disabled" : ""}>${esc(F.note || "")}</textarea>
      <label class="lab">Line items for Claude (optional)</label>
      <div id="lines"></div>
      ${locked ? "" : '<button class="btn ghost" id="add-line" type="button">+ Add line</button>'}
      <label class="lab" for="f-claude">Anything else Claude should know</label>
      <textarea class="in" id="f-claude" rows="2" placeholder="e.g. Bill the balance after the deposit on INV-20261142" ${locked ? "disabled" : ""}>${esc(F.claudeNote || "")}</textarea>
      <div class="foot" id="acts"></div>
      <div class="save" id="save"></div>
    </div>
    <div class="panel"><h2>Email</h2>
      <p class="note">From <b>${FROM}</b> · CC <b>${CC}</b>, always. Attach the invoice and report PDFs before sending.</p>
      <label class="lab">To</label>
      <div class="who">${ppl.map(p => `<label title="${esc(p.src || "")}"><input type="checkbox" data-to="${esc(p.email)}" ${(F.to || []).includes(p.email) ? "checked" : ""}>${esc(p.name || p.email)}${p.role ? ` · ${esc(p.role)}` : ""} <a href="mailto:${esc(p.email)}?cc=${CC}">${esc(p.email)}</a></label>`).join("") || '<span class="dim" style="font-size:.82rem">No contacts found yet. The daily sweep fills these in.</span>'}</div>
      <input class="in" id="f-to-x" placeholder="Other addresses, separated by commas" value="${esc(extra.join(", "))}">
      <label class="lab" for="f-subj">Subject</label><input class="in" id="f-subj" value="${esc(F.subject || "")}">
      <label class="lab" for="f-body">Message</label><textarea class="in" id="f-body" rows="10">${esc(F.body || "")}</textarea>
      <div class="foot"><a class="btn primary" id="mail" href="#">Open email</a><button class="btn" id="c-to" type="button">Copy To</button><button class="btn" id="c-subj" type="button">Copy subject</button><button class="btn" id="c-body" type="button">Copy message</button></div>
      <p class="note" id="mail-note" style="margin-top:.4rem;font-size:.78rem">Pick contact@ in the From field: an email link can't set it.</p>
    </div>
  </div></section>
  <section><h2>Invoices</h2><div class="table-wrap"><table><thead><tr><th>Invoice</th><th>Issued</th><th>QuickBooks</th><th class="num">Amount</th></tr></thead><tbody>
    ${inv.length || qbi.length ? mergeInv(inv, qbi).map(i => `<tr><td>${esc(i.no)}</td><td>${fmtD(i.issued)}</td><td>${i.qb ? (i.qb.balance === 0 ? '<span class="tag green">Paid</span>' : `<span class="tag amber">${money2(i.qb.balance)} open</span>`) : '<span class="tag red">Not in QuickBooks</span>'}</td><td class="num">${money2(i.amount ?? (i.qb && i.qb.total))}</td></tr>`).join("") : '<tr><td colspan="4" class="empty">No invoices on this job yet.</td></tr>'}
  </tbody></table></div></section>
  ${em.length ? `<section><h2>Recent emails</h2><div class="table-wrap"><table><tbody>${em.map(e => `<tr><td style="white-space:nowrap">${fmtD(e.date)}</td><td>${e.link ? `<a href="${esc(e.link)}" target="_blank" rel="noopener">${esc(e.subject || "(no subject)")}</a>` : esc(e.subject || "")}<small>${esc(e.from || "")}${e.summary ? " · " + esc(e.summary) : ""}</small></td></tr>`).join("")}</tbody></table></div></section>` : ""}`;
  bindReview(it, st, locked);
}

function mergeInv(inv, qbi) {
  const out = inv.map(i => ({ ...i, qb: qbi.find(q => String(q.doc) === String(i.no).replace(/^INV-/i, "")) }));
  qbi.filter(q => !out.some(o => o.qb === q)).forEach(q => out.push({ no: q.doc, issued: q.date, qb: q }));
  return out;
}

function visitRow(v) {
  const F = FORM, on = (F.visits || []).includes(v.id), P = (v.photos || []).filter(p => phUrl(p, 360) && p.rep !== false), off = F.phOff || [];
  const edit = (F.sumEdits || {})[v.id], text = edit != null ? edit : sumText(v), h = visitHrs(v);
  const techs = [v.tech, ...(v.others || [])].filter(Boolean).join(", ");
  return `<article class="visit ${on ? "" : "off"}" data-vis="${esc(v.id)}">
    <div class="vh"><input type="checkbox" data-v="${esc(v.id)}" ${on ? "checked" : ""} aria-label="Include visit ${esc(v.n)} in report">
      <div class="vdate">${fmtD(v.date)}<small>Visit #${esc(v.n)}</small></div>
      <div><div class="vtitle">${esc(v.desc || "Visit")}</div><div class="vtech">${esc(techs || "No tech assigned")}</div>${text ? `<div class="vsum">${esc(text)}</div>` : ""}</div>
      <div class="vright"><b>${h ? Math.round(h * 10) / 10 + " h" : "—"}</b>${(v.photos || []).length ? v.photos.length + " photo" + (v.photos.length === 1 ? "" : "s") : ""}</div></div>
    <div class="vb"><div class="blk"><h4>Visit summary for the report</h4><textarea class="in" rows="4" data-sum="${esc(v.id)}" aria-label="Visit summary">${esc(text)}</textarea></div>
      ${(v.recs || []).length ? `<div class="blk"><h4>Recommendations</h4><ul class="plain">${v.recs.map(r => `<li><b>${esc(r.title || r.asset || "Recommendation")}</b>${r.text ? " — " + esc(r.text) : ""}</li>`).join("")}</ul></div>` : ""}
      ${P.length ? `<div class="blk"><h4>Photos for the report</h4><div class="ph-grid">${P.map(p => `<label class="ph ${off.includes(p.src) ? "off" : ""}"><img loading="lazy" src="${esc(phUrl(p, 360))}" alt="${esc(p.comment || "Visit photo")}"><input type="checkbox" data-ph="${esc(p.src)}" ${off.includes(p.src) ? "" : "checked"} aria-label="Include photo"></label>`).join("")}</div></div>` : ""}
    </div></article>`;
}

function bindReview(it, st, locked) {
  const F = FORM;
  $("back").onclick = e => { e.preventDefault(); flush(); location.hash = ""; };
  document.querySelectorAll(".vh").forEach(h => h.onclick = e => { if (!e.target.closest("input")) h.parentElement.classList.toggle("open"); });
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
      if (FORM.type !== "T&M" && FORM.type !== "Parts" && !FORM.amount) { setSave("Enter the amount, or set the type to T&M or Parts.", true); return; }
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
  /* Parts only needs to know which contract-site jobs have materials. Read once, after the customer list arrives. */
  let partsRead = false;
  const readParts = async () => {
    if (partsRead || !(SWEEP.contractCustomers || []).length) return;
    partsRead = true;
    const ids = (D.jobs || []).filter(j => !j.po && isContract(j.customer) && (j.visitsDone || 0) > 0 && bucketOf(j)).map(j => j.id);
    await Promise.all(ids.map(async id => {
      try {
        const [a, b] = await Promise.all([getDoc(doc(db, "ops_job_detail", safeId(id))), getDoc(doc(db, "ops_job_costs", safeId(id)))]);
        const d = a.exists() ? JSON.parse(a.data().json) : {}, c = b.exists() ? JSON.parse(b.data().json) : {};
        const count = (d.visits || []).reduce((s, v) => s + (v.parts || []).length, 0) + (d.materials || []).length + (c.bills || []).length;
        if (count) PARTS[id] = { count, bills: (c.bills || []).reduce((s, x) => s + (x.amount || 0), 0) };
      } catch (e) { /* the job simply stays under Possibly missed */ }
    }));
    redraw();
  };
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
      readParts();
    }, e => show(denied(e) ? "Invoicing data is blocked: publish the updated Firestore rules (firestore.rules in the repo)." : "Invoicing data couldn't load: " + (e.code || e.message)));
    window.addEventListener("hashchange", route);
    window.addEventListener("beforeunload", () => { flush(); });
    route();
  }
}
