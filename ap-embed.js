// ── Alpine HVAC Internal Portal — embedded view helper ───────────────
// A page opened with ?embed=<view> is being shown inside a dashboard
// (dashboard.html) in an iframe. auth.js loads this file for those pages.
//   1. Tags <html> with "ap-embed ap-embed-<view>" so the page's own CSS
//      can show only the condensed blocks for that view.
//   2. Reports its height to the dashboard so the frame fits with no scrollbar.
//   3. Opens links in the full window (not inside the small frame).
// The numbers shown are the page's own: nothing is recalculated here.
(function () {
  "use strict";
  const v = new URLSearchParams(location.search).get("embed");
  if (!v) return;
  const root = document.documentElement;
  root.classList.add("ap-embed", "ap-embed-" + v.replace(/[^a-z0-9-]/gi, ""));
  const css = document.createElement("style");
  css.textContent = `html.ap-embed,html.ap-embed body{background:transparent!important;min-height:0!important}
    html.ap-embed body{padding:0!important;margin:0!important}
    html.ap-embed body>nav,html.ap-embed .back-link[href^="dashboard"],html.ap-embed #banner,html.ap-embed .live-banner{display:none!important}
    html.ap-embed main.wrap,html.ap-embed .wrap{max-width:none!important;padding:0 2px 6px!important;margin:0!important}`;
  (document.head || root).appendChild(css);
  let last = 0;
  const post = () => {
    const h = Math.ceil(document.body ? document.body.scrollHeight : root.scrollHeight);
    if (Math.abs(h - last) < 2) return; last = h;
    try { parent.postMessage({ apEmbed: v, height: h }, location.origin); } catch (e) {}
  };
  const start = () => {
    post();
    if (window.ResizeObserver) new ResizeObserver(post).observe(document.body);
    setInterval(post, 1500);
  };
  if (document.body) start(); else document.addEventListener("DOMContentLoaded", start);
  document.addEventListener("click", e => {
    const a = e.target.closest && e.target.closest("a[href]");
    if (!a || a.target === "_blank" || a.getAttribute("href").startsWith("#") || a.hasAttribute("data-stay")) return;
    a.target = "_top";
  }, true);
})();
