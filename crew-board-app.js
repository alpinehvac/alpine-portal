// ── Alpine HVAC — Crew Board (crew-board.html) ───────────────────────
// Basecamp's version of BuildOps Dispatch, laid out the same way:
//   • one row per tech; Week shows each day as a column, Day shows the hours (6 AM to 8 PM)
//   • each visit is a card: status, visit type, title / customer, job number, time
//   • drag a card to another tech or day to reassign or move it (Undo on the message that follows)
//   • click a card to see and change everything about the visit; click + in an empty spot for a new one
//   • the tray at the bottom lists visits by status, like BuildOps: Unassigned, Scheduled, Traveling,
//     Working, Paused, On Hold, Canceled, Complete, All. Drag an Unassigned visit onto a tech to book it.
// Traveling / Working / Paused are live from each tech's clock in the tech app (fs_clock).
// Data: fs_visits, the same visits the tech app shows (status: scheduled, in_progress, on_hold, canceled,
// complete; techEmails / techNames say who is on it). Techs: Ops people from Users & Settings + the built-in list.

import { collection, doc, query, where, onSnapshot, addDoc, updateDoc, getDocs, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";
import { db, currentUser } from "./ap-firebase.js";

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = n => String(n).padStart(2, "0");
const ymd = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const TODAY = ymd(new Date());
const addDays = (s, n) => { const d = new Date(s + "T12:00:00"); d.setDate(d.getDate() + n); return ymd(d); };
const monday = s => { const d = new Date(s + "T12:00:00"); const w = (d.getDay() + 6) % 7; return addDays(s, -w); };
const SESSION = (typeof apGetSession === "function" && apGetSession()) || {};
const ME = (SESSION.email || "").toLowerCase();
const LS = (k, v) => { try { if (v === undefined) return JSON.parse(localStorage.getItem("cb_" + k)); localStorage.setItem("cb_" + k, JSON.stringify(v)); } catch (e) { return null; } };

const STATUS = { scheduled: "Scheduled", in_progress: "In progress", on_hold: "On hold", canceled: "Canceled", complete: "Complete" };
const LIVE = { travel: "Traveling", work: "Working", lunch: "Paused", coffee: "Paused", break: "Paused", paused: "Paused" };
const TYPES = ["Service call", "Maintenance", "Install", "Quote / estimate", "NonBillable", "On-Call"];
const DAY_START = 6, DAY_END = 20, HOUR_W = 110;   // Day view: 6 AM to 8 PM

let VIEW = LS("view") || "week", DATE = TODAY, TAB = LS("tab") || "unassigned", HIDE_DONE = !!LS("hideDone");
let VISITS = [], CLOCKS = {}, TECHS = [], HIDDEN = new Set(LS("hidden") || []), LOADED = false, unsubV = null, SINCE = null;

function toast(t, bad, undo) {
  const el = $("toast"); el.innerHTML = esc(t) + (undo ? ' <button id="t-undo">Undo</button>' : "");
  el.className = "toast" + (bad ? " bad" : ""); el.style.display = "flex";
  if (undo) $("t-undo").onclick = () => { el.style.display = "none"; undo(); };
  clearTimeout(toast._t); toast._t = setTimeout(() => el.style.display = "none", undo ? 9000 : bad ? 7000 : 3000);
}
const errMsg = e => /permission/i.test(e.code || e.message) ? "The database said no. Ask Dave to check this account's access." : "Couldn't save. Check the connection and try again.";

// ── Time helpers: visits store time as text ("8:00 AM") and durationHrs ──
function mins(t) {
  const m = String(t || "").trim().match(/^(\d{1,2})(?::(\d{2}))?\s*([ap])?\.?\s*m?\.?$/i);
  if (!m) return null;
  let h = +m[1] % 12; const mm = +(m[2] || 0), ap = (m[3] || "").toLowerCase();
  if (ap === "p") h += 12; else if (!ap && +m[1] >= 1 && +m[1] <= 6) h += 12;   // "2:00" with no AM/PM reads as afternoon
  if (ap === "a" && +m[1] === 12) h = 0;
  return h * 60 + mm;
}
const fmtMin = m => { const h = Math.floor(m / 60) % 24, mm = m % 60; return ((h % 12) || 12) + ":" + pad(mm) + " " + (h < 12 ? "AM" : "PM"); };
const range = v => { const s = mins(v.time); if (s === null) return v.time || ""; const d = Math.round((parseFloat(v.durationHrs) || 1) * 60); return fmtMin(s) + " – " + fmtMin(s + d); };
const dayHead = s => new Date(s + "T12:00:00").toLocaleDateString("en-CA", { weekday: "short", day: "numeric" });
const longDay = s => new Date(s + "T12:00:00").toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
const initials = n => String(n || "?").split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase();

// ── Status of a visit, including live clock state for a tech ──
const overdue = v => !["complete", "canceled"].includes(v.status) && v.date && v.date < TODAY && (v.techEmails || []).length;
function liveFor(v, email) { const c = email ? CLOCKS[email] : Object.values(CLOCKS).find(c => c.visitId === v.id); return c && c.visitId === v.id ? LIVE[c.state] || null : null; }
function cls(v, email) {
  const lv = liveFor(v, email);
  if (lv) return "s-" + lv.toLowerCase();
  if (!(v.techEmails || []).length && !["complete", "canceled"].includes(v.status)) return "s-unassigned";
  if (overdue(v)) return "s-overdue";
  return "s-" + (v.status || "scheduled");
}
function label(v, email) {
  const lv = liveFor(v, email);
  if (lv) return lv;
  if (!(v.techEmails || []).length && !["complete", "canceled"].includes(v.status)) return "Unassigned";
  return STATUS[v.status || "scheduled"] || v.status;
}

// ── Techs: Ops people (Users & Settings + built-in list), plus anyone already on a visit ──
async function loadTechs() {
  const map = new Map();
  Object.entries(typeof AP_USERS === "object" ? AP_USERS : {}).forEach(([e, u]) => map.set(e.toLowerCase(), { email: e.toLowerCase(), name: u.name, roles: u.roles || [], active: true }));
  try { (await getDocs(collection(db, "portal_users"))).docs.forEach(d => { const p = d.data(); map.set(d.id.toLowerCase(), { email: d.id.toLowerCase(), name: p.name || d.id, roles: p.roles || [], active: p.active !== false }); }); } catch (e) { console.warn("portal_users", e); }
  TECHS = [...map.values()].filter(u => u.active && u.roles.includes("ops")).map(u => ({ email: u.email, name: u.name })).sort((a, b) => a.name.localeCompare(b.name));
}
function rowsTechs() {
  const list = TECHS.slice();
  VISITS.forEach(v => (v.techEmails || []).forEach((e, i) => { e = String(e).toLowerCase(); if (!list.some(t => t.email === e)) list.push({ email: e, name: (v.techNames || [])[i] || e, extra: true }); }));
  return list.sort((a, b) => a.name.localeCompare(b.name)).filter(t => !HIDDEN.has(t.email));
}
const nameOf = e => (TECHS.find(t => t.email === e) || {}).name || e;

// ── Board ──
function days() { return VIEW === "week" ? [...Array(7)].map((_, i) => addDays(monday(DATE), i)) : [DATE]; }
function visible(v) { return !(HIDE_DONE && ["complete", "canceled"].includes(v.status)); }
function card(v, email) {
  const n = (v.techEmails || []).length;
  return `<div class="vk ${cls(v, email)}" draggable="true" data-v="${esc(v.id)}" data-from="${esc(email || "")}" title="${esc([v.title, v.customer, v.site, range(v)].filter(Boolean).join(" · "))}">
    <div class="k1"><span>${esc(label(v, email))}</span>${n > 1 ? `<span class="multi">👥 ${n}</span>` : ""}</div>
    ${v.visitType ? `<div class="ty">${esc(v.visitType)}</div>` : ""}
    <div class="ti">${esc(v.title || v.customer || "Visit")}</div>
    ${v.title && v.customer ? `<div class="jb">${esc(v.customer)}</div>` : ""}
    <div class="jb">${esc([v.jobNo, v.site].filter(Boolean).join(" · "))}</div>
    <div class="tm">${esc(range(v))}</div></div>`;
}
function render() {
  const techs = rowsTechs(), D = days();
  $("view").querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.v === VIEW));
  $("date").value = DATE;
  $("tp-btn").textContent = HIDDEN.size ? `Techs: ${techs.length} shown` : "Techs: all";
  const byTechDay = (e, d) => VISITS.filter(v => v.date === d && visible(v) && (v.techEmails || []).map(x => String(x).toLowerCase()).includes(e)).sort((a, b) => (mins(a.time) ?? 9999) - (mins(b.time) ?? 9999));
  let h = "";
  if (!LOADED) h = '<div class="empty">Loading the board…</div>';
  else if (VIEW === "week") {
    h = `<div class="grid" style="grid-template-columns:var(--name-w) repeat(7,minmax(150px,1fr))"><div class="ch corner">${esc(new Date(D[0] + "T12:00:00").toLocaleDateString("en-CA", { month: "long", year: "numeric" }))}</div>`
      + D.map(d => `<div class="ch${d === TODAY ? " today" : ""}">${esc(dayHead(d))}</div>`).join("");
    techs.forEach(t => {
      const c = CLOCKS[t.email], lv = c && LIVE[c.state];
      h += `<div class="tn"><span class="av">${esc(initials(t.name))}</span><div><b>${esc(t.name)}</b>${lv ? `<span class="st vk ${"s-" + lv.toLowerCase()}" style="display:inline-block;padding:1px 7px;border-left-width:1px;margin:0">${esc(lv)}${c.customer ? " · " + esc(c.customer) : ""}</span>` : ""}</div></div>`;
      D.forEach(d => { const vs = byTechDay(t.email, d); h += `<div class="cell${d === TODAY ? " today" : ""}" data-t="${esc(t.email)}" data-d="${d}">${vs.map(v => card(v, t.email)).join("") || '<div class="none">Unscheduled</div>'}<button class="add" data-add title="New visit for ${esc(t.name)}">+</button></div>`; });
    });
    h += "</div>";
  } else {
    const W = (DAY_END - DAY_START) * HOUR_W, d = D[0];
    h = `<div class="grid" style="grid-template-columns:var(--name-w) ${W}px"><div class="ch corner">${esc(longDay(d))}</div><div class="hh">${[...Array(DAY_END - DAY_START)].map((_, i) => `<span style="left:${i * HOUR_W}px">${esc(fmtMin((DAY_START + i) * 60).replace(":00", ""))}</span>`).join("")}</div>`;
    const now = new Date(), nowMin = now.getHours() * 60 + now.getMinutes();
    techs.forEach(t => {
      const vs = byTechDay(t.email, d), c = CLOCKS[t.email], lv = c && LIVE[c.state];
      // Overlapping visits go in lanes so none hide each other.
      const lanes = [], placed = vs.map(v => {
        const s = Math.max(DAY_START * 60, mins(v.time) ?? DAY_START * 60), e = Math.min(DAY_END * 60, s + Math.round((parseFloat(v.durationHrs) || 1) * 60));
        let lane = lanes.findIndex(end => end <= s); if (lane < 0) { lane = lanes.length; lanes.push(0); } lanes[lane] = e;
        return { v, s, e, lane };
      });
      const LH = 74, hgt = Math.max(84, lanes.length * (LH + 4) + 6);
      h += `<div class="tn" style="min-height:${hgt}px"><span class="av">${esc(initials(t.name))}</span><div><b>${esc(t.name)}</b>${lv ? `<span class="st vk ${"s-" + lv.toLowerCase()}" style="display:inline-block;padding:1px 7px;border-left-width:1px;margin:0">${esc(lv)}</span>` : ""}</div></div>`;
      h += `<div class="dayrow cell${d === TODAY ? " today" : ""}" style="min-height:${hgt}px;padding:0" data-t="${esc(t.email)}" data-d="${d}">`
        + [...Array(DAY_END - DAY_START)].map((_, i) => `<div class="hourline" style="left:${i * HOUR_W}px"></div>`).join("")
        + (d === TODAY && nowMin > DAY_START * 60 && nowMin < DAY_END * 60 ? `<div class="nowline" style="left:${(nowMin - DAY_START * 60) * HOUR_W / 60}px"></div>` : "")
        + placed.map(p => card(p.v, t.email).replace('class="vk', `style="left:${(p.s - DAY_START * 60) * HOUR_W / 60 + 2}px;width:${Math.max(70, (p.e - p.s) * HOUR_W / 60 - 4)}px;top:${4 + p.lane * (LH + 4)}px;height:${LH}px" class="vk`)).join("")
        + `<button class="add" data-add title="New visit for ${esc(t.name)}">+</button></div>`;
    });
    h += "</div>";
  }
  if (LOADED && !techs.length) h = '<div class="empty">No techs to show. Pick some under Techs.</div>';
  $("board").innerHTML = h;
  wireBoard();
  renderTray();
}

