// ── Alpine HVAC Internal Portal — Tech mobile (tech.html) ────────────
// The phone app for field techs: the visits assigned to them, everything they
// need on site, hours against the visit, a visit summary and photos.
// Data (Firestore, see firestore.rules):
//   fs_visits/{id}                visit; techEmails[] decides who sees it
//   fs_time/{id}                  { visitId, jobNo, tech, techName, date, hours, type, note }
//   fs_reports/{visitId}__{tech}  { visitId, jobNo, tech, techName, summary }
//   fs_photos/{id}                { visitId, jobNo, tech, techName, caption, data (base64 JPEG), w, h }
// Every save shows its state on screen: "Saved", "Waiting to upload" (no signal: Firestore keeps it on
// the phone and uploads it when coverage returns) or a red error. Nothing lives only in the browser.
// DEMO: tech.html?demo=1 runs on sample visits held in memory (nothing saved), for trying it out.

import {
  collection, doc, query, where, onSnapshot, setDoc, addDoc, deleteDoc, updateDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = n => String(n).padStart(2, "0");
const ymd = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const TODAY = ymd(new Date());
const addDays = (s, n) => { const d = new Date(s + "T12:00:00"); d.setDate(d.getDate() + n); return ymd(d); };
const dayLabel = s => {
  if (!s) return "No date";
  if (s === TODAY) return "Today";
  if (s === addDays(TODAY, 1)) return "Tomorrow";
  if (s === addDays(TODAY, -1)) return "Yesterday";
  return new Date(s + "T12:00:00").toLocaleDateString("en-CA", { weekday: "long", month: "short", day: "numeric" });
};
const hrsTxt = h => (Math.round((h || 0) * 100) / 100).toString() + " h";
const STATUS = { scheduled: "Scheduled", in_progress: "In progress", complete: "Complete" };
const first = s => String(s || "").split(" ")[0];
const safeKey = s => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "_");

const DEMO = /[?&]demo=1/.test(location.search);
let SESSION = (typeof apGetSession === "function" && apGetSession()) || null;
if (DEMO && !SESSION) SESSION = { email: "demo.tech@alpinehvac.ca", name: "Demo Tech", roles: ["ops"] };
if (!SESSION) throw new Error("not signed in");
const ME = SESSION.email, MY_NAME = SESSION.name || ME;
const OFFICE = (SESSION.roles || []).some(r => r === "field_ops" || r === "owner");
const OWNER = DEMO || (SESSION.roles || []).includes("owner"); // owners set the time rules

$("who").textContent = (DEMO ? "Demo · " : "") + MY_NAME + (OFFICE ? " · office view" : "");
document.title = "My Visits · Alpine HVAC";

// ── UI helpers ──
function toast(t, bad) { const el = $("toast"); el.textContent = t; el.className = "toast" + (bad ? " bad" : ""); el.style.display = "block"; clearTimeout(toast._t); toast._t = setTimeout(() => el.style.display = "none", bad ? 6000 : 3000); }
let PENDING = 0;
function syncUi() {
  const s = $("sync"), t = $("sync-t");
  if (!navigator.onLine) { s.className = "sync off"; t.textContent = PENDING ? PENDING + " waiting · no signal" : "No signal"; }
  else if (PENDING) { s.className = "sync wait"; t.textContent = "Uploading " + PENDING; }
  else { s.className = "sync"; t.textContent = DEMO ? "Demo" : "Saved"; }
}
addEventListener("online", syncUi); addEventListener("offline", syncUi);
window.addEventListener("beforeunload", e => { if (PENDING && navigator.onLine) { e.preventDefault(); e.returnValue = ""; } });

// Runs one save and reports it: el (optional) gets the status line. Resolves true/false.
async function save(work, el, okText) {
  PENDING++; syncUi();
  const mark = (cls, txt) => { if (el) { el.className = "saved " + cls; el.textContent = txt; } };
  mark("wait", navigator.onLine ? "Saving…" : "Saved on this phone. It will upload when you're back in coverage.");
  const slow = setTimeout(() => mark("wait", "Saved on this phone. Waiting for a signal to upload…"), 4000);
  try {
    await work();
    clearTimeout(slow);
    mark("ok", (okText || "Saved") + " · " + new Date().toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" }));
    return true;
  } catch (e) {
    clearTimeout(slow);
    console.error(e);
    const why = /permission/i.test(e.code || e.message) ? "You don't have access to save this. Tell the office." : "Couldn't save. Check your signal and try again.";
    mark("bad", why); toast(why, true);
    return false;
  } finally { PENDING--; syncUi(); }
}

// ── Data layer: Firestore, or the in-memory demo ──
let store;
async function firestoreStore() {
  const { db } = await import("./ap-firebase.js");
  const C = n => collection(db, n);
  const mine = (n, extra) => OFFICE ? query(C(n), ...extra) : query(C(n), ...extra, where("tech", "==", ME));
  const live = (q, cb, onErr) => onSnapshot(q, snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data(), _pending: d.metadata.hasPendingWrites }))), onErr);
  return {
    visits(cb, onErr) {
      const q = OFFICE ? query(C("fs_visits"), where("date", ">=", addDays(TODAY, -45))) : query(C("fs_visits"), where("techEmails", "array-contains", ME));
      return live(q, cb, onErr);
    },
    time: (visitId, cb, onErr) => live(mine("fs_time", [where("visitId", "==", visitId)]), cb, onErr),
    myTime: (cb, onErr) => live(query(C("fs_time"), where("tech", "==", ME)), cb, onErr),
    resetPassword: async () => { const m = await import("./ap-firebase.js"); return m.sendPasswordResetEmail(m.auth, ME); },
    photos: (visitId, cb, onErr) => live(mine("fs_photos", [where("visitId", "==", visitId)]), cb, onErr),
    report: (visitId, cb, onErr) => onSnapshot(doc(db, "fs_reports", visitId + "__" + safeKey(ME)), s => cb(s.exists() ? s.data() : null), onErr),
    setStatus: (v, status) => updateDoc(doc(db, "fs_visits", v.id), { status, statusAt: new Date().toISOString(), statusBy: ME, updatedAt: serverTimestamp() }),
    addTime: rec => addDoc(C("fs_time"), { ...rec, createdAt: serverTimestamp() }),
    delTime: id => deleteDoc(doc(db, "fs_time", id)),
    saveReport: (v, summary) => setDoc(doc(db, "fs_reports", v.id + "__" + safeKey(ME)), { visitId: v.id, jobNo: v.jobNo || "", tech: ME, techName: MY_NAME, summary, updatedAt: serverTimestamp() }, { merge: true }),
    addPhoto: rec => addDoc(C("fs_photos"), { ...rec, createdAt: serverTimestamp() }),
    delPhoto: id => deleteDoc(doc(db, "fs_photos", id)),
    addVisit: rec => addDoc(C("fs_visits"), { ...rec, createdAt: serverTimestamp(), createdBy: ME, updatedAt: serverTimestamp() }),
    // Time clock: one running clock per tech (fs_clock/{tech}); company time rules in fs_settings/time
    clock: (cb, onErr) => onSnapshot(doc(db, "fs_clock", safeKey(ME)), s => cb(s.exists() ? s.data() : null), onErr),
    setClock: c => setDoc(doc(db, "fs_clock", safeKey(ME)), { ...c, tech: ME, techName: MY_NAME, updatedAt: serverTimestamp() }),
    clearClock: () => deleteDoc(doc(db, "fs_clock", safeKey(ME))),
    settings: (cb, onErr) => onSnapshot(doc(db, "fs_settings", "time"), s => cb(s.exists() ? s.data() : null), onErr),
    saveSettings: o => setDoc(doc(db, "fs_settings", "time"), { ...o, updatedBy: ME, updatedAt: serverTimestamp() }, { merge: true }),
  };
}

