// ── Alpine HVAC — My Weekly Report (my-reports.html) ─────────────────
// Every team member: send the weekly report, read monthly report cards from leadership,
// and fill in an exit survey when one has been sent. Definitions: team-reports-lib.js.
// Each person can only read and write their own records (firestore.rules).

import { collection, doc, getDoc, getDocs, setDoc, updateDoc, query, where, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";
import { db, currentUser } from "./ap-firebase.js";
import * as T from "./team-reports-lib.js?v=1";

const $ = id => document.getElementById(id);
const esc = T.esc;
const SESSION = (typeof apGetSession === "function" && apGetSession()) || {};
let ME = (SESSION.email || "").toLowerCase();
const NAME = SESSION.name || ME;
const FIRST = String(NAME).split(" ")[0];

function toast(t, bad) { const el = $("toast"); el.textContent = t; el.className = "toast" + (bad ? " bad" : ""); el.style.display = "block"; clearTimeout(toast._t); toast._t = setTimeout(() => el.style.display = "none", bad ? 7000 : 3000); }
const when = ts => { const d = ts && ts.toDate ? ts.toDate() : ts ? new Date(ts) : null; return d ? d.toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" }) : ""; };

let VIEW = (location.hash || "#weekly").slice(1);
let WEEK = T.defaultWeek();
let MINE = {};          // week -> report
let CARDS = [];         // published report cards, newest first
let EXIT = null;        // exit survey doc, if one was sent
let DRAFT = {};         // weekly form state
let SV = {};            // exit survey answers in progress

// ── Shell ──
function render() {
  const unread = CARDS.filter(c => !c.ackAt).length;
  const tabs = [["weekly", "Weekly report"], ["cards", "Report cards" + (unread ? `<span class="dot">${unread}</span>` : "")]];
  if (EXIT) tabs.push(["exit", "Exit survey" + (EXIT.status === "sent" ? '<span class="dot">1</span>' : "")]);
  if (!tabs.some(t => t[0] === VIEW)) VIEW = "weekly";
  $("app").innerHTML = `
    <h1>${VIEW === "exit" ? "Exit survey" : VIEW === "cards" ? "My report cards" : "My weekly report"}</h1>
    <div class="sub">${VIEW === "weekly" ? `Hi ${esc(FIRST)}. Let Jake and Mike know where you're winning and where you're stuck this week. It takes about 5 minutes and only leadership sees it.`
      : VIEW === "cards" ? "Your monthly feedback from Jake and Mike: where you did great, and where to grow next."
      : "Thank you for your time at Alpine. Your honest answers help us get better for the people who stay. Only Jake and Mike see them."}</div>
    <nav class="tabs">${tabs.map(([k, l]) => `<a href="#${k}" class="${k === VIEW ? "on" : ""}">${l}</a>`).join("")}</nav>
    <div id="view"></div>`;
  if (VIEW === "weekly") renderWeekly();
  else if (VIEW === "cards") renderCards();
  else renderExit();
}
window.addEventListener("hashchange", () => { VIEW = location.hash.slice(1) || "weekly"; render(); window.scrollTo(0, 0); });

// ── Weekly report ──
function loadDraft() {
  const r = MINE[WEEK];
  DRAFT = r ? { ...r } : {};
  try { const ls = JSON.parse(localStorage.getItem("ap_wr_draft_" + WEEK) || "null"); if (!r && ls) DRAFT = ls; } catch (e) {}
}
function saveLocal() { try { localStorage.setItem("ap_wr_draft_" + WEEK, JSON.stringify(DRAFT)); } catch (e) {} }

function renderWeekly() {
  const r = MINE[WEEK];
  const thisWeek = T.weekKey(new Date());
  const canNext = WEEK < thisWeek;
  const scales = T.SCALES.map(s => `
    <div class="panel"><div class="q">${esc(s.q)}</div>
      <div class="scale" data-k="${s.key}">${s.labels.map((l, i) => `<button type="button" data-v="${i + 1}" class="${+DRAFT[s.key] === i + 1 ? "on" : ""}"><span class="n">${i + 1}</span>${esc(l)}</button>`).join("")}</div>
    </div>`).join("");
  const texts = T.TEXTS.map(t => `
    <div class="panel"><div class="q">${esc(t.q)}</div><div class="hint">${esc(t.hint)}</div>
      <textarea data-k="${t.key}" maxlength="${T.MAXLEN}" placeholder="${t.req ? "" : "Optional"}">${esc(DRAFT[t.key] || "")}</textarea>
      <div class="count"><span data-c="${t.key}">${T.MAXLEN - String(DRAFT[t.key] || "").length}</span> characters left</div>
    </div>`).join("");
  const hist = Object.values(MINE).sort((a, b) => b.week.localeCompare(a.week)).slice(0, 8);
  $("view").innerHTML = `
    <div class="panel"><div class="weekbar">
      <button class="btn ghost sm" id="wk-prev">‹ Earlier</button>
      <div style="text-align:center"><small class="hint" style="display:block;margin:0">Week of</small><b>${esc(T.weekLabel(WEEK))}</b></div>
      <button class="btn ghost sm" id="wk-next" ${canNext ? "" : "disabled"}>Later ›</button>
    </div></div>
    ${r ? `<div class="done-box"><b>Sent ${esc(when(r.updatedAt || r.submittedAt))}.</b> Thanks, ${esc(FIRST)}. You can still change it below and send again.</div>` : ""}
    <form id="wr">${scales}${texts}
      <div class="row"><span class="hint" style="margin:0">All fields are required except "Anything else".</span><span class="spacer"></span>
      <button class="btn" type="submit" id="wr-send">${r ? "Update weekly report" : "Send weekly report"}</button></div>
    </form>
    ${hist.length ? `<div class="panel" style="margin-top:1.2rem"><h2 style="margin-bottom:.5rem">Your last reports</h2>
      <table class="hist"><tr><th>Week</th>${T.SCALES.map(s => `<th>${s.key}</th>`).join("")}<th></th></tr>
      ${hist.map(h => `<tr><td>${esc(T.weekLabel(h.week))}</td>${T.SCALES.map(s => `<td>${esc(s.labels[(+h[s.key] || 1) - 1])}</td>`).join("")}<td><button class="btn ghost sm" data-week="${h.week}">Open</button></td></tr>`).join("")}
      </table></div>` : ""}`;

  $("wk-prev").onclick = () => { WEEK = T.addWeeks(WEEK, -1); loadDraft(); renderWeekly(); };
  $("wk-next").onclick = () => { if (canNext) { WEEK = T.addWeeks(WEEK, 1); loadDraft(); renderWeekly(); } };
  $("view").querySelectorAll("[data-week]").forEach(b => b.onclick = () => { WEEK = b.dataset.week; loadDraft(); renderWeekly(); window.scrollTo(0, 0); });
  $("view").querySelectorAll(".scale button").forEach(b => b.onclick = () => {
    const k = b.parentElement.dataset.k; DRAFT[k] = +b.dataset.v; saveLocal();
    b.parentElement.querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
  });
  $("view").querySelectorAll("textarea[data-k]").forEach(t => t.oninput = () => {
    DRAFT[t.dataset.k] = t.value; saveLocal();
    $("view").querySelector(`[data-c="${t.dataset.k}"]`).textContent = T.MAXLEN - t.value.length;
  });
  $("wr").onsubmit = async e => {
    e.preventDefault();
    const miss = T.SCALES.filter(s => !(+DRAFT[s.key] >= 1)).map(s => s.key)
      .concat(T.TEXTS.filter(t => t.req && !String(DRAFT[t.key] || "").trim()).map(t => t.key));
    if (miss.length) { toast("Please answer: " + miss.join(", "), true); return; }
    const btn = $("wr-send"); btn.disabled = true; btn.textContent = "Sending…";
    const id = T.reportId(WEEK, ME);
    const rec = { email: ME, name: NAME, week: WEEK, updatedAt: serverTimestamp() };
    T.SCALES.forEach(s => rec[s.key] = +DRAFT[s.key]);
    T.TEXTS.forEach(t => rec[t.key] = String(DRAFT[t.key] || "").trim().slice(0, T.MAXLEN));
    if (!MINE[WEEK]) rec.submittedAt = serverTimestamp();
    try {
      await setDoc(doc(db, "team_reports", id), rec, { merge: true });
      MINE[WEEK] = { ...MINE[WEEK], ...rec, updatedAt: new Date(), submittedAt: MINE[WEEK]?.submittedAt || new Date() };
      try { localStorage.removeItem("ap_wr_draft_" + WEEK); } catch (e) {}
      toast("Weekly report sent. Thank you!"); renderWeekly(); window.scrollTo(0, 0);
    } catch (err) { console.error(err); toast("Couldn't send: " + (err.code || err.message), true); btn.disabled = false; btn.textContent = "Send weekly report"; }
  };
}

// ── Report cards ──
function renderCards() {
  if (!CARDS.length) { $("view").innerHTML = `<div class="panel empty">No report cards yet. Jake and Mike send one at the end of each month.</div>`; return; }
  $("view").innerHTML = CARDS.map(c => T.cardHtml(c, { foot: `<div class="rc-foot">${c.ackAt
      ? `<span class="pill ok">Read ${esc(when(c.ackAt))}</span>${c.ackReply ? `<p class="hint" style="margin-top:.5rem">Your reply: ${esc(c.ackReply)}</p>` : ""}`
      : `<div class="q">Anything you want to say back? <span class="hint">(optional)</span></div>
         <textarea data-reply="${c.id}" maxlength="${T.MAXLEN}" placeholder="Questions, context, or what you'll do next month"></textarea>
         <div class="row" style="margin-top:.6rem"><span class="spacer"></span><button class="btn" data-ack="${c.id}">Got it</button></div>`}</div>` })).join("");
  $("view").querySelectorAll("[data-ack]").forEach(b => b.onclick = async () => {
    const id = b.dataset.ack, reply = ($("view").querySelector(`[data-reply="${id}"]`)?.value || "").trim().slice(0, T.MAXLEN);
    b.disabled = true;
    try {
      await updateDoc(doc(db, "report_cards", id), { ackAt: serverTimestamp(), ackReply: reply });
      const c = CARDS.find(x => x.id === id); c.ackAt = new Date(); c.ackReply = reply; render(); toast("Thanks. Jake and Mike will see your reply.");
    } catch (err) { console.error(err); toast("Couldn't save: " + (err.code || err.message), true); b.disabled = false; }
  });
}

// ── Exit survey ──
function renderExit() {
  if (!EXIT) { $("view").innerHTML = `<div class="panel empty">No exit survey for you.</div>`; return; }
  const done = EXIT.status === "submitted";
  if (done) { $("view").innerHTML = `<div class="done-box"><b>Submitted ${esc(when(EXIT.submittedAt))}.</b> Thank you, ${esc(FIRST)}. We read every answer, and we wish you all the best.</div>`; return; }
  const q = T.EXIT_SURVEY.map((s, i) => {
    const v = SV[s.key];
    let input = "";
    if (s.type === "scale") input = `<div class="scale" data-k="${s.key}">${s.labels.map((l, j) => `<button type="button" data-v="${j + 1}" class="${+v === j + 1 ? "on" : ""}"><span class="n">${j + 1}</span>${esc(l)}</button>`).join("")}</div>`;
    else if (s.type === "multi" || s.type === "choice") input = `<div class="chips" data-k="${s.key}" data-multi="${s.type === "multi" ? 1 : ""}">${s.options.map(o => `<button type="button" data-v="${esc(o)}" class="${(s.type === "multi" ? (v || []).includes(o) : v === o) ? "on" : ""}">${esc(o)}</button>`).join("")}</div>`;
    else if (s.type === "nps") input = `<div class="nps" data-k="${s.key}">${Array.from({ length: 11 }, (_, n) => `<button type="button" data-v="${n}" class="${v === n ? "on" : ""}">${n}</button>`).join("")}</div><div class="nps-ends"><span>Not likely</span><span>Very likely</span></div>`;
    else if (s.type === "grid") input = `<table class="grid-q"><tr><th></th>${s.labels.map(l => `<th>${esc(l)}</th>`).join("")}</tr>${s.rows.map(([rk, rl]) => `<tr><td>${esc(rl)}</td>${s.labels.map((_, j) => `<td><input type="radio" name="g_${rk}" data-g="${rk}" value="${j + 1}" ${+(v || {})[rk] === j + 1 ? "checked" : ""}></td>`).join("")}</tr>`).join("")}</table>`;
    else input = `<textarea data-t="${s.key}" maxlength="2000">${esc(v || "")}</textarea>`;
    return `<div class="panel sv-q"><div class="q">${i + 1}. ${esc(s.q)}</div>${input}</div>`;
  }).join("");
  $("view").innerHTML = `<form id="sv">${q}
    <div class="row"><span class="hint" style="margin:0">Answer what you're comfortable with. Your progress saves as you go.</span><span class="spacer"></span>
    <button class="btn ghost" type="button" id="sv-save">Save for later</button><button class="btn" type="submit" id="sv-send">Submit survey</button></div></form>`;
  const v = $("view");
  const keep = () => { try { localStorage.setItem("ap_exit_draft", JSON.stringify(SV)); } catch (e) {} };
  v.querySelectorAll(".scale button, .nps button").forEach(b => b.onclick = () => {
    const k = b.parentElement.dataset.k; SV[k] = b.parentElement.classList.contains("nps") ? +b.dataset.v : +b.dataset.v; keep();
    b.parentElement.querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
  });
  v.querySelectorAll(".chips button").forEach(b => b.onclick = () => {
    const box = b.parentElement, k = box.dataset.k;
    if (box.dataset.multi) { const set = new Set(SV[k] || []); set.has(b.dataset.v) ? set.delete(b.dataset.v) : set.add(b.dataset.v); SV[k] = [...set]; b.classList.toggle("on"); }
    else { SV[k] = b.dataset.v; box.querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b)); }
    keep();
  });
  v.querySelectorAll("input[data-g]").forEach(r => r.onchange = () => { const g = T.EXIT_SURVEY.find(s => s.type === "grid").key; SV[g] = { ...(SV[g] || {}), [r.dataset.g]: +r.value }; keep(); });
  v.querySelectorAll("textarea[data-t]").forEach(t => t.oninput = () => { SV[t.dataset.t] = t.value; keep(); });
  const save = async final => {
    const upd = { answers: SV, updatedAt: serverTimestamp() };
    if (final) { upd.status = "submitted"; upd.submittedAt = serverTimestamp(); }
    await updateDoc(doc(db, "exit_surveys", ME), upd);
  };
  $("sv-save").onclick = async () => { try { await save(false); toast("Saved. You can finish any time before your last day."); } catch (err) { console.error(err); toast("Couldn't save: " + (err.code || err.message), true); } };
  $("sv").onsubmit = async e => {
    e.preventDefault();
    if (!SV.overall || !String(SV.improve || "").trim()) { toast("Please answer question 1 and the 'fix first' question before submitting.", true); return; }
    if (!confirm("Submit your exit survey? You won't be able to change it after.")) return;
    const b = $("sv-send"); b.disabled = true;
    try { await save(true); EXIT.status = "submitted"; EXIT.submittedAt = new Date(); try { localStorage.removeItem("ap_exit_draft"); } catch (e) {} render(); toast("Submitted. Thank you."); }
    catch (err) { console.error(err); toast("Couldn't submit: " + (err.code || err.message), true); b.disabled = false; }
  };
}

