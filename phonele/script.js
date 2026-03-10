const state={phones:[],target:null,history:[],stats:{},gameOver:false,hints:{},hintsHidden:false};
const keys=['brand','model','cpu','skin'];
const numericKeys=['battery','year','ram','storage','screen'];
const $=id=>document.getElementById(id);
const esc=s=>String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

// CSV loader - supports the new header order:
// Brand;Model;Version;OS;Image;Month;Year;Display;Chipset;Battery;Storage;RAM
async function loadPhonesCSV(url){
  const res=await fetch(url);
  if(!res.ok) throw new Error('CSV not found');
  const text=await res.text();
  const lines=text.split(/\r?\n/).filter(l=>l.trim());
  const headers=lines.shift().split(';').map(h=>h.trim().toLowerCase());
  return lines.map(line=>{
    const values=line.split(';');
    const row={};
    headers.forEach((h,i)=>row[h]=values[i]||'');
    // map to internal schema
    const brand = (row['brand']||'').trim();
    const modelBase = (row['model']||'').trim();
    const version = (row['version']||'').trim();
    const model = (modelBase + (version?(' '+version):'')).trim();
    const skin = (row['os']||'').trim();
    const image = (row['image']||'').trim();
    const monthRaw = (row['month']||'').trim();
    const month = monthRaw ? String(monthRaw).padStart(2,'0') : '';
    const year = parseInt(row['year'],10) || 0;
    const screen = parseFloat((row['display']||'').replace(/["-"]/g,'')) || 0;
    const cpu = (row['chipset']||'').trim();
    const battery = Number(row['battery']||0) || 0;
    const storage = Number(row['storage']||0) || 0;
    const ram = Number(row['ram']||0) || 0;

    const obj = {
      brand,
      model,
      cpu,
      skin,
      image,
      month,
      year,
      screen,
      battery,
      storage,
      ram
    };
    return obj;
  });
}

// helpers
const QUALIFIERS = new Set(['pro','plus','ultra','fe','max','mini','core','lite','se']);
function modelFamilyKey(model){
  if(!model) return '';
  const tokens=model.split(/\s+/).map(t=>t.replace(/\d+/g,'').toLowerCase()).filter(t=>t && !QUALIFIERS.has(t));
  if(tokens.length===0) return '';
  return tokens.slice(0,2).join(' ').trim();
}
function cpuVendor(cpu){ if(!cpu) return ''; return cpu.split(/\s+/)[0].toLowerCase(); }
function skinKey(skin){ if(!skin) return ''; return skin.toLowerCase().replace(/\s+/g,' ').trim(); }

// suggestions
let suggestionsEl,suggestionItems=[];
function buildSuggestionsIndex(){
  const set=new Set();
  state.phones.forEach(p=>set.add(`${p.brand} ${p.model}`.trim()));
  suggestionItems=Array.from(set).sort((a,b)=>a.localeCompare(b));
}
function showSuggestions(q){
  const el=suggestionsEl;
  if(!q){ el.setAttribute('aria-hidden','true'); el.innerHTML=''; return; }
  const ql=q.toLowerCase();
  const matches=suggestionItems.filter(s=> s.toLowerCase().includes(ql)).slice(0,8);
  if(matches.length===0){ el.setAttribute('aria-hidden','true'); el.innerHTML=''; return; }
  el.setAttribute('aria-hidden','false');
  el.innerHTML=matches.map(m=>`<div class="suggestion" role="option">${esc(m)}</div>`).join('');
  Array.from(el.children).forEach(child=>{
    child.addEventListener('click',()=>{
      $('guessInput').value=child.textContent;
      el.setAttribute('aria-hidden','true');
      $('guessInput').focus();
    });
  });
}

// compare category
function compareCategory(guessVal,targetVal,cat){
  const g=(guessVal||'').toLowerCase().trim();
  const t=(targetVal||'').toLowerCase().trim();
  if(!g) return 'wrong';
  if(g===t) return 'correct';
  if(cat==='model'){
    const gf=modelFamilyKey(guessVal), tf=modelFamilyKey(targetVal);
    if(gf && tf && gf===tf) return 'partial';
    if(t.includes(g) || g.includes(t)) return 'partial';
    return 'wrong';
  }
  if(cat==='cpu'){ return cpuVendor(guessVal)===cpuVendor(targetVal)?'partial':'wrong'; }
  if(cat==='skin'){
    const sk=skinKey(guessVal), tk=skinKey(targetVal);
    if(sk && tk && sk===tk) return 'partial';
    if(tk.includes(sk) || sk.includes(tk)) return 'partial';
    return 'wrong';
  }
  if(cat==='brand') return ( (guessVal||'').toLowerCase().trim() === (targetVal||'').toLowerCase().trim() ) ? 'correct' : 'wrong';
  return 'wrong';
}

