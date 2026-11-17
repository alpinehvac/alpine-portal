// ── Alpine HVAC — Team Hub > Team Reports (owners: Jake, Mike) ────────
// Three tabs inside team-hub.html:
//   Weekly Reports  — every team member's weekly report (EntreLeadership style): executive summary,
//                     quick glance per person, 12-week trend, follow-up flags.
//   Report Cards    — monthly report card per team member: draft, publish (they see it on
//                     my-reports.html), email them the link, see their reply.
//   Offboarding     — checklist per departing person by party, exit survey send + answers,
//                     takeaways and actions.
// Scheduled tasks write here through window.apTeamReports (see TEAM-REPORTS.md).
// Definitions and Firestore layout: team-reports-lib.js.

import { collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, query, where, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";
import { db, currentUser } from "./ap-firebase.js";
import * as T from "./team-reports-lib.js?v=1";

const esc = T.esc;
const $ = id => document.getElementById(id);
const SESSION = (typeof apGetSession === "function" && apGetSession()) || {};
const OWNER = typeof apIsOwner === "function" && apIsOwner();
const ME = (SESSION.email || "").toLowerCase();
const OWNERS = ["jake.gilmore@alpinehvac.ca", "mike.launder@alpinehvac.ca"];
const LINK = T.PORTAL + "my-reports.html";

function toast(t, bad) {
  let el = $("tr-toast");
  if (!el) { el = document.createElement("div"); el.id = "tr-toast"; el.className = "tr-toast"; document.body.appendChild(el); }
  el.textContent = t; el.className = "tr-toast show" + (bad ? " bad" : "");
  clearTimeout(toast._t); toast._t = setTimeout(() => el.className = "tr-toast", bad ? 7000 : 3000);
}
const tsDate = ts => ts && ts.toDate ? ts.toDate() : ts ? new Date(ts) : null;
const when = ts => { const d = tsDate(ts); return d ? d.toLocaleDateString("en-CA", { month: "short", day: "numeric" }) : ""; };
const outlook = (to, subject, body) => `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
const first = n => String(n || "").split(" ")[0];
const uid = () => Math.random().toString(36).slice(2, 9);

// ── Team list: Users & Settings (portal_users) + built-in list, active only ──
let TEAM = [];
async function loadTeam() {
  const map = {};
  if (typeof AP_USERS === "object") Object.entries(AP_USERS).forEach(([e, u]) => map[e] = { email: e, name: u.name, roles: u.roles, active: true });
  try { (await getDocs(collection(db, "portal_users"))).forEach(d => { const r = d.data(); map[d.id] = { email: d.id, name: r.name || d.id, roles: r.roles || [], active: r.active !== false }; }); } catch (e) { console.warn("portal_users", e); }
  // Titles from Team Files roster (team-hub-app.js), when it's loaded on this page.
  const roster = (typeof TF_ROSTER !== "undefined" && TF_ROSTER) || [];
  roster.forEach(r => { if (r.email && map[r.email]) map[r.email].title = r.title; });
  TEAM = Object.values(map).filter(u => u.active && (u.roles || []).length).sort((a, b) => a.name.localeCompare(b.name));
}
// Weekly reports are expected from everyone except Jake (they go to Jake). Report cards: everyone except the owners.
const reporters = () => TEAM.filter(u => u.email !== OWNERS[0]);
const graded = () => TEAM.filter(u => !OWNERS.includes(u.email));
const nameOf = email => (TEAM.find(u => u.email === email) || {}).name || email;

// ══════════════════════════════════════════════════════════════════
// WEEKLY REPORTS
// ══════════════════════════════════════════════════════════════════
let WR = [];               // reports, last 13 weeks
let WR_WEEK = T.defaultWeek();
let WR_OPEN = {};
async function loadWeekly() {
  const from = T.addWeeks(T.weekKey(new Date()), -13);
  const snap = await getDocs(query(collection(db, "team_reports"), where("week", ">=", from)));
  WR = snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
const avgOf = (rows, k) => { const v = rows.map(r => +r[k]).filter(n => n >= 1); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };

function trendSvg(series, w = 640, h = 170) {
  // series: [{name, color, values:[{x:label, y:1-5|null}]}]
  const n = series[0].values.length, pl = 34, pr = 26, pt = 10, pb = 26;
  const X = i => pl + (i * (w - pl - pr)) / Math.max(1, n - 1), Y = v => pt + ((5 - v) * (h - pt - pb)) / 4;
  let g = "";
  for (let v = 1; v <= 5; v++) g += `<line x1="${pl}" x2="${w - pr}" y1="${Y(v)}" y2="${Y(v)}" stroke="rgba(16,68,78,.08)"/><text x="${pl - 8}" y="${Y(v) + 4}" font-size="10" text-anchor="end" fill="#5A7A80">${v}</text>`;
  series[0].values.forEach((p, i) => { if (i % 2 === 0 || i === n - 1) g += `<text x="${X(i)}" y="${h - 8}" font-size="10" text-anchor="middle" fill="#5A7A80">${esc(p.x)}</text>`; });
  series.forEach(s => {
    let d = "", pen = false;
    s.values.forEach((p, i) => { if (p.y == null) { pen = false; return; } d += (pen ? "L" : "M") + X(i).toFixed(1) + " " + Y(p.y).toFixed(1) + " "; pen = true; });
    g += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>`;
    s.values.forEach((p, i) => { if (p.y != null) g += `<circle cx="${X(i)}" cy="${Y(p.y)}" r="3" fill="${s.color}"><title>${esc(s.name)} ${esc(p.x)}: ${p.y.toFixed(1)}</title></circle>`; });
  });
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="Twelve-week trend">${g}</svg>`;
}
const COLORS = { morale: "#27636C", stress: "#9B8EC4", workload: "#A9821F" };

function renderWeekly() {
  const el = $("tr-weekly"); if (!el) return;
  const thisWeek = T.weekKey(new Date());
  const rows = WR.filter(r => r.week === WR_WEEK);
  const prev = WR.filter(r => r.week === T.addWeeks(WR_WEEK, -1));
  const people = reporters();
  const byEmail = Object.fromEntries(rows.map(r => [r.email, r]));
  const missing = people.filter(p => !byEmail[p.email]);
  const tiles = T.SCALES.map(s => {
    const a = avgOf(rows, s.key), b = avgOf(prev, s.key), d = a != null && b != null ? a - b : null;
    return `<div class="tr-tile ${T.tone(a)}"><span>${esc(s.key)}</span><b>${a == null ? "–" : a.toFixed(1)}</b><em>${a == null ? "No reports yet" : esc(s.labels[Math.round(a) - 1])}${d != null && Math.abs(d) >= 0.05 ? ` · ${d > 0 ? "▲" : "▼"} ${Math.abs(d).toFixed(1)} vs last week` : ""}</em></div>`;
  }).join("");
  const glance = people.map(p => {
    const r = byEmail[p.email];
    if (!r) return `<div class="tr-row miss"><span class="tr-av">${esc(T.initials(p.name))}</span><div class="tr-who"><b>${esc(p.name)}</b> is missing a report</div>
      <a class="tr-btn ghost sm" href="${outlook(p.email, `Weekly report – week of ${T.weekLabel(WR_WEEK)}`, `Hi ${first(p.name)},\n\nQuick reminder to send your weekly report for ${T.weekLabel(WR_WEEK)}. It takes about 5 minutes:\n${LINK}\n\nThanks,\n${first(SESSION.name)}`)}">Remind</a></div>`;
    const avg = T.weekAvg(r), open = WR_OPEN[r.id], flag = T.flagged(r);
    const hist = Array.from({ length: 8 }, (_, i) => { const wk = T.addWeeks(WR_WEEK, i - 7); const x = WR.find(q => q.week === wk && q.email === p.email); return x ? T.weekAvg(x) : null; });
    const spark = hist.map(v => `<i class="${T.tone(v)}" style="height:${v ? v * 20 : 6}%" title="${v ? v.toFixed(1) : "no report"}"></i>`).join("");
    return `<div class="tr-row ${flag ? "flag" : ""}" data-open="${r.id}">
      <span class="tr-av">${esc(T.initials(p.name))}</span>
      <div class="tr-who"><b>${esc(p.name)}</b> had ${esc(T.weekWord(avg))}
        <div class="tr-chips">${T.SCALES.map(s => `<span class="tr-chip ${T.tone(+r[s.key])}">${esc(s.key)}: ${esc(s.labels[+r[s.key] - 1] || "–")}</span>`).join("")}${flag ? `<span class="tr-chip bad">Follow up</span>` : ""}${r.followedUp ? `<span class="tr-chip good">Followed up ✓</span>` : ""}</div></div>
      <div class="tr-spark" title="Last 8 weeks">${spark}</div><span class="tr-caret">${open ? "▾" : "▸"}</span></div>
      ${open ? `<div class="tr-detail">
        ${T.TEXTS.map(t => r[t.key] ? `<div><h4>${esc(t.q.replace(" this week?", "").replace("?", ""))}</h4><p>${esc(r[t.key])}</p></div>` : "").join("")}
        <div class="tr-actions"><span class="tr-muted">Sent ${esc(when(r.updatedAt || r.submittedAt))}</span><span style="flex:1"></span>
          <a class="tr-btn ghost sm" href="${outlook(p.email, `Re: your weekly report (${T.weekLabel(WR_WEEK)})`, `Hi ${first(p.name)},\n\nThanks for your weekly report. \n\n`)}">Reply by email</a>
          <button class="tr-btn ${r.followedUp ? "ghost" : ""} sm" data-fu="${r.id}">${r.followedUp ? "Undo followed up" : "Mark followed up"}</button></div></div>` : ""}`;
  }).join("");
  const weeks = Array.from({ length: 12 }, (_, i) => T.addWeeks(WR_WEEK, i - 11));
  const series = T.SCALES.map(s => ({ name: s.key, color: COLORS[s.key], values: weeks.map(wk => ({ x: T.parseYmd(wk).toLocaleDateString("en-CA", { month: "short", day: "numeric" }), y: avgOf(WR.filter(r => r.week === wk), s.key) })) }));
  el.innerHTML = `
    <div class="tr-head"><div><div class="tr-eyebrow">Team Reports</div><h2 class="tr-h">Weekly Reports</h2>
      <p class="tr-muted">Each team member gets a Friday email with a link to <a href="my-reports.html" target="_blank">My Weekly Report</a>: morale, stress, workload, their high, their low, anything else. Only Jake and Mike see this page.</p></div>
      <div class="tr-weeknav"><button class="tr-btn ghost sm" id="wr-prev">‹</button><b>${esc(T.weekLabel(WR_WEEK))}</b><button class="tr-btn ghost sm" id="wr-next" ${WR_WEEK >= thisWeek ? "disabled" : ""}>›</button></div></div>
    <div class="tr-sec">Executive summary <span class="tr-muted">· ${rows.length} of ${people.length} reports in</span></div>
    <div class="tr-tiles">${tiles}</div>
    <div class="tr-sec">Quick glance ${missing.length ? `<span class="tr-muted">· ${missing.length} missing</span>` : ""}
      ${missing.length ? `<a class="tr-btn ghost sm" style="float:right" href="${outlook(missing.map(m => m.email).join(";"), `Weekly report – week of ${T.weekLabel(WR_WEEK)}`, `Hi team,\n\nQuick reminder to send your weekly report for ${T.weekLabel(WR_WEEK)}. It takes about 5 minutes:\n${LINK}\n\nThanks,\n${first(SESSION.name)}`)}">Remind all missing</a>` : ""}</div>
    <div class="tr-list">${glance || `<div class="tr-empty">No team members found.</div>`}</div>
    <div class="tr-sec">Twelve-week trend <span class="tr-legend">${T.SCALES.map(s => `<span><i style="background:${COLORS[s.key]}"></i>${esc(s.key)}</span>`).join("")}</span></div>
    <div class="tr-box">${trendSvg(series)}<p class="tr-muted" style="margin-top:.4rem">Team average, 1–5. Higher is healthier on every line (5 = great morale, healthy stress, good workload).</p></div>`;
  $("wr-prev").onclick = () => { WR_WEEK = T.addWeeks(WR_WEEK, -1); renderWeekly(); };
  $("wr-next").onclick = () => { if (WR_WEEK < thisWeek) { WR_WEEK = T.addWeeks(WR_WEEK, 1); renderWeekly(); } };
  el.querySelectorAll("[data-open]").forEach(r => r.onclick = () => { WR_OPEN[r.dataset.open] = !WR_OPEN[r.dataset.open]; renderWeekly(); });
  el.querySelectorAll("[data-fu]").forEach(b => b.onclick = async e => {
    e.stopPropagation(); const r = WR.find(x => x.id === b.dataset.fu); const v = !r.followedUp;
    try { await updateDoc(doc(db, "team_reports", r.id), { followedUp: v, followedUpBy: ME }); r.followedUp = v; renderWeekly(); }
    catch (err) { toast("Couldn't save: " + (err.code || err.message), true); }
  });
}

// ══════════════════════════════════════════════════════════════════
// REPORT CARDS
// ══════════════════════════════════════════════════════════════════
let RC_MONTH = T.monthKey();
let CARDS = {};            // id -> card
let PRIV = {};             // id -> { evidence }
let RC_EDIT = null;        // email being edited
async function loadCards() {
  const snap = await getDocs(query(collection(db, "report_cards"), where("month", "==", RC_MONTH)));
  CARDS = {}; snap.forEach(d => CARDS[d.id] = { id: d.id, ...d.data() });
}
function statusPill(c) {
  if (!c) return `<span class="tr-chip">Not started</span>`;
  if (c.status !== "published") return `<span class="tr-chip mid">Draft${c.source === "claude" ? " · auto" : ""}</span>`;
  return c.ackAt ? `<span class="tr-chip good">Read ${esc(when(c.ackAt))}${c.ackReply ? " · replied" : ""}</span>` : `<span class="tr-chip purple">Sent ${esc(when(c.publishedAt))}</span>`;
}
function renderCards() {
  const el = $("tr-cards"); if (!el) return;
  const people = graded();
  const list = people.map(p => { const c = CARDS[T.cardId(RC_MONTH, p.email)]; return `
    <div class="tr-row ${RC_EDIT === p.email ? "sel" : ""}" data-edit="${esc(p.email)}"><span class="tr-av">${esc(T.initials(p.name))}</span>
      <div class="tr-who"><b>${esc(p.name)}</b><div class="tr-muted">${esc(p.title || "")}</div></div>
      ${c && c.grade ? `<span class="tr-grade">${esc(c.grade)}</span>` : ""}${statusPill(c)}<span class="tr-caret">▸</span></div>`; }).join("");
  const done = people.filter(p => (CARDS[T.cardId(RC_MONTH, p.email)] || {}).status === "published").length;
  el.innerHTML = `
    <div class="tr-head"><div><div class="tr-eyebrow">Team Reports</div><h2 class="tr-h">Monthly Report Cards</h2>
      <p class="tr-muted">Feedback from leadership, rated on the four Core Principles: where they did great, where to improve, and the focus for next month. Drafts are prepared on the 25th from team meetings (Fireflies), email and that month's weekly reports. Edit, then Publish: the person sees it on My Weekly Report and can reply.</p></div>
      <div class="tr-weeknav"><button class="tr-btn ghost sm" id="rc-prev">‹</button><b>${esc(T.monthLabel(RC_MONTH))}</b><button class="tr-btn ghost sm" id="rc-next">›</button></div></div>
    <div class="tr-sec">${done} of ${people.length} sent</div>
    <div class="tr-split"><div class="tr-list">${list}</div><div id="rc-editor">${RC_EDIT ? "" : `<div class="tr-empty">Pick a team member to write or review their card.</div>`}</div></div>`;
  $("rc-prev").onclick = async () => { RC_MONTH = T.addMonths(RC_MONTH, -1); RC_EDIT = null; await loadCards(); renderCards(); };
  $("rc-next").onclick = async () => { RC_MONTH = T.addMonths(RC_MONTH, 1); RC_EDIT = null; await loadCards(); renderCards(); };
  el.querySelectorAll("[data-edit]").forEach(r => r.onclick = () => { RC_EDIT = r.dataset.edit; renderCards(); });
  if (RC_EDIT) renderEditor();
}
async function renderEditor() {
  const p = TEAM.find(u => u.email === RC_EDIT) || { email: RC_EDIT, name: RC_EDIT };
  const id = T.cardId(RC_MONTH, p.email);
  const c = CARDS[id] || { email: p.email, name: p.name, month: RC_MONTH, ratings: {} };
  if (!(id in PRIV)) { try { const s = await getDoc(doc(db, "report_cards_private", id)); PRIV[id] = s.exists() ? s.data() : {}; } catch (e) { PRIV[id] = {}; } }
  const ev = PRIV[id].evidence || "";
  // That month's weekly reports for context
  const mStart = RC_MONTH + "-01", mEnd = T.addMonths(RC_MONTH, 1) + "-01";
  const wks = WR.filter(r => r.email === p.email && r.week >= T.weekKey(T.parseYmd(mStart)) && r.week < mEnd).sort((a, b) => a.week.localeCompare(b.week));
  const box = $("rc-editor"); if (!box) return;
  box.innerHTML = `<div class="tr-box">
    <div class="tr-edhead"><b>${esc(p.name)}</b> · ${esc(T.monthLabel(RC_MONTH))} ${statusPill(CARDS[id])}</div>
    <label class="tr-lbl">Overall grade</label>
    <select id="rc-grade"><option value="">–</option>${T.GRADES.map(g => `<option ${c.grade === g ? "selected" : ""}>${g}</option>`).join("")}</select>
    <label class="tr-lbl">Core Principles</label>
    ${T.PRINCIPLES.map(pr => `<div class="tr-prow"><div><b>${esc(pr.name)}</b><small>${esc(pr.line)}</small></div>
      <div class="tr-stars" data-p="${pr.key}">${[1, 2, 3, 4, 5].map(v => `<button type="button" data-v="${v}" class="${(+(c.ratings || {})[pr.key] || 0) >= v ? "on" : ""}" title="${T.RATING_WORDS[v]}">★</button>`).join("")}<em>${esc(T.RATING_WORDS[+(c.ratings || {})[pr.key] || 0] || "")}</em></div></div>`).join("")}
    ${T.CARD_TEXTS.map(t => `<label class="tr-lbl">${esc(t.label)}</label><textarea id="rc-${t.key}" placeholder="${esc(t.hint)}">${esc(c[t.key] || "")}</textarea>`).join("")}
    <label class="tr-lbl">Evidence and sources <span class="tr-muted">(leaders only, never shown to ${esc(first(p.name))})</span></label>
    <textarea id="rc-evidence" class="tr-ev" placeholder="Meetings, emails and weekly reports this card is based on">${esc(ev)}</textarea>
    ${wks.length ? `<details class="tr-ctx"><summary>${esc(first(p.name))}'s weekly reports this month (${wks.length})</summary>${wks.map(r => `<div><b>${esc(T.weekLabel(r.week))}</b> · ${esc(T.weekWord(T.weekAvg(r)))}<br><span class="tr-muted">High:</span> ${esc(r.high)}<br><span class="tr-muted">Low:</span> ${esc(r.low)}${r.other ? `<br><span class="tr-muted">Else:</span> ${esc(r.other)}` : ""}</div>`).join("")}</details>` : ""}
    ${c.ackReply ? `<div class="tr-reply"><b>${esc(first(p.name))} replied ${esc(when(c.ackAt))}:</b> ${esc(c.ackReply)}</div>` : ""}
    <div class="tr-actions">
      ${CARDS[id] ? `<button class="tr-btn danger sm" id="rc-del">Delete</button>` : ""}<span style="flex:1"></span>
      <button class="tr-btn ghost sm" id="rc-preview">Preview</button>
      <button class="tr-btn ghost" id="rc-save">Save draft</button>
      ${c.status === "published" ? `<button class="tr-btn ghost" id="rc-unpub">Unpublish</button><a class="tr-btn ghost" href="${outlook(p.email, `Your ${T.monthLabel(RC_MONTH)} report card`, `Hi ${first(p.name)},\n\nYour ${T.monthLabel(RC_MONTH)} report card from Jake and Mike is ready:\n${LINK}#cards\n\nHave a read, and hit "Got it" (add a reply if you like). Happy to talk any of it through.\n\nThanks,\n${first(SESSION.name)}`)}">Email ${esc(first(p.name))} the link</a>` : `<button class="tr-btn" id="rc-pub">Publish to ${esc(first(p.name))}</button>`}
    </div><div id="rc-prev-box"></div></div>`;
  const ratings = { ...(c.ratings || {}) };
  box.querySelectorAll(".tr-stars button").forEach(b => b.onclick = () => {
    const k = b.parentElement.dataset.p, v = +b.dataset.v; ratings[k] = ratings[k] === v ? 0 : v;
    b.parentElement.querySelectorAll("button").forEach(x => x.classList.toggle("on", +x.dataset.v <= ratings[k]));
    b.parentElement.querySelector("em").textContent = T.RATING_WORDS[ratings[k]] || "";
  });
  const collect = () => { const o = { email: p.email, name: p.name, month: RC_MONTH, grade: $("rc-grade").value, ratings, updatedAt: serverTimestamp(), updatedBy: ME }; T.CARD_TEXTS.forEach(t => o[t.key] = $("rc-" + t.key).value.trim()); return o; };
  const save = async extra => {
    const o = { ...collect(), ...(extra || {}) };
    if (!CARDS[id]) { o.status = o.status || "draft"; o.createdAt = serverTimestamp(); }
    if (CARDS[id] && CARDS[id].source === "claude") o.source = "claude-edited";
    await setDoc(doc(db, "report_cards", id), o, { merge: true });
    await setDoc(doc(db, "report_cards_private", id), { email: p.email, month: RC_MONTH, evidence: $("rc-evidence").value, updatedAt: serverTimestamp() }, { merge: true });
    PRIV[id] = { evidence: $("rc-evidence").value };
    CARDS[id] = { ...(CARDS[id] || {}), ...o, id, updatedAt: new Date(), publishedAt: o.publishedAt ? new Date() : (CARDS[id] || {}).publishedAt };
  };
  $("rc-save").onclick = async () => { try { await save(); toast("Draft saved"); renderCards(); } catch (e) { toast("Couldn't save: " + (e.code || e.message), true); } };
  $("rc-preview").onclick = () => { $("rc-prev-box").innerHTML = `<div class="tr-sec">What ${esc(first(p.name))} will see</div>` + T.cardHtml({ ...c, ...collect() }); };
  const pub = $("rc-pub"); if (pub) pub.onclick = async () => {
    const o = collect(); if (!o.wins || !o.improve) { toast("Fill in 'Where you did great' and 'Where you can improve' before publishing.", true); return; }
    if (!confirm(`Publish this card to ${p.name}? They'll see it on My Weekly Report.`)) return;
    try { await save({ status: "published", publishedAt: serverTimestamp(), publishedBy: ME }); toast(`Published. Now email ${first(p.name)} the link.`); renderCards(); } catch (e) { toast("Couldn't publish: " + (e.code || e.message), true); }
  };
  const un = $("rc-unpub"); if (un) un.onclick = async () => { try { await save({ status: "draft" }); toast("Unpublished"); renderCards(); } catch (e) { toast("Couldn't save: " + (e.code || e.message), true); } };
  const del = $("rc-del"); if (del) del.onclick = async () => {
    if (!confirm("Delete this report card?")) return;
    try { await deleteDoc(doc(db, "report_cards", id)); await deleteDoc(doc(db, "report_cards_private", id)).catch(() => {}); delete CARDS[id]; delete PRIV[id]; renderCards(); } catch (e) { toast("Couldn't delete: " + (e.code || e.message), true); }
  };
}

