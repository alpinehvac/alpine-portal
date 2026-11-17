// ── Alpine HVAC — Team Reports: shared definitions ───────────────────
// Used by my-reports.html (every team member) and Team Hub > Team Reports (owners).
//
// Firestore (see firestore.rules):
//   team_reports/{week}_{email}     weekly report, one per person per week (week = Monday, YYYY-MM-DD)
//   report_cards/{month}_{slug}     monthly report card from leadership (month = YYYY-MM); the person sees it once published
//   report_cards_private/{same id}  leaders' evidence / sources for that card (owners only)
//   exit_surveys/{email}            exit survey; the person can fill it while status is "sent"
//   offboarding/{slug}              offboarding checklist per departing person (owners only)

export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const slug = email => String(email || "").toLowerCase().split("@")[0].replace(/[^a-z0-9]+/g, "-");
export const initials = name => String(name || "?").split(/\s+/).map(w => w[0] || "").join("").toUpperCase().slice(0, 2);
export const PORTAL = "https://basecamp.alpinehvac.ca/";

// ── Weekly report (modelled on the EntreLeadership weekly report) ──
// Every scale is stored 1–5 where 5 is the healthy end, so averages read the same way.
export const SCALES = [
  { key: "morale",   q: "How was your morale this week?",   labels: ["Very Low", "Low", "Okay", "Good", "Great"] },
  { key: "stress",   q: "How was your stress this week?",   labels: ["Too High", "High", "Okay", "Low", "Healthy"] },
  { key: "workload", q: "How was your workload this week?", labels: ["Overwhelming", "Heavy", "Okay", "Good", "Great"] },
];
export const TEXTS = [
  { key: "high",  q: "What was your high this week?", hint: "Your personal or professional high. What's the one thing you accomplished at work this week?", req: true },
  { key: "low",   q: "What was your low this week?",  hint: "Your personal or professional low this week.", req: true },
  { key: "other", q: "Anything else?",                hint: "Anything else you'd like leadership to know: a win, a problem, something you need. Optional.", req: false },
];
export const MAXLEN = 600;

export function weekAvg(r) {
  const v = SCALES.map(s => +r[s.key]).filter(n => n >= 1 && n <= 5);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}
export function weekWord(avg) {
  if (avg == null) return "";
  return avg <= 1.8 ? "a rough week" : avg <= 2.6 ? "a tough week" : avg <= 3.4 ? "an okay week" : avg <= 4.2 ? "a good week" : "a top-notch week";
}
export const tone = v => v == null ? "" : v <= 2 ? "bad" : v < 3.5 ? "mid" : "good";
// Any 1–2 on a scale is a flag to follow up on.
export const flagged = r => SCALES.some(s => +r[s.key] > 0 && +r[s.key] <= 2);

// Weeks run Monday–Sunday and are keyed by the Monday (local date).
const pad = n => String(n).padStart(2, "0");
export const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export function parseYmd(s) { const [y, m, d] = String(s).split("-").map(Number); return new Date(y, m - 1, d); }
export function mondayOf(date) { const d = new Date(date); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d; }
export const weekKey = date => ymd(mondayOf(date));
export function addWeeks(key, n) { const d = parseYmd(key); d.setDate(d.getDate() + 7 * n); return ymd(d); }
// The week a report is "for": Monday/Tuesday default to last week (people fill it in over the weekend or Monday morning).
export function defaultWeek(now = new Date()) { const k = weekKey(now); return now.getDay() === 1 || now.getDay() === 2 ? addWeeks(k, -1) : k; }
export function weekLabel(key) {
  const a = parseYmd(key), b = parseYmd(addWeeks(key, 1)); b.setDate(b.getDate() - 1);
  const f = d => d.toLocaleDateString("en-CA", { month: "short", day: "numeric" });
  return `${f(a)} – ${f(b)}, ${b.getFullYear()}`;
}
export const reportId = (week, email) => `${week}_${String(email).toLowerCase()}`;

