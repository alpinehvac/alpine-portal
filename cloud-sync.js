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

import {
  collection, getDocs, doc, setDoc, deleteDoc
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";
import { db, currentUser } from "./ap-firebase.js";

const COLLECTION = window.AP_SYNC_COLLECTION || "alpine_default_sync";
const ROUTES = window.AP_SYNC_ROUTES || {};
function collFor(key) {
  for (const prefix in ROUTES) if (String(key).startsWith(prefix)) return ROUTES[prefix];
  return COLLECTION;
}

// ── Hydrate: pull every doc in this tool's collection(s) into localStorage ──
async function apCloudHydrate() {
  const colls = [COLLECTION, ...new Set(Object.values(ROUTES))];
  for (const c of colls) {
    try {
      const snap = await getDocs(collection(db, c));
      snap.forEach(d => {
        const data = d.data();
        if (data && typeof data.value === "string") {
          _origSetItem.call(localStorage, d.id, data.value);
        }
      });
    } catch (e) {
      console.warn("Alpine cloud sync: could not reach Firestore collection " + c + ", continuing with local data only.", e);
    }
  }
}

// ── Write-through: every localStorage save also pushes to Firestore ──
const _origSetItem = Storage.prototype.setItem;
const _origRemoveItem = Storage.prototype.removeItem;

Storage.prototype.setItem = function (key, value) {
  _origSetItem.call(this, key, value);
  if (this === localStorage) {
    setDoc(doc(db, collFor(key), key), { value: String(value), updatedAt: Date.now() })
      .catch(e => console.warn("Alpine cloud sync: write failed for key", key, e));
  }
};

Storage.prototype.removeItem = function (key) {
  _origRemoveItem.call(this, key);
  if (this === localStorage) {
    deleteDoc(doc(db, collFor(key), key))
      .catch(e => console.warn("Alpine cloud sync: delete failed for key", key, e));
  }
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
  if (window.AP_APP_SCRIPT) {
    const s = document.createElement("script");
    s.src = window.AP_APP_SCRIPT;
    document.body.appendChild(s);
  }
})();
