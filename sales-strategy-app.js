// ── Alpine HVAC Internal Portal — Sales Strategy ──────────────────────
// Editable, collaborative playbook. Sections persist through localStorage
// (synced to Firestore by cloud-sync.js), same pattern as Team Hub's
// recruiting question lists.

const SS_KEY = "alpine_sales_strategy_sections";

const SS_DEFAULTS = [
  {
    title: "Who We're Selling To (The Alpine Customer Filter)",
    notes: "We are out to find Alpine Customers, not just to fill the schedule. Our price reflects the value we've described and/or demonstrated. Not every prospect is an Alpine Customer — some are purely reactionary and will never value proactive partnership. Recognize this as early as possible so we don't waste time that should go to the Alpine Customers waiting for us to come knocking.",
    bullets: [],
  },
  {
    title: "Uncovering Value (Discovery Questions)",
    notes: "Questions and framing that get the customer talking about what actually matters to them before we pitch anything.",
    bullets: [
      "What made you decide to reach out now instead of six months ago?",
      "What's happened in the past with a system breaking down at the worst possible time?",
      "Who else is affected if this system goes down — tenants, staff, production?",
    ],
  },
  {
    title: "Speed & Price Structure (First-Call Strategy)",
    notes: "The mechanics of how we use the first service call from a new (non-contract) client to convert them into a contract partner, and what happens if they decline.\n\nNew lead, first service request: we prioritize it as if the caller were already a contract customer — this one time. On that first call we demonstrate our value and capability, and in the same motion offer to sign them as a contract partner.\n\nPricing on that first call: billed at $130/hr (maintenance rate) as a one-time introductory rate. The invoice can be waived if they sign a service agreement — but that waiver is not always offered upfront. Hold it back as a lever to close later in the conversation if needed, rather than leading with it.\n\nIf they decline the agreement: they become \"repeat retail.\" Future service is scheduled as capacity allows (not prioritized) and billed at the retail rate — $200/hr, 50% above the contract rate.\n\nWhy: incentivize proactive, relationship-based service and discourage one-off reactive calls that strain operations and put our reputation at risk.",
    bullets: [
      "First-ever call from a new lead = treated like a contract customer, priority-wise. One time only.",
      "Show value/capability and offer the agreement in the same call — don't split it into a follow-up.",
      "Intro rate: $130/hr (maintenance rate), one-time only.",
      "Invoice waiver if they sign — held in reserve as a closing lever, not always offered upfront.",
      "Decline = \"repeat retail\": lower scheduling priority, $200/hr retail rate going forward.",
    ],
  },
  {
    title: "Service Agreement Pitch",
    notes: "How we frame agreements as protecting uptime and budget, not just \"a maintenance plan.\"",
    bullets: [
      "Lead with risk avoidance and predictable cost, not a checklist of what's included.",
      "Tie the tier back to the specific equipment and consequences of failure we just discussed.",
    ],
  },
  {
    title: "Job / Project Pitch",
    notes: "",
    bullets: [],
  },
  {
    title: "Articulating Value Savings (Case Studies)",
    notes: "PLACEHOLDER — Jake to backfill with specific case studies (real dollar figures: cost of a reactive breakdown/downtime vs. cost of an agreement that would have caught it). Once we have a handful, pull the pattern into reusable talking points below.",
    bullets: [],
  },
  {
    title: "Objection Handling",
    notes: "Common pushback and how we've found success responding to it.",
    bullets: [
      "\"I can get it cheaper elsewhere\" — reframe around response time, technician quality, and what's actually in the price.",
      "\"I need to think about it\" — find out what specifically they need to think through, don't just leave it open.",
    ],
  },
  {
    title: "Closing Techniques",
    notes: "",
    bullets: [
      "Service agreement closing meeting: don't take the meeting unless all decision-makers are present. Reschedule rather than pitch to a partial room.",
    ],
  },
  {
    title: "BDR Feedback Log",
    notes: "Running notes from the BDR and the field on what's landing with customers and what isn't. Date-stamp entries so we can see how thinking evolves.",
    bullets: [],
  },
];

function ssLoad() {
  try {
    const raw = localStorage.getItem(SS_KEY);
    if (!raw || raw === "null") return ssSeed();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return ssSeed();
    return parsed;
  } catch (e) {
    return ssSeed();
  }
}

function ssSeed() {
  const seeded = SS_DEFAULTS.map(s => ({
    id: ssUid(),
    title: s.title,
    notes: s.notes,
    collapsed: false,
    bullets: s.bullets.map(b => ({ id: ssUid(), text: b })),
  }));
  ssSave(seeded);
  return seeded;
}

function ssUid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