function demoStore() {
  const subs = new Set(), wait = () => new Promise(r => setTimeout(r, 350));
  const D = { visits: [], time: [], photos: [], reports: {}, clock: null, settings: null };
  const emit = () => subs.forEach(f => f());
  const sub = f => { subs.add(f); f(); return () => subs.delete(f); };
  let n = 1; const id = () => "demo" + (n++);
  const v = (o) => ({ id: id(), status: "scheduled", techEmails: [ME], techNames: [MY_NAME], ...o });
  D.visits.push(
    v({ date: TODAY, time: "8:00 AM", durationHrs: 3, visitType: "Service call", title: "RTU-2 not cooling", jobNo: "JO-DEMO-101", customer: "Lakeview Medical Centre", site: "Main building", address: "120 Lakeshore Rd, St. Catharines, ON", contactName: "Paula Reyes (facilities)", contactPhone: "905-555-0142", scope: "RTU-2 not cooling. Tenant reports warm air on the 2nd floor east side since yesterday afternoon. Check refrigerant charge and condenser fan motor.", equipmentNotes: "Roof access by the east stairwell. Sign in at security first.", equipment: [{ name: "RTU-2", make: "Carrier", model: "48TC 7.5 ton", serial: "4519G20871" }] }),
    v({ date: TODAY, time: "1:00 PM", durationHrs: 4, visitType: "Maintenance", title: "Quarterly PM, boilers and MUA", jobNo: "SA1024-3", customer: "Harbour Street Lofts", site: "Mechanical room B1", address: "45 Harbour St, Port Dalhousie, ON", contactName: "Sam Ito (superintendent)", contactPhone: "905-555-0177", scope: "Quarterly maintenance: boilers 1 and 2, pumps, filters on the make-up air unit.", equipmentNotes: "Boiler 2 had a low-water alarm last quarter. Check the probe.", equipment: [{ name: "Boiler 1", make: "Viessmann", model: "Vitocrossal 300", serial: "7514388" }, { name: "Boiler 2", make: "Viessmann", model: "Vitocrossal 300", serial: "7514391" }] }),
    v({ date: addDays(TODAY, 1), time: "9:30 AM", durationHrs: 2, visitType: "Service call", title: "EF-4 motor replacement", jobNo: "JO-DEMO-108", customer: "Northgate Public School", site: "Gym wing", address: "300 Northgate Ave, Welland, ON", contactName: "Front office", contactPhone: "905-555-0110", scope: "Replace the failed exhaust fan motor on EF-4 (part on the truck).", equipmentNotes: "", equipment: [{ name: "EF-4", make: "Greenheck", model: "CUE-140", serial: "" }] }),
    v({ date: addDays(TODAY, -1), time: "10:00 AM", durationHrs: 1, visitType: "Service call", title: "Room 214 too warm", jobNo: "JO-DEMO-099", customer: "Lakeview Medical Centre", site: "Main building", address: "120 Lakeshore Rd, St. Catharines, ON", contactName: "Paula Reyes", contactPhone: "905-555-0142", scope: "Thermostat call, room 214.", status: "complete" }),
  );
  D.visits.push(v({ date: addDays(TODAY, -3), time: "12:00 AM", durationHrs: 24, visitType: "NonBillable", title: "On-Call (Escalation)", customer: "Alpine HVAC", site: "On-call rotation", scope: "Weekend on-call. Log any calls you take." }));
  D.time.push({ id: id(), visitId: D.visits[3].id, tech: ME, techName: MY_NAME, date: addDays(TODAY, -1), hours: 1.5, type: "Regular", note: "" });
  D.reports[D.visits[3].id] = { summary: "Replaced the batteries in the room 214 thermostat and recalibrated. Room holding 22°C." };
  return {
    visits: cb => sub(() => cb(D.visits.slice())),
    time: (vid, cb) => sub(() => cb(D.time.filter(t => t.visitId === vid))),
    myTime: cb => sub(() => cb(D.time.filter(t => t.tech === ME))),
    resetPassword: async () => { await wait(); },
    photos: (vid, cb) => sub(() => cb(D.photos.filter(p => p.visitId === vid))),
    report: (vid, cb) => sub(() => cb(D.reports[vid] || null)),
    setStatus: async (v, status) => { await wait(); Object.assign(D.visits.find(x => x.id === v.id), { status }); emit(); },
    addTime: async rec => { await wait(); D.time.push({ id: id(), ...rec }); emit(); },
    delTime: async tid => { await wait(); D.time = D.time.filter(t => t.id !== tid); emit(); },
    saveReport: async (v, summary) => { await wait(); D.reports[v.id] = { summary }; emit(); },
    addPhoto: async rec => { await wait(); D.photos.push({ id: id(), ...rec }); emit(); },
    delPhoto: async pid => { await wait(); D.photos = D.photos.filter(p => p.id !== pid); emit(); },
    addVisit: async rec => { await wait(); D.visits.push({ id: id(), ...rec }); emit(); },
    clock: cb => sub(() => cb(D.clock)),
    setClock: async c => { await wait(); D.clock = { ...c, tech: ME }; emit(); },
    clearClock: async () => { await wait(); D.clock = null; emit(); },
    settings: cb => sub(() => cb(D.settings)),
    saveSettings: async o => { await wait(); D.settings = { ...(D.settings || {}), ...o }; emit(); },
  };
}

// ── State + routing (#v=<id> opens a visit, #timesheets my hours, #schedule calendar) ──
// FROM: the screen a visit was opened from, so its back button returns there.
let VISITS = [], LOADED = false, TOP = "scheduled", WHEN = "today", ALL = false, Q = "", unsub = [], BANNER = "", FROM = "";
const route = () => { const m = location.hash.match(/v=([^&]+)/); return m ? decodeURIComponent(m[1]) : null; };
window.addEventListener("hashchange", render);

function banner() {
  let h = "";
  if (DEMO) h += `<div class="banner warn"><b>Demo.</b> These are sample visits. Nothing you enter is saved, and it all resets when you reload.</div>`;
  if (BANNER) h += BANNER;
  return h;
}

function render() {
  unsub.forEach(f => { try { f(); } catch (e) {} }); unsub = [];
  closeDrawer();
  const H = location.hash, page = H === "#timesheets" || H === "#schedule" || H === "#settings" ? H.slice(1) : "";
  document.querySelectorAll("[data-go]").forEach(a => a.classList.toggle("on", a.dataset.go === page));
  if (H === "#timesheets") { FROM = ""; return renderTimesheets(); }
  if (H === "#settings") { FROM = ""; return renderSettings(); }
  if (H === "#schedule") { FROM = "schedule"; return renderSchedule(); }
  const id = route();
  if (id) return renderVisit(id);
  FROM = ""; renderList();
}

