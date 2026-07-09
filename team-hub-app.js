// ── DATA MANAGER ──
const DM_KEYS = ['alpine_reviews_v1','alpine_review_questions_v1','alpine_foreman_standards','alpine_bdr_candidates','alpine_tech_candidates','alpine_sr_q1','alpine_sr_q2','alpine_sr_q3','alpine_onboarding_v2'];

function openDataManager() {
  document.getElementById('dm-import-field').value = '';
  document.getElementById('dm-status').className = 'dm-status';
  document.getElementById('dm-status').textContent = '';
  document.getElementById('dm-modal').classList.add('open');
}
function closeDM() {
  document.getElementById('dm-modal').classList.remove('open');
}

function dmExport() {
  const bundle = {};
  DM_KEYS.forEach(k => {
    const val = localStorage.getItem(k);
    if (val) bundle[k] = val;
  });
  if (!Object.keys(bundle).length) {
    alert('No saved data found yet. Add some reviews or notes first.');
    return;
  }
  const json = JSON.stringify(bundle);
  navigator.clipboard.writeText(json).then(() => {
    const btn = event.currentTarget;
    const orig = btn.textContent;
    btn.textContent = '✓ Copied to Clipboard!';
    btn.style.color = 'var(--teal-light)';
    setTimeout(() => { btn.textContent = orig; btn.style.color = ''; }, 2500);
  }).catch(() => {
    prompt('Copy this data manually:', json);
  });
}

function dmImport() {
  const raw = document.getElementById('dm-import-field').value.trim();
  const status = document.getElementById('dm-status');
  if (!raw) {
    status.className = 'dm-status err';
    status.textContent = 'Please paste your exported data first.';
    return;
  }
  try {
    const bundle = JSON.parse(raw);
    let count = 0;
    // Import ALL keys from the bundle — not just the hardcoded list
    // This ensures data from older versions of the file is fully restored
    Object.keys(bundle).forEach(k => {
      if (bundle[k] !== null && bundle[k] !== undefined && bundle[k] !== 'null') {
        try {
          localStorage.setItem(k, bundle[k]);
          count++;
        } catch(e) {}
      }
    });
    if (!count) throw new Error('No data found in pasted bundle.');
    status.className = 'dm-status ok';
    status.textContent = `✓ Data restored successfully (${count} item${count>1?'s':''} imported). Refreshing…`;
    setTimeout(() => location.reload(), 1400);
  } catch(e) {
    status.className = 'dm-status err';
    status.textContent = 'Invalid data — make sure you pasted the full exported text without edits.';
  }
}


// (script block boundary)


/* ── SR TAB SWITCHING ── */
function srTab(id) {
  document.querySelectorAll('#panel-sales-recruiting .sr-tab').forEach((t,i) => {
    t.classList.toggle('active', t.getAttribute('onclick').includes(id));
  });
  document.querySelectorAll('#panel-sales-recruiting .sr-panel').forEach(p => {
    p.classList.toggle('active', p.id === id);
  });
  // Re-render questions after panel becomes visible so autoGrow works
  if (id === 'sr-int1') setTimeout(() => srRenderQ('sr-q-list-1'), 0);
  if (id === 'sr-int2') setTimeout(() => srRenderQ('sr-q-list-2'), 0);
  if (id === 'sr-int3') setTimeout(() => srRenderQ('sr-q-list-3'), 0);
}

/* ── TC TAB SWITCHING (TECH RECRUITING: OVERVIEW / CANDIDATES) ── */
function tcTab(id) {
  document.querySelectorAll('#panel-recruiting .sr-tab').forEach((t) => {
    t.classList.toggle('active', t.getAttribute('onclick').includes(id));
  });
  document.querySelectorAll('#panel-recruiting .sr-panel').forEach(p => {
    p.classList.toggle('active', p.id === id);
  });
}

/* ── QUESTIONS ── */
const SR_DEFAULT_Q1 = [
  {text:'Tell me about yourself.',note:'Listen for energy, clarity, and whether they naturally talk about results vs. responsibilities.'},
  {text:'Tell me one good thing and one bad thing about your current or most recent employer.',note:'Green: balanced and specific. Red: excessive negativity or complete deflection.'},
  {text:'What are you looking to get out of this role?',note:'Listen for growth, challenge, earning potential. Flag if purely compensation-driven.'},
  {text:'Let me tell you about Alpine HVAC in 30 seconds — where do you see yourself fitting in?',note:'Brief Alpine overview, then listen for self-awareness and fit recognition.'},
  {text:'What questions do you have for me?',note:'Thoughtful questions indicate genuine interest. Silence is a flag.'},
  {text:'If this feels like a mutual fit — would you be open to a second interview?',note:'If yes: schedule. If no mutual fit: advise you will follow up regardless of outcome.'}
];
const SR_DEFAULT_Q3 = [
  {text:'You\'ll be required to record and review every sales call. How do you feel about that level of accountability?', note:'Listen for genuine comfort, not just compliance. Discomfort here is a signal.'},
  {text:'Self-development is an expectation here — 1 book per month, 1 course per year minimum. What does your learning habit look like today?', note:'Do they already invest in themselves, or would this be a new behaviour forced on them?'},
  {text:'After year 1, this role transitions from a $40K base to full commission. Walk me through how you\'re thinking about that.', note:'Motivated candidates get excited. Anxious ones fixate on the risk. Watch the energy, not just the words.'},
  {text:'All contacts you develop belong to Alpine — not to you personally. How do you feel about that structure?', note:'Non-negotiable. Any pushback on this is disqualifying.'}
];
const SR_DEFAULT_Q2 = [
  {text:'Walk me through a deal you\'re proud of — from first contact to close.',note:'Listen for process, not just outcome. Do they know their own sales motion?'},
  {text:'Tell me about a deal you lost. What happened and what would you do differently?',note:'Self-awareness and ownership are the signal here. Blame is a red flag.'},
  {text:'How do you typically build a territory from scratch — what does week one look like for you?',note:'A true hunter will have a clear answer. Vagueness suggests they\'ve only worked warm pipelines.'},
  {text:'What does your typical prospecting week look like — how many touches, what methods?',note:'Look for specifics: call volume, door knocking, email sequences. Generic answers are a flag.'},
  {text:'How do you handle a prospect who keeps saying "not right now"?',note:'Persistence without pushiness is the target. Both giving up and being aggressive are wrong.'},
  {text:'This role hands off clients to an account manager after onboarding. How do you feel about that structure?',note:'A hunter will be relieved. If they push back on not owning the account, that\'s a mismatch.'},
  {text:'What do you know about building automation systems or commercial HVAC service agreements?',note:'They don\'t need to know the tech — but curiosity and willingness to learn are non-negotiable.'},
  {text:'Walk me through the longest sales cycle you\'ve managed. How did you keep momentum?',note:'Commercial HVAC deals take 3–12 months. Tests patience, follow-through, and pipeline management.'}
];

function srLoadQ(key, defaults) {
  try { const v = localStorage.getItem(key); if (!v || v === 'null') return defaults.map(q=>({...q})); const p = JSON.parse(v); return Array.isArray(p) && p.length ? p : defaults.map(q=>({...q})); } catch(e) { return defaults.map(q=>({...q})); }
}
const srQuestions = {
  'sr-q-list-1': srLoadQ('alpine_sr_q1', SR_DEFAULT_Q1),
  'sr-q-list-2': srLoadQ('alpine_sr_q2', SR_DEFAULT_Q2),
  'sr-q-list-3': srLoadQ('alpine_sr_q3', SR_DEFAULT_Q3)
};
const srQKeys = {'sr-q-list-1':'alpine_sr_q1','sr-q-list-2':'alpine_sr_q2','sr-q-list-3':'alpine_sr_q3'};

