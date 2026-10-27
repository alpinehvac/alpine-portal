// ── Alpine HVAC — BuildOps job detail reader (read-only) ─────────────
// Run in a logged-in live.buildops.com tab (Claude in Chrome: javascript_exec):
//   1. paste this file's contents once (defines window.alpineJobs)
//   2. alpineJobs.start(["JO20261176", ...])   (returns immediately; work runs in the background)
//   3. poll alpineJobs.status() until done, then alpineJobs.handoff() (opens Field Operations with the data)
//
// For each job it opens, in this order, and reads only:
//   /job/view/<n>?tab=reports-invoices   header fields, invoices, link to the job report
//   /jobreport/<rid>                     every visit's description, techs, summary notes, recommendations,
//                                        technician notes, labour, field POs, parts, receipts, photos, tasks;
//                                        assets, invoice items. Each grid is paged through to the end
//                                        (clicks its Next page button only).
// Safety: never clicks Save/Edit/Delete/Create/Invoice/Add; never reads Property Instructions,
// Job Notes or office notes (they can hold site access codes); numbers that look like access
// codes in technician notes are masked. Progress is kept in localStorage (__alpine_jobs), so
// calling start() again resumes.
//
// result() returns { asOf, detail: {JO..: {...}}, costs: {JO..: {...}}, errors: [...] }.
// detail = ops view (no dollars). costs = owners only (labour $, parts $, invoices).
(() => {
const KEY = "__alpine_jobs", VERSION = 2;
// Waits use a Web Worker timer: Chrome throttles page timers in hidden or minimized tabs to about
// one a minute (a 57-job read took hours), but not worker timers. Falls back to a MessageChannel loop.
let sleep;
try {
  const w = new Worker(URL.createObjectURL(new Blob(["onmessage=e=>setTimeout(()=>postMessage(e.data[0]),e.data[1])"], { type: "text/javascript" })));
  const pend = new Map(); let seq = 0;
  w.onmessage = e => { const r = pend.get(e.data); pend.delete(e.data); if (r) r(); };
  sleep = ms => new Promise(r => { const id = ++seq; pend.set(id, r); w.postMessage([id, ms]); });
} catch (e) {
  sleep = ms => new Promise(r => { const end = Date.now() + ms, ch = new MessageChannel(); ch.port1.onmessage = () => { if (Date.now() >= end) { ch.port1.close(); r(); } else ch.port2.postMessage(0); }; ch.port2.postMessage(0); });
}
const pad = n => String(n).padStart(2, "0");
const iso = s => { if (!s || s === "-") return null; const d = new Date(String(s).replace(/\s+\d{1,2}:\d{2}\s*[ap]m.*$/i, "").trim()); return isNaN(d) ? null : d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); };
const clean = s => (!s || s === "-") ? "" : String(s).trim();
const num = v => { const n = parseFloat(String(v == null ? "" : v).replace(/[^0-9.\-]/g, "")); return isNaN(n) ? null : n; };
const MASK = /\b(code|pin|password|passcode|lock ?box|combo|combination|alarm|keypad|gate)\b([^\n]{0,25}?)(\d[\d\- ]{2,})/gi;
const mask = s => String(s || "").replace(MASK, (m, w, mid) => w + mid + "[masked]");

let S = null;
const load = () => { try { S = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { S = null; } if (!S || S.version !== VERSION) S = { version: VERSION, queue: [], detail: {}, costs: {}, errors: [], running: false, current: null }; };
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* quota: results stay in memory */ } };
load();

function nav(path) { history.pushState({}, "", path); window.dispatchEvent(new PopStateEvent("popstate", { state: {} })); }
async function waitFor(fn, max) { const t0 = Date.now(); while (Date.now() - t0 < (max || 25000)) { await sleep(350); try { if (fn()) { await sleep(600); return true; } } catch (e) {} } return false; }
const mainText = () => ((document.querySelector("main") || document.body).innerText || "");

// Header field by its label (label text then value on the next line).
function field(label) {
  if (/PROPERTY INSTRUCTIONS|NOTES/i.test(label)) return "";
  const L = label.toUpperCase();
  const els = [...document.querySelectorAll("main *")].filter(e => e.children.length === 0 && e.textContent.trim().toUpperCase() === L);
  for (const e of els) {
    let n = e.parentElement;
    for (let i = 0; i < 4 && n; i++) {
      const t = n.innerText.trim().split("\n").map(s => s.trim()).filter(Boolean);
      const k = t.findIndex(s => s.toUpperCase() === L);
      if (k >= 0 && t[k + 1]) return clean(t[k + 1]);
      n = n.parentElement;
    }
  }
  return "";
}