let ssFlagTimer = null;
function ssSave(sections) {
  localStorage.setItem(SS_KEY, JSON.stringify(sections));
  ssFlashSaved();
}

function ssFlashSaved() {
  const flag = document.getElementById("ss-saved-flag");
  if (!flag) return;
  flag.classList.add("show");
  clearTimeout(ssFlagTimer);
  ssFlagTimer = setTimeout(() => flag.classList.remove("show"), 1100);
}

function ssEsc(str) {
  const d = document.createElement("div");
  d.textContent = str || "";
  return d.innerHTML;
}

let ssSections = ssLoad();

function ssRender() {
  const wrap = document.getElementById("ss-sections");
  if (ssSections.length === 0) {
    wrap.innerHTML = '<div class="empty">No sections yet. Click "+ Add Section" to start building the playbook.</div>';
    return;
  }
  wrap.innerHTML = ssSections.map((sec, si) => `
    <div class="section-card${sec.collapsed ? " collapsed" : ""}" data-si="${si}">
      <div class="section-head" onclick="ssToggleCollapse(${si}, event)">
        <span class="section-chevron">▾</span>
        <input class="section-title-input" value="${ssEsc(sec.title)}" placeholder="Section title…"
          oninput="ssUpdateTitle(${si}, this.value)" onclick="event.stopPropagation()" />
        <span class="section-count">${sec.bullets.length} point${sec.bullets.length === 1 ? "" : "s"}</span>
        <button class="section-del" onclick="event.stopPropagation();ssDeleteSection(${si})" title="Delete section">×</button>
      </div>
      <div class="section-body">
        <div class="subhead">Talking Points</div>
        <div class="bullets" id="ss-bullets-${si}">
          ${sec.bullets.map((b, bi) => `
            <div class="bullet-row">
              <span class="bullet-dot">•</span>
              <textarea class="bullet-text" rows="1" placeholder="Add a talking point…"
                oninput="ssUpdateBullet(${si},${bi},this.value);ssAutoGrow(this)"
                data-si="${si}" data-bi="${bi}">${ssEsc(b.text)}</textarea>
              <button class="bullet-del" onclick="ssDeleteBullet(${si},${bi})" title="Remove">×</button>
            </div>
          `).join("")}
        </div>
        <button class="add-bullet-btn" onclick="ssAddBullet(${si})">+ Add Talking Point</button>

        <div class="subhead">Notes</div>
        <textarea class="notes-box" placeholder="Freeform notes, context, or feedback for this section…"
          oninput="ssUpdateNotes(${si}, this.value)">${ssEsc(sec.notes)}</textarea>
      </div>
      <div class="meta-row"><span>Section ${si + 1} of ${ssSections.length}</span></div>
    </div>
  `).join("");

  wrap.querySelectorAll(".bullet-text").forEach(ssAutoGrow);
}

function ssAutoGrow(el) {
  el.style.height = "auto";
  el.style.height = el.scrollHeight + "px";
}

function ssAddSection() {
  ssSections.push({ id: ssUid(), title: "New Section", notes: "", collapsed: false, bullets: [] });
  ssSave(ssSections);
  ssRender();
  // Focus the new section's title for immediate renaming.
  const inputs = document.querySelectorAll(".section-title-input");
  const last = inputs[inputs.length - 1];
  if (last) { last.focus(); last.select(); }
}

function ssDeleteSection(si) {
  const sec = ssSections[si];
  if (!confirm(`Delete "${sec.title || "this section"}"? This can't be undone.`)) return;
  ssSections.splice(si, 1);
  ssSave(ssSections);
  ssRender();
}

function ssToggleCollapse(si, evt) {
  if (evt && evt.target && evt.target.classList.contains("section-title-input")) return;
  ssSections[si].collapsed = !ssSections[si].collapsed;
  ssSave(ssSections);
  ssRender();
}

function ssUpdateTitle(si, val) {
  ssSections[si].title = val;
  ssSave(ssSections);
}

function ssUpdateNotes(si, val) {
  ssSections[si].notes = val;
  ssSave(ssSections);
}

function ssAddBullet(si) {
  ssSections[si].bullets.push({ id: ssUid(), text: "" });
  ssSave(ssSections);
  ssRender();
  const rows = document.querySelectorAll(`#ss-bullets-${si} .bullet-text`);
  const last = rows[rows.length - 1];
  if (last) last.focus();
}

function ssUpdateBullet(si, bi, val) {
  ssSections[si].bullets[bi].text = val;
  ssSave(ssSections);
}

function ssDeleteBullet(si, bi) {
  ssSections[si].bullets.splice(bi, 1);
  ssSave(ssSections);
  ssRender();
}

ssRender();