// numeric comparison
function compareNumeric(guessVal,targetVal){
  const g=Number(guessVal||0), t=Number(targetVal||0);
  if(isNaN(g)||isNaN(t)||t===0) return {direction:'na',level:'na',g,t};
  if(g===t) return {direction:'equal',level:'equal',g,t};
  const ratio=Math.abs(g-t)/Math.max(1,Math.abs(t));
  const level=ratio<=0.10?'near':'far';
  if(g<t) return {direction:'lower',level,g,t};
  return {direction:'higher',level,g,t};
}

// parse guess
function parseGuess(raw){
  const parts=raw.trim();
  if(!parts) return {};
  const words=parts.split(/\s+/);
  return {brand:words[0], model:parts.substring(words[0].length).trim(), cpu:'', skin:'', battery:'', year:'', ram:'', storage:'', screen:''};
}

// strict autofill: exact numbers, penalize extra tokens
function autofill(parsed){
  const inputBrand=(parsed.brand||'').toLowerCase().trim();
  const inputModel=(parsed.model||'').toLowerCase().trim();
  if(!inputModel) return null;

  let candidates=state.phones.filter(p=> (p.brand||'').toLowerCase().startsWith(inputBrand));
  if(!candidates.length) candidates=state.phones;

  let best=null,bestScore=-Infinity;
  const inputTokens=inputModel.split(/\s+/);
  candidates.forEach(p=>{
    const model=(p.model||'').toLowerCase();
    const modelTokens=model.split(/\s+/);
    let score=0;
    inputTokens.forEach(it=>{
      modelTokens.forEach((mt,idx)=>{
        if(it===mt) score+=2;
        else if(mt.startsWith(it)) score+=1;
      });
    });
    // penalize extra tokens in phone model that user did not type
    const extraTokens=modelTokens.filter(mt=>!inputTokens.includes(mt));
    score -= extraTokens.length;
    if(score>bestScore){ bestScore=score; best=p; }
  });

  // require minimum reasonable match
  if(!best || bestScore<inputTokens.length) return null;

  parsed.brand=best.brand;
  parsed.model=best.model;
  parsed.cpu=best.cpu||'';
  parsed.skin=best.skin||'';
  parsed.image=best.image||'';
  parsed.battery=best.battery||0;
  parsed.year=best.year||0;
  parsed.ram=best.ram||0;
  parsed.storage=best.storage||0;
  parsed.screen=best.screen||0;
  return parsed;
}

// dataset stats
function computeStats(){
  const s={};
  numericKeys.forEach(k=>{
    const vals=state.phones.map(p=>Number(p[k]||0)).filter(v=>!isNaN(v)&&v>0);
    s[k]={min:Math.min(...vals), max:Math.max(...vals)};
    if(!isFinite(s[k].min)) s[k].min=0;
    if(!isFinite(s[k].max)) s[k].max=s[k].min+1;
  });
  state.stats=s;
}

// render preview
function renderPhonePreview(p){
  const screen=$('screen'), badge=$('badge');
  screen.innerHTML=''; badge.textContent='?';
  if(state.target && state.target.image){
    const img=document.createElement('img');
    img.className='phone-image';
    img.alt='Phone preview';
    let imgPath=String(state.target.image||'').trim();
    if(!imgPath.startsWith('images/')) imgPath='images/'+imgPath.replace(/^\/+/,'');

    img.src=imgPath;
    img.loading='lazy';
    screen.appendChild(img);
  } else {
    // placeholder
    screen.textContent=p && p.model ? esc(p.model) : '';
  }
  badge.textContent=(p && p.brand?p.brand:'?');
}

// HINTS implementation
const HINTS_ORDER = [
  {key:'brand', label:'Brand', threshold:3},
  {key:'model', label:'Model', threshold:5},
  {key:'cpu', label:'Chipset', threshold:7},
  {key:'released', label:'Release (Month/Year)', threshold:9}
];

function initHints(){
  // create hint state per game
  state.hints = {};
  HINTS_ORDER.forEach(h=>{
    state.hints[h.key] = { unlocked:false, threshold:h.threshold, label:h.label };
  });
  // preserve visibility toggle if player collapsed hints
  if(typeof state.hintsHidden === 'undefined') state.hintsHidden = false;
}

