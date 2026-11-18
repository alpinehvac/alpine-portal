// API KEYS panel on Users & Settings (owners only). Keys let an outside tool (Jake's Claude) use the Basecamp API
// in functions/index.js. The key is made here in the browser, shown once, and only its SHA-256 hash is saved
// (api_keys/{keyId}). Switching a key off takes effect on its next call. api_audit is the API's logbook.
import { doc, getDocs, collection, setDoc, updateDoc, query, orderBy, limit, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";
import { db, currentUser } from "./ap-firebase.js";

export const API_URL = "https://northamerica-northeast1-alpine-hvac-portal.cloudfunctions.net/api";
const SCOPES = [
  ["context:read", "Read the Business Context log"],
  ["context:append", "Add to the Business Context log"],
  ["cash:read", "Read Financial Position"],
  ["cash:write", "Update Financial Position"],
  ["profit:read", "Read Profit Position"],
  ["profit:write", "Update Profit Position"],
  ["ops:read", "Read Field Operations"],
  ["ops:write", "Update Field Operations"],
];
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const when = ts => { const d = ts && ts.toDate ? ts.toDate() : null; return d ? d.toLocaleString("en-CA", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : ""; };
const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
const b64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const sha256 = async s => hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))));
let KEYS = [];
const ME = ((await currentUser()) || {}).email || "";

const panel = document.createElement("div");
panel.className = "panel"; panel.id = "api-panel";
panel.innerHTML = `
  <div class="head"><h2 style="margin:0">API keys</h2><button class="btn" id="api-new">Make a key</button></div>
  <p class="note" style="margin-top:0">A key lets an outside tool, like Jake's Claude, update the dashboards and the Business Context log without anyone being signed in. Each key only does what's ticked. Switch one off and it stops working straight away. Address: <code>${esc(API_URL)}</code></p>
  <form id="api-form" style="display:none;margin-bottom:1rem">
    <label style="max-width:340px;margin-bottom:.7rem">Who or what is it for<input id="api-name" maxlength="60" placeholder="e.g. Jake's Claude"></label>
    <div id="api-scopes" class="checks" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:.2rem .8rem;margin-bottom:.6rem">${SCOPES.map(([v, l]) => `<label><input type="checkbox" value="${v}" checked> ${esc(l)}</label>`).join("")}</div>
    <button class="btn" type="submit">Make key</button> <button class="btn ghost" type="button" id="api-cancel">Cancel</button> <span class="msg" id="api-msg"></span>
  </form>
  <div id="api-show" class="banner info"></div>
  <table><thead><tr><th>Name</th><th>Can do</th><th>Made</th><th>Last used</th><th>Status</th><th></th></tr></thead><tbody id="api-list"><tr><td colspan="6" class="empty">Loading…</td></tr></tbody></table>
  <h2 style="margin-top:1.4rem">Activity</h2>
  <p class="note" style="margin-top:0">Every change made through a key, and every refused call. Newest first.</p>
  <table><thead><tr><th>When</th><th>Key</th><th>Call</th><th>What happened</th></tr></thead><tbody id="api-log"><tr><td colspan="4" class="empty">Loading…</td></tr></tbody></table>`;
(document.querySelector("main") || document.body).appendChild(panel);

const shortScopes = s => {
  const g = {}; (s || []).forEach(x => { const [a, b] = x.split(":"); (g[a] = g[a] || []).push(b === "read" ? "read" : b === "append" ? "add" : "update"); });
  const L = { context: "Context", cash: "Financial", profit: "Profit", ops: "Field Ops" };
  return Object.entries(g).map(([a, v]) => L[a] + " (" + v.join(", ") + ")").join(", ");
};