function srSaveQ(listId) { localStorage.setItem(srQKeys[listId], JSON.stringify(srQuestions[listId])); }
function srEsc(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function srAutoGrow(el) { el.style.height='auto'; el.style.height=el.scrollHeight+'px'; }

function srRenderQ(listId) {
  const el = document.getElementById(listId); if(!el) return;
  el.innerHTML = '';
  srQuestions[listId].forEach((q, i) => {
    const li = document.createElement('li'); li.className='sr-q-item';
    li.innerHTML = `<div class="sr-q-row"><span class="sr-q-num">${i+1}</span><div class="sr-q-body"><textarea class="sr-q-text" rows="1" oninput="srUpdateQ('${listId}',${i},'text',this);srAutoGrow(this)">${srEsc(q.text)}</textarea><textarea class="sr-q-note" rows="1" placeholder="Add a note for the interviewer…" oninput="srUpdateQ('${listId}',${i},'note',this);srAutoGrow(this)">${srEsc(q.note||'')}</textarea></div><button class="sr-q-del" onclick="srDeleteQ('${listId}',${i})">×</button></div>`;
    el.appendChild(li);
  });
  el.querySelectorAll('textarea').forEach(srAutoGrow);
}
function srUpdateQ(listId, i, field, el) { srQuestions[listId][i][field] = el.value; srSaveQ(listId); }
function srDeleteQ(listId, i) { if(srQuestions[listId].length<=1) return; srQuestions[listId].splice(i,1); srSaveQ(listId); srRenderQ(listId); }
function srAddQ(listId) { srQuestions[listId].push({text:'',note:''}); srSaveQ(listId); srRenderQ(listId); const last = document.getElementById(listId).lastElementChild; if(last) last.querySelector('.sr-q-text').focus(); }

srRenderQ('sr-q-list-1');
srRenderQ('sr-q-list-2');
srRenderQ('sr-q-list-3');

/* ── CANDIDATE TRACKER (SALES) ── */
const SR_CANDS_KEY = 'alpine_bdr_candidates';
function srLoadCands() {
  try {
    const v = localStorage.getItem(SR_CANDS_KEY);
    if (!v || v === 'null') return [];
    const p = JSON.parse(v);
    if (!Array.isArray(p)) return [];
    // Assign stable IDs to any candidates that don't have one (old BDR format)
    let changed = false;
    p.forEach((c, i) => {
      if (!c.id) { c.id = Date.now() + i; changed = true; }
    });
    if (changed) localStorage.setItem(SR_CANDS_KEY, JSON.stringify(p));
    return p;
  } catch(e) { return []; }
}
function srSaveCands(c) { localStorage.setItem(SR_CANDS_KEY, JSON.stringify(c)); }

let srCands = srLoadCands();
let srEditingId = null;
let srCurrentId = null;

const SR_POS_TRAITS = ['Hungry','Humble','Smart','Motivated','Process-driven','Curious','Honest','Long tenure'];
const SR_NEG_TRAITS = ['Late','Unpresentable','Asked about comp','Blamed employer','No long tenure','Wants warm leads','Vague on process'];

function srToggleChip(el, color) {
  const cls = 'sel-'+color;
  el.classList.toggle(cls);
}
function srGetSelectedChips(containerId) {
  return Array.from(document.querySelectorAll('#'+containerId+' .sr-chip.sel-green')).map(c=>c.dataset.val);
}
function srGetSelectedRedChips(containerId) {
  return Array.from(document.querySelectorAll('#'+containerId+' .sr-chip.sel-red')).map(c=>c.dataset.val);
}
function srResetChips() {
  document.querySelectorAll('#sr-pos-chips .sr-chip').forEach(c=>c.classList.remove('sel-green','sel-red'));
  document.querySelectorAll('#sr-neg-chips .sr-chip').forEach(c=>c.classList.remove('sel-green','sel-red'));
}
function srToggleEval(el) { el.classList.toggle('checked'); }
function srGetEvalTraits() {
  return Array.from(document.querySelectorAll('#sr-modal-eval-grid .sr-eval-item.checked')).map(el=>el.dataset.val);
}
function srSetEvalTraits(vals) {
  document.querySelectorAll('#sr-modal-eval-grid .sr-eval-item').forEach(el=>{
    el.classList.toggle('checked', (vals||[]).includes(el.dataset.val));
  });
}
function srResetEval() { document.querySelectorAll('#sr-modal-eval-grid .sr-eval-item').forEach(el=>el.classList.remove('checked')); }
function srSetChips(posTraits, negTraits) {
  srResetChips();
  document.querySelectorAll('#sr-pos-chips .sr-chip').forEach(c=>{ if((posTraits||[]).includes(c.dataset.val)) c.classList.add('sel-green'); });
  document.querySelectorAll('#sr-neg-chips .sr-chip').forEach(c=>{ if((negTraits||[]).includes(c.dataset.val)) c.classList.add('sel-red'); });
}

function srOpenModal(id) {
  srEditingId = id||null;
  document.getElementById('sr-modal-title').textContent = id ? 'Edit Candidate' : 'Add Candidate';
  if(id) {
    const c = srCands.find(x=>x.id===id); if(!c) return;
    document.getElementById('srf-name').value = c.name||'';
    document.getElementById('srf-date').value = c.date||'';
    document.getElementById('srf-stage').value = c.stage||'Interview 1';
    document.getElementById('srf-decision').value = c.decision||'pending';
    document.getElementById('srf-score').value = c.score||'';
    srSetChips(c.posTraits, c.negTraits);
    srSetEvalTraits(c.evalTraits);
  } else {
    document.getElementById('srf-name').value=''; document.getElementById('srf-date').value='';
    document.getElementById('srf-stage').value='Interview 1'; document.getElementById('srf-decision').value='pending';
    document.getElementById('srf-score').value=''; srResetChips(); srResetEval();
  }
  document.getElementById('sr-modal').classList.add('open');
}
function srCloseModal() { document.getElementById('sr-modal').classList.remove('open'); }
function srSaveCandidate() {
  const name = document.getElementById('srf-name').value.trim(); if(!name){alert('Please enter a name.');return;}
  const cand = {
    id: srEditingId || Date.now(),
    name, date: document.getElementById('srf-date').value,
    stage: document.getElementById('srf-stage').value,
    decision: document.getElementById('srf-decision').value,
    score: document.getElementById('srf-score').value,
    posTraits: srGetSelectedChips('sr-pos-chips'),
    negTraits: srGetSelectedRedChips('sr-neg-chips'),
    evalTraits: srGetEvalTraits(),
    interviews: srEditingId ? (srCands.find(x=>x.id===srEditingId)||{}).interviews||[{},{},{}] : [{},{},{}]
  };
  if(srEditingId) { const idx=srCands.findIndex(x=>x.id===srEditingId); if(idx>-1) srCands[idx]=cand; }
  else srCands.unshift(cand);
  srSaveCands(srCands); srCloseModal(); srRenderCands();
}
function srDeleteCurrent() {
  if(!confirm('Remove this candidate?')) return;
  srCands = srCands.filter(x=>x.id!==srCurrentId);
  srSaveCands(srCands); srCloseFile(); srRenderCands();
}
function srEditCurrent() { srOpenModal(srCurrentId); }

function srRenderCands() {
  const buckets = {'Interview 1':'sr-bucket-i1','Interview 2':'sr-bucket-i2'};
  ['sr-bucket-i1','sr-bucket-i2','sr-bucket-later'].forEach(id => {
    document.getElementById(id).innerHTML = '';
  });
  if (!srCands.length) {
    document.getElementById('sr-bucket-i1').innerHTML = '<div class="sr-empty">No candidates yet. Click "+ Add Candidate" to get started.</div>';
    return;
  }
  srCands.forEach(c => {
    const initials = c.name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
    const decBadge = c.decision==='advance'?'sr-badge-advance':c.decision==='pass'?'sr-badge-pass':'sr-badge-pending';
    const decLabel = c.decision==='advance'?'Advance':c.decision==='pass'?'Pass':'Pending';
    const dateStr = c.date ? new Date(c.date+'T00:00:00').toLocaleDateString('en-CA',{month:'short',day:'numeric',year:'numeric'}) : '';
    const row = document.createElement('div');
    row.className = 'sr-cand-row';
    row.innerHTML = `
      <div style="width:32px;height:32px;border-radius:50%;background:rgba(28,107,110,0.2);display:flex;align-items:center;justify-content:center;font-family:'Oswald',sans-serif;font-size:.75rem;font-weight:700;color:var(--teal-light);flex-shrink:0">${initials}</div>
      <div style="flex:1"><div class="sr-cand-name">${c.name}</div><div class="sr-cand-meta">${c.stage||''}${dateStr?' · '+dateStr:''}</div></div>
      <div class="sr-badges">
        ${c.score?`<span class="sr-badge sr-badge-score">${c.score}/10</span>`:''}
        <span class="sr-badge ${decBadge}">${decLabel}</span>
      </div>`;
    // Use closure to capture correct candidate id
    row.addEventListener('click', (function(candId){ return function(){ srOpenFile(candId); }; })(c.id));
    const targetId = buckets[c.stage] || 'sr-bucket-later';
    document.getElementById(targetId).appendChild(row);
  });
  ['sr-bucket-i1','sr-bucket-i2','sr-bucket-later'].forEach(id => {
    if (!document.getElementById(id).children.length) {
      document.getElementById(id).innerHTML = '<div class="sr-empty">No candidates at this stage.</div>';
    }
  });
}

function srOpenFile(id) {
  srCurrentId = id;
  // Use loose equality (==) to match regardless of whether id is string or number
  const c = srCands.find(x => x.id == id); if (!c) return;
  document.getElementById('sr-file-name').textContent = c.name;
  const decBadge = c.decision==='advance'?'sr-badge-advance':c.decision==='pass'?'sr-badge-pass':'sr-badge-pending';
  const decLabel = c.decision==='advance'?'Advance':c.decision==='pass'?'Pass':'Pending';
  document.getElementById('sr-file-badges').innerHTML = `<span class="sr-badge ${decBadge}" style="margin-left:8px">${decLabel}</span>${c.score?`<span class="sr-badge sr-badge-score" style="margin-left:4px">${c.score}/10</span>`:''}`;
  const traitsHtml = (c.posTraits||[]).map(t=>`<span class="sr-chip sel-green" style="cursor:default">${t}</span>`).join('')+(c.negTraits||[]).map(t=>`<span class="sr-chip sel-red" style="cursor:default">${t}</span>`).join('');
  document.getElementById('sr-file-traits').innerHTML = traitsHtml;

  // Render Alpine eval framework scorecard (read-only)
  const SR_EVAL_FRAMEWORK = [
    {val:'Engaging', label:'Engaging'},
    {val:'Empathetic', label:'Empathetic'},
    {val:'The Skill of Listening', label:'The Skill of Listening'},
    {val:'Persistence', label:'Persistence'},
    {val:'Integrity', label:'Integrity'},
    {val:'Knowledge', label:'Knowledge / Curiosity'}
  ];
  const evalChecked = c.evalTraits || [];
  const evalCount = evalChecked.length;
  const evalGrid = document.getElementById('sr-file-eval-grid');
  const evalSection = document.getElementById('sr-file-eval');
  evalGrid.innerHTML = SR_EVAL_FRAMEWORK.map(t => {
    const checked = evalChecked.includes(t.val);
    return `<div class="sr-eval-item${checked?' checked':''}">
      <div class="sr-eval-check"><span class="sr-eval-check-mark">✓</span></div>
      <div class="sr-eval-label">${t.label}</div>
    </div>`;
  }).join('');
  // Update subtitle with count
  const subtitle = evalSection.querySelector('.sr-eval-title span');
  if(subtitle) subtitle.textContent = evalCount > 0 ? `${evalCount} of 6 observed` : 'Not yet evaluated';

  // Handle both new format (interviews array) and old BDR format (flat notes/date fields)
  let interviews = c.interviews;
  if (!interviews || !Array.isArray(interviews)) {
    interviews = [
      { date: c.date||'', score: c.score||'', decision: c.decision||'pending', interviewer: '', notes: c.notes||'', summary: '' },
      {}, {}
    ];
  }
  // Field IDs map to interview index
  const fieldSets = [
    ['sri1-date','sri1-score','sri1-decision','sri1-interviewer','sri1-notes','sri1-summary'],
    ['sri2-date','sri2-score','sri2-decision','sri2-interviewer','sri2-notes','sri2-summary'],
    ['sri3-date','sri3-score','sri3-decision','sri3-interviewer','sri3-notes','sri3-refs']
  ];
  const keys = ['date','score','decision','interviewer','notes','summary'];
  fieldSets.forEach((flds, i) => {
    const iv = interviews[i] || {};
    flds.forEach((fid, j) => { const el = document.getElementById(fid); if (el) el.value = iv[keys[j]] || ''; });
  });
  srSubtab(0);
  document.getElementById('sr-cand-list-view').style.display = 'none';
  document.getElementById('sr-cand-file-view').classList.add('open');
}
function srCloseFile() {
  document.getElementById('sr-cand-file-view').classList.remove('open');
  document.getElementById('sr-cand-list-view').style.display='block';
  srCurrentId = null;
}
function srSubtab(n) {
  document.querySelectorAll('#panel-sales-recruiting .sr-subtab').forEach((t,i)=>t.classList.toggle('active',i===n));
  document.querySelectorAll('#panel-sales-recruiting .sr-sub-panel').forEach((p,i)=>p.classList.toggle('active',i===n));
}
function srSaveInterview(n) {
  const c = srCands.find(x=>x.id===srCurrentId); if(!c) return;
  if(!c.interviews) c.interviews=[{},{},{}];
  const fldSets = [['sri1-date','sri1-score','sri1-decision','sri1-interviewer','sri1-notes','sri1-summary'],['sri2-date','sri2-score','sri2-decision','sri2-interviewer','sri2-notes','sri2-summary'],['sri3-date','sri3-score','sri3-decision','sri3-interviewer','sri3-notes','sri3-refs']];
  const keys = ['date','score','decision','interviewer','notes','summary'];
  const flds = fldSets[n]; const iv = {};
  flds.forEach((fid,i)=>{ const el=document.getElementById(fid); if(el) iv[keys[i]]=el.value; });
  c.interviews[n]=iv;
  srSaveCands(srCands);
  const ok = document.getElementById('sr-save-ok-'+n); if(ok){ok.style.display='inline';setTimeout(()=>ok.style.display='none',2000);}
}

/* ── AI FRAMEWORK EVALUATION (SALES) ── */
const SR_EVAL_FRAMEWORK_DEF = [
  {val:'Engaging',    desc:'Does the candidate naturally draw people in? Are they energetic, personable, and easy to talk to? Do they make the interviewer want to keep talking?'},
  {val:'Empathetic',  desc:'Do they demonstrate awareness of others\' perspectives and feelings? Do they talk about customers or colleagues with genuine understanding?'},
  {val:'The Skill of Listening', desc:'Do they actually answer what was asked? Do they pause, reflect, and respond to the question rather than pivoting to a rehearsed answer?'},
  {val:'Persistence', desc:'Do they show evidence of sticking with hard things? Do they push through rejection, setbacks, or long sales cycles without giving up?'},
  {val:'Integrity',   desc:'Are they honest, even when it\'s uncomfortable? Do they own their mistakes, speak plainly about past employers, and avoid over-promising?'},
  {val:'Knowledge',   desc:'Do they demonstrate curiosity and self-investment? Do they ask smart questions, reference things they\'ve learned, or show hunger to understand the industry?'}
];

async function srRunAIEval(n) {
  const noteIds = [['sri1-notes','sri1-summary'],['sri2-notes','sri2-summary'],['sri3-notes','sri3-refs']];
  const transcript = (document.getElementById(noteIds[n][0])||{}).value||'';
  const summary    = (document.getElementById(noteIds[n][1])||{}).value||'';
  if (!transcript.trim() && !summary.trim()) {
    alert('Please paste a transcript or notes into this interview before running the AI evaluation.');
    return;
  }
  const btn = document.getElementById('sr-ai-btn-'+n);
  const resultEl = document.getElementById('sr-ai-result-'+n);
  btn.disabled = true;
  btn.textContent = '✦ Evaluating…';
  resultEl.style.display = 'none';

  const c = srCands.find(x=>x.id==srCurrentId);
  const candidateName = c ? c.name : 'this candidate';

  const prompt = `You are an expert sales hiring evaluator for Alpine HVAC, a commercial HVAC and building automation company based in Hamilton, Ontario. You are evaluating a Sales BDR candidate named ${candidateName}.

Evaluate the following interview transcript and/or notes against the Alpine Sales Evaluation Framework — 6 core traits. For each trait, determine whether it was OBSERVED (yes) or NOT OBSERVED (no) in this interview, and provide a concise 1–2 sentence rationale citing specific evidence from the transcript.

ALPINE SALES EVALUATION FRAMEWORK:
${SR_EVAL_FRAMEWORK_DEF.map((t,i)=>`${i+1}. ${t.val}: ${t.desc}`).join('\n')}

INTERVIEW TRANSCRIPT / NOTES:
${transcript}

INTERVIEWER SUMMARY (if any):
${summary}

Respond ONLY with a valid JSON object. No markdown, no preamble, no backticks. Format:
{
  "traits": [
    {"val": "Engaging", "observed": true, "rationale": "..."},
    {"val": "Empathetic", "observed": false, "rationale": "..."},
    {"val": "The Skill of Listening", "observed": true, "rationale": "..."},
    {"val": "Persistence", "observed": true, "rationale": "..."},
    {"val": "Integrity", "observed": false, "rationale": "..."},
    {"val": "Knowledge", "observed": true, "rationale": "..."}
  ],
  "overall": "One sentence overall impression of this candidate based on this interview."
}`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const data = await res.json();
    const text = (data.content||[]).map(b=>b.text||'').join('').trim();
    const clean = text.replace(/```json|```/g,'').trim();
    const result = JSON.parse(clean);

    // Render result panel
    const traitsHtml = result.traits.map(t => {
      const checkClass = t.observed ? 'yes' : 'no';
      const checkMark  = t.observed ? '✓' : '–';
      return `<div class="sr-ai-trait-row">
        <div class="sr-ai-trait-check ${checkClass}">${checkMark}</div>
        <div>
          <div class="sr-ai-trait-name">${t.val}</div>
          <div class="sr-ai-trait-note">${t.rationale}</div>
        </div>
        <div></div>
      </div>`;
    }).join('');

    const observedVals = result.traits.filter(t=>t.observed).map(t=>t.val);
    const count = observedVals.length;

    resultEl.innerHTML = `
      <div class="sr-ai-result-header">
        <div class="sr-ai-result-title">✦ AI Evaluation — ${count} of 6 traits observed</div>
        <button class="sr-ai-accept-btn" onclick="srAcceptAIEval(${JSON.stringify(observedVals).replace(/"/g,'&quot;')})">Apply to Profile</button>
      </div>
      <div class="sr-ai-result-body">${traitsHtml}</div>
      ${result.overall ? `<div class="sr-ai-overall">${result.overall}</div>` : ''}`;
    resultEl.style.display = 'block';
  } catch(e) {
    resultEl.innerHTML = `<div class="sr-ai-result-body" style="color:rgba(220,100,100,0.8);font-size:.8rem;padding:.75rem">Evaluation failed. Check your connection and try again. (${e.message})</div>`;
    resultEl.style.display = 'block';
  }
  btn.disabled = false;
  btn.innerHTML = '✦ AI Evaluate';
}