// Every grid/table on the page as { H: headers, R: rows of cell text }, identified by its headers.
function tables() {
  const root = document.querySelector("main") || document.body, out = [], seen = new Set();
  for (const h of root.querySelectorAll("[role=columnheader], th")) {
    let c = h.parentElement, d = 0;
    while (c && c !== root && d < 8) {
      const hasRows = [...c.querySelectorAll("[role=row],tr")].some(r => r.querySelector("[role=cell],[role=gridcell],td"));
      if (hasRows || c.tagName === "SECTION" || c.tagName === "TABLE") break;
      c = c.parentElement; d++;
    }
    if (!c || seen.has(c)) continue;
    seen.add(c);
    const H = [...c.querySelectorAll("[role=columnheader], th")].map(x => x.innerText.trim());
    if (H.length > 16) continue; // a wrapper around several tables
    const R = [...c.querySelectorAll("[role=row],tr")].map(r => [...r.querySelectorAll("[role=cell],[role=gridcell],td")].map(x => x.innerText.trim())).filter(r => r.length && r.some(Boolean));
    out.push({ H, R });
  }
  return out;
}
// Rows of the first table that has all the given headers, as objects keyed by header. TOTAL rows dropped.
function rowsOf(T, need) {
  const t = T.find(x => need.every(h => x.H.includes(h)));
  if (!t) return [];
  return t.R.filter(r => !/^TOTAL$/i.test(r[0] || "") && !/^TOTAL$/i.test(r[1] || "")).map(r => { const o = {}; t.H.forEach((h, i) => { if (h && o[h] == null) o[h] = r[i] == null ? "" : r[i]; }); return o; });
}

// Each grid's own "Next page" button: the nearest one whose surrounding block holds only this grid.
function pagerOf(c, all) {
  let p = c;
  for (let i = 0; i < 6 && p; i++) {
    const b = p.querySelector("button[aria-label='Next page'], button[aria-label='Go to next page']");
    if (b) return all.filter(x => p.contains(x)).length === 1 ? b : null;
    p = p.parentElement;
  }
  return null;
}
// Every grid on the page with ALL its rows (clicks through each grid's pages; read-only).
async function allTables() {
  const root = document.querySelector("main") || document.body, conts = [], seen = new Set();
  for (const h of root.querySelectorAll("[role=columnheader], th")) {
    let c = h.parentElement, d = 0;
    while (c && c !== root && d < 8) { const hasRows = [...c.querySelectorAll("[role=row],tr")].some(r => r.querySelector("[role=cell],[role=gridcell],td")); if (hasRows || c.tagName === "SECTION" || c.tagName === "TABLE") break; c = c.parentElement; d++; }
    if (!c || seen.has(c)) continue;
    seen.add(c);
    if (c.querySelectorAll("[role=columnheader], th").length > 16) continue;
    conts.push(c);
  }
  const rowsIn = c => [...c.querySelectorAll("[role=row],tr")].map(r => [...r.querySelectorAll("[role=cell],[role=gridcell],td")].map(x => x.innerText.trim())).filter(r => r.length && r.some(Boolean));
  const out = [];
  for (const c of conts) {
    const H = [...c.querySelectorAll("[role=columnheader], th")].map(x => x.innerText.trim());
    const R = [], keys = new Set();
    const add = () => { rowsIn(c).forEach(r => { const k = r.join("\u0001"); if (!keys.has(k)) { keys.add(k); R.push(r); } }); try { harvest(c); } catch (e) {} };
    add();
    for (let pg = 0; pg < 30; pg++) {
      const btn = pagerOf(c, conts);
      if (!btn || btn.disabled || btn.getAttribute("aria-disabled") === "true") break;
      const sig = JSON.stringify(rowsIn(c).slice(0, 2));
      btn.click();
      if (!await waitFor(() => JSON.stringify(rowsIn(c).slice(0, 2)) !== sig, 8000)) break;
      add();
    }
    out.push({ H, R });
  }
  return out;
}
// Photo attachments: the grid rows carry each file's Cloudinary path and BuildOps' "include in job report"
// flag in their React props (not in the cell text). Collected while grids are paged; keyed visit|file.
let ATT = new Map();
function harvest(c) {
  for (const row of c.querySelectorAll("[role=row]")) {
    const fk = Object.keys(row).find(k => k.startsWith("__reactFiber"));
    let f = fk ? row[fk] : null;
    for (let i = 0; i < 6 && f; i++, f = f.return) {
      const r = f.memoizedProps && f.memoizedProps.row;
      if (r && r.fileUrl && (r.fileName || r.customFileName)) {
        const n = r.visit && r.visit.visitNumber;
        ATT.set(n + "|" + (r.customFileName || r.fileName), { src: String(r.fileUrl), rep: r.includeInJobReport !== false });
        if (r.fileName && r.customFileName && r.fileName !== r.customFileName) ATT.set(n + "|" + r.fileName, { src: String(r.fileUrl), rep: r.includeInJobReport !== false });
        break;
      }
    }
  }
}
const vnum = s => { const m = String(s || "").match(/Visit\s+(\d+)/i); return m ? +m[1] : null; };
const vdate = s => { const m = String(s || "").match(/Visit\s+\d+\s*-\s*(.*)$/i); return m ? iso(m[1]) : null; };
const tech = s => String(s || "").replace(/\s*\(.*\)$/, "");
const role = s => (String(s || "").match(/\((.*)\)/) || [])[1] || "";

