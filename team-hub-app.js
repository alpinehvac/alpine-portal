// ── AI EVAL RESULT RENDERING (shared across Sales/Tech/BAS recruiting) ──
// Used both right after a live evaluation and to redraw a previously-saved
// evaluation when a candidate file is reopened (by anyone, on any device).
function apRenderAIEvalHTML(result, acceptFnName) {
  const traitsHtml = (result.traits || []).map(t => {
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
  const observedVals = (result.traits || []).filter(t => t.observed).map(t => t.val);
  const count = observedVals.length;
  return `
    <div class="sr-ai-result-header">
      <div class="sr-ai-result-title">✦ AI Evaluation — ${count} of 6 traits observed</div>
      <button class="sr-ai-accept-btn" onclick="${acceptFnName}(${JSON.stringify(observedVals).replace(/"/g,'&quot;')})">Apply to Profile</button>
    </div>
    <div class="sr-ai-result-body">${traitsHtml}</div>
    ${result.overall ? `<div class="sr-ai-overall">${result.overall}</div>` : ''}`;
}

// ── DATA MANAGER ──
const DM_KEYS = ['alpine_reviews_v1','alpine_review_questions_v1','alpine_foreman_standards','alpine_bdr_candidates','alpine_tech_candidates','alpine_bas_candidates','alpine_sr_q1','alpine_sr_q2','alpine_sr_q3','alpine_bc_q1','alpine_bc_q2','alpine_bc_q3','alpine_onboarding_v2','alpine_preint_v1'];

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
  // Review transcripts are stored one per review
  Object.keys(localStorage).filter(k => k.startsWith('alpine_review_tx_')).forEach(k => {
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
  [0,1,2].forEach(n => {
    const resultEl = document.getElementById('sr-ai-result-'+n);
    if (!resultEl) return;
    const saved = (c.aiEvalResults||{})[n];
    if (saved) {
      resultEl.innerHTML = apRenderAIEvalHTML(saved, 'srAcceptAIEval');
      resultEl.style.display = 'block';
    } else {
      resultEl.innerHTML = '';
      resultEl.style.display = 'none';
    }
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
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const data = await res.json();
    const text = (data.content||[]).map(b=>b.text||'').join('').trim();
    const clean = text.replace(/```json|```/g,'').trim();
    const result = JSON.parse(clean);

    resultEl.innerHTML = apRenderAIEvalHTML(result, 'srAcceptAIEval');
    resultEl.style.display = 'block';

    // Persist the full evaluation (rationale + overall), not just the trait
    // checklist, so it syncs to Firestore and is visible to everyone —
    // including on reload — not just whoever ran it in this browser.
    if (c) {
      c.aiEvalResults = c.aiEvalResults || {};
      c.aiEvalResults[n] = { traits: result.traits, overall: result.overall || '', ranAt: Date.now() };
      srSaveCands(srCands);
    }
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
  [0,1,2].forEach(n => {
    const resultEl = document.getElementById('tc-ai-result-'+n);
    if (!resultEl) return;
    const saved = (c.aiEvalResults||{})[n];
    if (saved) {
      resultEl.innerHTML = apRenderAIEvalHTML(saved, 'tcAcceptAIEval');
      resultEl.style.display = 'block';
    } else {
      resultEl.innerHTML = '';
      resultEl.style.display = 'none';
    }
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
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const data = await res.json();
    const text = (data.content||[]).map(b=>b.text||'').join('').trim();
    const clean = text.replace(/```json|```/g,'').trim();
    const result = JSON.parse(clean);

    resultEl.innerHTML = apRenderAIEvalHTML(result, 'tcAcceptAIEval');
    resultEl.style.display = 'block';

    if (c) {
      c.aiEvalResults = c.aiEvalResults || {};
      c.aiEvalResults[n] = { traits: result.traits, overall: result.overall || '', ranAt: Date.now() };
      tcSaveCands(tcCands);
    }
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

/* ── BC TAB SWITCHING (BAS RECRUITING: OVERVIEW / CANDIDATES) ── */
function bcTab(id) {
  document.querySelectorAll('#panel-bas-recruiting .sr-tab').forEach((t) => {
    t.classList.toggle('active', t.getAttribute('onclick').includes(id));
  });
  document.querySelectorAll('#panel-bas-recruiting .sr-panel').forEach(p => {
    p.classList.toggle('active', p.id === id);
  });
  // Re-render questions after panel becomes visible so autoGrow works
  if (id === 'bc-int1') setTimeout(() => bcRenderQ('bc-q-list-1'), 0);
  if (id === 'bc-int2') setTimeout(() => bcRenderQ('bc-q-list-2'), 0);
  if (id === 'bc-int3') setTimeout(() => bcRenderQ('bc-q-list-3'), 0);
}

/* ── QUESTIONS (BAS) ── */
const BC_DEFAULT_Q1 = [
  {text:'Tell me about yourself and how you got into building automation / controls work.', note:'Listen for genuine interest vs. it being an accident. You\'re just listening for their story here, not evaluating technical content.'},
  {text:'Walk me through a typical day or week in your current or most recent role — what does that actually look like?', note:'Specificity is the signal, not technical accuracy. A candidate who describes real, concrete work stands out from one who stays vague or generic.'},
  {text:'Tell me about a project or job you\'re especially proud of. Walk me through it start to finish.', note:'Do they own the story and go deep, or is someone else clearly doing the real work? You\'re listening for ownership and detail, not whether the technical fix was "correct."'},
  {text:'Tell me about a time something didn\'t go the way you expected on a job. What happened, and how did you handle it?', note:'Listen for accountability and a clear-headed process, not the specific technical solution — you don\'t need BAS knowledge to judge how someone reacts to a curveball.'},
  {text:'What are you looking for in your next role, and what made you start looking?', note:'Growth and skill-building vs. just a paycheck or an unhappy exit — either is fine to hear, just listen for which it is.'},
  {text:'What questions do you have for me?', note:'Thoughtful questions indicate genuine interest. Silence is a flag.'}
];
const BC_DEFAULT_Q2 = [
  {text:'Pick a system you know well and walk me through its sequence of operation.', note:'Depth and clarity here separate real experience from résumé padding.'},
  {text:'A space is calling for cooling but the AHU isn\'t responding — how would you troubleshoot that?', note:'Listen for a logical process, not a random guess.'},
  {text:'What\'s the difference between a hardwired point and a networked point?', note:'Fundamental concept — should be second nature for a real BAS tech.'},
  {text:'Have you written or edited control logic yourself, or mostly worked from existing programs?', note:'Matters for where they\'d land in the pay range.'},
  {text:'How do you handle a job where the documentation is wrong or missing?', note:'Real-world resourcefulness signal.'}
];
const BC_DEFAULT_Q3 = [
  {text:'You\'ll be part of a rotating on-call schedule for after-hours emergencies. How do you feel about that?', note:'Listen for genuine comfort, not just compliance. Discomfort here is a signal.'},
  {text:'Pay here isn\'t tied to years of service — it\'s tied to what you can demonstrably do. Walk me through how you\'re thinking about that.', note:'Motivated candidates find this exciting, not threatening.'},
  {text:'Most jobs are solo, with no supervisor on site. How do you handle making judgment calls on your own?', note:'Listen for confidence and sound reasoning, not bravado.'}
];

function bcLoadQ(key, defaults) {
  try { const v = localStorage.getItem(key); if (!v || v === 'null') return defaults.map(q=>({...q})); const p = JSON.parse(v); return Array.isArray(p) && p.length ? p : defaults.map(q=>({...q})); } catch(e) { return defaults.map(q=>({...q})); }
}
const bcQuestions = {
  'bc-q-list-1': bcLoadQ('alpine_bc_q1', BC_DEFAULT_Q1),
  'bc-q-list-2': bcLoadQ('alpine_bc_q2', BC_DEFAULT_Q2),
  'bc-q-list-3': bcLoadQ('alpine_bc_q3', BC_DEFAULT_Q3)
};
const bcQKeys = {'bc-q-list-1':'alpine_bc_q1','bc-q-list-2':'alpine_bc_q2','bc-q-list-3':'alpine_bc_q3'};

function bcSaveQ(listId) { localStorage.setItem(bcQKeys[listId], JSON.stringify(bcQuestions[listId])); }

function bcRenderQ(listId) {
  const el = document.getElementById(listId); if(!el) return;
  el.innerHTML = '';
  bcQuestions[listId].forEach((q, i) => {
    const li = document.createElement('li'); li.className='sr-q-item';
    li.innerHTML = `<div class="sr-q-row"><span class="sr-q-num">${i+1}</span><div class="sr-q-body"><textarea class="sr-q-text" rows="1" oninput="bcUpdateQ('${listId}',${i},'text',this);srAutoGrow(this)">${srEsc(q.text)}</textarea><textarea class="sr-q-note" rows="1" placeholder="Add a note for the interviewer…" oninput="bcUpdateQ('${listId}',${i},'note',this);srAutoGrow(this)">${srEsc(q.note||'')}</textarea></div><button class="sr-q-del" onclick="bcDeleteQ('${listId}',${i})">×</button></div>`;
    el.appendChild(li);
  });
  el.querySelectorAll('textarea').forEach(srAutoGrow);
}
function bcUpdateQ(listId, i, field, el) { bcQuestions[listId][i][field] = el.value; bcSaveQ(listId); }
function bcDeleteQ(listId, i) { if(bcQuestions[listId].length<=1) return; bcQuestions[listId].splice(i,1); bcSaveQ(listId); bcRenderQ(listId); }
function bcAddQ(listId) { bcQuestions[listId].push({text:'',note:''}); bcSaveQ(listId); bcRenderQ(listId); const last = document.getElementById(listId).lastElementChild; if(last) last.querySelector('.sr-q-text').focus(); }

bcRenderQ('bc-q-list-1');
bcRenderQ('bc-q-list-2');
bcRenderQ('bc-q-list-3');

/* ── CANDIDATE TRACKER (BAS) ── */
const BC_CANDS_KEY = 'alpine_bas_candidates';
function bcLoadCands() {
  try {
    const v = localStorage.getItem(BC_CANDS_KEY);
    if (!v || v === 'null') return [];
    const p = JSON.parse(v);
    if (!Array.isArray(p)) return [];
    let changed = false;
    p.forEach((c, i) => {
      if (!c.id) { c.id = Date.now() + i; changed = true; }
    });
    if (changed) localStorage.setItem(BC_CANDS_KEY, JSON.stringify(p));
    return p;
  } catch(e) { return []; }
}
function bcSaveCands(c) { localStorage.setItem(BC_CANDS_KEY, JSON.stringify(c)); }

let bcCands = bcLoadCands();
let bcEditingId = null;
let bcCurrentId = null;

function bcToggleChip(el, color) {
  const cls = 'sel-'+color;
  el.classList.toggle(cls);
}
function bcGetSelectedChips(containerId) {
  return Array.from(document.querySelectorAll('#'+containerId+' .sr-chip.sel-green')).map(c=>c.dataset.val);
}
function bcGetSelectedRedChips(containerId) {
  return Array.from(document.querySelectorAll('#'+containerId+' .sr-chip.sel-red')).map(c=>c.dataset.val);
}
function bcResetChips() {
  document.querySelectorAll('#bc-pos-chips .sr-chip').forEach(c=>c.classList.remove('sel-green','sel-red'));
  document.querySelectorAll('#bc-neg-chips .sr-chip').forEach(c=>c.classList.remove('sel-green','sel-red'));
}
function bcToggleEval(el) { el.classList.toggle('checked'); }
function bcGetEvalTraits() {
  return Array.from(document.querySelectorAll('#bc-modal-eval-grid .sr-eval-item.checked')).map(el=>el.dataset.val);
}
function bcSetEvalTraits(vals) {
  document.querySelectorAll('#bc-modal-eval-grid .sr-eval-item').forEach(el=>{
    el.classList.toggle('checked', (vals||[]).includes(el.dataset.val));
  });
}
function bcResetEval() { document.querySelectorAll('#bc-modal-eval-grid .sr-eval-item').forEach(el=>el.classList.remove('checked')); }
function bcSetChips(posTraits, negTraits) {
  bcResetChips();
  document.querySelectorAll('#bc-pos-chips .sr-chip').forEach(c=>{ if((posTraits||[]).includes(c.dataset.val)) c.classList.add('sel-green'); });
  document.querySelectorAll('#bc-neg-chips .sr-chip').forEach(c=>{ if((negTraits||[]).includes(c.dataset.val)) c.classList.add('sel-red'); });
}

function bcOpenModal(id) {
  bcEditingId = id||null;
  document.getElementById('bc-modal-title').textContent = id ? 'Edit Candidate' : 'Add Candidate';
  if(id) {
    const c = bcCands.find(x=>x.id===id); if(!c) return;
    document.getElementById('bcf-name').value = c.name||'';
    document.getElementById('bcf-date').value = c.date||'';
    document.getElementById('bcf-stage').value = c.stage||'Interview 1';
    document.getElementById('bcf-decision').value = c.decision||'pending';
    document.getElementById('bcf-score').value = c.score||'';
    bcSetChips(c.posTraits, c.negTraits);
    bcSetEvalTraits(c.evalTraits);
  } else {
    document.getElementById('bcf-name').value=''; document.getElementById('bcf-date').value='';
    document.getElementById('bcf-stage').value='Interview 1'; document.getElementById('bcf-decision').value='pending';
    document.getElementById('bcf-score').value=''; bcResetChips(); bcResetEval();
  }
  document.getElementById('bc-modal').classList.add('open');
}
function bcCloseModal() { document.getElementById('bc-modal').classList.remove('open'); }
function bcSaveCandidate() {
  const name = document.getElementById('bcf-name').value.trim(); if(!name){alert('Please enter a name.');return;}
  const cand = {
    id: bcEditingId || Date.now(),
    name, date: document.getElementById('bcf-date').value,
    stage: document.getElementById('bcf-stage').value,
    decision: document.getElementById('bcf-decision').value,
    score: document.getElementById('bcf-score').value,
    posTraits: bcGetSelectedChips('bc-pos-chips'),
    negTraits: bcGetSelectedRedChips('bc-neg-chips'),
    evalTraits: bcGetEvalTraits(),
    interviews: bcEditingId ? (bcCands.find(x=>x.id===bcEditingId)||{}).interviews||[{},{},{}] : [{},{},{}]
  };
  if(bcEditingId) { const idx=bcCands.findIndex(x=>x.id===bcEditingId); if(idx>-1) bcCands[idx]=cand; }
  else bcCands.unshift(cand);
  bcSaveCands(bcCands); bcCloseModal(); bcRenderCands();
}
function bcDeleteCurrent() {
  if(!confirm('Remove this candidate?')) return;
  bcCands = bcCands.filter(x=>x.id!==bcCurrentId);
  bcSaveCands(bcCands); bcCloseFile(); bcRenderCands();
}
function bcEditCurrent() { bcOpenModal(bcCurrentId); }

function bcRenderCands() {
  const buckets = {'Interview 1':'bc-bucket-i1','Interview 2':'bc-bucket-i2'};
  ['bc-bucket-i1','bc-bucket-i2','bc-bucket-later'].forEach(id => {
    document.getElementById(id).innerHTML = '';
  });
  if (!bcCands.length) {
    document.getElementById('bc-bucket-i1').innerHTML = '<div class="sr-empty">No candidates yet. Click "+ Add Candidate" to get started.</div>';
    return;
  }
  bcCands.forEach(c => {
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
    row.addEventListener('click', (function(candId){ return function(){ bcOpenFile(candId); }; })(c.id));
    const targetId = buckets[c.stage] || 'bc-bucket-later';
    document.getElementById(targetId).appendChild(row);
  });
  ['bc-bucket-i1','bc-bucket-i2','bc-bucket-later'].forEach(id => {
    if (!document.getElementById(id).children.length) {
      document.getElementById(id).innerHTML = '<div class="sr-empty">No candidates at this stage.</div>';
    }
  });
}

function bcOpenFile(id) {
  bcCurrentId = id;
  const c = bcCands.find(x => x.id == id); if (!c) return;
  document.getElementById('bc-file-name').textContent = c.name;
  const decBadge = c.decision==='advance'?'sr-badge-advance':c.decision==='pass'?'sr-badge-pass':'sr-badge-pending';
  const decLabel = c.decision==='advance'?'Advance':c.decision==='pass'?'Pass':'Pending';
  document.getElementById('bc-file-badges').innerHTML = `<span class="sr-badge ${decBadge}" style="margin-left:8px">${decLabel}</span>${c.score?`<span class="sr-badge sr-badge-score" style="margin-left:4px">${c.score}/10</span>`:''}`;
  const traitsHtml = (c.posTraits||[]).map(t=>`<span class="sr-chip sel-green" style="cursor:default">${t}</span>`).join('')+(c.negTraits||[]).map(t=>`<span class="sr-chip sel-red" style="cursor:default">${t}</span>`).join('');
  document.getElementById('bc-file-traits').innerHTML = traitsHtml;

  const BC_EVAL_FRAMEWORK = [
    {val:'Technical Competence', label:'Technical Competence'},
    {val:'Safety Mindset', label:'Safety Mindset'},
    {val:'Reliability', label:'Reliability'},
    {val:'Communication', label:'Communication'},
    {val:'Coachability', label:'Coachability'},
    {val:'Work Ethic', label:'Work Ethic'}
  ];
  const evalChecked = c.evalTraits || [];
  const evalCount = evalChecked.length;
  const evalGrid = document.getElementById('bc-file-eval-grid');
  const evalSection = document.getElementById('bc-file-eval');
  evalGrid.innerHTML = BC_EVAL_FRAMEWORK.map(t => {
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
    ['bci1-date','bci1-score','bci1-decision','bci1-interviewer','bci1-notes','bci1-summary'],
    ['bci2-date','bci2-score','bci2-decision','bci2-interviewer','bci2-notes','bci2-summary'],
    ['bci3-date','bci3-score','bci3-decision','bci3-interviewer','bci3-notes','bci3-refs']
  ];
  const keys = ['date','score','decision','interviewer','notes','summary'];
  fieldSets.forEach((flds, i) => {
    const iv = interviews[i] || {};
    flds.forEach((fid, j) => { const el = document.getElementById(fid); if (el) el.value = iv[keys[j]] || ''; });
  });
  [0,1,2].forEach(n => {
    const resultEl = document.getElementById('bc-ai-result-'+n);
    if (!resultEl) return;
    const saved = (c.aiEvalResults||{})[n];
    if (saved) {
      resultEl.innerHTML = apRenderAIEvalHTML(saved, 'bcAcceptAIEval');
      resultEl.style.display = 'block';
    } else {
      resultEl.innerHTML = '';
      resultEl.style.display = 'none';
    }
  });
  bcSubtab(0);
  document.getElementById('bc-cand-list-view').style.display = 'none';
  document.getElementById('bc-cand-file-view').classList.add('open');
}
function bcCloseFile() {
  document.getElementById('bc-cand-file-view').classList.remove('open');
  document.getElementById('bc-cand-list-view').style.display='block';
  bcCurrentId = null;
}
function bcSubtab(n) {
  document.querySelectorAll('#panel-bas-recruiting .sr-subtab').forEach((t,i)=>t.classList.toggle('active',i===n));
  document.querySelectorAll('#panel-bas-recruiting .sr-sub-panel').forEach((p,i)=>p.classList.toggle('active',i===n));
}
function bcSaveInterview(n) {
  const c = bcCands.find(x=>x.id===bcCurrentId); if(!c) return;
  if(!c.interviews) c.interviews=[{},{},{}];
  const fldSets = [['bci1-date','bci1-score','bci1-decision','bci1-interviewer','bci1-notes','bci1-summary'],['bci2-date','bci2-score','bci2-decision','bci2-interviewer','bci2-notes','bci2-summary'],['bci3-date','bci3-score','bci3-decision','bci3-interviewer','bci3-notes','bci3-refs']];
  const keys = ['date','score','decision','interviewer','notes','summary'];
  const flds = fldSets[n]; const iv = {};
  flds.forEach((fid,i)=>{ const el=document.getElementById(fid); if(el) iv[keys[i]]=el.value; });
  c.interviews[n]=iv;
  bcSaveCands(bcCands);
  const ok = document.getElementById('bc-save-ok-'+n); if(ok){ok.style.display='inline';setTimeout(()=>ok.style.display='none',2000);}
}

/* ── AI FRAMEWORK EVALUATION (BAS) ── */
const BC_EVAL_FRAMEWORK_DEF = [
  {val:'Technical Competence', desc:'Do they demonstrate real hands-on knowledge of HVAC systems, diagnostics, and repair? Do they speak concretely about past technical work rather than vaguely?'},
  {val:'Safety Mindset',       desc:'Do they treat safety as a habit, not an afterthought? Do they mention safety procedures, PPE, or lockout/tagout unprompted?'},
  {val:'Reliability',          desc:'Is there evidence of consistent attendance, follow-through, and dependability in past roles? Do they own missed commitments rather than deflect?'},
  {val:'Communication',        desc:'Can they explain technical issues clearly to a non-technical customer or teammate? Are they easy to understand and straightforward?'},
  {val:'Coachability',         desc:'Do they show openness to feedback and willingness to learn new methods, tools, or systems rather than being set in their ways?'},
  {val:'Work Ethic',           desc:'Do they show evidence of going the extra mile — staying late to finish a job, taking initiative, or taking pride in their work?'}
];

async function bcRunAIEval(n) {
  const noteIds = [['bci1-notes','bci1-summary'],['bci2-notes','bci2-summary'],['bci3-notes','bci3-refs']];
  const transcript = (document.getElementById(noteIds[n][0])||{}).value||'';
  const summary    = (document.getElementById(noteIds[n][1])||{}).value||'';
  if (!transcript.trim() && !summary.trim()) {
    alert('Please paste a transcript or notes into this interview before running the AI evaluation.');
    return;
  }
  const btn = document.getElementById('bc-ai-btn-'+n);
  const resultEl = document.getElementById('bc-ai-result-'+n);
  btn.disabled = true;
  btn.textContent = '✦ Evaluating…';
  resultEl.style.display = 'none';

  const c = bcCands.find(x=>x.id==bcCurrentId);
  const candidateName = c ? c.name : 'this candidate';

  const prompt = `You are an expert Building Automation Systems (BAS) technician hiring evaluator for Alpine HVAC, a commercial HVAC and building automation company based in Hamilton, Ontario. You are evaluating a BAS technician candidate named ${candidateName}.

Evaluate the following interview transcript and/or notes against the Alpine Technician Evaluation Framework — 6 core traits. For each trait, determine whether it was OBSERVED (yes) or NOT OBSERVED (no) in this interview, and provide a concise 1–2 sentence rationale citing specific evidence from the transcript.

ALPINE TECHNICIAN EVALUATION FRAMEWORK:
${BC_EVAL_FRAMEWORK_DEF.map((t,i)=>`${i+1}. ${t.val}: ${t.desc}`).join('\n')}

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
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const data = await res.json();
    const text = (data.content||[]).map(b=>b.text||'').join('').trim();
    const clean = text.replace(/```json|```/g,'').trim();
    const result = JSON.parse(clean);

    resultEl.innerHTML = apRenderAIEvalHTML(result, 'bcAcceptAIEval');
    resultEl.style.display = 'block';

    if (c) {
      c.aiEvalResults = c.aiEvalResults || {};
      c.aiEvalResults[n] = { traits: result.traits, overall: result.overall || '', ranAt: Date.now() };
      bcSaveCands(bcCands);
    }
  } catch(e) {
    resultEl.innerHTML = `<div class="sr-ai-result-body" style="color:rgba(220,100,100,0.8);font-size:.8rem;padding:.75rem">Evaluation failed. Check your connection and try again. (${e.message})</div>`;
    resultEl.style.display = 'block';
  }
  btn.disabled = false;
  btn.innerHTML = '✦ AI Evaluate';
}

function bcAcceptAIEval(observedVals) {
  const c = bcCands.find(x=>x.id==bcCurrentId); if(!c) return;
  const existing = c.evalTraits || [];
  const merged = [...new Set([...existing, ...observedVals])];
  c.evalTraits = merged;
  bcSaveCands(bcCands);
  const evalChecked = c.evalTraits;
  const evalGrid = document.getElementById('bc-file-eval-grid');
  const evalSection = document.getElementById('bc-file-eval');
  const BC_EVAL_LABELS = [{val:'Technical Competence',label:'Technical Competence'},{val:'Safety Mindset',label:'Safety Mindset'},{val:'Reliability',label:'Reliability'},{val:'Communication',label:'Communication'},{val:'Coachability',label:'Coachability'},{val:'Work Ethic',label:'Work Ethic'}];
  evalGrid.innerHTML = BC_EVAL_LABELS.map(t => {
    const checked = evalChecked.includes(t.val);
    return `<div class="sr-eval-item${checked?' checked':''}"><div class="sr-eval-check"><span class="sr-eval-check-mark">✓</span></div><div class="sr-eval-label">${t.label}</div></div>`;
  }).join('');
  const subtitle = evalSection.querySelector('.sr-eval-title span');
  if(subtitle) subtitle.textContent = `${evalChecked.length} of 6 observed`;
  const acceptBtn = document.querySelector('#bc-cands .sr-ai-accept-btn');
  if(acceptBtn){ acceptBtn.textContent = 'Applied ✓'; acceptBtn.style.background='rgba(28,107,110,0.35)'; setTimeout(()=>{ acceptBtn.textContent='Apply to Profile'; acceptBtn.style.background=''; },2000); }
}

bcRenderCands();

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


// ── TAB SWITCHING (two levels: group tabs → sub-tabs) ──
const TH_GROUP_KEY = 'alpine_teamhub_tab_v2';
let thRole = 'owners';

function thOwnerOk() { return typeof apIsOwner === 'function' && apIsOwner(); }

function thSubVisible(btn) {
  const roles = (btn.getAttribute('data-roles') || '').split(' ');
  if (btn.getAttribute('data-group') === 'team' && !thOwnerOk()) return false;
  return thRole === 'owners' || roles.indexOf(thRole) !== -1;
}

function showTab(name) {
  const panel = document.getElementById('panel-' + name);
  const btn = document.querySelector('#subTabs .subtab-btn[onclick="showTab(\'' + name + '\')"]');
  if (!panel || !btn || !thSubVisible(btn)) return;
  const group = btn.getAttribute('data-group');
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  panel.classList.add('active');
  document.querySelectorAll('#mainTabs .grp-btn').forEach(b => b.classList.toggle('active', b.getAttribute('data-group') === group));
  document.querySelectorAll('#subTabs .subtab-btn').forEach(b => {
    b.classList.toggle('active', b === btn);
    b.style.display = (b.getAttribute('data-group') === group && thSubVisible(b)) ? '' : 'none';
  });
  try { sessionStorage.setItem(TH_GROUP_KEY, name); } catch (e) {}
  // Re-render SR questions when sales tab opens so textarea autoGrow works correctly
  if (name === 'sales-recruiting') {
    srRenderQ('sr-q-list-1');
    srRenderQ('sr-q-list-2');
    srRenderQ('sr-q-list-3');
  }
  if (name === 'team' && typeof tfRenderDirectory === 'function') tfRenderDirectory();
  if (name === 'reviews' && typeof renderList === 'function') renderList();
}

function showGroup(group) {
  const first = Array.from(document.querySelectorAll('#subTabs .subtab-btn'))
    .find(b => b.getAttribute('data-group') === group && thSubVisible(b));
  if (first) first.click();
}

// ── ROLE-BASED TAB FILTERING ──
const ROLE_KEY = 'alpine_teamhub_role_v1';

function applyRoleFilter(role) {
  thRole = role || 'owners';
  // Group tabs: show only groups with at least one visible sub-tab
  document.querySelectorAll('#mainTabs .grp-btn').forEach(g => {
    const grp = g.getAttribute('data-group');
    const any = Array.from(document.querySelectorAll('#subTabs .subtab-btn'))
      .some(b => b.getAttribute('data-group') === grp && thSubVisible(b));
    g.style.display = any ? '' : 'none';
  });
  // Keep the current tab if still allowed, else open the first allowed one
  const active = document.querySelector('#subTabs .subtab-btn.active');
  let target = active && thSubVisible(active) ? active : null;
  if (!target) {
    let saved = null;
    try { saved = sessionStorage.getItem(TH_GROUP_KEY); } catch (e) {}
    const savedBtn = saved && document.querySelector('#subTabs .subtab-btn[onclick="showTab(\'' + saved + '\')"]');
    target = savedBtn && thSubVisible(savedBtn) ? savedBtn
      : Array.from(document.querySelectorAll('#subTabs .subtab-btn')).find(thSubVisible);
  }
  if (target) target.click();
  else document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));

  document.querySelectorAll('.role-tab-btn').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-role') === role);
  });
}

function setRole(role) {
  try { localStorage.setItem(ROLE_KEY, role); } catch (e) {}
  applyRoleFilter(role);
}

// (role filter init moved to the end of this file so every tab's code is loaded first)

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
const RV_TX_PREFIX = 'alpine_review_tx_';
function rvLoadTranscript(id) {
  return localStorage.getItem(RV_TX_PREFIX + id) || '';
}
function rvSaveTranscript(id, text) {
  if ((text || '').trim()) localStorage.setItem(RV_TX_PREFIX + id, text);
  else if (localStorage.getItem(RV_TX_PREFIX + id) !== null) localStorage.removeItem(RV_TX_PREFIX + id);
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
  if (typeof qnRenderQs === 'function') qnRenderQs();
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
  ['rv-tech','rv-date','rv-quarter','rv-level','rv-perf','rv-actions','rv-notes','rv-diff-notes','rv-transcript']
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
    memberId: (tfMatchMember(tech) || {}).id || null,
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
  // Transcripts are long, so each one is stored as its own record
  // (alpine_review_tx_<id>) instead of inside the shared reviews list,
  // keeping that list well under the cloud's 1 MB-per-record limit.
  rvSaveTranscript(review.id, (document.getElementById('rv-transcript') || {}).value || '');
  review.hasTranscript = !!((document.getElementById('rv-transcript') || {}).value || '').trim();
  const reviews = loadReviews();
  const idx = reviews.findIndex(r => r.id === editingId);
  if(idx > -1) reviews[idx] = review;
  else reviews.unshift(review);
  saveReviews(reviews);
  closeModal();
  renderList();
  tfAfterReviewChange();
}

// ── DELETE ──
function deleteReview(id, e) {
  e.stopPropagation();
  if(!confirm('Delete this review?')) return;
  const reviews = loadReviews().filter(r => r.id !== id);
  saveReviews(reviews);
  rvSaveTranscript(id, '');
  renderList();
  tfAfterReviewChange();
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
  if(document.getElementById('rv-transcript')) document.getElementById('rv-transcript').value = rvLoadTranscript(review.id);
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
    ${rvLoadTranscript(review.id) ? `<div class="rv-view-section"><details class="rv-transcript-view"><summary>Meeting Transcript (${rvLoadTranscript(review.id).trim().split(/\s+/).length.toLocaleString()} words) — click to expand</summary><div class="rv-transcript-body">${String(rvLoadTranscript(review.id)).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div></details></div>` : ''}
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

// ══════════════════════════════════════════════════════════════════
// ── TEAM FILES (owners only): profiles, SharePoint index, reviews ──
// Storage (Firestore team_files_data via AP_SYNC_ROUTES "tf_"):
//   tf_sharepoint_v1  — sync file written every two weeks by Claude (SharePoint → portal)
//   tf_profiles_v1    — profile details edited in the portal (never touched by the sync)
//   tf_settings_v1    — { flowUrl } for the Send Questionnaire Power Automate flow
//   tf_qn_log_v1      — questionnaire send history
// ══════════════════════════════════════════════════════════════════
const TF_SYNC_KEY = 'tf_sharepoint_v1';
const TF_PROFILES_KEY = 'tf_profiles_v1';
const TF_SETTINGS_KEY = 'tf_settings_v1';
const TF_QNLOG_KEY = 'tf_qn_log_v1';
const TF_SP_BASE = 'https://netorg13787440.sharepoint.com/sites/Admin-HR/Shared%20Documents/';

// Current team. The sync only fills in SharePoint data for these people; new
// SharePoint folders are listed as "not on roster" for an owner to review.
const TF_ROSTER = [
  { id:'jake-gilmore',     name:'Jake Gilmore',     title:'Co-Founder & CEO',             team:'Leadership', email:'jake.gilmore@alpinehvac.ca',     owner:true, aliases:['jake','jacob gilmore'] },
  { id:'mike-launder',     name:'Mike Launder',     title:'Co-Owner',                     team:'Leadership', email:'mike.launder@alpinehvac.ca',     owner:true, aliases:['mike','michael launder'] },
  { id:'clarissa-launder', name:'Clarissa Launder', title:'Office & Admin Support',       team:'Office',     email:'clarissa.launder@alpinehvac.ca', aliases:['clarissa'] },
  { id:'cole-hamilton',    name:'Cole Hamilton',    title:'Estimator / Sales',            team:'Sales',      email:'cole.hamilton@alpinehvac.ca',    aliases:['cole'] },
  { id:'natalie-townsend', name:'Natalie Townsend', title:'Business Development Rep',     team:'Sales',      email:'natalie.townsend@alpinehvac.ca', aliases:['natalie'] },
  { id:'steven-coles',     name:'Steven Coles',     title:'Service Foreman',              team:'Field',      email:'steven.coles@alpinehvac.ca',     aliases:['steve','steven','steve coles'] },
  { id:'nick-drost',       name:'Nick Drost',       title:'T&M / Projects Foreman',       team:'Field',      email:'nick.drost@alpinehvac.ca',       aliases:['nick'] },
  { id:'tyson-marcoux',    name:'Tyson Marcoux',    title:'Projects Technician',          team:'Field',      email:'tyson.marcoux@alpinehvac.ca',    aliases:['tyson'] },
  { id:'matt-martin',      name:'Matt Martin',      title:'Service Technician',           team:'Field',      email:'matt.martin@alpinehvac.ca',      aliases:['matt','matthew martin'] },
  { id:'brandon-launder',  name:'Brandon Launder',  title:'BAS Apprentice / Technician',  team:'BAS',        email:'brandon.launder@alpinehvac.ca',  aliases:['brandon'] },
  { id:'hardiksinh-raol',  name:'Hardiksinh Raol',  title:'BAS Programmer',               team:'BAS',        email:'',                               aliases:['raol','hardik','hardiksinh'] }
];
const TF_CHECKLIST = [
  ['agreement','Employment agreement'],
  ['kra','Key Result Areas (KRA)'],
  ['hs','Health & Safety policy signed'],
  ['wvh','Workplace Violence & Harassment policy signed'],
  ['licence',"Driver's licence / abstract"],
  ['resume','Resume on file']
];

let tfCurrentId = null;
let tfEditing = false;

function tfJSON(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; }
  catch (e) { return fallback; }
}
function tfEsc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function tfInitials(name) { return String(name||'?').split(/\s+/).map(w => w[0]||'').join('').toUpperCase().slice(0,2); }
function tfSpUrl(path) { return TF_SP_BASE + String(path).split('/').map(encodeURIComponent).join('/'); }
function tfFmtDate(iso, opts) {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso);
  return isNaN(d) ? '' : d.toLocaleDateString('en-CA', opts || { month:'short', day:'numeric', year:'numeric' });
}

// Roster merged with portal edits + latest SharePoint sync
function tfMembers() {
  const profiles = tfJSON(TF_PROFILES_KEY, {});
  const sync = tfJSON(TF_SYNC_KEY, null);
  const spById = {};
  if (sync && Array.isArray(sync.members)) sync.members.forEach(m => { spById[m.id] = m; });
  return TF_ROSTER.map(r => Object.assign({}, r, profiles[r.id] || {}, { sp: spById[r.id] || null }));
}
function tfMemberById(id) { return tfMembers().find(m => m.id === id) || null; }

// Match a review's free-text name to a roster member (handles "Brandon", "Steve", etc.)
function tfMatchMember(name) {
  const n = String(name || '').trim().toLowerCase();
  if (!n) return null;
  const ms = tfMembers();
  return ms.find(m => m.name.toLowerCase() === n)
      || ms.find(m => (m.aliases || []).includes(n))
      || ms.find(m => m.name.toLowerCase().split(' ')[0] === n.split(' ')[0] && n.split(' ').length === 1)
      || null;
}
function tfReviewsFor(id) {
  return loadReviews().filter(r => r.memberId ? r.memberId === id : (tfMatchMember(r.tech) || {}).id === id)
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
}

function tfBanner() {
  const el = document.getElementById('tf-banner');
  if (!el) return;
  const failed = (window.AP_SYNC_FAILED || []).includes('team_files_data');
  el.classList.toggle('show', failed);
  if (failed) el.innerHTML = '<b>Team Files cloud storage is not reachable.</b> Changes here are only saved in this browser. Publish the updated Firestore rules (team_files_data, owners only) in the Firebase console, then reload.';
}

function tfPopulateDatalist() {
  const dl = document.getElementById('tf-member-list');
  if (dl) dl.innerHTML = tfMembers().map(m => `<option value="${tfEsc(m.name)}">`).join('');
}

// ── Directory ──
function tfRenderDirectory() {
  tfBanner();
  tfPopulateDatalist();
  const sync = tfJSON(TF_SYNC_KEY, null);
  const meta = document.getElementById('tf-sync-meta');
  if (meta) meta.innerHTML = sync && sync.syncedAt
    ? `SharePoint synced <b>${tfEsc(tfFmtDate(sync.syncedAt))}</b><br>Next automatic sync in ~2 weeks`
    : 'Not synced yet. Click Sync Data to load SharePoint info';
  const grid = document.getElementById('tf-grid');
  if (!grid) return;
  const order = ['Leadership','Office','Sales','Field','BAS'];
  const ms = tfMembers().sort((a, b) => order.indexOf(a.team) - order.indexOf(b.team) || a.name.localeCompare(b.name));
  grid.innerHTML = ms.map(m => {
    const revs = tfReviewsFor(m.id);
    const last = revs[0];
    let hr = '<span class="tf-pill muted">No sync</span>';
    if (m.owner) hr = '<span class="tf-pill muted">Owner</span>';
    else if (m.sp && m.sp.checklist) {
      const done = TF_CHECKLIST.filter(([k]) => m.sp.checklist[k]).length;
      hr = `<span class="tf-pill ${done === TF_CHECKLIST.length ? '' : 'warn'}">HR ${done}/${TF_CHECKLIST.length}</span>`;
    }
    return `<div class="tf-card" onclick="tfOpenProfile('${m.id}')">
      <div class="tf-card-top"><div class="tf-avatar">${tfInitials(m.name)}</div>
        <div><div class="tf-name">${tfEsc(m.name)}</div><div class="tf-title">${tfEsc(m.title || '')}</div></div></div>
      <div class="tf-card-stats">
        <div><b>${tfEsc(m.team || '—')}</b>Team</div>
        <div><b>${last ? tfEsc(last.quarter || tfFmtDate(last.date)) : '—'}</b>Last review</div>
        <div style="text-align:right">${hr}</div>
      </div></div>`;
  }).join('');
  const um = document.getElementById('tf-unmatched');
  if (um) {
    const list = sync && Array.isArray(sync.notOnRoster) ? sync.notOnRoster : [];
    um.innerHTML = list.length ? `<div class="tf-section-label">SharePoint folders not on the roster (${list.length})</div>
      <div class="tf-log">${list.map(f => `<a href="${tfSpUrl('Employees/' + f)}" target="_blank" rel="noopener" style="color:rgba(255,255,255,0.55)">${tfEsc(f)}</a>`).join(' · ')}<br>
      Former staff and admin folders are skipped. Ask Claude to add anyone new to the Team Files roster.</div>` : '';
  }
}

// ── Profile ──
function tfOpenProfile(id) {
  const m = tfMemberById(id);
  if (!m) return;
  tfCurrentId = id; tfEditing = false;
  document.getElementById('tf-directory').style.display = 'none';
  document.getElementById('tf-profile').style.display = '';
  tfRenderProfile();
  window.scrollTo(0, 0);
}
function tfBackToDirectory() {
  tfCurrentId = null;
  document.getElementById('tf-profile').style.display = 'none';
  document.getElementById('tf-directory').style.display = '';
  tfRenderDirectory();
}
function tfRenderProfile() {
  const m = tfMemberById(tfCurrentId);
  if (!m) return;
  tfBanner();
  document.getElementById('tf-p-avatar').textContent = tfInitials(m.name);
  document.getElementById('tf-p-name').textContent = m.name;
  document.getElementById('tf-p-sub').textContent = [m.title, m.team].filter(Boolean).join(' · ');
  const folder = document.getElementById('tf-p-folder');
  if (m.sp && m.sp.folderPath) { folder.href = tfSpUrl(m.sp.folderPath); folder.style.display = ''; }
  else folder.style.display = 'none';

  // Details (view / edit)
  const fields = [['title','Title'],['team','Team'],['email','Email'],['phone','Phone'],['startDate','Start date'],['notes','Notes']];
  document.getElementById('tf-p-edit-btn').textContent = tfEditing ? 'Save' : 'Edit';
  document.getElementById('tf-p-details').innerHTML = fields.map(([k, label]) => {
    const v = m[k] || '';
    if (tfEditing) {
      const input = k === 'notes'
        ? `<textarea id="tf-e-${k}" rows="3">${tfEsc(v)}</textarea>`
        : `<input id="tf-e-${k}" type="${k === 'startDate' ? 'date' : k === 'email' ? 'email' : 'text'}" value="${tfEsc(v)}">`;
      return `<dt>${label}</dt><dd>${input}</dd>`;
    }
    const shown = k === 'email' && v ? `<a href="mailto:${tfEsc(v)}" style="color:var(--teal-light)">${tfEsc(v)}</a>`
      : k === 'startDate' ? tfEsc(tfFmtDate(v, { year:'numeric', month:'long', day:'numeric' }))
      : tfEsc(v);
    return `<dt>${label}</dt><dd>${shown || '<span style="color:rgba(255,255,255,0.25)">—</span>'}</dd>`;
  }).join('');

  // HR checklist
  const ck = document.getElementById('tf-p-check');
  if (m.owner) ck.innerHTML = '<li class="tf-empty">Owner. Employee HR checklist does not apply.</li>';
  else if (!m.sp) ck.innerHTML = '<li class="tf-empty">No SharePoint data yet. Run a sync.</li>';
  else ck.innerHTML = TF_CHECKLIST.map(([k, label]) => {
    const ok = m.sp.checklist && m.sp.checklist[k];
    return `<li><span class="${ok ? 'ok' : 'no'}">${ok ? '✓' : '!'}</span>${label}${ok ? '' : ' <span style="color:#d8b25a;font-size:.72rem">— not found in folder</span>'}</li>`;
  }).join('');

  // Key documents
  const docs = (m.sp && m.sp.keyDocs) || [];
  document.getElementById('tf-p-count').textContent = m.sp ? (m.sp.fileCount || 0) + ' files in folder' : '';
  document.getElementById('tf-p-docs').innerHTML = docs.length
    ? docs.map(d => `<li><a href="${tfSpUrl(m.sp.folderPath + '/' + d.name)}" target="_blank" rel="noopener"><span>${tfEsc(d.name)}</span><span class="tf-doc-type">${tfEsc(d.type)}</span></a></li>`).join('')
      + '<li class="tf-empty" style="font-size:.72rem">Payroll, tax, banking and expense files stay in SharePoint and are not listed here.</li>'
    : '<li class="tf-empty">No key documents found.</li>';

  // Reviews
  const revs = tfReviewsFor(m.id);
  const stars = r => { const v = Object.values(r.ratings || {}).filter(Boolean); return v.length ? '★ ' + (v.reduce((a, b) => a + b, 0) / v.length).toFixed(1) : ''; };
  document.getElementById('tf-p-reviews').innerHTML = revs.length
    ? revs.map(r => `<div class="tf-rv-row" onclick="viewReview(${r.id})">
        <div><div class="tf-rv-q">${tfEsc(r.quarter || 'Review')}</div><div class="tf-rv-meta">${tfEsc(tfFmtDate(r.date))}${r.level ? ' · ' + tfEsc(r.level) : ''}</div></div>
        <div style="display:flex;align-items:center;gap:.75rem"><span class="tf-rv-stars">${stars(r)}</span>
        <button class="rv-card-btn" onclick="editReview(${r.id}, event)">Edit</button></div></div>`).join('')
    : '<div class="tf-empty">No reviews yet. Use + New Review to start one.</div>';
  const log = tfJSON(TF_QNLOG_KEY, []).filter(e => (e.recipients || []).includes(m.id));
  document.getElementById('tf-p-qnlog').innerHTML = log.length
    ? 'Questionnaires sent: ' + log.slice(0, 4).map(e => `${tfEsc(e.quarter)} (${tfEsc(tfFmtDate(e.sentAt))})`).join(' · ')
    : '';
}
function tfToggleEdit() {
  if (tfEditing) {
    const profiles = tfJSON(TF_PROFILES_KEY, {});
    const p = profiles[tfCurrentId] || {};
    ['title','team','email','phone','startDate','notes'].forEach(k => {
      const el = document.getElementById('tf-e-' + k);
      if (el) p[k] = el.value.trim();
    });
    profiles[tfCurrentId] = p;
    localStorage.setItem(TF_PROFILES_KEY, JSON.stringify(profiles));
  }
  tfEditing = !tfEditing;
  tfRenderProfile();
}
function tfNewReviewFor(id) {
  const m = tfMemberById(id);
  openNewReview();
  if (m) {
    document.getElementById('rv-tech').value = m.name;
    document.getElementById('rv-modal-title').textContent = 'New Quarterly Review — ' + m.name;
  }
}
function tfAfterReviewChange() {
  if (tfCurrentId && document.getElementById('tf-profile').style.display !== 'none') tfRenderProfile();
}

// ── Sync data (pasted by Claude's scheduled run, or by hand) ──
function tfOpenSync() {
  document.getElementById('tf-sync-input').value = '';
  document.getElementById('tf-sync-status').className = 'tf-status';
  document.getElementById('tf-sync-modal').classList.add('open');
}
function tfCloseSync() { document.getElementById('tf-sync-modal').classList.remove('open'); }
function tfSaveSync() {
  const st = document.getElementById('tf-sync-status');
  let data;
  try { data = JSON.parse(document.getElementById('tf-sync-input').value); }
  catch (e) { st.className = 'tf-status err'; st.textContent = 'That is not valid JSON. Paste the whole sync file.'; return; }
  if (!data || data.type !== 'alpine-team-files-sync' || !Array.isArray(data.members) || !data.syncedAt) {
    st.className = 'tf-status err'; st.textContent = 'This does not look like a Team Files sync file (missing type, syncedAt or members).'; return;
  }
  const known = new Set(TF_ROSTER.map(r => r.id));
  const unknown = data.members.filter(m => !known.has(m.id)).map(m => m.id);
  localStorage.setItem(TF_SYNC_KEY, JSON.stringify(data));
  st.className = 'tf-status ok';
  st.textContent = `Saved. ${data.members.length} profiles synced as of ${tfFmtDate(data.syncedAt)}.` + (unknown.length ? ` Ignored (not on roster): ${unknown.join(', ')}.` : '');
  tfRenderDirectory();
  if (tfCurrentId) tfRenderProfile();
}

// ══════════════════════════════════════════════════════════════════
// ── SEND QUESTIONNAIRE: one-page PDF per person → Power Automate ──
// ══════════════════════════════════════════════════════════════════
const QN_VALUES = ['Character','Courage','Curiosity','Competence','Caring'];
let qnOnly = null; // set when opened from one profile

function qnQuarterOptions() {
  const now = new Date();
  const q = Math.floor(now.getMonth() / 3) + 1;
  // Reviews early in a quarter cover the quarter that just ended
  let pq = q - 1, py = now.getFullYear();
  if (pq === 0) { pq = 4; py--; }
  const opts = [];
  for (let i = -1; i < 3; i++) {
    let qq = pq + i, yy = py;
    while (qq < 1) { qq += 4; yy--; }
    while (qq > 4) { qq -= 4; yy++; }
    opts.push('Q' + qq + ' ' + yy);
  }
  return { opts, def: 'Q' + pq + ' ' + py };
}
function qnOpen() { qnOnly = null; qnShow(); }
function tfQuestionnaireFor(id) { qnOnly = id; qnShow(); }
function qnShow() {
  const { opts, def } = qnQuarterOptions();
  const sel = document.getElementById('qn-quarter');
  sel.innerHTML = opts.map(o => `<option${o === def ? ' selected' : ''}>${o}</option>`).join('');
  const sender = (typeof apGetSession === 'function' && apGetSession()) ? apGetSession().name.split(' ')[0] : 'Jake';
  document.getElementById('qn-message').value =
    `Hi {first},\n\nOur quarterly review is coming up. Attached is a one-page questionnaire with the questions we'll talk through. Take 10 minutes before we meet to jot down your thoughts (bullet points are fine) and bring it with you.\n\nThis isn't a test. It's so we can spend our time on what matters to you.\n\nThanks,\n${sender}`;
  const ms = tfMembers();
  document.getElementById('qn-recips').innerHTML = ms.map(m => {
    const checked = qnOnly ? m.id === qnOnly : (!m.owner && !!m.email);
    return `<label class="qn-recip${m.email ? '' : ' noemail'}"><input type="checkbox" value="${m.id}" ${checked ? 'checked' : ''} ${m.email ? '' : 'disabled'}>
      <span>${tfEsc(m.name)}<small>${m.email ? tfEsc(m.email) : 'No email: add it on their profile'}</small></span></label>`;
  }).join('');
  qnRenderQs();
  document.getElementById('qn-flow').value = (tfJSON(TF_SETTINGS_KEY, {}) || {}).flowUrl || '';
  document.getElementById('qn-status').className = 'tf-status';
  document.getElementById('qn-send-btn').disabled = false;
  document.getElementById('qn-modal').classList.add('open');
}
function qnRenderQs() {
  const ol = document.getElementById('qn-qs');
  if (ol) ol.innerHTML = loadQuestions().map(q => `<li>${tfEsc(q)}</li>`).join('');
}
function qnClose() { document.getElementById('qn-modal').classList.remove('open'); }
function qnStatus(cls, html) { const s = document.getElementById('qn-status'); s.className = 'tf-status ' + cls; s.innerHTML = html; }
function qnSelected() {
  const ids = Array.from(document.querySelectorAll('#qn-recips input:checked')).map(i => i.value);
  return tfMembers().filter(m => ids.includes(m.id));
}

// Builds the one-page questionnaire PDF; returns a jsPDF document
function qnBuildPdf(member, quarter, when) {
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: 'pt', format: 'letter' });
  const W = 612, H = 792, M = 46;
  const teal = [28, 107, 110], ink = [30, 30, 28], grey = [110, 110, 104], rule = [205, 210, 210];
  // Header band
  pdf.setFillColor(...teal); pdf.rect(0, 0, W, 70, 'F');
  pdf.setTextColor(255, 255, 255);
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(17); pdf.text('ALPINE HVAC', M, 32);
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10.5); pdf.text('Quarterly Review: Pre-Meeting Questionnaire', M, 50);
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11); pdf.text(quarter, W - M, 32, { align: 'right' });
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.text('Confidential', W - M, 50, { align: 'right' });
  // Name / meeting line
  let y = 98;
  pdf.setTextColor(...grey); pdf.setFontSize(8.5); pdf.setFont('helvetica', 'bold');
  pdf.text('NAME', M, y); pdf.text('REVIEW MEETING', W / 2 + 10, y);
  y += 15;
  pdf.setTextColor(...ink); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(12);
  pdf.text(member ? member.name : '', M, y);
  pdf.text(when || '', W / 2 + 10, y);
  pdf.setDrawColor(...rule); pdf.setLineWidth(0.6);
  pdf.line(M, y + 5, W / 2 - 10, y + 5); pdf.line(W / 2 + 10, y + 5, W - M, y + 5);
  // Intro
  y += 26;
  pdf.setFontSize(9.5); pdf.setTextColor(...grey);
  const intro = pdf.splitTextToSize('Take about 10 minutes before we meet to jot down your thoughts. Bullet points are fine. Bring this with you, printed or on your phone. It is a starting point for our conversation, not a test.', W - 2 * M);
  pdf.text(intro, M, y); y += intro.length * 12 + 12;
  // Questions: share the remaining height evenly, leaving room for the values block
  const qs = loadQuestions();
  const valuesBlock = 86, bottom = H - 40 - valuesBlock;
  const per = Math.max(44, (bottom - y) / Math.max(qs.length, 1));
  qs.forEach((q, i) => {
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10); pdf.setTextColor(...teal);
    pdf.text(String(i + 1) + '.', M, y);
    pdf.setTextColor(...ink);
    const lines = pdf.splitTextToSize(q, W - 2 * M - 18);
    pdf.text(lines, M + 18, y);
    const textH = lines.length * 12;
    pdf.setDrawColor(...rule);
    const lineCount = Math.max(1, Math.floor((per - textH - 6) / 17));
    for (let l = 1; l <= lineCount; l++) pdf.line(M + 18, y + textH + l * 17 - 6, W - M, y + textH + l * 17 - 6);
    y += per;
  });
  // Core values self-rating
  y = H - 40 - valuesBlock + 14;
  pdf.setDrawColor(...rule); pdf.line(M, y - 10, W - M, y - 10);
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10); pdf.setTextColor(...ink);
  pdf.text('Rate yourself on our core values (circle 1 to 5)', M, y + 6);
  const colW = (W - 2 * M) / QN_VALUES.length;
  QN_VALUES.forEach((v, i) => {
    const x = M + i * colW;
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8.5); pdf.setTextColor(...teal);
    pdf.text(v.toUpperCase(), x, y + 28);
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10); pdf.setTextColor(...ink);
    pdf.text('1   2   3   4   5', x, y + 46);
  });
  pdf.setFontSize(7.5); pdf.setTextColor(...grey);
  pdf.text('Alpine HVAC Service Inc. · Internal and confidential', W / 2, H - 22, { align: 'center' });
  return pdf;
}
function qnFileName(member, quarter) {
  return ('Alpine Quarterly Review ' + quarter + (member ? ' - ' + member.name : '')).replace(/[^\w\- ]+/g, '') + '.pdf';
}
function qnCheckLib() {
  if (window.jspdf && window.jspdf.jsPDF) return true;
  qnStatus('err', 'The PDF library did not load. Check your internet connection and reload the page.');
  return false;
}
function qnPreview() {
  if (!qnCheckLib()) return;
  const sel = qnSelected();
  const quarter = document.getElementById('qn-quarter').value;
  const pdf = qnBuildPdf(sel[0] || null, quarter, document.getElementById('qn-when').value.trim());
  window.open(pdf.output('bloburl'), '_blank');
}
function qnManual() {
  if (!qnCheckLib()) return;
  const quarter = document.getElementById('qn-quarter').value;
  const sel = qnSelected();
  qnBuildPdf(null, quarter, document.getElementById('qn-when').value.trim()).save(qnFileName(null, quarter));
  const body = document.getElementById('qn-message').value.replace(/\{first\}/g, 'team');
  const bcc = sel.map(m => m.email).filter(Boolean).join(',');
  window.location.href = 'mailto:?bcc=' + encodeURIComponent(bcc) + '&subject=' + encodeURIComponent('Quarterly Review (' + quarter + '): Questionnaire') + '&body=' + encodeURIComponent(body);
  qnStatus('ok', 'PDF downloaded and an email to everyone selected (BCC) is opening. Attach the PDF and send.');
  qnLog(quarter, sel, 'manual');
}
function qnLog(quarter, members, method) {
  const log = tfJSON(TF_QNLOG_KEY, []);
  log.unshift({ sentAt: new Date().toISOString(), quarter, method, recipients: members.map(m => m.id) });
  localStorage.setItem(TF_QNLOG_KEY, JSON.stringify(log.slice(0, 50)));
  qnRenderLog();
  tfAfterReviewChange();
}
function qnRenderLog() {
  const el = document.getElementById('rv-qn-log');
  if (!el) return;
  const log = tfJSON(TF_QNLOG_KEY, []);
  el.innerHTML = log.length
    ? 'Last questionnaire: ' + tfEsc(log[0].quarter) + ', sent ' + tfEsc(tfFmtDate(log[0].sentAt)) + ' to ' + log[0].recipients.length + ' people' + (log[0].method === 'manual' ? ' (manual email)' : '')
    : '';
}
async function qnSend() {
  if (!qnCheckLib()) return;
  const flowUrl = document.getElementById('qn-flow').value.trim();
  const sel = qnSelected();
  const quarter = document.getElementById('qn-quarter').value;
  const when = document.getElementById('qn-when').value.trim();
  if (!sel.length) { qnStatus('err', 'Select at least one person.'); return; }
  if (!/^https:\/\/[^\s]+$/.test(flowUrl)) {
    qnStatus('err', 'Paste your Power Automate flow URL first (see the setup steps). No flow yet? Use <b>Download + Email Manually</b>.');
    return;
  }
  const settings = tfJSON(TF_SETTINGS_KEY, {}) || {};
  if (settings.flowUrl !== flowUrl) { settings.flowUrl = flowUrl; localStorage.setItem(TF_SETTINGS_KEY, JSON.stringify(settings)); }
  if (!confirm(`Email the ${quarter} questionnaire to ${sel.length} ${sel.length === 1 ? 'person' : 'people'}?\n\n${sel.map(m => m.name).join(', ')}`)) return;
  const btn = document.getElementById('qn-send-btn');
  btn.disabled = true; qnStatus('ok', 'Building PDFs and sending…');
  const msg = document.getElementById('qn-message').value;
  const payload = {
    source: 'alpine-portal-team-hub',
    quarter,
    sentBy: (apGetSession() || {}).email || '',
    recipients: sel.map(m => {
      const pdf = qnBuildPdf(m, quarter, when);
      const first = m.name.split(' ')[0];
      return {
        name: m.name,
        email: m.email,
        subject: 'Quarterly Review (' + quarter + '): Questionnaire',
        bodyHtml: tfEsc(msg.replace(/\{first\}/g, first)).replace(/\n/g, '<br>'),
        fileName: qnFileName(m, quarter),
        fileContentBase64: pdf.output('datauristring').split(',')[1]
      };
    })
  };
  try {
    const res = await fetch(flowUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!res.ok) throw new Error('Flow responded ' + res.status);
    qnStatus('ok', `Sent to ${sel.length} ${sel.length === 1 ? 'person' : 'people'}. Check your Outlook Sent Items to confirm.`);
    qnLog(quarter, sel, 'flow');
  } catch (e) {
    qnStatus('err', 'The flow did not accept the request (' + tfEsc(e.message) + '). Check the URL and that the flow is turned on and set to "Anyone" can trigger. Nothing was logged as sent.');
  } finally {
    btn.disabled = false;
  }
}

// ── One-time move of reviews into the owners-only collection ──
async function tfMigrateReviews() {
  if (!thOwnerOk() || typeof window.apCloudMove !== 'function') return;
  if (localStorage.getItem('tf_migrated_v1')) return;
  try {
    for (const k of ['alpine_reviews_v1', 'alpine_review_questions_v1']) {
      await window.apCloudMove('team_hub_data', 'team_files_data', k);
    }
    localStorage.setItem('tf_migrated_v1', new Date().toISOString());
  } catch (e) {
    console.warn('Team Files: review migration will retry next load (original data left in place).', e);
  }
}
// Non-owners: clear any cached copy of reviews from this browser
function tfPurgeForNonOwners() {
  if (thOwnerOk()) return;
  ['alpine_reviews_v1', 'alpine_review_questions_v1', TF_SYNC_KEY, TF_PROFILES_KEY, TF_SETTINGS_KEY, TF_QNLOG_KEY]
    .forEach(k => { try { Storage.prototype.removeItem.call(localStorage, k); } catch (e) {} });
}

tfPurgeForNonOwners();
tfMigrateReviews();
tfPopulateDatalist();
qnRenderLog();

// ── Init role filter + tabs (last, so every tab's code above is ready) ──
(function initRoleFilter() {
  let savedRole = 'owners';
  try { savedRole = localStorage.getItem(ROLE_KEY) || 'owners'; } catch (e) {}
  if (savedRole === 'sales') savedRole = 'owners'; // Sales view removed from Team Hub
  applyRoleFilter(savedRole);
})();

/* ── PRE-INTERVIEW APPLICANTS (Tech / BAS / Sales / Support) ──
   Applicants who come in when a role isn't actively being hired for.
   Records live in localStorage key 'alpine_preint_v1' (synced to team_hub_data).
   Resume files are stored directly in Firestore collection 'team_hub_resumes'
   (one doc per file) so they are NOT pulled into every page load or localStorage. */
const PI_KEY = 'alpine_preint_v1';
const PI_RESUME_COLL = 'team_hub_resumes';
const PI_MAX_BYTES = 700 * 1024;
const PI_ROLES = { tech:'Tech', bas:'BAS', sales:'Sales', support:'Support' };
const PI_STATUS = {
  new:{label:'New',cls:'pi-st-new'}, reviewed:{label:'Reviewed',cls:'pi-st-reviewed'},
  contacted:{label:'Contacted',cls:'pi-st-contacted'}, hold:{label:'On Hold',cls:'pi-st-hold'},
  nofit:{label:'Not a Fit',cls:'pi-st-nofit'}, moved:{label:'Moved to Interviews',cls:'pi-st-moved'}
};
const PI_ARCHIVED = ['nofit','moved'];
let piShowArchived = {};
let piRole = null, piEditingId = null, piDraftComments = [], piRemoveResume = false;

function piLoad() {
  try {
    const v = JSON.parse(localStorage.getItem(PI_KEY));
    const d = (v && typeof v === 'object') ? v : {};
    Object.keys(PI_ROLES).forEach(r => { if (!Array.isArray(d[r])) d[r] = []; });
    return d;
  } catch(e) { const d = {}; Object.keys(PI_ROLES).forEach(r => d[r] = []); return d; }
}
function piSaveAll(d) { localStorage.setItem(PI_KEY, JSON.stringify(d)); }
function piFmtDate(d) { return d ? new Date(d + 'T00:00:00').toLocaleDateString('en-CA',{month:'short',day:'numeric',year:'numeric'}) : ''; }
function piFmtSize(b) { return b > 1024*1024 ? (b/1024/1024).toFixed(1)+' MB' : Math.max(1, Math.round(b/1024))+' KB'; }
function piWho() { try { const s = apGetSession(); return (s && s.name) || 'Unknown'; } catch(e) { return 'Unknown'; } }

// Firestore helpers (same Firebase app/auth as cloud-sync.js via module cache)
async function piFs() {
  const fs = await import('https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js');
  const { db } = await import('./ap-firebase.js');
  return { fs, db };
}
function piReadB64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] || '');
    r.onerror = () => rej(new Error('Could not read file'));
    r.readAsDataURL(file);
  });
}
async function piUploadResume(file) {
  const id = 'res_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  const data = await piReadB64(file);
  const { fs, db } = await piFs();
  await fs.setDoc(fs.doc(db, PI_RESUME_COLL, id), {
    name: file.name, type: file.type || 'application/octet-stream', size: file.size,
    data, uploadedBy: piWho(), uploadedAt: Date.now()
  });
  return { id, name: file.name, type: file.type || 'application/octet-stream', size: file.size };
}
async function piDeleteResume(id) {
  if (!id) return;
  try { const { fs, db } = await piFs(); await fs.deleteDoc(fs.doc(db, PI_RESUME_COLL, id)); }
  catch(e) { console.warn('Pre-interview: resume delete failed', id, e); }
}
async function piOpenResume(id) {
  const w = window.open('', '_blank');
  try {
    const { fs, db } = await piFs();
    const snap = await fs.getDoc(fs.doc(db, PI_RESUME_COLL, id));
    if (!snap.exists()) throw new Error('Resume file not found');
    const r = snap.data();
    const bin = atob(r.data); const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: r.type }));
    const viewable = /pdf|image|text/.test(r.type);
    if (w && viewable) { w.location.href = url; }
    else {
      if (w) w.close();
      const a = document.createElement('a'); a.href = url; a.download = r.name || 'resume';
      document.body.appendChild(a); a.click(); a.remove();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch(e) {
    if (w) w.close();
    alert('Could not open resume: ' + (e.code === 'permission-denied' ? 'access denied by Firestore rules.' : e.message));
  }
}