function srAcceptAIEval(observedVals) {
  const c = srCands.find(x=>x.id==srCurrentId); if(!c) return;
  // Merge with existing evalTraits (union — don't remove traits manually set)
  const existing = c.evalTraits || [];
  const merged = [...new Set([...existing, ...observedVals])];
  c.evalTraits = merged;
  srSaveCands(srCands);
  // Re-render the file view scorecard
  const evalChecked = c.evalTraits;
  const evalGrid = document.getElementById('sr-file-eval-grid');
  const evalSection = document.getElementById('sr-file-eval');
  const SR_EVAL_LABELS = [{val:'Engaging',label:'Engaging'},{val:'Empathetic',label:'Empathetic'},{val:'The Skill of Listening',label:'The Skill of Listening'},{val:'Persistence',label:'Persistence'},{val:'Integrity',label:'Integrity'},{val:'Knowledge',label:'Knowledge / Curiosity'}];
  evalGrid.innerHTML = SR_EVAL_LABELS.map(t => {
    const checked = evalChecked.includes(t.val);
    return `<div class="sr-eval-item${checked?' checked':''}"><div class="sr-eval-check"><span class="sr-eval-check-mark">✓</span></div><div class="sr-eval-label">${t.label}</div></div>`;
  }).join('');
  const subtitle = evalSection.querySelector('.sr-eval-title span');
  if(subtitle) subtitle.textContent = `${evalChecked.length} of 6 observed`;
  // Flash confirmation
  const acceptBtn = document.querySelector('#sr-cands .sr-ai-accept-btn');
  if(acceptBtn){ acceptBtn.textContent = 'Applied ✓'; acceptBtn.style.background='rgba(28,107,110,0.35)'; setTimeout(()=>{ acceptBtn.textContent='Apply to Profile'; acceptBtn.style.background=''; },2000); }
}

srRenderCands();

/* ── CANDIDATE TRACKER (TECH) ── */
const TC_CANDS_KEY = 'alpine_tech_candidates';
function tcLoadCands() {
  try {
    const v = localStorage.getItem(TC_CANDS_KEY);
    if (!v || v === 'null') return [];
    const p = JSON.parse(v);
    if (!Array.isArray(p)) return [];
    let changed = false;
    p.forEach((c, i) => {
      if (!c.id) { c.id = Date.now() + i; changed = true; }
    });
    if (changed) localStorage.setItem(TC_CANDS_KEY, JSON.stringify(p));
    return p;
  } catch(e) { return []; }
}
function tcSaveCands(c) { localStorage.setItem(TC_CANDS_KEY, JSON.stringify(c)); }

let tcCands = tcLoadCands();
let tcEditingId = null;
let tcCurrentId = null;

function tcToggleChip(el, color) {
  const cls = 'sel-'+color;
  el.classList.toggle(cls);
}
function tcGetSelectedChips(containerId) {
  return Array.from(document.querySelectorAll('#'+containerId+' .sr-chip.sel-green')).map(c=>c.dataset.val);
}
function tcGetSelectedRedChips(containerId) {
  return Array.from(document.querySelectorAll('#'+containerId+' .sr-chip.sel-red')).map(c=>c.dataset.val);
}
function tcResetChips() {
  document.querySelectorAll('#tc-pos-chips .sr-chip').forEach(c=>c.classList.remove('sel-green','sel-red'));
  document.querySelectorAll('#tc-neg-chips .sr-chip').forEach(c=>c.classList.remove('sel-green','sel-red'));
}
function tcToggleEval(el) { el.classList.toggle('checked'); }
function tcGetEvalTraits() {
  return Array.from(document.querySelectorAll('#tc-modal-eval-grid .sr-eval-item.checked')).map(el=>el.dataset.val);
}
function tcSetEvalTraits(vals) {
  document.querySelectorAll('#tc-modal-eval-grid .sr-eval-item').forEach(el=>{
    el.classList.toggle('checked', (vals||[]).includes(el.dataset.val));
  });
}
function tcResetEval() { document.querySelectorAll('#tc-modal-eval-grid .sr-eval-item').forEach(el=>el.classList.remove('checked')); }
function tcSetChips(posTraits, negTraits) {
  tcResetChips();
  document.querySelectorAll('#tc-pos-chips .sr-chip').forEach(c=>{ if((posTraits||[]).includes(c.dataset.val)) c.classList.add('sel-green'); });
  document.querySelectorAll('#tc-neg-chips .sr-chip').forEach(c=>{ if((negTraits||[]).includes(c.dataset.val)) c.classList.add('sel-red'); });
}

function tcOpenModal(id) {
  tcEditingId = id||null;
  document.getElementById('tc-modal-title').textContent = id ? 'Edit Candidate' : 'Add Candidate';
  if(id) {
    const c = tcCands.find(x=>x.id===id); if(!c) return;
    document.getElementById('tcf-name').value = c.name||'';
    document.getElementById('tcf-date').value = c.date||'';
    document.getElementById('tcf-stage').value = c.stage||'Interview 1';
    document.getElementById('tcf-decision').value = c.decision||'pending';
    document.getElementById('tcf-score').value = c.score||'';
    tcSetChips(c.posTraits, c.negTraits);
    tcSetEvalTraits(c.evalTraits);
  } else {
    document.getElementById('tcf-name').value=''; document.getElementById('tcf-date').value='';
    document.getElementById('tcf-stage').value='Interview 1'; document.getElementById('tcf-decision').value='pending';
    document.getElementById('tcf-score').value=''; tcResetChips(); tcResetEval();
  }
  document.getElementById('tc-modal').classList.add('open');
}
function tcCloseModal() { document.getElementById('tc-modal').classList.remove('open'); }
function tcSaveCandidate() {
  const name = document.getElementById('tcf-name').value.trim(); if(!name){alert('Please enter a name.');return;}
  const cand = {
    id: tcEditingId || Date.now(),
    name, date: document.getElementById('tcf-date').value,
    stage: document.getElementById('tcf-stage').value,
    decision: document.getElementById('tcf-decision').value,
    score: document.getElementById('tcf-score').value,
    posTraits: tcGetSelectedChips('tc-pos-chips'),
    negTraits: tcGetSelectedRedChips('tc-neg-chips'),
    evalTraits: tcGetEvalTraits(),
    interviews: tcEditingId ? (tcCands.find(x=>x.id===tcEditingId)||{}).interviews||[{},{},{}] : [{},{},{}]
  };
  if(tcEditingId) { const idx=tcCands.findIndex(x=>x.id===tcEditingId); if(idx>-1) tcCands[idx]=cand; }
  else tcCands.unshift(cand);
  tcSaveCands(tcCands); tcCloseModal(); tcRenderCands();
}
function tcDeleteCurrent() {
  if(!confirm('Remove this candidate?')) return;
  tcCands = tcCands.filter(x=>x.id!==tcCurrentId);
  tcSaveCands(tcCands); tcCloseFile(); tcRenderCands();
}
function tcEditCurrent() { tcOpenModal(tcCurrentId); }