// ══════════════════════════════════════════════════════════════════
// OFFBOARDING
// ══════════════════════════════════════════════════════════════════
let OB = [];               // offboarding records
let SURVEYS = {};          // email -> exit survey
let OB_OPEN = null;
async function loadOffboarding() {
  const [a, b] = await Promise.all([getDocs(collection(db, "offboarding")), getDocs(collection(db, "exit_surveys"))]);
  OB = a.docs.map(d => ({ id: d.id, ...d.data() })).sort((x, y) => String(y.lastDay).localeCompare(String(x.lastDay)));
  SURVEYS = {}; b.forEach(d => SURVEYS[d.id] = d.data());
}
function newRecord({ email, name, title, lastDay, reason, noticeDate, extraItems }) {
  const items = T.OFFBOARD_TEMPLATE.map(([party, offset, text]) => ({ id: uid(), party, offset, text, done: false }));
  (extraItems || []).forEach(x => items.push({ id: uid(), party: x.party, offset: x.offset ?? -1, text: x.text, done: false, custom: true }));
  return { email: email.toLowerCase(), name, title: title || "", lastDay, reason: reason || "Resignation", noticeDate: noticeDate || T.ymd(new Date()), items, actions: [], notes: "", status: "open", createdAt: serverTimestamp(), createdBy: ME };
}
async function saveOB(r, patch) { Object.assign(r, patch); await updateDoc(doc(db, "offboarding", r.id), { ...patch, updatedAt: serverTimestamp() }); }

