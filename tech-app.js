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
    photos: (visitId, cb, onErr) => live(mine("fs_photos", [where("visitId", "==", visitId)]), cb, onErr),
    report: (visitId, cb, onErr) => onSnapshot(doc(db, "fs_reports", visitId + "__" + safeKey(ME)), s => cb(s.exists() ? s.data() : null), onErr),
    setStatus: (v, status) => updateDoc(doc(db, "fs_visits", v.id), { status, statusAt: new Date().toISOString(), statusBy: ME, updatedAt: serverTimestamp() }),
    addTime: rec => addDoc(C("fs_time"), { ...rec, createdAt: serverTimestamp() }),
    delTime: id => deleteDoc(doc(db, "fs_time", id)),
    saveReport: (v, summary) => setDoc(doc(db, "fs_reports", v.id + "__" + safeKey(ME)), { visitId: v.id, jobNo: v.jobNo || "", tech: ME, techName: MY_NAME, summary, updatedAt: serverTimestamp() }, { merge: true }),
    addPhoto: rec => addDoc(C("fs_photos"), { ...rec, createdAt: serverTimestamp() }),
    delPhoto: id => deleteDoc(doc(db, "fs_photos", id)),
    addVisit: rec => addDoc(C("fs_visits"), { ...rec, createdAt: serverTimestamp(), createdBy: ME, updatedAt: serverTimestamp() }),
  };
}

function demoStore() {
  const subs = new Set(), wait = () => new Promise(r => setTimeout(r, 350));
  const D = { visits: [], time: [], photos: [], reports: {} };
  const emit = () => subs.forEach(f => f());
  const sub = f => { subs.add(f); f(); return () => subs.delete(f); };
  let n = 1; const id = () => "demo" + (n++);
  const v = (o) => ({ id: id(), status: "scheduled", techEmails: [ME], techNames: [MY_NAME], ...o });
  D.visits.push(
    v({ date: TODAY, time: "8:00 AM", jobNo: "JO-DEMO-101", customer: "Lakeview Medical Centre", site: "Main building", address: "120 Lakeshore Rd, St. Catharines, ON", contactName: "Paula Reyes (facilities)", contactPhone: "905-555-0142", scope: "RTU-2 not cooling. Tenant reports warm air on the 2nd floor east side since yesterday afternoon. Check refrigerant charge and condenser fan motor.", equipmentNotes: "Roof access by the east stairwell. Sign in at security first.", equipment: [{ name: "RTU-2", make: "Carrier", model: "48TC 7.5 ton", serial: "4519G20871" }] }),
    v({ date: TODAY, time: "1:00 PM", jobNo: "SA1024-3", customer: "Harbour Street Lofts", site: "Mechanical room B1", address: "45 Harbour St, Port Dalhousie, ON", contactName: "Sam Ito (superintendent)", contactPhone: "905-555-0177", scope: "Quarterly maintenance: boilers 1 and 2, pumps, filters on the make-up air unit.", equipmentNotes: "Boiler 2 had a low-water alarm last quarter. Check the probe.", equipment: [{ name: "Boiler 1", make: "Viessmann", model: "Vitocrossal 300", serial: "7514388" }, { name: "Boiler 2", make: "Viessmann", model: "Vitocrossal 300", serial: "7514391" }] }),
    v({ date: addDays(TODAY, 1), time: "9:30 AM", jobNo: "JO-DEMO-108", customer: "Northgate Public School", site: "Gym wing", address: "300 Northgate Ave, Welland, ON", contactName: "Front office", contactPhone: "905-555-0110", scope: "Replace the failed exhaust fan motor on EF-4 (part on the truck).", equipmentNotes: "", equipment: [{ name: "EF-4", make: "Greenheck", model: "CUE-140", serial: "" }] }),
    v({ date: addDays(TODAY, -1), time: "10:00 AM", jobNo: "JO-DEMO-099", customer: "Lakeview Medical Centre", site: "Main building", address: "120 Lakeshore Rd, St. Catharines, ON", contactName: "Paula Reyes", contactPhone: "905-555-0142", scope: "Thermostat call, room 214.", status: "complete" }),
  );
  D.time.push({ id: id(), visitId: D.visits[3].id, tech: ME, techName: MY_NAME, date: addDays(TODAY, -1), hours: 1.5, type: "Regular", note: "" });
  D.reports[D.visits[3].id] = { summary: "Replaced the batteries in the room 214 thermostat and recalibrated. Room holding 22°C." };
  return {
    visits: cb => sub(() => cb(D.visits.slice())),
    time: (vid, cb) => sub(() => cb(D.time.filter(t => t.visitId === vid))),
    photos: (vid, cb) => sub(() => cb(D.photos.filter(p => p.visitId === vid))),
    report: (vid, cb) => sub(() => cb(D.reports[vid] || null)),
    setStatus: async (v, status) => { await wait(); Object.assign(D.visits.find(x => x.id === v.id), { status }); emit(); },
    addTime: async rec => { await wait(); D.time.push({ id: id(), ...rec }); emit(); },
    delTime: async tid => { await wait(); D.time = D.time.filter(t => t.id !== tid); emit(); },
    saveReport: async (v, summary) => { await wait(); D.reports[v.id] = { summary }; emit(); },
    addPhoto: async rec => { await wait(); D.photos.push({ id: id(), ...rec }); emit(); },
    delPhoto: async pid => { await wait(); D.photos = D.photos.filter(p => p.id !== pid); emit(); },
    addVisit: async rec => { await wait(); D.visits.push({ id: id(), ...rec }); emit(); },
  };
}

