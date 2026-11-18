// ── Basecamp checklists (site forms) ─────────────────────────────────
// One library shared by the tech app (fill in on a visit), forms.html (office: list, preview, import)
// and checklist.html (the customer's read-only copy, print to PDF).
//
// Data (Firestore, see firestore.rules):
//   forms/{id}         a checklist: { name, site, entity, source: "buildops", boId, boUpdated, rows, images, active,
//                      importedAt, importedBy }. rows = [{ i: [item, item] }, { i: [item] }] (items side by side share
//                      a row). The database can't store a list inside a list, hence the { i: [...] }; rowsOf() reads
//                      either shape.
//                      item = { k (answer key), t, label?, html?, req?, lines?, img? }
//                      t: "h" section header · "text" text block · "img" picture · "check" tick box ·
//                         "short" one-line answer · "long" multi-line answer · "date" date ·
//                         "select" pick one of opts · "multi" tick any of opts (answer is a list) · "sign" signature
//   form_entries/{id}  a filled checklist on a visit: { formId, formName, formSite, visitId, jobNo, customer, site,
//                      address, tech, techName, answers {k: value}, status ("draft" | "done"), startedAt, doneAt,
//                      shareToken?, updatedAt }
//   form_shares/{token} the customer's copy: a snapshot of the form and the answers, readable by anyone with the
//                      link (get only, never listed). Rewritten whenever the entry is saved.
//
// BuildOps forms are copied as they are (convertBuildOps): same order, same wording, same layout.

export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// BuildOps uses these as placeholder labels under a text block that holds the real question.
const FILLER = /^(short answer text|response below|multi-?line text|text|long answer text)$/i;
export const isFiller = s => FILLER.test(String(s || "").trim());

// Keep only simple formatting from BuildOps text blocks.
export function cleanHtml(html) {
  const d = document.createElement("div");
  d.innerHTML = String(html || "");
  const ok = new Set(["P", "BR", "UL", "OL", "LI", "B", "STRONG", "I", "EM", "U", "H1", "H2", "H3", "H4", "SPAN", "DIV"]);
  const walk = n => {
    [...n.childNodes].forEach(c => {
      if (c.nodeType === 1) {
        if (/^(SCRIPT|STYLE|IFRAME|OBJECT|EMBED|TEMPLATE|NOSCRIPT)$/.test(c.tagName)) { c.remove(); return; }
        if (!ok.has(c.tagName)) { c.replaceWith(document.createTextNode(c.textContent)); return; }
        [...c.attributes].forEach(a => c.removeAttribute(a.name));
        walk(c);
      } else if (c.nodeType !== 3) c.remove();
    });
  };
  walk(d);
  return d.innerHTML.trim();
}
export const htmlText = html => { const d = document.createElement("div"); d.innerHTML = String(html || ""); return d.textContent.replace(/\s+/g, " ").trim(); };

// The rows of a form as lists of items, whichever shape they were saved in.
export const rowsOf = form => (form && form.rows || []).map(r => Array.isArray(r) ? r : (r && r.i) || []).filter(r => r.length);