function tcRenderCands() {
  const buckets = {'Interview 1':'tc-bucket-i1','Interview 2':'tc-bucket-i2'};
  ['tc-bucket-i1','tc-bucket-i2','tc-bucket-later'].forEach(id => {
    document.getElementById(id).innerHTML = '';
  });
  if (!tcCands.length) {
    document.getElementById('tc-bucket-i1').innerHTML = '<div class="sr-empty">No candidates yet. Click "+ Add Candidate" to get started.</div>';
    return;
  }
  tcCands.forEach(c => {
    const initials = c.name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
    const decBadge = c.decision==='advance'?'sr-badge-advance':c.decision==='pass'?'sr-badge-pass':'sr-badge-pending';
    const decLabel = c.decision==='advance'?'Advance':c.decision==='pass'?'Pass':'Pending';
    const dateStr = c.date ? new Date(c.date+'T00:00:00').toLocaleDateString('en-CA',{month:'short',day:'numeric',year:'numeric'}) : '';
    const row = document.createElement('div');
    row.className = 'sr-cand-row';
    row.innerHTML = `
      <div style="width:32px;height:32px;border-radius:50%;background:rgba(28,107,110,0.2);display:flex;align-items:center;justify-content:center;font-family:'Oswald',sans-serif;font-size:.75rem;font-weight:700;color:var(--teal-light);flex-shrink:0">${initials}</div>
      <div style="flex:1"><div class="sr-cand-name">${c.name}</div><div class="sr-cand-meta">${c.stage||''}${dateStr?' · '+dateStr:''}</div></div>
      <div class="sr-badges">
        ${c.score?`<span class="sr-badge sr-badge-score">${c.score}/10</span>`:''}
        <span class="sr-badge ${decBadge}">${decLabel}</span>
      </div>`;
    row.addEventListener('click', (function(candId){ return function(){ tcOpenFile(candId); }; })(c.id));
    const targetId = buckets[c.stage] || 'tc-bucket-later';
    document.getElementById(targetId).appendChild(row);
  });
  ['tc-bucket-i1','tc-bucket-i2','tc-bucket-later'].forEach(id => {
    if (!document.getElementById(id).children.length) {
      document.getElementById(id).innerHTML = '<div class="sr-empty">No candidates at this stage.</div>';
    }
  });
}

function tcOpenFile(id) {
  tcCurrentId = id;
  const c = tcCands.find(x => x.id == id); if (!c) return;
  document.getElementById('tc-file-name').textContent = c.name;
  const decBadge = c.decision==='advance'?'sr-badge-advance':c.decision==='pass'?'sr-badge-pass':'sr-badge-pending';
  const decLabel = c.decision==='advance'?'Advance':c.decision==='pass'?'Pass':'Pending';
  document.getElementById('tc-file-badges').innerHTML = `<span class="sr-badge ${decBadge}" style="margin-left:8px">${decLabel}</span>${c.score?`<span class="sr-badge sr-badge-score" style="margin-left:4px">${c.score}/10</span>`:''}`;
  const traitsHtml = (c.posTraits||[]).map(t=>`<span class="sr-chip sel-green" style="cursor:default">${t}</span>`).join('')+(c.negTraits||[]).map(t=>`<span class="sr-chip sel-red" style="cursor:default">${t}</span>`).join('');
  document.getElementById('tc-file-traits').innerHTML = traitsHtml;

  const TC_EVAL_FRAMEWORK = [
    {val:'Technical Competence', label:'Technical Competence'},
    {val:'Safety Mindset', label:'Safety Mindset'},
    {val:'Reliability', label:'Reliability'},
    {val:'Communication', label:'Communication'},
    {val:'Coachability', label:'Coachability'},
    {val:'Work Ethic', label:'Work Ethic'}
  ];
  const evalChecked = c.evalTraits || [];
  const evalCount = evalChecked.length;
  const evalGrid = document.getElementById('tc-file-eval-grid');
  const evalSection = document.getElementById('tc-file-eval');
  evalGrid.innerHTML = TC_EVAL_FRAMEWORK.map(t => {
    const checked = evalChecked.includes(t.val);
    return `<div class="sr-eval-item${checked?' checked':''}">
      <div class="sr-eval-check"><span class="sr-eval-check-mark">✓</span></div>
      <div class="sr-eval-label">${t.label}</div>
    </div>`;
  }).join('');
  const subtitle = evalSection.querySelector('.sr-eval-title span');
  if(subtitle) subtitle.textContent = evalCount > 0 ? `${evalCount} of 6 observed` : 'Not yet evaluated';

  let interviews = c.interviews;
  if (!interviews || !Array.isArray(interviews)) {
    interviews = [
      { date: c.date||'', score: c.score||'', decision: c.decision||'pending', interviewer: '', notes: c.notes||'', summary: '' },
      {}, {}
    ];
  }
  const fieldSets = [
    ['tci1-date','tci1-score','tci1-decision','tci1-interviewer','tci1-notes','tci1-summary'],
    ['tci2-date','tci2-score','tci2-decision','tci2-interviewer','tci2-notes','tci2-summary'],
    ['tci3-date','tci3-score','tci3-decision','tci3-interviewer','tci3-notes','tci3-refs']
  ];
  const keys = ['date','score','decision','interviewer','notes','summary'];
  fieldSets.forEach((flds, i) => {
    const iv = interviews[i] || {};
    flds.forEach((fid, j) => { const el = document.getElementById(fid); if (el) el.value = iv[keys[j]] || ''; });
  });
  tcSubtab(0);
  document.getElementById('tc-cand-list-view').style.display = 'none';
  document.getElementById('tc-cand-file-view').classList.add('open');
}
function tcCloseFile() {
  document.getElementById('tc-cand-file-view').classList.remove('open');
  document.getElementById('tc-cand-list-view').style.display='block';
  tcCurrentId = null;
}
function tcSubtab(n) {
  document.querySelectorAll('#panel-recruiting .sr-subtab').forEach((t,i)=>t.classList.toggle('active',i===n));
  document.querySelectorAll('#panel-recruiting .sr-sub-panel').forEach((p,i)=>p.classList.toggle('active',i===n));
}
function tcSaveInterview(n) {
  const c = tcCands.find(x=>x.id===tcCurrentId); if(!c) return;
  if(!c.interviews) c.interviews=[{},{},{}];
  const fldSets = [['tci1-date','tci1-score','tci1-decision','tci1-interviewer','tci1-notes','tci1-summary'],['tci2-date','tci2-score','tci2-decision','tci2-interviewer','tci2-notes','tci2-summary'],['tci3-date','tci3-score','tci3-decision','tci3-interviewer','tci3-notes','tci3-refs']];
  const keys = ['date','score','decision','interviewer','notes','summary'];
  const flds = fldSets[n]; const iv = {};
  flds.forEach((fid,i)=>{ const el=document.getElementById(fid); if(el) iv[keys[i]]=el.value; });
  c.interviews[n]=iv;
  tcSaveCands(tcCands);
  const ok = document.getElementById('tc-save-ok-'+n); if(ok){ok.style.display='inline';setTimeout(()=>ok.style.display='none',2000);}
}

/* ── AI FRAMEWORK EVALUATION (TECH) ── */
const TC_EVAL_FRAMEWORK_DEF = [
  {val:'Technical Competence', desc:'Do they demonstrate real hands-on knowledge of HVAC systems, diagnostics, and repair? Do they speak concretely about past technical work rather than vaguely?'},
  {val:'Safety Mindset',       desc:'Do they treat safety as a habit, not an afterthought? Do they mention safety procedures, PPE, or lockout/tagout unprompted?'},
  {val:'Reliability',          desc:'Is there evidence of consistent attendance, follow-through, and dependability in past roles? Do they own missed commitments rather than deflect?'},
  {val:'Communication',        desc:'Can they explain technical issues clearly to a non-technical customer or teammate? Are they easy to understand and straightforward?'},
  {val:'Coachability',         desc:'Do they show openness to feedback and willingness to learn new methods, tools, or systems rather than being set in their ways?'},
  {val:'Work Ethic',           desc:'Do they show evidence of going the extra mile — staying late to finish a job, taking initiative, or taking pride in their work?'}
];

async function tcRunAIEval(n) {
  const noteIds = [['tci1-notes','tci1-summary'],['tci2-notes','tci2-summary'],['tci3-notes','tci3-refs']];
  const transcript = (document.getElementById(noteIds[n][0])||{}).value||'';
  const summary    = (document.getElementById(noteIds[n][1])||{}).value||'';
  if (!transcript.trim() && !summary.trim()) {
    alert('Please paste a transcript or notes into this interview before running the AI evaluation.');
    return;
  }
  const btn = document.getElementById('tc-ai-btn-'+n);
  const resultEl = document.getElementById('tc-ai-result-'+n);
  btn.disabled = true;
  btn.textContent = '✦ Evaluating…';
  resultEl.style.display = 'none';

  const c = tcCands.find(x=>x.id==tcCurrentId);
  const candidateName = c ? c.name : 'this candidate';

  const prompt = `You are an expert HVAC technician hiring evaluator for Alpine HVAC, a commercial HVAC and building automation company based in Hamilton, Ontario. You are evaluating a technician candidate named ${candidateName}.

Evaluate the following interview transcript and/or notes against the Alpine Technician Evaluation Framework — 6 core traits. For each trait, determine whether it was OBSERVED (yes) or NOT OBSERVED (no) in this interview, and provide a concise 1–2 sentence rationale citing specific evidence from the transcript.

ALPINE TECHNICIAN EVALUATION FRAMEWORK:
${TC_EVAL_FRAMEWORK_DEF.map((t,i)=>`${i+1}. ${t.val}: ${t.desc}`).join('\n')}

INTERVIEW TRANSCRIPT / NOTES:
${transcript}

INTERVIEWER SUMMARY (if any):
${summary}

Respond ONLY with a valid JSON object. No markdown, no preamble, no backticks. Format:
{
  "traits": [
    {"val": "Technical Competence", "observed": true, "rationale": "..."},
    {"val": "Safety Mindset", "observed": false, "rationale": "..."},
    {"val": "Reliability", "observed": true, "rationale": "..."},
    {"val": "Communication", "observed": true, "rationale": "..."},
    {"val": "Coachability", "observed": false, "rationale": "..."},
    {"val": "Work Ethic", "observed": true, "rationale": "..."}
  ],
  "overall": "One sentence overall impression of this candidate based on this interview."
}`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const data = await res.json();
    const text = (data.content||[]).map(b=>b.text||'').join('').trim();
    const clean = text.replace(/```json|```/g,'').trim();
    const result = JSON.parse(clean);

    const traitsHtml = result.traits.map(t => {
      const checkClass = t.observed ? 'yes' : 'no';
      const checkMark  = t.observed ? '✓' : '–';
      return `<div class="sr-ai-trait-row">
        <div class="sr-ai-trait-check ${checkClass}">${checkMark}</div>
        <div>
          <div class="sr-ai-trait-name">${t.val}</div>
          <div class="sr-ai-trait-note">${t.rationale}</div>
        </div>
        <div></div>
      </div>`;
    }).join('');

    const observedVals = result.traits.filter(t=>t.observed).map(t=>t.val);
    const count = observedVals.length;

    resultEl.innerHTML = `
      <div class="sr-ai-result-header">
        <div class="sr-ai-result-title">✦ AI Evaluation — ${count} of 6 traits observed</div>
        <button class="sr-ai-accept-btn" onclick="tcAcceptAIEval(${JSON.stringify(observedVals).replace(/"/g,'&quot;')})">Apply to Profile</button>
      </div>
      <div class="sr-ai-result-body">${traitsHtml}</div>
      ${result.overall ? `<div class="sr-ai-overall">${result.overall}</div>` : ''}`;
    resultEl.style.display = 'block';
  } catch(e) {
    resultEl.innerHTML = `<div class="sr-ai-result-body" style="color:rgba(220,100,100,0.8);font-size:.8rem;padding:.75rem">Evaluation failed. Check your connection and try again. (${e.message})</div>`;
    resultEl.style.display = 'block';
  }
  btn.disabled = false;
  btn.innerHTML = '✦ AI Evaluate';
}

