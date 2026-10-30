// ── Alpine HVAC — BuildOps customer contacts reader (read-only) ──────
// Run in a logged-in live.buildops.com tab (Claude in Chrome: javascript_exec):
//   1. paste this file's contents once (defines window.alpineContacts)
//   2. alpineContacts.start([{ sa: "SA1024", bo: "<service agreement BuildOps id>" }, ...])
//      (the ids come from Account Management: apAccountReports.agreementIds())
//   3. poll alpineContacts.status() until running is false, then JSON.stringify(alpineContacts.result())
//
// For each agreement it opens /serviceAgreement/view/<bo> only to find the customer link, then
// /customer/view/<id>?tab=contacts and reads the Contacts grid: Name, Role, Email, Landline,
// Mobile phone, Best contact. The Notes column is never read (it can hold site access details).
// Safety: never clicks Save/Edit/Delete/Add/Create; navigation only.
(() => {
let sleep;
try {
  const w = new Worker(URL.createObjectURL(new Blob(["onmessage=e=>setTimeout(()=>postMessage(e.data[0]),e.data[1])"], { type: "text/javascript" })));
  const pend = new Map(); let seq = 0;
  w.onmessage = e => { const r = pend.get(e.data); pend.delete(e.data); if (r) r(); };
  sleep = ms => new Promise(r => { const id = ++seq; pend.set(id, r); w.postMessage([id, ms]); });
} catch (e) { sleep = ms => new Promise(r => setTimeout(r, ms)); }
const clean = s => (!s || s === "-") ? "" : String(s).trim();
function nav(path) { history.pushState({}, "", path); window.dispatchEvent(new PopStateEvent("popstate", { state: {} })); }
async function waitFor(fn, max) { const t0 = Date.now(); while (Date.now() - t0 < (max || 20000)) { await sleep(400); try { if (fn()) { await sleep(700); return true; } } catch (e) {} } return false; }
const S = { running: false, queue: [], out: {}, errors: [] };

async function readOne(a) {
  nav("/serviceAgreement/view/" + a.bo);
  const okA = await waitFor(() => document.querySelector("main a[href^='/customer/view/']"));
  if (!okA) throw new Error("agreement page did not load");
  const link = document.querySelector("main a[href^='/customer/view/']");
  const cid = link.getAttribute("href").split("/").pop().split("?")[0];
  const customer = link.innerText.trim();
  if (S.out[cid]) { S.out[cid].sas.push(a.sa); return; }
  nav("/customer/view/" + cid + "?tab=contacts");
  await waitFor(() => [...document.querySelectorAll("[role=columnheader], th")].some(h => h.innerText.trim() === "Email"), 15000);
  const contacts = [];
  const grids = [...document.querySelectorAll("table,[role=grid]")];
  for (const g of grids) {
    const H = [...g.querySelectorAll("[role=columnheader], th")].map(h => h.innerText.trim());
    if (!H.includes("Email") || !H.includes("Name")) continue;
    [...g.querySelectorAll("[role=row],tr")].forEach(r => {
      const c = [...r.querySelectorAll("[role=cell],[role=gridcell],td")].map(x => x.innerText.trim());
      if (!c.length) return;
      const row = {}; H.forEach((h, i) => { if (h !== "Notes") row[h] = clean(c[i]); });
      if (row.Name) contacts.push({ name: row.Name, role: row.Role || "", email: (row.Email || "").toLowerCase(), phone: row.Landline || "", mobile: row["Mobile phone"] || "", best: row["Best contact"] || "" });
    });
  }
  S.out[cid] = { customerId: cid, customer, sas: [a.sa], contacts, url: "https://live.buildops.com/customer/view/" + cid + "?tab=contacts" };
}

window.alpineContacts = {
  start(list) {
    if (S.running) return "already running";
    S.queue = (list || []).filter(a => a && a.bo); S.errors = []; S.running = true;
    (async () => {
      while (S.queue.length) {
        const a = S.queue.shift();
        let ok = false;
        for (let t = 0; t < 2 && !ok; t++) { try { await readOne(a); ok = true; } catch (e) { if (t) S.errors.push(a.sa + ": " + e.message); await sleep(1200); } }
      }
      S.running = false;
    })();
    return "started " + S.queue.length;
  },
  status() { return { running: S.running, left: S.queue.length, customers: Object.keys(S.out).length, errors: S.errors }; },
  result() { return Object.values(S.out); }
};
return "alpineContacts ready";
})()
