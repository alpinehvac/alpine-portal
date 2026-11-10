// ── Alpine HVAC Internal Portal — Item List (items.html) ─────────────
// Equipment, labour, materials and uncategorized items, laid out like
// BuildOps Settings > Item List, with the same columns as its Export:
// category tree, keyword search, views, columns, filters, density, export,
// sorting, paging, add/edit, bulk edits, CSV import and a Categories tab.
// Data: Firestore items_data/{id} (one doc per item) + items_meta/categories.
// LOCAL MODE: if the database won't allow access yet (rules not published),
// items are kept in this browser instead, with a banner saying so, and can be
// copied into the database later with one click.
// Per-browser: saved views, column order/visibility/widths, density.

import { doc, getDoc, getDocs, collection, setDoc, deleteDoc, writeBatch, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";
import { db, currentUser } from "./ap-firebase.js";

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const norm = s => String(s ?? "").trim();
const lc = s => norm(s).toLowerCase();
const money = n => (n === null || n === undefined || n === "" || isNaN(n)) ? "" : "$" + Number(n).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const numOrNull = v => { const t = String(v ?? "").replace(/[$,%\s]/g, ""); return t === "" || isNaN(+t) ? null : +t; };
const LS = { get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };
function toast(t) { const el = $("toast"); el.textContent = t; el.style.display = "block"; clearTimeout(toast._t); toast._t = setTimeout(() => el.style.display = "none", 3500); }

const ITEM_TYPES = ["Non-Inventory", "Inventory"];
const COST_TYPES = ["Material", "Equipment", "Labor", "Subcontractor", "Other"];
const DEFAULT_CATS = [
  { name: "Equipment", subs: ["EQUIPMENT"] },
  { name: "Labour", subs: ["Labour"] },
  { name: "Materials", subs: ["Materials"] },
  { name: "Uncategorized", subs: ["Uncategorized"] },
];
const yn = v => v === true ? "yes" : v === false ? "no" : "";

// ── Columns: the BuildOps Item List columns, same headings, screen order first ──
const COLS = [
  { key: "attribute",    label: "Attribute",           w: 150 },
  { key: "name",         label: "Item Name",           w: 220 },
  { key: "vendor",       label: "Preferred Vendor",    w: 160 },
  { key: "description",  label: "Description",         w: 340 },
  { key: "productCode",  label: "Product Code",        w: 130 },
  { key: "itemType",     label: "Item Type",           w: 115 },
  { key: "category",     label: "Category",            w: 140 },
  { key: "subcategory",  label: "Subcategory",         w: 140 },
  { key: "manufacturer", label: "Manufacturer Name",   w: 150 },
  { key: "mfrPart",      label: "Manufacturer Part #", w: 150 },
  { key: "uom",          label: "UOM",                 w: 80 },
  { key: "unitCost",     label: "Standard Unit Cost",  w: 140, num: true, fmt: money },
  { key: "glGroup",      label: "Item GL Group",       w: 120, hidden: true },
  { key: "costCode",     label: "Cost Code",           w: 110 },
  { key: "costType",     label: "Cost Type",           w: 110 },
  { key: "revenueType",  label: "Revenue Type",        w: 120 },
  { key: "generic",      label: "Generic Item",        w: 110, fmt: yn },
  { key: "bulkPO",       label: "Include in Bulk PO",  w: 140, fmt: yn, hidden: true },
  { key: "active",       label: "Archived",            w: 100, fmt: v => v === false ? '<span class="tag red">yes</span>' : '<span class="tag grey">no</span>', html: true },
];
const COL = Object.fromEntries(COLS.map(c => [c.key, c]));
const STANDARD = () => ({ name: "Standard View", cols: COLS.map(c => ({ key: c.key, on: !c.hidden, w: c.w })), filters: {}, sort: null, density: "standard", per: 100 });
const TEXT_KEYS = ["attribute", "name", "vendor", "description", "productCode", "itemType", "category", "subcategory", "manufacturer", "mfrPart", "uom", "glGroup", "costCode", "costType", "revenueType"];
// BuildOps writes item types as ItemNonInventory / ItemInventory.
const typeLabel = t => { const x = lc(t).replace(/^item/, "").replace(/[^a-z]/g, ""); return x === "noninventory" ? "Non-Inventory" : x === "inventory" ? "Inventory" : norm(t); };

// ── State ──
let ITEMS = [], CATS = [], user = null;
let VIEWS = LS.get("ap_items_views", []);                 // saved views (per browser)
let view = LS.get("ap_items_current", null) || STANDARD();
let catSel = new Set(), catOpen = new Set(LS.get("ap_items_open", [])), kw = "", page = 0, sel = new Set();
function fixView() {
  // keep saved column lists in step with COLS if columns are added later
  const have = new Set((view.cols || []).map(c => c.key));
  view.cols = (view.cols || []).filter(c => COL[c.key]);
  Object.keys(view.filters || {}).forEach(k => { if (!FILTER_KEYS.has(k)) delete view.filters[k]; });
  COLS.forEach(c => { if (!have.has(c.key)) view.cols.push({ key: c.key, on: !c.hidden, w: c.w }); });
  view.filters = view.filters || {}; view.per = view.per || 100; view.density = view.density || "standard";
}
const saveCurrent = () => LS.set("ap_items_current", view);

// ── Storage: Firestore, or this browser when the database isn't available ──
let MODE = "db";                                   // "db" | "local"
const LOCAL_KEY = "ap_items_local";
const itemRef = id => doc(db, "items_data", id);
const catRef = () => doc(db, "items_meta", "categories");
const nowTs = () => ({ toDate: () => new Date() });
function clean(it) {
  const o = {};
  TEXT_KEYS.forEach(k => o[k] = norm(it[k]));
  o.itemType = typeLabel(o.itemType) || "Non-Inventory";
  o.unitCost = numOrNull(it.unitCost);
  ["generic", "bulkPO"].forEach(k => o[k] = it[k] === true ? true : it[k] === false ? false : null);
  o.active = it.active !== false;
  return o;
}
// Local copies keep plain ISO dates; Firestore keeps timestamps.
function localSave() {
  const plain = ITEMS.map(it => { const o = { ...it }; ["updatedAt", "createdAt"].forEach(k => { if (o[k] && o[k].toDate) o[k] = o[k].toDate().toISOString(); }); return o; });
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify({ items: plain, cats: CATS, savedAt: new Date().toISOString() })); }
  catch (e) { throw { code: "browser storage is full" }; }
}
function localLoad() {
  try {
    const d = JSON.parse(localStorage.getItem(LOCAL_KEY) || "null"); if (!d) return null;
    const ts = v => v ? { toDate: () => new Date(v) } : null;
    return { items: (d.items || []).map(it => ({ ...it, updatedAt: ts(it.updatedAt), createdAt: ts(it.createdAt) })), cats: d.cats, savedAt: d.savedAt };
  } catch (e) { return null; }
}
const stamp = () => MODE === "db" ? { updatedAt: serverTimestamp(), updatedBy: user.email } : { updatedAt: nowTs(), updatedBy: user.email };
async function saveItem(it) {
  const data = { ...clean(it), ...stamp() };
  if (!it.createdAt) { data.createdAt = MODE === "db" ? serverTimestamp() : nowTs(); data.createdBy = user.email; }
  const out = { ...it, ...data, updatedAt: nowTs(), createdAt: it.createdAt || nowTs() };
  if (MODE === "db") await setDoc(itemRef(it.id), data, { merge: true });
  else { const i = ITEMS.findIndex(x => x.id === out.id); const was = i >= 0 ? ITEMS[i] : null; if (i >= 0) ITEMS[i] = out; else ITEMS.unshift(out); try { localSave(); } catch (e) { if (was) ITEMS[i] = was; else ITEMS.shift(); throw e; } }
  return out;
}
// ops: [{type:"set"|"delete", id, data}]. Callers update ITEMS themselves after this resolves.
async function batchWrite(ops) {
  if (MODE === "local") return; // ITEMS is saved by commitLocal() once the caller has applied the change
  for (let i = 0; i < ops.length; i += 400) {
    const b = writeBatch(db);
    ops.slice(i, i + 400).forEach(o => o.type === "delete" ? b.delete(itemRef(o.id)) : b.set(itemRef(o.id), o.data, { merge: true }));
    await b.commit();
  }
}
function commitLocal() { if (MODE === "local") localSave(); }
async function removeItem(id) { if (MODE === "db") await deleteDoc(itemRef(id)); }
async function saveCats() {
  if (MODE === "db") await setDoc(catRef(), { list: CATS, updatedAt: serverTimestamp(), updatedBy: user.email });
  else localSave();
}
const newId = () => "it-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// Category list = saved list plus anything items use that isn't in it yet.
function mergedCats() {
  const out = CATS.map(c => ({ name: c.name, subs: [...(c.subs || [])] }));
  const find = n => out.find(c => lc(c.name) === lc(n));
  ITEMS.forEach(it => {
    const cn = it.category || "Uncategorized";
    let c = find(cn); if (!c) { c = { name: cn, subs: [] }; out.push(c); }
    const sn = it.subcategory; if (sn && !c.subs.some(s => lc(s) === lc(sn))) c.subs.push(sn);
  });
  return out;
}

