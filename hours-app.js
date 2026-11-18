// ── Alpine HVAC — Hours (hours.html) ─────────────────────────────────
// Every hour a tech logs in the tech app, for the office. Owners + field ops (Jake, Mike, Cole).
//   Week     techs × days (Mon–Sun), Regular / Overtime / Travel totals; click a day to see, fix or remove entries
//   By job   hours logged against each job's budget (budget from the Field Operations data)
//   Flags    things to chase before payroll
// Approve week: writes hours_weeks/{monday} { approved, approvedBy, approvedAt, totals } and sets locked: true on
// that week's fs_time entries, so techs can no longer change them (firestore.rules). Reopen undoes both.
// Data: fs_time/{id} { visitId, jobNo, customer, tech, techName, date, hours, type, note, locked?, createdAt, editedBy? }
//       fs_visits (to spot visits with no hours), ops_dashboard/latest (job budgets), portal_users + AP_USERS (techs).

import { collection, doc, query, where, onSnapshot, getDoc, getDocs, setDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";
import { db, currentUser } from "./ap-firebase.js";

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = n => String(n).padStart(2, "0");
const ymd = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const TODAY = ymd(new Date());
const addDays = (s, n) => { const d = new Date(s + "T12:00:00"); d.setDate(d.getDate() + n); return ymd(d); };
const monday = s => { const d = new Date(s + "T12:00:00"); return addDays(s, -((d.getDay() + 6) % 7)); };
const fmtDay = (s, o) => new Date(s + "T12:00:00").toLocaleDateString("en-CA", o || { weekday: "short", month: "short", day: "numeric" });
const h = n => { const r = Math.round((n || 0) * 100) / 100; return r ? String(r) : "0"; };
const sumH = list => list.reduce((a, t) => a + (Number(t.hours) || 0), 0);
const kind = t => /over/i.test(t.type || "") ? "ot" : /travel/i.test(t.type || "") ? "tr" : "reg";
const LS = (k, v) => { try { if (v === undefined) return JSON.parse(localStorage.getItem("hrs_" + k)); localStorage.setItem("hrs_" + k, JSON.stringify(v)); } catch (e) { return null; } };
const LONG_DAY = 10, OT_WEEK = 44;   // flag days over 10 h; Ontario overtime starts after 44 h in a week

let ME = "", TECHS = [], WEEK = monday(LS("week") && LS("week") <= TODAY ? LS("week") : TODAY), TAB = LS("tab") || "week";
let TIME = [], VISITS = [], WEEKDOC = null, JOBS = null, ALLTIME = null, unsub = [];

const toast = (m, bad) => { const t = $("toast"); t.textContent = m; t.className = "toast" + (bad ? " bad" : ""); t.style.display = "block"; clearTimeout(toast.t); toast.t = setTimeout(() => t.style.display = "none", 3200); };
const errMsg = e => /permission/i.test((e && (e.code || e.message)) || "") ? "Not allowed. Have the updated rules been published?" : "Couldn't save. Check the connection.";
const days = () => [...Array(7)].map((_, i) => addDays(WEEK, i));
const nameOf = e => (TECHS.find(t => t.email === e) || {}).name || (TIME.find(t => String(t.tech).toLowerCase() === e) || {}).techName || e;
const approved = () => !!(WEEKDOC && WEEKDOC.approved);

async function loadTechs() {
  const map = new Map();
  Object.entries(typeof AP_USERS === "object" ? AP_USERS : {}).forEach(([e, u]) => map.set(e.toLowerCase(), { email: e.toLowerCase(), name: u.name, roles: u.roles || [], active: true }));
  try { (await getDocs(collection(db, "portal_users"))).docs.forEach(d => { const p = d.data(); map.set(d.id.toLowerCase(), { email: d.id.toLowerCase(), name: p.name || d.id, roles: p.roles || [], active: p.active !== false }); }); } catch (e) { console.warn("portal_users", e); }
  TECHS = [...map.values()].filter(u => u.active && u.roles.includes("ops")).map(u => ({ email: u.email, name: u.name })).sort((a, b) => a.name.localeCompare(b.name));
}
// Everyone with hours or visits this week, plus every active tech.
function rows() {
  const list = TECHS.slice();
  const add = (e, n) => { e = String(e || "").toLowerCase(); if (e && !list.some(t => t.email === e)) list.push({ email: e, name: n || e }); };
  TIME.forEach(t => add(t.tech, t.techName));
  VISITS.forEach(v => (v.techEmails || []).forEach((e, i) => add(e, (v.techNames || [])[i])));
  return list.sort((a, b) => a.name.localeCompare(b.name));
}
const entries = (tech, day) => TIME.filter(t => String(t.tech).toLowerCase() === tech && (!day || t.date === day));
const visitsOf = (tech, day) => VISITS.filter(v => v.date === day && v.status !== "canceled" && (v.techEmails || []).map(x => String(x).toLowerCase()).includes(tech));
const split = list => { const o = { reg: 0, ot: 0, tr: 0 }; list.forEach(t => o[kind(t)] += Number(t.hours) || 0); o.all = o.reg + o.ot + o.tr; return o; };

// ── Flags ──
function flags() {
  const out = [], D = days();
  rows().forEach(t => {
    const wk = split(entries(t.email));
    if (wk.all > OT_WEEK && !wk.ot) out.push({ lvl: "red", tag: "Over 44 h", t: `${t.name}: ${h(wk.all)} h this week, none marked Overtime`, s: "Ontario overtime starts after 44 hours in a week. Check before payroll.", tech: t.email });
    D.forEach(d => {
      const e = entries(t.email, d), v = visitsOf(t.email, d), tot = sumH(e);
      if (tot > LONG_DAY) out.push({ lvl: "red", tag: "Long day", t: `${t.name}: ${h(tot)} h on ${fmtDay(d)}`, s: "Over " + LONG_DAY + " hours in one day. Make sure it isn't a typo.", tech: t.email, day: d });
      if (d < TODAY && v.length && !e.length) out.push({ lvl: "amber", tag: "No hours", t: `${t.name}: no hours on ${fmtDay(d)}`, s: `Booked on ${v.length} visit${v.length > 1 ? "s" : ""}: ${v.map(x => x.jobNo || x.customer || "visit").join(", ")}.`, tech: t.email, day: d });
      if (e.length && !v.length) out.push({ lvl: "grey", tag: "No visit booked", t: `${t.name}: ${h(tot)} h on ${fmtDay(d)} with no visit booked that day`, s: "Often fine (hours entered for another day's visit). Check the date is right.", tech: t.email, day: d });
    });
  });
  VISITS.filter(v => v.status === "complete").forEach(v => {
    if (!TIME.some(t => t.visitId === v.id)) out.push({ lvl: "amber", tag: "Complete, no hours", t: `${v.jobNo || "Visit"} · ${v.customer || v.title || ""} on ${fmtDay(v.date)}`, s: `Marked complete with no hours logged. Tech: ${(v.techNames || []).join(", ") || "unassigned"}.` });
  });
  if (approved()) {
    const at = WEEKDOC.approvedAt && WEEKDOC.approvedAt.toMillis ? WEEKDOC.approvedAt.toMillis() : 0;
    TIME.filter(t => !t.locked || (t.createdAt && t.createdAt.toMillis && t.createdAt.toMillis() > at)).forEach(t => out.push({ lvl: "red", tag: "After approval", t: `${t.techName || t.tech}: ${h(t.hours)} h on ${fmtDay(t.date)} (${t.jobNo || "no job"})`, s: "Added or changed after the week was approved. Check it and approve the week again.", tech: String(t.tech).toLowerCase(), day: t.date }));
  }
  const rank = { red: 0, amber: 1, grey: 2 };
  return out.sort((a, b) => rank[a.lvl] - rank[b.lvl]);
}

// ── Render ──
function render() {
  const D = days(), R = rows(), all = split(TIME), F = flags(), done = approved();
  const ot = all.ot, tr = all.tr, chase = F.filter(f => f.lvl !== "grey").length;
  $("app").innerHTML = `
    <div class="top"><div><h1>Hours</h1><p class="sub">Every hour your techs log in the tech app. Check the week, chase the flags, approve it, then download it for payroll.</p></div></div>
    <div class="bar">
      <button class="btn ghost sm" id="prev" aria-label="Previous week">‹</button>
      <div class="wk">${fmtDay(WEEK, { month: "short", day: "numeric" })} – ${fmtDay(addDays(WEEK, 6), { month: "short", day: "numeric", year: "numeric" })}</div>
      <button class="btn ghost sm" id="next" aria-label="Next week">›</button>
      ${WEEK !== monday(TODAY) ? '<button class="btn ghost sm" id="this">This week</button>' : ""}
      <span class="sp"></span>
      <span class="state ${done ? "done" : ""}">${done ? `✓ Approved by ${esc(nameOf(WEEKDOC.approvedBy).split(" ")[0])}${WEEKDOC.approvedAt && WEEKDOC.approvedAt.toDate ? " · " + WEEKDOC.approvedAt.toDate().toLocaleDateString("en-CA", { month: "short", day: "numeric" }) : ""}` : "Not approved yet"}</span>
      ${done ? '<button class="btn ghost sm" id="reopen">Reopen</button>' : `<button class="btn ok sm" id="approve">Approve week</button>`}
      <button class="btn ghost sm" id="csv-tot">Totals CSV</button>
      <button class="btn ghost sm" id="csv-all">Every entry CSV</button>
    </div>
    <div class="kpis">
      <div class="kpi"><span>Total hours</span><b>${h(all.all)}</b></div>
      <div class="kpi"><span>Regular</span><b>${h(all.reg)}</b></div>
      <div class="kpi"><span>Overtime</span><b>${h(ot)}</b></div>
      <div class="kpi"><span>Travel</span><b>${h(tr)}</b></div>
      <div class="kpi ${chase ? "warn" : ""}"><span>Flags to check</span><b>${chase}</b></div>
    </div>
    <div class="tabs" id="tabs">
      <button data-t="week" class="${TAB === "week" ? "on" : ""}">Week</button>
      <button data-t="jobs" class="${TAB === "jobs" ? "on" : ""}">By job</button>
      <button data-t="flags" class="${TAB === "flags" ? "on" : ""}">Flags${chase ? `<small>${chase}</small>` : ""}</button>
    </div>
    <div class="panel" id="body"></div>`;
  $("prev").onclick = () => go(addDays(WEEK, -7));
  $("next").onclick = () => go(addDays(WEEK, 7));
  if ($("this")) $("this").onclick = () => go(monday(TODAY));
  if ($("approve")) $("approve").onclick = approve;
  if ($("reopen")) $("reopen").onclick = reopen;
  $("csv-tot").onclick = csvTotals; $("csv-all").onclick = csvAll;
  $("tabs").querySelectorAll("button").forEach(b => b.onclick = () => { TAB = b.dataset.t; LS("tab", TAB); render(); });
  if (TAB === "jobs") renderJobs(); else if (TAB === "flags") renderFlags(F); else renderWeek(D, R);
}

function renderWeek(D, R) {
  if (!R.length) { $("body").innerHTML = `<div class="empty">No techs or hours this week.</div>`; return; }
  const cell = (t, d) => {
    const e = entries(t.email, d), s = split(e), v = visitsOf(t.email, d);
    const cls = !e.length ? (d < TODAY && v.length ? "none miss" : "none") : s.all > LONG_DAY ? "long" : "";
    const parts = [s.ot && `${h(s.ot)} OT`, s.tr && `${h(s.tr)} travel`].filter(Boolean).join(" · ");
    const sub = e.length ? (parts || `${e.length} entr${e.length > 1 ? "ies" : "y"}`) : v.length ? `${v.length} visit${v.length > 1 ? "s" : ""}` : "";
    return `<button class="day ${cls}" data-t="${esc(t.email)}" data-d="${d}"><b>${e.length ? h(s.all) : "–"}</b><small>${esc(sub)}</small></button>`;
  };
  const colTot = d => h(sumH(TIME.filter(t => t.date === d)));
  $("body").innerHTML = `<div class="scroll"><table class="grid"><thead><tr><th>Tech</th>${D.map(d => `<th class="${d === TODAY ? "today" : ""}">${fmtDay(d, { weekday: "short" })}<small>${fmtDay(d, { month: "short", day: "numeric" })}</small></th>`).join("")}<th>Regular</th><th>OT</th><th>Travel</th><th>Total</th></tr></thead><tbody>
    ${R.map(t => { const s = split(entries(t.email)); return `<tr><td class="who">${esc(t.name)}<small>${entries(t.email).length} entries</small></td>${D.map(d => `<td>${cell(t, d)}</td>`).join("")}
      <td class="tot">${h(s.reg)}</td><td class="tot">${h(s.ot)}</td><td class="tot">${h(s.tr)}</td><td class="tot big"${s.all > OT_WEEK ? ' style="color:var(--red)"' : ""}>${h(s.all)}</td></tr>`; }).join("")}
    <tr class="sum"><td>All techs</td>${D.map(d => `<td>${colTot(d)}</td>`).join("")}<td>${h(split(TIME).reg)}</td><td>${h(split(TIME).ot)}</td><td>${h(split(TIME).tr)}</td><td>${h(split(TIME).all)}</td></tr>
    </tbody></table></div>
    <p class="note">Click a day to see the entries behind it. Shaded: booked on a visit that day but no hours logged. Red: over ${LONG_DAY} hours in a day or ${OT_WEEK} in the week.</p>`;
  $("body").querySelectorAll(".day").forEach(b => b.onclick = () => openDay(b.dataset.t, b.dataset.d));
}

async function renderJobs() {
  $("body").innerHTML = `<div class="empty">Loading jobs…</div>`;
  try {
    if (!JOBS) {
      JOBS = {};
      const s = await getDoc(doc(db, "ops_dashboard", "latest"));
      if (s.exists()) (JSON.parse(s.data().json).jobs || []).forEach(j => { if (j.id) JOBS[String(j.id).toUpperCase()] = j; });
    }
    if (!ALLTIME) ALLTIME = (await getDocs(collection(db, "fs_time"))).docs.map(d => d.data());
  } catch (e) { console.error(e); $("body").innerHTML = `<div class="empty">Couldn't load the job budgets (${esc(e.code || e)}).</div>`; return; }
  if (TAB !== "jobs") return;
  const key = t => String(t.jobNo || "").trim().toUpperCase() || "(no job #)";
  const ids = [...new Set(TIME.map(key))];
  const life = id => sumH(ALLTIME.filter(t => key(t) === id));
  const list = ids.map(id => { const j = JOBS[id] || {}, wk = TIME.filter(t => key(t) === id), lt = Math.max(life(id), sumH(wk)); return { id, j, week: sumH(wk), life: lt, techs: [...new Set(wk.map(t => (t.techName || t.tech || "").split(" ")[0]))], customer: j.customer || (wk.find(t => t.customer) || {}).customer || "", budget: Number(j.budgetHrs) || 0, bo: Number(j.actualHrs) || 0 }; })
    .sort((a, b) => b.week - a.week);
  if (!list.length) { $("body").innerHTML = `<div class="empty">No hours logged this week.</div>`; return; }
  $("body").innerHTML = `<div class="scroll"><table class="list"><thead><tr><th>Job</th><th>Customer</th><th class="num">This week</th><th class="num">Basecamp to date</th><th class="num">BuildOps to date</th><th class="num">Budget</th><th>Used</th></tr></thead><tbody>
    ${list.map(r => { const used = r.budget ? (r.life + r.bo) / r.budget : 0; return `<tr>
      <td>${r.id !== "(no job #)" ? `<a href="job.html?id=${encodeURIComponent(r.id)}">${esc(r.id)}</a>` : `<span class="tag amber">No job #</span>`}<small>${esc(r.techs.join(", "))}</small></td>
      <td>${esc((r.customer || "").replace(/^\*/, ""))}<small>${esc(r.j.title || "")}</small></td>
      <td class="num"><b>${h(r.week)}</b></td><td class="num">${h(r.life)}</td><td class="num">${r.bo ? h(r.bo) : "–"}</td><td class="num">${r.budget ? h(r.budget) : "–"}</td>
      <td>${r.budget ? `${Math.round(used * 100)}%<div class="meter ${used > 1 ? "over" : ""}"><i style="width:${Math.min(100, used * 100)}%"></i></div>` : '<small>No budget</small>'}</td></tr>`; }).join("")}
    </tbody></table></div>
    <p class="note">Used = BuildOps hours to date plus Basecamp hours to date, against the job's budgeted hours. Until cutover some jobs have hours in both. Budgets come from the Field Operations refresh.</p>`;
}

function renderFlags(F) {
  $("body").innerHTML = F.length ? F.map((f, i) => `<div class="flag"><span class="tag ${f.lvl === "red" ? "red" : f.lvl === "amber" ? "amber" : ""}">${esc(f.tag)}</span><div class="t">${esc(f.t)}<small>${esc(f.s)}</small></div>${f.tech && f.day ? `<button class="btn ghost sm" data-i="${i}">Open</button>` : ""}</div>`).join("")
    : `<div class="empty">Nothing to chase this week. ✓</div>`;
  $("body").querySelectorAll("[data-i]").forEach(b => b.onclick = () => { const f = F[+b.dataset.i]; openDay(f.tech, f.day); });
}

// ── One tech, one day: see, fix, remove ──
function openDay(tech, day) {
  const draw = () => {
    const e = entries(tech, day).sort((a, b) => (a.jobNo || "").localeCompare(b.jobNo || "")), v = visitsOf(tech, day), lock = approved();
    $("mod-h").textContent = nameOf(tech) + " · " + fmtDay(day, { weekday: "long", month: "short", day: "numeric" });
    $("mod-b").innerHTML = (lock ? `<div class="lockmsg">This week is approved. Reopen it to change these hours.</div>` : "")
      + (e.length ? e.map(t => `<div class="ent" data-id="${esc(t.id)}">
          <div><b>${esc(t.jobNo || "No job #")}</b> ${esc((t.customer || "").replace(/^\*/, ""))}<small>${esc(t.note || "")}${t.editedBy ? ` · changed by ${esc(nameOf(t.editedBy).split(" ")[0])}` : ""}</small></div>
          <input type="number" step="0.25" min="0.25" max="24" value="${esc(t.hours)}" aria-label="Hours"${lock ? " disabled" : ""}>
          <select aria-label="Type"${lock ? " disabled" : ""}>${["Regular", "Overtime", "Travel"].map(o => `<option${o === t.type ? " selected" : ""}>${o}</option>`).join("")}</select>
          <span>${lock ? "" : `<button class="btn sm" data-save>Save</button> <button class="btn danger sm" data-del>Remove</button>`}</span></div>`).join("")
        : `<div class="empty" style="padding:1rem">No hours logged.</div>`)
      + `<p class="note"><b>Booked that day:</b> ${v.length ? v.map(x => esc([x.time, x.jobNo, (x.customer || "").replace(/^\*/, "")].filter(Boolean).join(" · ") + (x.status === "complete" ? " (complete)" : ""))).join("; ") : "no visits"}.</p>`;
    $("mod-b").querySelectorAll(".ent").forEach(r => {
      const id = r.dataset.id, sv = r.querySelector("[data-save]"), dl = r.querySelector("[data-del]");
      if (sv) sv.onclick = async () => {
        const hours = Math.round((parseFloat(r.querySelector("input").value) || 0) * 100) / 100;
        if (!(hours > 0) || hours > 24) { toast("Hours must be between 0.25 and 24.", true); return; }
        try { await updateDoc(doc(db, "fs_time", id), { hours, type: r.querySelector("select").value, editedBy: ME, editedAt: serverTimestamp() }); toast("Saved"); } catch (e) { console.error(e); toast(errMsg(e), true); }
      };
      if (dl) dl.onclick = async () => {
        if (!confirm("Remove these hours? The tech will see they're gone.")) return;
        try { await deleteDoc(doc(db, "fs_time", id)); toast("Removed"); } catch (e) { console.error(e); toast(errMsg(e), true); }
      };
    });
  };
  openDay.redraw = draw; draw();
  $("mod").classList.add("on");
}
const closeMod = () => { $("mod").classList.remove("on"); openDay.redraw = null; };
$("mod-close").onclick = closeMod;
$("mod").addEventListener("click", e => { if (e.target === $("mod")) closeMod(); });
document.addEventListener("keydown", e => { if (e.key === "Escape") closeMod(); });

// ── Approve / reopen ──
async function approve() {
  const F = flags().filter(f => f.lvl === "red");
  if (F.length && !confirm(`${F.length} red flag${F.length > 1 ? "s" : ""} still showing (see Flags). Approve anyway?`)) return;
  if (!confirm("Approve " + fmtDay(WEEK, { month: "short", day: "numeric" }) + " week? Techs won't be able to change these hours after this.")) return;
  const totals = {}; rows().forEach(t => { const s = split(entries(t.email)); if (s.all) totals[t.email] = { name: t.name, regular: s.reg, overtime: s.ot, travel: s.tr, total: s.all }; });
  try {
    for (let i = 0; i < TIME.length; i += 400) { const b = writeBatch(db); TIME.slice(i, i + 400).forEach(t => b.update(doc(db, "fs_time", t.id), { locked: true })); await b.commit(); }
    await setDoc(doc(db, "hours_weeks", WEEK), { week: WEEK, approved: true, approvedBy: ME, approvedAt: serverTimestamp(), entries: TIME.length, totals });
    toast("Week approved and locked");
  } catch (e) { console.error(e); toast(errMsg(e), true); }
}
async function reopen() {
  if (!confirm("Reopen this week? Techs will be able to change these hours again.")) return;
  try {
    for (let i = 0; i < TIME.length; i += 400) { const b = writeBatch(db); TIME.slice(i, i + 400).forEach(t => b.update(doc(db, "fs_time", t.id), { locked: false })); await b.commit(); }
    await setDoc(doc(db, "hours_weeks", WEEK), { week: WEEK, approved: false, reopenedBy: ME, reopenedAt: serverTimestamp() }, { merge: true });
    toast("Week reopened");
  } catch (e) { console.error(e); toast(errMsg(e), true); }
}

// ── Downloads (CSV opens in Excel) ──
function download(name, rowsOut) {
  const csv = rowsOut.map(r => r.map(c => { c = String(c ?? ""); return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(",")).join("\r\n");
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function csvTotals() {
  const D = days();
  const out = [["Week of", "Tech", "Email", ...D.map(d => fmtDay(d)), "Regular", "Overtime", "Travel", "Total", "Approved"]];
  rows().forEach(t => { const s = split(entries(t.email)); if (!s.all) return; out.push([WEEK, t.name, t.email, ...D.map(d => h(sumH(entries(t.email, d)))), h(s.reg), h(s.ot), h(s.tr), h(s.all), approved() ? "Yes" : "No"]); });
  download(`alpine-hours-totals-${WEEK}.csv`, out);
}
function csvAll() {
  const out = [["Date", "Tech", "Email", "Job", "Customer", "Type", "Hours", "Note", "Changed by office"]];
  TIME.slice().sort((a, b) => (a.date || "").localeCompare(b.date || "") || String(a.techName).localeCompare(String(b.techName)))
    .forEach(t => out.push([t.date, t.techName || nameOf(t.tech), t.tech, t.jobNo || "", (t.customer || "").replace(/^\*/, ""), t.type || "Regular", h(t.hours), t.note || "", t.editedBy ? nameOf(t.editedBy) : ""]));
  download(`alpine-hours-entries-${WEEK}.csv`, out);
}

// ── Live data for the week on screen ──
function go(w) { WEEK = w; LS("week", w); listen(); }
function listen() {
  unsub.forEach(u => u()); unsub = [];
  TIME = []; VISITS = []; WEEKDOC = null;
  const end = addDays(WEEK, 6), redraw = () => { render(); if (openDay.redraw) openDay.redraw(); };
  const fail = what => e => { console.error(what, e); $("app").innerHTML = `<div class="empty">The ${what} couldn't load: ${esc(/permission/i.test(e.code || e.message) ? "this account isn't allowed to see them." : "check the connection.")}</div>`; };
  unsub.push(onSnapshot(query(collection(db, "fs_time"), where("date", ">=", WEEK), where("date", "<=", end)), s => { TIME = s.docs.map(d => ({ id: d.id, ...d.data() })); ALLTIME = null; redraw(); }, fail("hours")));
  unsub.push(onSnapshot(query(collection(db, "fs_visits"), where("date", ">=", WEEK), where("date", "<=", end)), s => { VISITS = s.docs.map(d => ({ id: d.id, ...d.data() })); redraw(); }, e => console.warn("visits", e)));
  unsub.push(onSnapshot(doc(db, "hours_weeks", WEEK), s => { WEEKDOC = s.exists() ? s.data() : null; redraw(); }, e => console.warn("hours_weeks", e)));
}

(async () => {
  const u = await currentUser();
  if (!u) { $("app").innerHTML = '<div class="empty">Sign in again to see hours.</div>'; return; }
  ME = (u.email || "").toLowerCase();
  await loadTechs();
  listen();
})();
