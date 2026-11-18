/* BASECAMP API: the side door for Jake's Claude (and any other tool an owner issues a key to).
 *
 * One Cloud Function, "api". Every call needs:   Authorization: Bearer alp_<keyId>_<secret>
 * Keys are made, rotated and switched off on Users & Settings (owners only). Only a SHA-256 hash of the
 * key is stored in api_keys/{keyId}; the key itself is shown once when it's made and never again.
 *
 * What a key can do is limited to the scopes ticked when it was made:
 *   GET  /whoami                 any valid key: its name and scopes (use it to test the key)
 *   GET  /context                context:read    Business Context log (portal_context/log). ?since=YYYY-MM-DD
 *   POST /context                context:append  add entries to the log; never edits or removes existing ones
 *   GET  /cash                   cash:read       Financial Position data (cash_dashboard/latest)
 *   PUT  /cash                   cash:write      replace it (same checks as the page: asOf, 13 weeks, accounts)
 *   GET  /profit                 profit:read     the Profit Position part of that data (profit + profitMix)
 *   PUT  /profit                 profit:write    replace just profit (and profitMix if sent); cash numbers untouched
 *   GET  /ops                    ops:read        Field Operations data (ops_dashboard/latest)
 *   PUT  /ops                    ops:write       replace it (same checks as the page: asOf, jobs, visits)
 *
 * Every call that changes something, and every refused call, is written to api_audit (owners can read it on
 * Users & Settings). Nothing here can read customers, quotes, visits, users or settings.
 * Uses the Admin SDK, so the Firestore rules don't apply here: the scope checks below are the guard.
 */
const { onRequest } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const crypto = require("crypto");

initializeApp();
const db = getFirestore();

const MAX_DOC = 900 * 1024;            // Firestore's limit is 1 MB per document; leave room for the other fields
const MAX_ENTRIES = 50;                // per POST /context
const AREAS = ["Operations", "Financial", "Personnel", "Customer"];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

class ApiError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const sha256 = s => crypto.createHash("sha256").update(s).digest("hex");
const str = (v, max) => typeof v === "string" && v.trim() && v.length <= max;

