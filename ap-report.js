// ── Basecamp — Report a problem + automatic error reports ─────────────
// Loaded by auth.js on every signed-in page (portal and tech app).
//
// 1. "Report a problem" (sidebar, tech app menu): the person types what went
//    wrong and can add a screenshot or photo. Page, name, time and device are
//    attached automatically.
// 2. Automatic error reports: when a page hits a JavaScript error, it files a
//    report on its own (a few per page at most, each error once per session).
//
// Both are saved to Firestore support_reports/{id} (works offline in the tech
// app; it sends when signal returns). A Google Apps Script on XSite's account
// (tools/report-mailer) emails new reports to the XSite support team every few
// minutes and marks them emailed. Rules: any signed-in person can create a
// report signed as themselves; only owners can read them in the app.

const FS_URL = "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";
const DEMO = /[?&]demo=1/.test(location.search);
const APP = /tech\.html$/i.test(location.pathname) ? "tech" : "portal";
const MAX_AUTO = 5;            // automatic error reports per page load
let autoSent = 0;

async function fire() {
  const [fs, fb] = await Promise.all([import(FS_URL), import("./ap-firebase.js")]);
  return { fs, fb };
}
function session() {
  try { return (typeof apGetSession === "function" && apGetSession()) || null; } catch (e) { return null; }
}
// Where the person was, without anything personal from the address bar.
function pageInfo() {
  const hash = location.hash.replace(/email=[^&]*/i, "email=…");
  return location.pathname.split("/").pop() + location.search + hash;
}
function device() {
  return { ua: navigator.userAgent.slice(0, 300), screen: innerWidth + "x" + innerHeight, online: navigator.onLine, app: APP };
}

async function save(rec) {
  const { fs, fb } = await fire();
  const user = fb.auth.currentUser || (await fb.currentUser());
  if (!user || !user.email) throw new Error("not signed in");
  const s = session() || {};
  const doc = {
    kind: rec.kind, message: String(rec.message || "").slice(0, 4900),
    page: pageInfo(), title: document.title.slice(0, 200),
    by: user.email.toLowerCase(), byName: s.name || user.email,
    at: new Date().toISOString(), ...device(),
    emailed: false, createdAt: fs.serverTimestamp(),
  };
  if (rec.error) doc.error = rec.error;
  if (rec.photo) doc.photo = rec.photo;
  // In the tech app the write is queued offline and sent when signal returns, so don't wait on the server.
  const p = fs.addDoc(fs.collection(fb.db, "support_reports"), doc);
  return APP === "tech" && !navigator.onLine ? "queued" : (await p, "sent");
}

// ── Automatic error reports ──
function autoReport(message, error) {
  if (DEMO || autoSent >= MAX_AUTO || !session()) return;
  const msg = String(message || "").slice(0, 500);
  if (!msg || /ResizeObserver loop|^Script error\.?$|extension:\/\/|Load failed$/i.test(msg + " " + ((error && error.source) || ""))) return;
  const key = "ap_err_" + (msg + (error && error.source || "")).slice(0, 120);
  try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, "1"); } catch (e) {}
  autoSent++;
  save({ kind: "error", message: msg, error }).catch(() => { /* reporting must never cause more errors */ });
}
window.addEventListener("error", e => {
  if (!e.message && e.target && e.target !== window) return; // a missing image etc., not a code error
  autoReport(e.message, { source: String(e.filename || "").split("/").pop().slice(0, 200), line: e.lineno || 0, col: e.colno || 0, stack: String((e.error && e.error.stack) || "").slice(0, 3000) });
});
window.addEventListener("unhandledrejection", e => {
  const r = e.reason;
  const code = r && r.code ? String(r.code) : "";
  if (/unavailable|network-request-failed|failed-precondition/i.test(code)) return; // no signal: expected in the field
  autoReport((code ? code + ": " : "") + (r && r.message ? r.message : String(r)), { source: "promise", line: 0, col: 0, stack: String((r && r.stack) || "").slice(0, 3000) });
});

// ── Report a problem (the form) ──
const CSS = `
#ap-rep{position:fixed;inset:0;z-index:2000;background:rgba(10,42,48,.5);display:none;align-items:center;justify-content:center;padding:14px;font-family:Inter,-apple-system,"Segoe UI",Roboto,sans-serif}
#ap-rep.on{display:flex}
#ap-rep .card{background:#fff;color:#10444E;border-radius:16px;width:100%;max-width:440px;max-height:calc(100vh - 28px);overflow:auto;padding:20px 20px 16px;box-shadow:0 20px 50px rgba(0,0,0,.3)}
#ap-rep h2{font:600 1.25rem Oswald,sans-serif;letter-spacing:.02em;margin:0 0 4px}
#ap-rep p.sub{margin:0 0 12px;font-size:.85rem;color:#5A7A80;line-height:1.4}
#ap-rep textarea{width:100%;box-sizing:border-box;min-height:120px;border:1px solid rgba(16,68,78,.25);border-radius:10px;padding:10px;font:inherit;font-size:1rem;color:inherit;resize:vertical}
#ap-rep textarea:focus{outline:2px solid #3D818A;border-color:transparent}
#ap-rep .ph{margin:10px 0 4px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:.85rem}
#ap-rep .ph label{border:1px dashed rgba(16,68,78,.35);border-radius:10px;padding:8px 12px;cursor:pointer;color:#27636C;font-weight:600}
#ap-rep .ph input{display:none}
#ap-rep .ph img{height:54px;border-radius:6px;border:1px solid rgba(16,68,78,.15)}
#ap-rep .ph .x{border:0;background:none;color:#B83227;cursor:pointer;font-size:.8rem;text-decoration:underline}
#ap-rep .auto{font-size:.75rem;color:#5A7A80;margin:8px 0 12px;line-height:1.4}
#ap-rep .btns{display:flex;gap:8px;justify-content:flex-end}
#ap-rep button.b{font:600 .8rem Oswald,sans-serif;letter-spacing:.06em;text-transform:uppercase;border-radius:8px;padding:10px 16px;cursor:pointer;border:1px solid #27636C}
#ap-rep button.go{background:#27636C;color:#fff}
#ap-rep button.no{background:#fff;color:#27636C}
#ap-rep button:disabled{opacity:.55;cursor:default}
#ap-rep .msg{font-size:.85rem;margin-top:10px;min-height:1.1em}
#ap-rep .msg.bad{color:#B83227}
#ap-rep .msg.ok{color:#2E7D57}`;