function surveyHtml(sv) {
  const a = sv.answers || {};
  return T.EXIT_SURVEY.map((s, i) => {
    let v = a[s.key], out;
    if (v == null || v === "" || (Array.isArray(v) && !v.length)) out = `<span class="tr-muted">No answer</span>`;
    else if (s.type === "scale") out = `${v}/5 · ${esc(s.labels[v - 1])}`;
    else if (s.type === "nps") out = `${v}/10 ${v >= 9 ? "(promoter)" : v >= 7 ? "(passive)" : "(detractor)"}`;
    else if (s.type === "multi") out = v.map(esc).join(", ");
    else if (s.type === "grid") out = `<table class="tr-gridres">${s.rows.map(([k, l]) => `<tr><td>${esc(l)}</td><td><span class="tr-chip ${T.tone(v[k])}">${v[k] ? esc(s.labels[v[k] - 1]) : "–"}</span></td></tr>`).join("")}</table>`;
    else out = `<p>${esc(v)}</p>`;
    return `<div class="tr-ans"><h4>${i + 1}. ${esc(s.q)}</h4>${out}</div>`;
  }).join("");
}

function renderOffboarding() {
  const el = $("tr-offboard"); if (!el) return;
  const today = T.ymd(new Date());
  if (OB_OPEN) { renderOBDetail(el, OB.find(r => r.id === OB_OPEN)); return; }
  const cards = OB.map(r => {
    const done = r.items.filter(i => i.done).length, sv = SURVEYS[r.email];
    const days = Math.round((T.parseYmd(r.lastDay) - T.parseYmd(today)) / 864e5);
    return `<div class="tr-obcard" data-ob="${r.id}"><div class="tr-row" style="border:0;padding:0"><span class="tr-av">${esc(T.initials(r.name))}</span>
      <div class="tr-who"><b>${esc(r.name)}</b><div class="tr-muted">${esc(r.title)} · ${esc(r.reason)}</div></div>
      <span class="tr-chip ${r.status === "closed" ? "good" : days < 0 ? "bad" : "mid"}">${r.status === "closed" ? "Closed" : days > 0 ? `Last day in ${days} day${days === 1 ? "" : "s"}` : days === 0 ? "Last day today" : "Past last day"}</span></div>
      <div class="tr-prog"><i style="width:${Math.round(100 * done / r.items.length)}%"></i></div>
      <div class="tr-muted">Last day ${esc(T.niceDate(r.lastDay))} · ${done}/${r.items.length} steps · Exit survey: ${sv ? (sv.status === "submitted" ? "submitted ✓" : "sent, waiting") : "not sent"}</div></div>`;
  }).join("");
  const opts = graded().filter(u => !OB.some(r => r.email === u.email && r.status !== "closed"));
  el.innerHTML = `
    <div class="tr-head"><div><div class="tr-eyebrow">Team Reports</div><h2 class="tr-h">Offboarding</h2>
      <p class="tr-muted">Every step to get a departing team member out cleanly, by who owns it, with due dates counted from the last day. Send the exit survey from here; the answers and your takeaways sit with the checklist.</p></div></div>
    <div class="tr-list">${cards || `<div class="tr-empty">No one is being offboarded.</div>`}</div>
    <div class="tr-sec">Start offboarding</div>
    <div class="tr-box tr-form">
      <label>Team member<select id="ob-who">${opts.map(u => `<option value="${esc(u.email)}">${esc(u.name)}</option>`).join("")}</select></label>
      <label>Last day<input type="date" id="ob-last"></label>
      <label>Reason<select id="ob-reason">${T.REASONS.map(r => `<option>${esc(r)}</option>`).join("")}</select></label>
      <label>Notice given<input type="date" id="ob-notice" value="${today}"></label>
      <button class="tr-btn" id="ob-start">Create checklist</button></div>`;
  el.querySelectorAll("[data-ob]").forEach(c => c.onclick = () => { OB_OPEN = c.dataset.ob; renderOffboarding(); window.scrollTo(0, 0); });
  $("ob-start").onclick = async () => {
    const email = $("ob-who").value, lastDay = $("ob-last").value;
    if (!email || !lastDay) { toast("Pick a team member and their last day.", true); return; }
    const u = TEAM.find(x => x.email === email);
    try { const r = await api.startOffboarding({ email, name: u.name, title: u.title, lastDay, reason: $("ob-reason").value, noticeDate: $("ob-notice").value }); OB_OPEN = r; renderOffboarding(); }
    catch (e) { toast("Couldn't create: " + (e.code || e.message), true); }
  };
}

