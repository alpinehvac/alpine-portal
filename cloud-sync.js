// ── Alpine HVAC Internal Portal — Cloud Sync Layer ────────────────────
// Generic bridge between localStorage (used by the tool pages) and
// Firestore (shared cloud storage), so data syncs across every login
// instead of staying trapped in one browser.
//
// How it works:
//   1. On page load, pulls every saved key for this tool from Firestore
//      and writes it into localStorage BEFORE the tool's own code runs.
//   2. Patches localStorage.setItem/removeItem so every save the tool
//      makes (completely unchanged) also gets pushed to Firestore.
//   3. Once step 1 finishes, dynamically loads the tool's real app
//      script (window.AP_APP_SCRIPT), which then runs exactly as it
//      always has — just now reading/writing through synced data.
//
// Each tool page sets two globals before loading this file:
//   window.AP_SYNC_COLLECTION = "team_hub_data";   // Firestore collection name
//   window.AP_APP_SCRIPT       = "team-hub-app.js"; // the tool's real logic
// Optional: route keys with a given prefix to another collection (read + write):
//   window.AP_SYNC_ROUTES = { "sr_": "site_reports_data" };
//
// Requires a Firebase sign-in: if none is found, the tab session is cleared
// and the user is sent back to the login page before any data is read.
//
// ── Data-loss safeguards (added Oct 2026 after the Q4 review loss) ──
//   A. Nothing local is ever overwritten by an OLDER or misplaced cloud copy:
//      - a cloud doc is only applied from the collection its key routes to;
//      - a local change that has not reached the cloud yet ("unsynced") is
//        never replaced on load; it is pushed up instead.
//   B. Failed cloud saves are never silent: the change stays marked unsynced,
//      a red banner says so, saves are retried every 30 s, and closing or
//      reloading the tab asks for confirmation while anything is unsynced.
//      If someone else saved a newer copy meanwhile, this browser's version
//      is kept as a "conflict-" version instead of being discarded.
//   C. Version history: each key keeps point-in-time copies in a "versions"
//      subcollection (at most one per key every 10 minutes, plus the first
//      save of each session), so an overwritten value can be restored.