// ── Render one Pre-Interview block per recruiting tab ──
function piRender(role) {
  const host = document.querySelector('.pi-block[data-pi-role="' + role + '"]');
  if (!host) return;
  const list = piLoad()[role].slice().sort((a, b) => (b.received || '').localeCompare(a.received || '') || b.id - a.id);
  const active = list.filter(a => !PI_ARCHIVED.includes(a.status));
  const archived = list.filter(a => PI_ARCHIVED.includes(a.status));
  const shown = piShowArchived[role] ? list : active;
  const rows = shown.map(a => {
    const st = PI_STATUS[a.status] || PI_STATUS.new;
    const initials = (a.name || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
    const meta = [a.position, a.source, piFmtDate(a.received)].filter(Boolean).map(srEsc).join(' · ');
    const files = (a.resume ? '📄' : '') + (a.resumeLink ? '🔗' : '');
    const nComments = (a.comments || []).length;
    return `<div class="sr-cand-row" onclick="piOpenModal('${role}',${a.id})">
      <div style="width:32px;height:32px;border-radius:50%;background:rgba(155,142,196,0.18);display:flex;align-items:center;justify-content:center;font-family:'Oswald',sans-serif;font-size:.75rem;font-weight:700;color:var(--purple-light);flex-shrink:0">${srEsc(initials)}</div>
      <div style="flex:1;min-width:0"><div class="sr-cand-name">${srEsc(a.name)}${files ? `<span class="pi-row-resume">${files}</span>` : ''}</div><div class="sr-cand-meta">${meta}${nComments ? ' · ' + nComments + ' comment' + (nComments > 1 ? 's' : '') : ''}</div></div>
      <div class="sr-badges"><span class="pi-st ${st.cls}">${st.label}</span></div>
    </div>`;
  }).join('');
  host.innerHTML = `
    <div class="pi-head">
      <div class="pi-title">Pre-Interview</div>
      <button class="sr-add-btn" onclick="piOpenModal('${role}')">+ Add Applicant</button>
    </div>
    <div class="pi-sub">Applicants on file for when a ${PI_ROLES[role]} position opens. Not yet in the interview process.</div>
    ${rows || `<div class="sr-empty">No pre-interview applicants on file.</div>`}
    ${archived.length ? `<button class="pi-toggle" onclick="piToggleArchived('${role}')">${piShowArchived[role] ? 'Hide' : 'Show'} archived (${archived.length}) — Not a Fit / Moved to Interviews</button>` : ''}`;
}
function piRenderAll() { Object.keys(PI_ROLES).forEach(piRender); }
function piToggleArchived(role) { piShowArchived[role] = !piShowArchived[role]; piRender(role); }

// ── Modal ──
function piRenderResumeCurrent(rec) {
  const box = document.getElementById('pi-resume-current');
  const r = rec && rec.resume && !piRemoveResume ? rec.resume : null;
  box.innerHTML = r
    ? `📄 <strong>${srEsc(r.name)}</strong> <span style="color:var(--grey)">${piFmtSize(r.size)}</span>
       <button class="sr-btn-sm" onclick="piOpenResume('${r.id}')">View</button>
       <button class="sr-btn-sm danger" onclick="piMarkRemoveResume()">Remove</button>
       <span style="font-size:.7rem;color:var(--grey);width:100%">Choose a new file below to replace it.</span>`
    : (piRemoveResume ? '<span style="color:#EF9F27">Resume will be removed on save.</span>' : '<span style="color:var(--grey)">No resume attached.</span>');
}
function piMarkRemoveResume() { piRemoveResume = true; piRenderResumeCurrent(null); }
function piRenderComments() {
  document.getElementById('pi-comments').innerHTML = piDraftComments.map(c => `
    <div class="pi-comment"><div class="pi-comment-meta"><span>${srEsc(c.by)} · ${new Date(c.at).toLocaleString('en-CA',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'})}</span>
    <button class="pi-comment-del" title="Delete comment" onclick="piDelComment(${c.id})">✕</button></div>${srEsc(c.text)}</div>`).join('');
}
function piOpenModal(role, id) {
  piRole = role; piEditingId = id || null; piRemoveResume = false;
  const rec = id ? piLoad()[role].find(a => a.id === id) : null;
  if (id && !rec) return;
  const f = (k, v) => { document.getElementById('pif-' + k).value = v || ''; };
  document.getElementById('pi-modal-title').textContent = (rec ? 'Edit' : 'Add') + ' Pre-Interview Applicant — ' + PI_ROLES[role];
  f('name', rec && rec.name); f('position', rec && rec.position); f('email', rec && rec.email);
  f('phone', rec && rec.phone); f('location', rec && rec.location);
  f('received', rec ? rec.received : new Date().toLocaleDateString('en-CA'));
  document.getElementById('pif-source').value = (rec && rec.source) || 'Website';
  document.getElementById('pif-status').value = (rec && rec.status) || 'new';
  f('link', rec && rec.resumeLink); f('notes', rec && rec.notes); f('comment', '');
  document.getElementById('pif-file').value = '';
  piDraftComments = rec ? (rec.comments || []).slice() : [];
  piRenderResumeCurrent(rec); piRenderComments();
  document.getElementById('pi-del-btn').style.display = rec ? '' : 'none';
  document.getElementById('pi-move-btn').style.display = (rec && role !== 'support' && rec.status !== 'moved') ? '' : 'none';
  document.getElementById('pi-modal').classList.add('open');
}
function piCloseModal() { document.getElementById('pi-modal').classList.remove('open'); }

function piAddComment() {
  const el = document.getElementById('pif-comment'); const text = el.value.trim();
  if (!text) return;
  piDraftComments.push({ id: Date.now(), by: piWho(), at: Date.now(), text });
  el.value = ''; piRenderComments(); piPersistComments();
}
function piDelComment(cid) {
  if (!confirm('Delete this comment?')) return;
  piDraftComments = piDraftComments.filter(c => c.id !== cid); piRenderComments(); piPersistComments();
}
// Comments on an existing applicant save immediately; on a new applicant they save with "Save Applicant".
function piPersistComments() {
  if (!piEditingId) return;
  const d = piLoad(); const rec = d[piRole].find(a => a.id === piEditingId);
  if (!rec) return;
  rec.comments = piDraftComments.slice(); piSaveAll(d); piRender(piRole);
}

async function piSave() {
  const name = document.getElementById('pif-name').value.trim();
  if (!name) { alert('Please enter a name.'); return; }
  const file = document.getElementById('pif-file').files[0];
  if (file && file.size > PI_MAX_BYTES) { alert('Resume is ' + piFmtSize(file.size) + ' — max is 700 KB. Compress the PDF or paste a SharePoint link instead.'); return; }
  const box = document.getElementById('pi-modal-box'); const btn = document.getElementById('pi-save-btn');
  box.classList.add('pi-busy'); btn.textContent = 'Saving…';
  try {
    const d = piLoad(); const list = d[piRole];
    const prev = piEditingId ? list.find(a => a.id === piEditingId) : null;
    let resume = prev && prev.resume ? prev.resume : null;
    let oldResumeId = null;
    if (piRemoveResume && resume) { oldResumeId = resume.id; resume = null; }
    if (file) {
      try {
        const up = await piUploadResume(file);
        if (resume) oldResumeId = resume.id;
        resume = up;
      } catch(e) {
        const why = e && e.code === 'permission-denied' ? 'Firestore rules do not allow resume storage yet (team_hub_resumes).' : (e.message || e);
        if (!confirm('Resume upload failed: ' + why + '\n\nSave the applicant without the new resume?')) return;
      }
    }
    const rec = {
      id: piEditingId || Date.now(), name,
      position: document.getElementById('pif-position').value.trim(),
      email: document.getElementById('pif-email').value.trim(),
      phone: document.getElementById('pif-phone').value.trim(),
      location: document.getElementById('pif-location').value.trim(),
      received: document.getElementById('pif-received').value,
      source: document.getElementById('pif-source').value,
      status: document.getElementById('pif-status').value,
      resumeLink: document.getElementById('pif-link').value.trim(),
      notes: document.getElementById('pif-notes').value,
      resume, comments: piDraftComments.slice(),
      created: prev ? prev.created : Date.now(), createdBy: prev ? prev.createdBy : piWho(),
      updated: Date.now(), movedAt: prev ? prev.movedAt || null : null
    };
    const pending = document.getElementById('pif-comment').value.trim();
    if (pending) rec.comments.push({ id: Date.now() + 1, by: piWho(), at: Date.now(), text: pending });
    if (prev) list[list.indexOf(prev)] = rec; else list.unshift(rec);
    piSaveAll(d);
    if (oldResumeId) piDeleteResume(oldResumeId);
    piCloseModal(); piRender(piRole);
  } finally {
    box.classList.remove('pi-busy'); btn.textContent = 'Save Applicant';
  }
}

function piDelete() {
  if (!piEditingId || !confirm('Remove this applicant and their resume? This cannot be undone.')) return;
  const d = piLoad(); const rec = d[piRole].find(a => a.id === piEditingId);
  d[piRole] = d[piRole].filter(a => a.id !== piEditingId); piSaveAll(d);
  if (rec && rec.resume) piDeleteResume(rec.resume.id);
  piCloseModal(); piRender(piRole);
}

// Creates an Interview 1 candidate in that tab's pipeline; applicant is kept (archived) with resume + notes.
function piMoveToInterview() {
  const d = piLoad(); const rec = d[piRole].find(a => a.id === piEditingId);
  if (!rec) return;
  if (!confirm('Move ' + rec.name + ' into the ' + PI_ROLES[piRole] + ' interview pipeline (Interview 1)?\n\nThe pre-interview record, resume and notes stay on file under "archived".')) return;
  const cand = { id: Date.now(), name: rec.name, date: '', stage: 'Interview 1', decision: 'pending', score: '',
    posTraits: [], negTraits: [], evalTraits: [], interviews: [{}, {}, {}], preIntId: rec.id };
  if (piRole === 'tech') { tcCands.unshift(cand); tcSaveCands(tcCands); tcRenderCands(); }
  else if (piRole === 'bas') { bcCands.unshift(cand); bcSaveCands(bcCands); bcRenderCands(); }
  else if (piRole === 'sales') { srCands.unshift(cand); srSaveCands(srCands); srRenderCands(); }
  else return;
  rec.status = 'moved'; rec.movedAt = Date.now(); rec.updated = Date.now();
  rec.comments = (rec.comments || []).concat([{ id: Date.now() + 1, by: piWho(), at: Date.now(), text: 'Moved to Interview 1.' }]);
  piSaveAll(d); piCloseModal(); piRender(piRole);
}

piRenderAll();
