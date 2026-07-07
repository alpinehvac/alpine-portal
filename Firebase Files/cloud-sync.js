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

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import {
  getFirestore, collection, getDocs, doc, setDoc, deleteDoc
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBkkJDjV1g4omNpKoHVln5xADKLmVBEYZs",
  authDomain: "alpine-hvac-portal.firebaseapp.com",
  projectId: "alpine-hvac-portal",
  storageBucket: "alpine-hvac-portal.firebasestorage.app",
  messagingSenderId: "320109813387",
  appId: "1:320109813387:web:1100ee2f9e5a445c5f3e8e",
  measurementId: "G-P28EXYRS57"
};

const fbApp = initializeApp(firebaseConfig);
const db = getFirestore(fbApp);
const COLLECTION = window.AP_SYNC_COLLECTION || "alpine_default_sync";

// ── Hydrate: pull every doc in this tool's collection into localStorage ──
async function apCloudHydrate() {
  try {
    const snap = await getDocs(collection(db, COLLECTION));
    snap.forEach(d => {
      const data = d.data();
      if (data && typeof data.value === "string") {
        _origSetItem.call(localStorage, d.id, data.value);
      }
    });
  } catch (e) {
    console.warn("Alpine cloud sync: could not reach Firestore, continuing with local data only.", e);
  }
}

// ── Write-through: every localStorage save also pushes to Firestore ──
const _origSetItem = Storage.prototype.setItem;
const _origRemoveItem = Storage.prototype.removeItem;

Storage.prototype.setItem = function (key, value) {
  _origSetItem.call(this, key, value);
  if (this === localStorage) {
    setDoc(doc(db, COLLECTION, key), { value: String(value), updatedAt: Date.now() })
      .catch(e => console.warn("Alpine cloud sync: write failed for key", key, e));
  }
};

Storage.prototype.removeItem = function (key) {
  _origRemoveItem.call(this, key);
  if (this === localStorage) {
    deleteDoc(doc(db, COLLECTION, key))
      .catch(e => console.warn("Alpine cloud sync: delete failed for key", key, e));
  }
};

// ── Boot sequence: hydrate first, then load the tool's real app script ──
(async function boot() {
  await apCloudHydrate();
  const s = document.createElement("script");
  s.src = window.AP_APP_SCRIPT;
  document.body.appendChild(s);
})();