// ── State + routing (#v=<id> opens a visit) ──
let VISITS = [], LOADED = false, TAB = "today", ALL = false, unsub = [], BANNER = "";
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
  const id = route();
  if (id) return renderVisit(id);
  renderList();
}

// ── List ──
function inTab(v) {
  const done = v.status === "complete";
  if (TAB === "done") return done;
  if (done) return false;
  if (TAB === "today") return (v.date || "") <= TODAY;
  return (v.date || "") > TODAY;
}
function renderList() {
  $("title").firstChild.textContent = "My Visits";
  const mine = v => ALL || (v.techEmails || []).includes(ME);
  const pool = VISITS.filter(mine);
  const count = t => pool.filter(v => { const k = TAB; TAB = t; const r = inTab(v); TAB = k; return r; }).length;
  let list = pool.filter(inTab).sort((a, b) => TAB === "done" ? (b.date || "").localeCompare(a.date || "") : (a.date || "").localeCompare(b.date || "") || tmin(a.time) - tmin(b.time));
  if (TAB === "done") list = list.slice(0, 40);
  let h = banner();
  h += `<div class="tabs" role="tablist">${[["today", "Today"], ["upcoming", "Upcoming"], ["done", "Done"]].map(([k, l]) => `<button role="tab" data-tab="${k}" class="${TAB === k ? "on" : ""}" aria-selected="${TAB === k}">${l}<span>${count(k)}</span></button>`).join("")}</div>`;
  if (OFFICE) h += `<div class="tools"><button class="act" id="new-v">+ New visit</button><label><input type="checkbox" id="all-t" ${ALL ? "checked" : ""}> Show every tech</label></div>`;
  if (!LOADED) h += `<div class="empty">Loading your visits…</div>`;
  else if (!list.length) h += `<div class="empty">${TAB === "today" ? "Nothing scheduled for today." : TAB === "upcoming" ? "No upcoming visits yet." : "No completed visits yet."}${OFFICE ? "" : "<br>New visits show up here as soon as the office assigns them."}</div>`;
  else {
    let last = null;
    list.forEach(v => {
      const d = TAB === "today" && v.date < TODAY ? "Still open from earlier" : dayLabel(v.date);
      if (d !== last) { h += `<div class="day">${esc(d)}</div>`; last = d; }
      h += `<a class="card" href="#v=${encodeURIComponent(v.id)}"><div class="top"><div><div class="time">${esc(v.time || "Any time")}</div><div class="cust">${esc(v.customer || "Customer")}</div><div class="site">${esc([v.site, short(v.address)].filter(Boolean).join(" · "))}</div></div><span class="chip ${esc(v.status || "scheduled")}">${esc(STATUS[v.status] || "Scheduled")}</span></div>${v.scope ? `<div class="desc">${esc(v.scope)}</div>` : ""}${ALL || (v.techNames || []).length > 1 ? `<div class="who">${esc((v.techNames || []).join(", "))}${v.jobNo ? " · " + esc(v.jobNo) : ""}</div>` : v.jobNo ? `<div class="who">${esc(v.jobNo)}</div>` : ""}</a>`;
    });
  }
  $("app").innerHTML = h;
  document.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { TAB = b.dataset.tab; renderList(); });
  if ($("new-v")) $("new-v").onclick = openNewVisit;
  if ($("all-t")) $("all-t").onchange = e => { ALL = e.target.checked; renderList(); };
}
const short = a => String(a || "").replace(/,\s*(ON|Ontario)\b.*$/i, "").replace(/,\s*CA(nada)?$/i, "");
const tmin = t => { const m = String(t || "").match(/(\d{1,2}):?(\d{2})?\s*([ap])?/i); if (!m) return 9999; let h = +m[1] % 12; if (/p/i.test(m[3] || "")) h += 12; return h * 60 + (+m[2] || 0); };