function monthName(mm){
  if(!mm) return '';
  const m = parseInt(String(mm),10);
  if(isNaN(m) || m<1 || m>12) return mm;
  return ['January','February','March','April','May','June','July','August','September','October','November','December'][m-1];
}

function updateHintsUnlocked(){
  if(!state.target) return;
  // count valid (non-invalid) guesses
  const validGuesses = state.history.filter(h=>!h.invalid);
  const validCount = validGuesses.length;

  // auto-unlock if user previously guessed same attribute
  HINTS_ORDER.forEach(h=>{
    const key=h.key;
    // default: locked unless threshold reached
    let unlocked = validCount >= h.threshold;
    // check auto-unlock from history: any guess that has that attribute equal to target's attribute
    if(key === 'released'){
      // auto-unlock released if any guess has both year and month match target
      const any = validGuesses.some(g=>{
        const gg = g.guess || {};
        const y = Number(gg.year||0), m = String(gg.month||'').padStart(2,'0');
        return (y && y===state.target.year) || (m && state.target.month && m === String(state.target.month).padStart(2,'0'));
      });
      if(any) unlocked = true;
    } else {
      const any = validGuesses.some(g=>{
        const gg = g.guess || {};
        const guessedVal = (gg[key]||'').toString().toLowerCase().trim();
        const targetVal = (state.target[key]||'').toString().toLowerCase().trim();
        return guessedVal && targetVal && guessedVal === targetVal;
      });
      if(any) unlocked = true;
    }
    state.hints[key].unlocked = unlocked;
  });
}

function findPreviousGuessContainingAttr(key){
  // return the first previous raw guess that had this attribute equal to the target attribute
  for(let i=0;i<state.history.length;i++){
    const e=state.history[i];
    if(e.invalid) continue;
    const gg = e.guess || {};
    if(key === 'released'){
      if( (Number(gg.year)||0) === state.target.year ) return e.raw;
      if( String(gg.month || '').padStart(2,'0') === String(state.target.month || '').padStart(2,'0') ) return e.raw;
    } else {
      if( (gg[key]||'').toString().toLowerCase().trim() === (state.target[key]||'').toString().toLowerCase().trim() ) return e.raw;
    }
  }
  return null;
}

function renderHints(){
  const wrap = $('hintsWrap');
  const container = $('hints');
  if(!container) return;
  container.innerHTML = '';
  if(state.hintsHidden) {
    wrap.classList.add('hints-collapsed');
  } else {
    wrap.classList.remove('hints-collapsed');
  }
  if(!state.target) return;

  updateHintsUnlocked();

  HINTS_ORDER.forEach(h=>{
    const hs = state.hints[h.key];
    const box = document.createElement('div');
    box.className = 'hint-box ' + (hs.unlocked ? 'unlocked' : 'locked');
    box.setAttribute('data-hint-key', h.key);

    // label + value display
    let display = '';
    if(h.key === 'brand') display = state.target.brand || '—';
    else if(h.key === 'model') display = state.target.model || '—';
    else if(h.key === 'cpu') display = state.target.cpu || '—';
    else if(h.key === 'released') display = (state.target.month ? monthName(state.target.month) + ' ' : '') + (state.target.year || '—');

    box.innerHTML = `<div style="font-weight:700">${esc(h.label)}</div><div class="small muted" style="margin-top:6px">${esc(display)}</div>`;

    // click behavior
    box.addEventListener('click',()=>{
      if(!hs.unlocked) return;
      // try to find a past guess that already included this attribute (so we can autofill with that raw guess)
      const prev = findPreviousGuessContainingAttr(h.key);
      if(prev){
        $('guessInput').value = prev;
        $('guessInput').focus();
        $('suggestions').setAttribute('aria-hidden','true');
        return;
      }
      // otherwise fill a helpful suggestion
      if(h.key === 'brand'){
        $('guessInput').value = state.target.brand || '';
      } else if(h.key === 'model'){
        $('guessInput').value = `${state.target.brand} ${state.target.model}`.trim();
      } else if(h.key === 'cpu'){
        // chip hint - provide brand+model suggestion (makes a valid autofill)
        $('guessInput').value = `${state.target.brand} ${state.target.model}`.trim();
      } else if(h.key === 'released'){
        // show month year text as a filler
        const mm = monthName(state.target.month);
        if(mm) $('guessInput').value = `${state.target.brand} ${state.target.model} — released ${mm} ${state.target.year}`;
        else $('guessInput').value = `${state.target.brand} ${state.target.model} ${state.target.year}`;
      }
      $('guessInput').focus();
      $('suggestions').setAttribute('aria-hidden','true');
    });

    container.appendChild(box);
  });

  // update toggle button text
  $('toggleHints').textContent = state.hintsHidden ? 'Show' : 'Hide';
}