async function checkKey(req) {
  const m = /^Bearer\s+(alp_([a-f0-9]{10})_[A-Za-z0-9_-]{30,})\s*$/.exec(req.get("authorization") || "");
  if (!m) throw new ApiError(401, "Missing or malformed key. Send: Authorization: Bearer alp_...");
  const snap = await db.collection("api_keys").doc(m[2]).get();
  if (!snap.exists) throw new ApiError(401, "Unknown key.");
  const k = snap.data();
  const a = Buffer.from(sha256(m[1]), "hex"), b = Buffer.from(String(k.hash || ""), "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new ApiError(401, "Unknown key.");
  if (k.revoked) throw new ApiError(401, "This key has been switched off.");
  return { id: snap.id, name: k.name || snap.id, scopes: Array.isArray(k.scopes) ? k.scopes : [] };
}
const need = (key, scope) => { if (!key.scopes.includes(scope)) throw new ApiError(403, "This key isn't allowed to " + scope.replace(":", " ") + "."); };

function body(req) {
  const b = req.body;
  if (!b || typeof b !== "object") throw new ApiError(400, "Send JSON with Content-Type: application/json.");
  return b;
}
function sized(json) {
  if (Buffer.byteLength(json) > MAX_DOC) throw new ApiError(413, "Too big: Basecamp stores up to about 900 KB per dashboard.");
  return json;
}
async function latest(col) {
  const s = await db.collection(col).doc("latest").get();
  if (!s.exists) throw new ApiError(404, "Nothing saved yet.");
  const d = s.data();
  return { data: JSON.parse(d.json), asOf: d.asOf, updatedAt: d.updatedAt ? d.updatedAt.toDate().toISOString() : null, updatedBy: d.updatedBy || "" };
}
// Same record shape the dashboard pages save, so the pages can't tell the difference.
async function saveDash(col, d, key) {
  const rec = { json: sized(JSON.stringify(d)), asOf: d.asOf, updatedAt: FieldValue.serverTimestamp(), updatedBy: "api: " + key.name };
  const b = db.batch();
  b.set(db.collection(col).doc("latest"), rec);
  b.set(db.collection(col + "_history").doc(d.asOf), rec);
  await b.commit();
}

function checkCash(d) {
  if (!str(d.asOf, 10) || !DAY.test(d.asOf)) throw new ApiError(422, "asOf must be a date like 2026-11-18.");
  if (!Array.isArray(d.weeks) || d.weeks.length !== 13) throw new ApiError(422, "weeks must be a list of exactly 13.");
  if (!d.accounts || typeof d.accounts !== "object") throw new ApiError(422, "accounts is missing.");
}
function checkOps(d) {
  if (!str(d.asOf, 10) || !DAY.test(d.asOf)) throw new ApiError(422, "asOf must be a date like 2026-11-18.");
  if (!Array.isArray(d.jobs) || !Array.isArray(d.visits)) throw new ApiError(422, "jobs and visits must both be lists.");
}
function cleanEntry(n, i, key, today) {
  const at = "Entry " + (i + 1) + ": ";
  if (!n || typeof n !== "object") throw new ApiError(422, at + "must be an object.");
  if (!str(n.change, 2000)) throw new ApiError(422, at + "change is required (up to 2000 characters).");
  const area = n.area == null ? "Operations" : n.area;
  if (!AREAS.includes(area)) throw new ApiError(422, at + "area must be one of " + AREAS.join(", ") + ".");
  const appliesTo = n.appliesTo == null ? [] : n.appliesTo;
  if (!Array.isArray(appliesTo) || appliesTo.some(a => a !== "cash" && a !== "ops")) throw new ApiError(422, at + 'appliesTo can only hold "cash" and "ops".');
  for (const f of ["date", "effective"]) if (n[f] != null && !(typeof n[f] === "string" && DAY.test(n[f]))) throw new ApiError(422, at + f + " must be a date like 2026-11-18.");
  for (const f of ["job", "impact"]) if (n[f] != null && !str(n[f], 500)) throw new ApiError(422, at + f + " must be text up to 500 characters.");
  if (n.applied != null && typeof n.applied !== "boolean") throw new ApiError(422, at + "applied must be true or false.");
  return {
    id: "c-api-" + Date.now().toString(36) + crypto.randomBytes(3).toString("hex"),
    date: n.date || today, area, job: n.job || null, change: n.change.trim(), effective: n.effective || null,
    impact: n.impact || null, applied: n.applied !== false, appliesTo: [...new Set(appliesTo)], source: key.name,
  };
}

async function route(req, key) {
  const path = (req.path || "/").replace(/\/+$/, "") || "/", M = req.method;
  if (M === "GET" && path === "/whoami") return { result: { key: key.name, scopes: key.scopes } };

  if (path === "/context") {
    const ref = db.collection("portal_context").doc("log");
    if (M === "GET") {
      need(key, "context:read");
      const s = await ref.get(), since = String(req.query.since || "");
      let entries = s.exists ? (s.data().entries || []) : [];
      if (DAY.test(since)) entries = entries.filter(e => (e.date || "") >= since);
      return { result: { entries } };
    }
    if (M === "POST") {
      need(key, "context:append");
      const b = body(req), list = Array.isArray(b) ? b : (Array.isArray(b.entries) ? b.entries : [b]);
      if (!list.length || list.length > MAX_ENTRIES) throw new ApiError(422, "Send 1 to " + MAX_ENTRIES + " entries.");
      const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Toronto" });
      const add = list.map((n, i) => cleanEntry(n, i, key, today));
      await db.runTransaction(async t => {
        const s = await t.get(ref), entries = (s.exists ? s.data().entries : null) || [];
        const next = entries.concat(add);
        sized(JSON.stringify(next));
        t.set(ref, { entries: next, updatedAt: FieldValue.serverTimestamp(), updatedBy: "api: " + key.name }, { merge: true });
      });
      return { status: 201, result: { added: add }, audit: add.length + " context entr" + (add.length === 1 ? "y" : "ies") + " added: " + add.map(e => e.change.slice(0, 60)).join(" | ") };
    }
  }

  if (path === "/cash") {
    if (M === "GET") { need(key, "cash:read"); return { result: await latest("cash_dashboard") }; }
    if (M === "PUT") {
      need(key, "cash:write");
      const d = body(req); checkCash(d);
      await saveDash("cash_dashboard", d, key);
      return { result: { saved: true, asOf: d.asOf }, audit: "Financial Position replaced, as of " + d.asOf };
    }
  }

  if (path === "/profit") {
    if (M === "GET") {
      need(key, "profit:read");
      const L = await latest("cash_dashboard");
      return { result: { asOf: L.asOf, updatedAt: L.updatedAt, updatedBy: L.updatedBy, profit: L.data.profit || null, profitMix: L.data.profitMix || null } };
    }
    if (M === "PUT") {
      need(key, "profit:write");
      const b = body(req);
      if (!b.profit || typeof b.profit !== "object" || Array.isArray(b.profit)) throw new ApiError(422, "profit must be an object.");
      if (b.profitMix != null && (typeof b.profitMix !== "object" || Array.isArray(b.profitMix))) throw new ApiError(422, "profitMix must be an object.");
      const L = await latest("cash_dashboard"), d = L.data;
      d.profit = b.profit; if (b.profitMix) d.profitMix = b.profitMix;
      await saveDash("cash_dashboard", d, key);
      return { result: { saved: true, asOf: d.asOf }, audit: "Profit Position replaced" + (b.profitMix ? " (with profitMix)" : "") + " on the " + d.asOf + " data" };
    }
  }

  if (path === "/ops") {
    if (M === "GET") { need(key, "ops:read"); return { result: await latest("ops_dashboard") }; }
    if (M === "PUT") {
      need(key, "ops:write");
      const d = body(req); checkOps(d);
      await saveDash("ops_dashboard", d, key);
      return { result: { saved: true, asOf: d.asOf }, audit: "Field Operations replaced, as of " + d.asOf + " (" + d.jobs.length + " jobs, " + d.visits.length + " visits)" };
    }
  }
  throw new ApiError(404, "No such address: " + M + " " + path);
}

function audit(key, req, status, summary) {
  return db.collection("api_audit").add({
    at: FieldValue.serverTimestamp(), keyId: key ? key.id : null, keyName: key ? key.name : null,
    method: req.method, path: req.path, status, summary: String(summary || "").slice(0, 500),
    ip: (req.get("x-forwarded-for") || req.ip || "").split(",")[0].trim(),
  }).catch(e => console.error("audit failed", e));
}

exports.api = onRequest({ region: "northamerica-northeast1", maxInstances: 3, memory: "256MiB", timeoutSeconds: 60 }, async (req, res) => {
  res.set("Cache-Control", "no-store");
  let key = null;
  try {
    key = await checkKey(req);
    const out = await route(req, key);
    if (out.audit) await audit(key, req, out.status || 200, out.audit);
    db.collection("api_keys").doc(key.id).update({ lastUsedAt: FieldValue.serverTimestamp() }).catch(() => {});
    res.status(out.status || 200).json(out.result);
  } catch (e) {
    const status = e instanceof ApiError ? e.status : 500;
    if (status === 500) console.error(e);
    const msg = status === 500 ? "Something went wrong on Basecamp's side." : e.message;
    if (req.method !== "GET" || status === 401 || status === 403) await audit(key, req, status, "Refused: " + msg);
    res.status(status).json({ error: msg });
  }
});