// ── Filtering ──
const FILTERS = [
  { key: "itemType", label: "Item Type" },
  { key: "vendor", label: "Preferred Vendor" },
  { key: "manufacturer", label: "Manufacturer Name" },
  { key: "attribute", label: "Attribute" },
  { key: "costType", label: "Cost Type" },
  { key: "revenueType", label: "Revenue Type" },
  { key: "costCode", label: "Cost Code" },
  { key: "uom", label: "UOM" },
  { key: "generic", label: "Generic Item", values: [["true", "yes"], ["false", "no"]] },
  { key: "bulkPO", label: "Include in Bulk PO", values: [["true", "yes"], ["false", "no"]] },
  { key: "active", label: "Archived", values: [["true", "no (current items)"], ["false", "yes (archived)"]] },
  { key: "hasCode", label: "Product Code", values: [["yes", "Has a product code"], ["no", "Missing product code"]] },
  { key: "hasCost", label: "Standard Unit Cost", values: [["yes", "Has a cost"], ["no", "Missing or $0.00"]] },
];
const FILTER_KEYS = new Set(FILTERS.map(f => f.key));
function passes(it) {
  if (catSel.size) {
    const c = it.category || "Uncategorized";
    if (!catSel.has("c:" + lc(c)) && !catSel.has("s:" + lc(c) + "||" + lc(it.subcategory))) return false;
  }
  const f = view.filters;
  for (const k in f) {
    const v = f[k]; if (v === "" || v == null) continue;
    if (k === "active") { if (String(it.active !== false) !== v) return false; }
    else if (k === "generic" || k === "bulkPO") { if (String(it[k]) !== v) return false; }
    else if (k === "hasCode") { if ((!!it.productCode) !== (v === "yes")) return false; }
    else if (k === "hasCost") { if ((!!it.unitCost) !== (v === "yes")) return false; }
    else if (lc(it[k]) !== lc(v)) return false;
  }
  if (kw) {
    const words = lc(kw).split(/\s+/).filter(Boolean);
    const hay = lc(TEXT_KEYS.map(k => it[k]).join(" "));
    if (!words.every(w => hay.includes(w))) return false;
  }
  return true;
}
function sorted(list) {
  const s = view.sort; if (!s) return list;
  const c = COL[s.key], dir = s.dir === "desc" ? -1 : 1;
  return [...list].sort((a, b) => {
    const x = a[s.key], y = b[s.key];
    if (c && c.num) return ((x ?? -Infinity) - (y ?? -Infinity)) * dir;
    return String(x ?? "").localeCompare(String(y ?? ""), undefined, { numeric: true, sensitivity: "base" }) * dir;
  });
}
const visible = () => sorted(ITEMS.filter(passes));

// ── Render: tree ──
function renderTree() {
  const q = lc($("cat-q").value);
  const cats = mergedCats();
  const counts = {}; ITEMS.forEach(it => { const c = lc(it.category || "Uncategorized"); counts[c] = (counts[c] || 0) + 1; const s = c + "||" + lc(it.subcategory); counts[s] = (counts[s] || 0) + 1; });
  $("tree").innerHTML = cats.filter(c => !q || lc(c.name).includes(q) || c.subs.some(s => lc(s).includes(q))).map(c => {
    const ck = "c:" + lc(c.name);
    const subSel = c.subs.filter(s => catSel.has("s:" + lc(c.name) + "||" + lc(s))).length;
    const open = catOpen.has(lc(c.name)) || (q && c.subs.some(s => lc(s).includes(q)));
    return `<li class="${open ? "open" : ""}" data-c="${esc(c.name)}">
      <div class="node"><button class="tw" data-tw="${esc(c.name)}" aria-label="Expand">${c.subs.length ? '<svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>' : ""}</button>
        <input type="checkbox" data-k="${esc(ck)}" ${catSel.has(ck) ? "checked" : ""}><span class="lbl">${esc(c.name)}${subSel && !catSel.has(ck) ? ` (${subSel})` : ""}</span><span class="cnt">${counts[lc(c.name)] || 0}</span></div>
      <ul>${c.subs.map(s => { const sk = "s:" + lc(c.name) + "||" + lc(s); return `<li><div class="node"><span class="tw"></span><input type="checkbox" data-k="${esc(sk)}" ${catSel.has(sk) || catSel.has(ck) ? "checked" : ""} ${catSel.has(ck) ? "disabled" : ""}><span class="lbl">${esc(s)}</span><span class="cnt">${counts[lc(c.name) + "||" + lc(s)] || 0}</span></div></li>`; }).join("")}</ul></li>`;
  }).join("") || '<li class="msg" style="padding:.4rem">No categories match.</li>';
  $("tree").querySelectorAll("[data-tw]").forEach(b => b.onclick = e => { e.stopPropagation(); const k = lc(b.dataset.tw); catOpen.has(k) ? catOpen.delete(k) : catOpen.add(k); LS.set("ap_items_open", [...catOpen]); renderTree(); });
  $("tree").querySelectorAll("input[data-k]").forEach(i => i.onchange = () => {
    const k = i.dataset.k;
    if (i.checked) { catSel.add(k); if (k.startsWith("c:")) [...catSel].forEach(x => { if (x.startsWith("s:" + k.slice(2) + "||")) catSel.delete(x); }); }
    else catSel.delete(k);
    page = 0; renderTree(); renderGrid();
  });
  $("tree").querySelectorAll(".node").forEach(n => n.addEventListener("click", e => { if (e.target.tagName === "INPUT" || e.target.closest(".tw")) return; const i = n.querySelector("input"); if (i && !i.disabled) { i.checked = !i.checked; i.onchange(); } }));
}