async function readJobView(id) {
  const n = id.replace(/^JO/, "");
  nav("/job/view/" + n + "?tab=reports-invoices");
  const ok = await waitFor(() => mainText().includes("Job: " + id) && /Add Visit|Invoice #|INVOICE\(S\) ISSUED/i.test(mainText()));
  if (!ok) throw new Error("job page did not load");
  await waitFor(() => /INVOICE\(S\) ISSUED|Invoice #/i.test(mainText()), 8000);
  const rep = [...document.querySelectorAll("main a[href*='/jobreport/']")].map(a => a.getAttribute("href")).find(h => /^\/jobreport\/[0-9a-f-]+$/.test(h));
  const T = tables();
  let inv = rowsOf(T, ["Invoice #", "Amount", "Status"]).map(r => ({ no: r["Invoice #"], amount: num(r["Amount"]), status: r["Status"], issued: iso(r["Issue date"]), due: iso(r["Due date"]), by: r["Created by"] }));
  if (!inv.length) { // long jobs show a compact list: number, visits, amount (no status or dates)
    const L = mainText().split("\n").map(x => x.trim()).filter(Boolean);
    const k = L.findIndex(x => /^TOTAL BILLED FOR JOB$/i.test(x));
    if (k >= 0) for (let i = k; i < L.length; i++) { if (/^INV-\d+$/.test(L[i])) { const amt = L.slice(i + 1, i + 4).find(x => /\$[\d,]/.test(x)); inv.push({ no: L[i], amount: amt ? num(amt.replace(/\s/g, "")) : null, status: "", issued: null, due: null, by: "" }); } if (/^Show History$/i.test(L[i])) break; }
  }
  const billedTotal = (() => { const m = mainText().match(/TOTAL BILLED FOR JOB\s*\$?\s*([\d,.]+)/i); return m ? num(m[1]) : null; })();
  return {
    rid: rep ? rep.split("/").pop() : null, invoices: inv, billedTotal, issue: issueText(),
    h: {
      customer: field("CUSTOMER"), billTo: field("BILLING CUSTOMER"), property: field("PROPERTY"), address: field("ADDRESS"),
      authorizedBy: field("AUTHORIZED BY"), po: field("CUSTOMER PROVIDED P O NUMBER"), workOrder: field("WORK ORDER (CUSTOMER)"),
      quoteSubtotal: num(field("QUOTE SUBTOTAL")), quoteTotal: num(field("QUOTE TOTAL")), costAmount: num(field("COST AMOUNT")),
      nte: num(field("AMOUNT NOT TO EXCEED")), type: field("JOB TYPE"), pm: field("PROJECT MANAGER"), soldBy: field("SOLD BY"),
      budgetHrs: num(field("TOTAL BUDGETED HOURS")), department: field("DEPARTMENTS")
    }
  };
}

function issueText() {
  const t = mainText(); const i = t.indexOf("ISSUE DESCRIPTION"); if (i < 0) return "";
  let s = t.slice(i + 17); const end = s.search(/\n?(OFFICE NOTES|Scheduling\n|Quotes\n)/); if (end >= 0) s = s.slice(0, end);
  s = s.trim();
  return /^(OFFICE NOTES|-)?$/i.test(s) ? "" : mask(s);
}

// The job report overview lists every visit's description, summary notes, recommendations,
// technician notes, labour, field POs, parts, receipts, photos and tasks, each in its own paged grid.
async function readOverview(rid) {
  ATT = new Map();
  nav("/jobreport/" + rid);
  const ok = await waitFor(() => /Costs\s*\n\s*Labor/i.test(mainText()) || mainText().includes("Invoice Items"));
  if (!ok) throw new Error("job report did not load");
  const T1 = await allTables(); // overview: costs, invoice items
  // "Visits (n of m Reviewed)" in the left nav opens the all-visits view (read-only navigation).
  const vn = [...document.querySelectorAll("main *")].find(e => e.children.length === 0 && /^Visits \(\d+ of \d+/.test(e.textContent.trim()));
  const nVis = vn ? +((vn.textContent.match(/of (\d+)/) || [])[1] || 0) : 0;
  let T2 = [];
  if (vn && nVis > 0) {
    vn.click();
    if (!await waitFor(() => mainText().includes("Visit Summary"), 20000)) throw new Error("visits view did not load");
    await waitFor(() => tables().some(t => t.H.includes("Summary Note")), 8000);
    T2 = await allTables();
  }
  const T = T2.concat(T1);
  const visits = {};
  const V = n => (visits[n] = visits[n] || { n, date: null, status: "", desc: "", tech: "", others: [], summaries: [], recs: [], techNotes: [], labour: [], fieldPOs: [], parts: [], receipts: [], photos: [], tasks: [], assets: [] });
  rowsOf(T, ["Visit", "Visit Status", "Description", "Primary Technician"]).forEach(r => { const n = vnum(r["Visit"]); if (n == null) return; const v = V(n); v.date = vdate(r["Visit"]); v.status = r["Visit Status"]; v.desc = clean(r["Description"]); v.tech = clean(r["Primary Technician"]); const o = clean(r["Additional technicians"]); v.others = o ? o.split(/,\s*/) : []; });
  rowsOf(T, ["Visit", "Summary Note", "Created By"]).forEach(r => { const n = vnum(r["Visit"]); if (n == null || !clean(r["Summary Note"])) return; V(n).summaries.push({ text: r["Summary Note"], by: r["Created By"], at: r["Last Edited"] }); });
  const recRows = rowsOf(T, ["Recommendation", "Description"]);
  const jobRecs = [];
  recRows.forEach(r => { const x = { asset: clean(r["Assets"]), title: clean(r["Recommendation"]), text: clean(r["Description"]), status: clean(r["Status"]), action: clean(r["Action Needed"]), priority: clean(r["Priority"]) }; if (!x.title && !x.text) return; const n = vnum(r["Visit"] || r[""]); if (n != null) V(n).recs.push(x); else jobRecs.push(x); });
  rowsOf(T, ["Visit", "Note Subject", "Note Content"]).forEach(r => { const n = vnum(r["Visit"]); if (n == null || !(clean(r["Note Content"]) || clean(r["Note Subject"]))) return; V(n).techNotes.push({ subject: mask(r["Note Subject"]), text: mask(r["Note Content"]), by: r["Last Edited By"], at: r["Last Edited On"] }); });
  // Prefer the overview's costed labour grid (has Subtotal); the visits view's grid has hours only.
  const labRows = rowsOf(T1, ["Source", "Technician", "Time Submitted", "Subtotal"]);
  const labour = (labRows.length ? labRows : rowsOf(T, ["Source", "Technician", "Time Submitted"])).map(r => ({ source: r["Source"], visit: vnum(r["Source"]), date: vdate(r["Source"]), tech: tech(r["Technician"]), role: role(r["Technician"]), hrs: num(r["Time Submitted"]), type: r["Payroll Hour Type"], cost: num(r["Subtotal"]) })).filter(l => l.hrs != null);
  labour.forEach(l => { if (l.visit != null) V(l.visit).labour.push({ tech: l.tech, role: l.role, hrs: l.hrs, type: l.type, cost: l.cost }); });
  rowsOf(T, ["Visit", "Purchase Order", "PO Type"]).forEach(r => { const n = vnum(r["Visit"]); if (n == null || !clean(r["Purchase Order"])) return; V(n).fieldPOs.push({ po: clean(r["Purchase Order"]), status: clean(r["Status"]), vendor: clean(r["Vendor"]), desc: clean(r["Description"]), cost: num(r["Subtotal"]) }); });
  rowsOf(T, ["Visit", "Item Name", "Unit Cost", "Qty"]).forEach(r => { const n = vnum(r["Visit"]); if (n == null || !clean(r["Item Name"])) return; V(n).parts.push({ name: r["Item Name"], desc: clean(r["Description"]), qty: num(r["Qty"]), uom: clean(r["UOM"]), cost: num(r["Subtotal"]) }); });
  rowsOf(T, ["Visit", "Receipt", "Vendor"]).forEach(r => { const n = vnum(r["Visit"]); if (n == null || !clean(r["Receipt"])) return; V(n).receipts.push({ receipt: clean(r["Receipt"]), po: clean(r["Purchase Order"]), vendor: clean(r["Vendor"]), desc: clean(r["Description"]), cost: num(r["Subtotal"]) }); });
  rowsOf(T, ["Visit", "File Name", "Added By"]).forEach(r => { const n = vnum(r["Visit"]); if (n == null) return; const a = ATT.get(n + "|" + r["File Name"]) || {}; V(n).photos.push({ file: r["File Name"], type: clean(r["Type"]), by: r["Added By"], at: r["Date Added"], comment: clean(r["Comment"]), src: a.src || null, rep: a.rep !== false }); });
  rowsOf(T, ["Task", "Task Description"]).forEach(r => { const x = { asset: clean(r["Asset"]), task: clean(r["Task"]), desc: clean(r["Task Description"]), note: mask(clean(r["Task Note"])), completedBy: clean(r["Completed By"]) }; if (!(x.task && x.task !== "Default Section") && !x.desc) return; const n = vnum(r["Visit"]); if (n != null) V(n).tasks.push(x); else (visits._jobTasks = visits._jobTasks || []).push(x); });
  const assets = rowsOf(T, ["Asset Name"]).map(r => ({ name: clean(r["Asset Name"]), make: clean(r["Make"]), model: clean(r["Model"]), serial: clean(r["Serial Number"]), location: clean(r["Location"]) })).filter(a => a.name);
  const inventory = rowsOf(T, ["Source", "Item Name", "Unit Cost", "Qty"]).map(r => ({ source: r["Source"], name: r["Item Name"], desc: clean(r["Description"]), qty: num(r["Qty"]), uom: clean(r["UOM"]), unit: num(r["Unit Cost"]), cost: num(r["Subtotal"]) }));
  const purchased = rowsOf(T, ["Item Name", "Purchase Order", "Received"]).map(r => ({ name: r["Item Name"], desc: clean(r["Description"]), po: clean(r["Purchase Order"]), received: clean(r["Received"]), uom: clean(r["UOM"]), cost: num(r["Subtotal"]) }));
  const invItems = rowsOf(T, ["Item Name", "% of Invoice Amount"]).map(r => ({ invoice: String(r["Source"] || "").replace(/^Invoice\s+/, ""), name: r["Item Name"], desc: clean(r["Description"]), amount: num(r["Subtotal"]) }));
  const m = mainText().match(/Invoice Subtotal:\s*\$?([\d,.]+)/);
  const jobTasks = visits._jobTasks || []; delete visits._jobTasks;
  return { visits: Object.values(visits), jobRecs, jobTasks, assets, labour, inventory, purchased, invItems, invoiceSubtotal: m ? num(m[1]) : null };
}

async function readJob(id) {
  const v = await readJobView(id);
  const ov = v.rid ? await readOverview(v.rid) : { visits: [], jobRecs: [], jobTasks: [], assets: [], labour: [], inventory: [], purchased: [], invItems: [], invoiceSubtotal: null };
  const visits = ov.visits.filter(x => !/cancel/i.test(x.status || "")).sort((a, b) => (a.date || "").localeCompare(b.date || "") || (a.n || 0) - (b.n || 0));
  const strip = arr => arr.map(({ cost, unit, ...r }) => r);
  const detail = {
    id, url: "https://live.buildops.com/job/view/" + id.replace(/^JO/, ""), reportUrl: v.rid ? "https://live.buildops.com/jobreport/" + v.rid : null,
    customer: v.h.customer, billTo: v.h.billTo, property: v.h.property, address: v.h.address, authorizedBy: v.h.authorizedBy,
    po: v.h.po, workOrder: v.h.workOrder, type: v.h.type, department: v.h.department, pm: v.h.pm, soldBy: v.h.soldBy,
    budgetHrs: v.h.budgetHrs, issue: v.issue,
    visits: visits.map(x => ({ ...x, id: id + "-" + x.n, labour: strip(x.labour), parts: strip(x.parts), fieldPOs: strip(x.fieldPOs), receipts: strip(x.receipts) })),
    jobRecs: ov.jobRecs, jobTasks: ov.jobTasks, assets: ov.assets,
    materials: [
      ...ov.inventory.map(m => ({ name: m.name, desc: m.desc, qty: m.qty, uom: m.uom, source: "Inventory", from: m.source })),
      ...ov.purchased.map(m => ({ name: m.name, desc: m.desc, qty: null, uom: m.uom, source: "Purchased", po: m.po, received: m.received }))
    ],
    invoiceItems: ov.invItems.filter(r => !/labou?r|travel|truck|mileage|hours?\b|trip charge|service call/i.test(r.name + " " + r.desc)).map(({ amount, ...r }) => r),
    readAt: new Date().toISOString()
  };
  const costs = {
    id, quoteSubtotal: v.h.quoteSubtotal, quoteTotal: v.h.quoteTotal, estCost: v.h.costAmount, nte: v.h.nte,
    labour: ov.labour, inventory: ov.inventory, purchased: ov.purchased,
    fieldPOs: visits.flatMap(x => x.fieldPOs.map(p => ({ ...p, visit: x.n, date: x.date }))),
    receipts: visits.flatMap(x => x.receipts.map(p => ({ ...p, visit: x.n, date: x.date }))),
    invoices: v.invoices, billedTotal: v.billedTotal, invoiceItems: ov.invItems, invoiceSubtotal: ov.invoiceSubtotal,
    readAt: detail.readAt
  };
  return { detail, costs };
}

let active = false;
async function loop() {
  if (active) return;
  active = true; S.running = true; save();
  try {
    while (S.queue.length) {
      const id = S.queue[0]; S.current = id; save();
      let r = null;
      for (let a = 0; a < 2 && !r; a++) { try { r = await readJob(id); } catch (e) { if (a) S.errors.push(id + ": " + e.message); await sleep(1500); } }
      if (r) { S.detail[id] = r.detail; S.costs[id] = r.costs; }
      S.queue.shift(); save();
    }
  } finally { active = false; S.running = false; S.current = null; S.finished = new Date().toISOString(); save(); }
}

window.alpineJobs = {
  start(ids, fresh) {
    if (fresh) { localStorage.removeItem(KEY); load(); }
    const want = (ids || []).map(String).filter(x => /^JO\d+$/.test(x));
    for (const id of want) if (!S.queue.includes(id) && !S.detail[id]) S.queue.push(id);
    save(); loop();
    return { queued: S.queue.length, done: Object.keys(S.detail).length };
  },
  // Re-read jobs even if already read this session.
  redo(ids) { (ids || []).forEach(id => { delete S.detail[id]; delete S.costs[id]; }); return this.start(ids); },
  status() { return { running: active, current: S.current, left: S.queue.length, done: Object.keys(S.detail).length, errors: S.errors.slice(-10), finished: S.finished || null }; },
  result() { return { asOf: new Date().toISOString().slice(0, 10), detail: S.detail, costs: S.costs, errors: S.errors }; },
  reset() { localStorage.removeItem(KEY); load(); return "reset"; },
  // Carries the result to the portal in window.name (same pattern as buildops-refresh.js) and opens
  // Field Operations, where an owner saves it under "Update job details". Clears local progress.
  handoff() {
    const r = this.result();
    if (!Object.keys(r.detail).length) return "nothing to hand off";
    window.name = "ALPINEJOBS:" + JSON.stringify(r);
    localStorage.removeItem(KEY);
    location.href = "https://alpinehvac.github.io/alpine-portal/ops-dashboard.html#jobs-import";
    return "handing off " + Object.keys(r.detail).length + " jobs";
  }
};
return "alpineJobs ready";
})();