// ── Monthly report card ──
// Rated on Alpine's four Core Principles (Team Hub > Vision / Values).
export const PRINCIPLES = [
  { key: "grit",         name: "Grit",           line: "We choose meaningful over easy. When the call gets hard, we stay on it until it's right." },
  { key: "relentless",   name: "Relentlessness", line: "We're never done getting better. We chase feedback, own our mistakes, and act on both." },
  { key: "contribution", name: "Contribution",   line: "We make everyone around us better. We teach what we know, carry our share, and put the team's win ahead of our own credit." },
  { key: "purpose",      name: "Purpose-filled", line: "We know why the work matters beyond the paycheque, and it shows in how we leave every job." },
];
export const RATING_WORDS = ["", "Not yet", "Developing", "Solid", "Strong", "Outstanding"];
export const GRADES = ["A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D"];
export const CARD_TEXTS = [
  { key: "wins",    label: "Where you did great",        hint: "Specific wins this month: what happened, and why it mattered." },
  { key: "improve", label: "Where you can improve",      hint: "One to three specific things, with what better looks like." },
  { key: "focus",   label: "Focus for next month",       hint: "The one or two things to work on before the next card." },
  { key: "note",    label: "Note from leadership",       hint: "Optional. A personal word from Jake and Mike." },
];
export const cardId = (month, email) => `${month}_${slug(email)}`;
export const monthKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
export function monthLabel(key) { const [y, m] = key.split("-").map(Number); return new Date(y, m - 1, 1).toLocaleDateString("en-CA", { month: "long", year: "numeric" }); }
export function addMonths(key, n) { const [y, m] = key.split("-").map(Number); return monthKey(new Date(y, m - 1 + n, 1)); }

// ── Exit survey ──
// type: scale (1–5), nps (0–10), choice, multi, text
export const EXIT_SURVEY = [
  { key: "overall", type: "scale", q: "Overall, how would you rate your time at Alpine?", labels: ["Poor", "Below average", "Okay", "Good", "Excellent"] },
  { key: "reasons", type: "multi", q: "What are the main reasons you're leaving? Pick all that apply.",
    options: ["Pay or benefits", "A better career opportunity", "Type of work", "Workload or hours", "Scheduling / time off", "Leadership or management", "Team or culture", "Training and growth", "Tools, vehicle or equipment", "Commute or location", "Personal or family", "Other"] },
  { key: "reasonDetail", type: "text", q: "Tell us more about why you decided to leave." },
  { key: "turningPoint", type: "text", q: "Was there a moment you decided to leave? What could we have done that would have changed your decision?" },
  { key: "rate", type: "grid", q: "Rate Alpine on each of these.", labels: ["Poor", "Below average", "Okay", "Good", "Excellent"],
    rows: [
      ["leadership", "Support from leadership (Jake and Mike)"],
      ["clarity", "Clear expectations and communication"],
      ["planning", "Job planning and scheduling"],
      ["tools", "Tools, equipment, vehicle and materials"],
      ["training", "Training and room to grow"],
      ["pay", "Pay and benefits"],
      ["workload", "Workload and hours"],
      ["team", "Teamwork and culture"],
    ] },
  { key: "didWell", type: "text", q: "What does Alpine do well that we should keep doing?" },
  { key: "improve", type: "text", q: "What is the one thing we should fix first? Be as direct as you like." },
  { key: "roleNeeds", type: "text", q: "What did you need to do your job well that you didn't have? (Information, support, people, tools, authority)" },
  { key: "principles", type: "text", q: "Our Core Principles are Grit, Relentlessness, Contribution and Purpose-filled. Where did you see us live them, and where did we fall short?" },
  { key: "nps", type: "nps", q: "How likely are you to recommend Alpine to a tradesman you know as a place to work?" },
  { key: "return", type: "choice", q: "Would you consider working with Alpine again in the future?", options: ["Yes", "Maybe", "No"] },
  { key: "handoff", type: "text", q: "Anything the next person needs to know? Open jobs, customer contacts, site quirks, where things are." },
  { key: "other", type: "text", q: "Anything else you'd like to share?" },
];