// BuildOps form definition (formDefinitionJson) → Basecamp rows.
export function convertBuildOps(rec) {
  const def = rec.def || {};
  const layout = def.meta && def.meta[0] && def.meta[0].layouts && (def.meta[0].layouts.default || Object.values(def.meta[0].layouts)[0]);
  const rows = [];
  const map = { SectionHeader: "h", RichContentViewer: "text", ImageControl: "img", ReadOnlyCheckboxInput: "check", CheckboxInput: "check" };
  const toItem = n => {
    const c = (n.component && (n.component.default || n.component.edit)) || "", src = String(n.source || ""), o = n.options || {};
    const base = src.replace(/-\d+$/, "");
    let t = base === "multiple_options" ? "select" : base === "checkbox_list" ? "multi" : base === "signature" ? "sign" : map[c];
    if (!t && c === "FieldWithLabel") t = base === "date_picker" ? "date" : base === "multiline_text_item" ? "long" : base === "checkbox_item" ? "check" : "short";
    if (!t) t = base === "section_header" ? "h" : base === "text_block" ? "text" : base.includes("checkbox") ? "check" : base.includes("date") ? "date" : base.includes("multiline") ? "long" : base.includes("image") ? "img" : "short";
    const it = { k: src, t };
    if (t === "h") it.label = String(o.value || "").trim();
    else if (t === "text") it.html = cleanHtml(o.value);
    else if (t === "img") { it.img = (o.source || []).map(s => s.fileUrl).filter(Boolean); if (o.caption) it.label = o.caption; }
    else { it.label = String(o.label || "").trim(); if (o.isRequired) it.req = true;
      if (t === "select" || t === "multi") it.opts = String(o.inputOptions || "").split(",").map(x => x.trim()).filter(Boolean); if (t === "long" && o.lines) it.lines = o.lines; if (o.default_value) it.def = o.default_value; }
    return it;
  };
  // A layout node is a row (direction row) of columns; leaves carry a component.
  const leaves = n => { if (!n) return []; if (Array.isArray(n)) return n.flatMap(leaves); if (n.component) return [n]; return leaves(n.contents); };
  const top = (layout && layout.contents) || [];
  top.forEach(node => {
    if (node.component) { rows.push([toItem(node)]); return; }
    const cols = (node.contents || []).map(col => leaves(col)).filter(c => c.length);
    if (!cols.length) return;
    if (cols.length === 1) cols[0].forEach(l => rows.push([toItem(l)]));
    else {
      // Side by side: keep each column's items together, one row.
      const items = cols.map(c => c.map(toItem));
      if (items.every(c => c.length === 1)) rows.push(items.map(c => c[0]));
      else items.forEach(c => c.forEach(i => rows.push([i])));
    }
  });
  return {
    name: rec.name || "Untitled form", site: rec.description || "", entity: rec.entity || "Job",
    source: "buildops", boId: rec.id, boUpdated: rec.updated || null, createdBy: rec.createdBy || "",
    rows: rows.filter(r => r.some(i => i.t !== "text" || htmlText(i.html) || i.t === "img")).map(r => ({ i: r })),
    images: rec.images || {}, active: true
  };
  // (no undefined values: the database refuses them)
}

// Keys that hold answers, and how many are filled / ticked.
const ANSWER_TYPES = new Set(["check", "short", "long", "date", "select", "multi", "sign"]);
export const answerItems = form => rowsOf(form).flat().filter(i => ANSWER_TYPES.has(i.t));
const isFilled = (i, v) => i.t === "check" ? v === true : i.t === "multi" ? Array.isArray(v) && v.length > 0 : String(v ?? "").trim() !== "";
export function progress(form, answers) {
  const items = answerItems(form), a = answers || {};
  const filled = items.filter(i => isFilled(i, a[i.k])).length;
  const missing = items.filter(i => i.req && !isFilled(i, a[i.k]));
  return { filled, total: items.length, missing };
}
// Prefill on a new entry: technician name and today's date.
export function prefill(form, techName, today) {
  const a = {};
  answerItems(form).forEach(i => {
    if (i.t === "date") a[i.k] = today;
    else if (i.t === "short" && /technician|tech name/i.test(i.label || "")) a[i.k] = techName;
    else if (i.def) a[i.k] = i.def;
  });
  return a;
}

const imgSrc = (form, f) => (form.images && form.images[f]) || "";