// ── List (laid out like the BuildOps app: Scheduled Visits / Open Work, Past / Today / Future) ──
const overdueDays = v => v.status !== "complete" && v.date && v.date < TODAY ? Math.round((new Date(TODAY + "T12:00:00") - new Date(v.date + "T12:00:00")) / 864e5) : 0;
const DAYH = s => s ? new Date(s + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "2-digit" }).replace(",", "") : "No date";
function inView(v) {
  if (TOP === "open") return v.status !== "complete" && (v.status === "in_progress" || (v.date || "") <= TODAY);
  if (WHEN === "past") return (v.date || "") < TODAY;
  if (WHEN === "today") return v.date === TODAY;
  return (v.date || "") > TODAY;
}
function card(v) {
  const od = overdueDays(v), st = v.status || "scheduled";
  const hrs = v.durationHrs ? `<small>◷ ${esc(v.durationHrs)} hr${v.durationHrs == 1 ? "" : "s"}</small>` : "";
  return `<a class="vc ${od ? "overdue" : esc(st)}" href="#v=${encodeURIComponent(v.id)}"><span class="bar"></span><div class="body">
    <div class="l1"><span>${esc(STATUS[st])}</span>${od ? `<span class="od">${od} day${od > 1 ? "s" : ""} overdue</span>` : ""}</div>
    ${v.visitType ? `<div class="ty">${esc(v.visitType)}</div>` : ""}
    <div class="mid"><div class="ti">${esc(v.title || v.customer || "Visit")}</div><div class="tm">${esc(v.time || "")}${hrs}</div></div>
    <div class="sub">${esc([v.title ? v.customer : "", v.site, short(v.address)].filter(Boolean).join(" · "))}${v.jobNo ? `<br>${esc(v.jobNo)}` : ""}${ALL || (v.techNames || []).length > 1 ? ` · ${esc((v.techNames || []).map(first).join(", "))}` : ""}</div>
  </div></a>`;
}
function renderList() {
  $("title").firstChild.textContent = "My Visits";
  const pool = VISITS.filter(v => ALL || (v.techEmails || []).includes(ME));
  const q = Q.trim().toLowerCase();
  const hit = v => !q || [v.jobNo, v.customer, v.site, v.address, v.title, v.scope].join(" ").toLowerCase().includes(q);
  const openN = pool.filter(v => { const t = TOP; TOP = "open"; const r = inView(v); TOP = t; return r; }).length;
  let list = pool.filter(v => inView(v) && hit(v));
  const desc = TOP === "scheduled" && WHEN === "past";
  list.sort((a, b) => (desc ? -1 : 1) * ((a.date || "").localeCompare(b.date || "") || tmin(a.time) - tmin(b.time)));
  if (desc) list = list.slice(0, 60);
  let h = `<div class="toptabs" role="tablist"><button data-top="scheduled" class="${TOP === "scheduled" ? "on" : ""}">Scheduled Visits</button><button data-top="open" class="${TOP === "open" ? "on" : ""}">Open Work${openN ? `<span>${openN}</span>` : ""}</button></div>` + banner();
  if (TOP === "scheduled") h += `<div class="tabs" role="tablist">${[["past", "Past"], ["today", "Today"], ["future", "Future"]].map(([k, l]) => `<button role="tab" data-when="${k}" class="${WHEN === k ? "on" : ""}" aria-selected="${WHEN === k}">${l}</button>`).join("")}</div>`;
  h += `<div class="search"><input id="q" type="search" placeholder="Search Job #, Property, Customer…" value="${esc(Q)}" aria-label="Search visits"></div>`;
  if (OFFICE) h += `<div class="tools"><label><input type="checkbox" id="all-t" ${ALL ? "checked" : ""}> Show every tech</label></div>`;
  if (!LOADED) h += `<div class="empty">Loading your visits…</div>`;
  else if (!list.length) h += `<div class="empty">${q ? "Nothing matches that search." : TOP === "open" ? "No open work. Nice." : WHEN === "today" ? "Nothing scheduled for today." : WHEN === "future" ? "No upcoming visits yet." : "No past visits."}${OFFICE || q ? "" : "<br>New visits show up here as soon as the office assigns them."}</div>`;
  else { let last = null; list.forEach(v => { const d = DAYH(v.date); if (d !== last) { h += `<div class="dayh">${esc(d)}</div>`; last = d; } h += card(v); }); }
  if (OFFICE) h += `<button class="fab" id="new-v" aria-label="New visit">+</button>`;
  $("app").innerHTML = h;
  document.querySelectorAll("[data-top]").forEach(b => b.onclick = () => { TOP = b.dataset.top; renderList(); });
  document.querySelectorAll("[data-when]").forEach(b => b.onclick = () => { WHEN = b.dataset.when; renderList(); });
  const qi = $("q"); qi.oninput = () => { Q = qi.value; const pos = qi.selectionStart; renderList(); const n = $("q"); n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) {} };
  if ($("new-v")) $("new-v").onclick = openNewVisit;
  if ($("all-t")) $("all-t").onchange = e => { ALL = e.target.checked; renderList(); };
}

