const state={phones:[],target:null,history:[],stats:{},gameOver:false,hints:{}};
const keys=['brand','model','cpu','skin'];
const numericKeys=['battery','year','ram','storage','screen'];
const $=id=>document.getElementById(id);
const esc=s=>String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

// --- Load CSV ---
async function loadPhonesCSV(url){
  const res=await fetch(url);
  if(!res.ok) throw new Error('CSV not found');
  const text=await res.text();
  const lines=text.split(/\r?\n/).filter(l=>l.trim());
  const headers=lines.shift().split(';').map(h=>h.trim().toLowerCase());
  return lines.map(line=>{
    const values=line.split(';');
    const obj={};
    headers.forEach((h,i)=>{
      let val=values[i]||'';
      if(['year','battery','ram','storage','display','month'].includes(h)) val=parseFloat(val)||0;
      obj[h]=val;
    });
    return obj;
  });
}

// --- Helpers ---
const QUALIFIERS = new Set(['pro','plus','ultra','fe','max','mini','core','lite','se']);
function modelFamilyKey(model){
  if(!model) return '';
  const tokens=model.split(/\s+/).map(t=>t.replace(/\d+/g,'').toLowerCase()).filter(t=>t&&!QUALIFIERS.has(t));
  return tokens.slice(0,2).join(' ').trim();
}
function cpuVendor(cpu){ return (cpu||'').split(/\s+/)[0].toLowerCase(); }
function skinKey(skin){ return (skin||'').toLowerCase().replace(/\s+/g,' ').trim(); }

// --- Suggestions ---
let suggestionsEl=[], suggestionItems=[];
function buildSuggestionsIndex(){
  const set=new Set();
  state.phones.forEach(p=>set.add(`${p.brand} ${p.model}`.trim()));
  suggestionItems=Array.from(set).sort((a,b)=>a.localeCompare(b));
}
function showSuggestions(q){
  const el=$('suggestions');
  if(!q){ el.setAttribute('aria-hidden','true'); el.innerHTML=''; return; }
  const ql=q.toLowerCase();
  const matches=suggestionItems.filter(s=> s.toLowerCase().includes(ql)).slice(0,8);
  if(matches.length===0){ el.setAttribute('aria-hidden','true'); el.innerHTML=''; return; }
  el.setAttribute('aria-hidden','false');
  el.innerHTML=matches.map(m=>`<div class="suggestion" role="option">${esc(m)}</div>`).join('');
  Array.from(el.children).forEach(child=>{
    child.addEventListener('click',()=>{$('guessInput').value=child.textContent; el.setAttribute('aria-hidden','true'); $('guessInput').focus();});
  });
}

// --- Compare ---
function compareCategory(guessVal,targetVal,cat){
  const g=(guessVal||'').toLowerCase().trim();
  const t=(targetVal||'').toLowerCase().trim();
  if(!g) return 'wrong';
  if(g===t) return 'correct';
  if(cat==='model'){
    const gf=modelFamilyKey(guessVal), tf=modelFamilyKey(targetVal);
    if(gf && tf && gf===tf) return 'partial';
    if(t.includes(g) || g.includes(t)) return 'partial';
  }
  if(cat==='cpu'){ return cpuVendor(guessVal)===cpuVendor(targetVal)?'partial':'wrong'; }
  if(cat==='skin'){
    const sk=skinKey(guessVal), tk=skinKey(targetVal);
    if(sk && tk && sk===tk) return 'partial';
    if(tk.includes(sk) || sk.includes(tk)) return 'partial';
  }
  if(cat==='brand') return 'wrong';
  return 'wrong';
}
function compareNumeric(guessVal,targetVal){
  const g=Number(guessVal||0), t=Number(targetVal||0);
  if(isNaN(g)||isNaN(t)||t===0) return {direction:'na',level:'na',g,t};
  if(g===t) return {direction:'equal',level:'equal',g,t};
  const ratio=Math.abs(g-t)/Math.max(1,Math.abs(t));
  const level=ratio<=0.10?'near':'far';
  return g<t ? {direction:'lower',level,g,t} : {direction:'higher',level,g,t};
}

// --- Parse & Autofill ---
function parseGuess(raw){
  const parts=raw.trim(); if(!parts) return {};
  const words=parts.split(/\s+/);
  return {brand:words[0], model:parts.substring(words[0].length).trim(), cpu:'', skin:'', battery:'', year:'', ram:'', storage:'', screen:''};
}
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
    inputTokens.forEach(it=>{ modelTokens.forEach(mt=>{ if(it===mt) score+=2; else if(mt.startsWith(it)) score+=1; }); });
    const extraTokens=modelTokens.filter(mt=>!inputTokens.includes(mt));
    score-=extraTokens.length;
    if(score>bestScore){ bestScore=score; best=p; }
  });
  if(!best || bestScore<inputTokens.length) return null;

  parsed.brand=best.brand;
  parsed.model=best.model;
  parsed.cpu=best.cpu||'';
  parsed.skin=best.skin||'';
  parsed.image=best.image||'';
  parsed.battery=best.battery||0;
  parsed.year=best.year||0;
  parsed.month=best.month||0;
  parsed.ram=best.ram||0;
  parsed.storage=best.storage||0;
  parsed.screen=best.display||0;
  return parsed;
}

