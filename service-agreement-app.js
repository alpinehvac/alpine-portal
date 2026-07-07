
  let lines = [];
  let idCounter = 1;

  const typeInput = document.getElementById('eqType');
  const customInput = document.getElementById('eqTypeCustom');
  const qtyInput = document.getElementById('eqQty');
  const hrsInput = document.getElementById('eqHrs');
  const addBtn = document.getElementById('addBtn');
  const formError = document.getElementById('formError');
  const listEl = document.getElementById('list');

  typeInput.addEventListener('change', () => {
    const selected = typeInput.options[typeInput.selectedIndex];

    if(typeInput.value === '__custom__'){
      customInput.style.display = 'block';
      customInput.value = '';
      customInput.focus();
      hrsInput.value = '';
    } else {
      customInput.style.display = 'none';
      customInput.value = '';
      const presetHours = selected ? selected.getAttribute('data-hours') : null;
      hrsInput.value = presetHours || '';
    }
  });

  function getEquipmentName(){
    if(typeInput.value === '__custom__'){
      return customInput.value.trim();
    }
    return typeInput.value;
  }

  function addLine(){
    const type = getEquipmentName();
    const qty = parseFloat(qtyInput.value);
    const hrs = parseFloat(hrsInput.value);

    if(!type || !(hrs > 0) || !(qty > 0)){
      formError.style.display = 'block';
      return;
    }
    formError.style.display = 'none';

    lines.push({ id: idCounter++, type, qty, hrs });

    typeInput.value = '';
    customInput.value = '';
    customInput.style.display = 'none';
    hrsInput.value = '';
    qtyInput.value = '1';
    typeInput.focus();
    render();
  }

  function removeLine(id){
    lines = lines.filter(l => l.id !== id);
    render();
  }

  function lineTotal(l){
    return l.qty * l.hrs;
  }

  function fmt(n){
    return Number(n.toFixed(2)).toString();
  }

  function render(){
    if(lines.length === 0){
      listEl.innerHTML = '<div class="empty">No line items yet — add equipment above to build the estimate.</div>';
    } else {
      listEl.innerHTML = lines.map(l => `
        <div class="row">
          <div class="row-main">
            <div class="name">${escapeHtml(l.type)}</div>
            <div class="meta rep-only">${l.qty} unit${l.qty == 1 ? '' : 's'} &times; ${fmt(l.hrs)} hrs/yr</div>
            <div class="meta customer-only">${l.qty} unit${l.qty == 1 ? '' : 's'}</div>
          </div>
          <div class="row-total rep-only">
            <div><span class="n">${fmt(lineTotal(l))}</span> <span class="u">hrs/yr</span></div>
          </div>
          <button class="btn-del" title="Remove" onclick="removeLine(${l.id})">&times;</button>
        </div>
      `).join('');
    }

    const total = lines.reduce((sum, l) => sum + lineTotal(l), 0);
    document.getElementById('totalHours').textContent = fmt(total);
    document.getElementById('lineCount').textContent = `${lines.length} line item${lines.length === 1 ? '' : 's'}`;

    const days = total / 8;
    document.getElementById('daysNote').textContent = total > 0
      ? `≈ ${fmt(days)} eight-hour technician days per year`
      : '';

    const bufferOn = document.getElementById('bufferToggle').checked;
    const bufferMult = bufferOn ? 1.05 : 1;

    const tiers = [
      { rate: 150, hoursId: 'tierMinHours', monthlyId: 'tierMinMonthly', annualId: 'tierMinAnnual', bufferNoteId: 'tierMinBufferNote', key: 'min' },
      { rate: 300, hoursId: 'tierCoreHours', monthlyId: 'tierCoreMonthly', annualId: 'tierCoreAnnual', bufferNoteId: 'tierCoreBufferNote', key: 'core' },
      { rate: 900, hoursId: 'tierPremiumHours', monthlyId: 'tierPremiumMonthly', annualId: 'tierPremiumAnnual', bufferNoteId: 'tierPremiumBufferNote', key: 'premium' }
    ];
    tiers.forEach(t => {
      document.getElementById(t.hoursId).textContent = fmt(total);
      const annualRevenue = total * t.rate * bufferMult;
      document.getElementById(t.annualId).textContent = fmtCurrency(annualRevenue);
      document.getElementById(t.monthlyId).textContent = fmtCurrency(annualRevenue / 12);
      document.getElementById(t.bufferNoteId).textContent = bufferOn ? '+ 5% buffer' : '';
      const featEl = document.getElementById('tier' + t.key.charAt(0).toUpperCase() + t.key.slice(1) + 'Features');
      if(featEl) featEl.innerHTML = buildFeatureList(t.key);
    });
  }

  const FEATURES = [
    { label: 'Maintenance Guarantee', min: true, core: true, premium: true },
    { label: 'Site Visits', detail: { min: 'Quarterly+', core: 'Monthly', premium: 'Monthly+' } },
    { label: 'CLEAR Reports', min: true, core: true, premium: true },
    { label: '24/7 On-Call Services', min: true, core: true, premium: true },
    { label: 'Multi-Trade Service Access', min: true, core: true, premium: true },
    { label: 'Monthly Check-In Meetings (if desired)', min: false, core: true, premium: true },
    { label: 'Bulk Discounts', min: false, core: true, premium: true },
    { label: 'Building Automation Monitoring with Automatic Dispatching', min: false, core: true, premium: true },
    { label: 'Building Automation Operation', min: false, core: false, premium: true },
    { label: 'Cost Pricing on Replacements', min: false, core: false, premium: true }
  ];

  function buildFeatureList(tierKey){
    return FEATURES.filter(f => f.detail || f[tierKey]).map(f => {
      if(f.detail){
        return `<li class="feat-yes">Site Visits — <span class="feat-detail">${f.detail[tierKey]}</span></li>`;
      }
      return `<li class="feat-yes">${f.label}</li>`;
    }).join('');
  }

  function fmtCurrency(n){
    return n.toLocaleString('en-CA', { minimumFractionDigits:2, maximumFractionDigits:2 });
  }

  function escapeHtml(str){
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  addBtn.addEventListener('click', addLine);
  [typeInput, customInput, qtyInput, hrsInput].forEach(el => {
    el.addEventListener('keydown', e => { if(e.key === 'Enter') addLine(); });
  });

  // ---- Customer / Rep view toggle ----
  const REP_PIN = '1234'; // ← change this to your preferred PIN

  document.getElementById('btnCustomerView').addEventListener('click', function(){
    if(document.body.classList.contains('customer-mode')) return;
    document.body.classList.add('customer-mode');
    document.getElementById('btnCustomerView').classList.add('active');
    document.getElementById('btnRepView').classList.remove('active');
    document.getElementById('tabEstimator').click();
  });

  document.getElementById('btnRepView').addEventListener('click', function(){
    if(!document.body.classList.contains('customer-mode')) return;
    const modal = document.getElementById('pinModal');
    modal.style.display = 'flex';
    document.getElementById('pinInput').value = '';
    document.getElementById('pinError').style.display = 'none';
    setTimeout(() => document.getElementById('pinInput').focus(), 50);
  });

  document.getElementById('pinCancel').addEventListener('click', function(){
    document.getElementById('pinModal').style.display = 'none';
  });

  document.getElementById('pinConfirm').addEventListener('click', checkPin);

  document.getElementById('pinInput').addEventListener('keydown', function(e){
    if(e.key === 'Enter') checkPin();
    if(e.key === 'Escape') document.getElementById('pinModal').style.display = 'none';
  });

  function checkPin(){
    const entered = document.getElementById('pinInput').value;
    if(entered === REP_PIN){
      document.getElementById('pinModal').style.display = 'none';
      document.body.classList.remove('customer-mode');
      document.getElementById('btnRepView').classList.add('active');
      document.getElementById('btnCustomerView').classList.remove('active');
    } else {
      document.getElementById('pinError').style.display = 'block';
      document.getElementById('pinInput').value = '';
      document.getElementById('pinInput').focus();
    }
  }

  const buildingStructureSelect = document.getElementById('buildingStructure');
  const buildingStructureCustom = document.getElementById('buildingStructureCustom');
  buildingStructureSelect.addEventListener('change', () => {
    if(buildingStructureSelect.value === '__other__'){
      buildingStructureCustom.style.display = 'block';
      buildingStructureCustom.focus();
    } else {
      buildingStructureCustom.style.display = 'none';
      buildingStructureCustom.value = '';
    }
  });

  const buildingTypeSelect = document.getElementById('buildingType');
  const restaurantExclusionPanel = document.getElementById('restaurantExclusionPanel');
  function syncRestaurantExclusion(){
    restaurantExclusionPanel.classList.toggle('restaurant-hide', buildingTypeSelect.value !== 'Restaurant');
  }
  buildingTypeSelect.addEventListener('change', syncRestaurantExclusion);
  syncRestaurantExclusion();

  const paymentEFT = document.getElementById('paymentEFT');
  const paymentVisa = document.getElementById('paymentVisa');
  paymentEFT.addEventListener('change', () => { if(paymentEFT.checked) paymentVisa.checked = false; });
  paymentVisa.addEventListener('change', () => { if(paymentVisa.checked) paymentEFT.checked = false; });

  // ---- Equipment Identification Guide ----
  const ICONS = {
    box:    '<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="6" y="14" width="36" height="24" rx="2" stroke="currentColor" stroke-width="2.2"/><line x1="6" y1="22" x2="42" y2="22" stroke="currentColor" stroke-width="1.6"/><circle cx="14" cy="30" r="2.4" stroke="currentColor" stroke-width="1.6"/><circle cx="24" cy="30" r="2.4" stroke="currentColor" stroke-width="1.6"/><circle cx="34" cy="30" r="2.4" stroke="currentColor" stroke-width="1.6"/></svg>',
    fan:    '<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="24" cy="24" r="16" stroke="currentColor" stroke-width="2.2"/><path d="M24 24 C24 14, 32 12, 32 18 C32 24, 24 24, 24 24" fill="currentColor" fill-opacity="0.18" stroke="currentColor" stroke-width="1.4"/><path d="M24 24 C34 24, 36 32, 30 32 C24 32, 24 24, 24 24" fill="currentColor" fill-opacity="0.18" stroke="currentColor" stroke-width="1.4"/><path d="M24 24 C14 24, 12 16, 18 16 C24 16, 24 24, 24 24" fill="currentColor" fill-opacity="0.18" stroke="currentColor" stroke-width="1.4"/><circle cx="24" cy="24" r="2.6" fill="currentColor"/></svg>',
    tank:   '<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="14" y="8" width="20" height="32" rx="10" stroke="currentColor" stroke-width="2.2"/><line x1="14" y1="18" x2="34" y2="18" stroke="currentColor" stroke-width="1.4" opacity="0.5"/><line x1="20" y1="40" x2="20" y2="44" stroke="currentColor" stroke-width="1.8"/><line x1="28" y1="40" x2="28" y2="44" stroke="currentColor" stroke-width="1.8"/></svg>',
    coil:   '<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="6" y="12" width="36" height="24" rx="2" stroke="currentColor" stroke-width="2.2"/><path d="M12 18 v12 M18 18 v12 M24 18 v12 M30 18 v12 M36 18 v12" stroke="currentColor" stroke-width="1.6"/><line x1="24" y1="6" x2="24" y2="12" stroke="currentColor" stroke-width="1.8"/></svg>',
    tower:  '<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M10 40 L14 16 H34 L38 40 Z" stroke="currentColor" stroke-width="2.2" fill="currentColor" fill-opacity="0.06"/><line x1="14" y1="24" x2="34" y2="24" stroke="currentColor" stroke-width="1.4"/><line x1="14" y1="32" x2="34" y2="32" stroke="currentColor" stroke-width="1.4"/><circle cx="24" cy="12" r="4.5" stroke="currentColor" stroke-width="1.8"/><line x1="24" y1="16" x2="24" y2="12" stroke="currentColor" stroke-width="1.6"/></svg>',
    pump:   '<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="20" cy="24" r="10" stroke="currentColor" stroke-width="2.2"/><path d="M28 24 h12" stroke="currentColor" stroke-width="2.2"/><rect x="14" y="14" width="12" height="6" rx="1.5" stroke="currentColor" stroke-width="1.6"/><line x1="8" y1="24" x2="12" y2="24" stroke="currentColor" stroke-width="2.2"/></svg>',
    valve:  '<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><line x1="4" y1="30" x2="44" y2="30" stroke="currentColor" stroke-width="2.2"/><rect x="18" y="22" width="12" height="12" rx="1.5" stroke="currentColor" stroke-width="2"/><line x1="24" y1="22" x2="24" y2="10" stroke="currentColor" stroke-width="1.8"/><rect x="16" y="6" width="16" height="5" rx="1.5" stroke="currentColor" stroke-width="1.6"/></svg>',
    flame:  '<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M24 6 C16 16, 14 22, 18 30 C14 30, 12 24, 12 24 C10 32, 16 42, 24 42 C32 42, 38 32, 36 24 C36 24, 34 30, 30 30 C34 22, 32 16, 24 6 Z" stroke="currentColor" stroke-width="2" fill="currentColor" fill-opacity="0.12"/></svg>',
    droplet:'<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M24 6 C32 18, 38 26, 38 32 C38 40, 31 44, 24 44 C17 44, 10 40, 10 32 C10 26, 16 18, 24 6 Z" stroke="currentColor" stroke-width="2.2" fill="currentColor" fill-opacity="0.1"/></svg>',
    gauge:  '<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="24" cy="26" r="14" stroke="currentColor" stroke-width="2.2"/><line x1="24" y1="26" x2="31" y2="19" stroke="currentColor" stroke-width="2"/><circle cx="24" cy="26" r="1.8" fill="currentColor"/><rect x="18" y="6" width="12" height="6" rx="1.5" stroke="currentColor" stroke-width="1.6"/></svg>',
    erv:    '<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="8" y="8" width="32" height="32" rx="2" stroke="currentColor" stroke-width="2.2"/><line x1="8" y1="8" x2="40" y2="40" stroke="currentColor" stroke-width="1.4" opacity="0.5"/><line x1="40" y1="8" x2="8" y2="40" stroke="currentColor" stroke-width="1.4" opacity="0.5"/><circle cx="24" cy="24" r="5" stroke="currentColor" stroke-width="1.8"/></svg>'
  };
  const EQUIP_GUIDE = {
    'A/C': { icon:'coil', desc:'Outdoor split or packaged condensing unit with a top or side fan; refrigerant lines run to an indoor coil.', photo:'https://media.tranetechnologies.com/is/image/TraneTechnologies/TC-Small-Splits-AC-HP-closed:medium-4-3' },
    'AHU': { icon:'box', desc:'Large sheet-metal cabinet moving air through coils, filters, and a blower — usually in a mechanical room with ductwork on both sides.', photo:'https://media.tranetechnologies.com/is/image/TraneTechnologies/UCCA-AHU-transparent:medium-4-3' },
    'Air Compressor': { icon:'gauge', desc:'Tank-mounted motor and pump storing compressed air; look for a pressure gauge and piping manifold.' },
    'Boiler — Commercial Large': { icon:'flame', desc:'Large floor-standing combustion appliance with burner, heat exchanger, and venting feeding the hot water/steam loop.' },
    'Boiler — Commercial Medium': { icon:'flame', desc:'Mid-size floor or wall-mounted boiler with visible gas piping, venting, and circulator pumps nearby.' },
    'Boiler — Light Commercial/Residential Small': { icon:'flame', desc:'Compact wall-hung condensing boiler, typically with PVC intake/exhaust venting.' },
    'Chiller': { icon:'coil', desc:'Large air-cooled unit with condenser coils/fans, or a water-cooled shell-and-tube vessel, producing chilled water.' },
    'Cooling Tower — Small/Medium': { icon:'tower', desc:'Rooftop structure with louvered sides, a fan stack on top, and a water basin below.' },
    'Cooling Tower — Large': { icon:'tower', desc:'Larger multi-cell version with multiple fan stacks, often induced or forced draft.' },
    'Damper': { icon:'valve', desc:'Metal blade inside ductwork with a visible actuator on the exterior that regulates airflow.' },
    'Dehumidifier': { icon:'droplet', desc:'Standalone or ducted unit with a refrigerant coil and drain line that pulls moisture from the air.' },
    'Electric Heater': { icon:'flame', desc:'Resistance heating element in a duct or cabinet — electrical connections only, no combustion venting.' },
    'ERV — Light Commercial': { icon:'erv', desc:'Compact box with two crossing air streams through an energy-recovery core, with two duct pairs in/out.' },
    'Exhaust Fan': { icon:'fan', desc:'Small roof-mounted "mushroom cap" or inline duct fan pulling air out of a space.' },
    'Fan': { icon:'fan', desc:'General air-moving propeller or utility fan, wall-mounted or inline.' },
    'FCU': { icon:'box', desc:'Small cabinet unit (ceiling, wall, or floor) with a coil and blower, fed by chilled/hot water piping.' },
    'Furnace': { icon:'box', desc:'Gas or electric forced-air unit in a mechanical closet with a blower compartment and venting.' },
    'Glycol Pump': { icon:'pump', desc:'Small circulator pump inline on hydronic piping, moving glycol solution through the loop.' },
    'Heat Pump': { icon:'coil', desc:'Outdoor unit resembling an A/C condenser but reversible, with a reversing valve for heating and cooling.' },
    'Hot Water Tank': { icon:'tank', desc:'Vertical cylindrical tank, gas or electric, storing domestic hot water.' },
    'Humidifier': { icon:'droplet', desc:'Small duct-mounted or standalone unit adding moisture via steam, evaporative pad, or spray.' },
    'Make Up Air Unit (MUA)': { icon:'box', desc:'Larger rooftop or wall unit conditioning 100% outdoor air, often paired with kitchen exhaust.' },
    'Pump — Small/Medium': { icon:'pump', desc:'Inline or base-mounted circulator pump on hydronic piping.' },
    'Pump — Large': { icon:'pump', desc:'Larger base-mounted centrifugal pump with a coupling guard and larger motor.' },
    'Rooftop Unit (RTU) — Small/Medium': { icon:'box', desc:'Packaged rooftop unit combining heating, cooling, and ventilation in one cabinet on a roof curb.', photo:'https://media.tranetechnologies.com/is/image/TraneTechnologies/Nextgen_image_03_Y_model_right_LHV_gas:large-2-1' },
    'Rooftop Unit (RTU) — Large': { icon:'box', desc:'Larger packaged rooftop unit, often multi-zone with multiple compressor/fan sections.' },
    'Tube Heater': { icon:'flame', desc:'Suspended radiant heating tube with a burner at one end — common in warehouses and bays.' },
    'Unit Heater': { icon:'flame', desc:'Wall or ceiling-hung heater with a fan blowing across a coil — common in shops and warehouses.' },
    'Valve': { icon:'valve', desc:'Control valve on piping with an actuator (electric or pneumatic) mounted on top.' },
    'Vestibule Heater': { icon:'flame', desc:'Small heater mounted near an entryway to offset door heat loss.' },
    'Water Filtration': { icon:'droplet', desc:'Cartridge or tank-style filtration system on a water line, with a pressure gauge and bypass valves.' }
  };

  function renderCheatSheet(){
    const grid = document.getElementById('cheatGrid');
    if(grid.dataset.built) return;
    const options = typeInput.querySelectorAll('option[data-hours]');
    let html = '';
    options.forEach(opt => {
      const name = opt.value;
      const hrs = opt.getAttribute('data-hours');
      const meta = EQUIP_GUIDE[name] || { icon:'box', desc:'Contact estimating for identification details on this equipment type.' };
      const iconMarkup = ICONS[meta.icon] || ICONS.box;
      const visual = meta.photo
        ? `<img src="${meta.photo}" alt="${escapeHtml(name)}" loading="lazy" style="width:100%;height:100%;object-fit:contain;border-radius:50%;" onerror="this.parentElement.innerHTML=${JSON.stringify(iconMarkup)};">`
        : iconMarkup;
      html += `
        <div class="cheat-card">
          <div class="icon-wrap">${visual}</div>
          <div class="cheat-name">${escapeHtml(name)}</div>
          <div class="cheat-desc">${escapeHtml(meta.desc)}</div>
          <div class="cheat-hrs">${hrs} hrs / yr baseline</div>
        </div>`;
    });
    grid.innerHTML = html;
    grid.dataset.built = '1';
  }

  const tabEstimator = document.getElementById('tabEstimator');
  const tabCheatSheet = document.getElementById('tabCheatSheet');
  const estimatorPanelEl = document.getElementById('estimatorPanel');
  const cheatSheetViewEl = document.getElementById('cheatSheetView');

  tabEstimator.addEventListener('click', function(){
    tabEstimator.classList.add('active');
    tabCheatSheet.classList.remove('active');
    estimatorPanelEl.querySelector('#estimatorView').style.display = 'block';
    cheatSheetViewEl.style.display = 'none';
  });
  tabCheatSheet.addEventListener('click', function(){
    if(document.body.classList.contains('customer-mode')) return;
    renderCheatSheet();
    tabCheatSheet.classList.add('active');
    tabEstimator.classList.remove('active');
    estimatorPanelEl.querySelector('#estimatorView').style.display = 'none';
    cheatSheetViewEl.style.display = 'block';
  });

  render();

  document.getElementById('bufferToggle').addEventListener('change', render);

  const btnToggleAnnual = document.getElementById('btnToggleAnnual');
  btnToggleAnnual.addEventListener('click', function(){
    const showing = document.body.classList.toggle('show-annual');
    btnToggleAnnual.textContent = showing ? 'Hide Annual Cost' : 'Show Annual Cost';
  });

  // ---- Print buttons ----

  function buildPrintFeatureList(tierKey, color){
    return FEATURES.filter(f => f.detail || f[tierKey]).map(f => {
      if(f.detail){
        return `<li style="font-weight:700;color:${color};">Site Visits — <strong>${f.detail[tierKey]}</strong></li>`;
      }
      return `<li style="font-weight:700;color:${color};">${f.label}</li>`;
    }).join('');
  }

  const DISCLAIMER_HTML = `
    <div style="margin-top:18px;padding:14px 16px;border:1px solid #d9d2e6;border-radius:4px;background:#fbfaFD;">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:#6c5d8d;margin-bottom:6px;">This Quote</div>
      <ul style="margin:0 0 10px;padding-left:14px;font-size:8.7px;color:#555;line-height:1.65;">
        <li><strong>This quote is valid for 20 days from the date issued above.</strong> Pricing presented after this period is not guaranteed and is subject to review and revision.</li>
        <li><strong>Pricing is not fixed until a full maintenance visit has been performed and all equipment and components have been physically verified on site.</strong> Final agreement pricing will be adjusted to reflect the actual equipment count, condition, and scope confirmed during the initial visit.</li>
      </ul>
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:#6c5d8d;margin-bottom:6px;">Service Agreement Terms</div>
      <ul style="margin:0;padding-left:14px;font-size:8.7px;color:#555;line-height:1.65;">
        <li><strong>Scope of Work:</strong> Work is limited to the equipment and systems identified within the facility at the time of agreement. Work outside the defined scope, including upgrades, retrofits, or additional systems, will be quoted separately.</li>
        <li><strong>Service Coverage:</strong> Full Service Coverage includes labour to maintain and repair existing equipment under normal operating conditions. Replacement Coverage applies only to components deemed failed under normal wear and tear. Coverage does not include pre-existing deficiencies, code violations, abuse, neglect, improper use, acts of God, or third-party damage or unauthorized modifications.</li>
        <li><strong>Preventative Maintenance:</strong> Client agrees to allow scheduled maintenance visits at the agreed frequency. Missed or delayed visits due to restricted access or client scheduling may impact performance outcomes and coverage guarantees.</li>
        <li><strong>Emergency &amp; After-Hours Service:</strong> 24/7 on-call service is included; response times are target-based, not guaranteed, and calls outside normal business hours may be prioritized based on severity and system impact.</li>
        <li><strong>Building Automation Systems:</strong> Where BAS monitoring or operation is included, system access, network connectivity, and permissions must be provided by the client. Alpine is not responsible for failures caused by IT/network outages, third-party software issues, or manufacturer limitations.</li>
        <li><strong>Consumables &amp; Materials:</strong> Minimum — all consumables billed separately. Core — discounted markup applied. Premium — covered as outlined. Material availability and pricing are subject to supplier conditions and market fluctuations.</li>
        <li><strong>Client Responsibilities:</strong> Client agrees to provide safe and timely access, maintain appropriate operating conditions, notify Alpine of issues promptly, and ensure utilities are operational. Unsafe conditions may result in suspension of service until corrected.</li>
        <li><strong>Payment Terms:</strong> Invoices are due within 15 days. Late payments may result in suspension of service, removal of coverage benefits, and interest charges of 2% per month.</li>
        <li><strong>Trial Period:</strong> Client will not be charged if unsatisfied after the initial service visit, provided concerns are communicated within 5 business days.</li>
        <li><strong>Term &amp; Cancellation:</strong> This agreement remains in effect until cancelled by either party with written notice. No cancellation penalties apply; services performed up to the cancellation date remain payable.</li>
        <li><strong>Liability Limitation:</strong> Alpine's liability is limited to the value of services provided under this agreement. Alpine is not liable for loss of business or revenue, tenant disruption, or secondary or consequential damages.</li>
        <li><strong>Warranty Disclaimer:</strong> Alpine does not warranty manufacturer equipment unless explicitly stated. Any warranties provided are limited to workmanship for a period of 90 days.</li>
        <li><strong>Force Majeure:</strong> Alpine is not liable for delays or failure to perform due to circumstances beyond reasonable control, including labour shortages, supply chain issues, or extreme weather events.</li>
        <li><strong>Governing Law:</strong> This agreement is governed by the laws of the Province of Ontario.</li>
      </ul>
    </div>`;

  function buildPrintHTML(isCustomer) {
    const facName = document.getElementById('facName').value.trim();
    const facLoc  = document.getElementById('facLoc').value.trim();
    const bType   = document.getElementById('buildingType').value;
    const bStruct = document.getElementById('buildingStructure').value;
    const rep     = document.getElementById('quoteRep').value;
    const specialConsiderations = document.getElementById('specialConsiderations').value.trim();
    const paymentMethod = document.getElementById('paymentEFT').checked ? 'EFT' : (document.getElementById('paymentVisa').checked ? 'Visa' : '');
    const date    = new Date().toLocaleDateString('en-CA', {year:'numeric',month:'long',day:'numeric'});
    const bufferOn = document.getElementById('bufferToggle').checked;
    const bufferMult = bufferOn ? 1.05 : 1;
    const showAnnual = document.body.classList.contains('show-annual');

    const lineRows = lines.length === 0
      ? '<tr><td colspan="3" style="color:#888;font-style:italic;padding:12px 8px;">No equipment added.</td></tr>'
      : lines.map(l => {
          const tot = fmt(l.qty * l.hrs);
          return isCustomer
            ? `<tr><td>${escapeHtml(l.type)}</td><td style="text-align:center">${l.qty}</td><td></td></tr>`
            : `<tr><td>${escapeHtml(l.type)}</td><td style="text-align:center">${l.qty}</td><td style="text-align:right">${tot} hrs/yr</td></tr>`;
        }).join('');

    const total = lines.reduce((s,l) => s + l.qty * l.hrs, 0);

    const tiers = [
      { name:'Minimum', rate:150, color:'#1f7a5c', tagline:'Trouble Free Maintenance. Guaranteed', key:'min' },
      { name:'Core',    rate:300, color:'#b83227', tagline:'Consistent Results at a Predictable Cost', key:'core' },
      { name:'Premium', rate:900, color:'#b8962e', tagline:'All-In Coverage & Peace of Mind', key:'premium' }
    ];

    const tierCards = tiers.map(t => {
      const annualAmt = total * t.rate * bufferMult;
      const monthlyAmt = annualAmt / 12;
      const rateRow    = isCustomer ? '' : `<div style="font-size:10px;color:#666;margin-top:2px;">$${t.rate} / hr</div>`;
      const formulaRow = isCustomer ? '' : `<div style="font-size:10px;color:#666;margin-top:4px;">${fmt(total)} hrs × $${t.rate}${bufferOn ? ' + 5% buffer' : ''}</div>`;
      const annualLine = (!isCustomer || showAnnual)
        ? `<div style="font-size:10.5px;color:#666;margin-top:2px;">$${fmtCurrency(annualAmt)} / yr</div>`
        : '';
      return `
        <div style="border:1px solid #c9b8d4;border-top:4px solid ${t.color};border-radius:4px;padding:14px;display:flex;flex-direction:column;">
          <div style="font-family:sans-serif;font-weight:700;font-size:13px;text-transform:uppercase;letter-spacing:.8px;color:${t.color}">${t.name}</div>
          <div style="font-size:10px;color:#666;font-style:italic;margin-top:3px;margin-bottom:8px;">${t.tagline}</div>
          ${rateRow}
          <div style="font-size:22px;font-weight:700;color:${t.color};margin-top:6px;">$${fmtCurrency(monthlyAmt)}<span style="font-size:10px;font-weight:500;color:#666;"> / mo</span></div>
          ${annualLine}
          ${formulaRow}
          <hr style="border:none;border-top:1px solid #c9b8d4;margin:10px 0;">
          <ul style="margin:0;padding-left:14px;font-size:9.5px;color:#444;line-height:1.6;">
            ${buildPrintFeatureList(t.key, t.color)}
          </ul>
        </div>`;
    }).join('');

    const totalSection = isCustomer ? '' : `
      <div style="background:#e4f0f1;border:1px solid #10444e;border-left:5px solid #10444e;border-radius:4px;padding:16px 20px;display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <div>
          <div style="font-family:sans-serif;font-weight:700;font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#10444e;">Total Annual Man Hours</div>
          <div style="font-size:11px;color:#555;margin-top:3px;">${lines.length} line item${lines.length===1?'':'s'} · ≈ ${fmt(total/8)} eight-hour technician days/yr${bufferOn ? ' · 5% safety buffer applied to pricing' : ''}</div>
        </div>
        <div style="font-size:34px;font-weight:700;color:#10444e;line-height:1;">${fmt(total)}<span style="font-size:13px;font-weight:500;color:#666;margin-left:6px;">hrs / yr</span></div>
      </div>`;

    const metaRows = [
      facName ? `<tr><td style="color:#555;padding-right:16px;">Facility</td><td><strong>${escapeHtml(facName)}</strong></td></tr>` : '',
      facLoc  ? `<tr><td style="color:#555;">Location</td><td>${escapeHtml(facLoc)}</td></tr>` : '',
      bType   ? `<tr><td style="color:#555;">Business Type</td><td>${escapeHtml(bType)}</td></tr>` : '',
      bStruct ? `<tr><td style="color:#555;">Building Type</td><td>${escapeHtml(bStruct)}</td></tr>` : '',
      rep     ? `<tr><td style="color:#555;">Representative</td><td>${escapeHtml(rep)}</td></tr>` : '',
      `<tr><td style="color:#555;">Date</td><td>${date}</td></tr>`
    ].filter(Boolean).join('');

    const specialSection = specialConsiderations ? `
      <div style="margin-bottom:16px;"><div class="section-label">Special Considerations</div>
        <div style="border:1px solid #d9d2e6;border-radius:4px;padding:12px 14px;font-size:11px;color:#333;line-height:1.6;white-space:pre-wrap;">${escapeHtml(specialConsiderations)}</div>
      </div>` : '';

    const restaurantSection = (isCustomer && bType === 'Restaurant') ? `
      <div style="margin-top:16px;padding:14px 16px;border:1px solid #b83227;border-left:5px solid #b83227;border-radius:4px;background:#fdf3f2;">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#b83227;margin-bottom:5px;">Scope Exclusions — Food Service Equipment</div>
        <div style="font-size:10.5px;color:#333;font-weight:600;line-height:1.6;">This agreement does not include refrigeration components (walk-in coolers or freezers, reach-ins, etc.), kitchen exhaust fans or hoods, or fire suppression systems. These items fall outside Alpine HVAC's scope of service and must be maintained under a separate agreement with a qualified provider.</div>
      </div>` : '';

    const paymentSection = isCustomer ? `
      <div style="margin-top:16px;"><div class="section-label">Preferred Payment Method</div>
        <div style="display:flex;gap:28px;font-size:11.5px;color:#333;">
          <div>${paymentMethod === 'EFT' ? '☑' : '☐'} EFT</div>
          <div>${paymentMethod === 'Visa' ? '☑' : '☐'} Visa</div>
        </div>
      </div>` : '';

    const signatureSection = isCustomer ? `
      <div style="margin-top:24px;break-inside:avoid;page-break-inside:avoid;">
        <div class="section-label">Acceptance</div>
        <div style="font-size:10.5px;color:#555;margin-bottom:16px;">By signing below, the client agrees to the terms outlined in this proposal, including the Terms &amp; Disclaimers above.</div>
        <div style="display:flex;gap:40px;margin-bottom:22px;font-size:11.5px;color:#333;">
          <div>Selected Package:&nbsp;&nbsp;☐ Minimum&nbsp;&nbsp;&nbsp;☐ Core&nbsp;&nbsp;&nbsp;☐ Premium</div>
        </div>
        <div style="display:flex;gap:40px;margin-bottom:34px;font-size:11.5px;color:#333;">
          <div>Selected Billing:&nbsp;&nbsp;☐ Monthly&nbsp;&nbsp;&nbsp;☐ Quarterly&nbsp;&nbsp;&nbsp;☐ Annually</div>
        </div>
        <div style="height:64px;"></div>
        <div style="display:flex;gap:24px;align-items:flex-end;margin-bottom:6px;">
          <div style="flex:1;border-bottom:1.4px solid #333;"></div>
          <div style="width:150px;border-bottom:1.4px solid #333;"></div>
        </div>
        <div style="display:flex;gap:24px;font-size:9.5px;color:#666;text-transform:uppercase;letter-spacing:.5px;margin-bottom:30px;">
          <div style="flex:1;">Client Signature</div>
          <div style="width:150px;">Date</div>
        </div>
        <div style="display:flex;gap:24px;align-items:flex-end;margin-bottom:6px;">
          <div style="flex:1;border-bottom:1.4px solid #333;"></div>
        </div>
        <div style="display:flex;gap:24px;font-size:9.5px;color:#666;text-transform:uppercase;letter-spacing:.5px;margin-bottom:30px;">
          <div style="flex:1;">Contract Start Date</div>
        </div>
        <div style="height:64px;"></div>
        <div style="display:flex;gap:24px;align-items:flex-end;margin-bottom:6px;">
          <div style="flex:1;border-bottom:1.4px solid #333;"></div>
          <div style="width:150px;border-bottom:1.4px solid #333;"></div>
        </div>
        <div style="display:flex;gap:24px;font-size:9.5px;color:#666;text-transform:uppercase;letter-spacing:.5px;">
          <div style="flex:1;">Alpine HVAC Representative</div>
          <div style="width:150px;">Date</div>
        </div>
      </div>` : '';

    const docTitle = (facName ? escapeHtml(facName) + ' — ' : '') + 'Alpine HVAC Service Agreement ' + new Date().toISOString().slice(0,10);

    return '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>' + docTitle + '</title>'
      + '<style>'
      + '*{box-sizing:border-box;margin:0;padding:0;}'
      + 'body{font-family:Arial,sans-serif;font-size:12px;color:#1a1a1a;background:#fff;padding:24px 28px 36px;}'
      + 'h1{font-size:18px;text-transform:uppercase;letter-spacing:1px;color:#10444e;font-weight:700;}'
      + 'table{width:100%;border-collapse:collapse;font-size:11.5px;}'
      + 'th{background:#10444e;color:#fff;padding:7px 8px;text-align:left;font-weight:600;}'
      + 'td{padding:6px 8px;border-bottom:1px solid #e0d6ea;}'
      + 'tr:last-child td{border-bottom:none;}'
      + 'tr:nth-child(even) td{background:#faf8fc;}'
      + '.tier-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;}'
      + '.section-label{font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#6c5d8d;border-bottom:1px solid #6c5d8d;padding-bottom:5px;margin-bottom:10px;font-weight:700;}'
      + '@media print{body{padding:10px 14px;}@page{margin:10mm 12mm;size:A4 portrait;}}'
      + '</style></head><body>'
      + '<div style="display:flex;align-items:center;border-bottom:4px solid #10444e;padding-bottom:12px;margin-bottom:16px;">'
      +   '<div><h1>Alpine HVAC Service</h1>'
      +   '<div style="font-size:10px;color:#6c5d8d;letter-spacing:.8px;text-transform:uppercase;margin-top:2px;">Hydronics · Controls · Building Systems</div></div>'
      +   '<div style="margin-left:auto;"><div style="font-size:11px;font-weight:600;color:#10444e;">Service Agreement Estimate</div></div>'
      + '</div>'
      + (metaRows ? '<table style="margin-bottom:16px;width:auto;"><tbody>' + metaRows + '</tbody></table>' : '')
      + '<div style="margin-bottom:16px;"><div class="section-label">Equipment</div>'
      + '<table><thead><tr><th>Equipment Type</th><th style="text-align:center;width:60px;">Qty</th>'
      + (isCustomer ? '' : '<th style="text-align:right;width:110px;">Hours / Yr</th>')
      + '</tr></thead><tbody>' + lineRows + '</tbody></table></div>'
      + totalSection
      + specialSection
      + '<div class="section-label">On-Going Cost Calculator</div>'
      + '<div class="tier-grid">' + tierCards + '</div>'
      + paymentSection
      + restaurantSection
      + (isCustomer ? DISCLAIMER_HTML : '')
      + signatureSection
      + '<div style="margin-top:20px;font-size:9px;color:#999;text-align:center;border-top:1px solid #e0d6ea;padding-top:8px;">Alpine HVAC Service · Hydronics · Controls · Building Systems · Generated ' + date + '</div>'
      + '</body></html>';
  }

  // PRINT — prints current page directly
  document.getElementById('btnPrint').addEventListener('click', function(){
    window.print();
  });

  // PDF — opens a new tab with clean print layout and triggers print dialog
  document.getElementById('btnPrintPDF').addEventListener('click', function(){
    const isCustomer = document.body.classList.contains('customer-mode');
    const html = buildPrintHTML(isCustomer);
    const win = window.open('', '_blank');
    if(!win){ alert('Please allow pop-ups for this page to use the PDF export.'); return; }
    win.document.open();
    win.document.write(html);
    win.document.close();
    // Wait for content + fonts to render, then open print dialog
    win.addEventListener('load', function(){
      setTimeout(function(){ win.focus(); win.print(); }, 400);
    });
  });


// ── Saved Agreements (history with load/delete) ──
const SA_KEY = 'alpine_service_agreements_v1';

function saGetAll(){
  try {
    const raw = localStorage.getItem(SA_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch(e) { return []; }
}

function saSaveAll(arr){
  localStorage.setItem(SA_KEY, JSON.stringify(arr));
}

function saSnapshot(){
  const g = id => document.getElementById(id) ? document.getElementById(id).value : '';
  return {
    id: Date.now(),
    savedAt: new Date().toISOString(),
    facName: g('facName'),
    facLoc: g('facLoc'),
    buildingType: g('buildingType'),
    buildingStructure: g('buildingStructure'),
    buildingStructureCustom: g('buildingStructureCustom'),
    quoteRep: g('quoteRep'),
    specialConsiderations: g('specialConsiderations'),
    lines: JSON.parse(JSON.stringify(lines))
  };
}

function saApplySnapshot(snap){
  const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; return el; };
  setVal('facName', snap.facName);
  setVal('facLoc', snap.facLoc);
  const btEl = setVal('buildingType', snap.buildingType);
  if (btEl) btEl.dispatchEvent(new Event('change'));
  const bsEl = setVal('buildingStructure', snap.buildingStructure);
  if (bsEl) bsEl.dispatchEvent(new Event('change'));
  setVal('buildingStructureCustom', snap.buildingStructureCustom);
  setVal('quoteRep', snap.quoteRep);
  setVal('specialConsiderations', snap.specialConsiderations);
  lines = JSON.parse(JSON.stringify(snap.lines || []));
  idCounter = lines.reduce((m,l) => Math.max(m, l.id || 0), 0) + 1;
  if (typeof syncRestaurantExclusion === 'function') syncRestaurantExclusion();
  render();
}

function saSaveCurrent(){
  const arr = saGetAll();
  const snap = saSnapshot();
  const label = (snap.facName && snap.facName.trim()) ? snap.facName.trim() : ('Agreement ' + new Date(snap.savedAt).toLocaleDateString());
  snap.label = label;
  arr.unshift(snap);
  saSaveAll(arr);
  saRenderList();
  const status = document.getElementById('saStatus');
  if (status) {
    status.style.display = 'block';
    status.style.color = '#2f7a3d';
    status.textContent = '\u2713 Saved "' + label + '"';
    setTimeout(() => { status.style.display = 'none'; }, 2000);
  }
}

function saLoadAgreement(id){
  const arr = saGetAll();
  const snap = arr.find(a => a.id === id);
  if (!snap) return;
  saApplySnapshot(snap);
  saCloseModal();
}

function saDeleteAgreement(id){
  if (!confirm('Delete this saved agreement? This cannot be undone.')) return;
  let arr = saGetAll();
  arr = arr.filter(a => a.id !== id);
  saSaveAll(arr);
  saRenderList();
}

function saRenderList(){
  const list = document.getElementById('saList');
  if (!list) return;
  const arr = saGetAll();
  if (!arr.length) {
    list.innerHTML = '<div style="font-family:\'Inter\',sans-serif; font-size:12px; color:#9aa19b; padding:8px 0;">No saved agreements yet.</div>';
    return;
  }
  list.innerHTML = arr.map(a => {
    const date = new Date(a.savedAt).toLocaleDateString();
    const safeLabel = (a.label || 'Untitled').replace(/</g, '&lt;');
    return '<div style="display:flex; align-items:center; justify-content:space-between; gap:8px; padding:8px 0; border-bottom:1px solid #eee;">'
      + '<div style="min-width:0;">'
      + '<div style="font-family:\'Inter\',sans-serif; font-size:13px; color:#1b2024; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + safeLabel + '</div>'
      + '<div style="font-family:\'IBM Plex Mono\',monospace; font-size:10px; color:#9aa19b;">' + date + '</div>'
      + '</div>'
      + '<div style="display:flex; gap:6px; flex-shrink:0;">'
      + '<button type="button" onclick="saLoadAgreement(' + a.id + ')" style="font-family:\'Oswald\',sans-serif; font-size:11px; letter-spacing:0.5px; text-transform:uppercase; background:none; border:1px solid #1C6B6E; color:#1C6B6E; border-radius:3px; padding:5px 10px; cursor:pointer;">Load</button>'
      + '<button type="button" onclick="saDeleteAgreement(' + a.id + ')" style="font-family:\'Oswald\',sans-serif; font-size:11px; letter-spacing:0.5px; text-transform:uppercase; background:none; border:1px solid #b83227; color:#b83227; border-radius:3px; padding:5px 10px; cursor:pointer;">Delete</button>'
      + '</div>'
      + '</div>';
  }).join('');
}

function saOpenModal(){
  saRenderList();
  document.getElementById('saModal').style.display = 'flex';
}
function saCloseModal(){
  document.getElementById('saModal').style.display = 'none';
}