// ── Timesheets: my hours by week ──
function renderTimesheets() {
  $("title").firstChild.textContent = "Timesheets";
  $("app").innerHTML = banner() + `<div class="empty">Loading your hours…</div>`;
  unsub.push(store.myTime(rows => {
    const wk = d => { const x = new Date((d || TODAY) + "T12:00:00"); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return ymd(x); };
    const weeks = {};
    rows.forEach(r => { (weeks[wk(r.date)] = weeks[wk(r.date)] || []).push(r); });
    const keys = Object.keys(weeks).sort().reverse().slice(0, 8);
    let h = banner();
    if (!keys.length) h += `<div class="empty">No hours logged yet. Hours you add on a visit show up here.</div>`;
    keys.forEach(k => {
      const R = weeks[k].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
      const tot = R.reduce((s, r) => s + (r.hours || 0), 0);
      h += `<div class="sec ts-week"><h3><span>Week of ${esc(new Date(k + "T12:00:00").toLocaleDateString("en-CA", { month: "long", day: "numeric" }))}</span><span class="st hrs-total">${hrsTxt(tot)}</span></h3>${R.map(r => `<a class="row" href="#v=${encodeURIComponent(r.visitId)}" style="text-decoration:none;color:inherit"><div class="grow"><b>${hrsTxt(r.hours)}</b> ${esc(r.type || "")}<small>${esc(dayLabel(r.date))} · ${esc(r.customer || r.jobNo || "Visit")}${r.note ? " · " + esc(r.note) : ""}${r._pending ? " · waiting to upload" : ""}</small></div><span class="dim">›</span></a>`).join("")}</div>`;
    });
    $("app").innerHTML = h;
  }, subErr));
}
// ── Schedule: my visits on a calendar (Week / 2 Weeks / Month), weeks run Monday to Sunday ──
const monday = s => { const x = new Date(s + "T12:00:00"); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return ymd(x); };
const fmtD = (s, o) => new Date(s + "T12:00:00").toLocaleDateString("en-US", o);
const stCls = v => overdueDays(v) ? "overdue" : esc(v.status || "scheduled");
const SCH = { mode: "week", start: monday(TODAY), month: TODAY.slice(0, 8) + "01", day: TODAY };
function renderSchedule() {
  $("title").firstChild.textContent = "Schedule";
  const byDay = {};
  VISITS.filter(v => v.date && (ALL || (v.techEmails || []).includes(ME))).forEach(v => (byDay[v.date] = byDay[v.date] || []).push(v));
  Object.values(byDay).forEach(L => L.sort((a, b) => tmin(a.time) - tmin(b.time)));
  const who = v => ALL || (v.techNames || []).length > 1 ? " · " + (v.techNames || []).map(first).join(", ") : "";
  const open = v => `href="#v=${encodeURIComponent(v.id)}"`;
  const M = SCH.mode, span = M === "week" ? 7 : 14, unit = M === "month" ? "month" : M === "week" ? "week" : "2 weeks";
  const label = M === "month" ? fmtD(SCH.month, { month: "long", year: "numeric" })
    : fmtD(SCH.start, { month: "short", day: "numeric" }) + " – " + fmtD(addDays(SCH.start, span - 1), { month: "short", day: "numeric", year: "numeric" });
  let h = banner() + `<div class="tabs" role="tablist">${[["week", "Week"], ["2w", "2 Weeks"], ["month", "Month"]].map(([k, l]) => `<button role="tab" data-sm="${k}" class="${M === k ? "on" : ""}" aria-selected="${M === k}">${l}</button>`).join("")}</div>`;
  if (OFFICE) h += `<div class="tools"><label><input type="checkbox" id="all-t" ${ALL ? "checked" : ""}> Show every tech</label></div>`;
  h += `<div class="snav"><button data-nav="-1" aria-label="Previous ${unit}">‹</button><h2>${esc(label)}</h2><button class="tdy" data-nav="0">Today</button><button data-nav="1" aria-label="Next ${unit}">›</button></div>`;
  h += `<div class="legend">${[["scheduled", "Scheduled"], ["in_progress", "In progress"], ["overdue", "Overdue"], ["complete", "Complete"]].map(([c, l]) => `<span class="${c}"><i class="dot"></i>${l}</span>`).join("")}</div>`;
  if (!LOADED) h += `<div class="empty">Loading your visits…</div>`;
  else if (M !== "month") {
    for (let i = 0; i < span; i++) {
      const d = addDays(SCH.start, i), L = byDay[d] || [], t = d === TODAY;
      if (i === 7) h += `<div class="wk-gap"></div>`;
      h += `<div class="sd${t ? " today" : ""}"${t ? ' aria-current="date"' : ""}><div class="sd-h"><small>${fmtD(d, { weekday: "short" })}</small><b>${+d.slice(8)}</b><small>${fmtD(d, { month: "short" })}</small></div><div class="sd-v">`
        + (L.length ? L.map(v => `<a class="sc ${stCls(v)}" ${open(v)}><b>${esc(v.time || "Any time")}</b>${esc((v.title || v.customer || "Visit") + who(v))}</a>`).join("") : `<span class="sd-none">Nothing booked</span>`) + `</div></div>`;
    }
  } else {
    const mo = SCH.month.slice(0, 7), x = new Date(SCH.month + "T12:00:00"); x.setMonth(x.getMonth() + 1); x.setDate(0);
    const last = ymd(x);
    h += `<div class="mg">` + ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(w => `<div class="wd">${w}</div>`).join("");
    let d = monday(SCH.month);
    do {
      for (let i = 0; i < 7; i++, d = addDays(d, 1)) {
        const L = byDay[d] || [];
        const dots = L.slice(0, 4).map(v => `<i class="dot ${stCls(v)}"></i>`).join("") + (L.length > 4 ? `<span>+${L.length - 4}</span>` : "");
        h += `<button data-day="${d}" class="${d.slice(0, 7) !== mo ? "out " : ""}${d === TODAY ? "today " : ""}${d === SCH.day ? "sel" : ""}" aria-pressed="${d === SCH.day}" aria-label="${fmtD(d, { weekday: "long", month: "long", day: "numeric" })}: ${L.length ? L.length + " visit" + (L.length > 1 ? "s" : "") : "nothing booked"}"><span class="n">${+d.slice(8)}</span><span class="dots">${dots}</span></button>`;
      }
    } while (d <= last);
    const L = byDay[SCH.day] || [];
    h += `</div><div class="dayh" style="margin-top:1rem">${esc(DAYH(SCH.day))}</div>`
      + (L.length ? L.map(v => `<a class="sl ${stCls(v)}" ${open(v)}><span class="t">${esc(v.time || "Any time")}</span><span class="w"><b>${esc(v.title || v.customer || "Visit")}</b><small>${esc([v.title ? v.customer : "", v.site].filter(Boolean).join(" · ") + who(v))}</small></span></a>`).join("") : `<div class="sd-none">Nothing booked</div>`);
  }
  $("app").innerHTML = h;
  document.querySelectorAll("[data-sm]").forEach(b => b.onclick = () => {
    const to = b.dataset.sm;
    if (to === SCH.mode) return;
    // Week → Month lands on today if it's in view, else the first day shown. Month → Week shows the picked day's week.
    if (to === "month") { SCH.day = TODAY >= SCH.start && TODAY <= addDays(SCH.start, span - 1) ? TODAY : SCH.start; SCH.month = SCH.day.slice(0, 8) + "01"; }
    else if (SCH.mode === "month") SCH.start = monday(SCH.day);
    SCH.mode = to; renderSchedule();
  });
  document.querySelectorAll("[data-nav]").forEach(b => b.onclick = () => {
    const k = +b.dataset.nav;
    if (!k) { SCH.start = monday(TODAY); SCH.month = TODAY.slice(0, 8) + "01"; SCH.day = TODAY; }
    else if (SCH.mode === "month") { const m = new Date(SCH.month + "T12:00:00"); m.setMonth(m.getMonth() + k); SCH.month = ymd(m); SCH.day = SCH.month.slice(0, 7) === TODAY.slice(0, 7) ? TODAY : SCH.month; }
    else SCH.start = addDays(SCH.start, k * span);
    renderSchedule();
  });
  document.querySelectorAll("[data-day]").forEach(b => b.onclick = () => { SCH.day = b.dataset.day; SCH.month = SCH.day.slice(0, 8) + "01"; renderSchedule(); });
  if ($("all-t")) $("all-t").onchange = e => { ALL = e.target.checked; renderSchedule(); };
}
const short = a => String(a || "").replace(/,\s*(ON|Ontario)\b.*$/i, "").replace(/,\s*CA(nada)?$/i, "");
const tmin = t => { const m = String(t || "").match(/(\d{1,2}):?(\d{2})?\s*([ap])?/i); if (!m) return 9999; let h = +m[1] % 12; if (/p/i.test(m[3] || "")) h += 12; return h * 60 + (+m[2] || 0); };

// ── Time clock ──
// The tech taps On my way → Start work → Lunch / Coffee → Resume → Complete. Each tap is an event with the
// phone's time (so it works with no signal). At the end the app works out paid hours from the company's
// time rules (fs_settings/time, set by owners under ☰ > Time rules) and the tech checks them before saving.
const TIME_DEFAULTS = {
  travelPaid: true,          // drive time between jobs is paid
  travelBillable: true,      // and charged to the customer
  firstTripPaid: true,       // the first drive of the day (from home) is paid
  lunchPaid: false,          // lunch break is unpaid
  coffeePaid: true,          // short coffee breaks are paid…
  coffeeMaxMin: 15,          // …up to this many minutes each; anything longer is unpaid
  roundTo: 15,               // round each entry to this many minutes (0 = exact)
  roundMode: "nearest",      // nearest | up | down
  breakReminderMin: 45,      // remind a tech whose break has run this long
  clockReminderHours: 10,    // remind a tech whose clock has run this many hours
};
let CLOCK = null, TIMECFG = { ...TIME_DEFAULTS }, MYTIME = [];
const STATE_LABEL = { travel: "On the way", work: "Working", lunch: "On lunch", coffee: "Coffee break" };
const mins = ms => Math.max(0, ms / 60000);
const hm = m => { m = Math.round(m); const h = Math.floor(m / 60); return h ? `${h}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`; };
const clockTxt = ms => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };
function roundMin(m, cfg) {
  const r = +cfg.roundTo || 0; if (!r) return Math.round(m);
  const f = cfg.roundMode === "up" ? Math.ceil : cfg.roundMode === "down" ? Math.floor : Math.round;
  return f(m / r) * r;
}
// Totals for a clock: minutes in each state, and what's paid under the rules.
function clockTotals(c, cfg, endAt = Date.now()) {
  const ev = (c && c.events) || [], t = { travel: 0, work: 0, lunch: 0, coffee: 0, coffeePaid: 0 };
  ev.forEach((e, i) => {
    const end = i + 1 < ev.length ? Date.parse(ev[i + 1].at) : endAt, m = mins(end - Date.parse(e.at));
    if (t[e.s] === undefined) return;
    t[e.s] += m;
    if (e.s === "coffee") t.coffeePaid += cfg.coffeePaid ? Math.min(m, +cfg.coffeeMaxMin || 0) : 0;
  });
  const travelPaid = cfg.travelPaid && !(c.firstOfDay && !cfg.firstTripPaid) ? t.travel : 0;
  const workPaid = t.work + (cfg.lunchPaid ? t.lunch : 0) + t.coffeePaid;
  return { ...t, travelPaid, workPaid, workH: roundMin(workPaid, cfg) / 60, travelH: roundMin(travelPaid, cfg) / 60 };
}
const lastEvent = c => (c && c.events && c.events.length) ? c.events[c.events.length - 1] : null;

