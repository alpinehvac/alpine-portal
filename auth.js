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
  "jake.gilmore@alpinehvac.ca":     { name: "Jake Gilmore",     roles: ["super_admin", "sales", "finance", "owner"] },
  "mike.launder@alpinehvac.ca":     { name: "Mike Launder",     roles: ["super_admin", "sales", "finance", "owner"] },
  "clarissa.launder@alpinehvac.ca": { name: "Clarissa Launder", roles: ["super_admin", "support", "finance"] },
  "cole.hamilton@alpinehvac.ca":    { name: "Cole Hamilton",    roles: ["super_admin", "sales", "ops", "field_ops"] },
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
  "cash-dashboard":     { label: "Financial Position",            roles: ["finance"], strict: true }, // Jake, Mike, Clarissa only
  "job-profit":         { label: "Job Profit",                    roles: ["owner"], strict: true },   // retired: now Field Operations > Completed jobs; page redirects there
  "ops-dashboard":      { label: "Field Operations",              roles: ["owner", "field_ops"], strict: true }, // Jake, Mike + Cole (pipeline + materials); Completed jobs / profit shown to owners only
  "invoicing":          { label: "Invoicing",                     roles: ["owner", "field_ops"], strict: true }, // jobs ready to bill, review, email, queue for BuildOps: Jake, Mike + Cole (invoicing_data)
  "job":                { label: "Jobs",                          roles: ["owner", "field_ops", "ops"], strict: true }, // job pages: visits, tech reports, hours, materials, job reports; costs/invoices/emails Jake, Mike + Cole (Firestore ops_job_costs)
  "context":            { label: "Business Context",              roles: ["owner"], strict: true },   // single context log read by every dashboard refresh: Jake, Mike only
  "pl-calculator":      { label: "P&L + Compensation Calculator", roles: [] },       // super_admin only
  "team-hub":           { label: "Team Hub",                      roles: [] },       // super_admin only
  "team-files":         { label: "Team Files",                    roles: ["owner"], strict: true }, // Team Hub > Team Files + quarterly reviews: Jake, Mike only
  "service-agreement":  { label: "Service Agreement Calculator",  roles: ["sales", "support"] },
  "service-agreements": { label: "Service Agreement Tracker",     roles: ["sales"], strict: true }, // sales role required, no super_admin bypass
  "site-reports":       { label: "Site Reports",                  roles: ["sales", "ops"], strict: true }, // quarterly maintenance progress + customer summaries
  "accounts":           { label: "Account Management",            roles: ["owner", "field_ops"], strict: true }, // per-customer file, QTD/YTD activity, quarterly report + live link: Jake, Mike + Cole (account_data, account_share)
  "sales-strategy":     { label: "Sales Strategy",                roles: ["sales"] },
  "case-studies":       { label: "Case Studies",                  roles: ["sales"] },
  "audit-playbook":     { label: "Audit Playbook",                roles: ["sales"] },
  "audit-tool":         { label: "Building Performance Audit",    roles: ["sales"], strict: true }, // audit_data + audit_photos: sales only
  "outbound":           { label: "Outbound",                      roles: ["sales"], strict: true }, // territory map + targets: outbound_data, sales only
  "lead-sheets":        { label: "Lead Sheets",                   roles: ["sales"] },
  "call-log":           { label: "Alpine Call Log / On-Call",     roles: ["ops"] },
};

// Where each person lands after signing in (dashboard.html with no view).
// Anyone not listed lands on Home.
const AP_START = {
  "jake.gilmore@alpinehvac.ca":     "dashboard.html?view=home",       // owner overview
  "mike.launder@alpinehvac.ca":     "dashboard.html?view=operations",
  "cole.hamilton@alpinehvac.ca":    "dashboard.html?view=operations",
  "natalie.townsend@alpinehvac.ca": "dashboard.html?view=sales",
};
function apStartPage(session) {
  const s = session || apGetSession();
  return (s && AP_START[s.email]) || "dashboard.html?view=home";
}

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
    // Remember the page so an already-signed-in user (e.g. a link opened from BuildOps or an email) lands back on it.
    try { sessionStorage.setItem("ap_redirect", (location.pathname.split("/").pop() || "dashboard.html") + location.search + location.hash); } catch (e) {}
    window.location.href = "index.html";
    return;
  }
  if (!apHasAccess(session, toolId)) {
    window.location.href = "dashboard.html";
    return;
  }
}

// True when the signed-in user is an owner (Jake, Mike). Used to gate Team Files in Team Hub.
function apIsOwner() {
  const session = apGetSession();
  return !!(session && session.roles.includes("owner"));
}

// Returns the list of tools the current session is allowed to see, for building the dashboard.
function apVisibleTools() {
  const session = apGetSession();
  if (!session) return [];
  return Object.keys(AP_TOOLS).filter(id => apHasAccess(session, id));
}

// Outlook links: open the Outlook app, not Outlook in the browser (Apple devices only; the scheme is unreliable on Windows).
// The app has no supported link to one specific email, so the click copies the email's subject for its search box.
// Stored email links stay as they are; the note it shows has an "Open in browser" link for when the app isn't available.
document.addEventListener("click", e => {
  const a = e.target.closest && e.target.closest('a[href*="outlook.office"]');
  if (!a || e.metaKey || e.ctrlKey || !/Mac|iPhone|iPad/.test(navigator.platform || "")) return;
  e.preventDefault();
  const text = (a.dataset.search || a.textContent || "").replace(/[↗\s]+$/, "").trim(), web = a.href;
  const note = document.createElement("div");
  note.textContent = "Opening Outlook. Subject copied: click Search in Outlook and paste it. ";
  const alt = document.createElement("a"); alt.href = web; alt.target = "_blank"; alt.rel = "noopener"; alt.textContent = "Open in browser"; alt.style.color = "#9FD3D5";
  alt.addEventListener("click", ev => ev.stopPropagation()); note.appendChild(alt);
  note.style.cssText = "position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:9999;background:#10444E;color:#fff;font:500 13px Inter,system-ui,sans-serif;padding:10px 16px;border-radius:8px;box-shadow:0 4px 14px rgba(10,42,48,.3)";
  document.body.appendChild(note);
  setTimeout(() => note.remove(), 8000);
  if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
  location.href = "ms-outlook://";
});

// Left sidebar navigation (sidebar.js) on every page except the login page.
(function () {
  const f = (location.pathname.split("/").pop() || "").toLowerCase();
  if (f === "" || f === "index.html" || window.__apSidebarLoading) return;
  window.__apSidebarLoading = true;
  // ?embed=<view>: this page is a block inside a dashboard, so no sidebar.
  const embed = new URLSearchParams(location.search).get("embed");
  if (embed) document.documentElement.classList.add("ap-embed", "ap-embed-" + embed.replace(/[^a-z0-9-]/gi, ""));
  const s = document.createElement("script"); s.src = embed ? "ap-embed.js" : "sidebar.js";
  (document.head || document.documentElement).appendChild(s);
})();