import {
  collection, getDocs, getDoc, doc, setDoc, deleteDoc
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";
import { db, currentUser } from "./ap-firebase.js";

const COLLECTION = window.AP_SYNC_COLLECTION || "alpine_default_sync";
const ROUTES = window.AP_SYNC_ROUTES || {};
function collFor(key) {
  for (const prefix in ROUTES) if (String(key).startsWith(prefix)) return ROUTES[prefix];
  return COLLECTION;
}

const _origSetItem = Storage.prototype.setItem;
const _origRemoveItem = Storage.prototype.removeItem;
const _origGetItem = Storage.prototype.getItem;

// ── Local sync bookkeeping (kept in this browser only, never synced) ──
// meta[key] = { t: last change time (ms), dirty: true while not confirmed in the cloud,
//              c: the collection it belongs to (pages route keys differently) }
const META_KEY = "__ap_sync_meta";
const VERSION_GAP_MS = 10 * 60 * 1000;
const RETRY_MS = 30 * 1000;
function isInternal(key) { return String(key).startsWith("__ap_"); }
function loadMeta() {
  try { return JSON.parse(_origGetItem.call(localStorage, META_KEY)) || {}; } catch (e) { return {}; }
}
function saveMeta(m) {
  try { _origSetItem.call(localStorage, META_KEY, JSON.stringify(m)); } catch (e) { /* storage full: banner still shows */ }
}
function markDirty(key, t) { const m = loadMeta(); m[key] = { t, dirty: true, c: collFor(key) }; saveMeta(m); }
function markClean(key, t) {
  const m = loadMeta();
  if (m[key] && m[key].t > t) return;          // a newer local change is still pending
  m[key] = { t, dirty: false, c: (m[key] && m[key].c) || collFor(key) }; saveMeta(m);
}
function dirtyKeys() { const m = loadMeta(); return Object.keys(m).filter(k => m[k] && m[k].dirty); }

// ── Version history: "versions" subcollection under each key's doc ──
const _lastVersionAt = {};
function maybeSnapshot(coll, key, value, t) {
  if (_lastVersionAt[key] && t - _lastVersionAt[key] < VERSION_GAP_MS) return;
  _lastVersionAt[key] = t;
  setDoc(doc(db, coll, key, "versions", String(t)), { value, savedAt: t })
    .catch(e => { _lastVersionAt[key] = 0; console.warn("Alpine cloud sync: version snapshot failed for", key, e); });
}

// ── Push one key's current local value to the cloud ──
const _inFlight = {};
async function pushKey(key) {
  if (_inFlight[key]) return _inFlight[key];
  const run = (async () => {
    const meta = loadMeta()[key];
    const t = meta ? meta.t : Date.now();
    const value = _origGetItem.call(localStorage, key);
    const coll = (meta && meta.c) || collFor(key);
    try {
      if (value === null) {
        await deleteDoc(doc(db, coll, key));
      } else {
        await setDoc(doc(db, coll, key), { value, updatedAt: t });
        maybeSnapshot(coll, key, value, t);
      }
      markClean(key, t);
      return true;
    } catch (e) {
      console.warn("Alpine cloud sync: save to cloud failed for", key, "(" + coll + ")", e);
      window.AP_SYNC_WRITE_ERROR = (e && e.code) || String(e);
      return false;
    } finally {
      delete _inFlight[key];
      renderBanner();
    }
  })();
  _inFlight[key] = run;
  return run;
}

async function retryDirty() {
  const keys = dirtyKeys();
  for (const k of keys) await pushKey(k);
  renderBanner();
}

// ── Write-through: every localStorage save also pushes to Firestore ──
Storage.prototype.setItem = function (key, value) {
  _origSetItem.call(this, key, value);
  if (this === localStorage && !isInternal(key)) {
    markDirty(key, Date.now());
    renderBanner();
    pushKey(key);
  }
};

Storage.prototype.removeItem = function (key) {
  _origRemoveItem.call(this, key);
  if (this === localStorage && !isInternal(key)) {
    markDirty(key, Date.now());
    renderBanner();
    pushKey(key);
  }
};

// ── Hydrate: pull every doc in this tool's collection(s) into localStorage ──
async function apCloudHydrate() {
  window.AP_SYNC_FAILED = [];
  const colls = [COLLECTION, ...new Set(Object.values(ROUTES))];
  const meta = loadMeta();
  const best = {};   // key -> { data, routed }
  for (const c of colls) {
    try {
      const snap = await getDocs(collection(db, c));
      snap.forEach(d => {
        const data = d.data();
        if (!data || typeof data.value !== "string") return;
        const routed = collFor(d.id) === c;
        // Safeguard A1: the copy in the collection a key routes to always wins.
        // A copy left behind in another collection (e.g. before a migration)
        // is only a fallback when the proper collection has none.
        if (routed || !best[d.id]) best[d.id] = { data, routed, c };
      });
    } catch (e) {
      window.AP_SYNC_FAILED.push(c);
      console.warn("Alpine cloud sync: could not reach Firestore collection " + c + ", continuing with local data only.", e);
    }
  }
  const toPush = [];
  for (const key in best) {
    const { data, c } = best[key];
    const cloudT = Number(data.updatedAt) || 0;
    const local = meta[key];
    // Safeguard A2: an unsynced local change at least as new as the cloud copy is
    // never overwritten on load; it is pushed up instead.
    if (local && local.dirty && local.t >= cloudT) { toPush.push(key); continue; }
    // Someone else saved a newer copy while this change was unsynced: keep this
    // browser's version as a recoverable copy instead of silently discarding it.
    if (local && local.dirty) {
      const mine = _origGetItem.call(localStorage, key);
      if (mine !== null) {
        try { _origSetItem.call(localStorage, "__ap_backup_" + key, mine); } catch (e) {}
        setDoc(doc(db, c, key, "versions", "conflict-" + local.t), { value: mine, savedAt: local.t, conflict: true })
          .catch(err => console.warn("Alpine cloud sync: could not store conflict copy for", key, err));
      }
    }
    _origSetItem.call(localStorage, key, data.value);
    meta[key] = { t: cloudT, dirty: false, c: collFor(key) };
  }
  // Keep dirty flags written by other tabs in the meantime.
  const fresh = loadMeta();
  for (const k in fresh) if (fresh[k] && fresh[k].dirty && (!meta[k] || fresh[k].t > meta[k].t)) meta[k] = fresh[k];
  saveMeta(meta);
  for (const k of toPush) pushKey(k);
}

// ── Visible status: red banner whenever data is not safely in the cloud ──
function renderBanner() {
  if (!document.body) return;
  const pending = dirtyKeys().filter(k => !_inFlight[k]);
  const readFail = window.AP_SYNC_FAILED || [];
  let el = document.getElementById("ap-sync-banner");
  if (!pending.length && !readFail.length) { if (el) el.remove(); return; }
  if (!el) {
    el = document.createElement("div");
    el.id = "ap-sync-banner";
    el.setAttribute("role", "alert");
    el.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:2147483647;background:#B3261E;color:#fff;" +
      "font:600 14px/1.4 Inter,system-ui,sans-serif;padding:12px 18px;display:flex;gap:14px;align-items:center;" +
      "justify-content:space-between;box-shadow:0 -2px 12px rgba(0,0,0,.35)";
    document.body.appendChild(el);
  }
  const parts = [];
  if (pending.length) parts.push(pending.length + " change" + (pending.length > 1 ? "s are" : " is") +
    " NOT saved to the cloud yet. Don't close or reload this page.");
  if (readFail.length) parts.push("Can't reach cloud storage (" + readFail.join(", ") + "). Data shown may be out of date, and saves there will fail.");
  el.innerHTML = "";
  const msg = document.createElement("span"); msg.textContent = "⚠ " + parts.join(" ");
  const btn = document.createElement("button");
  btn.type = "button"; btn.textContent = "Retry now";
  btn.style.cssText = "background:#fff;color:#B3261E;border:0;border-radius:4px;padding:8px 14px;font:700 13px Inter,system-ui,sans-serif;cursor:pointer;flex-shrink:0";
  btn.onclick = () => { window.AP_SYNC_FAILED = []; retryDirty(); };
  el.appendChild(msg);
  if (pending.length) el.appendChild(btn);
}

// Safeguard B: warn before leaving with unsynced changes; retry in the background.
window.addEventListener("beforeunload", e => {
  if (dirtyKeys().length) { e.preventDefault(); e.returnValue = ""; }
});
window.addEventListener("online", retryDirty);
setInterval(retryDirty, RETRY_MS);
window.apSyncStatus = () => ({ unsynced: dirtyKeys(), readFailed: window.AP_SYNC_FAILED || [], lastWriteError: window.AP_SYNC_WRITE_ERROR || null });

// ── Safe move of one saved key between collections (used for one-time data migrations).
// Copies, reads the copy back to confirm, and only then deletes the original.
// Resolves "moved", "nothing" (no original) or "already" (copy exists); rejects on any failure,
// leaving the original untouched.
window.apCloudMove = async function (fromColl, toColl, key) {
  const src = await getDoc(doc(db, fromColl, key));
  const dst = await getDoc(doc(db, toColl, key));
  if (dst.exists()) {
    if (src.exists()) await deleteDoc(doc(db, fromColl, key));
    return "already";
  }
  if (!src.exists()) return "nothing";
  await setDoc(doc(db, toColl, key), src.data());
  const check = await getDoc(doc(db, toColl, key));
  if (!check.exists() || check.data().value !== src.data().value) throw new Error("copy check failed for " + key);
  await deleteDoc(doc(db, fromColl, key));
  return "moved";
};

// ── Boot sequence: hydrate first, then load the tool's real app script ──
(async function boot() {
  const user = await currentUser();
  if (!user || typeof apSessionFromEmail !== "function" || !apSessionFromEmail(user.email)) {
    sessionStorage.removeItem("ap_session");
    window.location.href = "index.html";
    return;
  }
  await apCloudHydrate();
  window.AP_CLOUD_READY = true;
  window.dispatchEvent(new Event("ap-cloud-ready"));
  renderBanner();
  retryDirty();
  if (window.AP_APP_SCRIPT) {
    const s = document.createElement("script");
    s.src = window.AP_APP_SCRIPT;
    document.body.appendChild(s);
  }
})();