// --- Stats ---
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

// --- Render phone preview ---
function renderPhonePreview(p){
  const screen=$('screen'), badge=$('badge'); screen.innerHTML=''; badge.textContent='?';
  if(state.target && state.target.image){
    const img=document.createElement('img');
    img.className='phone-image';
    img.alt='Phone preview';
    img.src=state.target.image; // use CSV path directly
    img.loading='lazy';
    screen.appendChild(img);
  }
  badge.textContent=(p && p.brand?p.brand:'?');
}

// --- Render Hints ---
function renderHints(){
  const row=$('hintsRow'); row.innerHTML='';
  const hintsOrder=['brand','model','chipset','release'];
  hintsOrder.forEach(k=>{
    const h=state.hints[k];
    if(!h) return;
    const chip=document.createElement('div');
    chip.className='hint-chip '+(h.unlocked?'unlocked':'locked');
    if(!h.unlocked){ chip.innerHTML=`<span class="lock-icon">🔒</span>`; chip.setAttribute('data-tooltip',`Unlock after ${h.unlockAfter} guesses`);}
    else{ chip.textContent=h.value; chip.addEventListener('click',()=>{$('guessInput').value=h.value; $('guessInput').focus();}); }
    row.appendChild(chip);
  });
}

// --- Update hints after guesses ---
function updateHints(){
  const attempts = state.history.filter(e=>!e.invalid).length;
  const t=state.target;
  state.hints = {
    brand:{unlocked: attempts>=3, value: t.brand, unlockAfter: Math.max(3-attempts,0)},
    model:{unlocked: attempts>=5, value: t.model, unlockAfter: Math.max(5-attempts,0)},
    chipset:{unlocked: attempts>=7, value: t.cpu, unlockAfter: Math.max(7-attempts,0)},
    release:{unlocked: attempts>=9, value: `${t.month.toString().padStart(2,'0')}/${t.year}`, unlockAfter: Math.max(9-attempts,0)}
  };
  renderHints();
}

// --- History ---
function renderHistory(){
  const h=$('history'); h.innerHTML='';
  state.history.slice().reverse().forEach(entry=>{
    const row=document.createElement('div'); row.className='guess-row';
    if(entry.invalid){ row.innerHTML=`<div class="guess-title">${esc(entry.raw)}</div><div class="small muted">Invalid phone</div>`; h.appendChild(row); return; }
    const top=document.createElement('div'); top.className='guess-top';
    const left=document.createElement('div');
    left.innerHTML=`<div class="guess-title">${esc(entry.raw)}</div><div class="small muted">${esc(entry.guess.brand)} ${esc(entry.guess.model)}</div>`;
    const chipsDiv=document.createElement('div'); chipsDiv.className='chips';
    keys.forEach(k=>{ const chip=document.createElement('div'); chip.className='chip '+entry.result[k]; chip.textContent=(entry.guess[k]||'—'); chipsDiv.appendChild(chip); });
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
  updateHints();
}

// --- Compare guess ---
function compareGuess(guessObj,targetObj){
  if(!targetObj) return {result:{},win:false,numeric:{}};
  const res={}; let win=true;
  keys.forEach(k=>{ const s=compareCategory(guessObj[k]||'',targetObj[k]||'',k); res[k]=s; if(s!=='correct') win=false; });
  const numericRes={};
  numericKeys.forEach(nk=>{ numericRes[nk]=compareNumeric(guessObj[nk]||0,targetObj[nk]||0); if(numericRes[nk].level!=='equal') win=false; });
  return {result:res,win,numeric:numericRes};
}

// --- On guess ---
function onGuess(){
  if(state.gameOver) return;
  const raw=$('guessInput').value.trim(); if(!raw) return;
  let parsed=parseGuess(raw); parsed=autofill(parsed);
  if(!parsed){ state.history.push({raw,invalid:true}); renderHistory(); $('guessInput').value=''; return; }
  const comp=compareGuess(parsed,state.target);
  state.history.push({raw, guess:parsed, result:comp.result, numeric:comp.numeric});
  renderHistory();
  $('guessInput').value=''; $('suggestions').setAttribute('aria-hidden','true');
  if(comp.win){
    $('status').innerHTML=`<span class="equal-tag">You guessed it! ${esc(state.target.brand)} ${esc(state.target.model)} in ${state.history.filter(e=>!e.invalid).length} guess${state.history.filter(e=>!e.invalid).length>1?'es':''}.</span>`;
    renderPhonePreview(state.target);
    state.gameOver=true;
    $('guessInput').disabled=true;
    $('newBtn').style.animation='glow 1s infinite alternate';
  }
}

// --- Autocomplete ---
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