// ── Visit ──
function renderVisit(id) {
  const v = VISITS.find(x => x.id === id);
  if (!v) { $("app").innerHTML = banner() + `<button class="back" onclick="location.hash=''">‹ My visits</button><div class="empty">${LOADED ? "This visit isn't assigned to you, or it was removed." : "Loading…"}</div>`; return; }
  $("title").firstChild.textContent = v.jobNo || "Visit";
  const maps = v.address ? (/iPhone|iPad|Mac/.test(navigator.userAgent) ? "https://maps.apple.com/?q=" : "https://www.google.com/maps/search/?api=1&query=") + encodeURIComponent(v.address) : "";
  const tel = String(v.contactPhone || "").replace(/[^\d+]/g, "");
  const st = v.status || "scheduled";
  $("app").innerHTML = banner() + `
    <button class="back" id="back">‹ My visits</button>
    <div class="vhead"><h2>${esc(v.customer || "Customer")}</h2><div class="site">${esc(v.site || "")}</div>
      <div class="meta"><span class="chip ${esc(st)}">${esc(STATUS[st])}</span><span>${esc(dayLabel(v.date))}${v.time ? " · " + esc(v.time) : ""}</span>${(v.techNames || []).length > 1 ? `<span>with ${esc(v.techNames.filter(n => n !== MY_NAME).map(first).join(", "))}</span>` : ""}</div></div>
    <div class="statusbar">${st === "scheduled" ? `<button class="big" data-st="in_progress">Start visit</button>` : st === "in_progress" ? `<button class="big done" data-st="complete">Complete visit</button>` : `<button class="big ghost" data-st="in_progress">Reopen visit</button>`}</div>
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

  $("back").onclick = () => { location.hash = ""; };
  document.querySelectorAll("[data-st]").forEach(b => b.onclick = async () => {
    const to = b.dataset.st;
    if (to === "complete" && !SUMMARY_SAVED && !confirm("You haven't saved a visit summary yet. Complete the visit anyway?")) return;
    b.disabled = true;
    const msg = to === "complete" ? "Visit completed" : "Visit started";
    if (await save(() => store.setStatus(v, to), $("st-saved"), msg)) toast(msg + (navigator.onLine ? "" : " · will upload when you're back in coverage"));
    if (b.isConnected) b.disabled = false;
  });

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
  let SUMMARY_SAVED = false, typed = false;
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
    const rec = { date: $("n-date").value, time: $("n-time").value.trim(), customer: $("n-cust").value.trim(), site: $("n-site").value.trim(), jobNo: $("n-job").value.trim(), address: $("n-addr").value.trim(), contactName: $("n-cname").value.trim(), contactPhone: $("n-cphone").value.trim(), scope: $("n-scope").value.trim(), equipmentNotes: $("n-eq").value.trim(), equipment: [], techEmails: picked.map(i => i.value), techNames: picked.map(i => i.dataset.name), status: "scheduled" };
    if (!rec.customer || !rec.date || !rec.techEmails.length) { toast("Add a customer, a date and at least one tech.", true); return; }
    if (await save(() => store.addVisit(rec), $("n-saved"), "Visit saved")) { sh.classList.remove("on"); toast("Visit saved and sent to " + rec.techNames.map(first).join(", ")); }
  };
}

// ── Menu ──
$("menu-btn").onclick = e => { e.stopPropagation(); $("menu").classList.toggle("on"); };
document.addEventListener("click", () => $("menu").classList.remove("on"));
$("m-out").onclick = () => { if (PENDING && !confirm("Some saves haven't uploaded yet. Sign out anyway?")) return; if (typeof apLogout === "function") apLogout(); };
$("m-help").onclick = () => alert(/iPhone|iPad/.test(navigator.userAgent)
  ? "In Safari, tap the Share button (square with an arrow), then 'Add to Home Screen'. Alpine opens like an app from then on."
  : "In Chrome, open the ⋮ menu and choose 'Add to Home screen' or 'Install app'.");
if (DEMO) $("m-portal").style.display = "none";

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
  store.visits(rows => { VISITS = rows; LOADED = true; BANNER = ""; const id = route(); if (!id || !document.activeElement || document.activeElement === document.body) render(); }, err);
  render();
})();
