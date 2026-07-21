// ── Alpine HVAC Internal Portal — Auth & Access Control ──────────────
// Central login + role-based access. Loaded by index.html and every tool page.

const AP_USERS = {
  "jake.gilmore":    { password: "Alpine2025!", name: "Jake Gilmore",     roles: ["super_admin", "sales"] },
  "mike.launder":    { password: "Alpine2025!", name: "Mike Launder",     roles: ["super_admin", "sales"] },
  "clarissa.launder":{ password: "Alpine2025!", name: "Clarissa Launder", roles: ["super_admin", "support"] },
  "cole.hamilton":   { password: "Alpine2025!", name: "Cole Hamilton",    roles: ["super_admin", "sales", "ops"] },
  "natalie.townsend":{ password: "Alpine2025!", name: "Natalie Townsend", roles: ["sales"] },
  "grace.santos":    { password: "Alpine2025!", name: "Grace Santos",     roles: ["super_admin", "support"] },
  "steven.coles":    { password: "Alpine2025!", name: "Steven Coles",    roles: ["ops"] },
  "nick.drost":      { password: "Alpine2025!", name: "Nick Drost",      roles: ["ops"] },
  "tyson.marcoux":   { password: "Alpine2025!", name: "Tyson Marcoux",   roles: ["ops"] },
  "brandon.launder": { password: "Alpine2025!", name: "Brandon Launder", roles: ["ops"] },
  "raol":            { password: "Alpine2025!", name: "Raol",           roles: ["ops"] },
  "matt.martin":     { password: "Alpine2025!", name: "Matt Martin",    roles: ["ops"] },
};

// Which roles can see which tool. "super_admin" always bypasses this and sees everything.
const AP_TOOLS = {
  "pl-calculator":      { label: "P&L + Compensation Calculator", roles: [] },       // super_admin only
  "team-hub":           { label: "Team Hub",                      roles: [] },       // super_admin only
  "service-agreement":  { label: "Service Agreement Calculator",  roles: ["sales", "support"] },
  "sales-strategy":     { label: "Sales Strategy",                roles: ["sales"] },
  "lead-sheets":        { label: "Lead Sheets",                   roles: ["sales"] },
  "call-log":           { label: "Alpine Call Log / On-Call",     roles: ["ops"] },
};

const AP_SESSION_KEY = "ap_session";

function apLogin(username, password) {
  const key = (username || "").trim().toLowerCase();
  const user = AP_USERS[key];
  if (!user || user.password !== password) return null;
  const session = { username: key, name: user.name, roles: user.roles };
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
  window.location.href = "index.html";
}

function apHasAccess(session, toolId) {
  if (!session) return false;
  if (session.roles.includes("super_admin")) return true;
  const tool = AP_TOOLS[toolId];
  if (!tool) return false;
  return tool.roles.some(r => session.roles.includes(r));
}

// Call at the top of every tool page: apGuard("tool-id")
function apGuard(toolId) {
  const session = apGetSession();
  if (!session) {
    sessionStorage.setItem("ap_redirect", window.location.pathname.split("/").pop());
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
