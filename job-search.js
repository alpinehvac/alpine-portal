// ── Alpine HVAC Internal Portal — job search box ─────────────────────
// Searches every job on the Field Operations board (job number, customer,
// site, title, PO) and opens its job page. Reads the same job index the
// Jobs page uses (Firestore ops_job_detail/_index, refreshed daily).
// Usage: <div data-job-search></div> + <script type="module" src="job-search.js"></script>
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";
import { db, currentUser } from "./ap-firebase.js";

const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtD = s => { if (!s) return ""; const d = new Date(s.slice(0, 10) + "T12:00:00"); return isNaN(d) ? "" : d.toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" }); };
const STAGE = { completed: ["Completed", "#2E7D57"], ongoing: ["In progress", "#27636C"], upcoming: ["Upcoming", "#5A7A80"] };

const css = `.js-box{position:relative;margin:0 0 1.25rem}
.js-in{width:100%;font:500 15px 'Inter',system-ui,sans-serif;color:#10444E;background:#fff;border:1px solid rgba(16,68,78,.2);border-radius:10px;padding:13px 16px 13px 44px;outline:none;box-shadow:0 1px 3px rgba(16,68,78,.06)}
.js-in:focus{border-color:#3D818A;box-shadow:0 0 0 3px rgba(61,129,138,.15)}
.js-box>svg{position:absolute;left:15px;top:14px;width:18px;height:18px;fill:none;stroke:#5A7A80;stroke-width:2;stroke-linecap:round}
.js-res{position:absolute;left:0;right:0;top:calc(100% + 4px);z-index:50;background:#fff;border:1px solid rgba(16,68,78,.15);border-radius:10px;box-shadow:0 10px 30px rgba(16,68,78,.15);max-height:420px;overflow:auto;display:none}
.js-res.open{display:block}
.js-row{display:grid;grid-template-columns:118px 1fr auto;gap:12px;align-items:center;padding:10px 14px;border-bottom:1px solid rgba(16,68,78,.07);color:#10444E;text-decoration:none;font-size:13.5px}
.js-row:last-child{border-bottom:0}.js-row:hover,.js-row.sel{background:#EEF6F6}
.js-row b{font-family:'Oswald',sans-serif;font-weight:500;color:#27636C}
.js-row small{display:block;color:#5A7A80;font-size:12px;margin-top:1px}
.js-tag{font-size:11px;font-weight:600;border-radius:99px;padding:2px 9px;color:#fff;white-space:nowrap}
.js-none{padding:14px;color:#5A7A80;font-size:13px}
@media (max-width:600px){.js-row{grid-template-columns:1fr auto}.js-row b{grid-column:1/-1}}`;

let INDEX = null;
async function loadIndex() {
  if (INDEX) return INDEX;
  const user = await currentUser();
  if (!user) return (INDEX = []);
  try {
    const snap = await getDoc(doc(db, "ops_job_detail", "_index"));
    INDEX = snap.exists() ? JSON.parse(snap.data().json || "[]") : [];
  } catch (e) { console.warn("Job search: index not readable", e); INDEX = []; }
  return INDEX;
}

function mount(host) {
  if (host.dataset.mounted) return; host.dataset.mounted = "1";
  if (!document.getElementById("js-css")) { const st = document.createElement("style"); st.id = "js-css"; st.textContent = css; document.head.appendChild(st); }
  host.innerHTML = `<div class="js-box"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
    <input class="js-in" type="search" placeholder="${esc(host.dataset.placeholder || "Search jobs: job #, customer, site or PO")}" aria-label="Search jobs" autocomplete="off">
    <div class="js-res" role="listbox"></div></div>`;
  const inp = host.querySelector(".js-in"), res = host.querySelector(".js-res");
  let rows = [], sel = -1;
  const draw = async () => {
    const q = inp.value.trim().toLowerCase();
    if (!q) { res.classList.remove("open"); return; }
    const list = await loadIndex();
    const words = q.split(/\s+/);
    rows = list.filter(j => { const hay = [j.id, j.customer, j.property, j.title, j.po].join(" ").toLowerCase(); return words.every(w => hay.includes(w)); })
      .sort((a, b) => (b.lastVisit || b.created || "").localeCompare(a.lastVisit || a.created || "")).slice(0, 12);
    sel = -1;
    res.innerHTML = rows.length ? rows.map((j, i) => { const st = STAGE[j.stage] || ["", "#5A7A80"];
      return `<a class="js-row" data-i="${i}" href="job.html?id=${encodeURIComponent(j.id)}"><b>${esc(j.id)}</b><span>${esc(j.customer || "")}<small>${esc(j.property || "")}${j.title ? " · " + esc(j.title) : ""}${j.po ? " · PO " + esc(j.po) : ""}${j.lastVisit ? " · last visit " + fmtD(j.lastVisit) : ""}</small></span>${st[0] ? `<span class="js-tag" style="background:${st[1]}">${st[0]}</span>` : ""}</a>`; }).join("")
      : `<div class="js-none">${list.length ? "No jobs match." : "Job index not available for this account yet."} <a href="job.html">All jobs →</a></div>`;
    res.classList.add("open");
  };
  inp.addEventListener("input", draw);
  inp.addEventListener("focus", () => { loadIndex(); if (inp.value.trim()) draw(); });
  inp.addEventListener("keydown", e => {
    const a = res.querySelectorAll(".js-row");
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(0, Math.min(a.length - 1, sel + (e.key === "ArrowDown" ? 1 : -1))); a.forEach((x, i) => x.classList.toggle("sel", i === sel)); }
    else if (e.key === "Enter") { const t = a[sel >= 0 ? sel : 0]; if (t) location.href = t.href; }
    else if (e.key === "Escape") res.classList.remove("open");
  });
  document.addEventListener("click", e => { if (!host.contains(e.target)) res.classList.remove("open"); });
}

const run = () => document.querySelectorAll("[data-job-search]").forEach(mount);
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run); else run();
window.apJobSearchMount = run;
