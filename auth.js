// ── Alpine HVAC Internal Portal — Auth & Access Control ──────────────
// Role-based access. Loaded by index.html and every tool page.
// Sign-in is handled by Firebase Authentication (ap-firebase.js); no
// passwords live here. Data access is enforced by Firestore security
// rules, which mirror these roles by email.
//
// To add or remove a person: update this list, add/delete their account in
// Firebase > Authentication > Users, and update the email lists in the
// Firestore rules.

const AP_USERS = {
  "jake.gilmore@alpinehvac.ca":     { name: "Jake Gilmore",     roles: ["super_admin", "sales"] },
  "mike.launder@alpinehvac.ca":     { name: "Mike Launder",     roles: ["super_admin", "sales"] },
  "clarissa.launder@alpinehvac.ca": { name: "Clarissa Launder", roles: ["super_admin", "support"] },
  "cole.hamilton@alpinehvac.ca":    { name: "Cole Hamilton",    roles: ["super_admin", "sales", "ops"] },
  "natalie.townsend@alpinehvac.ca": { name: "Natalie Townsend", roles: ["sales"] },
  "steven.coles@alpinehvac.ca":     { name: "Steven Coles",     roles: ["ops"] },
  "nick.drost@alpinehvac.ca":       { name: "Nick Drost",       roles: ["ops"] },
  "tyson.marcoux@alpinehvac.ca":    { name: "Tyson Marcoux",    roles: ["ops"] },
  "brandon.launder@alpinehvac.ca":  { name: "Brandon Launder",  roles: ["ops"] },
  "matt.martin@alpinehvac.ca":      { name: "Matt Martin",      roles: ["ops"] },
};

// Which roles can see which tool. "super_admin" bypasses this and sees everything,
// except tools marked strict: true, which require one of the listed roles.
const AP_TOOLS = {
  "pl-calculator":      { label: "P&L + Compensation Calculator", roles: [] },       // super_admin only
  "team-hub":           { label: "Team Hub",                      roles: [] },       // super_admin only
  "service-agreement":  { label: "Service Agreement Calculator",  roles: ["sales", "support"] },
  "service-agreements": { label: "Service Agreement Tracker",     roles: ["sales"], strict: true }, // sales role required, no super_admin bypass
  "sales-strategy":     { label: "Sales Strategy",                roles: ["sales"] },
  "case-studies":       { label: "Case Studies",                  roles: ["sales"] },
  "lead-sheets":        { label: "Lead Sheets",                   roles: ["sales"] },
  "call-log":           { label: "Alpine Call Log / On-Call",     roles: ["ops"] },
};

const AP_SESSION_KEY = "ap_session";

// Builds the per-tab session after Firebase has verified the sign-in.
// Returns null (and clears the session) if the email isn't on the portal list.
function apSessionFromEmail(email) {
  const key = (email || "").trim().toLowerCase();
  const user = AP_USERS[key];
  if (!user) { sessionStorage.removeItem(AP_SESSION_KEY); return null; }
  const session = { username: key, email: key, name: user.name, roles: user.roles };
  sessionStorage.setItem(AP_SESSION_KEY, JSON.stringify(session));
  return session;
}

function apGetSession() {
  const raw = sessionStorage.getItem(AP_SESSION_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

function apLogout() {
  sessionStorage.removeItem(AP_SESSION_KEY);
  import("./ap-firebase.js")
    .then(m => m.signOut(m.auth))
    .catch(() => {})
    .finally(() => { window.location.href = "index.html"; });
}

function apHasAccess(session, toolId) {
  if (!session) return false;
  const tool = AP_TOOLS[toolId];
  if (tool && tool.strict) return tool.roles.some(r => session.roles.includes(r));
  if (session.roles.includes("super_admin")) return true;
  if (!tool) return false;
  return tool.roles.some(r => session.roles.includes(r));
}

// Call at the top of every tool page: apGuard("tool-id")
function apGuard(toolId) {
  const session = apGetSession();
  if (!session) {
    window.location.href = "index.html";
    return;
  }
  if (!apHasAccess(session, toolId)) {
    window.location.href = "dashboard.html";
    return;
  }
}

// Returns the list of tools the current session is allowed to see, for building the dashboard.
function apVisibleTools() {
  const session = apGetSession();
  if (!session) return [];
  return Object.keys(AP_TOOLS).filter(id => apHasAccess(session, id));
}