function clockPanel(v) {
  const st = v.status || "scheduled";
  if (CLOCK && CLOCK.visitId && CLOCK.visitId !== v.id) {
    const other = VISITS.find(x => x.id === CLOCK.visitId);
    return `<div class="clock idle"><div class="cl-state">Your clock is running on another visit</div><div class="cl-sub">${esc(STATE_LABEL[CLOCK.state] || "")} · ${esc(other ? (other.title || other.customer) : CLOCK.customer || "another visit")}</div><a class="big ghost" style="display:flex;align-items:center;justify-content:center;text-decoration:none;margin-top:.7rem" href="#v=${encodeURIComponent(CLOCK.visitId)}">Go to that visit</a></div>`;
  }
  if (!CLOCK || CLOCK.visitId !== v.id) {
    if (st === "complete") return `<div class="statusbar"><button class="big ghost" data-st="in_progress">Reopen visit</button></div>`;
    return `<div class="clock idle"><div class="cl-row"><button class="big" data-clk="travel">🚚 On my way</button></div><div class="cl-row"><button class="big ghost" data-clk="work">Already here, start work</button></div></div>`;
  }
  const e = lastEvent(CLOCK), tot = clockTotals(CLOCK, TIMECFG), brk = CLOCK.state === "lunch" || CLOCK.state === "coffee";
  const paidNote = CLOCK.state === "lunch" ? (TIMECFG.lunchPaid ? "Lunch is paid" : "Lunch is unpaid") : CLOCK.state === "coffee" ? (TIMECFG.coffeePaid ? `Paid up to ${TIMECFG.coffeeMaxMin} min` : "Coffee breaks are unpaid") : CLOCK.state === "travel" ? (TIMECFG.travelPaid ? (CLOCK.firstOfDay && !TIMECFG.firstTripPaid ? "First drive of the day is unpaid" : "Drive time is paid") : "Drive time is unpaid") : "";
  let btns = "";
  if (CLOCK.state === "travel") btns = `<button class="big" data-clk="work">Arrived, start work</button><button class="linkbtn" data-clk="cancel">Cancel trip</button>`;
  else if (CLOCK.state === "work") btns = `<div class="cl-row two"><button class="big ghost" data-clk="lunch">🥪 Lunch</button><button class="big ghost" data-clk="coffee">☕ Coffee</button></div><button class="big done" data-clk="complete">Complete visit</button><button class="linkbtn" data-clk="leave">Leave site, coming back later</button>`;
  else if (brk) btns = `<button class="big" data-clk="work">Back to work</button>`;
  return `<div class="clock ${esc(CLOCK.state)}" aria-live="polite">
    <div class="cl-state">${esc(STATE_LABEL[CLOCK.state] || "")}</div>
    <div class="cl-time" id="clk-t">${clockTxt(Date.now() - Date.parse(e.at))}</div>
    <div class="cl-sub">${paidNote ? esc(paidNote) + " · " : ""}<span id="clk-tot">${totLine(tot)}</span></div>
    ${btns}</div>`;
}
const totLine = t => [t.travel ? "Drive " + hm(t.travel) : "", t.work ? "Work " + hm(t.work) : "", t.lunch + t.coffee ? "Breaks " + hm(t.lunch + t.coffee) : ""].filter(Boolean).join(" · ") || "Just started";

async function clockAction(v, a) {
  const now = new Date().toISOString();
  const base = { visitId: v.id, jobNo: v.jobNo || "", customer: v.customer || "", visitTitle: v.title || "" };
  if (a === "travel" || (a === "work" && (!CLOCK || CLOCK.visitId !== v.id))) {
    const firstOfDay = !MYTIME.some(r => r.date === TODAY && (r.type === "Travel" || r.type === "Regular"));
    const ok = await save(() => store.setClock({ ...base, state: a, startedAt: now, date: TODAY, firstOfDay, events: [{ s: a, at: now }] }), $("st-saved"), a === "travel" ? "Clock started: on the way" : "Clock started: working");
    if (ok && (v.status || "scheduled") === "scheduled") save(() => store.setStatus(v, "in_progress"));
    return;
  }
  if (a === "cancel") { if (confirm("Cancel this trip? The drive time won't be recorded.")) save(() => store.clearClock(), $("st-saved"), "Trip cancelled"); return; }
  if (a === "complete" || a === "leave") return reviewHours(v, a === "complete");
  if (CLOCK.state === a) return;
  save(() => store.setClock({ ...CLOCK, state: a, events: [...(CLOCK.events || []), { s: a, at: now }] }), $("st-saved"), a === "work" ? "Back to work" : STATE_LABEL[a] + " started");
}

// End of visit (or leaving to come back): show the hours worked out from the clock, let the tech fix them, then save.
function reviewHours(v, complete) {
  const endAt = Date.now(), t = clockTotals(CLOCK, TIMECFG, endAt), cfg = TIMECFG;
  const line = (l, m, paid) => m ? `<div class="row"><div class="grow">${l}</div><b>${hm(m)}</b><small style="margin-left:.5rem">${paid}</small></div>` : "";
  const sh = $("sheet");
  $("sheet-in").innerHTML = `<h3 id="sheet-h">${complete ? "Complete visit" : "Leave site"}: check your hours</h3>
    <div class="sec">
      ${line("Drive", t.travel, t.travelPaid ? "paid" : "unpaid")}
      ${line("Work", t.work, "paid")}
      ${line("Lunch", t.lunch, cfg.lunchPaid ? "paid" : "unpaid")}
      ${line("Coffee", t.coffee, t.coffeePaid >= t.coffee - 0.5 ? (t.coffee ? "paid" : "") : hm(t.coffeePaid) + " paid")}
    </div>
    <p class="cl-sub" style="margin:-.3rem 0 .8rem">Rounded to ${cfg.roundTo ? cfg.roundTo + " minutes (" + cfg.roundMode + ")" : "the minute"}. Change anything that's not right.</p>
    <div class="two"><label class="field"><span>Work hours</span><input class="inp" id="r-work" inputmode="decimal" value="${+t.workH.toFixed(2)}"></label><label class="field"><span>Drive hours${cfg.travelBillable ? " (billable)" : ""}</span><input class="inp" id="r-trav" inputmode="decimal" value="${+t.travelH.toFixed(2)}"></label></div>
    <label class="field"><span>Note (optional)</span><input class="inp" id="r-note" placeholder="${complete ? "" : "e.g. back tomorrow with the part"}"></label>
    <div class="btnrow"><button class="big ghost" id="r-cancel">Keep clock running</button><button class="big ${complete ? "done" : ""}" id="r-save">Save hours${complete ? " and complete" : ""}</button></div><div class="saved" id="r-saved"></div>`;
  sh.classList.add("on");
  $("r-cancel").onclick = () => sh.classList.remove("on");
  $("r-save").onclick = async () => {
    const wH = Math.max(0, parseFloat($("r-work").value) || 0), tH = Math.max(0, parseFloat($("r-trav").value) || 0);
    if (wH > 24 || tH > 24) { toast("That's more than 24 hours. Check the numbers.", true); return; }
    if (complete && !SUMMARY_SAVED && !confirm("You haven't saved a visit summary yet. Complete the visit anyway?")) return;
    const note = $("r-note").value.trim(), detail = `Clock: ${totLine(t)}`;
    const common = { visitId: v.id, jobNo: v.jobNo || "", customer: v.customer || "", tech: ME, techName: MY_NAME, date: CLOCK.date || TODAY, source: "clock", clockStart: CLOCK.startedAt, clockEnd: new Date(endAt).toISOString() };
    const ok = await save(async () => {
      if (wH) await store.addTime({ ...common, hours: wH, type: "Regular", note: [note, detail].filter(Boolean).join(" · "), breaks: { lunchMin: Math.round(t.lunch), coffeeMin: Math.round(t.coffee), lunchPaid: !!cfg.lunchPaid } });
      if (tH) await store.addTime({ ...common, hours: tH, type: "Travel", billable: !!cfg.travelBillable, note: note || "" });
      await store.clearClock();
      if (complete) await store.setStatus(v, "complete");
    }, $("r-saved"), complete ? "Visit completed" : "Hours saved");
    if (ok) { sh.classList.remove("on"); if (document.activeElement) document.activeElement.blur(); render(); toast(complete ? `Visit completed · ${wH + tH} h saved` : `${wH + tH} h saved · clock stopped`); }
  };
}