async function load() {
  try {
    const s = await getDocs(collection(db, "api_keys"));
    KEYS = s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.revoked - b.revoked) || ((b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)));
    $("api-list").innerHTML = KEYS.length ? KEYS.map(k => `<tr class="${k.revoked ? "off" : ""}">
      <td><b>${esc(k.name)}</b><br><small style="color:var(--grey)">alp_${esc(k.id)}_…</small></td>
      <td style="font-size:.82rem">${esc(shortScopes(k.scopes))}</td>
      <td>${esc(when(k.createdAt))}<br><small style="color:var(--grey)">${esc((k.createdBy || "").split("@")[0])}</small></td>
      <td>${esc(when(k.lastUsedAt)) || "Never"}</td>
      <td>${k.revoked ? "Off" : "On"}</td>
      <td style="white-space:nowrap">${k.revoked ? "" : `<button class="btn ghost sm" data-rot="${esc(k.id)}">Replace</button> <button class="btn danger sm" data-off="${esc(k.id)}">Switch off</button>`}</td></tr>`).join("")
      : `<tr><td colspan="6" class="empty">No keys yet.</td></tr>`;
    $("api-list").querySelectorAll("[data-off]").forEach(b => b.onclick = () => switchOff(b.dataset.off));
    $("api-list").querySelectorAll("[data-rot]").forEach(b => b.onclick = () => replace(b.dataset.rot));
  } catch (e) { $("api-list").innerHTML = `<tr><td colspan="6" class="empty">Couldn't load keys (${esc(e.code || e)}). Have the updated rules been published?</td></tr>`; }
  try {
    const s = await getDocs(query(collection(db, "api_audit"), orderBy("at", "desc"), limit(40)));
    $("api-log").innerHTML = s.size ? s.docs.map(d => { const a = d.data(), bad = a.status >= 400; return `<tr>
      <td style="white-space:nowrap">${esc(when(a.at))}</td><td>${esc(a.keyName || "Unknown")}</td><td><code>${esc(a.method)} ${esc(a.path)}</code></td>
      <td style="${bad ? "color:var(--red)" : ""}">${esc(a.summary)}</td></tr>`; }).join("")
      : `<tr><td colspan="4" class="empty">Nothing yet.</td></tr>`;
  } catch (e) { $("api-log").innerHTML = `<tr><td colspan="4" class="empty">Couldn't load activity (${esc(e.code || e)}).</td></tr>`; }
}

async function makeKey(name, scopes) {
  const id = hex(crypto.getRandomValues(new Uint8Array(5)));
  const key = "alp_" + id + "_" + b64url(crypto.getRandomValues(new Uint8Array(32)));
  await setDoc(doc(db, "api_keys", id), { name, scopes, hash: await sha256(key), createdBy: ME, createdAt: serverTimestamp(), revoked: false });
  return key;
}
function showOnce(name, key) {
  const box = $("api-show");
  box.innerHTML = `<span><b>New key for ${esc(name)}.</b> Copy it now and paste it straight into the tool's settings. It won't be shown again, and don't put it in email, chat or GitHub.<br><code id="api-key" style="word-break:break-all;user-select:all">${esc(key)}</code></span><button class="btn sm" id="api-copy">Copy</button><button class="btn ghost sm" id="api-hide">Done</button>`;
  box.classList.add("show");
  $("api-copy").onclick = async () => { try { await navigator.clipboard.writeText(key); $("api-copy").textContent = "Copied"; } catch (e) { getSelection().selectAllChildren($("api-key")); } };
  $("api-hide").onclick = () => { box.classList.remove("show"); box.innerHTML = ""; };
}
const offRec = () => ({ revoked: true, revokedAt: serverTimestamp(), revokedBy: ME });
async function switchOff(id) {
  const k = KEYS.find(x => x.id === id); if (!k) return;
  if (!confirm("Switch off the key for " + k.name + "? Anything using it stops working straight away.")) return;
  try { await updateDoc(doc(db, "api_keys", id), offRec()); await load(); } catch (e) { alert("Couldn't switch it off (" + (e.code || e) + ")."); }
}
async function replace(id) {
  const k = KEYS.find(x => x.id === id); if (!k) return;
  if (!confirm("Make a new key for " + k.name + " and switch the old one off now? The tool stops working until the new key is pasted in.")) return;
  try { const key = await makeKey(k.name, k.scopes); await updateDoc(doc(db, "api_keys", id), offRec()); showOnce(k.name, key); await load(); }
  catch (e) { alert("Couldn't replace it (" + (e.code || e) + ")."); }
}

$("api-new").onclick = () => { $("api-form").style.display = ""; $("api-name").focus(); };
$("api-cancel").onclick = () => { $("api-form").style.display = "none"; };
$("api-form").addEventListener("submit", async ev => {
  ev.preventDefault();
  const name = $("api-name").value.trim(), scopes = [...$("api-scopes").querySelectorAll("input:checked")].map(i => i.value);
  if (!name) { $("api-msg").textContent = "Say who it's for."; return; }
  if (!scopes.length) { $("api-msg").textContent = "Tick at least one."; return; }
  $("api-msg").textContent = "Making…";
  try { const key = await makeKey(name, scopes); $("api-form").style.display = "none"; $("api-name").value = ""; $("api-msg").textContent = ""; showOnce(name, key); await load(); }
  catch (e) { $("api-msg").textContent = "Couldn't make it (" + (e.code || e) + "). Have the updated rules been published?"; }
});
if (ME) load();
