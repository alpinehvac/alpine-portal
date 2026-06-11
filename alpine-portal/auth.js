// ── Alpine HVAC Internal Portal ── Auth & Access Control ──────────────────
// To update credentials: edit the USERS object below, then commit the file.
// Roles: "admin" | "sales" | "ops" | "sales_ops"

const USERS = {
  // ── Admins ─────────────────────────────────────────────────────────────
  "jake.gilmore": {
    password: "Alpine2025!",
    name: "Jake Gilmore",
    email: "jake.gilmore@alpinehvac.ca",
    role: "admin"
  },
  "mike.launder": {
    password: "Alpine2025!",
    name: "Mike Launder",
    email: "mike.launder@alpinehvac.ca",
    role: "admin"
  },
  "clarissa.launder": {
    password: "Alpine2025!",
    name: "Clarissa Launder",
    email: "admin@alpinehvac.ca",
    role: "admin"
  },

  // ── Sales / Ops ────────────────────────────────────────────────────────
  "cole.hamilton": {
    password: "Alpine2025!",
    name: "Cole Hamilton",
    email: "cole.hamilton@alpinehvac.ca",
    role: "sales_ops"
  },

  // ── Ops ────────────────────────────────────────────────────────────────
  "steven.coles": {
    password: "Alpine2025!",
    name: "Steven Coles",
    email: "steven.coles@alpinehvac.ca",
    role: "ops"
  },
  "nick.drost": {
    password: "Alpine2025!",
    name: "Nick Drost",
    email: "nick.drost@alpinehvac.ca",
    role: "ops"
  },
  "tyson.marcoux": {
    password: "Alpine2025!",
    name: "Tyson Marcoux",
    email: "tyson.marcoux@alpinehvac.ca",
    role: "ops"
  },
  "brandon.launder": {
    password: "Alpine2025!",
    name: "Brandon Launder",
    email: "brandon.launder@alpinehvac.ca",
    role: "ops"
  },
  "raol": {
    password: "Alpine2025!",
    name: "Raol",
    email: "controls@alpinehvac.ca",
    role: "ops"
  },
  "matt.martin": {
    password: "Alpine2025!",
    name: "Matt Martin",
    email: "matt.martin@alpinehvac.ca",
    role: "ops"
  }
};

// ── Page access by role ────────────────────────────────────────────────────
// "admin" always gets everything — no need to list here.
const ACCESS = {
  sales_ops:  ["tech-recruiting", "bdr-recruiting", "tech-reviews", "pl-calculator", "bdr-interview-prep"],
  ops:        [],
  sales:      ["pl-calculator"]
};

// ── Auth helpers ───────────────────────────────────────────────────────────
function apLogin(username, password) {
  const key = username.toLowerCase().trim();
  const user = USERS[key];
  if (!user) return null;
  if (user.password !== password) return null;
  const session = { username: key, name: user.name, role: user.role, email: user.email };
  sessionStorage.setItem("ap_session", JSON.stringify(session));
  return session;
}

function apGetSession() {
  try {
    const s = sessionStorage.getItem("ap_session");
    return s ? JSON.parse(s) : null;
  } catch { return null; }
}

function apLogout() {
  sessionStorage.removeItem("ap_session");
  window.location.href = "index.html";
}

function apCanAccess(pageId, session) {
  if (!session) return false;
  if (session.role === "admin") return true;
  return (ACCESS[session.role] || []).includes(pageId);
}

// Call at top of every protected page:  apGuard("page-id")
function apGuard(pageId) {
  const session = apGetSession();
  if (!apCanAccess(pageId, session)) {
    sessionStorage.setItem("ap_redirect", window.location.href);
    window.location.href = "index.html";
  }
  return session;
}