// Fill-in HTML (tech app). Inputs carry data-k; read them back with readAnswers(root).
export function fillHtml(form, answers, locked) {
  const a = answers || {}, dis = locked ? " disabled" : "";
  const cell = i => {
    const lab = i.label && !isFiller(i.label) ? i.label : "";
    const req = i.req ? '<em class="cf-req">required</em>' : "";
    switch (i.t) {
      case "h": return `<div class="cf-h">${esc(i.label)}</div>`;
      case "text": return `<div class="cf-text">${i.html}</div>`;
      case "img": return (i.img || []).map(f => imgSrc(form, f) ? `<img class="cf-img" src="${esc(imgSrc(form, f))}" alt="${esc(i.label || "Form picture")}">` : "").join("") + (i.label ? `<div class="cf-cap">${esc(i.label)}</div>` : "");
      case "check": return `<label class="cf-check"><input type="checkbox" data-k="${esc(i.k)}"${a[i.k] === true ? " checked" : ""}${dis}><span>${esc(lab || "Done")}</span>${req}</label>`;
      case "select": return `<label class="cf-field">${lab ? `<span>${esc(lab)}${req}</span>` : ""}<select class="inp" data-k="${esc(i.k)}"${dis}><option value="">Choose…</option>${(i.opts || []).map(o => `<option${a[i.k] === o ? " selected" : ""}>${esc(o)}</option>`).join("")}</select></label>`;
      case "multi": { const on = Array.isArray(a[i.k]) ? a[i.k] : []; return `<div class="cf-field" data-multi="${esc(i.k)}">${lab ? `<span>${esc(lab)}${req}</span>` : ""}${(i.opts || []).map(o => `<label class="cf-check"><input type="checkbox" data-mk="${esc(i.k)}" value="${esc(o)}"${on.includes(o) ? " checked" : ""}${dis}><span>${esc(o)}</span></label>`).join("")}</div>`; }
      case "sign": return `<div class="cf-field cf-sign">${lab ? `<span>${esc(lab)}${req}</span>` : ""}<canvas class="cf-pad" data-sk="${esc(i.k)}" width="600" height="200"></canvas><input type="hidden" data-k="${esc(i.k)}" value="${esc(a[i.k] || "")}">${locked ? "" : `<button type="button" class="act" data-sclear="${esc(i.k)}">Clear signature</button>`}</div>`;
      case "date": return `<label class="cf-field">${lab ? `<span>${esc(lab)}${req}</span>` : ""}<input class="inp" type="date" data-k="${esc(i.k)}" value="${esc(a[i.k] || "")}"${dis}></label>`;
      case "long": return `<label class="cf-field">${lab ? `<span>${esc(lab)}${req}</span>` : ""}<textarea class="inp" data-k="${esc(i.k)}" rows="${Math.min(8, i.lines || 3)}"${dis}>${esc(a[i.k] || "")}</textarea></label>`;
      default: return `<label class="cf-field">${lab ? `<span>${esc(lab)}${req}</span>` : ""}<input class="inp" data-k="${esc(i.k)}" value="${esc(a[i.k] || "")}"${dis}${lab ? "" : ' placeholder="Answer"'}></label>`;
    }
  };
  return rowsOf(form).map(r => r.length > 1 ? `<div class="cf-row">${r.map(i => `<div>${cell(i)}</div>`).join("")}</div>` : cell(r[0])).join("");
}
export function readAnswers(root) {
  const a = {};
  root.querySelectorAll("[data-k]").forEach(el => { a[el.dataset.k] = el.type === "checkbox" ? el.checked : el.value; });
  root.querySelectorAll("[data-multi]").forEach(el => { a[el.dataset.multi] = [...el.querySelectorAll("[data-mk]:checked")].map(c => c.value); });
  return a;
}
// Signature pads: draw with a finger; the picture is kept as a small PNG in the hidden input (fires "change").
export function wireSignatures(root, locked) {
  root.querySelectorAll("canvas[data-sk]").forEach(cv => {
    const k = cv.dataset.sk, hid = root.querySelector(`input[data-k="${CSS.escape(k)}"]`), ctx = cv.getContext("2d");
    ctx.lineWidth = 2.5; ctx.lineCap = "round"; ctx.strokeStyle = "#10444E";
    if (hid.value) { const im = new Image(); im.onload = () => ctx.drawImage(im, 0, 0, cv.width, cv.height); im.src = hid.value; }
    if (locked) return;
    let down = false;
    const pt = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height]; };
    cv.addEventListener("pointerdown", e => { down = true; cv.setPointerCapture(e.pointerId); const [x, y] = pt(e); ctx.beginPath(); ctx.moveTo(x, y); e.preventDefault(); });
    cv.addEventListener("pointermove", e => { if (!down) return; const [x, y] = pt(e); ctx.lineTo(x, y); ctx.stroke(); e.preventDefault(); });
    const end = () => { if (!down) return; down = false; hid.value = cv.toDataURL("image/png"); hid.dispatchEvent(new Event("change", { bubbles: true })); };
    cv.addEventListener("pointerup", end); cv.addEventListener("pointercancel", end);
    const clr = root.querySelector(`[data-sclear="${CSS.escape(k)}"]`);
    if (clr) clr.onclick = () => { ctx.clearRect(0, 0, cv.width, cv.height); hid.value = ""; hid.dispatchEvent(new Event("change", { bubbles: true })); };
  });
}