// render history
function renderHistory(){
  const h=$('history'); h.innerHTML='';
  state.history.slice().reverse().forEach(entry=>{
    const row=document.createElement('div'); row.className='guess-row';
    if(entry.invalid){
      row.innerHTML=`<div class="guess-title">${esc(entry.raw)}</div><div class="small muted">Invalid phone</div>`;
      h.appendChild(row);
      return;
    }

    const top=document.createElement('div'); top.className='guess-top';
    const left=document.createElement('div');
    left.innerHTML=`<div class="guess-title">${esc(entry.raw)}</div><div class="small muted">${esc(entry.guess.brand)} ${esc(entry.guess.model)}</div>`;
    const chipsDiv=document.createElement('div'); chipsDiv.className='chips';
    keys.forEach(k=>{
      const chip=document.createElement('div'); chip.className='chip '+entry.result[k]; chip.textContent=(entry.guess[k]||'—'); chipsDiv.appendChild(chip);
    });
    top.appendChild(left); top.appendChild(chipsDiv); row.appendChild(top);

    numericKeys.forEach(nk=>{
      const comp=entry.numeric[nk];
      const compRow=document.createElement('div'); compRow.className='comparison';
      const label=document.createElement('div'); label.className='comp-label'; label.textContent=nk.charAt(0).toUpperCase()+nk.slice(1);
      const valueDiv=document.createElement('div'); valueDiv.className='comp-value';
      if(nk==='battery') valueDiv.textContent=(comp.g>0?comp.g:'—')+' mAh';
      else if(nk==='ram') valueDiv.textContent=(comp.g>0?comp.g:'—')+' GB';
      else if(nk==='storage') valueDiv.textContent=(comp.g>0?comp.g:'—')+' GB';
      else if(nk==='screen') valueDiv.textContent=(comp.g>0?comp.g:'—')+' ″';
      else valueDiv.textContent=(comp.g>0?comp.g:'—');

      const barWrap=document.createElement('div'); barWrap.className='comp-bar';
      const fill=document.createElement('div'); fill.className='comp-fill';
      if(comp.level==='equal') fill.classList.add('equal');
      else if(comp.level==='near') fill.classList.add('near');
      else fill.classList.add('far');
      barWrap.appendChild(fill);

      const arrowWrap=document.createElement('div'); arrowWrap.className='comp-arrow';
      if(comp.direction==='equal') arrowWrap.innerHTML='<span class="equal-tag">=</span>';
      else if(comp.direction==='lower') arrowWrap.textContent='▲';
      else if(comp.direction==='higher') arrowWrap.textContent='▼';
      else arrowWrap.textContent='-';

      const min=state.stats[nk].min, max=state.stats[nk].max;
      const gVal=Number(comp.g||0);
      const rawPct=(max>min)?((gVal-min)/(max-min)*100):0;
      const pct=Math.max(4,Math.min(100,Math.round(rawPct)));
      fill.style.width='0%';
      compRow.appendChild(label); compRow.appendChild(valueDiv); compRow.appendChild(barWrap); compRow.appendChild(arrowWrap);
      row.appendChild(compRow);
      requestAnimationFrame(()=>{ fill.style.width=pct+'%'; });
    });
    h.appendChild(row);
  });

  // re-render hints because history changed and auto-unlock logic may change
  renderHints();
}

// compare guess
function compareGuess(guessObj,targetObj){
  if(!targetObj) return {result:{},win:false,numeric:{}};
  const res={}; let win=true;
  keys.forEach(k=>{
    const s=compareCategory(guessObj[k]||'',targetObj[k]||'',k);
    res[k]=s; if(s!=='correct') win=false;
  });
  const numericRes={};
  numericKeys.forEach(nk=>{
    numericRes[nk]=compareNumeric(guessObj[nk]||0,targetObj[nk]||0);
    if(numericRes[nk].level!=='equal') win=false;
  });
  return {result:res,win,numeric:numericRes};
}