// Live timer + reminders while a clock is running.
let remindedKey = "";
setInterval(() => {
  if (!CLOCK) return;
  const e = lastEvent(CLOCK); if (!e) return;
  const el = $("clk-t"); if (el) el.textContent = clockTxt(Date.now() - Date.parse(e.at));
  const tt = $("clk-tot"); if (tt) tt.textContent = totLine(clockTotals(CLOCK, TIMECFG));
  const onBreak = (CLOCK.state === "lunch" || CLOCK.state === "coffee") && mins(Date.now() - Date.parse(e.at)) >= (+TIMECFG.breakReminderMin || 9999);
  const long = mins(Date.now() - Date.parse(CLOCK.startedAt)) >= (+TIMECFG.clockReminderHours || 99) * 60;
  const key = onBreak ? "b" + e.at : long ? "l" + CLOCK.startedAt : "";
  if (key && key !== remindedKey) {
    remindedKey = key;
    toast(onBreak ? `Your ${CLOCK.state === "lunch" ? "lunch" : "coffee break"} has been running ${hm(mins(Date.now() - Date.parse(e.at)))}. Tap "Back to work" if you're done.` : `Your clock has been running over ${TIMECFG.clockReminderHours} hours. Did you forget to stop it?`, true);
    try { navigator.vibrate && navigator.vibrate([200, 100, 200]); } catch (x) {}
  }
}, 1000);