function tcAcceptAIEval(observedVals) {
  const c = tcCands.find(x=>x.id==tcCurrentId); if(!c) return;
  const existing = c.evalTraits || [];
  const merged = [...new Set([...existing, ...observedVals])];
  c.evalTraits = merged;
  tcSaveCands(tcCands);
  const evalChecked = c.evalTraits;
  const evalGrid = document.getElementById('tc-file-eval-grid');
  const evalSection = document.getElementById('tc-file-eval');
  const TC_EVAL_LABELS = [{val:'Technical Competence',label:'Technical Competence'},{val:'Safety Mindset',label:'Safety Mindset'},{val:'Reliability',label:'Reliability'},{val:'Communication',label:'Communication'},{val:'Coachability',label:'Coachability'},{val:'Work Ethic',label:'Work Ethic'}];
  evalGrid.innerHTML = TC_EVAL_LABELS.map(t => {
    const checked = evalChecked.includes(t.val);
    return `<div class="sr-eval-item${checked?' checked':''}"><div class="sr-eval-check"><span class="sr-eval-check-mark">✓</span></div><div class="sr-eval-label">${t.label}</div></div>`;
  }).join('');
  const subtitle = evalSection.querySelector('.sr-eval-title span');
  if(subtitle) subtitle.textContent = `${evalChecked.length} of 6 observed`;
  const acceptBtn = document.querySelector('#tc-cands .sr-ai-accept-btn');
  if(acceptBtn){ acceptBtn.textContent = 'Applied ✓'; acceptBtn.style.background='rgba(28,107,110,0.35)'; setTimeout(()=>{ acceptBtn.textContent='Apply to Profile'; acceptBtn.style.background=''; },2000); }
}

tcRenderCands();

/* ── PERFORMANCE TIERS ── */
const SR_TIER_DEFS = [
  {id:'floor',label:'Minimum — keep your seat',title:'Floor',sub:'Year 1 ramp target',featured:false,badge:'background:rgba(255,255,255,0.07);color:rgba(255,255,255,0.5)',contractRev:150000,cpm:'1–2',proposals:'3–4',meetings:'6–8',touches:'120–160'},
  {id:'mid',label:'Strong performer',title:'Mid-Tier',sub:'Year 2–3 expectation',featured:true,badge:'background:rgba(55,138,221,0.15);color:#6BAEE8',contractRev:350000,cpm:'3–4',proposals:'8–10',meetings:'14–18',touches:'300–400'},
  {id:'elite',label:'Elite producer',title:'Maximum',sub:'Year 3+ high performer',featured:false,badge:'background:rgba(28,107,110,0.2);color:var(--teal-light)',contractRev:600000,cpm:'5–6',proposals:'14–18',meetings:'25–35',touches:'500–700'}
];
function srFmt(n){ return '$'+Math.round(n).toLocaleString(); }
function srG(){
  return {
    acv: parseFloat(document.getElementById('sr-acv').value)||9000,
    pt:  parseFloat(document.getElementById('sr-pt').value)||3,
    gm:  parseFloat(document.getElementById('sr-gm').value)/100||0.4,
    ret: parseFloat(document.getElementById('sr-ret').value)||3,
    base:parseFloat(document.getElementById('sr-base').value)||45000,
    burden:parseFloat(document.getElementById('sr-burden').value)||20000,
    comm:parseFloat(document.getElementById('sr-comm').value)/100||0.3
  };
}
function srGetTierVal(id,field,fallback){
  const el=document.getElementById('srt-'+id+'-'+field);
  return el?(parseFloat(el.value)||fallback):fallback;
}
function srRecalc(){
  const G=srG();
  const fixedTotal=G.base+G.burden;
  const exHalf=srFmt((G.acv*G.comm)/2);
  const ex1=document.getElementById('sr-pt-ex1'); if(ex1) ex1.textContent='e.g. '+exHalf+' on a '+srFmt(G.acv)+' contract at '+Math.round(G.comm*100)+'%';
  const ex2=document.getElementById('sr-pt-ex2'); if(ex2) ex2.textContent='e.g. '+exHalf+' on a '+srFmt(G.acv)+' contract at '+Math.round(G.comm*100)+'% — if account still active';
  const tierHTML=SR_TIER_DEFS.map(T=>{
    const contractRev=srGetTierVal(T.id,'contractrev',T.contractRev);
    const pullRev=contractRev*(G.pt-1),totalRev1=contractRev*G.pt,gp1=totalRev1*G.gm;
    const commission=contractRev*G.comm,commSign=commission*0.5,commDef=commission*0.5;
    const repTotal=G.base+commission,netProfit1=gp1-fixedTotal-commission;
    const contracts=Math.round(contractRev/G.acv);
    const cpm=(document.getElementById('srt-'+T.id+'-cpm')||{value:T.cpm}).value||T.cpm;
    const prop=(document.getElementById('srt-'+T.id+'-prop')||{value:T.proposals}).value||T.proposals;
    const mtg=(document.getElementById('srt-'+T.id+'-mtg')||{value:T.meetings}).value||T.meetings;
    const tch=(document.getElementById('srt-'+T.id+'-tch')||{value:T.touches}).value||T.touches;
    return `<div class="sr-tier-card${T.featured?' featured':''}">
      <span class="sr-tier-badge" style="${T.badge}">${T.label}</span>
      <p class="sr-tier-title">${T.title}</p><p class="sr-tier-sub">${T.sub}</p>
      <div class="sr-tier-section-label">Activity</div>
      <div class="sr-editable-field"><label>Contract revenue/yr ($)</label><input type="number" id="srt-${T.id}-contractrev" value="${contractRev}" oninput="srRecalc()"></div>
      <div class="sr-metric-row"><span class="sr-metric-label">Contracts secured/yr</span><span class="sr-metric-val">~${contracts}</span></div>
      <div class="sr-editable-field"><label>Contracts/month</label><input type="text" id="srt-${T.id}-cpm" value="${cpm}" oninput="srRecalc()"></div>
      <div class="sr-editable-field"><label>Proposals/month</label><input type="text" id="srt-${T.id}-prop" value="${prop}" oninput="srRecalc()"></div>
      <div class="sr-editable-field"><label>First meetings/month</label><input type="text" id="srt-${T.id}-mtg" value="${mtg}" oninput="srRecalc()"></div>
      <div class="sr-editable-field"><label>Outbound touches/month</label><input type="text" id="srt-${T.id}-tch" value="${tch}" oninput="srRecalc()"></div>
      <div class="sr-tier-section-label">Rep Earnings — Year 1</div>
      <div class="sr-metric-row"><span class="sr-metric-label">Base salary</span><span class="sr-metric-val">${srFmt(G.base)}</span></div>
      <div class="sr-metric-row"><span class="sr-metric-label">Total commission (${Math.round(G.comm*100)}%)</span><span class="sr-metric-val">${srFmt(commission)}</span></div>
      <div class="sr-metric-row"><span class="sr-metric-label">↳ On signing (50%)</span><span class="sr-metric-amber">${srFmt(commSign)}</span></div>
      <div class="sr-metric-row"><span class="sr-metric-label">↳ Deferred 6 months (50%)</span><span class="sr-metric-amber">${srFmt(commDef)}</span></div>
      <div class="sr-metric-row"><span class="sr-metric-label">Total rep earnings</span><span class="sr-metric-blue">${srFmt(repTotal)}</span></div>
      <div class="sr-tier-section-label">Business — Year 1</div>
      <div class="sr-metric-row"><span class="sr-metric-label">Contract revenue</span><span class="sr-metric-val">${srFmt(contractRev)}</span></div>
      <div class="sr-metric-row"><span class="sr-metric-label">Pull-through (${(G.pt-1).toFixed(1)}×)</span><span class="sr-metric-val">${srFmt(pullRev)}</span></div>
      <div class="sr-metric-row"><span class="sr-metric-label">Total yr 1 revenue</span><span class="sr-metric-val">${srFmt(totalRev1)}</span></div>
      <div class="sr-metric-row"><span class="sr-metric-label">Gross profit (${Math.round(G.gm*100)}%)</span><span class="sr-metric-val">${srFmt(gp1)}</span></div>
      <div class="sr-metric-row"><span class="sr-metric-label">Less: fixed cost</span><span class="sr-metric-val">−${srFmt(fixedTotal)}</span></div>
      <div class="sr-metric-row"><span class="sr-metric-label">Less: commission</span><span class="sr-metric-val">−${srFmt(commission)}</span></div>
      <div class="sr-metric-row"><span class="sr-metric-label">Net yr 1 profit</span><span class="sr-metric-green">${srFmt(netProfit1)}</span></div>
    </div>`;
  });
  const tg=document.getElementById('sr-tier-grid'); if(tg) tg.innerHTML=tierHTML.join('');
  const lh=document.getElementById('sr-ltv-heading'); if(lh) lh.textContent=Math.round(G.ret)+'-Year Lifetime Value — by Tier';
  const ltvHTML=SR_TIER_DEFS.map(T=>{
    const contractRev=srGetTierVal(T.id,'contractrev',T.contractRev);
    const annualRev=contractRev*G.pt,lifetimeRev=annualRev*G.ret,lifetimeGP=lifetimeRev*G.gm;
    const commission=contractRev*G.comm,fixedLife=fixedTotal*G.ret,netLTV=lifetimeGP-fixedLife-commission;
    return `<div class="sr-ltv-card"><p class="sr-ltv-label">${T.title}</p><p class="sr-ltv-title">${T.label}</p>
      <div class="sr-ltv-row"><span>Lifetime revenue (${Math.round(G.ret)} yrs)</span><span>${srFmt(lifetimeRev)}</span></div>
      <div class="sr-ltv-row"><span>Lifetime gross profit (${Math.round(G.gm*100)}%)</span><span>${srFmt(lifetimeGP)}</span></div>
      <div class="sr-ltv-row"><span>Less: ${Math.round(G.ret)}-yr fixed cost</span><span>−${srFmt(fixedLife)}</span></div>
      <div class="sr-ltv-row"><span>Less: yr 1 commission (one-time)</span><span>−${srFmt(commission)}</span></div>
      <div class="sr-ltv-row total"><span>Net ${Math.round(G.ret)}-yr profit</span><span>${srFmt(netLTV)}</span></div>
    </div>`;
  });
  const lg=document.getElementById('sr-ltv-grid'); if(lg) lg.innerHTML=ltvHTML.join('');
}
srRecalc();


// (script block boundary)