function renderOBDetail(el, r) {
  if (!r) { OB_OPEN = null; renderOffboarding(); return; }
  const today = T.ymd(new Date()), sv = SURVEYS[r.email];
  const done = r.items.filter(i => i.done).length;
  const groups = T.PARTIES.map(pt => {
    const its = r.items.filter(i => i.party === pt.key).sort((a, b) => (a.offset || 0) - (b.offset || 0));
    const n = its.filter(i => i.done).length;
    return `<div class="tr-box tr-party"><div class="tr-ph"><b>${esc(pt.label)}</b><span class="tr-muted">${n}/${its.length}</span></div>
      ${its.map(i => { const due = T.dueDate(r.lastDay, i.offset), late = !i.done && due < today; return `
        <div class="tr-item ${i.done ? "done" : ""}"><label><input type="checkbox" data-it="${i.id}" ${i.done ? "checked" : ""}><span>${esc(i.text)}</span></label>
          <span class="tr-due ${late ? "late" : ""}">${esc(T.niceDate(due))}${i.done && i.doneBy ? ` · ✓ ${esc(first(nameOf(i.doneBy)))}` : ""}</span>
          <input class="tr-note" data-note="${i.id}" placeholder="Note" value="${esc(i.note || "")}">${i.custom ? `<button class="tr-x" data-rm="${i.id}" title="Remove">×</button>` : ""}</div>`; }).join("")}
      <div class="tr-add"><input data-addtext="${pt.key}" placeholder="Add a step for ${esc(pt.label.split(" (")[0])}"><input type="number" data-addoff="${pt.key}" value="0" title="Days from last day (negative = before)"><button class="tr-btn ghost sm" data-add="${pt.key}">Add</button></div></div>`;
  }).join("");
  const svBox = !sv ? `<p class="tr-muted">Not sent yet. Sending opens the survey on ${esc(first(r.name))}'s My Weekly Report page (they need their Basecamp sign-in, so send it before the last day) and drafts an email with the link.</p>
      <button class="tr-btn" id="sv-send">Send exit survey to ${esc(first(r.name))}</button>`
    : sv.status !== "submitted" ? `<p>Sent ${esc(when(sv.sentAt))}. Waiting for ${esc(first(r.name))}${sv.answers && Object.keys(sv.answers).length ? " (started, not submitted)" : ""}.</p>
      <div class="tr-actions"><a class="tr-btn ghost sm" href="${outlook(r.email, "Quick exit survey before you go", `Hi ${first(r.name)},\n\nBefore your last day, would you fill in a short exit survey? It takes about 10 minutes, and honest answers help us get better for the guys who stay. Only Mike and I see it.\n\n${LINK}#exit\n\nThanks for everything,\n${first(SESSION.name)}`)}">Email the link again</a><button class="tr-btn danger sm" id="sv-cancel">Withdraw survey</button></div>`
    : `<p><span class="tr-chip good">Submitted ${esc(when(sv.submittedAt))}</span></p><details class="tr-ctx" open><summary>Answers</summary>${surveyHtml(sv)}</details>`;
  el.innerHTML = `
    <button class="tr-back" id="ob-back">‹ All offboarding</button>
    <div class="tr-head"><div><div class="tr-eyebrow">Offboarding · ${esc(r.reason)}</div><h2 class="tr-h">${esc(r.name)}</h2>
      <p class="tr-muted">${esc(r.title)} · notice ${esc(T.niceDate(r.noticeDate))} · last day <b>${esc(T.niceDate(r.lastDay, { weekday: "long", month: "long", day: "numeric", year: "numeric" }))}</b></p></div>
      <div class="tr-actions"><span class="tr-chip ${done === r.items.length ? "good" : "mid"}">${done}/${r.items.length} steps</span>
      <button class="tr-btn ghost sm" id="ob-close">${r.status === "closed" ? "Reopen" : "Close offboarding"}</button></div></div>
    <div class="tr-prog big"><i style="width:${Math.round(100 * done / r.items.length)}%"></i></div>
    <div class="tr-sec">Exit survey</div><div class="tr-box">${svBox}</div>
    <div class="tr-sec">Takeaways and actions <span class="tr-muted">· what we'll change because of this departure</span></div>
    <div class="tr-box">
      ${(r.actions || []).map(a => `<div class="tr-item ${a.done ? "done" : ""}"><label><input type="checkbox" data-act="${a.id}" ${a.done ? "checked" : ""}><span>${esc(a.text)}</span></label><span class="tr-due">${esc(a.owner || "")}</span><button class="tr-x" data-actrm="${a.id}">×</button></div>`).join("") || `<p class="tr-muted">Once the survey is in, add what you'll act on: owner and action.</p>`}
      <div class="tr-add"><input id="act-text" placeholder="Action, e.g. Weekly written job plan for each foreman"><select id="act-owner"><option>Jake</option><option>Mike</option><option>Jake + Mike</option><option>Clarissa</option><option>Cole</option></select><button class="tr-btn ghost sm" id="act-add">Add</button></div>
      <label class="tr-lbl">Notes</label><textarea id="ob-notes" placeholder="Exit conversation notes, rehire eligibility, reference notes">${esc(r.notes || "")}</textarea></div>
    <div class="tr-sec">Checklist by party</div>
    <div class="tr-parties">${groups}</div>
    <div class="tr-actions" style="margin-top:1rem"><span style="flex:1"></span><button class="tr-btn danger sm" id="ob-del">Delete this offboarding</button></div>`;

  const persist = async (patch, msg) => { try { await saveOB(r, patch); if (msg) toast(msg); } catch (e) { toast("Couldn't save: " + (e.code || e.message), true); } };
  $("ob-back").onclick = () => { OB_OPEN = null; renderOffboarding(); };
  $("ob-close").onclick = async () => { await persist({ status: r.status === "closed" ? "open" : "closed" }); renderOBDetail(el, r); };
  $("ob-del").onclick = async () => { if (!confirm(`Delete ${r.name}'s offboarding checklist?`)) return; try { await deleteDoc(doc(db, "offboarding", r.id)); OB = OB.filter(x => x !== r); OB_OPEN = null; renderOffboarding(); } catch (e) { toast("Couldn't delete: " + (e.code || e.message), true); } };
  el.querySelectorAll("[data-it]").forEach(c => c.onchange = async () => { const i = r.items.find(x => x.id === c.dataset.it); i.done = c.checked; i.doneAt = c.checked ? new Date().toISOString() : null; i.doneBy = c.checked ? ME : null; await persist({ items: r.items }); renderOBDetail(el, r); });
  el.querySelectorAll("[data-note]").forEach(n => n.onchange = async () => { r.items.find(x => x.id === n.dataset.note).note = n.value; await persist({ items: r.items }, "Note saved"); });
  el.querySelectorAll("[data-rm]").forEach(b => b.onclick = async () => { r.items = r.items.filter(x => x.id !== b.dataset.rm); await persist({ items: r.items }); renderOBDetail(el, r); });
  el.querySelectorAll("[data-add]").forEach(b => b.onclick = async () => {
    const k = b.dataset.add, t = el.querySelector(`[data-addtext="${k}"]`).value.trim(); if (!t) return;
    r.items.push({ id: uid(), party: k, offset: +el.querySelector(`[data-addoff="${k}"]`).value || 0, text: t, done: false, custom: true }); await persist({ items: r.items }); renderOBDetail(el, r);
  });
  $("act-add").onclick = async () => { const t = $("act-text").value.trim(); if (!t) return; r.actions = [...(r.actions || []), { id: uid(), text: t, owner: $("act-owner").value, done: false }]; await persist({ actions: r.actions }); renderOBDetail(el, r); };
  el.querySelectorAll("[data-act]").forEach(c => c.onchange = async () => { r.actions.find(a => a.id === c.dataset.act).done = c.checked; await persist({ actions: r.actions }); renderOBDetail(el, r); });
  el.querySelectorAll("[data-actrm]").forEach(b => b.onclick = async () => { r.actions = r.actions.filter(a => a.id !== b.dataset.actrm); await persist({ actions: r.actions }); renderOBDetail(el, r); });
  $("ob-notes").onchange = () => persist({ notes: $("ob-notes").value }, "Notes saved");
  const send = $("sv-send"); if (send) send.onclick = async () => {
    try {
      await setDoc(doc(db, "exit_surveys", r.email), { email: r.email, name: r.name, status: "sent", answers: {}, sentAt: serverTimestamp(), sentBy: ME });
      SURVEYS[r.email] = { email: r.email, name: r.name, status: "sent", answers: {}, sentAt: new Date() };
      const step = r.items.find(i => i.party === "jake" && /exit survey/i.test(i.text) && /^Send/.test(i.text));
      if (step && !step.done) { step.done = true; step.doneAt = new Date().toISOString(); step.doneBy = ME; await saveOB(r, { items: r.items }); }
      renderOBDetail(el, r);
      location.href = outlook(r.email, "Quick exit survey before you go", `Hi ${first(r.name)},\n\nBefore your last day, would you fill in a short exit survey? It takes about 10 minutes, and honest answers help us get better for the guys who stay. Only Mike and I see it.\n\n${LINK}#exit\n\nThanks for everything,\n${first(SESSION.name)}`);
    } catch (e) { toast("Couldn't send: " + (e.code || e.message), true); }
  };
  const cancel = $("sv-cancel"); if (cancel) cancel.onclick = async () => { if (!confirm("Withdraw the exit survey? Any answers so far are deleted.")) return; try { await deleteDoc(doc(db, "exit_surveys", r.email)); delete SURVEYS[r.email]; renderOBDetail(el, r); } catch (e) { toast("Couldn't withdraw: " + (e.code || e.message), true); } };
}