let box = null, photo = null;
function build() {
  if (box) return box;
  const st = document.createElement("style"); st.textContent = CSS; document.head.appendChild(st);
  box = document.createElement("div"); box.id = "ap-rep";
  box.innerHTML = `<div class="card" role="dialog" aria-modal="true" aria-labelledby="ap-rep-h">
    <h2 id="ap-rep-h">Report a problem</h2>
    <p class="sub">Tell us what happened or what you expected. It goes straight to the Basecamp support team at XSite.</p>
    <textarea id="ap-rep-t" placeholder="e.g. I tapped Complete visit and nothing happened. Job SA1024-3."></textarea>
    <div class="ph"><label>📷 Add a screenshot or photo<input type="file" id="ap-rep-f" accept="image/*"></label><span id="ap-rep-p"></span></div>
    <div class="auto" id="ap-rep-a"></div>
    <div class="btns"><button class="b no" type="button" id="ap-rep-c">Cancel</button><button class="b go" type="button" id="ap-rep-s">Send</button></div>
    <div class="msg" id="ap-rep-m"></div></div>`;
  document.body.appendChild(box);
  const $ = id => box.querySelector("#" + id);
  const close = () => box.classList.remove("on");
  $("ap-rep-c").onclick = close;
  box.addEventListener("click", e => { if (e.target === box) close(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && box.classList.contains("on")) close(); });
  $("ap-rep-f").onchange = async e => {
    const f = e.target.files && e.target.files[0]; e.target.value = "";
    if (!f) return;
    try { photo = await shrink(f); $("ap-rep-p").innerHTML = `<img src="data:image/jpeg;base64,${photo}" alt="Attached"> <button class="x" type="button" id="ap-rep-x">Remove</button>`; $("ap-rep-x").onclick = () => { photo = null; $("ap-rep-p").innerHTML = ""; }; }
    catch (err) { msg("That picture couldn't be attached. Try a different one.", true); }
  };
  $("ap-rep-s").onclick = async () => {
    const text = $("ap-rep-t").value.trim();
    if (!text) { msg("Write a line or two about what went wrong.", true); $("ap-rep-t").focus(); return; }
    if (DEMO) { msg("Demo mode: in the real app this goes to the XSite support team.", false); return; }
    $("ap-rep-s").disabled = true; msg("Sending…");
    try {
      const r = await save({ kind: "report", message: text, photo });
      msg(r === "queued" ? "Saved. It sends as soon as you have signal." : "Sent. Thanks, we'll take a look.", false, true);
      $("ap-rep-t").value = ""; photo = null; $("ap-rep-p").innerHTML = "";
      setTimeout(close, 1800);
    } catch (e) {
      msg("Couldn't send (" + ((e && e.code) || (e && e.message) || e) + "). Please text or call XSite instead.", true);
    } finally { $("ap-rep-s").disabled = false; }
  };
  function msg(t, bad, ok) { const m = $("ap-rep-m"); m.textContent = t; m.className = "msg" + (bad ? " bad" : ok ? " ok" : ""); }
  return box;
}
async function shrink(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    for (const [max, q] of [[1400, 0.7], [1100, 0.6], [900, 0.55]]) {
      const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas"); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      const data = c.toDataURL("image/jpeg", q).split(",")[1];
      if (data.length < 700000) return data;
    }
    throw new Error("too big");
  } finally { URL.revokeObjectURL(url); }
}
function open(prefill) {
  const b = build();
  const s = session() || {};
  b.querySelector("#ap-rep-a").textContent = `Sent with it: ${s.name || "you"}, this page (${document.title || pageInfo()}), the time, and your ${/iPhone|iPad|Android/i.test(navigator.userAgent) ? "phone" : "browser"} type.`;
  b.querySelector("#ap-rep-m").textContent = "";
  if (prefill) b.querySelector("#ap-rep-t").value = prefill;
  b.classList.add("on");
  setTimeout(() => b.querySelector("#ap-rep-t").focus(), 50);
}

window.apReport = { open };
document.dispatchEvent(new Event("ap-report-ready"));
