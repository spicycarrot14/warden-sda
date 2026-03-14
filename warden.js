// WARDEN — Application Logic
// Globe integration via EarthRenderer (earth.js)

let appState = 'L0'; // L0 | L1 | L2 | CONFIRMED
let selectedVehicle = null;
let selectedCOA = null;
let activeCOAPreview = null; // 'a' | 'b' | 'c' — drives globe COA trajectory overlay
let threatActive = true;
let coaLocked = false;
let toastTimer = null;

// ═══════════════════════════════════
// CLOCK
// ═══════════════════════════════════
function tick(){
  const n=new Date();
  document.getElementById('nav-clock').textContent=
    String(n.getUTCHours()).padStart(2,'0')+':'+
    String(n.getUTCMinutes()).padStart(2,'0')+':'+
    String(n.getUTCSeconds()).padStart(2,'0')+'Z';
}
setInterval(tick,1000); tick();

// ═══════════════════════════════════
// L0 mode — no threat escalation

// L0 mode — threat functions disabled
function clickToast(){}
function clickAlert(){}

// Show monitor pill immediately — Cosmos-2558 is already being monitored
(function initPills(){
  const mp = document.getElementById('mon-pill');
  mp.style.display = 'flex';
  document.getElementById('mon-text').textContent = '1 MONITORED';
})();

function activateThreat(){ /* disabled in L0 */ }

// ═══════════════════════════════════
// LEFT TABS
// ═══════════════════════════════════
function leftTab(btn, id){
  if(btn.classList.contains('disabled')) return;
  ['vehicles','soh','timeline','contacts','threat-intel'].forEach(t=>{
    const el=document.getElementById('lt-'+t);
    if(el) el.style.display='none';
  });
  document.querySelectorAll('.sidebar.left .tab').forEach(t=>t.classList.remove('active'));
  document.getElementById('lt-'+id).style.display='block';
  btn.classList.add('active');
}

// ═══════════════════════════════════
// SIDEBAR COLLAPSE
// ═══════════════════════════════════
let leftOpen=true, rightOpen=true;
function toggleSidebar(side){
  const layout = document.querySelector('.app-layout');
  const btn = document.getElementById('col-'+side);
  if(side==='left'){
    leftOpen = !leftOpen;
    document.querySelector('.sidebar.left').classList.toggle('collapsed', !leftOpen);
    btn.classList.toggle('open', leftOpen);
  } else {
    rightOpen = !rightOpen;
    document.querySelector('.sidebar.right').classList.toggle('collapsed', !rightOpen);
    btn.classList.toggle('open', rightOpen);
  }
  // Set correct grid class
  layout.classList.remove('left-collapsed','right-collapsed','both-collapsed');
  if(!leftOpen && !rightOpen) layout.classList.add('both-collapsed');
  else if(!leftOpen)          layout.classList.add('left-collapsed');
  else if(!rightOpen)         layout.classList.add('right-collapsed');
  // Globe resize after sidebar transition
  setTimeout(()=>{
    if(typeof globe !== 'undefined'){
    }
    resizeCloseUp();
  }, 260);
}

