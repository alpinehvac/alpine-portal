// ── Alpine HVAC — Checklists (forms.html) ────────────────────────────
// Mike's site forms (BuildOps Settings > Forms), copied one for one into Basecamp, and every checklist
// techs have filled in on a visit, with its customer link.
//
// Forms tab: search, preview any form. "Import from BuildOps" reads buildops-forms.json (made from the
// BuildOps form pages) and saves each form as forms/bo_<BuildOps id>. Importing again updates the same
// forms, so nothing doubles up. forms/_index is the short list (name + site) the tech app picks from.
// Filled tab: checklists on visits (form_entries), newest first, with the answers and the customer link.
// Data and the form format: forms-lib.js.

import { collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, onSnapshot, query, orderBy, limit, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";
import { db, currentUser } from "./ap-firebase.js";
import * as CF from "./forms-lib.js?v=2";

const $ = id => document.getElementById(id);
const esc = CF.esc;
const SESSION = (typeof apGetSession === "function" && apGetSession()) || {};
const ME = SESSION.email || "";
let TAB = "forms", Q = "", INDEX = [], ENTRIES = [], LOADED = false;

function toast(t, bad) { const el = $("toast"); el.textContent = t; el.className = "toast" + (bad ? " bad" : ""); el.style.display = "block"; clearTimeout(toast._t); toast._t = setTimeout(() => el.style.display = "none", bad ? 7000 : 3000); }
const when = iso => iso ? new Date(iso).toLocaleString("en-CA", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "";
const day = ms => ms ? new Date(ms).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" }) : "";
const nat = (a, b) => (a || "").localeCompare(b || "", undefined, { numeric: true });

function render() {
  const words = Q.toLowerCase().split(/\s+/).filter(Boolean);
  const hit = s => words.every(w => s.toLowerCase().includes(w));
  let body = "";
  if (TAB === "forms") {
    const list = INDEX.filter(f => hit(f.name + " " + f.site)).sort((a, b) => nat(a.site, b.site) || nat(a.name, b.name));
    body = !INDEX.length
      ? `<div class="panel empty">No forms yet. Click <b>Import from BuildOps</b> and pick buildops-forms.json from your Downloads folder.</div>`
      : `<table class="list"><thead><tr><th>Form</th><th>Site (BuildOps description)</th><th class="num">Items</th><th>From BuildOps</th></tr></thead><tbody>${list.map(f => `<tr class="row" data-f="${esc(f.id)}"><td><b>${esc(f.name)}</b></td><td>${esc(f.site || "Any site")}</td><td class="num">${f.items || ""}</td><td>${esc(day(f.boUpdated))}<small>${esc(f.createdBy || "")}</small></td></tr>`).join("")}</tbody></table>${list.length ? "" : `<div class="empty">No form matches.</div>`}`;
  } else {
    const list = ENTRIES.filter(e => hit([e.formName, e.formSite, e.customer, e.site, e.jobNo, e.techName].join(" ")));
    body = !ENTRIES.length ? `<div class="panel empty">No checklists filled in yet. Techs add them on a visit in the tech app.</div>`
      : `<table class="list"><thead><tr><th>Checklist</th><th>Customer / job</th><th>Tech</th><th>Status</th><th>Customer link</th></tr></thead><tbody>${list.map(e => `<tr class="row" data-e="${esc(e.id)}"><td><b>${esc(e.formName)}</b><small>${esc(e.formSite || "")}</small></td><td>${esc(e.customer || "")}<small>${esc([e.jobNo, e.visitDate].filter(Boolean).join(" · "))}</small></td><td>${esc(e.techName || e.tech)}<small>started ${esc(when(e.startedAt))}</small></td><td><span class="tag ${e.status === "done" ? "done" : "open"}">${e.status === "done" ? "Done" : "In progress"}</span><small>${e.total ? `${e.filled || 0} of ${e.total}` : ""}</small></td><td>${e.shareToken ? "Sent" : "<small>—</small>"}</td></tr>`).join("")}</tbody></table>${list.length ? "" : `<div class="empty">Nothing matches.</div>`}`;
  }
  $("app").innerHTML = `<div class="top"><div><h1>Checklists</h1><p class="sub">Mike's site forms from BuildOps, copied as they are. Techs add them to a visit in the tech app, fill them in on site, and send the customer a private link to a copy they can save as a PDF.</p></div>
      <div><button class="btn" id="imp">Import from BuildOps</button></div></div>
    <div class="tabs"><button data-tab="forms" class="${TAB === "forms" ? "on" : ""}">Forms <small>${INDEX.length}</small></button><button data-tab="filled" class="${TAB === "filled" ? "on" : ""}">Filled in <small>${ENTRIES.length}</small></button></div>
    <div class="bar"><input id="q" placeholder="${TAB === "forms" ? "Search forms: unit, building, type (AHU 2, boiler, 21 King)" : "Search: form, customer, job, tech"}" value="${esc(Q)}"></div>
    <div class="panel" style="padding:.4rem .6rem">${LOADED ? body : '<div class="empty">Loading…</div>'}</div>`;
  document.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { TAB = b.dataset.tab; render(); });
  const q = $("q"); q.oninput = () => { Q = q.value; const pos = q.selectionStart; render(); const n = $("q"); n.focus(); n.setSelectionRange(pos, pos); };
  $("imp").onclick = () => { const f = $("imp-file"); f.value = ""; f.click(); };
  document.querySelectorAll("[data-f]").forEach(r => r.onclick = () => previewForm(r.dataset.f));
  document.querySelectorAll("[data-e]").forEach(r => r.onclick = () => openEntry(r.dataset.e));
}

// ── Modal ──
const mod = $("mod");
const openMod = (title, html, acts) => { $("mod-h").textContent = title; $("mod-b").innerHTML = html; $("mod-acts").innerHTML = acts || ""; mod.classList.add("on"); $("mod-b").scrollTop = 0; };
$("mod-close").onclick = () => mod.classList.remove("on");
mod.onclick = e => { if (e.target === mod) mod.classList.remove("on"); };
document.addEventListener("keydown", e => { if (e.key === "Escape") mod.classList.remove("on"); });

const FORMS = {};
async function getForm(id) { if (!FORMS[id]) { const s = await getDoc(doc(db, "forms", id)); if (s.exists()) FORMS[id] = { id, ...s.data() }; } return FORMS[id] || null; }

async function previewForm(id) {
  openMod("Loading…", '<div class="empty">Loading form…</div>');
  const f = await getForm(id).catch(() => null);
  if (!f) { openMod("Form not found", '<div class="empty">This form was removed.</div>'); return; }
  const pr = CF.progress(f, {});
  openMod(f.name, `<div class="meta"><div><span>Site</span>${esc(f.site || "Any site")}</div><div><span>Items to fill in</span>${pr.total}</div><div><span>Made in BuildOps by</span>${esc(f.createdBy || "")}</div><div><span>BuildOps last updated</span>${esc(day(f.boUpdated))}</div></div>${CF.reportHtml(f, {}, { preview: true })}`);
}

const shareUrl = t => new URL(CF.SHARE_PAGE + "?k=" + t, location.href).href;
function snapOf(e, f) {
  return { by: e.tech, entryId: e.id, formName: f.name, formSite: f.site || "", rows: f.rows || [], images: f.images || {}, answers: e.answers || {},
    customer: e.customer || "", site: e.site || "", address: e.address || "", jobNo: e.jobNo || "", visitDate: e.visitDate || "", techName: e.techName || "",
    status: e.status || "draft", doneAt: e.doneAt || null, startedAt: e.startedAt || null, updatedAt: serverTimestamp() };
}
async function openEntry(id) {
  const e = ENTRIES.find(x => x.id === id); if (!e) return;
  openMod(e.formName, '<div class="empty">Loading…</div>');
  const f = await getForm(e.formId).catch(() => null);
  if (!f) { openMod(e.formName, '<div class="empty">The form this checklist used has been removed, so it can\'t be shown.</div>'); return; }
  const draw = () => {
    const link = e.shareToken ? `<div class="linkbox"><b>Customer link</b><input readonly value="${esc(shareUrl(e.shareToken))}" id="lk"><button class="btn sm" id="lk-copy">Copy</button><a class="btn ghost sm" target="_blank" rel="noopener" href="${esc(shareUrl(e.shareToken))}">Open / PDF</a><button class="btn danger sm" id="lk-off">Turn off link</button></div>`
      : `<div class="linkbox"><span style="flex:1">No customer link yet.</span><button class="btn sm" id="lk-make">Make customer link</button></div>`;
    openMod(e.formName, `<div class="meta"><div><span>Customer</span>${esc(e.customer || "")}</div><div><span>Site</span>${esc([e.site, e.formSite].filter(Boolean).join(" · "))}</div><div><span>Job</span>${esc(e.jobNo || "")}</div><div><span>Tech</span>${esc(e.techName || e.tech)}</div><div><span>Status</span>${e.status === "done" ? "Done " + esc(when(e.doneAt)) : "In progress"}</div><div><span>Filled in</span>${e.filled || 0} of ${e.total || 0}</div></div>${link}${CF.reportHtml(f, e.answers || {})}`,
      e.visitId ? `<a class="btn ghost sm" href="tech.html#v=${encodeURIComponent(e.visitId)}">Open visit</a>` : "");
    if ($("lk-copy")) $("lk-copy").onclick = async () => { try { await navigator.clipboard.writeText($("lk").value); toast("Link copied"); } catch (x) { $("lk").select(); } };
    if ($("lk-make")) $("lk-make").onclick = async () => {
      const token = CF.newToken();
      try { await setDoc(doc(db, "form_shares", token), snapOf(e, f)); await updateDoc(doc(db, "form_entries", e.id), { shareToken: token, sharedAt: new Date().toISOString(), updatedAt: serverTimestamp() }); e.shareToken = token; draw(); toast("Customer link ready"); }
      catch (x) { console.error(x); toast("Couldn't make the link: " + (x.code || x.message), true); }
    };
    if ($("lk-off")) $("lk-off").onclick = async () => {
      if (!confirm("Turn off this link? Anyone who has it will see a 'link turned off' page.")) return;
      try { await deleteDoc(doc(db, "form_shares", e.shareToken)); await updateDoc(doc(db, "form_entries", e.id), { shareToken: null, sharedAt: null, updatedAt: serverTimestamp() }); e.shareToken = null; draw(); toast("Link turned off"); }
      catch (x) { console.error(x); toast("Couldn't turn it off: " + (x.code || x.message), true); }
    };
  };
  draw();
}

// ── Import from BuildOps (buildops-forms.json) ──
$("imp-file").onchange = async () => {
  const file = $("imp-file").files[0]; if (!file) return;
  let data;
  try { data = JSON.parse(await file.text()); } catch (e) { toast("That file isn't a forms export (not JSON).", true); return; }
  const recs = Array.isArray(data) ? data : (data.forms || []);
  if (!recs.length || !recs[0].def) { toast("That file has no BuildOps forms in it.", true); return; }
  const conv = recs.map(r => ({ id: "bo_" + r.id, ...CF.convertBuildOps(r) }));
  const have = new Set(INDEX.map(f => f.id));
  const isNew = conv.filter(f => !have.has(f.id)).length;
  const big = conv.filter(f => JSON.stringify(f).length > 900000);
  openMod("Import from BuildOps", `<p>${conv.length} forms in <b>${esc(file.name)}</b>${data.exportedAt ? ` (exported ${esc(when(data.exportedAt))})` : ""}: ${isNew} new, ${conv.length - isNew} already here (they'll be updated to match BuildOps).</p>
    ${big.length ? `<p style="color:var(--red)">${big.length} form${big.length > 1 ? "s are" : " is"} too large to save and will be skipped: ${esc(big.map(f => f.name).join(", "))}</p>` : ""}
    <p class="sub">Each form is copied as it is: same name, site, wording and order. Techs see them in the tech app as soon as this finishes.</p>
    <div style="margin-top:.8rem;display:flex;gap:.5rem"><button class="btn" id="imp-go">Import ${conv.length - big.length} forms</button></div><div class="imp-log" id="imp-log"></div>
    <table class="list" style="margin-top:.8rem"><tbody>${conv.slice(0, 400).map(f => `<tr><td>${esc(f.name)}</td><td>${esc(f.site)}</td><td class="num">${CF.answerItems(f).length} items</td><td>${have.has(f.id) ? "<small>update</small>" : "new"}</td></tr>`).join("")}</tbody></table>`);
  $("imp-go").onclick = async () => {
    $("imp-go").disabled = true;
    const log = $("imp-log"), ok = [], bad = [];
    const by = ME, at = new Date().toISOString();
    for (const f of conv) {
      if (big.includes(f)) continue;
      log.textContent = `Saving ${ok.length + bad.length + 1} of ${conv.length - big.length}: ${f.name} (${f.site})…`;
      try { const { id, ...rec } = f; await setDoc(doc(db, "forms", id), { ...rec, importedAt: at, importedBy: by, updatedAt: serverTimestamp() }); ok.push(f); FORMS[id] = { id, ...rec }; }
      catch (e) { console.error(e); bad.push(f.name + ": " + (e.code || e.message)); if (/permission/i.test(e.code || e.message) && bad.length === 1 && !ok.length) break; }
    }
    // The short list the tech app loads: every form we have (old ones kept), with the counts.
    const map = new Map(INDEX.map(f => [f.id, f]));
    ok.forEach(f => map.set(f.id, { id: f.id, name: f.name, site: f.site, items: CF.answerItems(f).length, boUpdated: f.boUpdated || null, createdBy: f.createdBy || "", active: true }));
    const forms = [...map.values()].sort((a, b) => nat(a.site, b.site) || nat(a.name, b.name));
    try { if (ok.length) await setDoc(doc(db, "forms", "_index"), { forms, updatedAt: serverTimestamp(), updatedBy: by }); }
    catch (e) { console.error(e); bad.push("Form list: " + (e.code || e.message)); }
    log.textContent = `Imported ${ok.length} form${ok.length === 1 ? "" : "s"}.` + (bad.length ? `\nNot saved (${bad.length}):\n` + bad.slice(0, 12).join("\n") + (/permission/i.test(bad.join(" ")) ? "\n\nThe database said no. Publish the latest firestore.rules in the Firebase console, then import again." : "") : "");
    if (ok.length) { INDEX = forms; render(); toast(`Imported ${ok.length} forms`); }
  };
};

// ── Start ──
(async () => {
  const u = await currentUser();
  if (!u) { $("app").innerHTML = '<div class="empty">Sign in again to see the checklists.</div>'; return; }
  try { const s = await getDoc(doc(db, "forms", "_index")); INDEX = s.exists() ? (s.data().forms || []) : []; }
  catch (e) { console.error(e); $("app").innerHTML = `<div class="panel empty">The database isn't letting this account read checklists yet. Publish the latest firestore.rules in the Firebase console, then reload.</div>`; return; }
  LOADED = true; render();
  onSnapshot(query(collection(db, "form_entries"), orderBy("startedAt", "desc"), limit(300)), snap => {
    ENTRIES = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (!mod.classList.contains("on") && document.activeElement?.id !== "q") render();
  }, e => { console.error(e); toast("Filled-in checklists couldn't load: " + (e.code || e.message), true); });
})();
