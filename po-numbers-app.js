// ── Alpine HVAC Internal Portal — PO Numbers (po-numbers.html) ────────
// Live list of every PO number, grouped like the Apple note, plus the Archive.
// Everyone views and searches; admins (Jake, Mike, Clarissa, Cole) issue, edit, archive.
import { doc, setDoc, updateDoc, deleteDoc, collection, onSnapshot, runTransaction, writeBatch, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";
import { db, currentUser } from "./ap-firebase.js";

const P = window.apPoParse;
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const session = apGetSession();
const ADMIN = !!(session && session.roles.includes("super_admin")); // = isAdmin() in firestore.rules
const ME = (session && session.name) || "";

// Job types. SA and "no letter" are older formats kept for existing POs; new POs use the first five.
const TYPES = [
  { k: "M", name: "Maintenance", desc: "Maintenance on a service agreement" },
  { k: "TM", name: "Time & material", desc: "Time & material only" },
  { k: "P", name: "Project", desc: "Projects" },
  { k: "EQ", name: "Equipment only", desc: "Equipment supply only" },
  { k: "SC", name: "Service call", desc: "Service calls" },
];
const OLD_TYPES = [{ k: "SA", name: "SA (old)" }, { k: "", name: "No letter" }];
const typeName = k => (TYPES.concat(OLD_TYPES).find(t => t.k === k) || { name: k }).name;

let PO = {};                 // key -> record
let META = { last: 0, sections: [] };
let TAB = "active", Q = "", TF = "all";
let loaded = { po: false, meta: false };

const codeOf = p => (p.type || "") + P.pad(p.num) + (p.sfx || "");
const metaRef = () => doc(db, "po_meta", "config");
const poRef = key => doc(db, "po_numbers", key);
const nowMs = () => Date.now();
const maxNum = () => Math.max(META.last || 0, ...Object.values(PO).map(p => p.num || 0), 0);
const secName = id => ((META.sections || []).find(s => s.id === id) || { name: id ? id : "Unsorted" }).name;
const MONTHS = P.MONTHS, MONTH_NAMES = P.MONTH_NAMES;
const monthLabel = s => s.monthly && s.month ? MONTH_NAMES[MONTHS.indexOf(s.month)] + " — " + s.name : s.name;

function toast(msg) {
  const t = document.createElement("div"); t.className = "toast"; t.textContent = msg; document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}
function banner(msg, info) { $("banner").innerHTML = msg ? `<div class="banner${info ? " info" : ""}">${msg}</div>` : ""; }
function copy(code) {
  const done = () => toast(code + " copied");
  if (navigator.clipboard) navigator.clipboard.writeText(code).then(done, done); else done();
}
const denied = e => /permission/i.test((e && (e.code || e.message)) || "");
const fail = e => { console.error(e); toast(denied(e) ? "Only Jake, Mike, Clarissa and Cole can change POs." : "Didn't save: " + (e.code || e.message)); };

/* ---------- filtering ---------- */
function matches(p) {
  if (TF !== "all" && (p.type || "") !== TF) return false;
  if (!Q) return true;
  const hay = [codeOf(p), P.pad(p.num), String(p.num), p.title, p.notes, secName(p.section)].join(" ").toLowerCase();
  return Q.split(/\s+/).every(w => hay.includes(w));
}
const active = () => Object.values(PO).filter(p => p.status !== "archived");
const archived = () => Object.values(PO).filter(p => p.status === "archived");
const byNumDesc = (a, b) => (b.num - a.num) || String(a.sfx).localeCompare(String(b.sfx));
const byArchived = (a, b) => ((b.archivedAt || 0) - (a.archivedAt || 0)) || ((a.imp ?? 1e9) - (b.imp ?? 1e9)) || byNumDesc(a, b);

/* ---------- render ---------- */
function rowHtml(p, opts = {}) {
  const c = codeOf(p);
  return `<div class="row">
    <span class="code t-${esc(p.type || "")}" data-copy="${esc(c)}" title="Copy ${esc(c)}">${esc(c)}</span>
    <div class="tx"><div class="tt">${esc(p.title) || '<span class="dim">(no title)</span>'}</div>${p.notes ? `<div class="nt">${esc(p.notes)}</div>` : ""}${opts.where ? `<div class="where">${esc(opts.where)}</div>` : ""}</div>
    <div class="rb"><button class="btn sm" data-copy="${esc(c)}">Copy</button>${ADMIN ? `<button class="btn sm" data-edit="${esc(p.key)}">Edit</button>` : ""}</div>
  </div>`;
}

function render() {
  if (!loaded.po || !loaded.meta) return;
  const next = P.pad(maxNum() + 1);
  const act = active(), arc = archived();
  const head = `<div class="crumb">Operations</div>
  <div class="head"><div><h1>PO Numbers</h1>
    <p class="sub">Tag every receipt with the full PO, letter included. The same PO is what we search in QuickBooks for job expenses.${ADMIN ? "" : " Ask Jake, Mike, Clarissa or Cole if your job needs a PO."}</p></div>
    ${ADMIN ? `<div class="actions"><button class="btn primary" id="b-new">+ New PO</button><button class="btn" id="b-sec">Add section</button></div>` : ""}
  </div>
  <div class="kpis">
    <div class="kpi"><div class="k-label">Next number</div><div class="k-value">${next}</div><div class="k-sub">Issued automatically, never repeated</div></div>
    <div class="kpi"><div class="k-label">Open POs</div><div class="k-value">${act.length}</div><div class="k-sub">${(META.sections || []).length} sections</div></div>
    <div class="kpi"><div class="k-label">Archived</div><div class="k-value">${arc.length}</div><div class="k-sub">Closed out and fully billed</div></div>
  </div>
  <div class="tools">
    <div class="search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
      <input id="q" type="search" placeholder="Search PO, job, building or customer…" value="${esc(Q)}" autocomplete="off"></div>
    <div class="tabs"><button data-tab="active" class="${TAB === "active" ? "on" : ""}">Open (${act.length})</button><button data-tab="archive" class="${TAB === "archive" ? "on" : ""}">Archive (${arc.length})</button></div>
  </div>
  <div class="chips">${[{ k: "all", name: "All types" }].concat(TYPES).map(t => `<button class="chip${TF === t.k ? " on" : ""}" data-tf="${t.k}">${t.k === "all" ? "All types" : esc(t.k + " · " + t.name)}</button>`).join("")}</div>`;

  let body = "";
  if (!Object.keys(PO).length) {
    body = `<div class="sec"><div class="empty">No POs loaded yet.${ADMIN ? ' Use <a class="lnk" data-import="1" style="color:var(--teal);cursor:pointer;text-decoration:underline">Import from Apple Notes</a> to bring in the current note and its archive.' : ""}</div></div>`;
  } else if (TAB === "active") {
    const secs = META.sections || [];
    const known = new Set(secs.map(s => s.id));
    const orphans = act.filter(p => !known.has(p.section));
    const all = secs.concat(orphans.length ? [{ id: "__none", name: "Unsorted" }] : []);
    const blocks = all.map((s, i) => {
      // Monthly sets keep the building order from the note (new months are issued in that same order).
      const list = (s.id === "__none" ? orphans : act.filter(p => p.section === s.id)).filter(matches)
        .sort(s.monthly ? (a, b) => (a.imp ?? 1e6 + a.num) - (b.imp ?? 1e6 + b.num) : byNumDesc);
      if ((Q || TF !== "all") && !list.length) return "";
      const nextMo = s.monthly ? MONTHS[(MONTHS.indexOf(s.month || "") + 1) % 12] : "";
      const ctl = ADMIN && s.id !== "__none" ? `
        ${s.monthly ? `<button class="btn sm primary" data-month="${esc(s.id)}">Start ${esc(MONTH_NAMES[MONTHS.indexOf(nextMo)])}</button>` : ""}
        <button class="btn sm" data-addin="${esc(s.id)}">+ PO</button>
        <button class="btn sm" data-secedit="${esc(s.id)}">Edit</button>
        <button class="btn sm" data-up="${i}" ${i === 0 ? "disabled" : ""} title="Move up">↑</button>
        <button class="btn sm" data-down="${i}" ${i >= secs.length - 1 ? "disabled" : ""} title="Move down">↓</button>` : "";
      return `<div class="sec"><div class="sec-h"><h2>${esc(monthLabel(s))}</h2><span class="n">${list.length}</span>${s.monthly ? '<span class="mo">Monthly</span>' : ""}<span class="sp"></span>${ctl}</div>
        ${list.length ? list.map(p => rowHtml(p)).join("") : '<div class="empty">No open POs.</div>'}</div>`;
    }).join("");
    const arcHits = (Q || TF !== "all") ? arc.filter(matches).length : 0;
    body = (blocks || '<div class="sec"><div class="empty">No open POs match.</div></div>') +
      (arcHits ? `<p class="more">${arcHits} match${arcHits === 1 ? "" : "es"} in the archive. <a data-tab="archive">Show archive</a></p>` : "");
  } else {
    const list = arc.filter(matches).sort(byArchived);
    body = `<div class="sec"><div class="sec-h"><h2>Archive</h2><span class="n">${list.length}</span><span class="sp"></span><span class="dim" style="font-size:.78rem">Closed out and fully billed, newest first</span></div>
      ${list.length ? list.map(p => rowHtml(p, { where: (p.archivedBy ? "Archived by " + p.archivedBy + (p.archivedAt ? " · " + new Date(p.archivedAt).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" }) : "") : "") })).join("") : '<div class="empty">Nothing in the archive matches.</div>'}</div>`;
  }

  const legend = `<div class="legend">${TYPES.map(t => `<span><b class="code t-${t.k}">${t.k}</b>${esc(t.desc)}</span>`).join("")}</div>`;
  const foot = ADMIN ? `<p class="foot">Admin: <a data-import="1">Import from Apple Notes</a></p>` : "";
  const hadFocus = document.activeElement && document.activeElement.id === "q";
  const pos = hadFocus ? document.activeElement.selectionStart : null;
  $("view").innerHTML = head + legend + body + foot;
  if (hadFocus) { const q = $("q"); q.focus(); try { q.setSelectionRange(pos, pos); } catch (e) {} }
}

/* ---------- events ---------- */
document.addEventListener("input", e => { if (e.target.id === "q") { Q = e.target.value.trim().toLowerCase(); render(); } });
document.addEventListener("click", e => {
  const t = e.target.closest("[data-copy],[data-edit],[data-tab],[data-tf],[data-addin],[data-secedit],[data-up],[data-down],[data-month],[data-import],#b-new,#b-sec");
  if (!t || t.closest("#modal")) return;
  if (t.dataset.copy) return copy(t.dataset.copy);
  if (t.dataset.tab) { TAB = t.dataset.tab; render(); window.scrollTo({ top: 0 }); return; }
  if (t.dataset.tf) { TF = t.dataset.tf; render(); return; }
  if (!ADMIN) return;
  if (t.id === "b-new") return newDialog();
  if (t.id === "b-sec") return sectionDialog(null);
  if (t.dataset.addin) return newDialog(t.dataset.addin);
  if (t.dataset.edit) return editDialog(t.dataset.edit);
  if (t.dataset.secedit) return sectionDialog(t.dataset.secedit);
  if (t.dataset.up) return moveSection(+t.dataset.up, -1);
  if (t.dataset.down) return moveSection(+t.dataset.down, 1);
  if (t.dataset.month) return monthDialog(t.dataset.month);
  if (t.dataset.import) return importDialog();
});

/* ---------- dialogs ---------- */
function open(html, wire) {
  $("modal").innerHTML = `<div class="scrim"><div class="dlg" role="dialog" aria-modal="true">${html}</div></div>`;
  const m = $("modal");
  m.querySelector(".scrim").addEventListener("click", e => { if (e.target.classList.contains("scrim")) close(); });
  m.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", close));
  wire && wire(m);
  const f = m.querySelector("input:not([type=hidden]),textarea"); if (f) f.focus();
}
function close() { $("modal").innerHTML = ""; }
document.addEventListener("keydown", e => { if (e.key === "Escape" && $("modal").innerHTML) close(); });
const secOptions = sel => (META.sections || []).map(s => `<option value="${esc(s.id)}"${s.id === sel ? " selected" : ""}>${esc(monthLabel(s))}</option>`).join("");
const typePick = (sel, withOld) => `<div class="typepick">${TYPES.concat(withOld ? OLD_TYPES : []).map(t => `<button type="button" class="t-${t.k}${t.k === sel ? " on" : ""}" data-type="${t.k}">${t.k || "—"}<small>${esc(t.name)}</small></button>`).join("")}</div>`;
function wireTypes(m) {
  m.querySelectorAll("[data-type]").forEach(b => b.addEventListener("click", () => {
    m.querySelectorAll("[data-type]").forEach(x => x.classList.remove("on")); b.classList.add("on");
  }));
}
const picked = m => { const b = m.querySelector("[data-type].on"); return b ? b.dataset.type : null; };

// Issue new numbers inside one transaction: reads the counter and checks each number is free before writing.
async function issue(items, extra) {
  return runTransaction(db, async tx => {
    const ms = await tx.get(metaRef());
    let n = Math.max((ms.exists() && ms.data().last) || 0, maxNum());
    const keys = [];
    for (let i = 0; i < items.length; i++) {
      // Skip a number if it exists, including as a split (00123-1) the counter somehow missed.
      for (;;) { n++; const k = P.pad(n); if (Object.values(PO).some(p => p.num === n)) continue; const s = await tx.get(poRef(k)); if (!s.exists()) { keys.push(k); break; } }
    }
    if (extra && extra.reads) await extra.reads(tx);
    items.forEach((it, i) => tx.set(poRef(keys[i]), {
      key: keys[i], num: parseInt(keys[i], 10), sfx: "", type: it.type, title: it.title, notes: it.notes || "", section: it.section,
      status: "active", createdAt: serverTimestamp(), createdBy: ME, updatedAt: serverTimestamp(), updatedBy: ME,
    }));
    tx.set(metaRef(), { last: n, ...((extra && extra.meta) || {}) }, { merge: true }); // one write to the counter doc
    if (extra && extra.writes) extra.writes(tx, keys);
    return keys;
  });
}

function newDialog(section) {
  const defSec = section || ((META.sections || []).find(s => s.id === "miscellaneous") || (META.sections || [])[0] || {}).id;
  open(`<h3>New PO</h3><p class="s">Gets the next free number (${P.pad(maxNum() + 1)} right now). Nobody else can be given the same one.</p>
    <div class="f"><label>Job type</label>${typePick(null)}</div>
    <div class="f"><label>Job title or job number</label><input id="n-title" placeholder="e.g. 80 King 6th Floor FCU Install, JO20261180"></div>
    <div class="f"><label>Section</label><select id="n-sec">${secOptions(defSec)}</select></div>
    <div class="f"><label>Notes (optional)</label><input id="n-notes" placeholder="e.g. billed to Besseling, scheduled for Dec"></div>
    <div class="btns"><button class="btn" data-close>Cancel</button><button class="btn primary" id="n-go">Issue PO</button></div>`, m => {
    wireTypes(m);
    m.querySelector("#n-go").addEventListener("click", async () => {
      const type = picked(m), title = m.querySelector("#n-title").value.trim();
      if (type == null) return toast("Pick the job type first.");
      if (!title) return toast("Add the job title or job number.");
      const btn = m.querySelector("#n-go"); btn.disabled = true; btn.textContent = "Issuing…";
      try {
        const [k] = await issue([{ type, title, notes: m.querySelector("#n-notes").value.trim(), section: m.querySelector("#n-sec").value }]);
        doneDialog(type + k, title);
      } catch (e) { fail(e); btn.disabled = false; btn.textContent = "Issue PO"; }
    });
    m.querySelector("#n-title").addEventListener("keydown", e => { if (e.key === "Enter") m.querySelector("#n-go").click(); });
  });
}
function doneDialog(code, title, note) {
  open(`<div class="done"><p class="dim">${esc(note || "PO issued for")}</p><p style="font-weight:500">${esc(title)}</p>
    <div class="big">${esc(code)}</div><p class="dim" style="font-size:.82rem">Give this to the tech for their receipts.</p></div>
    <div class="btns"><button class="btn" data-close>Done</button><button class="btn" id="d-another">Issue another</button><button class="btn primary" id="d-copy">Copy ${esc(code)}</button></div>`, m => {
    m.querySelector("#d-copy").addEventListener("click", () => copy(code));
    m.querySelector("#d-another").addEventListener("click", () => newDialog());
  });
}

function editDialog(key) {
  const p = PO[key]; if (!p) return;
  const arc = p.status === "archived";
  open(`<h3>${esc(codeOf(p))}</h3><p class="s">${arc ? "Archived" : "Open"} · issued ${p.createdBy ? "by " + esc(p.createdBy) : "before the portal"}${p.updatedBy ? " · last changed by " + esc(p.updatedBy) : ""}</p>
    <div class="f"><label>Job type</label>${typePick(p.type || "", true)}</div>
    <div class="f"><label>Job title or job number</label><input id="e-title" value="${esc(p.title)}"></div>
    <div class="f"><label>Notes</label><textarea id="e-notes">${esc(p.notes)}</textarea></div>
    <div class="f"><label>${arc ? "Section if restored" : "Section"}</label><select id="e-sec">${secOptions(p.section || "miscellaneous")}</select></div>
    <div class="btns"><span class="l">${arc
      ? `<button class="btn" id="e-restore">Restore to open</button>`
      : `<button class="btn" id="e-arch" title="Job closed out and fully billed">Archive</button><button class="btn" id="e-repl" title="For standing POs: archive this one and issue a new number for the same work">Archive + new number</button><button class="btn" id="e-split" title="Same PO and expenses, billed on more than one invoice: 00123-1, 00123-2">Split invoice</button>`}
      <button class="btn danger" id="e-del">Delete</button></span>
      <button class="btn" data-close>Cancel</button><button class="btn primary" id="e-save">Save</button></div>`, m => {
    wireTypes(m);
    const vals = () => ({ type: picked(m) ?? (p.type || ""), title: m.querySelector("#e-title").value.trim(), notes: m.querySelector("#e-notes").value.trim(), section: m.querySelector("#e-sec").value });
    const save = async patch => { try { await updateDoc(poRef(key), { ...patch, updatedAt: serverTimestamp(), updatedBy: ME }); close(); return true; } catch (e) { fail(e); return false; } };
    m.querySelector("#e-save").addEventListener("click", () => save(vals()).then(ok => ok && toast("Saved")));
    const del = m.querySelector("#e-del");
    del.addEventListener("click", async () => {
      if (!del.dataset.sure) { del.dataset.sure = 1; del.textContent = "Tap again to delete"; return; }
      try { await deleteDoc(poRef(key)); close(); toast(codeOf(p) + " deleted. The number won't be reused."); } catch (e) { fail(e); }
    });
    if (arc) m.querySelector("#e-restore").addEventListener("click", () => save({ ...vals(), status: "active", archivedAt: null, archivedBy: "" }).then(ok => ok && toast(codeOf(p) + " restored")));
    else {
      m.querySelector("#e-arch").addEventListener("click", () => save({ ...vals(), status: "archived", archivedAt: nowMs(), archivedBy: ME }).then(ok => ok && toast(codeOf(p) + " moved to the archive")));
      // Split billing: same number and expenses, separate invoices. 00123 becomes 00123-1, and 00123-2 is added.
      m.querySelector("#e-split").addEventListener("click", async () => {
        const v = vals(), base = P.pad(p.num);
        const sibs = Object.values(PO).filter(x => x.num === p.num && x.sfx);
        const nextS = "-" + (Math.max(0, ...sibs.map(x => parseInt(String(x.sfx).slice(1), 10) || 0)) + 1 + (p.sfx ? 0 : 1));
        try {
          await runTransaction(db, async tx => {
            const nk = base + nextS, ex = await tx.get(poRef(nk));
            if (ex.exists()) throw new Error(nk + " already exists");
            const rec = { ...p, ...v, sfx: nextS, key: nk, status: "active", createdAt: serverTimestamp(), createdBy: ME, updatedAt: serverTimestamp(), updatedBy: ME };
            delete rec.archivedAt; delete rec.archivedBy;
            if (!p.sfx) {           // first split: the original becomes -1
              tx.set(poRef(base + "-1"), { ...p, ...v, sfx: "-1", key: base + "-1", updatedAt: serverTimestamp(), updatedBy: ME });
              tx.delete(poRef(key));
            } else tx.update(poRef(key), { ...v, updatedAt: serverTimestamp(), updatedBy: ME });
            tx.set(poRef(nk), rec);
          });
          doneDialog((v.type || "") + base + nextS, v.title, "Split added. Bill this invoice as");
        } catch (e) { fail(e); }
      });
      m.querySelector("#e-repl").addEventListener("click", async () => {
        const v = vals();
        try {
          const [k] = await issue([{ type: v.type, title: v.title, notes: v.notes, section: v.section }], {
            writes: tx => tx.update(poRef(key), { ...v, status: "archived", archivedAt: nowMs(), archivedBy: ME, updatedAt: serverTimestamp(), updatedBy: ME }),
          });
          doneDialog(v.type + k, v.title, codeOf(p) + " archived. New number for");
        } catch (e) { fail(e); }
      });
    }
  });
}

/* ---------- sections ---------- */
async function saveSections(sections) {
  try { await setDoc(metaRef(), { sections }, { merge: true }); } catch (e) { fail(e); }
}
function moveSection(i, d) {
  const s = (META.sections || []).slice(), j = i + d;
  if (j < 0 || j >= s.length) return;
  [s[i], s[j]] = [s[j], s[i]]; saveSections(s);
}
function sectionDialog(id) {
  const s = id ? (META.sections || []).find(x => x.id === id) : null;
  const count = id ? active().filter(p => p.section === id).length : 0;
  open(`<h3>${s ? "Edit section" : "New section"}</h3><p class="s">Sections group open POs, usually by building or customer.</p>
    <div class="f"><label>Name</label><input id="s-name" value="${esc(s ? s.name : "")}" placeholder="e.g. 60 James"></div>
    <div class="btns"><span class="l">${s ? `<button class="btn danger" id="s-del" ${count ? `disabled title="Move or archive its ${count} open POs first"` : ""}>Delete section</button>` : ""}</span>
      <button class="btn" data-close>Cancel</button><button class="btn primary" id="s-go">Save</button></div>`, m => {
    m.querySelector("#s-go").addEventListener("click", async () => {
      const name = m.querySelector("#s-name").value.trim(); if (!name) return toast("Give the section a name.");
      const list = (META.sections || []).slice();
      if (s) list[list.findIndex(x => x.id === id)] = { ...s, name };
      else {
        let nid = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "section";
        while (list.some(x => x.id === nid)) nid += "-2";
        list.push({ id: nid, name, monthly: false, month: "" });
      }
      await saveSections(list); close();
    });
    const d = m.querySelector("#s-del");
    if (d) d.addEventListener("click", async () => { await saveSections((META.sections || []).filter(x => x.id !== id)); close(); });
  });
}

/* ---------- monthly batch (Markland parts) ---------- */
const swapMonth = (title, mo) => /\b(JAN|FEB|MAR|APR|MAY|JUNE?|JULY?|AUG|SEPT?|OCT|NOV|DEC)\b/i.test(title)
  ? title.replace(/\b(JAN|FEB|MAR|APR|MAY|JUNE?|JULY?|AUG|SEPT?|OCT|NOV|DEC)\b/i, mo) : title + " " + mo;
function monthDialog(id) {
  const s = (META.sections || []).find(x => x.id === id); if (!s) return;
  const cur = active().filter(p => p.section === id).sort((a, b) => (a.imp ?? 1e9) - (b.imp ?? 1e9) || a.num - b.num);
  const nextIdx = (MONTHS.indexOf(s.month || "") + 1) % 12;
  open(`<h3>Start a new month</h3><p class="s">Archives this month's ${cur.length} POs and issues ${cur.length} new numbers, one per building, in one step.</p>
    <div class="f"><label>New month</label><select id="m-mo">${MONTHS.map((m, i) => `<option value="${m}"${i === nextIdx ? " selected" : ""}>${MONTH_NAMES[i]}</option>`).join("")}</select></div>
    <div class="list" id="m-list"></div>
    <div class="btns"><button class="btn" data-close>Cancel</button><button class="btn primary" id="m-go" ${cur.length ? "" : "disabled"}>Archive + issue ${cur.length}</button></div>`, m => {
    const draw = () => { const mo = m.querySelector("#m-mo").value; m.querySelector("#m-list").innerHTML = cur.map(p => `<div><span class="dim">${esc(codeOf(p))} →</span> ${esc(swapMonth(p.title, mo))}</div>`).join(""); };
    m.querySelector("#m-mo").addEventListener("change", draw); draw();
    m.querySelector("#m-go").addEventListener("click", async () => {
      const mo = m.querySelector("#m-mo").value, btn = m.querySelector("#m-go"); btn.disabled = true; btn.textContent = "Issuing…";
      try {
        const keys = await issue(cur.map(p => ({ type: p.type || "", title: swapMonth(p.title, mo), notes: "", section: id })), {
          writes: tx => {
            cur.forEach(p => tx.update(poRef(p.key), { status: "archived", archivedAt: nowMs(), archivedBy: ME, updatedAt: serverTimestamp(), updatedBy: ME }));
          },
          meta: { sections: (META.sections || []).map(x => x.id === id ? { ...x, month: mo } : x) },
        });
        close(); toast(`${MONTH_NAMES[MONTHS.indexOf(mo)]} POs issued: ${P.pad(parseInt(keys[0], 10))}–${keys[keys.length - 1]}`);
      } catch (e) { fail(e); btn.disabled = false; btn.textContent = "Archive + issue " + cur.length; }
    });
  });
}

/* ---------- import from the Apple notes ---------- */
// Adds POs that aren't in the portal yet (existing numbers are never overwritten) and any new sections.
async function importText(text, mode) {
  if (!ADMIN) throw new Error("admins only");
  const r = P.parse(text, mode);
  const fresh = r.pos.filter(p => !PO[p.key]);
  const secs = (META.sections || []).slice();
  r.sections.forEach(s => { if (!secs.some(x => x.id === s.id)) secs.push(s); });
  for (let i = 0; i < fresh.length; i += 400) {
    const b = writeBatch(db);
    fresh.slice(i, i + 400).forEach(p => b.set(poRef(p.key), { ...p, archivedAt: null, archivedBy: "", createdBy: "", createdAt: serverTimestamp(), updatedAt: serverTimestamp(), updatedBy: ME + " (import)" }));
    await b.commit();
  }
  const last = Math.max(META.last || 0, ...r.pos.map(p => p.num), 0);
  await setDoc(metaRef(), { sections: secs, last }, { merge: true });
  return { added: fresh.length, skipped: r.pos.length - fresh.length, spares: r.skipped, sections: secs.length };
}
window.apPoImportText = importText; // used once from the browser console to load the notes
function importDialog() {
  open(`<h3>Import from Apple Notes</h3><p class="s">Paste the whole note. POs already in the portal are left alone; spare numbers under "Next available" are skipped.</p>
    <div class="f"><label>Which note?</label><select id="i-mode"><option value="main">PO NUMBERS (open POs, with sections)</option><option value="archive">PO NUMBERS - Archive</option></select></div>
    <div class="f"><label>Note text</label><textarea id="i-text" style="min-height:180px"></textarea></div>
    <p class="dim" id="i-prev" style="font-size:.82rem"></p>
    <div class="btns"><button class="btn" data-close>Cancel</button><button class="btn primary" id="i-go">Import</button></div>`, m => {
    const prev = () => { const r = P.parse(m.querySelector("#i-text").value, m.querySelector("#i-mode").value); const nw = r.pos.filter(p => !PO[p.key]).length;
      m.querySelector("#i-prev").textContent = r.pos.length ? `${r.pos.length} POs found, ${nw} new${r.sections.length ? ", " + r.sections.length + " sections" : ""}.` : ""; };
    m.querySelector("#i-text").addEventListener("input", prev); m.querySelector("#i-mode").addEventListener("change", prev);
    m.querySelector("#i-go").addEventListener("click", async () => {
      const btn = m.querySelector("#i-go"); btn.disabled = true;
      try { const r = await importText(m.querySelector("#i-text").value, m.querySelector("#i-mode").value); close(); toast(`Imported ${r.added} POs`); }
      catch (e) { fail(e); btn.disabled = false; }
    });
  });
}

/* ---------- start ---------- */
const user = await currentUser();
if (!user) { sessionStorage.clear(); window.location.href = "index.html"; }
else {
  const blocked = e => { $("view").innerHTML = ""; banner(denied(e) ? "PO Numbers is blocked: publish the updated Firestore rules (firestore.rules in the repo)." : "PO numbers couldn't load: " + esc(e.code || e.message)); };
  onSnapshot(collection(db, "po_numbers"), snap => {
    const m = {}; snap.forEach(d => { m[d.id] = { key: d.id, ...d.data() }; }); PO = m; loaded.po = true; render();
  }, blocked);
  onSnapshot(metaRef(), s => { META = s.exists() ? { last: 0, sections: [], ...s.data() } : { last: 0, sections: [] }; loaded.meta = true; render(); }, blocked);
}
