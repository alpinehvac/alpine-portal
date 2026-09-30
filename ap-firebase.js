// ── Alpine HVAC Internal Portal — Firebase core ───────────────────────
// Single place the Firebase app, Auth and Firestore are created.
// Imported by index.html (login), cloud-sync.js (data sync) and apLogout().

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, sendPasswordResetEmail, signOut
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBkkJDjV1g4omNpKoHVln5xADKLmVBEYZs",
  authDomain: "alpine-hvac-portal.firebaseapp.com",
  projectId: "alpine-hvac-portal",
  storageBucket: "alpine-hvac-portal.firebasestorage.app",
  messagingSenderId: "320109813387",
  appId: "1:320109813387:web:1100ee2f9e5a445c5f3e8e",
  measurementId: "G-P28EXYRS57"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Resolves once Firebase has restored (or failed to restore) the signed-in user.
export function currentUser() {
  return new Promise(resolve => {
    const stop = onAuthStateChanged(auth, user => { stop(); resolve(user); });
  });
}

export { signInWithEmailAndPassword, sendPasswordResetEmail, signOut };