// ── TAB SWITCHING ──
function showTab(name) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('panel-' + name).classList.add('active');
  event.currentTarget.classList.add('active');
  // Re-render SR questions when sales tab opens so textarea autoGrow works correctly
  if (name === 'sales-recruiting') {
    srRenderQ('sr-q-list-1');
    srRenderQ('sr-q-list-2');
    srRenderQ('sr-q-list-3');
  }
}

// ── STORAGE KEYS ──
const STORAGE_KEY = 'alpine_reviews_v1';
const QS_KEY = 'alpine_review_questions_v1';

// ── DEFAULT QUESTIONS ──
const DEFAULT_QUESTIONS = [
  'What should the company start, stop, and keep doing?',
  'Where have you seen your skills grow? What would you like to grow into?',
  'What administrative hitches could be improved?',
  'What are 1–2 things you want to dial in for 2026?',
  '1–2 ways we can improve in 2026',
  'Are there any personality conflicts troubling you?',
  'What is your dream outcome at Alpine?',
  'Does the future look bright?'
];

function loadQuestions() {
  try {
    const saved = localStorage.getItem(QS_KEY);
    if (!saved || saved === 'null') return DEFAULT_QUESTIONS.slice();
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed) || !parsed.length) return DEFAULT_QUESTIONS.slice();
    return parsed;
  } catch(e) { return DEFAULT_QUESTIONS.slice(); }
}
function saveQuestionsToStorage(qs) {
  localStorage.setItem(QS_KEY, JSON.stringify(qs));
}

function loadReviews() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
  catch(e) { return []; }
}
function saveReviews(reviews) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(reviews));
}

// ── RENDER QUESTION FIELDS IN REVIEW MODAL ──
function renderQuestionFields(answers) {
  const qs = loadQuestions();
  const container = document.getElementById('rv-questions-container');
  container.innerHTML = qs.map((q, i) => `
    <div class="rv-field">
      <label class="rv-label">${q}</label>
      <textarea class="rv-textarea" id="rv-dq-${i}" placeholder="Employee response..."></textarea>
    </div>
  `).join('');
  if (answers) {
    answers.forEach((val, i) => {
      const el = document.getElementById('rv-dq-' + i);
      if (el) el.value = val || '';
    });
  }
}

// ── STAR RATINGS ──
const ratings = { character:0, courage:0, curiosity:0, competence:0, caring:0 };
document.querySelectorAll('.rv-stars').forEach(group => {
  const key = group.dataset.value;
  group.querySelectorAll('.rv-star').forEach(star => {
    star.addEventListener('click', () => {
      ratings[key] = parseInt(star.dataset.n);
      updateStars(group, ratings[key]);
    });
    star.addEventListener('mouseover', () => updateStars(group, parseInt(star.dataset.n)));
    star.addEventListener('mouseout', () => updateStars(group, ratings[key]));
  });
});
function updateStars(group, val) {
  group.querySelectorAll('.rv-star').forEach(s => s.classList.toggle('active', parseInt(s.dataset.n) <= val));
}
function resetStars() {
  Object.keys(ratings).forEach(k => ratings[k] = 0);
  document.querySelectorAll('.rv-stars').forEach(g => updateStars(g, 0));
}
function setStars(vals) {
  Object.keys(vals).forEach(k => {
    ratings[k] = vals[k];
    const group = document.querySelector(`.rv-stars[data-value="${k}"]`);
    if(group) updateStars(group, vals[k]);
  });
}

// ── DIFFICULT CONVO TOGGLE ──
function toggleDiff() {
  const content = document.getElementById('rv-diff-content');
  const chevron = document.getElementById('rv-diff-chevron');
  content.classList.toggle('open');
  chevron.style.transform = content.classList.contains('open') ? 'rotate(180deg)' : '';
}

// ── QUESTION EDITOR ──
function openQEditor() {
  const qs = loadQuestions();
  const list = document.getElementById('rv-qed-list');
  list.innerHTML = qs.map((q, i) => `
    <div class="rv-qed-item" data-idx="${i}">
      <span class="rv-qed-drag">⠿</span>
      <input class="rv-qed-input" type="text" value="${q.replace(/"/g,'&quot;')}" placeholder="Enter question...">
      <button class="rv-qed-del" onclick="removeQuestion(this)" title="Remove">✕</button>
    </div>
  `).join('');
  document.getElementById('rv-qed-modal').classList.add('open');
}
function closeQEditor() {
  document.getElementById('rv-qed-modal').classList.remove('open');
}
function addQuestion() {
  const list = document.getElementById('rv-qed-list');
  const div = document.createElement('div');
  div.className = 'rv-qed-item';
  div.innerHTML = `
    <span class="rv-qed-drag">⠿</span>
    <input class="rv-qed-input" type="text" value="" placeholder="Enter question...">
    <button class="rv-qed-del" onclick="removeQuestion(this)" title="Remove">✕</button>
  `;
  list.appendChild(div);
  div.querySelector('input').focus();
}
function removeQuestion(btn) {
  btn.closest('.rv-qed-item').remove();
}
function saveQTemplate() {
  const inputs = document.querySelectorAll('#rv-qed-list .rv-qed-input');
  const qs = Array.from(inputs).map(i => i.value.trim()).filter(Boolean);
  if (!qs.length) { alert('Please add at least one question.'); return; }
  saveQuestionsToStorage(qs);
  closeQEditor();
  // Re-render the form fields with new questions (clear answers)
  renderQuestionFields();
}

// ── MODAL ──
let editingId = null;
function openNewReview() {
  editingId = null;
  document.getElementById('rv-modal-title').textContent = 'New Quarterly Review';
  clearForm();
  document.getElementById('rv-date').value = new Date().toISOString().slice(0,10);
  document.getElementById('rv-modal').classList.add('open');
}
function closeModal() {
  document.getElementById('rv-modal').classList.remove('open');
}
function closeViewModal() {
  document.getElementById('rv-view-modal').classList.remove('open');
}

function clearForm() {
  ['rv-tech','rv-date','rv-quarter','rv-level','rv-perf','rv-actions','rv-notes','rv-diff-notes']
    .forEach(id => { const el = document.getElementById(id); if(el) el.value = ''; });
  renderQuestionFields();
  resetStars();
  document.getElementById('rv-diff-content').classList.remove('open');
  document.getElementById('rv-diff-chevron').style.transform = '';
}

// ── SAVE ──
function saveReview() {
  const tech = document.getElementById('rv-tech').value.trim();
  if(!tech) { alert('Please enter a team member name.'); return; }
  const qs = loadQuestions();
  const dynamicAnswers = qs.map((_, i) => {
    const el = document.getElementById('rv-dq-' + i);
    return el ? el.value : '';
  });
  // Also save legacy q1–q8 for backwards compat with old reviews
  const review = {
    id: editingId || Date.now(),
    tech,
    date: document.getElementById('rv-date').value,
    quarter: document.getElementById('rv-quarter').value,
    level: document.getElementById('rv-level').value,
    dynamicAnswers,
    questionSnapshot: qs.slice(), // save which questions were asked
    perf: document.getElementById('rv-perf').value,
    actions: document.getElementById('rv-actions').value,
    notes: document.getElementById('rv-notes').value,
    diffNotes: document.getElementById('rv-diff-notes').value,
    ratings: {...ratings}
  };
  const reviews = loadReviews();
  const idx = reviews.findIndex(r => r.id === editingId);
  if(idx > -1) reviews[idx] = review;
  else reviews.unshift(review);
  saveReviews(reviews);
  closeModal();
  renderList();
}

// ── DELETE ──
function deleteReview(id, e) {
  e.stopPropagation();
  if(!confirm('Delete this review?')) return;
  const reviews = loadReviews().filter(r => r.id !== id);
  saveReviews(reviews);
  renderList();
}

// ── EDIT ──
function editReview(id, e) {
  e.stopPropagation();
  const review = loadReviews().find(r => r.id === id);
  if(!review) return;
  editingId = id;
  document.getElementById('rv-modal-title').textContent = 'Edit Review — ' + review.tech;
  document.getElementById('rv-tech').value = review.tech;
  document.getElementById('rv-date').value = review.date;
  document.getElementById('rv-quarter').value = review.quarter;
  document.getElementById('rv-level').value = review.level;

  // Handle both new dynamic format and old q1–q8 format
  if (review.dynamicAnswers) {
    // Render with the questions that were used when review was saved
    const savedQs = review.questionSnapshot || loadQuestions();
    const container = document.getElementById('rv-questions-container');
    container.innerHTML = savedQs.map((q, i) => `
      <div class="rv-field">
        <label class="rv-label">${q}</label>
        <textarea class="rv-textarea" id="rv-dq-${i}" placeholder="Employee response..."></textarea>
      </div>
    `).join('');
    review.dynamicAnswers.forEach((val, i) => {
      const el = document.getElementById('rv-dq-' + i);
      if (el) el.value = val || '';
    });
  } else {
    // Legacy: render current template, fill with old q1-q8
    const legacy = [review.q1,review.q2,review.q3,review.q4,review.q5,review.q6,review.q7,review.q8];
    renderQuestionFields(legacy);
  }

  document.getElementById('rv-perf').value = review.perf || '';
  document.getElementById('rv-actions').value = review.actions || '';
  document.getElementById('rv-notes').value = review.notes || '';
  document.getElementById('rv-diff-notes').value = review.diffNotes || '';
  if(review.ratings) setStars(review.ratings);
  document.getElementById('rv-modal').classList.add('open');
}

// ── VIEW ──
function viewReview(id) {
  const review = loadReviews().find(r => r.id === id);
  if(!review) return;
  document.getElementById('rv-view-title').textContent = review.tech + (review.quarter ? ' · ' + review.quarter : '');
  const stars = (n) => [1,2,3,4,5].map(i => `<span class="rv-view-star ${i<=n?'on':'off'}">★</span>`).join('');
  const field = (label, val, full=false) => val ? `
    <div class="rv-view-field${full?' full':''}">
      <div class="rv-view-field-label">${label}</div>
      <div class="rv-view-field-value">${val}</div>
    </div>` : '';

  // Build question/answer pairs for view
  let qHtml = '';
  if (review.dynamicAnswers && review.questionSnapshot) {
    const pairs = review.questionSnapshot.map((q, i) => [q, review.dynamicAnswers[i]]);
    qHtml = pairs.filter(([,v])=>v).map(([l,v]) => field(l,v,true)).join('');
  } else {
    // Legacy format
    const legacyQs = [
      ['Start / Stop / Keep', review.q1],
      ['Skills Growth', review.q2],
      ['Admin Hitches', review.q3],
      ['Dial In for 2026', review.q4],
      ['Improvements for 2026', review.q5],
      ['Personality Conflicts', review.q6],
      ['Dream Outcome at Alpine', review.q7],
      ['Does the Future Look Bright?', review.q8],
    ];
    qHtml = legacyQs.filter(([,v])=>v).map(([l,v]) => field(l,v,true)).join('');
  }

  const rv = review.ratings || {};
  const valNames = ['character','courage','curiosity','competence','caring'];
  const valHtml = valNames.some(k=>rv[k]) ? `
    <div class="rv-view-section">
      <div class="rv-view-section-title">Core Values Ratings</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:.75rem">
        ${valNames.map(k=>`<div><div style="font-family:'Oswald',sans-serif;font-size:.75rem;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--grey);margin-bottom:4px">${k}</div><div class="rv-view-stars">${stars(rv[k]||0)}</div></div>`).join('')}
      </div>
    </div>` : '';
  document.getElementById('rv-view-body').innerHTML = `
    <div class="rv-view-section">
      <div class="rv-view-section-title">Details</div>
      <div class="rv-view-row">
        ${field('Date', review.date ? new Date(review.date+'T00:00:00').toLocaleDateString('en-CA',{year:'numeric',month:'long',day:'numeric'}) : '')}
        ${field('Quarter', review.quarter)}
        ${field('Level', review.level)}
      </div>
    </div>
    ${qHtml ? `<div class="rv-view-section"><div class="rv-view-section-title">Review Questions</div><div class="rv-view-row">${qHtml}</div></div>` : ''}
    ${valHtml}
    ${review.perf ? `<div class="rv-view-section"><div class="rv-view-section-title">Performance Notes</div><div class="rv-view-field full"><div class="rv-view-field-value">${review.perf}</div></div></div>` : ''}
    ${review.actions ? `<div class="rv-view-section"><div class="rv-view-section-title">Action Items</div><div class="rv-view-field full"><div class="rv-view-field-value">${review.actions}</div></div></div>` : ''}
    ${review.notes ? `<div class="rv-view-section"><div class="rv-view-section-title">Additional Notes</div><div class="rv-view-field full"><div class="rv-view-field-value">${review.notes}</div></div></div>` : ''}
    ${review.diffNotes ? `<div class="rv-view-section"><div class="rv-view-section-title" style="color:var(--purple-light)">Difficult Conversation Notes</div><div class="rv-view-field full"><div class="rv-view-field-value">${review.diffNotes}</div></div></div>` : ''}
  `;
  document.getElementById('rv-view-modal').classList.add('open');
}

