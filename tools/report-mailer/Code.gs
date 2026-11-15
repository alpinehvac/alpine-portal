// ── Basecamp report mailer (Google Apps Script) ──────────────────────
// Emails new "Report a problem" and automatic error reports from Firestore
// (support_reports) to the XSite support team, then marks each one emailed.
//
// Runs on a Google account that is a member of the Firebase project, so it
// reads Firestore as that member (no keys or passwords in this file).
//
// Setup (once):
//  1. script.google.com > New project, named "Basecamp report mailer".
//  2. Project Settings: tick "Show appsscript.json", then paste appsscript.json
//     from this folder over it. Paste this file over Code.gs.
//  3. Project Settings > Script properties > Add: REPORT_TO = the addresses to
//     email, separated by commas.
//  4. Run setup() once and allow access. It sends a test email and starts the
//     5-minute check.

const PROJECT = "alpine-hvac-portal";
const BASE = "https://firestore.googleapis.com/v1/projects/" + PROJECT + "/databases/(default)/documents";
const PORTAL = "https://basecamp.alpinehvac.ca/";

function setup() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("checkReports").timeBased().everyMinutes(5).create();
  MailApp.sendEmail({ to: recipients(), name: "Basecamp", subject: "Basecamp report mailer is on",
    htmlBody: "Problem reports and automatic error reports from Basecamp will arrive here within about 5 minutes." });
  checkReports();
}

function recipients() {
  const to = PropertiesService.getScriptProperties().getProperty("REPORT_TO");
  if (!to) throw new Error("Add the REPORT_TO script property first (Project Settings > Script properties).");
  return to;
}

function api(method, url, body) {
  const res = UrlFetchApp.fetch(url, {
    method: method, contentType: "application/json", muteHttpExceptions: true,
    headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
    payload: body ? JSON.stringify(body) : undefined,
  });
  if (res.getResponseCode() >= 300) throw new Error(method + " " + res.getResponseCode() + ": " + res.getContentText().slice(0, 500));
  return JSON.parse(res.getContentText() || "{}");
}

// Firestore REST values -> plain values.
function val(v) {
  if (!v) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("nullValue" in v) return null;
  if ("mapValue" in v) { const o = {}; Object.keys(v.mapValue.fields || {}).forEach(k => o[k] = val(v.mapValue.fields[k])); return o; }
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(val);
  return null;
}

function checkReports() {
  const to = recipients();
  const rows = api("post", BASE + ":runQuery", { structuredQuery: {
    from: [{ collectionId: "support_reports" }],
    where: { fieldFilter: { field: { fieldPath: "emailed" }, op: "EQUAL", value: { booleanValue: false } } },
    limit: 40 } });
  const docs = rows.filter(r => r.document).map(r => {
    const f = {}; Object.keys(r.document.fields || {}).forEach(k => f[k] = val(r.document.fields[k]));
    f._name = r.document.name; return f;
  });
  if (!docs.length) return;

  // A person's report: one email each, with their screenshot attached. Reply goes to them.
  docs.filter(d => d.kind === "report").forEach(d => {
    const att = d.photo ? [Utilities.newBlob(Utilities.base64Decode(d.photo), "image/jpeg", "screenshot.jpg")] : [];
    MailApp.sendEmail({ to: to, name: "Basecamp", replyTo: d.by || "",
      subject: "Basecamp problem: " + (d.byName || d.by) + " on " + (d.title || d.page),
      htmlBody: "<p style='font-size:15px;white-space:pre-wrap'>" + esc(d.message) + "</p>" + details(d) + (att.length ? "<p>Screenshot attached.</p>" : ""),
      attachments: att });
    markEmailed(d);
  });

  // Errors caught automatically: one digest per run, so a bad push can't flood the inbox.
  const errs = docs.filter(d => d.kind === "error");
  if (errs.length) {
    MailApp.sendEmail({ to: to, name: "Basecamp",
      subject: "Basecamp: " + errs.length + " error" + (errs.length > 1 ? "s" : "") + " caught automatically",
      htmlBody: errs.map(d => "<hr><p><b>" + esc(d.message) + "</b></p>" + details(d)
        + (d.error && d.error.stack ? "<pre style='font-size:11px;white-space:pre-wrap;color:#555'>" + esc(d.error.stack) + "</pre>" : "")).join("") });
    errs.forEach(markEmailed);
  }
}

function details(d) {
  const when = d.at ? Utilities.formatDate(new Date(d.at), "America/Toronto", "EEE MMM d, h:mm a") : "";
  const row = (k, v) => v ? "<tr><td style='color:#666;padding:2px 10px 2px 0'>" + k + "</td><td>" + esc(String(v)) + "</td></tr>" : "";
  return "<table style='font-size:13px'>"
    + row("Who", (d.byName || "") + " (" + (d.by || "") + ")") + row("When", when)
    + row("Page", d.page) + (d.page ? "<tr><td></td><td><a href='" + PORTAL + esc(d.page) + "'>Open the page</a></td></tr>" : "")
    + row("App", d.app) + row("Online", d.online === false ? "No (sent when signal returned)" : "Yes")
    + row("Screen", d.screen) + row("Device", d.ua)
    + (d.error ? row("Where", (d.error.source || "") + (d.error.line ? " line " + d.error.line : "")) : "")
    + "</table>";
}

function markEmailed(d) {
  api("patch", "https://firestore.googleapis.com/v1/" + d._name + "?updateMask.fieldPaths=emailed&updateMask.fieldPaths=emailedAt",
    { fields: { emailed: { booleanValue: true }, emailedAt: { timestampValue: new Date().toISOString() } } });
}

function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