// ── Offboarding checklist template ──
// due: days relative to the last day (negative = before). party: who owns the step.
export const PARTIES = [
  { key: "employee", label: "Departing team member" },
  { key: "jake",     label: "Jake (owner)" },
  { key: "mike",     label: "Mike (operations)" },
  { key: "clarissa", label: "Clarissa (admin & payroll)" },
  { key: "cole",     label: "Cole (support & purchasing)" },
];
export const OFFBOARD_TEMPLATE = [
  // Departing team member
  ["employee", -3, "Fill in the exit survey in Basecamp (My Weekly Report > Exit survey)"],
  ["employee", -3, "Write a status note for every open job: what's done, what's left, materials on site or on order, customer contact"],
  ["employee", -2, "Walk Mike (and whoever is taking over) through each in-flight job on site or by phone"],
  ["employee", -1, "Submit final timesheets and all expense receipts, tagged with PO numbers"],
  ["employee", 0, "Return keys, fobs and customer site access cards (list each building)"],
  ["employee", 0, "Return company phone/tablet, tools, meters, gas detector, PPE and any shop inventory"],
  ["employee", 0, "Return company vehicle (if assigned): keys, fuel card, cleaned out, mileage and condition noted"],
  ["employee", 0, "Give Clarissa a personal email and mailing address for the final pay stub, ROE and T4"],
  // Jake
  ["jake", -5, "Send the exit survey from Team Hub > Team Reports > Offboarding"],
  ["jake", -3, "Read the exit survey answers; log takeaways and actions below"],
  ["jake", 0, "Basecamp: set the person inactive in Users & Settings (end of last day)"],
  ["jake", 0, "Microsoft 365: block sign-in, set an auto-reply, forward or convert the mailbox to shared (Mike), remove from Teams groups"],
  ["jake", 1, "Remove from BuildOps (free the licence), Fireflies, and any other software seats"],
  ["jake", 1, "Remove from the weekly report email list and Team Files roster; update crew structure and role coverage"],
  ["jake", 3, "Close out any foreman premium / efficiency bonus pool amounts owed with Clarissa"],
  ["jake", 7, "Review exit-survey actions with Mike at the next leadership meeting"],
  // Mike
  ["mike", -5, "Plan coverage: reassign every open job, visit and project to a named person"],
  ["mike", -3, "Reassign the person's BuildOps visits and Crew Board schedule after the last day"],
  ["mike", -2, "Tell customers and GCs where this person was the main contact, and introduce the new contact"],
  ["mike", -1, "Hold a 20-minute in-person exit conversation (after the survey is in)"],
  ["mike", 0, "Check tools, meters and inventory against what was issued; collect keys, fobs and access cards"],
  ["mike", 0, "Inspect and collect the company vehicle (if assigned)"],
  // Clarissa
  ["clarissa", -3, "Confirm last day in writing and file the resignation / termination letter in the SharePoint employee folder"],
  ["clarissa", 0, "Final pay: all hours worked plus any premium owed, paid within 7 days of the last day or by the next regular payday, whichever is later (Ontario ESA)"],
  ["clarissa", 0, "Pay out all outstanding vacation pay with the final pay"],
  ["clarissa", 5, "Issue the Record of Employment (ROE) to Service Canada within 5 days after the end of the pay period with the last day"],
  ["clarissa", 1, "End benefits / group insurance and stop deductions; let the provider know"],
  ["clarissa", 1, "Cancel fuel card and any company credit card; reconcile open expenses"],
  ["clarissa", 1, "QuickBooks payroll: enter the termination date; T4 goes to the address on file by end of February"],
  // Cole
  ["cole", 0, "Remove the person as an authorized buyer at suppliers and on PO numbers"],
  ["cole", 0, "Reassign open quotes, orders and deliveries tied to the person's jobs"],
];
export const REASONS = ["Resignation", "Termination", "Layoff / shortage of work", "Contract end", "Retirement"];
export function dueDate(lastDay, offset) { const d = parseYmd(lastDay); d.setDate(d.getDate() + (offset || 0)); return ymd(d); }
export function niceDate(key, opts) { if (!key) return ""; return parseYmd(key).toLocaleDateString("en-CA", opts || { weekday: "short", month: "short", day: "numeric" }); }

// Report card as the team member sees it (my-reports.html); Team Hub shows the same preview.
export function cardHtml(c, opts = {}) {
  const pr = PRINCIPLES.map(p => { const v = +(c.ratings || {})[p.key] || 0; return `
    <div class="pr"><span class="nm">${esc(p.name)}</span><div class="bar"><i style="width:${v * 20}%"></i></div><span class="w">${v ? esc(RATING_WORDS[v]) : "–"}</span></div>`; }).join("");
  const sec = (k, cls) => { const t = CARD_TEXTS.find(x => x.key === k); return c[k] ? `<div class="rc-sec ${cls}"><h3>${esc(t.label)}</h3><p>${esc(c[k])}</p></div>` : ""; };
  return `<article class="rc">
    <div class="rc-head"><img src="images/alpine-logo-white.png" alt="Alpine HVAC">
      <div class="t"><small>Monthly report card</small><b>${esc(monthLabel(c.month))}</b><div style="font-size:.85rem;color:#D8ECEC">${esc(c.name)}</div></div>
      ${c.grade ? `<div class="rc-grade"><small>Overall</small>${esc(c.grade)}</div>` : ""}</div>
    <div class="rc-body">${pr}${sec("wins", "good")}${sec("improve", "grow")}${sec("focus", "")}${sec("note", "")}
    ${opts.foot || ""}</div></article>`;
}
