// ── Alpine HVAC — BuildOps job detail reader (read-only) ─────────────
// Run in a logged-in live.buildops.com tab (Claude in Chrome: javascript_exec):
//   1. paste this file's contents once (defines window.alpineJobs)
//   2. alpineJobs.start(["JO20261176", ...])   (returns immediately; work runs in the background)
//   3. poll alpineJobs.status() until done, then alpineJobs.handoff() (opens Field Operations with the data)
//
// For each job it opens, in this order, and reads only:
//   /job/view/<n>?tab=reports-invoices   header fields, invoices, link to the job report
//   /jobreport/<rid>                     labour by visit and tech, inventory, purchased items, invoice items
//   /jobreport/<rid>/visit/<vid>         per visit: description, techs, summary notes, recommendations,
//                                        technician notes, labour, field POs, parts, receipts, assets,
//                                        tasks, photo file names
// Safety: never clicks Save/Edit/Delete/Create/Invoice/Add; never reads Property Instructions,
// Job Notes or office notes (they can hold site access codes); numbers that look like access
// codes in technician notes are masked. Progress is kept in localStorage (__alpine_jobs), so
// calling start() again resumes.
//
// result() returns { asOf, detail: {JO..: {...}}, costs: {JO..: {...}}, errors: [...] }.
// detail = ops view (no dollars). costs = owners only (labour $, parts $, invoices).
(() => {
const KEY = "__alpine_jobs", VERSION = 1;
// Waits use a MessageChannel, not setTimeout: Chrome throttles timers in hidden or minimized tabs
// to about one a minute, which made a 57-job read take hours. MessageChannel isn't throttled.
const sleep = ms => new Promise(r => { const end = Date.now() + ms, ch = new MessageChannel(); ch.port1.onmessage = () => { if (Date.now() >= end) { ch.port1.close(); r(); } else ch.port2.postMessage(0); }; ch.port2.postMessage(0); });
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

async function readJobView(id) {
  const n = id.replace(/^JO/, "");
  nav("/job/view/" + n + "?tab=reports-invoices");
  const ok = await waitFor(() => mainText().includes("Job: " + id) && /Add Visit|Invoice #|INVOICE\(S\) ISSUED/i.test(mainText()));
  if (!ok) throw new Error("job page did not load");
  await waitFor(() => /INVOICE\(S\) ISSUED|Invoice #/i.test(mainText()), 8000);
  const rep = [...document.querySelectorAll("main a[href*='/jobreport/']")].map(a => a.getAttribute("href")).find(h => /^\/jobreport\/[0-9a-f-]+$/.test(h));
  // The visits table shows 25 rows per page: collect links and rows from every page.
  const linkMap = new Map(), rowMap = new Map();
  const grab = () => {
    document.querySelectorAll("main a[href*='/jobreport/'][href*='/visit/']").forEach(a => linkMap.set(a.getAttribute("href"), { label: a.innerText.trim(), href: a.getAttribute("href") }));
    rowsOf(tables(), ["Visit", "Status", "Technician Report"]).forEach(r => rowMap.set(String(r["Visit"]), r));
  };
  grab();
  for (let p = 0; p < 12; p++) {
    const first = document.querySelector("main a[href*='/jobreport/'][href*='/visit/']");
    if (!first) break;
    let c = first.parentElement, btn = null;
    for (let i = 0; i < 14 && c && !btn; i++) { btn = c.querySelector("button[aria-label='Go to next page'], button[aria-label='Next page']"); c = c.parentElement; }
    if (!btn || btn.disabled) break;
    const sig = first.getAttribute("href");
    btn.click();
    if (!await waitFor(() => { const f = document.querySelector("main a[href*='/jobreport/'][href*='/visit/']"); return f && f.getAttribute("href") !== sig; }, 10000)) break;
    grab();
  }
  const visitLinks = [...linkMap.values()];
  const T = tables();
  const inv = rowsOf(T, ["Invoice #", "Amount", "Status"]).map(r => ({ no: r["Invoice #"], amount: num(r["Amount"]), status: r["Status"], issued: iso(r["Issue date"]), due: iso(r["Due date"]), by: r["Created by"] }));
  const visitRows = [...rowMap.values()].map(r => ({ n: num(String(r["Visit"]).replace("#", "")), work: clean(r["Work to be performed"]), status: r["Status"], review: r["Review Status"], techReport: r["Technician Report"] }));
  return {
    rid: rep ? rep.split("/").pop() : null, visitLinks, visitRows, invoices: inv,
    h: {
      customer: field("CUSTOMER"), billTo: field("BILLING CUSTOMER"), property: field("PROPERTY"), address: field("ADDRESS"),
      authorizedBy: field("AUTHORIZED BY"), po: field("CUSTOMER PROVIDED P O NUMBER"), workOrder: field("WORK ORDER (CUSTOMER)"),
      quoteSubtotal: num(field("QUOTE SUBTOTAL")), quoteTotal: num(field("QUOTE TOTAL")), costAmount: num(field("COST AMOUNT")),
      nte: num(field("AMOUNT NOT TO EXCEED")), type: field("JOB TYPE"), pm: field("PROJECT MANAGER"), soldBy: field("SOLD BY"),
      budgetHrs: num(field("TOTAL BUDGETED HOURS")), department: field("DEPARTMENTS"), issue: field("ISSUE DESCRIPTION")
    }
  };
}

// The issue description can run several lines; field() returns only the first.
function issueText() {
  const t = mainText(); const i = t.indexOf("ISSUE DESCRIPTION"); if (i < 0) return "";
  let s = t.slice(i + 17); const end = s.search(/\n?(OFFICE NOTES|Scheduling\n|Quotes\n)/); if (end >= 0) s = s.slice(0, end);
  return mask(s.trim());
}

async function readOverview(rid) {
  nav("/jobreport/" + rid);
  const ok = await waitFor(() => /Costs\s*\n\s*Labor/i.test(mainText()) || mainText().includes("Invoice Items"));
  if (!ok) throw new Error("job report did not load");
  const T = tables();
  const labour = rowsOf(T, ["Source", "Technician", "Time Submitted"]).map(r => ({ source: r["Source"], visit: num((String(r["Source"]).match(/Visit\s+(\d+)/) || [])[1]), date: iso((String(r["Source"]).split(" - ")[1]) || ""), tech: String(r["Technician"]).replace(/\s*\(.*\)$/, ""), role: (String(r["Technician"]).match(/\((.*)\)/) || [])[1] || "", hrs: num(r["Time Submitted"]), type: r["Payroll Hour Type"], cost: num(r["Subtotal"]) }));
  const inventory = rowsOf(T, ["Source", "Item Name", "Unit Cost", "Qty"]).map(r => ({ source: r["Source"], name: r["Item Name"], desc: clean(r["Description"]), qty: num(r["Qty"]), uom: clean(r["UOM"]), unit: num(r["Unit Cost"]), cost: num(r["Subtotal"]) }));
  const purchased = rowsOf(T, ["Item Name", "Purchase Order", "Received"]).map(r => ({ name: r["Item Name"], desc: clean(r["Description"]), po: clean(r["Purchase Order"]), received: clean(r["Received"]), uom: clean(r["UOM"]), cost: num(r["Subtotal"]) }));
  const invItems = rowsOf(T, ["Item Name", "% of Invoice Amount"]).map(r => ({ invoice: String(r["Source"] || "").replace(/^Invoice\s+/, ""), name: r["Item Name"], desc: clean(r["Description"]), amount: num(r["Subtotal"]) }));
  const m = mainText().match(/Invoice Subtotal:\s*\$?([\d,.]+)/);
  return { labour, inventory, purchased, invItems, invoiceSubtotal: m ? num(m[1]) : null };
}

async function readVisit(href) {
  nav(href);
  const ok = await waitFor(() => mainText().includes("Visit Summary") && mainText().includes("Labor & Material"));
  if (!ok) throw new Error("visit report did not load: " + href);
  await waitFor(() => tables().some(t => t.H.includes("Summary Note")), 6000);
  const T = tables();
  const head = rowsOf(T, ["Visit", "Visit Status", "Description", "Primary Technician"])[0] || {};
  const vm = String(head["Visit"] || "").match(/Visit\s+(\d+)\s*-\s*(.*)$/);
  const others = clean(head["Additional technicians"]);
  return {
    id: href.split("/visit/")[1].split("/")[0],
    n: vm ? +vm[1] : null, date: vm ? iso(vm[2]) : null, status: head["Visit Status"] || "",
    desc: clean(head["Description"]), tech: clean(head["Primary Technician"]), others: others ? others.split(/,\s*/) : [],
    summaries: rowsOf(T, ["Summary Note", "Created By"]).map(r => ({ text: r["Summary Note"], by: r["Created By"], at: r["Last Edited"] })).filter(x => clean(x.text)),
    recs: rowsOf(T, ["Recommendation", "Description", "Priority"]).map(r => ({ asset: clean(r["Assets"]), title: clean(r["Recommendation"]), text: clean(r["Description"]), status: clean(r["Status"]), action: clean(r["Action Needed"]), priority: clean(r["Priority"]) })).filter(x => x.title || x.text),
    techNotes: rowsOf(T, ["Note Subject", "Note Content", "Visit Status"]).map(r => ({ subject: mask(r["Note Subject"]), text: mask(r["Note Content"]), by: r["Last Edited By"], at: r["Last Edited On"] })).filter(x => clean(x.text) || clean(x.subject)),
    labour: rowsOf(T, ["Technician", "Time Submitted", "Payroll Hour Type"]).filter(r => !r["Source"]).map(r => ({ tech: String(r["Technician"]).replace(/\s*\(.*\)$/, ""), role: (String(r["Technician"]).match(/\((.*)\)/) || [])[1] || "", hrs: num(r["Time Submitted"]), type: r["Payroll Hour Type"], cost: num(r["Subtotal"]) })),
    fieldPOs: rowsOf(T, ["Purchase Order", "PO Type", "Vendor"]).map(r => ({ po: clean(r["Purchase Order"]), status: clean(r["Status"]), vendor: clean(r["Vendor"]), desc: clean(r["Description"]), cost: num(r["Subtotal"]) })),
    parts: rowsOf(T, ["Item Name", "Unit Cost", "Qty"]).filter(r => !r["Source"]).map(r => ({ name: r["Item Name"], desc: clean(r["Description"]), qty: num(r["Qty"]), uom: clean(r["UOM"]), cost: num(r["Subtotal"]) })),
    receipts: rowsOf(T, ["Receipt", "Purchase Order", "Vendor"]).map(r => ({ receipt: clean(r["Receipt"]), po: clean(r["Purchase Order"]), vendor: clean(r["Vendor"]), desc: clean(r["Description"]), cost: num(r["Subtotal"]) })),
    assets: rowsOf(T, ["Asset Name"]).map(r => clean(r["Asset Name"])).filter(Boolean),
    tasks: rowsOf(T, ["Task", "Task Description", "Completed By"]).map(r => ({ asset: clean(r["Asset"]), task: clean(r["Task"]), desc: clean(r["Task Description"]), note: mask(clean(r["Task Note"])), completedBy: clean(r["Completed By"]) })).filter(x => x.task && x.task !== "Default Section" || x.desc),
    photos: rowsOf(T, ["File Name", "Added By"]).map(r => ({ file: r["File Name"], type: clean(r["Type"]), by: r["Added By"], at: r["Date Added"], comment: clean(r["Comment"]) }))
  };
}

async function readJob(id) {
  const v = await readJobView(id);
  const issue = issueText();
  const ov = v.rid ? await readOverview(v.rid) : { labour: [], inventory: [], purchased: [], invItems: [], invoiceSubtotal: null };
  const visits = [];
  for (const l of v.visitLinks) {
    const row = v.visitRows.find(r => "Visit #" + r.n === l.label) || {};
    if (/cancel/i.test(row.status || "")) continue;
    let x = null;
    for (let a = 0; a < 2 && !x; a++) { try { x = await readVisit(l.href); } catch (e) { if (a) S.errors.push(id + " " + l.label + ": " + e.message); } }
    if (!x) continue;
    if (/cancel/i.test(x.status)) continue;
    x.review = row.review || ""; x.submitted = clean(String(row.techReport || "").replace(/^By\s+/, ""));
    visits.push(x);
  }
  visits.sort((a, b) => (a.date || "").localeCompare(b.date || "") || (a.n || 0) - (b.n || 0));
  const strip = arr => arr.map(({ cost, unit, ...r }) => r);
  const url = "https://live.buildops.com/job/view/" + id.replace(/^JO/, "");
  const detail = {
    id, url, reportUrl: v.rid ? "https://live.buildops.com/jobreport/" + v.rid : null,
    customer: v.h.customer, billTo: v.h.billTo, property: v.h.property, address: v.h.address, authorizedBy: v.h.authorizedBy,
    po: v.h.po, workOrder: v.h.workOrder, type: v.h.type, department: v.h.department, pm: v.h.pm, soldBy: v.h.soldBy,
    budgetHrs: v.h.budgetHrs, issue: issue,
    visits: visits.map(x => ({ ...x, labour: strip(x.labour), parts: strip(x.parts), fieldPOs: strip(x.fieldPOs), receipts: strip(x.receipts) })),
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
    invoices: v.invoices, invoiceItems: ov.invItems, invoiceSubtotal: ov.invoiceSubtotal,
    readAt: detail.readAt
  };
  return { detail, costs };
}

async function loop() {
  if (S.running) return;
  S.running = true; save();
  try {
    while (S.queue.length) {
      const id = S.queue[0]; S.current = id; save();
      let r = null;
      for (let a = 0; a < 2 && !r; a++) { try { r = await readJob(id); } catch (e) { if (a) S.errors.push(id + ": " + e.message); await sleep(1500); } }
      if (r) { S.detail[id] = r.detail; S.costs[id] = r.costs; }
      S.queue.shift(); save();
    }
  } finally { S.running = false; S.current = null; S.finished = new Date().toISOString(); save(); }
}

window.alpineJobs = {
  start(ids, fresh) {
    if (fresh) { localStorage.removeItem(KEY); load(); }
    const want = (ids || []).map(String).filter(x => /^JO\d+$/.test(x));
    for (const id of want) if (!S.queue.includes(id) && !S.detail[id]) S.queue.push(id);
    S.running = false; save(); loop();
    return { queued: S.queue.length, done: Object.keys(S.detail).length };
  },
  // Re-read jobs even if already read this session.
  redo(ids) { (ids || []).forEach(id => { delete S.detail[id]; delete S.costs[id]; }); return this.start(ids); },
  status() { return { running: S.running, current: S.current, left: S.queue.length, done: Object.keys(S.detail).length, errors: S.errors.slice(-10), finished: S.finished || null }; },
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