// ── Render: grid ──
function shownCols() { return view.cols.filter(c => c.on && COL[c.key]); }
function renderGrid() {
  const list = visible();
  const per = view.per, pages = Math.max(1, Math.ceil(list.length / per));
  if (page >= pages) page = pages - 1;
  const rows = list.slice(page * per, page * per + per);
  const cols = shownCols();
  $("grid").className = "dens-" + view.density;
  const allOnPage = rows.length && rows.every(r => sel.has(r.id));
  $("thead").innerHTML = `<tr><th class="ck"><input type="checkbox" id="ck-all" ${allOnPage ? "checked" : ""} aria-label="Select all on this page"></th>${cols.map(c => {
    const s = view.sort && view.sort.key === c.key ? (view.sort.dir === "desc" ? "▼" : "▲") : "";
    return `<th style="width:${c.w}px;position:sticky" data-k="${c.key}"><div class="th-in"><span>${esc(COL[c.key].label)}</span><span class="arrow">${s}</span></div><span class="rs" data-rs="${c.key}"></span></th>`;
  }).join("")}</tr>`;
  $("tbody").innerHTML = rows.length ? rows.map(it => `<tr data-id="${esc(it.id)}" class="${sel.has(it.id) ? "sel" : ""}${it.active === false ? " inactive" : ""}"><td class="ck"><input type="checkbox" data-ck="${esc(it.id)}" ${sel.has(it.id) ? "checked" : ""} aria-label="Select"></td>${cols.map(c => {
    const d = COL[c.key], v = it[c.key], txt = d.fmt ? d.fmt(v) : v;
    return `<td class="${d.num ? "num" : ""}" title="${d.html ? "" : esc(txt)}">${d.html ? txt : esc(txt)}</td>`;
  }).join("")}</tr>`).join("")
    : `<tr><td class="empty" colspan="${cols.length + 1}">${ITEMS.length ? "No items match. Clear the search, categories or filters." : "No items yet. Use Add Item, or Import CSV with the export from BuildOps."}</td></tr>`;
  $("range").textContent = list.length ? `${page * per + 1}–${Math.min(list.length, page * per + per)} of ${list.length}` : "0 of 0";
  $("prev").disabled = page === 0; $("next").disabled = page >= pages - 1;
  $("per").value = String(per);

  $("ck-all").onchange = e => { rows.forEach(r => e.target.checked ? sel.add(r.id) : sel.delete(r.id)); renderGrid(); };
  $("thead").querySelectorAll("th[data-k] .th-in").forEach(h => h.onclick = () => {
    const k = h.parentElement.dataset.k, s = view.sort;
    view.sort = !s || s.key !== k ? { key: k, dir: "asc" } : s.dir === "asc" ? { key: k, dir: "desc" } : null;
    saveCurrent(); renderGrid();
  });
  $("thead").querySelectorAll("[data-rs]").forEach(r => r.onmousedown = startResize);
  $("tbody").querySelectorAll("tr[data-id]").forEach(tr => tr.onclick = e => {
    if (e.target.closest("td.ck")) return;
    openDrawer(ITEMS.find(x => x.id === tr.dataset.id));
  });
  $("tbody").querySelectorAll("input[data-ck]").forEach(c => c.onchange = () => { c.checked ? sel.add(c.dataset.ck) : sel.delete(c.dataset.ck); renderGrid(); });
  renderChips(); renderBulk();
}
function startResize(e) {
  e.preventDefault(); e.stopPropagation();
  const key = e.target.dataset.rs, th = e.target.parentElement, x0 = e.clientX, w0 = th.offsetWidth;
  const mv = ev => { const w = Math.max(60, w0 + ev.clientX - x0); th.style.width = w + "px"; view.cols.find(c => c.key === key).w = w; };
  const up = () => { document.removeEventListener("mousemove", mv); document.removeEventListener("mouseup", up); saveCurrent(); };
  document.addEventListener("mousemove", mv); document.addEventListener("mouseup", up);
}
function renderChips() {
  const chips = [];
  FILTERS.forEach(f => { const v = view.filters[f.key]; if (v) chips.push([f.key, f.label + ": " + (f.values ? (f.values.find(x => x[0] === v) || [0, v])[1] : v)]); });
  $("chips").innerHTML = chips.map(([k, t]) => `<span class="chip">${esc(t)}<button data-x="${k}" aria-label="Remove filter">&times;</button></span>`).join("") + (chips.length > 1 ? `<span class="chip" style="background:none"><button data-x="*" style="font-size:.76rem;text-decoration:underline">Clear filters</button></span>` : "");
  $("chips").style.display = chips.length ? "" : "none";
  $("chips").querySelectorAll("[data-x]").forEach(b => b.onclick = () => { if (b.dataset.x === "*") view.filters = {}; else delete view.filters[b.dataset.x]; page = 0; saveCurrent(); renderGrid(); renderFilters(); });
  const n = chips.length; $("filt-badge").style.display = n ? "" : "none"; $("filt-badge").textContent = n;
}
function renderBulk() {
  const n = sel.size;
  $("bulk").classList.toggle("show", n > 0);
  if (!n) return;
  $("bulk").innerHTML = `<b>${n} selected</b><button data-b="cat">Change category</button><button data-b="off">Archive</button><button data-b="on">Unarchive</button><button data-b="exp">Export selected</button><button data-b="del">Delete</button><span class="spacer"></span><button data-b="clr">Clear selection</button>`;
  $("bulk").querySelectorAll("[data-b]").forEach(b => b.onclick = () => bulk(b.dataset.b));
}

