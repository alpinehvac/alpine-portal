// ── Alpine HVAC Internal Portal — PO Numbers: Apple Notes parser ──────
// Turns the text of the shared "PO NUMBERS" Apple note (or its Archive note)
// into PO records for po-numbers.html. Works with the Markdown export
// (- [x] ==**TM00808 - …**==) and with plain text copied straight out of Notes.
// Used once to load the notes, and by the admin "Import from Apple Notes" panel.
// Contains no data itself.
(function (root) {
  "use strict";
  const TYPES = ["SA", "SC", "TM", "EQ", "M", "P"]; // longest first
  const PO_RE = /^(SA|SC|TM|EQ|M|P)?\s*(0\d{2,4})(-\d+)?(?![\d])\s*[-–—:]?\s*(.*)$/i;
  const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const ACRONYMS = new Set(["HCE", "YMCA", "WFS", "NFS", "BAS", "BIC", "NPSC", "RTU", "MUA", "PO", "SA", "JACE", "ERV"]);

  function clean(line) {
    return String(line || "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")          // markdown links: [00733- 34-50](tel:…)
      .replace(/^\s*[-*•]\s*\[[ xX]?\]\s*/, "")          // - [x] / - [ ]
      .replace(/^\s*[-*•]\s+/, "")                        // plain bullets
      .replace(/^#+\s*/, "")                               // ## headings
      .replace(/==|\*\*|\+\+|\*/g, "")                    // highlight, bold, underline, italics
      .replace(/[ \t]+/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
  }
  function titleCase(s) {
    return s.split(/\s+/).map(w => {
      const bare = w.replace(/[^A-Za-z]/g, "");
      if (!bare || /\d/.test(w) || ACRONYMS.has(bare.toUpperCase())) return w;
      if (w === w.toUpperCase()) return w.charAt(0) + w.slice(1).toLowerCase();
      return w;
    }).join(" ");
  }
  function sectionName(raw) {
    let s = raw.replace(/\bPO['’]?s\b/gi, "").replace(/\s{2,}/g, " ").replace(/[\s:-]+$/, "").trim();
    if (/^mic?s?cellaneous$/i.test(s)) return "Miscellaneous";
    if (/^service agreement$/i.test(s)) return "Service Agreements";
    return titleCase(s);
  }
  // Trailing ALL-CAPS status in brackets, e.g. "(IN THE WORKS)", moves to notes; names like "(1655101 Ontario Inc)" stay.
  function splitStatus(title) {
    const m = title.match(/^(.*?)\s*\(([^()]*)\)\s*$/);
    if (!m) return { title: title.replace(/\s*\($/, "").trim(), notes: "" };
    const inner = m[2], letters = inner.replace(/[^A-Za-z]/g, "");
    if (letters.length >= 4 && letters === letters.toUpperCase()) return { title: m[1].trim(), notes: inner.trim() };
    return { title: title.trim(), notes: "" };
  }
  const pad = n => String(n).padStart(5, "0");
  const keyOf = (num, sfx) => pad(num) + (sfx || "");

  // text: the note's text. mode: "main" (sections kept, spares under NEXT AVAILABLE skipped) or "archive".
  // Returns { sections: [{id,name,monthly,month}], pos: [{key,num,sfx,type,title,notes,section,status,imp}], skipped: [...] }
  function parse(text, mode) {
    const archive = mode === "archive";
    const lines = String(text || "").split(/\r?\n/);
    const sections = [], byKey = {}, pos = [], skipped = [];
    let cur = null, spares = false, group = [];
    const addSection = raw => {
      const monthly = /monthly/i.test(raw);
      let month = "";
      if (monthly) { const mi = MONTH_NAMES.findIndex(n => new RegExp("\\b" + n + "\\b", "i").test(raw)); if (mi >= 0) month = MONTHS[mi]; }
      const name = monthly ? "Monthly Markland Maintenance Parts" : sectionName(raw);
      if (!name) return;
      const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      let s = sections.find(x => x.id === id);
      if (!s) { s = { id, name, monthly, month }; sections.push(s); }
      cur = s; spares = false; group = [];
    };
    lines.forEach(raw => {
      const line = clean(raw);
      if (!line || line.length < 3) return;
      if (/^PO NUMBERS/i.test(line)) return;                       // note title
      if (/\(start with /i.test(line)) return;                    // type legend at the bottom
      if (/^next available/i.test(line)) { spares = true; return; }
      const sd = line.match(/^approximate start date\s*:?\s*(.*)$/i);
      if (sd) { const v = sd[1].replace(/\?/g, "").trim(); if (v) group.forEach(p => { p.notes = [p.notes, "Approx. start: " + v].filter(Boolean).join(" · "); }); group = []; return; }
      const m = line.match(PO_RE);
      if (m && (m[1] || /^0/.test(m[2]))) {
        if (spares && !archive) { skipped.push(line); return; }
        const type = (m[1] || "").toUpperCase(), num = parseInt(m[2], 10), sfx = m[3] || "";
        const st = splitStatus(m[4] || "");
        const key = keyOf(num, sfx);
        if (byKey[key]) {                                          // listed twice (e.g. a 50% billing line): keep one, note the other
          const p = byKey[key];
          if (st.title && st.title !== p.title) p.notes = [p.notes, "Also listed as: " + st.title].filter(Boolean).join(" · ");
          return;
        }
        const p = { key, num, sfx, type, title: st.title, notes: st.notes, section: archive ? "" : (cur ? cur.id : "miscellaneous"), status: archive ? "archived" : "active", imp: pos.length };
        byKey[key] = p; pos.push(p); group.push(p);
        return;
      }
      if (archive) { skipped.push(line); return; }
      if (line.length <= 70) addSection(line); else skipped.push(line);
    });
    if (!archive && pos.some(p => p.section === "miscellaneous") && !sections.find(s => s.id === "miscellaneous")) sections.push({ id: "miscellaneous", name: "Miscellaneous", monthly: false, month: "" });
    return { sections, pos, skipped };
  }

  const api = { parse, pad, keyOf, TYPES, MONTHS, MONTH_NAMES };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.apPoParse = api;
})(typeof window !== "undefined" ? window : this);
