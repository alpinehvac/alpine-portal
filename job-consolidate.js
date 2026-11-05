// ── Alpine HVAC — one job report per piece of work ───────────────────
// BuildOps lets the same work land on more than one record: a repair found on a Q3 maintenance can be
// logged as a visit on the Q4 record, with the invoice left on Q3. This file rolls those records into one
// report and lists what needs a person's eye. Used by job.html; pure functions, no page or database access.
//   apConsolidate(openedId, records) -> { primary, linked, J, C, review }
//     records: { "SA1026-2": { detail, costs }, ... } the opened record and its agreement siblings
//     review:  [{ sev: "fix" | "check", text }]
// Corrections people make (detail.fix) live on the record and are re-applied over every BuildOps read:
//   fix = { note, by, at, assetBySerial: {serial: name}, visitText: {visitId: text}, replace: [[from, to]] }
(function (root) {
  const DONE = /complete|converted|closed/i;
  const ROUTINE = /\bq[1-4]\b|maint|\bpm\b|prevent|quarterly|monthly|annual|comprehensive|start.?up|shut.?down|seasonal/i;
  const WINDOW = 14; // days: a follow-up visit this close to a completed visit is the same piece of work
  const agreementOf = id => (String(id).match(/^(SA\d+)-\d+$/) || [])[1] || "";
  const days = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) / 864e5;
  const done = v => DONE.test(v.status || "");
  const short = s => { const d = new Date(String(s) + "T12:00:00"); return isNaN(d) ? "no date" : d.toLocaleDateString("en-CA", { month: "short", day: "numeric" }); };
  const assetsOverlap = (a, b) => { const x = a.assets || [], y = b.assets || []; return !x.length || !y.length || x.some(n => y.includes(n)); };
  const samePlace = (a, b) => (a.property || "") === (b.property || "") && (a.customer || "") === (b.customer || "");

  // v (on another record) is a follow-up to a completed visit here: same site, close in time, shared equipment, not routine work.
  function followUpOf(v, d) {
    if (!done(v) || !v.date || ROUTINE.test(v.desc || "")) return null;
    return (d.visits || []).find(p => done(p) && p.date && p.id !== v.id && ROUTINE.test(p.desc || "") && days(p.date, v.date) <= WINDOW && assetsOverlap(p, v)) || null;
  }
  function pickPrimary(openedId, records) {
    const open = records[openedId].detail, ag = agreementOf(openedId);
    if (!ag) return openedId;
    for (const v of open.visits || []) for (const [id, r] of Object.entries(records)) {
      if (id !== openedId && agreementOf(id) === ag && samePlace(r.detail, open) && followUpOf(v, r.detail)) return id;
    }
    return openedId;
  }

  function applyFix(J, C) {
    const fix = J.fix; if (!fix) return;
    const names = {}; // old name -> corrected name, from each unit's serial number, so it stays right if BuildOps is corrected later
    (J.assets || []).forEach(a => { const n = (fix.assetBySerial || {})[a.serial]; if (n) { names[a.name] = n; a.name = n; } });
    const rename = list => (list || []).map(n => names[n] || n);
    const swap = s => (fix.replace || []).reduce((t, [a, b]) => t.split(a).join(b), s || "");
    (J.visits || []).forEach(v => {
      v.assets = rename(v.assets);
      const text = (fix.visitText || {})[v.id];
      if (text) v.summaries = [{ text, by: fix.by || "", at: fix.at || "" }];
      else v.summaries = (v.summaries || []).map(s => ({ ...s, text: swap(s.text) }));
      (v.parts || []).forEach(p => { p.name = swap(p.name); p.desc = swap(p.desc); });
    });
    (J.schedule || []).forEach(v => { v.assets = rename(v.assets); });
    (J.invoiceItems || []).forEach(m => { m.name = swap(m.name); m.desc = swap(m.desc); });
    (J.materials || []).forEach(m => { m.name = swap(m.name); m.desc = swap(m.desc); });
    (J.invoices || []).forEach(i => { i.summary = swap(i.summary); });
    if (C) (C.invoices || []).forEach(i => { i.summary = swap(i.summary); if (i.lines) (i.lines.parts || []).forEach(p => { p.desc = swap(p.desc); }); });
    J.fixNote = fix.note || "";
    if (J.fixNote && (J.issue || "").includes(J.fixNote)) J.issue = J.issue.replace(J.fixNote, "").trim();
  }

  function apConsolidate(openedId, records) {
    const primary = pickPrimary(openedId, records);
    const base = records[primary], ag = agreementOf(primary);
    const J = JSON.parse(JSON.stringify(base.detail));
    const C = base.costs ? JSON.parse(JSON.stringify(base.costs)) : null;
    const review = [], linked = [];
    const have = new Set((J.visits || []).map(v => v.id));
    const others = Object.entries(records).filter(([id, r]) => id !== primary && ag && agreementOf(id) === ag && samePlace(r.detail, J));
    J.schedule = (J.schedule || []).map(s => ({ ...s, record: primary }));

    for (const [id, r] of others) {
      const pulled = (r.detail.visits || []).filter(v => followUpOf(v, J));
      if (!pulled.length) {
        // Not follow-up work, but completed routine visits this close on the same equipment are worth a look.
        (r.detail.visits || []).filter(v => done(v) && v.date).forEach(v => {
          const p = (J.visits || []).find(x => done(x) && x.date && days(x.date, v.date) <= WINDOW && (v.assets || []).length && (x.assets || []).length && assetsOverlap(x, v));
          if (p) review.push({ sev: "check", text: `Possible duplicate visit: ${short(v.date)} "${v.desc || "Visit"}" on ${id} and ${short(p.date)} "${p.desc || "Visit"}" here cover the same equipment.` });
        });
        continue;
      }
      linked.push(id);
      (r.detail.schedule || []).forEach(s => { J.schedule.push({ ...s, record: id }); });
      for (const v of pulled) {
        review.push({ sev: "check", text: `${short(v.date)} visit "${v.desc || "Visit"}" was logged on ${id} and is included in this report.` });
        if (have.has(v.id)) continue;
        have.add(v.id);
        J.visits.push({ ...JSON.parse(JSON.stringify(v)), fromRecord: id });
        if (C && r.costs) {
          const mine = x => x.visit === v.n || new RegExp("Visit\\s+" + v.n + "\\b").test(x.source || "");
          ["labour", "inventory", "purchased", "fieldPOs", "receipts"].forEach(k => { C[k] = (C[k] || []).concat((r.costs[k] || []).filter(mine)); });
        }
      }
      if (C && r.costs) {
        const invKey = i => String(i.no || i.doc || "").replace(/\D/g, "");
        ["invoices", "qbInvoices"].forEach(k => { const seen = new Set((C[k] || []).map(invKey)); (r.costs[k] || []).forEach(i => { if (!seen.has(invKey(i))) { seen.add(invKey(i)); (C[k] = C[k] || []).push({ ...i, record: id }); } }); });
        const billKey = b => [b.vendor, b.doc, b.amount].join("|");
        const seen = new Set((C.bills || []).map(billKey)); (r.costs.bills || []).forEach(b => { if (!seen.has(billKey(b))) { seen.add(billKey(b)); (C.bills = C.bills || []).push(b); } });
        const em = new Set((C.emails || []).map(e => e.link || e.subject + e.date)); (r.costs.emails || []).forEach(e => { const k = e.link || e.subject + e.date; if (!em.has(k)) { em.add(k); (C.emails = C.emails || []).push(e); } });
      }
      J.invoices = (J.invoices || []).concat((r.detail.invoices || []).filter(i => !(J.invoices || []).some(x => x.no === i.no)));
    }
    J.visits = (J.visits || []).slice().sort((a, b) => (a.date || "").localeCompare(b.date || "") || (a.n || 0) - (b.n || 0));

    applyFix(J, C);

    // Same day, same equipment, same tech inside the report.
    J.visits.forEach((a, i) => J.visits.slice(i + 1).forEach(b => {
      if (a.date && a.date === b.date && a.tech === b.tech && (a.assets || []).length && (b.assets || []).length && assetsOverlap(a, b))
        review.push({ sev: "check", text: `Possible duplicate visit: two ${short(a.date)} visits by ${a.tech || "the same tech"} cover the same equipment ("${a.desc || "Visit"}", "${b.desc || "Visit"}").` });
    }));
    // Still booked on these records after the work was done.
    const lastDone = J.visits.filter(done).map(v => v.date).sort().pop();
    (J.schedule || []).filter(s => !done(s) && !/cancel/i.test(s.status || "") && s.date && lastDone && s.date > lastDone && (linked.includes(s.record) || s.record === primary) && !have.has(s.record + "-" + s.n))
      .forEach(s => review.push({ sev: "check", text: `Still scheduled: ${short(s.date)} "${s.desc || "Visit"}" on ${s.record}${s.tech ? " with " + s.tech : ""}. Confirm it isn't repeating work done on this report.` }));
    // Billing and close-out.
    const inv = C ? (C.invoices || []) : [];
    inv.filter(i => i.lines && !i.visits && !/void/i.test(i.status || "")).forEach(i => review.push({ sev: "check", text: `${i.no} doesn't list which visits it covers in BuildOps.` }));
    const billed = inv.filter(i => i.lines && (i.lines.labour || []).length && !/void/i.test(i.status || ""));
    if (billed.length) {
      const logged = (J.visits || []).reduce((s, v) => s + (v.labour || []).reduce((t, l) => t + (l.hrs || 0), 0), 0);
      const charged = billed.reduce((s, i) => s + i.lines.labour.reduce((t, l) => t + (l.hrs || 0), 0), 0);
      if (Math.abs(logged - charged) > 0.01) review.push({ sev: "fix", text: `Hours: ${logged} logged by techs, ${charged} billed on ${billed.map(i => i.no).join(", ")}.` });
    }
    (J.visits || []).filter(v => done(v) && /needed/i.test(v.review || "")).forEach(v => review.push({ sev: "check", text: `${short(v.date)} visit still shows Review Needed in BuildOps.` }));
    (J.visits || []).filter(v => done(v) && !(v.summaries || []).length).forEach(v => review.push({ sev: "fix", text: `${short(v.date)} visit has no tech summary.` }));
    (J.visits || []).filter(v => done(v) && (v.labour || []).length === 0 && (v.others || []).length + (v.tech ? 1 : 0) > 0).forEach(v => review.push({ sev: "check", text: `${short(v.date)} visit has no hours logged.` }));
    const open = (J.visits || []).flatMap(v => v.tasks || []).concat(J.jobTasks || []).filter(t => !t.completedBy).length;
    if (open) review.push({ sev: "check", text: `${open} task${open > 1 ? "s" : ""} or form${open > 1 ? "s" : ""} not completed in BuildOps.` });
    if (J.fix) { const seen = new Set(); (J.fix.open || []).forEach(t => { if (!seen.has(t)) { seen.add(t); review.push({ sev: "fix", text: t }); } }); }
    return { primary, linked, J, C, review };
  }
  root.apConsolidate = apConsolidate;
  root.apAgreementOf = agreementOf;
  if (typeof module !== "undefined" && module.exports) module.exports = { apConsolidate, agreementOf };
})(typeof window !== "undefined" ? window : globalThis);