// ── Toolbar popovers ──
function closePops(except) { document.querySelectorAll(".tb.open").forEach(t => { if (t !== except) t.classList.remove("open"); }); }
document.querySelectorAll(".tb > button").forEach(b => b.addEventListener("click", e => {
  const tb = b.parentElement; if (tb.id === "tb-exp") return;
  e.stopPropagation(); const open = !tb.classList.contains("open"); closePops(); tb.classList.toggle("open", open);
  if (open) ({ "tb-view": renderViews, "tb-cols": renderCols, "tb-filt": renderFilters, "tb-dens": renderDens })[tb.id]();
}));
document.addEventListener("click", e => { if (!e.target.closest(".pop")) closePops(); });
document.querySelectorAll(".pop").forEach(p => p.addEventListener("click", e => e.stopPropagation()));

function renderViews() {
  $("pop-view").innerHTML = `<h4>Views</h4>
    <button class="opt ${view.name === "Standard View" ? "on" : ""}" data-v="__std">Standard View</button>
    ${VIEWS.map((v, i) => `<button class="opt ${view.name === v.name ? "on" : ""}" data-v="${i}">${esc(v.name)}</button>`).join("")}
    <div class="sep"></div>
    <button class="opt" data-a="save">Save current view as…</button>
    ${VIEWS.some(v => v.name === view.name) ? `<button class="opt" data-a="update">Update “${esc(view.name)}”</button><button class="opt" data-a="del" style="color:var(--red)">Delete “${esc(view.name)}”</button>` : ""}
    <button class="opt" data-a="reset">Reset to Standard View</button>`;
  $("pop-view").querySelectorAll("[data-v]").forEach(b => b.onclick = () => {
    view = b.dataset.v === "__std" ? STANDARD() : JSON.parse(JSON.stringify(VIEWS[+b.dataset.v])); fixView();
    applyView(); closePops();
  });
  $("pop-view").querySelectorAll("[data-a]").forEach(b => b.onclick = () => {
    const a = b.dataset.a;
    if (a === "save") { const n = norm(prompt("Name this view (columns, filters, sort and density are saved):", "")); if (!n || n === "Standard View") return; view.name = n; VIEWS = VIEWS.filter(v => v.name !== n).concat([JSON.parse(JSON.stringify(view))]); }
    if (a === "update") VIEWS = VIEWS.map(v => v.name === view.name ? JSON.parse(JSON.stringify(view)) : v);
    if (a === "del") { if (!confirm(`Delete the view “${view.name}”?`)) return; VIEWS = VIEWS.filter(v => v.name !== view.name); view = STANDARD(); }
    if (a === "reset") view = STANDARD();
    LS.set("ap_items_views", VIEWS); applyView(); closePops();
  });
}
function applyView() { $("view-name").textContent = view.name; page = 0; saveCurrent(); renderGrid(); }