// ── RENDER LIST ──
function renderList() {
  const reviews = loadReviews();
  const list = document.getElementById('rv-list');
  if(!reviews.length) {
    list.innerHTML = '<div class="rv-list-empty"><span>📋</span>No reviews yet. Click "New Review" to add the first one.</div>';
    return;
  }
  list.innerHTML = reviews.map(r => {
    const initials = r.tech.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
    const dateStr = r.date ? new Date(r.date+'T00:00:00').toLocaleDateString('en-CA',{month:'short',day:'numeric',year:'numeric'}) : '';
    return `
    <div class="rv-card" onclick="viewReview(${r.id})">
      <div class="rv-card-left">
        <div class="rv-card-avatar">${initials}</div>
        <div>
          <div class="rv-card-name">${r.tech}</div>
          <div class="rv-card-meta">${r.level || ''}${r.level && dateStr ? ' · ' : ''}${dateStr}</div>
        </div>
      </div>
      <div class="rv-card-right">
        ${r.quarter ? `<div class="rv-card-quarter">${r.quarter}</div>` : ''}
        <div class="rv-card-actions">
          <button class="rv-card-btn" onclick="editReview(${r.id}, event)">Edit</button>
          <button class="rv-card-btn del" onclick="deleteReview(${r.id}, event)">Delete</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

// Init
renderQuestionFields();
renderList();


// (script block boundary)


function toggleStandard(id) {
  const body = document.getElementById('fm-body-' + id);
  const chevron = document.getElementById('fm-chevron-' + id);
  const header = body.previousElementSibling;
  const isOpen = body.classList.contains('open');
  body.classList.toggle('open', !isOpen);
  chevron.classList.toggle('open', !isOpen);
  header.classList.toggle('open', !isOpen);
}

const FM_KEY = 'alpine_foreman_standards';
const FM_FIELDS = ['s1-notes','s2-notes','s3-notes','s4-notes'];

function fmSave() {
  const data = {};
  FM_FIELDS.forEach(f => { data[f] = document.getElementById('fm-' + f).value; });
  localStorage.setItem(FM_KEY, JSON.stringify(data));
  const status = document.getElementById('fm-save-status');
  status.classList.add('show');
  setTimeout(() => status.classList.remove('show'), 2200);
}

function fmLoad() {
  try {
    const raw = localStorage.getItem(FM_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    Object.entries(data).forEach(([k, v]) => {
      const el = document.getElementById('fm-' + k);
      if (el) el.value = v;
    });
  } catch(e) {}
}

function fmReset() {
  if (!confirm('Clear all saved foreman notes? This cannot be undone.')) return;
  localStorage.removeItem(FM_KEY);
  FM_FIELDS.forEach(f => { const el = document.getElementById('fm-' + f); if (el) el.value = ''; });
}

fmLoad();


// (script block boundary)


// ── ONBOARDING v2 — PER-HIRE PROFILES ─────────────────────────────
const OB_KEY = 'alpine_onboarding_v2';
let obCurrentHireId = null;
let obCurrentSubRole = 'role'; // 'role' or 'all'

// ── Checklist definitions ─────────────────────────────────────────
const OB_CHECKLISTS = {
  all: {
    label: '📋 All New Hires',
    sections: [
      { id:'docs', title:'Documents & Paperwork', icon:'📄', tag:'Day 1', open:true, items:[
        'Ontario Personal Tax Credits Return (TD1-ON)',
        'Federal Personal Tax Credits Return (TD1)',
        'Alpine Health & Safety Policy — reviewed & signed',
        'Alpine Workplace Violence & Harassment Policy — reviewed & signed',
        'Employment Agreement — role-specific version signed',
        'Alpine Key Result Areas document — role-specific version reviewed',
        'Expense Submission & Packing Slip Instructions — if applicable to role',
        "Copy of driver's licence & driver's abstract collected"
      ]},
      { id:'equip', title:'Basic Equipment', icon:'📦', tag:'Day 1', open:false, items:[
        'Company phone issued (with screen protector & case)',
        'Laptop or iPad issued (with protective case/cover)',
        'Uniform: 2 shirts + 1 hat on hire; full uniform after 3-month probation',
        'Parking pass provided — if applicable',
        'Building keys issued — after 30 days if applicable'
      ]},
      { id:'sys', title:'System Setup', icon:'💻', tag:'Day 1', open:false, items:[
        'Company phone activated & configured',
        'Outlook email account created & tested',
        'Microsoft 365 access provisioned'
      ]},
      { id:'prob', title:'Probation & Review Rhythm', icon:'📅', tag:'3 Months', open:false, items:[
        'Probation period: 3 months — same for all roles',
        'New hire folded into the quarterly review cycle',
        'myHSA benefits activated after 3-month probation',
        'Formal correction/termination meeting scheduled if concerns arise before probation expires'
      ]}
    ]
  },
  tech: {
    label: '🔧 Technician',
    sections: [
      { id:'w1', title:'Week 1 Schedule', icon:'📅', tag:'Days 1–5', open:true, items:[
        'Day 1: Office/shop orientation — meet the team, tour the facility, review culture & expectations',
        'Day 1–2: Health & Safety training completed — all required certifications reviewed',
        'Day 3–5: Shadow a senior technician in the field — observe job workflow, client interaction, site procedures'
      ]},
      { id:'safety', title:'Safety Gear & Certifications', icon:'🦺', tag:'Day 1', open:false, items:[
        'Hard hat issued','Safety vest issued','Safety glasses issued','Ear protection issued',
        'Gloves issued (standard & electrical)','Ventilation mask issued',
        'Safety boots confirmed (employee-supplied)','H&S policy reviewed and signed'
      ]},
      { id:'sys', title:'Systems & Software', icon:'💻', tag:'Day 1', open:false, items:[
        'BuildOps account created & login tested (field service & dispatch)',
        'QuickBooks Workforce set up (time tracking)',
        'BuildOps walkthrough completed with a senior tech or admin'
      ]},
      { id:'vehicle', title:'Company Vehicle', icon:'🚐', tag:'Year 2+', open:false, items:[
        "Valid driver's licence confirmed & driver's abstract on file",
        'Vehicle assigned at Year 2 milestone',
        'Vehicle insurance set up in employee name',
        'Vehicle condition walk-around completed & documented',
        'Fuel card / expense card issued if applicable'
      ]},
      { id:'miles', title:'Career Milestones to Communicate', icon:'🏆', tag:'Ongoing', open:false, items:[
        'Year 2 — company vehicle assigned: communicated to tech during onboarding',
        'Year 3 — profit sharing eligibility begins: communicated to tech during onboarding',
        'Compensation plan reviewed and understood'
      ]}
    ]
  },
  sales: {
    label: '📈 Sales (BDR)',
    sections: [
      { id:'vehicle', title:'Company Vehicle', icon:'🚗', tag:'Day 1', open:true, items:[
        "Valid driver's licence confirmed & driver's abstract on file",
        'Vehicle assigned & keys handed over Day 1',
        'Vehicle insurance set up in employee name',
        'Vehicle condition walk-around completed & documented',
        'Fuel / expense card issued',
        'Expense submission process reviewed'
      ]},
      { id:'w1', title:'Week 1 Schedule', icon:'📅', tag:'Days 1–5', open:true, items:[
        'Day 1: Office orientation — company overview, team introductions, culture & expectations',
        'Day 1–3: Pitch & materials training — Alpine service offering, value proposition, target client profiles',
        'Day 2–4: BuildOps CRM setup & pipeline training — contact logging, opportunity stages, reporting expectations',
        'Day 4–5: Review commission structure, contact ownership policy, and territory context'
      ]},
      { id:'sys', title:'Systems & Software', icon:'💻', tag:'Day 1', open:false, items:[
        'BuildOps CRM account created & login tested',
        'BuildOps pipeline walkthrough completed',
        'Microsoft 365 / Outlook configured',
        'Company phone set up for client calls'
      ]},
      { id:'comp', title:'Compensation & Expectations Review', icon:'💰', tag:'Day 1', open:false, items:[
        'Base salary confirmed in employment agreement',
        'Commission structure reviewed: 30% self-generated / 5% company leads — 50/50 split at signing & 6 months',
        'Contact ownership policy explained: all contacts belong to Alpine; BDR role is to develop new ones',
        'Territory context explained (formal territory assigned when multiple BDRs are active)',
        'Profit sharing not applicable — confirmed and understood',
        'KRA (Key Result Areas) document reviewed'
      ]}
    ]
  },
  support: {
    label: '🎧 Support',
    sections: [
      { id:'w1', title:'Week 1 Schedule', icon:'📅', tag:'Days 1–5', open:true, items:[
        'Day 1: Office orientation — team introductions, workspace setup, company overview',
        'Day 1–2: Systems access provisioned and tested',
        'Day 2–4: Shadow existing support staff — observe dispatch, customer communication, job coordination',
        'Day 3–5: BuildOps training — scheduling, dispatch, job notes, and customer records'
      ]},
      { id:'sys', title:'Systems & Software', icon:'💻', tag:'Day 1', open:true, items:[
        'Microsoft 365 / Outlook configured — email & calendar',
        'BuildOps account created, login tested, and walkthrough completed',
        'Customer phone system set up (CRM / phone platform)',
        'QuickBooks Workforce set up — if hourly role'
      ]},
      { id:'comp', title:'Compensation & Expectations Review', icon:'💰', tag:'Day 1', open:false, items:[
        'Compensation structure confirmed in employment agreement',
        'Direct compensation model explained — profit sharing not applicable',
        'KRA (Key Result Areas) document reviewed',
        'Time tracking process confirmed (QuickBooks Workforce if hourly)'
      ]}
    ]
  }
};

// ── State helpers ─────────────────────────────────────────────────
function obLoad() {
  try { const r=localStorage.getItem(OB_KEY); if(!r||r==='null') return {hires:[]}; return JSON.parse(r)||{hires:[]}; } catch(e){ return {hires:[]}; }
}
function obSave(state){ localStorage.setItem(OB_KEY, JSON.stringify(state)); }

function obGenId(){ return 'h' + Date.now() + Math.random().toString(36).slice(2,6); }

// ── Add hire ──────────────────────────────────────────────────────
function obAddHire(){
  const name = document.getElementById('ob-new-name').value.trim();
  const role = document.getElementById('ob-new-role').value;
  const start = document.getElementById('ob-new-start').value;
  if(!name){ alert('Please enter a name.'); return; }
  const state = obLoad();
  state.hires.push({ id:obGenId(), name, role, start, archived:false, checks:{}, notes:{} });
  obSave(state);
  document.getElementById('ob-new-name').value='';
  document.getElementById('ob-new-start').value='';
  obRenderList();
}

// ── Render hire list ─────────────────────────────────────────────
function obRoleLabel(role){ return {tech:'Technician',sales:'Sales (BDR)',support:'Support'}[role]||role; }
function obRoleEmoji(role){ return {tech:'🔧',sales:'📈',support:'🎧'}[role]||''; }

function obHireProgress(hire){
  const allSections = [...OB_CHECKLISTS.all.sections, ...OB_CHECKLISTS[hire.role].sections];
  let total=0, done=0;
  allSections.forEach(sec=>{
    sec.items.forEach((_,i)=>{
      total++;
      if(hire.checks[sec.id+':'+i]) done++;
    });
  });
  return total ? Math.round((done/total)*100) : 0;
}

function obRenderList(){
  const state = obLoad();
  const active = state.hires.filter(h=>!h.archived);
  const archived = state.hires.filter(h=>h.archived);

  const activeEl = document.getElementById('ob-hire-list-active');
  const emptyEl = document.getElementById('ob-hire-list-empty');
  activeEl.innerHTML = '';
  if(!active.length){ emptyEl.style.display=''; } else { emptyEl.style.display='none'; }
  active.forEach(h=>{
    const pct = obHireProgress(h);
    const initials = h.name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
    const startTxt = h.start ? new Date(h.start+'T12:00:00').toLocaleDateString('en-CA',{month:'short',day:'numeric',year:'numeric'}) : 'No start date';
    const card = document.createElement('div');
    card.className='ob-hire-card';
    card.onclick=()=>obOpenHire(h.id);
    card.innerHTML=`
      <div class="ob-hire-avatar">${initials}</div>
      <div class="ob-hire-info">
        <div class="ob-hire-name">${h.name}</div>
        <div class="ob-hire-meta"><span>${obRoleEmoji(h.role)} ${obRoleLabel(h.role)}</span><span>Started ${startTxt}</span></div>
      </div>
      <div class="ob-hire-progress-track"><div class="ob-hire-progress-fill" style="width:${pct}%"></div></div>
      <div class="ob-hire-pct">${pct}%</div>
    `;
    activeEl.appendChild(card);
  });

  // Archive section
  const archSec = document.getElementById('ob-archive-section');
  const archEl = document.getElementById('ob-hire-list-archived');
  if(archived.length){ archSec.style.display=''; } else { archSec.style.display='none'; }
  archEl.innerHTML='';
  archived.forEach(h=>{
    const pct = obHireProgress(h);
    const initials = h.name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
    const card = document.createElement('div');
    card.className='ob-hire-card archived';
    card.onclick=()=>obOpenHire(h.id);
    card.innerHTML=`
      <div class="ob-hire-avatar" style="background:var(--mid)">${initials}</div>
      <div class="ob-hire-info">
        <div class="ob-hire-name">${h.name}</div>
        <div class="ob-hire-meta"><span>${obRoleEmoji(h.role)} ${obRoleLabel(h.role)}</span><span>Archived</span></div>
      </div>
      <div class="ob-hire-progress-track"><div class="ob-hire-progress-fill" style="width:${pct}%"></div></div>
      <div class="ob-hire-pct">${pct}%</div>
    `;
    archEl.appendChild(card);
  });
}

function obToggleArchiveSection(){
  const el = document.getElementById('ob-hire-list-archived');
  const lbl = document.getElementById('ob-archive-toggle-label');
  const hidden = el.style.display==='none';
  el.style.display = hidden?'':'none';
  lbl.textContent = hidden?'[hide]':'[show]';
}

// ── Open hire detail ──────────────────────────────────────────────
function obOpenHire(id){
  obCurrentHireId = id;
  const state = obLoad();
  const hire = state.hires.find(h=>h.id===id);
  if(!hire) return;

  document.getElementById('ob-hire-list-view').style.display='none';
  document.getElementById('ob-hire-detail-view').style.display='';

  const startTxt = hire.start ? new Date(hire.start+'T12:00:00').toLocaleDateString('en-CA',{month:'short',day:'numeric',year:'numeric'}) : '';
  document.getElementById('ob-detail-name-bar').textContent = hire.name + (startTxt?' — '+startTxt:'');
  document.getElementById('ob-archive-btn').textContent = hire.archived ? '↺ Unarchive' : '⬇ Archive';

  // Build role sub-tabs: role-specific + all
  const roleBar = document.getElementById('ob-detail-role-bar');
  roleBar.innerHTML='';
  const tabs = [
    {key: hire.role, label: OB_CHECKLISTS[hire.role].label},
    {key: 'all', label: OB_CHECKLISTS.all.label}
  ];
  tabs.forEach((t,i)=>{
    const btn = document.createElement('button');
    btn.className='ob-role-btn'+(i===0?' active':'');
    btn.textContent=t.label;
    btn.onclick=()=>{ obShowDetailRole(t.key); roleBar.querySelectorAll('.ob-role-btn').forEach(b=>b.classList.remove('active')); btn.classList.add('active'); };
    roleBar.appendChild(btn);
  });

  // Render panels
  obCurrentSubRole = hire.role;
  obRenderDetailPanels(hire);
  obShowDetailRole(hire.role);
}

function obBackToList(){
  obCurrentHireId=null;
  document.getElementById('ob-hire-list-view').style.display='';
  document.getElementById('ob-hire-detail-view').style.display='none';
  obRenderList();
}

// ── Render checklist panels for a hire ───────────────────────────
function obRenderDetailPanels(hire){
  const container = document.getElementById('ob-detail-panels');
  container.innerHTML='';
  ['role','all'].forEach(which=>{
    const roleKey = which==='role' ? hire.role : 'all';
    const def = OB_CHECKLISTS[roleKey];
    const panelDiv = document.createElement('div');
    panelDiv.id='ob-dpanel-'+which;
    panelDiv.style.display='none';
    panelDiv.innerHTML=`
      <div class="ob-inner" style="max-width:880px;margin:0 auto;padding:2.5rem 2rem 4rem">
        <div id="ob-dprogress-wrap-${which}" class="ob-progress-wrap">
          <div class="ob-progress-meta"><span class="ob-progress-label">Completion</span><span class="ob-progress-pct" id="ob-dpct-${which}">0%</span></div>
          <div class="ob-progress-track"><div class="ob-progress-fill" id="ob-dfill-${which}" style="width:0%"></div></div>
        </div>
        <div id="ob-dsections-${which}"></div>
      </div>`;
    container.appendChild(panelDiv);

    const sectionsEl = panelDiv.querySelector('#ob-dsections-'+which);
    def.sections.forEach(sec=>{
      const card = document.createElement('div');
      card.className='ob-card'+(sec.open?' open':'');
      card.id='ob-dsec-'+which+'-'+sec.id;
      const listHTML = sec.items.map((item,i)=>{
        const ck = hire.checks[sec.id+':'+i]||false;
        return `<li class="${ck?'done':''}">
          <div class="ob-check${ck?' checked':''}" data-sec="${sec.id}" data-idx="${i}" data-which="${which}" onclick="obDetailCheck(this)"></div>
          <span>${item}</span></li>`;
      }).join('');
      const noteKey = which+':'+sec.id;
      const noteVal = (hire.notes[noteKey]||'').replace(/"/g,'&quot;');
      card.innerHTML=`
        <div class="ob-card-header" onclick="this.closest('.ob-card').classList.toggle('open')">
          <span class="ob-card-icon">${sec.icon}</span>
          <span class="ob-card-title">${sec.title}</span>
          <span class="ob-card-tag">${sec.tag}</span>
          <span class="ob-card-chevron">▼</span>
        </div>
        <div class="ob-card-body">
          <ul class="ob-checklist">${listHTML}</ul>
          <span class="ob-note-label">Notes</span>
          <textarea class="ob-note" data-notekey="${noteKey}" placeholder="Notes…" oninput="obDetailNote(this)">${hire.notes[noteKey]||''}</textarea>
        </div>`;
      sectionsEl.appendChild(card);
    });
  });
  obUpdateDetailProgress(hire);
}

function obShowDetailRole(which){
  obCurrentSubRole = which;
  document.getElementById('ob-dpanel-role').style.display = which!=='all'?'':'none';
  document.getElementById('ob-dpanel-all').style.display = which==='all'?'':'none';
}

// ── Check interaction ─────────────────────────────────────────────
function obDetailCheck(el){
  el.classList.toggle('checked');
  const li=el.closest('li'); if(li) li.classList.toggle('done',el.classList.contains('checked'));
  const state=obLoad();
  const hire=state.hires.find(h=>h.id===obCurrentHireId); if(!hire) return;
  const key=el.dataset.sec+':'+el.dataset.idx;
  hire.checks[key]=el.classList.contains('checked');
  obSave(state);
  obUpdateDetailProgress(hire);
}

function obDetailNote(el){
  const state=obLoad();
  const hire=state.hires.find(h=>h.id===obCurrentHireId); if(!hire) return;
  hire.notes[el.dataset.notekey]=el.value;
  obSave(state);
}

// ── Progress for detail view ──────────────────────────────────────
function obUpdateDetailProgress(hire){
  ['role','all'].forEach(which=>{
    const roleKey = which==='role' ? hire.role : 'all';
    const def = OB_CHECKLISTS[roleKey];
    let total=0,done=0;
    def.sections.forEach(sec=>{
      sec.items.forEach((_,i)=>{
        total++;
        if(hire.checks[sec.id+':'+i]) done++;
      });
    });
    const pct=total?Math.round((done/total)*100):0;
    const fill=document.getElementById('ob-dfill-'+which);
    const lbl=document.getElementById('ob-dpct-'+which);
    if(fill) fill.style.width=pct+'%';
    if(lbl) lbl.textContent=pct+'%';
  });
}

// ── Archive toggle ────────────────────────────────────────────────
function obToggleArchiveHire(){
  const state=obLoad();
  const hire=state.hires.find(h=>h.id===obCurrentHireId); if(!hire) return;
  hire.archived=!hire.archived;
  obSave(state);
  document.getElementById('ob-archive-btn').textContent=hire.archived?'↺ Unarchive':'⬇ Archive';
}

// ── Delete hire ───────────────────────────────────────────────────
function obDeleteHire(){
  const state=obLoad();
  const hire=state.hires.find(h=>h.id===obCurrentHireId); if(!hire) return;
  if(!confirm('Permanently delete '+hire.name+'? This cannot be undone.')) return;
  state.hires=state.hires.filter(h=>h.id!==obCurrentHireId);
  obSave(state);
  obBackToList();
}

// ── Init ──────────────────────────────────────────────────────────
obRenderList();