// ── Time rules (owners): what's paid, what's billable, rounding, reminders ──
function renderSettings() {
  $("title").firstChild.textContent = "Time rules";
  if (!OWNER) { $("app").innerHTML = `<div class="empty">Only owners can change the time rules.</div>`; return; }
  const c = TIMECFG, yn = (id, on, label, help) => `<label class="tog"><input type="checkbox" id="${id}" ${on ? "checked" : ""}><span><b>${label}</b>${help ? `<small>${help}</small>` : ""}</span></label>`;
  $("app").innerHTML = banner() + `
    <div class="sec"><h3>Driving</h3>
      ${yn("s-tp", c.travelPaid, "Drive time is paid", "Time between tapping On my way and Arrived.")}
      ${yn("s-tb", c.travelBillable, "Drive time is billed to the customer")}
      ${yn("s-fp", c.firstTripPaid, "First drive of the day is paid", "Turn off if the drive from home to the first job isn't paid.")}
    </div>
    <div class="sec"><h3>Breaks</h3>
      ${yn("s-lp", c.lunchPaid, "Lunch is paid")}
      ${yn("s-cp", c.coffeePaid, "Coffee breaks are paid")}
      <label class="field"><span>Paid coffee break, up to (minutes each)</span><input class="inp" id="s-cm" inputmode="numeric" value="${esc(c.coffeeMaxMin)}"></label>
    </div>
    <div class="sec"><h3>Rounding</h3>
      <div class="two"><label class="field"><span>Round each entry to</span><select class="inp" id="s-rt">${[[0, "Exact minute"], [5, "5 minutes"], [6, "6 minutes (0.1 h)"], [15, "15 minutes"], [30, "30 minutes"]].map(([v, l]) => `<option value="${v}" ${+c.roundTo === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <label class="field"><span>Direction</span><select class="inp" id="s-rm">${[["nearest", "Nearest"], ["up", "Always up"], ["down", "Always down"]].map(([v, l]) => `<option value="${v}" ${c.roundMode === v ? "selected" : ""}>${l}</option>`).join("")}</select></label></div>
    </div>
    <div class="sec"><h3>Reminders</h3>
      <div class="two"><label class="field"><span>Break running longer than (min)</span><input class="inp" id="s-br" inputmode="numeric" value="${esc(c.breakReminderMin)}"></label>
      <label class="field"><span>Clock running longer than (hours)</span><input class="inp" id="s-ch" inputmode="numeric" value="${esc(c.clockReminderHours)}"></label></div>
    </div>
    <div class="btnrow"><button class="big" id="s-save">Save time rules</button></div><div class="saved" id="s-saved"></div>
    <p class="cl-sub" style="margin-top:1rem">These rules apply to everyone's clock from the next time they stop it. Hours already saved don't change.</p>`;
  $("s-save").onclick = () => {
    const n = (id, d) => { const x = parseFloat($(id).value); return isFinite(x) && x >= 0 ? x : d; };
    save(() => store.saveSettings({ travelPaid: $("s-tp").checked, travelBillable: $("s-tb").checked, firstTripPaid: $("s-fp").checked, lunchPaid: $("s-lp").checked, coffeePaid: $("s-cp").checked, coffeeMaxMin: n("s-cm", 15), roundTo: +$("s-rt").value, roundMode: $("s-rm").value, breakReminderMin: n("s-br", 45), clockReminderHours: n("s-ch", 10) }), $("s-saved"), "Time rules saved");
  };
}

// ── Visit ──
let SUMMARY_SAVED = false;
function renderVisit(id) {
  const v = VISITS.find(x => x.id === id);
  if (!v) { $("app").innerHTML = banner() + `<button class="back" onclick="location.hash='${FROM}'">‹ ${FROM ? "Schedule" : "My visits"}</button><div class="empty">${LOADED ? "This visit isn't assigned to you, or it was removed." : "Loading…"}</div>`; return; }
  $("title").firstChild.textContent = v.jobNo || "Visit";
  const maps = v.address ? (/iPhone|iPad|Mac/.test(navigator.userAgent) ? "https://maps.apple.com/?q=" : "https://www.google.com/maps/search/?api=1&query=") + encodeURIComponent(v.address) : "";
  const tel = String(v.contactPhone || "").replace(/[^\d+]/g, "");
  const st = v.status || "scheduled";
  $("app").innerHTML = banner() + `
    <button class="back" id="back">‹ ${FROM ? "Schedule" : "My visits"}</button>
    <div class="vhead">${v.visitType ? `<div class="site">${esc(v.visitType)}</div>` : ""}<h2>${esc(v.title || v.customer || "Visit")}</h2><div class="site">${esc([v.title ? v.customer : "", v.site].filter(Boolean).join(" · "))}</div>
      <div class="meta"><span class="chip ${overdueDays(v) ? "overdue" : esc(st)}">${esc(STATUS[st])}</span><span>${esc(dayLabel(v.date))}${v.time ? " · " + esc(v.time) : ""}</span>${(v.techNames || []).length > 1 ? `<span>with ${esc(v.techNames.filter(n => n !== MY_NAME).map(first).join(", "))}</span>` : ""}</div></div>
    <div id="clock-box">${clockPanel(v)}</div>
    <div class="saved" id="st-saved" style="margin:-.8rem 0 .8rem"></div>

    <div class="sec"><h3>Site</h3>
      ${v.address ? `<div class="row"><div class="grow">${esc(v.address)}</div><a class="act" href="${esc(maps)}" target="_blank" rel="noopener">Directions</a></div>` : ""}
      ${v.contactName || tel ? `<div class="row"><div class="grow">${esc(v.contactName || "Site contact")}<small>${esc(v.contactPhone || "")}${v.contactEmail ? " · " + esc(v.contactEmail) : ""}</small></div>${tel ? `<a class="act" href="tel:${esc(tel)}">Call</a>` : ""}</div>` : ""}
    </div>
    ${v.scope ? `<div class="sec"><h3>What to do</h3><div class="pre">${esc(v.scope)}</div></div>` : ""}
    ${v.equipmentNotes || (v.equipment || []).length ? `<div class="sec"><h3>Equipment</h3>${v.equipmentNotes ? `<div class="pre" style="margin-bottom:.5rem">${esc(v.equipmentNotes)}</div>` : ""}${(v.equipment || []).length ? `<ul class="eq">${v.equipment.map(e => `<li><b>${esc(e.name || "Unit")}</b> ${esc([e.make, e.model].filter(Boolean).join(" "))}${e.serial ? `<br><small>Serial ${esc(e.serial)}</small>` : ""}</li>`).join("")}</ul>` : ""}</div>` : ""}

    <div class="sec"><h3>My hours <span class="st hrs-total" id="hrs-t"></span></h3>
      <div id="hrs-list"></div>
      <div class="two" style="margin-top:.6rem">
        <label class="field"><span>Date</span><input class="inp" type="date" id="h-date" value="${esc(v.date && v.date <= TODAY ? v.date : TODAY)}"></label>
        <label class="field"><span>Type</span><select class="inp" id="h-type"><option>Regular</option><option>Overtime</option><option>Travel</option></select></label>
      </div>
      <div class="field"><span style="font-size:.8rem;color:var(--muted)">Hours</span><div class="stepper"><button type="button" id="h-minus" aria-label="Less">−</button><input class="inp" id="h-hrs" inputmode="decimal" value="1" aria-label="Hours"><button type="button" id="h-plus" aria-label="More">+</button></div></div>
      <label class="field"><span>Note (optional)</span><input class="inp" id="h-note" placeholder="e.g. waiting on parts"></label>
      <div class="btnrow"><button class="big" id="h-add">Add hours</button></div>
      <div class="saved" id="h-saved"></div>
    </div>

    <div class="sec"><h3>Visit summary</h3>
      <textarea class="inp" id="sum" placeholder="What you found, what you did, and anything the office or customer should know."></textarea>
      <div class="btnrow" style="margin-top:.6rem"><button class="big" id="sum-save">Save summary</button></div>
      <div class="saved" id="sum-saved"></div>
    </div>

    <div class="sec"><h3>Photos <span class="st" id="ph-n"></span></h3>
      <div class="ph" id="ph"></div>
      <button class="addph" id="ph-add">📷 Take or add photos</button>
      <div class="saved" id="ph-saved"></div>
    </div>`;

  $("back").onclick = () => { location.hash = FROM; };
  wireClock(v);


  // Hours
  const hIn = $("h-hrs"), step = d => { const x = Math.max(0, Math.round(((parseFloat(hIn.value) || 0) + d) * 4) / 4); hIn.value = x; };
  $("h-minus").onclick = () => step(-0.25); $("h-plus").onclick = () => step(0.25);
  $("h-add").onclick = async () => {
    const hours = Math.round((parseFloat(hIn.value) || 0) * 100) / 100;
    if (!(hours > 0) || hours > 24) { toast("Enter the hours, between 0.25 and 24.", true); return; }
    const rec = { visitId: v.id, jobNo: v.jobNo || "", customer: v.customer || "", tech: ME, techName: MY_NAME, date: $("h-date").value || TODAY, hours, type: $("h-type").value, note: $("h-note").value.trim() };
    if (await save(() => store.addTime(rec), $("h-saved"), hrsTxt(hours) + " added")) { $("h-note").value = ""; }
  };
  unsub.push(store.time(v.id, rows => {
    const own = OFFICE ? rows : rows.filter(r => r.tech === ME);
    own.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    $("hrs-t").textContent = own.length ? hrsTxt(own.reduce((s, r) => s + (r.hours || 0), 0)) : "";
    $("hrs-list").innerHTML = own.length ? own.map(r => `<div class="row"><div class="grow"><b>${hrsTxt(r.hours)}</b> ${esc(r.type || "")}${r.tech !== ME ? " · " + esc(first(r.techName)) : ""}<small>${esc(dayLabel(r.date))}${r.note ? " · " + esc(r.note) : ""}${r._pending ? " · waiting to upload" : ""}</small></div>${r.tech === ME || OFFICE ? `<button class="del" data-del-t="${esc(r.id)}">Remove</button>` : ""}</div>`).join("") : `<div class="empty" style="padding:.3rem 0;text-align:left">No hours logged on this visit yet.</div>`;
    document.querySelectorAll("[data-del-t]").forEach(b => b.onclick = () => { if (confirm("Remove these hours?")) save(() => store.delTime(b.dataset.delT), $("h-saved"), "Hours removed"); });
  }, subErr));

  // Summary
  let typed = false; SUMMARY_SAVED = false;
  const sum = $("sum");
  sum.addEventListener("input", () => { typed = true; $("sum-saved").className = "saved"; $("sum-saved").textContent = "Not saved yet"; });
  const saveSum = async () => { const text = sum.value.trim(); if (await save(() => store.saveReport(v, text), $("sum-saved"), "Summary saved")) { typed = false; SUMMARY_SAVED = !!text; } };
  $("sum-save").onclick = saveSum;
  sum.addEventListener("blur", () => { if (typed) saveSum(); });
  unsub.push(store.report(v.id, r => { if (!typed) { sum.value = (r && r.summary) || ""; SUMMARY_SAVED = !!(r && r.summary); } }, subErr));

  // Photos
  $("ph-add").onclick = () => { const f = $("ph-in"); f.value = ""; f.onchange = () => addPhotos(v, [...f.files]); f.click(); };
  unsub.push(store.photos(v.id, rows => {
    rows.sort((a, b) => (a.takenAt || "").localeCompare(b.takenAt || ""));
    $("ph-n").textContent = rows.length ? rows.length + " photo" + (rows.length > 1 ? "s" : "") : "";
    const up = [...UPLOADING.values()].filter(u => u.visitId === v.id);
    $("ph").innerHTML = rows.map(p => `<figure><img src="data:image/jpeg;base64,${p.data}" alt="${esc(p.caption || "Visit photo")}" loading="lazy">${p._pending ? '<span class="badge">waiting</span>' : ""}${p.tech === ME || OFFICE ? `<button class="x" data-del-p="${esc(p.id)}" aria-label="Delete photo">✕</button>` : ""}${p.tech !== ME ? `<figcaption>${esc(first(p.techName))}</figcaption>` : ""}</figure>`).join("")
      + up.map(u => `<figure><img src="${u.preview}" alt=""><span class="badge ${u.failed ? "bad" : ""}">${u.failed ? "failed" : "saving"}</span></figure>`).join("");
    document.querySelectorAll("[data-del-p]").forEach(b => b.onclick = () => { if (confirm("Delete this photo?")) save(() => store.delPhoto(b.dataset.delP), $("ph-saved"), "Photo deleted"); });
  }, subErr));
}

function wireClock(v) {
  document.querySelectorAll("[data-clk]").forEach(b => b.onclick = async () => { b.disabled = true; await clockAction(v, b.dataset.clk); if (b.isConnected) b.disabled = false; });
  document.querySelectorAll("#clock-box [data-st]").forEach(b => b.onclick = () => save(() => store.setStatus(v, "in_progress"), $("st-saved"), "Visit reopened"));
}
// Clock or time rules changed: redraw just the clock on an open visit (keeps whatever the tech is typing).
function refreshClock() {
  const id = route(), box = $("clock-box");
  if (!id || !box) return;
  const v = VISITS.find(x => x.id === id); if (!v) return;
  box.innerHTML = clockPanel(v); wireClock(v);
}

// Photos: shrink on the phone (longest side 1600 px, JPEG) so each fits in one database record.
const UPLOADING = new Map();
async function shrink(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    for (const [max, q] of [[1600, 0.72], [1400, 0.62], [1100, 0.55]]) {
      const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.round(img.naturalWidth * k), h = Math.round(img.naturalHeight * k);
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      const data = c.toDataURL("image/jpeg", q).split(",")[1];
      if (data.length < 880000) return { data, w, h, preview: c.toDataURL("image/jpeg", 0.4) };
    }
    throw new Error("Photo too large");
  } finally { URL.revokeObjectURL(url); }
}
async function addPhotos(v, files) {
  if (!files.length) return;
  let ok = 0;
  for (const f of files) {
    const key = Math.random().toString(36).slice(2);
    try {
      const s = await shrink(f);
      UPLOADING.set(key, { visitId: v.id, preview: s.preview }); render();
      const done = await save(() => store.addPhoto({ visitId: v.id, jobNo: v.jobNo || "", customer: v.customer || "", tech: ME, techName: MY_NAME, caption: "", data: s.data, w: s.w, h: s.h, takenAt: new Date().toISOString() }), $("ph-saved"), "Photo saved");
      if (done) { ok++; UPLOADING.delete(key); } else UPLOADING.get(key).failed = true;
    } catch (e) { toast("One photo couldn't be read. Try taking it again.", true); UPLOADING.delete(key); }
  }
  render();
  if (ok > 1) toast(ok + " photos saved");
}

// ── Office: new visit sheet ──
function openNewVisit() {
  const techs = Object.entries(typeof AP_USERS === "object" ? AP_USERS : {}).filter(([, u]) => (u.roles || []).includes("ops")).map(([email, u]) => ({ email, name: u.name }));
  if (DEMO) techs.unshift({ email: ME, name: MY_NAME });
  const sh = $("sheet");
  $("sheet-in").innerHTML = `<h3 id="sheet-h">New visit</h3>
    <div class="two"><label class="field"><span>Date</span><input class="inp" type="date" id="n-date" value="${TODAY}"></label><label class="field"><span>Time</span><input class="inp" id="n-time" placeholder="8:00 AM"></label></div>
    <div class="two"><label class="field"><span>Visit type</span><select class="inp" id="n-type"><option>Service call</option><option>Maintenance</option><option>Install</option><option>Quote / estimate</option><option>NonBillable</option><option>On-Call</option></select></label><label class="field"><span>Expected hours</span><input class="inp" id="n-dur" inputmode="decimal" placeholder="2"></label></div>
    <label class="field"><span>Title</span><input class="inp" id="n-title" placeholder="e.g. RTU-2 not cooling"></label>
    <label class="field"><span>Customer</span><input class="inp" id="n-cust"></label>
    <div class="two"><label class="field"><span>Site</span><input class="inp" id="n-site" placeholder="Building or unit"></label><label class="field"><span>Job #</span><input class="inp" id="n-job"></label></div>
    <label class="field"><span>Address</span><input class="inp" id="n-addr"></label>
    <div class="two"><label class="field"><span>Site contact</span><input class="inp" id="n-cname"></label><label class="field"><span>Contact phone</span><input class="inp" id="n-cphone" inputmode="tel"></label></div>
    <label class="field"><span>What to do</span><textarea class="inp" id="n-scope" style="min-height:90px"></textarea></label>
    <label class="field"><span>Equipment notes</span><textarea class="inp" id="n-eq" style="min-height:70px"></textarea></label>
    <div class="field"><span>Techs</span><div class="checks">${techs.map(t => `<label><input type="checkbox" value="${esc(t.email)}" data-name="${esc(t.name)}"> ${esc(t.name)}</label>`).join("")}</div></div>
    <div class="btnrow"><button class="big ghost" id="n-cancel">Cancel</button><button class="big" id="n-save">Save visit</button></div><div class="saved" id="n-saved"></div>`;
  sh.classList.add("on");
  $("n-cancel").onclick = () => sh.classList.remove("on");
  $("n-save").onclick = async () => {
    const picked = [...sh.querySelectorAll(".checks input:checked")];
    const rec = { date: $("n-date").value, time: $("n-time").value.trim(), visitType: $("n-type").value, title: $("n-title").value.trim(), durationHrs: parseFloat($("n-dur").value) || null, customer: $("n-cust").value.trim(), site: $("n-site").value.trim(), jobNo: $("n-job").value.trim(), address: $("n-addr").value.trim(), contactName: $("n-cname").value.trim(), contactPhone: $("n-cphone").value.trim(), scope: $("n-scope").value.trim(), equipmentNotes: $("n-eq").value.trim(), equipment: [], techEmails: picked.map(i => i.value), techNames: picked.map(i => i.dataset.name), status: "scheduled" };
    if (!rec.customer || !rec.date || !rec.techEmails.length) { toast("Add a customer, a date and at least one tech.", true); return; }
    if (await save(() => store.addVisit(rec), $("n-saved"), "Visit saved")) { sh.classList.remove("on"); toast("Visit saved and sent to " + rec.techNames.map(first).join(", ")); }
  };
}

// ── Drawer menu (same items as the BuildOps app where we have them) ──
const drawer = $("drawer"), scrim = $("scrim");
function openDrawer() { drawer.classList.add("on"); scrim.classList.add("on"); $("menu-btn").setAttribute("aria-expanded", "true"); }
function closeDrawer() { drawer.classList.remove("on"); scrim.classList.remove("on"); $("menu-btn").setAttribute("aria-expanded", "false"); }
$("menu-btn").onclick = openDrawer; scrim.onclick = closeDrawer;
$("d-av").textContent = MY_NAME.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
$("d-name").textContent = MY_NAME; $("d-email").textContent = ME;
if (OFFICE && !DEMO) document.body.classList.add("office");
if (OWNER) document.body.classList.add("owner");
document.querySelectorAll("[data-go]").forEach(a => a.onclick = e => { e.preventDefault(); location.hash = a.dataset.go; closeDrawer(); render(); });
$("search-btn").onclick = () => { if (location.hash) location.hash = ""; setTimeout(() => { const q = $("q"); if (q) { q.focus(); q.scrollIntoView({ block: "center" }); } }, 50); };
$("m-out").onclick = () => { if (PENDING && !confirm("Some saves haven't uploaded yet. Sign out anyway?")) return; if (typeof apLogout === "function") apLogout(); };
$("m-pass").onclick = async () => {
  if (!confirm("Send a password reset link to " + ME + "?")) return;
  closeDrawer();
  try { await store.resetPassword(); toast("Check your email for a link to set a new password."); } catch (e) { toast("Couldn't send the email. Try again with a signal.", true); }
};
$("m-help").onclick = () => alert("Add Alpine to your home screen so it opens like an app:\n\n"
  + (/iPhone|iPad/.test(navigator.userAgent) ? "In Safari, tap Share (the square with an arrow), then 'Add to Home Screen'." : "In Chrome, open the ⋮ menu and choose 'Add to Home screen' or 'Install app'.")
  + "\n\nNo signal? Keep working. Saves wait on your phone and upload when you're back in coverage.\n\nSomething wrong? Call the office.");
$("m-clear").onclick = async () => {
  if (PENDING || !navigator.onLine) { alert("Wait until you have a signal and the top bar says Saved, so nothing waiting to upload is lost."); return; }
  if (!confirm("Reload the app with fresh files? Your visits, hours and photos are already saved in the cloud.")) return;
  try { const regs = await navigator.serviceWorker?.getRegistrations?.() || []; await Promise.all(regs.map(r => r.unregister())); const ks = await caches.keys(); await Promise.all(ks.filter(k => k.startsWith("alpine-tech-")).map(k => caches.delete(k))); } catch (e) {}
  location.reload();
};

// ── Start ──
// A visit's hours, summary or photos failed to load: say so without redrawing the page (no loops).
function subErr(e) {
  console.error(e);
  if (subErr._shown) return; subErr._shown = true; setTimeout(() => subErr._shown = false, 8000);
  toast(/permission/i.test(e.code || e.message) ? "Some of this visit couldn't load: no access. Tell the office." : "Some of this visit couldn't load. Check your signal.", true);
}
function err(e) {
  console.error(e);
  if (/permission/i.test(e.code || e.message)) BANNER = `<div class="banner err"><b>No access yet.</b> The database isn't letting this account read visits. If you're testing before the security update is published, try <a href="tech.html?demo=1">the demo</a>.</div>`;
  else BANNER = `<div class="banner err"><b>Can't reach the database.</b> Your saved work is safe on this phone and will upload when the connection is back.</div>`;
  LOADED = true; render();
}
(async () => {
  try { store = DEMO ? demoStore() : await firestoreStore(); }
  catch (e) { err(e); return; }
  syncUi();
  store.clock(c => { CLOCK = c; refreshClock(); }, e => console.error(e));
  store.settings(c => { TIMECFG = { ...TIME_DEFAULTS, ...(c || {}) }; refreshClock(); if (location.hash === "#settings" && !document.activeElement?.closest?.("#app")) render(); }, e => console.error(e));
  store.myTime(rows => { MYTIME = rows; }, e => console.error(e));
  store.visits(rows => { VISITS = rows; LOADED = true; BANNER = ""; const id = route(); if (!id || !document.activeElement || document.activeElement === document.body) render(); }, err);
  render();
})();