// ── Drag and drop: card → another tech / day; tray row → a tech ──
let DRAG = null;
function wireBoard() {
  document.querySelectorAll(".vk[data-v]").forEach(el => {
    el.onclick = () => openVisit(el.dataset.v);
    el.ondragstart = e => { DRAG = { id: el.dataset.v, from: el.dataset.from }; el.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", el.dataset.v); };
    el.ondragend = () => { el.classList.remove("dragging"); document.querySelectorAll(".cell.drop").forEach(c => c.classList.remove("drop")); };
  });
  document.querySelectorAll(".cell[data-t]").forEach(c => {
    c.ondragover = e => { if (!DRAG) return; e.preventDefault(); c.classList.add("drop"); };
    c.ondragleave = () => c.classList.remove("drop");
    c.ondrop = e => {
      e.preventDefault(); c.classList.remove("drop"); if (!DRAG) return;
      let time = null;
      if (c.classList.contains("dayrow")) { const r = c.getBoundingClientRect(), x = e.clientX - r.left; time = fmtMin(Math.round((DAY_START * 60 + x * 60 / HOUR_W) / 15) * 15); }
      moveVisit(DRAG.id, DRAG.from, c.dataset.t, c.dataset.d, time); DRAG = null;
    };
    const add = c.querySelector("[data-add]"); if (add) add.onclick = e => { e.stopPropagation(); openVisit(null, { date: c.dataset.d, techEmails: [c.dataset.t] }); };
  });
}
async function moveVisit(id, from, to, date, time) {
  const v = VISITS.find(x => x.id === id); if (!v) return;
  const before = { date: v.date || "", time: v.time || "", techEmails: v.techEmails || [], techNames: v.techNames || [] };
  let emails = (v.techEmails || []).map(e => String(e).toLowerCase());
  if (from && from !== to) emails = emails.filter(e => e !== from);
  if (!emails.includes(to)) emails.push(to);
  const after = { date, techEmails: emails, techNames: emails.map(nameOf) };
  if (time) after.time = time;
  if (after.date === before.date && (!time || time === before.time) && JSON.stringify(emails) === JSON.stringify(before.techEmails.map(e => String(e).toLowerCase()))) return;
  try {
    await updateDoc(doc(db, "fs_visits", id), { ...after, updatedAt: serverTimestamp(), movedBy: ME, movedAt: new Date().toISOString() });
    const what = `${v.title || v.customer || "Visit"} → ${nameOf(to).split(" ")[0]}, ${new Date(date + "T12:00:00").toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric" })}${time ? " " + time : ""}`;
    toast(what, false, async () => { try { await updateDoc(doc(db, "fs_visits", id), { ...before, updatedAt: serverTimestamp() }); toast("Moved back"); } catch (e) { toast(errMsg(e), true); } });
  } catch (e) { console.error(e); toast(errMsg(e), true); }
}

// ── Tray (bottom): visits by status, like BuildOps ──
const TRAY = [
  ["unassigned", "Unassigned", v => !(v.techEmails || []).length && !["complete", "canceled"].includes(v.status)],
  ["scheduled", "Scheduled", v => (v.techEmails || []).length && (v.status || "scheduled") === "scheduled" && !liveFor(v)],
  ["traveling", "Traveling", v => liveFor(v) === "Traveling"],
  ["working", "Working", v => liveFor(v) === "Working" || (v.status === "in_progress" && !liveFor(v))],
  ["paused", "Paused", v => liveFor(v) === "Paused"],
  ["on_hold", "On Hold", v => v.status === "on_hold"],
  ["canceled", "Canceled", v => v.status === "canceled"],
  ["complete", "Complete", v => v.status === "complete"],
  ["all", "All Visits", () => true],
];
const TRAY_CLS = { unassigned: "s-unassigned", scheduled: "s-scheduled", traveling: "s-traveling", working: "s-working", paused: "s-paused", on_hold: "s-on_hold", canceled: "s-canceled", complete: "s-complete", all: "" };
function renderTray() {
  const tray = $("tray"), open = !LS("trayClosed");
  tray.classList.toggle("closed", !open);
  $("tabs").innerHTML = TRAY.map(([k, l, f]) => `<button class="${TRAY_CLS[k]}${open && TAB === k ? " on" : ""}" data-tab="${k}">${l} <small>${VISITS.filter(f).length}</small></button>`).join("")
    + `<span class="sp"></span><button class="btn ghost sm" id="tray-tog">${open ? "Hide list ▾" : "Show list ▴"}</button>`;
  $("tabs").querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { TAB = b.dataset.tab; LS("tab", TAB); LS("trayClosed", false); renderTray(); });
  $("tray-tog").onclick = () => { LS("trayClosed", open); renderTray(); };
  if (!open) return;
  const f = (TRAY.find(t => t[0] === TAB) || TRAY[0])[2];
  const list = VISITS.filter(f).sort((a, b) => (a.date || "").localeCompare(b.date || "") || (mins(a.time) ?? 9999) - (mins(b.time) ?? 9999));
  $("tlist").innerHTML = list.length ? `<table><thead><tr><th></th><th>Date</th><th>Time</th><th>Status</th><th>Visit</th><th>Customer / site</th><th>Job</th><th>Techs</th></tr></thead><tbody>${list.slice(0, 400).map(v =>
    `<tr data-v="${esc(v.id)}"><td><span class="dragme" draggable="true" data-drag="${esc(v.id)}" title="Drag onto a tech to book">⠿</span></td><td>${esc(v.date || "")}</td><td>${esc(range(v))}</td><td><span class="tag ${cls(v)}">${esc(label(v))}</span></td><td>${esc(v.title || v.visitType || "")}</td><td>${esc([v.customer, v.site].filter(Boolean).join(" · "))}</td><td>${esc(v.jobNo || "")}</td><td>${esc((v.techNames || []).join(", ") || "—")}</td></tr>`).join("")}</tbody></table>`
    : `<div class="empty">Nothing ${TAB === "all" ? "here" : "in " + esc((TRAY.find(t => t[0] === TAB) || [])[1] || "")} right now.</div>`;
  $("tlist").querySelectorAll("tr[data-v]").forEach(r => r.onclick = e => { if (!e.target.closest("[data-drag]")) openVisit(r.dataset.v); });
  $("tlist").querySelectorAll("[data-drag]").forEach(h => {
    h.ondragstart = e => { DRAG = { id: h.dataset.drag, from: "" }; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", h.dataset.drag); };
    h.ondragend = () => { DRAG = null; };
  });
}

// ── Visit panel: see and change a visit, or book a new one ──
const pback = $("pback"), panel = $("panel");
const closePanel = () => { panel.classList.remove("on"); pback.classList.remove("on"); };
$("p-close").onclick = closePanel; pback.onclick = closePanel;
document.addEventListener("keydown", e => { if (e.key === "Escape") { closePanel(); $("tp").classList.remove("on"); } });
function openVisit(id, preset) {
  const v = id ? VISITS.find(x => x.id === id) : { status: "scheduled", visitType: "Service call", durationHrs: 2, ...(preset || {}) };
  if (!v) return;
  const on = new Set((v.techEmails || []).map(e => String(e).toLowerCase()));
  const techs = TECHS.slice(); on.forEach(e => { if (!techs.some(t => t.email === e)) techs.push({ email: e, name: nameOf(e) }); });
  const live = id ? Object.values(CLOCKS).filter(c => c.visitId === id) : [];
  const f = (k, l, attrs = "") => `<label class="f">${l}<input id="p-${k}" value="${esc(v[k] ?? "")}" ${attrs}></label>`;
  $("p-h").textContent = id ? (v.jobNo || "Visit") : "New visit";
  $("pb").innerHTML = (live.length ? `<div class="live-now">${live.map(c => `<b>${esc(nameOf(c.tech || ""))}</b> is ${esc((LIVE[c.state] || c.state || "").toLowerCase())} on this visit (clock started ${esc(new Date(c.startedAt).toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" }))}).`).join("<br>")}</div>` : "")
    + `<div class="two"><label class="f">Status<select id="p-status">${Object.entries(STATUS).map(([k, l]) => `<option value="${k}"${(v.status || "scheduled") === k ? " selected" : ""}>${l}</option>`).join("")}</select></label>
       <label class="f">Visit type<select id="p-visitType">${[...new Set([...TYPES, v.visitType].filter(Boolean))].map(t => `<option${t === v.visitType ? " selected" : ""}>${esc(t)}</option>`).join("")}</select></label></div>
    <div class="two">${f("date", "Date", 'type="date"')}${f("time", "Start time", 'placeholder="8:00 AM"')}</div>
    <div class="two">${f("durationHrs", "Expected hours", 'inputmode="decimal"')}${f("jobNo", "Job #")}</div>
    ${f("title", "Title", 'placeholder="e.g. RTU-2 not cooling"')}
    ${f("customer", "Customer")}
    <div class="two">${f("site", "Site")}${f("address", "Address")}</div>
    <div class="two">${f("contactName", "Site contact")}${f("contactPhone", "Contact phone")}</div>
    <label class="f">What to do<textarea id="p-scope">${esc(v.scope || "")}</textarea></label>
    <label class="f">Equipment notes<textarea id="p-equipmentNotes">${esc(v.equipmentNotes || "")}</textarea></label>
    <div class="f">Techs<div class="checks">${techs.map(t => `<label><input type="checkbox" value="${esc(t.email)}"${on.has(t.email) ? " checked" : ""}> ${esc(t.name)}</label>`).join("")}</div></div>`;
  $("pf").innerHTML = `<span class="msg" id="p-msg">${id ? `Created ${v.createdBy ? "by " + esc(nameOf(v.createdBy)) : ""}` : "Techs see it in the tech app as soon as it's saved."}</span>${id ? `<a class="btn ghost sm" href="tech.html#v=${encodeURIComponent(id)}" target="_blank" rel="noopener">Open in tech app</a>` : ""}<button class="btn" id="p-save">${id ? "Save" : "Book visit"}</button>`;
  panel.classList.add("on"); pback.classList.add("on");
  $("p-save").onclick = async () => {
    const g = k => ($("p-" + k).value || "").trim();
    const emails = [...$("pb").querySelectorAll(".checks input:checked")].map(i => i.value);
    const rec = { status: g("status"), visitType: g("visitType"), date: g("date"), time: g("time"), durationHrs: parseFloat(g("durationHrs")) || null, jobNo: g("jobNo"), title: g("title"), customer: g("customer"), site: g("site"), address: g("address"), contactName: g("contactName"), contactPhone: g("contactPhone"), scope: g("scope"), equipmentNotes: g("equipmentNotes"), techEmails: emails, techNames: emails.map(nameOf) };
    if (!rec.customer && !rec.title) { toast("Add a customer or a title.", true); return; }
    if (!rec.date) { toast("Pick a date.", true); return; }
    if (rec.time && mins(rec.time) === null) { toast("Write the time like 8:00 AM.", true); return; }
    $("p-save").disabled = true;
    try {
      if (id) await updateDoc(doc(db, "fs_visits", id), { ...rec, updatedAt: serverTimestamp(), updatedBy: ME });
      else await addDoc(collection(db, "fs_visits"), { ...rec, equipment: [], createdAt: serverTimestamp(), createdBy: ME, updatedAt: serverTimestamp() });
      closePanel(); toast(id ? "Visit saved" : (emails.length ? "Visit booked for " + rec.techNames.map(n => n.split(" ")[0]).join(", ") : "Visit saved as Unassigned"));
    } catch (e) { console.error(e); toast(errMsg(e), true); $("p-save").disabled = false; }
  };
}

// ── Header controls ──
$("view").querySelectorAll("button").forEach(b => b.onclick = () => { VIEW = b.dataset.v; LS("view", VIEW); render(); });
const step = n => { DATE = addDays(DATE, VIEW === "week" ? 7 * n : n); ensureRange(); render(); };
$("prev").onclick = () => step(-1); $("next").onclick = () => step(1);
$("today").onclick = () => { DATE = TODAY; ensureRange(); render(); };
$("date").onchange = () => { if ($("date").value) { DATE = $("date").value; ensureRange(); render(); } };
$("new").onclick = () => openVisit(null, { date: VIEW === "day" ? DATE : (DATE < TODAY ? DATE : TODAY) });
$("hide-done").checked = HIDE_DONE; $("hide-done").onchange = () => { HIDE_DONE = $("hide-done").checked; LS("hideDone", HIDE_DONE); render(); };
$("tp-btn").onclick = e => {
  e.stopPropagation();
  const all = [...TECHS]; VISITS.forEach(v => (v.techEmails || []).forEach(x => { x = String(x).toLowerCase(); if (!all.some(t => t.email === x)) all.push({ email: x, name: nameOf(x) }); }));
  $("tp").innerHTML = all.sort((a, b) => a.name.localeCompare(b.name)).map(t => `<label><input type="checkbox" value="${esc(t.email)}"${HIDDEN.has(t.email) ? "" : " checked"}> ${esc(t.name)}</label>`).join("")
    + `<div class="acts"><button class="btn ghost sm" id="tp-all">All</button><button class="btn ghost sm" id="tp-none">None</button></div>`;
  $("tp").classList.toggle("on");
  const sync = () => { HIDDEN = new Set([...$("tp").querySelectorAll("input:not(:checked)")].map(i => i.value)); LS("hidden", [...HIDDEN]); render(); };
  $("tp").querySelectorAll("input").forEach(i => i.onchange = sync);
  $("tp-all").onclick = () => { $("tp").querySelectorAll("input").forEach(i => i.checked = true); sync(); };
  $("tp-none").onclick = () => { $("tp").querySelectorAll("input").forEach(i => i.checked = false); sync(); };
};
$("tp").onclick = e => e.stopPropagation();
document.addEventListener("click", () => $("tp").classList.remove("on"));

// ── Live data ──
// Visits from 60 days before the week on screen; moving further back reloads from there.
function ensureRange() {
  const want = addDays(monday(DATE), -60);
  if (SINCE && want >= SINCE) return;
  SINCE = want;
  if (unsubV) unsubV();
  unsubV = onSnapshot(query(collection(db, "fs_visits"), where("date", ">=", SINCE)), snap => {
    VISITS = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    LOADED = true; render();
    $("live").textContent = "Live · " + VISITS.length + " visits";
  }, e => { console.error(e); $("board").innerHTML = `<div class="empty">The visits couldn't load: ${esc(/permission/i.test(e.code || e.message) ? "this account isn't allowed to see every visit." : "check the connection.")}</div>`; });
}
(async () => {
  const u = await currentUser();
  if (!u) { $("board").innerHTML = '<div class="empty">Sign in again to see the Crew Board.</div>'; return; }
  await loadTechs();
  onSnapshot(collection(db, "fs_clock"), snap => { CLOCKS = {}; snap.docs.forEach(d => { const c = d.data(); if (c.tech && c.date === TODAY) CLOCKS[String(c.tech).toLowerCase()] = c; }); if (LOADED) render(); }, e => console.warn("fs_clock", e));
  ensureRange();
  setInterval(() => { if (VIEW === "day" && !panel.classList.contains("on")) render(); }, 5 * 60 * 1000);   // keep the red "now" line moving
})();