// ── Start ──
(async () => {
  const u = await currentUser();
  if (!u) { $("app").innerHTML = '<div class="empty">Sign in again to open your weekly report.</div>'; return; }
  ME = (u.email || ME).toLowerCase();
  try {
    const [rs, cs, ex] = await Promise.all([
      getDocs(query(collection(db, "team_reports"), where("email", "==", ME))),
      getDocs(query(collection(db, "report_cards"), where("email", "==", ME), where("status", "==", "published"))),
      getDoc(doc(db, "exit_surveys", ME)).catch(() => null),
    ]);
    rs.forEach(d => { const r = d.data(); MINE[r.week] = { id: d.id, ...r }; });
    CARDS = cs.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => b.month.localeCompare(a.month));
    if (ex && ex.exists()) { EXIT = ex.data(); SV = { ...(EXIT.answers || {}) }; try { const ls = JSON.parse(localStorage.getItem("ap_exit_draft") || "null"); if (ls) SV = { ...SV, ...ls }; } catch (e) {} }
  } catch (e) {
    console.error(e);
    $("app").innerHTML = `<div class="panel empty">The database isn't letting this account open weekly reports yet. Ask Jake to publish the latest Firestore rules, then reload.</div>`; return;
  }
  loadDraft(); render();
})();