// on guess
function onGuess(){
  if(state.gameOver) return;
  const raw=$('guessInput').value.trim(); if(!raw) return;
  let parsed=parseGuess(raw);
  parsed=autofill(parsed);
  if(!parsed){
    state.history.push({raw,invalid:true});
    renderHistory();
    $('guessInput').value='';
    return;
  }

  const comp=compareGuess(parsed,state.target);
  // attach month if parsed had none: if user typed a month in guess (not used currently), ignored
  // For history usefulness, attach month/year from parsed if provided
  parsed.month = parsed.month || '';
  parsed.year = parsed.year || parsed.year || 0;

  state.history.push({raw, guess:parsed, result:comp.result, numeric:comp.numeric});
  renderHistory();
  $('guessInput').value=''; $('suggestions').setAttribute('aria-hidden','true');

  if(comp.win){
    $('status').innerHTML=`<span class="equal-tag">You guessed it! ${esc(state.target.brand)} ${esc(state.target.model)} in ${state.history.filter(e=>!e.invalid).length} guess${state.history.filter(e=>!e.invalid).length>1?'es':''}.</span>`;
    renderPhonePreview(state.target);
    state.gameOver=true;
    $('guessInput').disabled=true;
    $('newBtn').style.animation='glow 1s infinite alternate';
  } else {
    // re-evaluate hint unlocking and render
    updateHintsUnlocked();
    renderHints();
  }
}

// autocomplete
function attachAutocomplete(){
  suggestionsEl=$('suggestions');
  const input=$('guessInput');
  input.addEventListener('input',e=>showSuggestions(e.target.value));
  input.addEventListener('focus',e=>showSuggestions(e.target.value));
  document.addEventListener('click',ev=>{ if(!ev.target.closest('.controls-top')) suggestionsEl.setAttribute('aria-hidden','true'); });
  input.addEventListener('keydown',e=>{
    const el=suggestionsEl;
    if(el.getAttribute('aria-hidden')==='true') return;
    const active=el.querySelector('.suggestion.active');
    if(e.key==='ArrowDown'){ e.preventDefault(); const next=active?active.nextElementSibling:el.firstElementChild; if(active) active.classList.remove('active'); if(next) next.classList.add('active'); }
    else if(e.key==='ArrowUp'){ e.preventDefault(); const prev=active?active.previousElementSibling:null; if(active) active.classList.remove('active'); if(prev) prev.classList.add('active'); }
    else if(e.key==='Enter'){ const sel=el.querySelector('.suggestion.active')||el.firstElementChild; if(sel){ e.preventDefault(); $('guessInput').value=sel.textContent; el.setAttribute('aria-hidden','true'); } }
  });
}

// game controls
function pickRandom(){ return state.phones[Math.floor(Math.random()*state.phones.length)]; }
function newGame(){
  if(!state.phones.length){ $('status').textContent='No phones loaded'; return; }
  const picked=pickRandom();
  state.target={
    brand:picked.brand||'Unknown',
    model:picked.model||'Unknown',
    cpu:picked.cpu||'',
    skin:picked.skin||'',
    image:picked.image||'',
    battery:Number(picked.battery||0),
    year:Number(picked.year||0),
    ram:Number(picked.ram||0),
    storage:Number(picked.storage||0),
    screen:Number(picked.screen||0),
    month:picked.month||''
  };
  state.history=[];
  state.gameOver=false;
  initHints();
  renderPhonePreview({model:'?',brand:'?'}); // placeholder preview
  renderHistory();
  $('status').textContent='Good luck!';
  $('guessInput').disabled=false;
  $('guessInput').focus();
  $('newBtn').style.animation='';
  renderHints();
}

// init
async function init(){
  $('status').textContent='Loading phones.csv...';
  try{ state.phones=await loadPhonesCSV('phones.csv'); } catch(e){ console.error('Failed to load phones.csv',e); $('status').textContent='Failed to load phones'; return; }
  if(!state.phones.length){ $('screen').textContent='No phones found'; $('status').textContent='No phones loaded'; return; }
  computeStats();
  buildSuggestionsIndex();
  attachAutocomplete();
  // setup hints UI controls
  $('toggleHints').addEventListener('click',()=>{
    state.hintsHidden = !state.hintsHidden;
    renderHints();
  });
  newGame();
  $('status').textContent='Ready';
}

// DOM
document.addEventListener('DOMContentLoaded',()=>{
  $('newBtn').addEventListener('click',newGame);
  $('submitBtn').addEventListener('click',onGuess);
  $('guessInput').addEventListener('keydown',e=>{ if(e.key==='Enter') onGuess(); });
  init();
});