// ══════════════════════════════════════════════════════════════════
// API for scheduled tasks (run in Jake's signed-in Team Hub tab)
// ══════════════════════════════════════════════════════════════════
const api = {
  ready: false,
  team: () => TEAM.map(u => ({ email: u.email, name: u.name, title: u.title || "", roles: u.roles })),
  // Weekly reports for a month, for drafting report cards: [{email, name, week, morale, stress, workload, high, low, other}]
  async weeklyFor(month) {
    const from = T.weekKey(T.parseYmd(month + "-01")), to = T.addMonths(month, 1) + "-01";
    const s = await getDocs(query(collection(db, "team_reports"), where("week", ">=", from)));
    return s.docs.map(d => d.data()).filter(r => r.week < to).map(({ email, name, week, morale, stress, workload, high, low, other }) => ({ email, name, week, morale, stress, workload, high, low, other }));
  },
  // Save report card drafts. Never touches a card a person has edited or published.
  // cards: [{email, month, grade, ratings:{grit,relentless,contribution,purpose}, wins, improve, focus, note, evidence}]
  async saveDrafts(cards) {
    const out = { saved: [], skipped: [] };
    for (const c of cards || []) {
      const email = String(c.email || "").toLowerCase(), month = c.month || T.monthKey();
      if (!email || OWNERS.includes(email)) { out.skipped.push(email + " (owner/blank)"); continue; }
      const id = T.cardId(month, email), ref = doc(db, "report_cards", id), ex = await getDoc(ref);
      if (ex.exists() && !(ex.data().status === "draft" && ex.data().source === "claude")) { out.skipped.push(email + " (already edited or published)"); continue; }
      const card = { email, name: c.name || nameOf(email), month, grade: c.grade || "", ratings: c.ratings || {}, status: "draft", source: "claude", updatedAt: serverTimestamp(), createdAt: ex.exists() ? ex.data().createdAt : serverTimestamp() };
      T.CARD_TEXTS.forEach(t => card[t.key] = String(c[t.key] || "").trim());
      await setDoc(ref, card);
      await setDoc(doc(db, "report_cards_private", id), { email, month, evidence: String(c.evidence || ""), updatedAt: serverTimestamp() });
      out.saved.push(email);
    }
    if (OWNER && $("tr-cards")) { await loadCards(); renderCards(); }
    return out;
  },
  // Create an offboarding checklist (skips if one is already open for that person).
  async startOffboarding(o) {
    const id = T.slug(o.email);
    const ex = await getDoc(doc(db, "offboarding", id));
    if (ex.exists() && ex.data().status !== "closed") return id;
    const rec = newRecord(o);
    await setDoc(doc(db, "offboarding", id), rec);
    OB = [{ id, ...rec }, ...OB.filter(r => r.id !== id)];
    return id;
  },
  async reload() { await Promise.all([loadWeekly(), loadCards(), loadOffboarding()]); renderAll(); },
};
window.apTeamReports = api;

function renderAll() { renderWeekly(); renderCards(); renderOffboarding(); }
// team-hub-app.js calls this when one of the three tabs opens.
window.trRender = name => { if (!api.ready) return; if (name === "wr") renderWeekly(); else if (name === "rc") renderCards(); else if (name === "ob") renderOffboarding(); };

(async () => {
  if (!OWNER) return;
  const u = await currentUser(); if (!u) return;
  try {
    await loadTeam();
    await Promise.all([loadWeekly(), loadCards(), loadOffboarding()]);
    api.ready = true; renderAll();
  } catch (e) {
    console.error("Team Reports", e);
    ["tr-weekly", "tr-cards", "tr-offboard"].forEach(id => { const el = $(id); if (el) el.innerHTML = `<div class="tr-banner"><b>Team Reports can't reach the database.</b> Publish the latest firestore.rules in the Firebase console (team_reports, report_cards, exit_surveys, offboarding), then reload. (${esc(e.code || e.message)})</div>`; });
  }
})();
