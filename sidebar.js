// ── Alpine HVAC Internal Portal — Left sidebar navigation ─────────────
// Loaded automatically by auth.js on every portal page (not the login page,
// and not when a page is shown inside a dashboard with ?embed=…).
// Builds a collapsible sidebar: Home / Sales / Operations / Financials /
// Business Context, each with a dropdown of its tools, filtered by role
// through apHasAccess(). It replaces each page's old top bar and
// "← Back to …" links, which are hidden (not deleted) so nothing on the
// page itself changes.
//
// To move a tool: edit AP_NAV below. A tool id must exist in AP_TOOLS (auth.js).
(function () {
  "use strict";
  if (window.__apSidebar) return; window.__apSidebar = true;
  const file = (location.pathname.split("/").pop() || "index.html").toLowerCase();
  const params = new URLSearchParams(location.search);
  if (file === "index.html" || file === "" || params.has("embed") || window.top !== window) return;
  const session = typeof apGetSession === "function" ? apGetSession() : null;
  if (!session) return;
  const can = id => typeof apHasAccess === "function" && apHasAccess(session, id);
  const has = r => session.roles.includes(r);

  // ── Navigation map ──
  // item: { label, href | tool | ext, show(), match: [files], children: [...] }
  const D = v => "dashboard.html?view=" + v;
  const AP_NAV = [
    { key: "home", label: "Home", icon: "home", href: D("home"), match: [D("home")] },
    { key: "sales", label: "Sales", icon: "sales", items: [
      { label: "Dashboard", href: D("sales"), show: () => has("sales"), match: [D("sales")] },
      { tool: "service-agreement", label: "SA Calculator" },
      { tool: "sales-strategy", label: "Sales Strategy" },
      { tool: "audit-tool", label: "Building Performance Audit", children: [
        { tool: "audit-playbook", label: "Audit Playbook" } ] },
      { tool: "case-studies", label: "Case Studies" },
      { tool: "outbound", label: "Outbound", children: [
        { tool: "lead-sheets", label: "Lead Sheets", ext: true } ] },
      // Sales people without Outbound access still get their lead sheet.
      { tool: "lead-sheets", label: "Lead Sheets", ext: true, show: () => can("lead-sheets") && !can("outbound") },
    ] },
    { key: "operations", label: "Operations", icon: "ops", items: [
      { label: "Dashboard", href: D("operations"), show: () => can("ops-dashboard"), match: [D("operations")] },
      { tool: "ops-dashboard", label: "Field Operations", match: ["ops-dashboard.html", "job.html", "job-profit.html"] },
      // Field techs can't open Field Operations but do use the job pages.
      { tool: "job", label: "Jobs", show: () => can("job") && !can("ops-dashboard"), match: ["job.html"] },
      { tool: "service-agreements", label: "Service Agreements", match: ["service-agreements.html", "agreement.html", "refresh.html"] },
      { tool: "site-reports", label: "Site Reports", match: ["site-reports.html", "site.html"] },
      { tool: "team-hub", label: "Team Hub" },
      { tool: "call-log", label: "Call Log / On-Call", ext: true },
    ] },
    { key: "financials", label: "Financials", icon: "fin", items: [
      { label: "Dashboard", href: D("financials"), show: () => can("cash-dashboard"), match: [D("financials")] },
      { tool: "cash-dashboard", label: "Financial Position" },
      { tool: "pl-calculator", label: "P&L Calculator" },
    ] },
    { key: "context", label: "Business Context", icon: "ctx", tool: "context" },
  ];
  const EXT = {
    "lead-sheets": "https://netorg13787440-my.sharepoint.com/:x:/g/personal/natalie_townsend_alpinehvac_ca/IQDFyXX0JO36RaKmRK5rUj8TATpMgjfqE_WIuufYkn7YIIw?e=cX7qOq",
    "call-log": "https://docs.google.com/spreadsheets/d/1IaDmMURNjVWhIQZ0eVhDRFjUFVhevVXNHTJ0-BW3ZvM/edit?usp=sharing",
  };
  const ICON = {
    home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
    sales: '<path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/>',
    ops: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/>',
    fin: '<path d="M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
    ctx: '<path d="M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h7"/>',
    chev: '<path d="m9 6 6 6-6 6"/>',
    collapse: '<path d="m15 6-6 6 6 6"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  };
  const svg = (k, cls) => `<svg class="${cls || "sb-ic"}" viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg>`;
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ── Resolve what this person sees ──
  const visible = it => it.show ? it.show() : it.tool ? can(it.tool) : true;
  const hrefOf = it => it.href || (it.ext ? EXT[it.tool] : it.tool + ".html");
  const here = file + (file === "dashboard.html" ? "?view=" + (params.get("view") || params.get("cat") || "") : "");
  const isHere = it => (it.match || [it.tool ? it.tool + ".html" : it.href]).some(m => m && m.toLowerCase() === here || (m && !m.includes("?") && m.toLowerCase() === file));
  function resolve(list) {
    return list.filter(visible).map(it => ({ ...it, children: it.children ? resolve(it.children) : [] }));
  }
  const nav = AP_NAV.map(g => g.items ? { ...g, items: resolve(g.items) } : g).filter(g => g.items ? g.items.length : visible(g));

  // ── State (per browser) ──
  const LS = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} } };
  let collapsed = LS.get("ap_sb_collapsed") === "1";
  let open = {}; try { open = JSON.parse(LS.get("ap_sb_open")) || {}; } catch (e) {}
  nav.forEach(g => { if (g.items && g.items.some(i => isHere(i) || i.children.some(isHere))) open[g.key] = true; });

  // ── Styles ──
  const css = `
  :root{--ap-sb-w:252px;--ap-sb-wc:66px}
  html.ap-sb body{padding-left:var(--ap-sb-w)!important;transition:padding-left .18s}
  html.ap-sb.ap-sb-c body{padding-left:var(--ap-sb-wc)!important}
  /* old top bars and back-to-dashboard links: the sidebar replaces them */
  html.ap-sb body>nav:not(.jump){display:none!important}
  html.ap-sb a[href="dashboard.html"]:not(.sb-a),html.ap-sb a[href^="dashboard.html?cat="]:not(.sb-a){display:none!important}
  #ap-sb{position:fixed;top:0;left:0;bottom:0;width:var(--ap-sb-w);z-index:900;display:flex;flex-direction:column;
    background:linear-gradient(180deg,#0A2A30 0%,#10444E 60%,#1B5560 100%);color:#fff;font-family:'Inter',system-ui,sans-serif;
    box-shadow:2px 0 14px rgba(10,42,48,.18);transition:width .18s,transform .2s}
  html.ap-sb-c #ap-sb{width:var(--ap-sb-wc)}
  #ap-sb *{box-sizing:border-box}
  #ap-sb .sb-top{display:flex;align-items:center;gap:10px;padding:16px 14px 14px;border-bottom:1px solid rgba(255,255,255,.08)}
  #ap-sb .sb-logo{width:36px;height:36px;border-radius:8px;background:#3D818A;display:flex;align-items:center;justify-content:center;flex-shrink:0}
  #ap-sb .sb-logo svg{width:20px;height:20px;fill:none;stroke:#fff;stroke-width:2;stroke-linejoin:round}
  #ap-sb .sb-word{font-family:'Oswald',sans-serif;font-size:14px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;line-height:1;white-space:nowrap}
  #ap-sb .sb-word small{display:block;font-size:9px;font-weight:400;letter-spacing:.18em;color:#9FD3D5;margin-top:3px}
  #ap-sb .sb-tog{margin-left:auto;background:none;border:0;color:rgba(255,255,255,.6);cursor:pointer;padding:6px;border-radius:6px;display:flex}
  #ap-sb .sb-tog:hover{color:#fff;background:rgba(255,255,255,.08)}
  #ap-sb .sb-tog svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;transition:transform .18s}
  html.ap-sb-c #ap-sb .sb-tog svg{transform:rotate(180deg)}
  html.ap-sb-c #ap-sb .sb-word,html.ap-sb-c #ap-sb .sb-label,html.ap-sb-c #ap-sb .sb-chev,html.ap-sb-c #ap-sb .sb-sub,html.ap-sb-c #ap-sb .sb-user span{display:none}
  html.ap-sb-c #ap-sb .sb-top{flex-direction:column;padding:14px 0 10px}
  html.ap-sb-c #ap-sb .sb-tog{margin:4px 0 0}
  #ap-sb .sb-scroll{flex:1;overflow-y:auto;padding:12px 10px}
  #ap-sb .sb-scroll::-webkit-scrollbar{width:4px}#ap-sb .sb-scroll::-webkit-scrollbar-thumb{background:rgba(255,255,255,.18)!important}
  #ap-sb .sb-scroll::-webkit-scrollbar-track{background:transparent!important}
  #ap-sb .sb-row{display:flex;align-items:center;gap:12px;width:100%;padding:9px 10px;margin:1px 0;border:0;border-radius:8px;background:none;
    color:rgba(255,255,255,.82);font:600 12.5px 'Oswald',sans-serif;letter-spacing:.09em;text-transform:uppercase;text-decoration:none;cursor:pointer;text-align:left}
  #ap-sb .sb-row:hover{background:rgba(255,255,255,.07);color:#fff}
  #ap-sb .sb-row.on{background:rgba(159,211,213,.16);color:#fff}
  #ap-sb .sb-ic{width:19px;height:19px;flex-shrink:0;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
  #ap-sb .sb-chev{width:14px;height:14px;margin-left:auto;fill:none;stroke:currentColor;stroke-width:2;opacity:.6;transition:transform .15s}
  #ap-sb .sb-g.open .sb-chev{transform:rotate(90deg)}
  #ap-sb .sb-sub{display:none;margin:2px 0 8px 19px;padding-left:12px;border-left:1px solid rgba(255,255,255,.12)}
  #ap-sb .sb-g.open .sb-sub{display:block}
  #ap-sb .sb-a{display:flex;align-items:center;gap:6px;padding:6px 10px;border-radius:6px;color:rgba(255,255,255,.72);font-size:13px;text-decoration:none;line-height:1.3}
  #ap-sb .sb-a:hover{color:#fff;background:rgba(255,255,255,.06)}
  #ap-sb .sb-a.on{color:#fff;background:rgba(159,211,213,.18);font-weight:600}
  #ap-sb .sb-a .sb-x{width:11px;height:11px;fill:none;stroke:currentColor;stroke-width:2;opacity:.55;flex-shrink:0}
  #ap-sb .sb-a.child{font-size:12.5px;padding-left:22px;position:relative}
  #ap-sb .sb-a.child::before{content:'';position:absolute;left:10px;top:50%;width:7px;height:1px;background:rgba(255,255,255,.3)}
  #ap-sb .sb-a.dash{font-weight:600;color:#BFE5E6}
  #ap-sb .sb-foot{border-top:1px solid rgba(255,255,255,.08);padding:12px 14px;display:flex;align-items:center;gap:10px}
  #ap-sb .sb-user{display:flex;align-items:center;gap:10px;min-width:0;flex:1;font-size:12px;color:rgba(255,255,255,.75)}
  #ap-sb .sb-av{width:30px;height:30px;border-radius:50%;background:#3D818A;color:#fff;display:flex;align-items:center;justify-content:center;font:600 12px 'Oswald',sans-serif;flex-shrink:0}
  #ap-sb .sb-user span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  #ap-sb .sb-out{background:none;border:1px solid rgba(255,255,255,.25);color:rgba(255,255,255,.8);font:600 10px 'Oswald',sans-serif;letter-spacing:.08em;text-transform:uppercase;border-radius:6px;padding:6px 9px;cursor:pointer;white-space:nowrap}
  #ap-sb .sb-out:hover{color:#fff;border-color:rgba(255,255,255,.6)}
  html.ap-sb-c #ap-sb .sb-foot{flex-direction:column;padding:10px 6px}
  html.ap-sb-c #ap-sb .sb-out{padding:5px 4px;font-size:9px}
  html.ap-sb-c #ap-sb .sb-row{justify-content:center;padding:10px 0}
  #ap-sb-burger{display:none;position:fixed;top:10px;left:10px;z-index:901;width:40px;height:40px;border-radius:10px;border:0;background:#10444E;color:#fff;box-shadow:0 2px 10px rgba(10,42,48,.3);cursor:pointer;align-items:center;justify-content:center}
  #ap-sb-burger svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round}
  #ap-sb-scrim{display:none;position:fixed;inset:0;background:rgba(10,42,48,.4);z-index:899}
  @media (max-width:900px){
    html.ap-sb body,html.ap-sb.ap-sb-c body{padding-left:0!important}
    html.ap-sb body{padding-top:0}
    #ap-sb,html.ap-sb-c #ap-sb{width:var(--ap-sb-w);transform:translateX(-105%)}
    html.ap-sb-m #ap-sb{transform:none}
    html.ap-sb-m #ap-sb-scrim{display:block}
    #ap-sb-burger{display:flex}
    html.ap-sb-m #ap-sb-burger{display:none}
    html.ap-sb-c #ap-sb .sb-word,html.ap-sb-c #ap-sb .sb-label,html.ap-sb-c #ap-sb .sb-chev,html.ap-sb-c #ap-sb .sb-sub,html.ap-sb-c #ap-sb .sb-user span{display:revert}
    #ap-sb .sb-tog{display:none!important}
  }
  @media print{#ap-sb,#ap-sb-burger,#ap-sb-scrim{display:none!important}html.ap-sb body,html.ap-sb.ap-sb-c body{padding-left:0!important}}`;

  // ── Markup ──
  function leaf(it, cls) {
    const ext = it.ext ? ' target="_blank" rel="noopener"' : "";
    return `<a class="sb-a ${cls || ""}${isHere(it) ? " on" : ""}" href="${esc(hrefOf(it))}"${ext}>${esc(it.label)}${it.ext ? svg("ext", "sb-x") : ""}</a>`;
  }
  function group(g) {
    if (!g.items) return `<a class="sb-row sb-a-row${isHere(g) ? " on" : ""}" href="${esc(hrefOf(g))}" title="${esc(g.label)}">${svg(g.icon)}<span class="sb-label">${esc(g.label)}</span></a>`;
    const active = g.items.some(i => isHere(i) || i.children.some(isHere));
    const first = g.items[0];
    return `<div class="sb-g${open[g.key] ? " open" : ""}" data-g="${g.key}">
      <button class="sb-row${active ? " on" : ""}" type="button" data-first="${esc(hrefOf(first))}" title="${esc(g.label)}" aria-expanded="${!!open[g.key]}">${svg(g.icon)}<span class="sb-label">${esc(g.label)}</span>${svg("chev", "sb-chev")}</button>
      <div class="sb-sub">${g.items.map(i => leaf(i, i.label === "Dashboard" ? "dash" : "") + i.children.map(c => leaf(c, "child")).join("")).join("")}</div></div>`;
  }
  const initials = (session.name || "?").split(" ").map(p => p[0]).join("").slice(0, 2).toUpperCase();
  function mount() {
    if (document.getElementById("ap-sb")) return;
    if (!document.querySelector('link[href*="Oswald"]')) {
      const f = document.createElement("link"); f.rel = "stylesheet";
      f.href = "https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&family=Inter:wght@400;500;600&display=swap";
      document.head.appendChild(f);
    }
    const st = document.createElement("style"); st.id = "ap-sb-css"; st.textContent = css; document.head.appendChild(st);
    const root = document.documentElement; root.classList.add("ap-sb"); if (collapsed) root.classList.add("ap-sb-c");
    const aside = document.createElement("aside"); aside.id = "ap-sb"; aside.setAttribute("aria-label", "Portal navigation");
    aside.innerHTML = `<div class="sb-top"><a class="sb-logo" href="${D("home")}" title="Home"><svg viewBox="0 0 24 24"><path d="M3 20 L9 9 L13 15 L16 11 L21 20 Z"/></svg></a>
      <div class="sb-word">Alpine HVAC<small>Internal Portal</small></div>
      <button class="sb-tog" type="button" title="Collapse sidebar" aria-label="Collapse sidebar">${svg("collapse", "")}</button></div>
      <nav class="sb-scroll" aria-label="Sections">${nav.map(group).join("")}</nav>
      <div class="sb-foot"><div class="sb-user" title="${esc(session.name)}"><div class="sb-av">${esc(initials)}</div><span>${esc(session.name)}</span></div>
      <button class="sb-out" type="button">Sign out</button></div>`;
    const burger = document.createElement("button"); burger.id = "ap-sb-burger"; burger.type = "button"; burger.setAttribute("aria-label", "Open menu"); burger.innerHTML = svg("menu", "");
    const scrim = document.createElement("div"); scrim.id = "ap-sb-scrim";
    document.body.prepend(scrim); document.body.prepend(burger); document.body.prepend(aside);

    aside.querySelector(".sb-tog").onclick = () => { collapsed = !collapsed; root.classList.toggle("ap-sb-c", collapsed); LS.set("ap_sb_collapsed", collapsed ? "1" : "0"); window.dispatchEvent(new Event("resize")); };
    aside.querySelector(".sb-out").onclick = () => { if (typeof apLogout === "function") apLogout(); };
    aside.querySelectorAll(".sb-g > .sb-row").forEach(b => b.onclick = () => {
      const g = b.parentElement;
      // Collapsed rail: the icon opens that section's first page (its dashboard).
      if (collapsed && innerWidth > 900) { location.href = b.dataset.first; return; }
      const on = !g.classList.contains("open"); g.classList.toggle("open", on); b.setAttribute("aria-expanded", on);
      open[g.dataset.g] = on; LS.set("ap_sb_open", JSON.stringify(open));
    });
    burger.onclick = () => root.classList.add("ap-sb-m");
    scrim.onclick = () => root.classList.remove("ap-sb-m");
  }
  if (document.body) mount(); else document.addEventListener("DOMContentLoaded", mount);
  window.AP_NAV = AP_NAV;
})();