// Read-only HTML (customer copy, office preview). Unticked boxes show empty; blank answers show a dash.
export function reportHtml(form, answers, opts = {}) {
  const a = answers || {}, blank = opts.preview ? "" : "—";
  const cell = i => {
    const lab = i.label && !isFiller(i.label) ? i.label : "";
    switch (i.t) {
      case "h": return `<div class="cr-h">${esc(i.label)}</div>`;
      case "text": return `<div class="cr-text">${i.html}</div>`;
      case "img": return (i.img || []).map(f => imgSrc(form, f) ? `<img class="cr-img" src="${esc(imgSrc(form, f))}" alt="${esc(i.label || "Form picture")}">` : "").join("");
      case "check": return `<div class="cr-check ${a[i.k] === true ? "on" : ""}"><span class="box">${a[i.k] === true ? "✓" : ""}</span>${esc(lab)}</div>`;
      case "multi": { const on = Array.isArray(a[i.k]) ? a[i.k] : []; return (lab ? `<div class="cr-text">${esc(lab)}</div>` : "") + (i.opts || []).map(o => `<div class="cr-check ${on.includes(o) ? "on" : ""}"><span class="box">${on.includes(o) ? "✓" : ""}</span>${esc(o)}</div>`).join(""); }
      case "sign": return `<div class="cr-ans long">${lab ? `<span>${esc(lab)}</span>` : ""}${/^data:image\/png;base64,/.test(a[i.k] || "") ? `<img class="cr-sign" src="${esc(a[i.k])}" alt="Signature">` : `<b>${esc(blank)}</b>`}</div>`;
      case "date": { const v = a[i.k] ? new Date(a[i.k] + "T12:00:00").toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" }) : blank; return `<div class="cr-ans">${lab ? `<span>${esc(lab)}</span>` : ""}<b>${esc(v)}</b></div>`; }
      default: { const v = String(a[i.k] ?? "").trim(); return `<div class="cr-ans${i.t === "long" ? " long" : ""}">${lab ? `<span>${esc(lab)}</span>` : ""}<b>${esc(v || blank)}</b></div>`; }
    }
  };
  return rowsOf(form).map(r => r.length > 1 ? `<div class="cr-row">${r.map(i => `<div>${cell(i)}</div>`).join("")}</div>` : cell(r[0])).join("");
}

// Which forms belong to a visit's site: BuildOps keeps the building in the form description ("21 King", "Wainfleet").
export function siteScore(form, visit) {
  const s = String(form.site || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").trim();
  if (!s) return 0;
  const hay = [visit.site, visit.address, visit.customer, visit.title].join(" ").toLowerCase().replace(/[^a-z0-9 ]/g, " ");
  const words = s.split(/\s+/).filter(w => w.length > 1 && !/^(the|and|floor|st|street|rd|road)$/.test(w));
  if (!words.length) return 0;
  const hit = words.filter(w => new RegExp("\\b" + w + "\\b").test(hay)).length;
  return hit === words.length ? 2 : hit ? 1 : 0;
}

export const newToken = () => [...crypto.getRandomValues(new Uint8Array(18))].map(b => b.toString(16).padStart(2, "0")).join("");
export const SHARE_PAGE = "checklist.html";