// ═══════════════════════════════════
// RIGHT PANEL TABS
// ═══════════════════════════════════
function rightTab(btn, id){
  document.querySelectorAll('.sidebar.right .tab').forEach(t=>t.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('rt-queue').style.display = id==='queue' ? 'flex' : 'none';
  document.getElementById('rt-coa').style.display   = id==='coa'   ? 'flex' : 'none';
}

// ═══════════════════════════════════
// QUEUE DATA + RENDER
// ═══════════════════════════════════
const VEH_QUEUE = {
  'usa342': [
    { offsetSec:1118,  type:'contact',  typeColor:'#7A8A9A', label:'Ground Contact · Schriever SFB',  detail:'Ka-Band · Est. duration 9m · Nominal pass',          tab:'contacts', accordionId:'gs-schriever' },
    { offsetSec:3310,  type:'maneuver', typeColor:'#4A8FD4', label:'Stationkeeping Burn',              detail:'Δv +0.4 m/s · Scheduled drag makeup',                tab:null },
    { offsetSec:5580,  type:'contact',  typeColor:'#7A8A9A', label:'Ground Contact · KSAT Svalbard',   detail:'Ka-Band · Est. duration 6m',                         tab:'contacts', accordionId:'gs-svalbard' },
    { offsetSec:8820,  type:'sensor',   typeColor:'#5A9A6A', label:'SAR Collection Window',            detail:'Maritime zone · Priority HIGH · 14m window',         tab:null },
  ],
  'usa289': [
    { offsetSec:2590,  type:'contact',  typeColor:'#7A8A9A', label:'Ground Contact · Vandenberg SFB',  detail:'S-Band · Est. duration 8m',                          tab:'contacts', accordionId:'gs-vandenberg' },
    { offsetSec:5100,  type:'sensor',   typeColor:'#5A9A6A', label:'SIGINT Collection Window',         detail:'Eastern Med · Wideband · 22m window',                tab:null },
    { offsetSec:7440,  type:'contact',  typeColor:'#7A8A9A', label:'Ground Contact · KSAT Hawaii',     detail:'X-Band · Est. duration 7m',                          tab:'contacts', accordionId:'gs-hawaii' },
  ],
  'usa301': [
    { offsetSec:1980,  type:'sensor',   typeColor:'#5A9A6A', label:'EO/IR Collection Window',          detail:'Western Pacific · MWIR · Priority MED',              tab:null },
    { offsetSec:3750,  type:'contact',  typeColor:'#7A8A9A', label:'Ground Contact · Schriever SFB',   detail:'Ka-Band · Est. duration 9m',                         tab:'contacts', accordionId:'gs-schriever' },
    { offsetSec:6300,  type:'maneuver', typeColor:'#4A8FD4', label:'Stationkeeping Burn',              detail:'Δv +0.5 m/s · Routine',                              tab:null },
  ],
  'n48821': [
    { offsetSec:720,   type:'anomaly',  typeColor:'#E04444', label:'Projected CPA',                    detail:'Closest Point of Approach with USA-342 · Pc 0.013',  tab:null },
    { offsetSec:4500,  type:'maneuver', typeColor:'#4A8FD4', label:'Predicted Burn Window',            detail:'Based on current trajectory — estimate only',         tab:null },
  ],
  'cosmos2558': [
    { offsetSec:2880,  type:'sensor',   typeColor:'#5A9A6A', label:'Observation Pass',                 detail:'WARDEN photometric coverage',              tab:null },
    { offsetSec:6120,  type:'maneuver', typeColor:'#4A8FD4', label:'Predicted Burn Window',            detail:'DEV 5 — possible stationkeeping event',               tab:null },
  ],
};

let queueTick = 0;

function fmtCountdown(sec){
  const abs = Math.abs(Math.round(sec));
  const h = Math.floor(abs/3600), m = Math.floor((abs%3600)/60), s = abs%60;
  return (h>0?String(h).padStart(2,'0')+':':'') + String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0');
}

function renderQueue(id){
  const empty  = document.getElementById('q-empty');
  const items  = document.getElementById('q-items');
  const nEmpty = document.getElementById('q-next-empty');
  const nCont  = document.getElementById('q-next-content');
  if(!id || !VEH_QUEUE[id]){ empty.style.display='block'; items.style.display='none'; nEmpty.style.display='block'; nCont.style.display='none'; return; }
  empty.style.display='none'; items.style.display='block'; nEmpty.style.display='none'; nCont.style.display='block';
  const evts = VEH_QUEUE[id].slice().sort((a,b)=>a.offsetSec-b.offsetSec);
  const next = evts.find(e=>(e.offsetSec - queueTick) > -600) || evts[0];
  if(next){
    document.getElementById('q-next-label').textContent  = next.label;
    document.getElementById('q-next-detail').textContent = next.detail;
    const rem = next.offsetSec - queueTick;
    const isActive = rem <= 0 && rem > -600;
    const timer = document.getElementById('q-next-timer');
    const actBar = document.getElementById('q-next-active-bar');
    if(isActive){
      timer.style.color = '#2ECC71'; timer.textContent = 'T+' + fmtCountdown(-rem);
      actBar.style.display='block'; document.getElementById('q-next-active-detail').textContent = next.detail;
    } else {
      timer.style.color = '#DDEEFF'; timer.textContent = 'T-' + fmtCountdown(rem);
      actBar.style.display='none';
    }
  }
  const upcoming = evts.filter(e => (e.offsetSec - queueTick) > -600);
  items.innerHTML = upcoming.map(e => {
    const rem = e.offsetSec - queueTick;
    const isActive = rem <= 0 && rem > -600;
    const timerStr = isActive
      ? `<span style="color:#2ECC71">T+${fmtCountdown(-rem)}</span>`
      : `T-${fmtCountdown(rem)}`;
    const viewBtn = e.tab ? `<button class="q-view-btn" onclick="queueView('${e.tab}','${e.accordionId||''}')">View →</button>` : '';
    return `<div class="q-item">
      <div class="q-item-left">
        <div class="q-item-type" style="color:${e.typeColor}">${e.type.toUpperCase()}</div>
        <div class="q-item-label">${e.label}</div>
        <div class="q-item-detail">${e.detail}</div>
        ${viewBtn}
      </div>
      <div class="q-item-timer">${timerStr}</div>
    </div>`;
  }).join('');
}

function queueView(tabName, accordionId){
  if(tabName === 'contacts'){
    const btn = document.getElementById('tab-con');
    if(btn) leftTab(btn, 'contacts');
    if(accordionId){
      setTimeout(()=>{
        const row = document.getElementById(accordionId);
        if(row){
          if(!row.classList.contains('open')){ row.classList.add('open'); const b=row.nextElementSibling; if(b) b.classList.add('open'); }
          row.scrollIntoView({behavior:'smooth', block:'center'});
        }
      }, 80);
    }
  }
}

setInterval(()=>{ queueTick+=1; if(selectedVehicle) renderQueue(selectedVehicle); }, 1000);


function toggleAcc(row){
  // row may be passed directly or we find it from a child
  const body = row.nextElementSibling;
  const isOpen = row.classList.toggle('open');
  if(body) body.classList.toggle('open', isOpen);
}

function jumpToVehicle(rowId, bodyId){
  const row=document.getElementById(rowId);
  const body=document.getElementById(bodyId);
  if(!row||!body) return;
  // Expand if not already open
  if(!row.classList.contains('open')){ row.classList.add('open'); body.classList.add('open'); }
  // Scroll into view
  row.scrollIntoView({behavior:'smooth', block:'center'});
}

// ═══════════════════════════════════
// SIGMA
// ═══════════════════════════════════
function toggleMath(id){
  const mb=document.getElementById('mb-'+id);
  const sb=document.getElementById('sb-'+id);
  if(!mb||!sb) return;
  const o=mb.classList.toggle('open');
  sb.classList.toggle('open',o);
}

// ═══════════════════════════════════
// VEHICLE SELECTION
// ═══════════════════════════════════
const VEH_META = {
  'usa342':    { title:'USA-342',        sub:'LEO 518km · ISR · USSF/NRO' },
  'usa289':    { title:'USA-289',        sub:'LEO 503km · SIGINT · NSA/USSF' },
  'usa301':    { title:'USA-301',        sub:'LEO 534km · EO/IR · NRO/USSF' },
  'n48821':    { title:'NORAD-48821',    sub:'LEO 520km · Inspector · PRC/CNSA' },
  'cosmos2558':{ title:'Cosmos-2558',    sub:'LEO 541km · Inspector · RU/VKS' },
};

// Per-vehicle stat bar data
const VEH_STATS = {
  'usa342':    { range:'47.0 km', closing:'+0.34 km/s', pc:'0.013',  dev:'9',  alerts:'1', rangeAlert:true, closingAlert:true, pcAlert:true, devAlert:true },
  'usa289':    { range:'—',       closing:'—',           pc:'—',      dev:'2',  alerts:'0', rangeAlert:false,closingAlert:false,pcAlert:false,devAlert:false },
  'usa301':    { range:'—',       closing:'—',           pc:'—',      dev:'1',  alerts:'0', rangeAlert:false,closingAlert:false,pcAlert:false,devAlert:false },
  'n48821':    { range:'47.0 km', closing:'+0.34 km/s',  pc:'0.013',  dev:'9',  alerts:'1', rangeAlert:true, closingAlert:true, pcAlert:true, devAlert:true  },
  'cosmos2558':{ range:'812 km',  closing:'+0.02 km/s',  pc:'0.0008', dev:'5',  alerts:'0', rangeAlert:false,closingAlert:false,pcAlert:false,devAlert:false },
};

function updateStatBar(id){
  const s = id ? VEH_STATS[id] : null;
  const set = (elId, val, alert) => {
    const el = document.getElementById(elId);
    if(!el) return;
    el.textContent = val || '—';
    el.style.color = alert ? '#E04444' : '#DDEEFF';
  };
  if(!s){
    ['s-range','s-closing','s-pc','s-dev','s-alerts'].forEach(id=>{ const e=document.getElementById(id); if(e){e.textContent='—';e.style.color='#8A9AAA';} });
  } else {
    set('s-range',   s.range,   s.rangeAlert);
    set('s-closing', s.closing, s.closingAlert);
    set('s-pc',      s.pc,      s.pcAlert);
    set('s-dev',     s.dev,     s.devAlert);
    set('s-alerts',  s.alerts,  s.alerts !== '0');
  }
  // Tracked is always global
  const tracked = document.getElementById('s-tracked');
  if(tracked) tracked.textContent = Object.keys(VEH_DATA).length;
  if(tracked) tracked.style.color = '#DDEEFF';
}

// pip color per event type
const TL_COLOR = { maneuver:'#4A8FD4', contact:'#7A8A9A', sensor:'#5A9A6A', anomaly:'#E04444', coa:'#2ECC71' };

const VEH_TIMELINE = {
  'usa342': [
    
    
    { ts:'2026-03-19 · 03:18:44Z', type:'contact',  label:'Uplink · Schriever',     tx:'Telemetry downlink and command uplink completed', detail:'Duration 8m 42s · Ka-Band · 2.4 Gbps · All subsystems nominal' },
    { ts:'2026-03-19 · 01:44:10Z', type:'sensor',   label:'Sensor Retask',          tx:'EO/IR tasked to cover new collection priority', detail:'Collection window 14m · Region: North Atlantic · Priority: HIGH' },
    { ts:'2026-03-18 · 22:31:55Z', type:'contact',  label:'Uplink · KSAT Svalbard', tx:'Routine contact and ephemeris upload', detail:'Duration 6m 18s · Ka-Band · NAV update applied' },
    { ts:'2026-03-18 · 19:08:30Z', type:'maneuver', label:'Stationkeeping Burn',    tx:'Scheduled drag makeup maneuver executed', detail:'Δv +0.4 m/s · Fuel used: 0.3% · Post-burn orbit nominal' },
    { ts:'2026-03-18 · 14:52:14Z', type:'sensor',   label:'Sensor Retask',          tx:'SAR tasked to cover maritime collection zone', detail:'Collection window 9m · 2 of 8 array elements offline — partial coverage' },
    { ts:'2026-03-18 · 11:20:00Z', type:'contact',  label:'Uplink · Schriever',     tx:'Scheduled contact · ephemeris + crypto uplink', detail:'Duration 9m 04s · KMI refresh applied' },
    { ts:'2026-03-17 · 23:44:38Z', type:'maneuver', label:'Collision Avoidance',    tx:'Minor avoidance maneuver — debris conjunction', detail:'Δv +1.2 m/s · Pc pre-maneuver: 1/4,200 · Post: nominal' },
    { ts:'2026-03-17 · 08:15:00Z', type:'contact',  label:'Uplink · Vandenberg',    tx:'Routine telemetry pass', detail:'Duration 7m 30s · S-Band' },
  ],
  'usa289': [
    { ts:'2026-03-19 · 03:41:02Z', type:'contact',  label:'Uplink · Vandenberg',    tx:'Telemetry pass completed', detail:'Duration 7m 55s · S-Band · Narrowband dropout noted · 3 events / 6hr' },
    { ts:'2026-03-19 · 02:14:20Z', type:'sensor',   label:'SIGINT Retask',          tx:'Wideband collection shifted to new priority region', detail:'Region: Eastern Mediterranean · Window: 22m · Collection nominal' },
    { ts:'2026-03-19 · 00:55:10Z', type:'anomaly',  label:'Receiver Anomaly',       tx:'Narrowband receiver intermittent dropout detected', detail:'3 dropout events in 6hr window · Under monitoring · No action taken' },
    { ts:'2026-03-18 · 21:30:44Z', type:'contact',  label:'Uplink · KSAT Troll',    tx:'Contact and NAV update', detail:'Duration 5m 12s · X-Band · Fuel reserve noted at 61% — below threshold' },
    { ts:'2026-03-18 · 18:08:00Z', type:'maneuver', label:'Stationkeeping Burn',    tx:'Scheduled orbit maintenance burn', detail:'Δv +0.3 m/s · Fuel used: 0.4% · Fuel reserve now 61%' },
    { ts:'2026-03-18 · 15:44:55Z', type:'sensor',   label:'SIGINT Retask',          tx:'Collection priority update — new tasking order received', detail:'Wideband array repositioned · Window 18m' },
    { ts:'2026-03-18 · 12:00:30Z', type:'contact',  label:'Uplink · Vandenberg',    tx:'Scheduled pass · crypto expiry warning logged', detail:'Crypto/KMI expires in 3 days · Action required' },
    { ts:'2026-03-17 · 20:33:15Z', type:'anomaly',  label:'Crypto Warning',         tx:'KMI key expiry flagged by ground system', detail:'Expiry: 2026-03-22 · Renewal pending scheduling' },
    { ts:'2026-03-17 · 14:10:00Z', type:'contact',  label:'Uplink · KSAT Hawaii',   tx:'Contact and telemetry download', detail:'Duration 6m 40s · X-Band · All subsystems nominal except narrowband' },
  ],
  'usa301': [
    { ts:'2026-03-19 · 03:07:18Z', type:'contact',  label:'Uplink · Schriever',     tx:'Routine telemetry and command pass', detail:'Duration 9m 22s · Ka-Band · All subsystems nominal' },
    { ts:'2026-03-19 · 01:15:44Z', type:'sensor',   label:'EO/IR Retask',           tx:'MWIR collection window opened over priority zone', detail:'Region: Western Pacific · Window: 17m · Collection complete' },
    { ts:'2026-03-18 · 22:48:00Z', type:'contact',  label:'Uplink · KSAT Svalbard', tx:'NAV ephemeris upload and downlink', detail:'Duration 7m 10s · Ka-Band · Nominal' },
    { ts:'2026-03-18 · 20:30:00Z', type:'sensor',   label:'LWIR Retask',            tx:'LWIR tasked for thermal imaging pass', detail:'Region: North Africa · Window: 11m · Nominal' },
    { ts:'2026-03-18 · 17:02:33Z', type:'maneuver', label:'Stationkeeping Burn',    tx:'Scheduled drag makeup burn executed', detail:'Δv +0.5 m/s · Fuel used: 0.2% · Fuel reserve 88%' },
    { ts:'2026-03-18 · 13:55:00Z', type:'contact',  label:'Uplink · Vandenberg',    tx:'Scheduled pass', detail:'Duration 8m 04s · S-Band · All nominal' },
    { ts:'2026-03-18 · 10:20:15Z', type:'sensor',   label:'EO Retask',              tx:'High-resolution EO collection over priority target', detail:'Window: 8m · Nominal · Data recorded 28% capacity' },
    { ts:'2026-03-17 · 23:10:00Z', type:'contact',  label:'Uplink · KSAT Grimstad', tx:'Routine contact', detail:'Duration 5m 50s · Ka-Band · Nominal' },
    { ts:'2026-03-17 · 16:44:00Z', type:'maneuver', label:'Orbit Adjust',           tx:'Minor inclination correction burn', detail:'Δv +0.8 m/s · Ground commanded · Post-burn orbit nominal' },
  ],
  'n48821': [
    { ts:'2026-03-19 · 03:41:22Z', type:'anomaly',  label:'Deviation Detected',     tx:'Baseline deviation confirmed — burn sequence initiated', detail:'DEV 9 · Pc 0.013 · Closing on USA-342 at +0.34 km/s' },
    { ts:'2026-03-19 · 03:41:45Z', type:'sensor',   label:'Sensor Retask',          tx:'WARDEN retasked 3 sensors to track object', detail:'Coverage increased to continuous · All sensors nominal' },
    
    { ts:'2026-03-18 · 18:30:00Z', type:'maneuver', label:'Maneuver Detected',      tx:'Minor Δv event observed — assessed as stationkeeping', detail:'Δv ~0.06 m/s · Baseline activity index unchanged at 0.12' },
    { ts:'2026-03-18 · 09:14:22Z', type:'sensor',   label:'Sensor Observation',     tx:'Scheduled photometric observation pass', detail:'Object class confirmed: Inspector · 92-day baseline established' },
    { ts:'2026-03-17 · 22:00:00Z', type:'sensor',   label:'Initial Track',          tx:'Object added to WARDEN monitoring queue', detail:'NORAD ID 48821 · Origin: PRC/CNSA · Inspector class · DEV 2' },
  ],
  'cosmos2558': [
    { ts:'2026-03-19 · 02:44:10Z', type:'anomaly',  label:'DEV Elevated',           tx:'Deviation score elevated to 5 — increased monitoring', detail:'DEV 5 · Pc 0.0008 · Closing velocity nominal · No action taken' },
    { ts:'2026-03-19 · 00:10:55Z', type:'sensor',   label:'Sensor Retask',          tx:'Additional sensor coverage allocated by WARDEN', detail:'Coverage interval reduced to 20min · Baseline confirmed' },
    { ts:'2026-03-18 · 20:30:00Z', type:'maneuver', label:'Maneuver Detected',      tx:'Δv event detected — possible inspection approach', detail:'Δv ~0.14 m/s · DEV score updated 3 → 5 · Monitoring elevated' },
    { ts:'2026-03-18 · 14:05:00Z', type:'sensor',   label:'Sensor Observation',     tx:'Photometric pass · object confirmed active', detail:'Attitude control nominal · No payload emissions detected' },
    { ts:'2026-03-18 · 08:00:00Z', type:'sensor',   label:'Initial Track Update',   tx:'Routine observation — no activity', detail:'DEV 3 · Baseline: 0.09 · Stationkeeping only' },
    { ts:'2026-03-17 · 16:22:00Z', type:'sensor',   label:'Initial Track',          tx:'Cosmos-2558 added to monitoring queue', detail:'VKS Inspector class · LEO 541km · DEV 3 at intake' },
  ],
};

let tlFilter = 'all';

function setTLFilter(btn, type){
  tlFilter = type;
  document.querySelectorAll('.tl-ft').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  renderTimeline(selectedVehicle);
}

function renderTimeline(id){
  const empty = document.getElementById('tl-empty');
  const content = document.getElementById('tl-content');
  const log = document.getElementById('tl-log');
  if(!id || !VEH_TIMELINE[id]){
    empty.style.display='block'; content.style.display='none'; return;
  }
  empty.style.display='none'; content.style.display='block';
  const meta = VEH_META[id];
  document.getElementById('tl-veh-name').textContent = meta ? meta.title : id;
  document.getElementById('tl-veh-sub').textContent  = meta ? meta.sub   : '';
  const events = VEH_TIMELINE[id].filter(e=> tlFilter==='all' || e.type===tlFilter);
  if(!events.length){
    log.innerHTML='<div style="font-size:15px;color:#2A3545;padding:20px 0;text-align:center">No events match this filter</div>';
    return;
  }
  log.innerHTML = events.map((e,i)=>`
    <div class="tl-i">
      <div class="tl-line"></div>
      <div class="tl-pip" style="background:${TL_COLOR[e.type]||'#7A8A9A'}"></div>
      <div class="tl-tag ${e.type}">${e.label}</div>
      <div class="tl-t">${e.ts}</div>
      <div class="tl-tx">${e.tx}</div>
      <div class="tl-detail">${e.detail}</div>
    </div>
  `).join('');
}

function selectVehicle(id){
  selectedVehicle = id;
  selectedGlobeVehicle = id;

  // Highlight selected row — clear all first, then mark active
  document.querySelectorAll('.sidebar.left .acc-row').forEach(r=>r.classList.remove('selected'));
  const vehRows = { 'usa342':'vrow-usa342-header', 'n48821':'vrow-48821-header' };
  // For rows with explicit ids use them; others find by onclick attribute
  document.querySelectorAll('.sidebar.left .acc-row').forEach(r=>{
    const oc = r.getAttribute('onclick')||'';
    if(oc.includes(`'${id}'`)) r.classList.add('selected');
  });

  const meta = VEH_META[id];
  if(meta){
    document.getElementById('left-title').textContent = meta.title;
    document.getElementById('left-sub').textContent   = meta.sub;
  }

  // Always refresh timeline and queue for the newly selected vehicle
  renderTimeline(id);
  renderQueue(id);
  updateStatBar(id);

  // Show deviation content if relevant vehicle selected and threat is active
  if(appState !== 'L0' && (id === 'usa342' || id === 'n48821')){
    document.getElementById('dev-empty').style.display='none';
    document.getElementById('dev-content').style.display='block';
  } else if(id !== 'usa342' && id !== 'n48821'){
    const de = document.getElementById('dev-empty');
    const dc = document.getElementById('dev-content');
    if(de) de.style.display='block';
    if(dc) dc.style.display='none';
  }
}

// ═══════════════════════════════════
// COA VIEW TOGGLE
// ═══════════════════════════════════
function setView(m){
  document.body.className = m==='d' ? 'vd' : '';
  document.getElementById('vb-s')?.classList.toggle('active', m==='s');
  document.getElementById('vb-d')?.classList.toggle('active', m==='d');
}

// ═══════════════════════════════════
// COA TIMERS
// ═══════════════════════════════════
const TI={
  a:{el:null,card:null,s:750, base:'#DDEEFF'},
  b:{el:null,card:null,s:1860,base:'#DDEEFF'},
  c:{el:null,card:null,s:2460,base:'#E04444'},
};
let timerStarted=false;
function fmtT(s){const m=Math.floor(s/60),sec=s%60;return'T-'+String(m).padStart(2,'0')+':'+String(sec).padStart(2,'0');}
let expCnt=0;

function startTimers(){
  if(timerStarted) return; timerStarted=true;
  TI.a.el=document.getElementById('ti-a')||{}; TI.a.card=document.getElementById('ca-a')||{};
  TI.b.el=document.getElementById('ti-b')||{}; TI.b.card=document.getElementById('ca-b')||{};
  TI.c.el=document.getElementById('ti-c')||{}; TI.c.card=document.getElementById('ca-c')||{};
  setInterval(()=>{
    if(coaLocked) return;
    for(const[id,t]of Object.entries(TI)){
      if(t.s<=0||!t.el)continue; t.s--;
      if(t.s<=0){
        t.el.textContent=''; t.card.classList.add('expired');
        if(selectedCOA===id){selectedCOA=null;t.card.classList.remove('sel-a','sel-b','sel-c');const _cb=document.getElementById('confirm-btn'); if(_cb){_cb.disabled=true;_cb.classList.remove('rdy');};document.getElementById('sel-sum')?.classList.remove('vis');}
        expCnt++;
        if(expCnt>=3){document.getElementById('exp-banner')?.classList.add('vis'); const _cb2=document.getElementById('confirm-btn'); if(_cb2) _cb2.disabled=true;}
      }else{
        t.el.style.color=t.s<120?'#E04444':t.base;
        t.el.textContent=fmtT(t.s);
      }
    }
  },1000);
}

function selectCOA(id){
  if(coaLocked) return;
  if(document.getElementById('ca-'+id)?.classList.contains('expired')) return;
  ['a','b','c'].forEach(c=>{document.getElementById('ca-'+c)?.classList.remove('sel-a','sel-b','sel-c');});
  document.getElementById('ca-'+id)?.classList.add('sel-'+id);
  selectedCOA=id;
  const n={a:'COA-A · Evasive Maneuver',b:'COA-B · Hold & Monitor',c:'COA-C · Emergency IMP Burn'};
  const _st=document.getElementById('sel-text'); if(_st) _st.textContent=n[id];
  document.getElementById('sel-sum')?.classList.add('vis');
  const btn=document.getElementById('confirm-btn'); if(btn){btn.disabled=false; btn.classList.add('rdy');}
  // Dialog — orange accent only for HIGH RISK (COA-C)
  const isHigh = (id === 'c');
  const accentColor = isHigh ? '#E04444' : '#DDEEFF';
  const dtop  = document.getElementById('dialog-topbar');
  const dtitle= document.getElementById('dialog-coa-title');
  const dcard = document.getElementById('dialog-card');
  if(dtop)   dtop.style.background   = accentColor;
  if(dtitle) dtitle.style.color       = accentColor;
  if(dcard)  dcard.style.borderLeft   = `3px solid ${accentColor}`;
  if(dtitle) dtitle.textContent        = n[id];
  // Trigger COA globe close-up preview on USA-342
  activeCOAPreview = id;
  if(!zoomTarget) zoomToVehicle('usa342');
  else { selectedGlobeVehicle = 'usa342'; zoomTarget = 'usa342'; }
}

// ═══════════════════════════════════
// CONFIRM FLOW
// ═══════════════════════════════════
document.getElementById('confirm-btn')?.addEventListener('click',()=>{
  if(!selectedCOA||coaLocked) return;
  document.getElementById('dialog-overlay').classList.add('vis');
});

function closeDialog(){
  document.getElementById('dialog-overlay').classList.remove('vis');
}

function executeConfirm(){
  closeDialog();
  coaLocked=true;
  const now=new Date();
  const ts=String(now.getUTCHours()).padStart(2,'0')+':'+String(now.getUTCMinutes()).padStart(2,'0')+':'+String(now.getUTCSeconds()).padStart(2,'0')+'Z';
  const n={a:'COA-A · Evasive Maneuver',b:'COA-B · Hold & Monitor',c:'COA-C · Emergency IMP Burn'};

  // Show confirmed badge
  const _ct=document.getElementById('confirmed-text'); if(_ct) _ct.textContent = `${n[selectedCOA]} · ${ts} · SGT REYES`;
  document.getElementById('confirmed-badge')?.classList.add('vis');

  // Lock all cards
  ['a','b','c'].forEach(c=>{
    const card=document.getElementById('ca-'+c); if(!card) return;
    card.classList.add('readonly');
    if(c!==selectedCOA) card.style.opacity='0.2';
  });

  // Lock footer
  const _nf=document.getElementById('note-field'); if(_nf) _nf.disabled=true;
  const _cb3=document.getElementById('confirm-btn'); if(_cb3){_cb3.disabled=true; _cb3.classList.remove('rdy');}

  // Update badges
  document.getElementById('left-badge').textContent='COA TRANSMITTED';
  document.getElementById('left-badge').style.background='rgba(30,110,60,.15)';
  document.getElementById('left-badge').style.borderColor='rgba(30,110,60,.4)';
  document.getElementById('left-badge').style.color='#2ECC71';
  document.getElementById('right-badge').textContent='COA TRANSMITTED';
  document.getElementById('right-badge').style.background='rgba(30,110,60,.15)';
  document.getElementById('right-badge').style.borderColor='rgba(30,110,60,.4)';
  document.getElementById('right-badge').style.color='#2ECC71';

  // Threat pill → quiet; monitor pill → 3 MONITORED
  const ap = document.getElementById('alert-pill');
  ap.classList.add('none');
  // L0 — alert already shows 0 threats
  document.getElementById('mon-text').textContent = '3 MONITORED';
  document.getElementById('vtag-usa342').innerHTML =
    '<span class="tag tag-mon">MONITOR</span><span class="tag tag-done" style="margin-left:4px">COA TRANSMITTED</span>';
  document.getElementById('vtag-48821').innerHTML =
    '<span class="tag tag-mon">MONITOR</span><span class="tag tag-done" style="margin-left:4px">COA TRANSMITTED</span>';

  // Reset symbol stroke colors back to blue
  document.querySelectorAll('#vdot-usa342 svg circle, #vdot-usa342 svg line').forEach(el=>el.setAttribute('stroke','#00CCCC'));
  document.querySelectorAll('#vdot-usa342 svg circle').forEach(el=>el.setAttribute('fill','rgba(0,204,204,0.08)'));
  document.getElementById('vname-usa342').style.color      = '#DDEEFF';
  document.querySelectorAll('#vdot-48821 svg polygon, #vdot-48821 svg line').forEach(el=>el.setAttribute('stroke','#E04444'));
  document.getElementById('vname-48821').style.color       = '#DDEEFF';
}

function escalateChain(){
  const b=document.querySelector('.eb-btn'); b.textContent='Escalating… logged at '+new Date().toISOString().slice(11,19)+'Z'; b.disabled=true;
}

// ═══════════════════════════════════
// CONTACT COUNTDOWNS
// ═══════════════════════════════════
const cts={'ct-usa342':{s:18*60+22},'ct-usa289':{s:43*60+10},'ct-usa301':{s:64*60+45}};
function fmtC(s){const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=s%60;return'T-'+(h?String(h).padStart(2,'0')+':':'')+String(m).padStart(2,'0')+':'+String(sec).padStart(2,'0');}
setInterval(()=>{for(const[id,c]of Object.entries(cts)){if(c.s>0){c.s--;const el=document.getElementById(id);if(el)el.textContent=fmtC(c.s);}}},1000);

// ═══════════════════════════════════════════════════════
// GLOBE.GL
// ═══════════════════════════════════════════════════════



// ── CLOSE-UP VIEW ──
function drawCloseUp(id, W, H){
  const vd = VEH_DATA[id];
  if(!vd) return;
  ctx.clearRect(0,0,W,H);

  // Background
  ctx.fillStyle='#000'; ctx.fillRect(0,0,W,H);

  // Grid lines for close-up space context
  ctx.strokeStyle='rgba(30,50,80,0.3)'; ctx.lineWidth=0.5;
  const spacing=40;
  for(let x=0;x<W;x+=spacing){ ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke(); }
  for(let y=0;y<H;y+=spacing){ ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke(); }

  const cx=W/2, cy=H/2;

  // Back button hint
  ctx.fillStyle='#7A8A9A'; ctx.font='10px Inter,sans-serif';
  ctx.fillText('← Click to return to globe view', 12, 20);

  // Vehicle label header
  ctx.fillStyle='#DDEEFF'; ctx.font='bold 14px Inter,sans-serif';
  ctx.fillText(vd.label, cx, 40);
  ctx.textAlign='center';
  ctx.fillStyle='#7A8A9A'; ctx.font='10px Inter,sans-serif';

  const typeLabel = {a:'ASSET AT RISK',ours:'USSF VEHICLE',t:'THREAT',m:'MONITORED'}[vd.type]||'TRACKED';
  const typeCol   = typeColor(vd.type);
  ctx.fillStyle=typeCol;
  ctx.fillText(typeLabel, cx, 56);
  ctx.textAlign='left';

  // Central vehicle dot with glow
  const glowColors = { t:['rgba(204,51,51,0.45)','rgba(204,51,51,0)'], a:['rgba(221,238,255,0.35)','rgba(221,238,255,0)'], ours:['rgba(0,204,204,0.35)','rgba(0,204,204,0)'], m:['rgba(74,143,212,0.3)','rgba(74,143,212,0)'], n:['rgba(58,74,90,0.3)','rgba(58,74,90,0)'] };
  const gc = glowColors[vd.type] || glowColors.n;
  const glowGrad=ctx.createRadialGradient(cx,cy,0,cx,cy,50);
  glowGrad.addColorStop(0, gc[0]);
  glowGrad.addColorStop(1, gc[1]);
  ctx.beginPath();ctx.arc(cx,cy,50,0,Math.PI*2);ctx.fillStyle=glowGrad;ctx.fill();
  ctx.beginPath();ctx.arc(cx,cy,5,0,Math.PI*2);ctx.fillStyle=typeCol;ctx.fill();
  // orbit ring
  ctx.beginPath();ctx.arc(cx,cy,18,0,Math.PI*2);ctx.strokeStyle=typeCol+'55';ctx.lineWidth=1;ctx.setLineDash([2,4]);ctx.stroke();ctx.setLineDash([]);

  // ── COA TRAJECTORY PREVIEW ── orbital-arc style matching drawCloseUp aesthetic
  if(activeCOAPreview && id === 'usa342'){

    // Shared arc geometry — same formula as the planned/deviation paths
    // Orbital arc: sweeps left→right across canvas, sinusoidal height = LEO curvature feel
    const arcW = W * 0.74;   // total sweep width
    const arcH = H * 0.30;   // arc height (how much it bows)
    const steps = 60;

    // USA-342 sits at its "current" position — ~38% along a nominal arc
    // We'll anchor at a consistent canvas point and project arcs forward from there
    const nowT   = 0.38;  // "now" is 38% along the full planned arc
    const nowX   = (W - arcW) / 2 + arcW * nowT;
    const nowY   = cy + arcH * Math.sin(Math.PI * nowT) * 0.5;

    // COA definitions — each COA is a *continuation* from nowT to 1.0
    // using a different arc profile. We parameterise as:
    //   arcWMult  — how wide the forward arc is relative to arcW
    //   arcHMult  — how much extra lift/sink (positive = up = away from threat)
    //   col       — path color (all USA-342 = friendly cyan, NORAD paths = hostile red)
    const USA_COL = '#00CCCC'; // friendly MIL-STD cyan — tied to vehicle, not COA
    const coaDefs = {
      a: { col:USA_COL, label:'COA-A · Evasive Maneuver',      risk:'LOW',  arcWMult:0.72, arcHMult: 1.55, noradMiss: true,  missBy:'~18 km' },
      b: { col:USA_COL, label:'COA-B · Hold & Monitor',         risk:'MED',  arcWMult:0.68, arcHMult: 0.45, noradMiss: false, missBy:'~2.1 km' },
      c: { col:USA_COL, label:'COA-C · Emergency IMP Burn',     risk:'HIGH', arcWMult:0.78, arcHMult:-1.20, noradMiss: true,  missBy:'~31 km' },
    };

    // ── NORAD-48821 current approach arc (always) ──
    // NORAD comes in from upper-right on a converging arc
    const nArcW   = W * 0.52;
    const nStartX = W - (W - arcW)/2 + nArcW * 0.12;
    const nStartY = cy - H * 0.28;
    const nEndX   = nowX + W * 0.06;
    const nEndY   = nowY + H * 0.04;
    const nCpX    = (nStartX + nEndX)/2 - W*0.06;
    const nCpY    = (nStartY + nEndY)/2 + H*0.10;

    // Draw NORAD approach
    ctx.globalAlpha = 0.75;
    ctx.beginPath();
    for(let i=0;i<=steps;i++){
      const t=i/steps;
      const bx=(1-t)*(1-t)*nStartX+2*(1-t)*t*nCpX+t*t*nEndX;
      const by=(1-t)*(1-t)*nStartY+2*(1-t)*t*nCpY+t*t*nEndY;
      i===0?ctx.moveTo(bx,by):ctx.lineTo(bx,by);
    }
    ctx.strokeStyle='#E04444'; ctx.lineWidth=1.2; ctx.setLineDash([3,5]); ctx.stroke(); ctx.setLineDash([]);
    ctx.globalAlpha=1;

    // NORAD current position marker at arc start
    const nPulse = 0.5+0.5*Math.sin(animFrame*0.09+1.2);
    const nGlow = ctx.createRadialGradient(nStartX,nStartY,0,nStartX,nStartY,16+nPulse*5);
    nGlow.addColorStop(0,'rgba(204,51,51,0.4)'); nGlow.addColorStop(1,'rgba(204,51,51,0)');
    ctx.beginPath(); ctx.arc(nStartX,nStartY,16+nPulse*5,0,Math.PI*2); ctx.fillStyle=nGlow; ctx.fill();
    // NORAD hostile diamond
    ctx.save(); ctx.translate(nStartX,nStartY); ctx.rotate(Math.PI/4);
    ctx.strokeStyle='#E04444'; ctx.lineWidth=1.5; ctx.fillStyle='rgba(204,51,51,0.12)';
    ctx.beginPath(); ctx.rect(-6,-6,12,12); ctx.fill(); ctx.stroke(); ctx.restore();
    ctx.fillStyle='#E04444'; ctx.font='bold 8px Inter,sans-serif';
    ctx.fillText('NORAD-48821', nStartX - 38, nStartY - 12);
    ctx.fillStyle='rgba(204,51,51,0.6)'; ctx.font='7px Inter,sans-serif';
    ctx.fillText('+0.34 km/s closing', nStartX - 44, nStartY - 3);

    // ── USA-342 planned baseline arc (always, dim) ──
    ctx.globalAlpha = 0.25;
    ctx.beginPath();
    for(let i=0;i<=steps;i++){
      const t = i/steps;
      const px = (W-arcW)/2 + arcW*t;
      const py = cy + arcH*Math.sin(Math.PI*t)*0.5 - 8;
      i===0?ctx.moveTo(px,py):ctx.lineTo(px,py);
    }
    ctx.strokeStyle='rgba(160,180,200,0.5)'; ctx.lineWidth=1.2; ctx.setLineDash([5,5]); ctx.stroke(); ctx.setLineDash([]);
    ctx.globalAlpha=1;
    ctx.fillStyle='rgba(120,140,160,0.4)'; ctx.font='8px Inter,sans-serif';
    ctx.fillText('Baseline planned', (W-arcW)/2, cy + arcH*0.22 - 16);

    // ── Draw each COA forward arc from NOW position ──
    ['c','b','a'].forEach(cid => {  // draw back-to-front so selected is on top
      const d = coaDefs[cid];
      const isSel = cid === activeCOAPreview;
      ctx.globalAlpha = isSel ? 1.0 : 0.18;

      // Forward arc from NOW: parameterised t goes 0 → 1 representing nowT → end
      const fwdW = arcW * d.arcWMult;
      const fwdH = arcH * d.arcHMult;
      const pts = [];
      for(let i=0;i<=steps;i++){
        const t = i/steps;
        // Start from nowX,nowY and sweep forward
        const px = nowX + fwdW * t;
        const py = nowY - fwdH * Math.sin(Math.PI * t * 0.85) * t;
        pts.push({x:px,y:py});
      }

      ctx.beginPath();
      pts.forEach((p,i) => i===0?ctx.moveTo(p.x,p.y):ctx.lineTo(p.x,p.y));
      ctx.strokeStyle = d.col;
      ctx.lineWidth   = isSel ? 2.2 : 0.9;
      ctx.setLineDash(isSel ? [] : [4,5]);
      ctx.stroke(); ctx.setLineDash([]);

      // Arrowhead
      const last=pts[pts.length-1], prev=pts[pts.length-6];
      const ang=Math.atan2(last.y-prev.y,last.x-prev.x);
      ctx.save(); ctx.translate(last.x,last.y); ctx.rotate(ang);
      ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(-9,-4); ctx.lineTo(-9,4); ctx.closePath();
      ctx.fillStyle=d.col; ctx.fill(); ctx.restore();

      if(isSel){
        // Label + risk
        ctx.fillStyle=d.col; ctx.font='bold 9px Inter,sans-serif';
        const lblX = last.x > W*0.7 ? last.x - 110 : last.x + 10;
        ctx.fillText(d.label, lblX, last.y - 4);
        ctx.font='8px Inter,sans-serif'; ctx.fillStyle=d.col+'AA';
        ctx.fillText(d.risk+' RISK', lblX, last.y + 8);
        // Pulsing destination dot
        const pulse=0.5+0.5*Math.sin(animFrame*0.1);
        const dg=ctx.createRadialGradient(last.x,last.y,0,last.x,last.y,12+pulse*5);
        dg.addColorStop(0,d.col+'55'); dg.addColorStop(1,d.col+'00');
        ctx.beginPath(); ctx.arc(last.x,last.y,12+pulse*5,0,Math.PI*2); ctx.fillStyle=dg; ctx.fill();
        ctx.beginPath(); ctx.arc(last.x,last.y,4,0,Math.PI*2); ctx.fillStyle=d.col; ctx.fill();

        // NORAD predicted outcome for selected COA
        // Project NORAD along its approach vector to where it ends up
        const noradPredT = 0.88;
        const noradPredX = (1-noradPredT)*(1-noradPredT)*nStartX+2*(1-noradPredT)*noradPredT*nCpX+noradPredT*noradPredT*nEndX + (d.noradMiss ? W*0.08 : W*0.01);
        const noradPredY = (1-noradPredT)*(1-noradPredT)*nStartY+2*(1-noradPredT)*noradPredT*nCpY+noradPredT*noradPredT*nEndY + (d.noradMiss ? H*0.06 : 0);
        const nPredPulse = 0.5+0.5*Math.sin(animFrame*0.11);
        const nPredGlow  = ctx.createRadialGradient(noradPredX,noradPredY,0,noradPredX,noradPredY,18+nPredPulse*6);
        const nAlpha = d.noradMiss ? 0.2 : 0.5;
        nPredGlow.addColorStop(0,'rgba(204,51,51,'+nAlpha+')'); nPredGlow.addColorStop(1,'rgba(204,51,51,0)');
        ctx.beginPath(); ctx.arc(noradPredX,noradPredY,18+nPredPulse*6,0,Math.PI*2); ctx.fillStyle=nPredGlow; ctx.fill();
        ctx.save(); ctx.translate(noradPredX,noradPredY); ctx.rotate(Math.PI/4);
        ctx.strokeStyle=d.noradMiss?'rgba(204,51,51,0.35)':'#E04444'; ctx.lineWidth=1.5;
        ctx.fillStyle=d.noradMiss?'rgba(204,51,51,0.05)':'rgba(204,51,51,0.18)';
        ctx.beginPath(); ctx.rect(-5,-5,10,10); ctx.fill(); ctx.stroke(); ctx.restore();
        ctx.fillStyle=d.noradMiss?'rgba(204,51,51,0.6)':'#E04444'; ctx.font='7px Inter,sans-serif';
        ctx.fillText('NORAD-48821 (predicted)', noradPredX+10, noradPredY-2);
        if(d.noradMiss){
          ctx.fillStyle='#2ECC71'; ctx.font='bold 8px Inter,sans-serif';
          ctx.fillText('✓ MISS · '+d.missBy, noradPredX+10, noradPredY+10);
        } else {
          ctx.fillStyle='#E04444'; ctx.font='bold 8px Inter,sans-serif';
          ctx.fillText('⚠ CLOSE PASS · '+d.missBy, noradPredX+10, noradPredY+10);
        }
      } else {
        ctx.beginPath(); ctx.arc(last.x,last.y,2.5,0,Math.PI*2); ctx.fillStyle=d.col; ctx.fill();
      }
      ctx.globalAlpha=1;
    });

    // ── USA-342 NOW marker ──
    const nowPulse=0.5+0.5*Math.sin(animFrame*0.07);
    const ng=ctx.createRadialGradient(nowX,nowY,0,nowX,nowY,18+nowPulse*6);
    ng.addColorStop(0,'rgba(0,204,204,0.35)'); ng.addColorStop(1,'rgba(0,204,204,0)');
    ctx.beginPath(); ctx.arc(nowX,nowY,18+nowPulse*6,0,Math.PI*2); ctx.fillStyle=ng; ctx.fill();
    // Friendly circle symbol
    ctx.beginPath(); ctx.arc(nowX,nowY,7,0,Math.PI*2); ctx.strokeStyle='#00CCCC'; ctx.lineWidth=1.5; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(nowX,nowY-7); ctx.lineTo(nowX,nowY+7); ctx.moveTo(nowX-7,nowY); ctx.lineTo(nowX+7,nowY);
    ctx.strokeStyle='#00CCCC'; ctx.lineWidth=1; ctx.stroke();
    ctx.fillStyle='rgba(180,220,220,0.85)'; ctx.font='bold 9px Inter,sans-serif';
    ctx.fillText('USA-342 · NOW', nowX + 12, nowY - 6);
    ctx.fillStyle='rgba(0,204,204,0.5)'; ctx.font='7px Inter,sans-serif';
    ctx.fillText('LEO 518km', nowX + 12, nowY + 5);

    // ── COA legend ──
    const legY=H-52;
    ctx.fillStyle='#3A4A5A'; ctx.font='7px Inter,sans-serif'; ctx.letterSpacing='0.8px';
    ctx.fillText('COURSE OF ACTION', 14, legY);
    ['a','b','c'].forEach((cid,i)=>{
      const d=coaDefs[cid]; const isSel=cid===activeCOAPreview;
      ctx.globalAlpha=isSel?1:0.3;
      ctx.strokeStyle=d.col; ctx.lineWidth=isSel?2:1;
      ctx.setLineDash(isSel?[]:[3,4]);
      ctx.beginPath(); ctx.moveTo(14,legY+11+i*13); ctx.lineTo(30,legY+11+i*13); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle=d.col; ctx.font=isSel?'bold 8px Inter,sans-serif':'8px Inter,sans-serif';
      ctx.fillText(d.label+(isSel?' ← selected':''), 34, legY+14+i*13);
      ctx.globalAlpha=1;
    });

    return;
  }

  // Planned route
  if(vd.planned){
    const totalArcW = W*0.72;
    const arcH = H*0.32;
    const pts=[];
    const steps=vd.planned.steps;
    for(let i=0;i<=steps;i++){
      const t=i/steps;
      const px=cx - totalArcW/2 + totalArcW*t;
      const py=cy + arcH*Math.sin(Math.PI*t)*0.5 - 8; // slight orbital curve
      pts.push({x:px,y:py});
    }
    ctx.beginPath();
    pts.forEach((p,i)=>i===0?ctx.moveTo(p.x,p.y):ctx.lineTo(p.x,p.y));
    ctx.strokeStyle='rgba(160,180,200,0.55)'; ctx.lineWidth=1.5; ctx.setLineDash([6,5]); ctx.stroke(); ctx.setLineDash([]);
    // direction arrow
    const last=pts[pts.length-1], prev=pts[pts.length-4];
    const ang=Math.atan2(last.y-prev.y,last.x-prev.x);
    ctx.save();ctx.translate(last.x,last.y);ctx.rotate(ang);
    ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(-8,-4);ctx.lineTo(-8,4);ctx.closePath();
    ctx.fillStyle='rgba(160,180,200,0.55)';ctx.fill();ctx.restore();
    // Current position on planned path (~42% along)
    const planPosIdx = Math.floor(pts.length * 0.42);
    const planPos = pts[planPosIdx];
    const planPulse = 0.5 + 0.5 * Math.sin(animFrame * 0.08);
    const planGlow = ctx.createRadialGradient(planPos.x, planPos.y, 0, planPos.x, planPos.y, 10 + planPulse*4);
    planGlow.addColorStop(0,'rgba(160,180,200,0.3)'); planGlow.addColorStop(1,'rgba(160,180,200,0)');
    ctx.beginPath(); ctx.arc(planPos.x, planPos.y, 10+planPulse*4, 0, Math.PI*2); ctx.fillStyle=planGlow; ctx.fill();
    ctx.beginPath(); ctx.arc(planPos.x, planPos.y, 3, 0, Math.PI*2); ctx.fillStyle='rgba(180,200,220,0.9)'; ctx.fill();
    ctx.fillStyle='rgba(140,160,180,0.6)'; ctx.font='8px Inter,sans-serif'; ctx.fillText('NOW',planPos.x+6, planPos.y-5);
    // label
    ctx.fillStyle='rgba(140,160,180,0.7)';ctx.font='9px Inter,sans-serif';
    ctx.fillText('Planned Trajectory',cx-totalArcW/2,cy+arcH*0.25-16);
  }

  // Deviation path
  if(vd.deviation){
    const dev=vd.deviation.dev;
    const conf=vd.deviation.conf;
    const devColor = dev>=7 ? '#E04444' : '#DDEEFF';
    const totalArcW=W*0.65;
    const arcH=H*0.3;
    const dpts=[];
    const steps=vd.deviation.steps;
    const driftScale=dev>=7?1.0:0.5;
    for(let i=0;i<=steps;i++){
      const t=i/steps;
      const drift=vd.deviation.driftLat*driftScale*Math.sin(Math.PI*t)*t;
      const driftL=vd.deviation.driftLng*driftScale*Math.sin(Math.PI*t)*t;
      const px=cx - totalArcW/2 + totalArcW*(t+(driftL*0.04));
      const py=cy + arcH*Math.sin(Math.PI*t)*0.5 + drift*8;
      dpts.push({x:px,y:py});
    }
    // deviation band between planned and actual (if both exist)
    if(vd.planned){
      const ppts=[];
      const steps2=vd.planned.steps;
      const totalArcW2=W*0.72;
      const arcH2=H*0.32;
      for(let i=0;i<=steps2;i++){const t=i/steps2;ppts.push({x:cx-totalArcW2/2+totalArcW2*t,y:cy+arcH2*Math.sin(Math.PI*t)*0.5-8});}
      ctx.beginPath();
      ppts.forEach((p,i)=>i===0?ctx.moveTo(p.x,p.y):ctx.lineTo(p.x,p.y));
      [...dpts].reverse().forEach(p=>ctx.lineTo(p.x,p.y));
      ctx.closePath();
      ctx.fillStyle=dev>=7?'rgba(204,51,51,0.07)':'rgba(221,238,255,0.05)';ctx.fill();
    }
    // deviation line
    ctx.beginPath();
    dpts.forEach((p,i)=>i===0?ctx.moveTo(p.x,p.y):ctx.lineTo(p.x,p.y));
    ctx.strokeStyle=devColor; ctx.lineWidth=1.8; ctx.stroke();
    // arrow
    const last=dpts[dpts.length-1], prev=dpts[dpts.length-4];
    const ang=Math.atan2(last.y-prev.y,last.x-prev.x);
    ctx.save();ctx.translate(last.x,last.y);ctx.rotate(ang);
    ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(-8,-4);ctx.lineTo(-8,4);ctx.closePath();
    ctx.fillStyle=devColor;ctx.fill();ctx.restore();
    // Current position on deviation path (~60% along for active threat)
    const devProgress = vd.type==='t' ? 0.60 : 0.42;
    const devPosIdx = Math.floor(dpts.length * devProgress);
    const devPos = dpts[devPosIdx];
    const devPulse = 0.5 + 0.5 * Math.sin(animFrame * 0.08 + 1.2);
    const devGlowR = 10 + devPulse*5;
    const devGlowC = ctx.createRadialGradient(devPos.x, devPos.y, 0, devPos.x, devPos.y, devGlowR);
    devGlowC.addColorStop(0, devColor.replace('#','rgba(').replace(/^rgba\(([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i, (_,r,g,b)=>`rgba(${parseInt(r,16)},${parseInt(g,16)},${parseInt(b,16)}`)+'0.45)');
    const devGlowSolid = vd.deviation.dev>=7 ? 'rgba(204,51,51,0.45)' : 'rgba(221,238,255,0.35)';
    const devGlowFade  = vd.deviation.dev>=7 ? 'rgba(204,51,51,0)'    : 'rgba(221,238,255,0)';
    const devGlow2 = ctx.createRadialGradient(devPos.x, devPos.y, 0, devPos.x, devPos.y, devGlowR);
    devGlow2.addColorStop(0, devGlowSolid); devGlow2.addColorStop(1, devGlowFade);
    ctx.beginPath(); ctx.arc(devPos.x, devPos.y, devGlowR, 0, Math.PI*2); ctx.fillStyle=devGlow2; ctx.fill();
    ctx.beginPath(); ctx.arc(devPos.x, devPos.y, 3.5, 0, Math.PI*2); ctx.fillStyle=devColor; ctx.fill();
    ctx.fillStyle=devColor; ctx.font='bold 8px Inter,sans-serif'; ctx.fillText('NOW', devPos.x+6, devPos.y-5);
    // confidence badge
    const midPt=dpts[Math.floor(dpts.length*0.58)];
    ctx.fillStyle='rgba(4,8,14,0.88)';
    ctx.fillRect(midPt.x+6,midPt.y-22,80,16);
    ctx.strokeStyle=devColor+'66';ctx.lineWidth=0.5;ctx.strokeRect(midPt.x+6,midPt.y-22,80,16);
    ctx.fillStyle=devColor;ctx.font='bold 9px Inter,sans-serif';
    ctx.fillText(`DEV ${dev}  CONF ${conf}%`,midPt.x+10,midPt.y-10);
    // label
    ctx.fillStyle=devColor+'BB';ctx.font='9px Inter,sans-serif';
    const lbx=dpts[4].x, lby=dpts[4].y+14;
    ctx.fillText('Actual / Deviation Path',lbx,lby);
  }

  // Legend bottom
  const legY=H-48;
  ctx.fillStyle='#7A8A9A';ctx.font='8px Inter,sans-serif';
  if(vd.planned){ ctx.strokeStyle='rgba(160,180,200,0.55)';ctx.setLineDash([4,3]);ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(16,legY);ctx.lineTo(32,legY);ctx.stroke();ctx.setLineDash([]);ctx.fillText('Planned',36,legY+3); }
  if(vd.deviation){
    const dc=vd.deviation.dev>=7?'#E04444':'#DDEEFF';
    ctx.strokeStyle=dc;ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(16,legY+14);ctx.lineTo(32,legY+14);ctx.stroke();
    ctx.fillStyle=dc;ctx.fillText('Actual / Deviation',36,legY+17);
  }

  // No data state
  if(!vd.planned && !vd.deviation){
    ctx.fillStyle='#2A3545';ctx.font='11px Inter,sans-serif';ctx.textAlign='center';
    ctx.fillText('No trajectory data available',cx,cy+80);ctx.textAlign='left';
  }
}


// ── SEARCH ──
const SEARCHABLE = Object.entries(VEH_DATA).map(([id,d])=>({id,label:d.label,type:d.type}));
function onSatSearch(val){
  const q=val.trim().toLowerCase();
  const box=document.getElementById('sat-suggestions');
  if(!q){box.style.display='none';return;}
  const hits=SEARCHABLE.filter(s=>s.label.toLowerCase().includes(q));
  if(!hits.length){box.style.display='none';return;}
  box.innerHTML=hits.map(s=>`
    <div onmousedown="selectSatResult('${s.id}')"
      style="padding:6px 10px;font-size:14px;font-weight:600;color:#DDEEFF;cursor:pointer;border-bottom:1px solid #1A2230;display:flex;align-items:center;gap:8px;"
      onmouseover="this.style.background='rgba(221,238,255,0.05)'" onmouseout="this.style.background=''"
    ><span style="width:6px;height:6px;border-radius:50%;background:${typeColor(s.type)};flex-shrink:0;display:inline-block"></span>${s.label}</div>
  `).join('');
  box.style.display='block';
}
function showSuggestions(){ if(document.getElementById('sat-search').value.trim()) document.getElementById('sat-suggestions').style.display='block'; }
function hideSuggestions(){ setTimeout(()=>document.getElementById('sat-suggestions').style.display='none',160); }
function selectSatResult(id){
  document.getElementById('sat-search').value=VEH_DATA[id]?.label||id;
  document.getElementById('sat-suggestions').style.display='none';
  zoomToVehicle(id);
  selectedGlobeVehicle=id;
}

// ── FILTER STATE ──
function getFilters(){
  return {
    showOurs:    document.getElementById('f-ours')?.checked,
    showGs:      document.getElementById('f-gs')?.checked,
    showThreat:  document.getElementById('f-threat')?.checked,
    showMon:     document.getElementById('f-monitor')?.checked,
    showNom:     document.getElementById('f-nom')?.checked,
    showRisk:    document.getElementById('f-atrisk')?.checked,
    showTraj:    document.getElementById('f-traj')?.checked,
  };
}