function renderCols() {
  $("pop-cols").innerHTML = `<h4>Show columns</h4><div class="cols-list">${view.cols.map((c, i) => `<label class="opt"><input type="checkbox" data-i="${i}" ${c.on ? "checked" : ""}>${esc(COL[c.key].label)}<span class="mv"><span data-up="${i}" title="Move left">&#8593;</span><span data-dn="${i}" title="Move right">&#8595;</span></span></label>`).join("")}</div>
    <div class="row2"><button data-a="all">Show all</button><button data-a="reset">Reset</button></div>`;
  const P = $("pop-cols");
  P.querySelectorAll("input[data-i]").forEach(i => i.onchange = () => { view.cols[+i.dataset.i].on = i.checked; if (!shownCols().length) { i.checked = true; view.cols[+i.dataset.i].on = true; } saveCurrent(); renderGrid(); });
  const move = (i, d) => { const j = i + d; if (j < 0 || j >= view.cols.length) return; [view.cols[i], view.cols[j]] = [view.cols[j], view.cols[i]]; saveCurrent(); renderGrid(); renderCols(); };
  P.querySelectorAll("[data-up]").forEach(s => s.onclick = e => { e.preventDefault(); move(+s.dataset.up, -1); });
  P.querySelectorAll("[data-dn]").forEach(s => s.onclick = e => { e.preventDefault(); move(+s.dataset.dn, 1); });
  P.querySelector('[data-a="all"]').onclick = () => { view.cols.forEach(c => c.on = true); saveCurrent(); renderGrid(); renderCols(); };
  P.querySelector('[data-a="reset"]').onclick = () => { view.cols = STANDARD().cols; saveCurrent(); renderGrid(); renderCols(); };
}

function renderFilters() {
  const distinct = k => [...new Set(ITEMS.map(it => norm(it[k])).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  $("pop-filt").innerHTML = `<h4>Filters</h4><div class="filt">${FILTERS.map(f => {
    const vals = f.values || distinct(f.key).map(v => [v, v]);
    return `<label>${esc(f.label)}<select data-f="${f.key}"><option value="">Any</option>${vals.map(([v, l]) => `<option value="${esc(v)}" ${view.filters[f.key] === v ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label>`;
  }).join("")}</div><div class="row2"><button data-a="clear">Clear all</button></div>`;
  $("pop-filt").querySelectorAll("select[data-f]").forEach(s => s.onchange = () => { view.filters[s.dataset.f] = s.value; if (!s.value) delete view.filters[s.dataset.f]; page = 0; saveCurrent(); renderGrid(); });
  $("pop-filt").querySelector('[data-a="clear"]').onclick = () => { view.filters = {}; page = 0; saveCurrent(); renderGrid(); renderFilters(); };
}

function renderDens() {
  $("pop-dens").innerHTML = `<h4>Row density</h4>${[["compact", "Compact"], ["standard", "Standard"], ["comfortable", "Comfortable"]].map(([k, l]) => `<button class="opt ${view.density === k ? "on" : ""}" data-d="${k}">${l}</button>`).join("")}`;
  $("pop-dens").querySelectorAll("[data-d]").forEach(b => b.onclick = () => { view.density = b.dataset.d; saveCurrent(); renderGrid(); closePops(); });
}

// ── Export (what's showing: current filters, sort and visible columns) ──
function csvCell(v) { const s = String(v ?? ""); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
function exportCsv(list, name) {
  const cols = shownCols().map(c => COL[c.key]);
  const lines = [cols.map(c => csvCell(c.label)).join(",")].concat(list.map(it => cols.map(c => {
    const v = it[c.key];
    if (c.key === "active") return v === false ? "yes" : "no";
    if (c.key === "generic" || c.key === "bulkPO") return yn(v);
    if (c.key === "unitCost") return v == null ? "" : csvCell(money(v));
    return csvCell(v);
  }).join(",")));
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
  a.download = name || ("alpine-items-" + new Date().toISOString().slice(0, 10) + ".csv"); a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast(list.length + " items exported.");
}
$("export-btn").onclick = () => exportCsv(visible());

// ── Search, paging ──
let kwT; $("kw").oninput = () => { clearTimeout(kwT); kwT = setTimeout(() => { kw = $("kw").value; page = 0; renderGrid(); }, 150); };
$("cat-q").oninput = renderTree;
$("cat-all").onclick = () => { catSel = new Set(mergedCats().map(c => "c:" + lc(c.name))); page = 0; renderTree(); renderGrid(); };
$("cat-none").onclick = () => { catSel.clear(); page = 0; renderTree(); renderGrid(); };
$("per").onchange = () => { view.per = +$("per").value; page = 0; saveCurrent(); renderGrid(); };
$("prev").onclick = () => { page--; renderGrid(); $("grid-wrap").scrollTop = 0; };
$("next").onclick = () => { page++; renderGrid(); $("grid-wrap").scrollTop = 0; };

// ── Drawer: add / edit ──
function closeDrawer() { document.body.classList.remove("dr-open"); }
$("dr-x").onclick = closeDrawer; $("scrim").onclick = closeDrawer;
document.addEventListener("keydown", e => { if (e.key === "Escape") { closeDrawer(); closePops(); } });
function catOptions(cur) { return mergedCats().map(c => `<option ${lc(c.name) === lc(cur) ? "selected" : ""}>${esc(c.name)}</option>`).join(""); }
function subOptions(cat, cur) {
  const c = mergedCats().find(x => lc(x.name) === lc(cat)); const subs = c ? c.subs : [];
  return `<option value="">None</option>` + subs.map(s => `<option ${lc(s) === lc(cur) ? "selected" : ""}>${esc(s)}</option>`).join("");
}
function openDrawer(it, copyFrom) {
  const isNew = !it; it = it || copyFrom || { category: "Uncategorized", subcategory: "Uncategorized", attribute: "Uncategorized", itemType: "Non-Inventory", uom: "Each", generic: true, bulkPO: false, active: true };
  $("dr-title").textContent = copyFrom ? "Add Item (copy)" : isNew ? "Add Item" : "Edit Item";
  const f = (k, l, o) => `<label class="${o && o.full ? "full" : ""}">${l}<input id="f-${k}" value="${esc(k === "unitCost" && it[k] != null ? Number(it[k]).toFixed(2) : it[k] ?? "")}" ${o && o.num ? 'type="number" step="0.01" min="0"' : ""} ${o && o.ph ? `placeholder="${esc(o.ph)}"` : ""} ${o && o.list ? `list="dl-${k}"` : ""}></label>`;
  const dl = k => `<datalist id="dl-${k}">${[...new Set(ITEMS.map(x => norm(x[k])).filter(Boolean))].sort().map(v => `<option value="${esc(v)}">`).join("")}</datalist>`;
  const sel2 = (k, l, opts) => `<label>${l}<select id="f-${k}">${opts.map(o => `<option ${lc(o) === lc(it[k]) ? "selected" : ""}>${esc(o)}</option>`).join("")}</select></label>`;
  $("dr-body").innerHTML = `
    <div class="g">${f("name", "Item Name", { full: true })}
      <label class="full">Description<textarea id="f-description" rows="2">${esc(it.description || "")}</textarea></label>
      <label>Category<select id="f-category">${catOptions(it.category)}</select></label>
      <label>Subcategory<select id="f-subcategory">${subOptions(it.category, it.subcategory)}</select></label>
      ${f("attribute", "Attribute", { ph: "Materials, EQUIPMENT…", list: 1 })}
      ${sel2("itemType", "Item Type", ITEM_TYPES)}
      ${f("vendor", "Preferred Vendor", { list: 1 })}${f("manufacturer", "Manufacturer Name", { list: 1 })}
      ${f("productCode", "Product Code")}${f("mfrPart", "Manufacturer Part #")}
      ${f("uom", "UOM", { ph: "Each", list: 1 })}${f("unitCost", "Standard Unit Cost ($)", { num: 1 })}
      ${f("costCode", "Cost Code", { list: 1 })}${sel2("costType", "Cost Type", [""].concat(COST_TYPES))}
      ${sel2("revenueType", "Revenue Type", [""].concat(COST_TYPES))}${f("glGroup", "Item GL Group", { list: 1 })}
      <label class="ck-row"><input type="checkbox" id="f-generic" ${it.generic ? "checked" : ""}> Generic Item</label>
      <label class="ck-row"><input type="checkbox" id="f-bulkPO" ${it.bulkPO ? "checked" : ""}> Include in Bulk PO</label>
      <label class="ck-row"><input type="checkbox" id="f-archived" ${it.active === false ? "checked" : ""}> Archived</label>
    </div>
    ${["attribute", "vendor", "manufacturer", "uom", "costCode", "glGroup"].map(dl).join("")}
    ${isNew ? "" : `<p class="meta">${it.updatedAt && it.updatedAt.toDate ? "Last changed " + it.updatedAt.toDate().toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" }) + (it.updatedBy ? " by " + esc(it.updatedBy.split("@")[0]) : "") : ""}</p>`}`;
  $("dr-foot").innerHTML = `<button class="btn" id="dr-save">${isNew ? "Add Item" : "Save"}</button><button class="btn ghost" id="dr-cancel">Cancel</button>${isNew ? "" : '<button class="btn ghost" id="dr-dup">Duplicate</button><span class="spacer"></span><button class="lnk danger" id="dr-del">Delete</button>'}<span class="msg" id="dr-msg"></span>`;
  $("f-category").onchange = () => { const c = mergedCats().find(x => lc(x.name) === lc($("f-category").value)); $("f-subcategory").innerHTML = subOptions($("f-category").value, c && c.subs[0] || ""); };
  // Cost Type and Revenue Type usually match: follow Cost Type until Revenue Type is set by hand.
  let follow = !it.revenueType || lc(it.revenueType) === lc(it.costType);
  $("f-costType").onchange = () => { if (follow) $("f-revenueType").value = $("f-costType").value; };
  $("f-revenueType").onchange = () => { follow = false; };
  $("dr-cancel").onclick = closeDrawer;
  $("dr-save").onclick = async () => {
    const v = k => $("f-" + k).value;
    const next = { ...(isNew ? {} : it), id: isNew ? newId() : it.id, active: !$("f-archived").checked, generic: $("f-generic").checked, bulkPO: $("f-bulkPO").checked };
    if (isNew) { delete next.createdAt; delete next.updatedAt; }
    ["name", "description", "category", "subcategory", "attribute", "itemType", "vendor", "manufacturer", "productCode", "mfrPart", "uom", "unitCost", "costCode", "costType", "revenueType", "glGroup"].forEach(k => next[k] = v(k));
    if (!norm(next.name)) { $("dr-msg").textContent = "Enter an item name."; $("dr-msg").className = "msg bad"; return; }
    $("dr-save").disabled = true; $("dr-msg").textContent = "Saving…"; $("dr-msg").className = "msg";
    try {
      const saved = await saveItem(next);
      const i = ITEMS.findIndex(x => x.id === saved.id); if (i >= 0) ITEMS[i] = saved; else ITEMS.unshift(saved);
      closeDrawer(); renderTree(); renderGrid(); toast(isNew ? "Item added." : "Item saved.");
    } catch (e) { $("dr-msg").textContent = "Save failed (" + (e.code || e) + ")."; $("dr-msg").className = "msg bad"; }
    $("dr-save").disabled = false;
  };
  if (!isNew) {
    $("dr-dup").onclick = () => openDrawer(null, { ...it, name: it.name + " (copy)" });
    $("dr-del").onclick = async () => {
      if (!confirm(`Delete “${it.name}”? This can't be undone. Archive it instead if it may be needed again.`)) return;
      try { await removeItem(it.id); ITEMS = ITEMS.filter(x => x.id !== it.id); sel.delete(it.id); commitLocal(); closeDrawer(); renderTree(); renderGrid(); toast("Item deleted."); }
      catch (e) { $("dr-msg").textContent = "Delete failed (" + (e.code || e) + ")."; $("dr-msg").className = "msg bad"; }
    };
  }
  document.body.classList.add("dr-open"); setTimeout(() => $("f-name").focus(), 50);
}
$("add-btn").onclick = () => openDrawer(null);

// ── Bulk actions ──
async function bulk(a) {
  const ids = [...sel], items = ITEMS.filter(x => sel.has(x.id));
  if (a === "clr") { sel.clear(); renderGrid(); return; }
  if (a === "exp") { exportCsv(items, "alpine-items-selected.csv"); return; }
  try {
    if (a === "on" || a === "off") {
      const active = a === "on";
      await batchWrite(items.map(it => ({ type: "set", id: it.id, data: { active, updatedAt: serverTimestamp(), updatedBy: user.email } })));
      items.forEach(it => it.active = active); commitLocal(); toast(items.length + " items " + (active ? "unarchived." : "archived."));
    }
    if (a === "del") {
      if (!confirm(`Delete ${ids.length} items? This can't be undone. Archive them instead if you may need them again.`)) return;
      await batchWrite(ids.map(id => ({ type: "delete", id })));
      ITEMS = ITEMS.filter(x => !sel.has(x.id)); sel.clear(); commitLocal(); toast(ids.length + " items deleted.");
    }
    if (a === "cat") return openBulkCat(items);
    renderTree(); renderGrid();
  } catch (e) { toast("That didn't save (" + (e.code || e) + ")."); }
}
function openBulkCat(items) {
  $("dr-title").textContent = "Change category";
  $("dr-body").innerHTML = `<p class="msg" style="margin-bottom:1rem">Moves the ${items.length} selected items.</p><div class="g">
    <label>Category<select id="b-cat">${catOptions("Uncategorized")}</select></label>
    <label>Subcategory<select id="b-sub">${subOptions("Uncategorized", "")}</select></label>
    <label class="full">Attribute (leave blank to keep each item's own)<input id="b-attr"></label></div>`;
  $("dr-foot").innerHTML = `<button class="btn" id="b-save">Move items</button><button class="btn ghost" id="b-cancel">Cancel</button><span class="msg" id="b-msg"></span>`;
  $("b-cat").onchange = () => { const c = mergedCats().find(x => lc(x.name) === lc($("b-cat").value)); $("b-sub").innerHTML = subOptions($("b-cat").value, c && c.subs[0] || ""); };
  $("b-cancel").onclick = closeDrawer;
  $("b-save").onclick = async () => {
    const category = $("b-cat").value, subcategory = $("b-sub").value, attribute = norm($("b-attr").value);
    $("b-save").disabled = true;
    try {
      await batchWrite(items.map(it => ({ type: "set", id: it.id, data: { category, subcategory, ...(attribute ? { attribute } : {}), updatedAt: serverTimestamp(), updatedBy: user.email } })));
      items.forEach(it => { it.category = category; it.subcategory = subcategory; if (attribute) it.attribute = attribute; });
      commitLocal(); sel.clear(); closeDrawer(); renderTree(); renderGrid(); toast(items.length + " items moved to " + category + (subcategory ? " / " + subcategory : "") + ".");
    } catch (e) { $("b-msg").textContent = "Save failed (" + (e.code || e) + ")."; $("b-msg").className = "msg bad"; $("b-save").disabled = false; }
  };
  document.body.classList.add("dr-open");
}

// ── CSV import (BuildOps Item List > Export) ──
// Standard CSV, plus BuildOps' habit of writing a doubled quote ("") for an inch
// mark inside an unquoted cell, e.g. Radiator Cover (4"" Filler Plate).
function parseCsv(text) {
  const rows = []; let row = [], cell = "", q = false, fresh = true;
  text = text.replace(/^\ufeff/, "");
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"' && fresh) { q = true; fresh = false; }
    else if (ch === '"') { cell += '"'; if (text[i + 1] === '"') i++; }
    else if (ch === ",") { row.push(cell); cell = ""; fresh = true; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; fresh = true; }
    else { cell += ch; fresh = false; }
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => norm(c)));
}
// BuildOps export headings (normalised), plus common alternatives.
const HEAD = {
  attribute: ["attribute"], name: ["itemname", "name", "item"], vendor: ["preferredvendor", "vendor", "supplier"],
  bulkPO: ["includeinbulkpo", "bulkpo"], description: ["description", "desc"], productCode: ["productcode", "sku", "code"],
  itemType: ["itemtype", "type"], category: ["category"], subcategory: ["subcategory", "subcat"],
  manufacturer: ["manufacturername", "manufacturer", "brand"], mfrPart: ["manufacturerpart", "manufacturerpartnumber", "mfrpart", "partnumber", "modelnumber", "model"],
  uom: ["uom", "unitofmeasure", "unit"], unitCost: ["standardunitcost", "unitcost", "cost"], glGroup: ["itemglgroup", "glgroup"],
  costCode: ["costcode"], costType: ["costtype"], revenueType: ["revenuetype"], generic: ["genericitem", "generic"],
  archived: ["archived"], active: ["active", "isactive", "status"],
};
const bool = v => { const t = lc(v); if (["yes", "true", "y", "1", "active"].includes(t)) return true; if (["no", "false", "n", "0", "inactive", "archived"].includes(t)) return false; return null; };
$("import-btn").onclick = () => { $("imp-file").value = ""; $("imp-file").click(); };
$("imp-file").onchange = async () => {
  const file = $("imp-file").files[0]; if (!file) return;
  const rows = parseCsv(await file.text());
  if (rows.length < 2) { toast("That file has no rows."); return; }
  const hdr = rows[0].map(h => lc(h).replace(/[^a-z0-9]/g, ""));
  const map = {}; Object.entries(HEAD).forEach(([k, al]) => { const i = hdr.findIndex(h => al.includes(h)); if (i >= 0) map[k] = i; });
  if (map.name == null) { toast("No “Item Name” column found in that file."); return; }
  const byCode = new Map(), byName = new Map();
  ITEMS.forEach(it => { if (it.productCode) byCode.set(lc(it.productCode), it); byName.set(lc(it.name) + "|" + lc(it.description), it); });
  const adds = [], updates = [], skipped = [];
  rows.slice(1).forEach(r => {
    const g = k => map[k] == null ? undefined : norm(r[map[k]]);
    const rec = {}; Object.keys(map).forEach(k => rec[k] = g(k));
    if (!rec.name) { skipped.push(r); return; }
    ["generic", "bulkPO"].forEach(k => { if (k in rec) rec[k] = bool(rec[k]); });
    if ("archived" in rec) { rec.active = bool(rec.archived) !== true; delete rec.archived; }
    else if ("active" in rec) rec.active = bool(rec.active) !== false;
    if ("itemType" in rec) rec.itemType = typeLabel(rec.itemType);
    if ("unitCost" in rec) rec.unitCost = numOrNull(rec.unitCost);
    const hit = (rec.productCode && byCode.get(lc(rec.productCode))) || byName.get(lc(rec.name) + "|" + lc(rec.description));
    if (hit) updates.push({ hit, rec }); else adds.push(rec);
  });
  const found = Object.keys(map).map(k => k === "archived" ? "Archived" : COL[k] ? COL[k].label : k);
  $("dr-title").textContent = "Import items";
  $("dr-body").innerHTML = `<p class="msg">From <b>${esc(file.name)}</b>. Columns recognised: ${esc(found.join(", "))}.</p>
    <div class="imp-sum"><b>${adds.length}</b> new items · <b>${updates.length}</b> matching existing items${skipped.length ? ` · <b>${skipped.length}</b> rows with no item name (skipped)` : ""}</div>
    <p class="msg">Existing items are matched by Product Code, then by Item Name plus Description. Only the columns in the file are changed on matched items; anything else you've entered is kept.</p>
    <label class="ck-row" style="margin-top:1rem;display:flex"><input type="checkbox" id="imp-upd" checked> Update the ${updates.length} matching items</label>
    <label class="ck-row" style="margin-top:.5rem;display:flex"><input type="checkbox" id="imp-add" checked> Add the ${adds.length} new items</label>`;
  $("dr-foot").innerHTML = `<button class="btn" id="imp-go">Import</button><button class="btn ghost" id="imp-cancel">Cancel</button><span class="msg" id="imp-msg"></span>`;
  $("imp-cancel").onclick = closeDrawer;
  $("imp-go").onclick = async () => {
    const doUpd = $("imp-upd").checked, doAdd = $("imp-add").checked;
    const ops = [], local = [];
    const st = stamp(), made = MODE === "db" ? serverTimestamp() : nowTs();
    if (doUpd) updates.forEach(({ hit, rec }) => { const merged = clean({ ...hit, ...rec }); const data = {}; Object.keys(rec).forEach(k => data[k] = merged[k]); ops.push({ type: "set", id: hit.id, data: { ...data, ...st } }); local.push(() => Object.assign(hit, data, { updatedAt: nowTs(), updatedBy: user.email })); });
    if (doAdd) adds.forEach(rec => { const id = newId(); const data = { ...clean({ category: "Uncategorized", subcategory: "Uncategorized", itemType: "Non-Inventory", ...rec }), ...st, createdAt: made, createdBy: user.email }; ops.push({ type: "set", id, data }); local.push(() => ITEMS.push({ id, ...data, updatedAt: nowTs(), createdAt: nowTs() })); });
    if (!ops.length) { closeDrawer(); return; }
    $("imp-go").disabled = true; $("imp-msg").textContent = "Saving " + ops.length + " items…";
    try { await batchWrite(ops); local.forEach(f => f()); commitLocal(); closeDrawer(); renderTree(); renderGrid(); toast(`Imported: ${doAdd ? adds.length : 0} added, ${doUpd ? updates.length : 0} updated.`); }
    catch (e) { $("imp-msg").textContent = "Import failed (" + (e.code || e) + "). Nothing after the failure was saved; run it again to finish."; $("imp-msg").className = "msg bad"; $("imp-go").disabled = false; }
  };
  document.body.classList.add("dr-open");
};

// ── Categories tab ──
document.querySelectorAll(".tabs button").forEach(b => b.onclick = () => {
  document.querySelectorAll(".tabs button").forEach(x => x.classList.toggle("on", x === b));
  const items = b.dataset.tab === "items";
  $("tab-items").style.display = items ? "" : "none"; $("tab-cats").style.display = items ? "none" : "";
  $("import-btn").style.display = $("add-btn").style.display = items ? "" : "none";
  if (!items) renderCats();
});
function renderCats() {
  const cats = mergedCats();
  const n = (c, s) => ITEMS.filter(it => lc(it.category || "Uncategorized") === lc(c) && (s === undefined || lc(it.subcategory) === lc(s))).length;
  $("cat-grid").innerHTML = cats.map((c, ci) => `<div class="cat-card">
    <div class="ch"><b>${esc(c.name)}</b><small>${n(c.name)} items</small><button class="lnk" data-rc="${ci}">Rename</button><button class="lnk danger" data-dc="${ci}" ${n(c.name) ? "disabled title=\"Move its items first\"" : ""}>Delete</button></div>
    <ul>${c.subs.map((s, si) => `<li><span>${esc(s)}</span><small>${n(c.name, s)}</small><button class="lnk" data-rs="${ci}|${si}">Rename</button><button class="lnk danger" data-ds="${ci}|${si}" ${n(c.name, s) ? "disabled title=\"Move its items first\"" : ""}>Delete</button></li>`).join("") || '<li><small>No subcategories</small></li>'}</ul>
    <div class="add-row"><input placeholder="New subcategory" data-ns="${ci}"><button class="btn ghost" data-as="${ci}">Add</button></div></div>`).join("");
  const G = $("cat-grid");
  const commit = async (msg, itemOps) => {
    try { if (itemOps && itemOps.length) await batchWrite(itemOps); await saveCats(); toast(msg); }
    catch (e) { toast("That didn't save (" + (e.code || e) + ")."); }
    renderCats(); renderTree(); renderGrid();
  };
  G.querySelectorAll("[data-as]").forEach(b => b.onclick = () => {
    const ci = +b.dataset.as, inp = G.querySelector(`[data-ns="${ci}"]`), v = norm(inp.value); if (!v) return;
    CATS = mergedCats(); if (CATS[ci].subs.some(s => lc(s) === lc(v))) { toast("That subcategory already exists."); return; }
    CATS[ci].subs.push(v); commit("Subcategory added.");
  });
  G.querySelectorAll("[data-ns]").forEach(i => i.onkeydown = e => { if (e.key === "Enter") G.querySelector(`[data-as="${i.dataset.ns}"]`).click(); });
  G.querySelectorAll("[data-rc]").forEach(b => b.onclick = () => {
    CATS = mergedCats(); const c = CATS[+b.dataset.rc]; const v = norm(prompt("Rename category", c.name)); if (!v || v === c.name) return;
    if (CATS.some(x => x !== c && lc(x.name) === lc(v))) { toast("A category with that name exists."); return; }
    const hit = ITEMS.filter(it => lc(it.category || "Uncategorized") === lc(c.name));
    hit.forEach(it => it.category = v); const old = c.name; c.name = v;
    commit(`Renamed “${old}” to “${v}” (${hit.length} items).`, hit.map(it => ({ type: "set", id: it.id, data: { category: v, updatedAt: serverTimestamp(), updatedBy: user.email } })));
  });
  G.querySelectorAll("[data-rs]").forEach(b => b.onclick = () => {
    CATS = mergedCats(); const [ci, si] = b.dataset.rs.split("|").map(Number); const c = CATS[ci], s = c.subs[si];
    const v = norm(prompt("Rename subcategory", s)); if (!v || v === s) return;
    const hit = ITEMS.filter(it => lc(it.category || "Uncategorized") === lc(c.name) && lc(it.subcategory) === lc(s));
    hit.forEach(it => it.subcategory = v); c.subs[si] = v;
    commit(`Renamed “${s}” to “${v}” (${hit.length} items).`, hit.map(it => ({ type: "set", id: it.id, data: { subcategory: v, updatedAt: serverTimestamp(), updatedBy: user.email } })));
  });
  G.querySelectorAll("[data-dc]").forEach(b => b.onclick = () => { CATS = mergedCats(); const c = CATS[+b.dataset.dc]; if (!confirm(`Delete the category “${c.name}”?`)) return; CATS.splice(+b.dataset.dc, 1); commit("Category deleted."); });
  G.querySelectorAll("[data-ds]").forEach(b => b.onclick = () => { CATS = mergedCats(); const [ci, si] = b.dataset.ds.split("|").map(Number); if (!confirm(`Delete the subcategory “${CATS[ci].subs[si]}”?`)) return; CATS[ci].subs.splice(si, 1); commit("Subcategory deleted."); });
}
$("new-cat-btn").onclick = async () => {
  const v = norm($("new-cat").value); if (!v) return;
  CATS = mergedCats(); if (CATS.some(c => lc(c.name) === lc(v))) { toast("That category already exists."); return; }
  CATS.push({ name: v, subs: [] }); $("new-cat").value = "";
  try { await saveCats(); toast("Category added."); } catch (e) { toast("That didn't save (" + (e.code || e) + ")."); }
  renderCats(); renderTree();
};
$("new-cat").onkeydown = e => { if (e.key === "Enter") $("new-cat-btn").click(); };

// ── Local mode banner + copy to database ──
function renderMode(note) {
  const b = $("mode-banner"); if (!b) return;
  if (MODE === "local") {
    b.className = "banner show warn";
    b.innerHTML = `<span><b>Working in this browser only.</b> ${esc(note || "The database isn't set up for the Item List yet, so items you add or import are saved in this browser on this computer, not shared with anyone.")} Once the updated Firestore rules are published, reload and copy them in.</span><button class="btn ghost" id="local-exp">Download backup</button>`;
    $("local-exp").onclick = () => { const v = view; view = STANDARD(); exportCsv(ITEMS, "alpine-items-backup-" + new Date().toISOString().slice(0, 10) + ".csv"); view = v; };
    return;
  }
  const loc = localLoad();
  if (loc && loc.items.length) {
    b.className = "banner show info";
    b.innerHTML = `<span><b>${loc.items.length} items</b> were saved in this browser while the database wasn't available. Copy them into the database so everyone sees them.</span><button class="btn" id="local-copy">Copy into database</button><button class="btn ghost" id="local-drop">Discard browser copy</button>`;
    $("local-copy").onclick = async () => {
      $("local-copy").disabled = true;
      try {
        const byId = new Set(ITEMS.map(x => x.id));
        const ops = loc.items.map(it => ({ type: "set", id: it.id, data: { ...clean(it), updatedAt: serverTimestamp(), updatedBy: user.email, ...(byId.has(it.id) ? {} : { createdAt: serverTimestamp(), createdBy: it.createdBy || user.email }) } }));
        await batchWrite(ops);
        if (loc.cats && loc.cats.length) { CATS = loc.cats; await saveCats(); }
        loc.items.forEach(it => { const i = ITEMS.findIndex(x => x.id === it.id); if (i >= 0) ITEMS[i] = { ...ITEMS[i], ...it }; else ITEMS.push(it); });
        localStorage.removeItem(LOCAL_KEY); renderMode(); renderTree(); renderGrid(); toast(ops.length + " items copied into the database.");
      } catch (e) { toast("Copy failed (" + (e.code || e) + ")."); $("local-copy").disabled = false; }
    };
    $("local-drop").onclick = () => { if (!confirm("Discard the items saved in this browser? Copy them in first if you still need them.")) return; localStorage.removeItem(LOCAL_KEY); renderMode(); };
    return;
  }
  b.className = "banner";
}

// ── Boot ──
user = await currentUser();
if (!user) { sessionStorage.clear(); location.href = "index.html"; }
else {
  fixView();
  $("view-name").textContent = view.name;
  try {
    const [snap, cs] = await Promise.all([getDocs(collection(db, "items_data")), getDoc(catRef())]);
    ITEMS = []; snap.forEach(d => ITEMS.push({ id: d.id, ...d.data() }));
    CATS = cs.exists() && Array.isArray(cs.data().list) ? cs.data().list : DEFAULT_CATS;
    MODE = "db";
  } catch (e) {
    // Rules not published yet (or no access): keep working in this browser.
    MODE = "local";
    const loc = localLoad();
    ITEMS = loc ? loc.items : []; CATS = loc && loc.cats && loc.cats.length ? loc.cats : DEFAULT_CATS;
    if (!(e && e.code === "permission-denied")) renderMode("The database couldn't be reached (" + (e.code || e) + "), so items are kept in this browser for now.");
  }
  renderMode(); renderTree(); renderGrid();
}
