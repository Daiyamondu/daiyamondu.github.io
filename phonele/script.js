const state={phones:[],target:null,history:[],stats:{},gameOver:false};
const keys=['brand','model','cpu','skin'];
const numericKeys=['battery','year','ram','storage','screen'];
const $ = id => document.getElementById(id);
const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

async function loadPhonesCSV(url){
  const res = await fetch(url);
  if(!res.ok) throw new Error('CSV not found');
  const text = await res.text();
  const lines = text.split(/\r?\n/).filter(l=>l.trim());
  const headers = lines.shift().split(';').map(h=>h.trim().toLowerCase());
  return lines.map(line=>{
    const values = line.split(';'); const obj={};
    headers.forEach((h,i)=>{
      let val=values[i]||'';
      if(['year','battery','ram','storage','screen'].includes(h)) val=parseFloat(val)||0;
      obj[h]=val;
    });
    return obj;
  });
}

const QUALIFIERS=new Set(['pro','plus','ultra','fe','max','mini','core','lite','se']);
function modelFamilyKey(model){
  if(!model) return '';
  const tokens=model.split(/\s+/).map(t=>t.replace(/\d+/g,'').toLowerCase()).filter(t=>t&&!QUALIFIERS.has(t));
  return tokens.slice(0,2).join(' ').trim();
}
function cpuVendor(cpu){if(!cpu) return ''; return cpu.split(/\s+/)[0].toLowerCase();}
function skinKey(skin){if(!skin) return ''; return skin.toLowerCase().replace(/\s+/g,' ').trim();}

let suggestionsEl, suggestionItems=[];
function buildSuggestionsIndex(){
  const set=new Set();
  state.phones.forEach(p=> set.add(`${p.brand} ${p.model}`.trim()));
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
    child.addEventListener('click',()=>{$('guessInput').value=child.textContent; el.setAttribute('aria-hidden','true'); $('guessInput').focus();});
  });
}

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
  if(cat==='brand') return 'wrong';
  return 'wrong';
}

function compareNumeric(guessVal,targetVal){
  const g=Number(guessVal||0), t=Number(targetVal||0);
  if(isNaN(g)||isNaN(t)||t===0) return {direction:'na',level:'na',g,t};
  if(g===t) return {direction:'equal',level:'equal',g,t};
  const ratio=Math.abs(g-t)/Math.max(1,Math.abs(t));
  const level=ratio<=0.10?'near':'far';
  if(g<t) return {direction:'lower',level,g,t};
  return {direction:'higher',level,g,t};
}

function parseGuess(raw){
  const parts=raw.trim();
  if(!parts) return {};
  const words=parts.split(/\s+/);
  const brand=words[0];
  const model=parts.substring(brand.length).trim();
  return {brand,model,cpu:'',skin:'',battery:'',year:'',ram:'',storage:'',screen:''};
}

function normalizeBrand(parsed){
  const bLower=(parsed.brand||'').toLowerCase();
  const match=state.phones.find(p=> (p.brand||'').toLowerCase().startsWith(bLower));
  if(match) parsed.brand=match.brand;
}

function autofillFromModel(parsed){
  const input = (parsed.model || '').toLowerCase().trim();
  if(!input) return;

  // compute similarity to all models
  let bestMatch = null;
  let bestScore = -Infinity;

  state.phones.forEach(p => {
    const model = (p.model || '').toLowerCase();
    if(!model) return;

    // score based on common tokens
    const inputTokens = input.split(/\s+/);
    const modelTokens = model.split(/\s+/);
    let score = 0;

    inputTokens.forEach(it => {
      modelTokens.forEach(mt => {
        if(it === mt) score += 2;          // exact match
        else if(mt.startsWith(it)) score += 1; // partial match
      });
    });

    if(score > bestScore){
      bestScore = score;
      bestMatch = p;
    }
  });

  if(bestMatch){
    parsed.model = bestMatch.model;
    parsed.brand = parsed.brand || bestMatch.brand;
    parsed.cpu = bestMatch.cpu || '';
    parsed.skin = bestMatch.skin || '';
    parsed.image = bestMatch.image || '';
    parsed.battery = bestMatch.battery || 0;
    parsed.year = bestMatch.year || 0;
    parsed.ram = bestMatch.ram || 0;
    parsed.storage = bestMatch.storage || 0;
    parsed.screen = bestMatch.screen || 0;
  }
}

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

function renderPhonePreview(p){
  const screen = $('screen'), badge = $('badge');
  screen.innerHTML = '';
  badge.textContent = '?';

  if(state.target && state.target.image){
    const img = document.createElement('img');
    img.className = 'phone-image';
    img.alt = 'Phone preview';

    let imgPath = String(state.target.image || '').trim();

    // fix path: if it doesn't start with "images/", prepend it
    if(!imgPath.startsWith('images/')){
      imgPath = 'images/' + imgPath.replace(/^\/+/, ''); // remove leading slashes
    }

    img.src = imgPath;
    img.loading = 'lazy';
    screen.appendChild(img);
  }

  badge.textContent = (p && p.brand ? p.brand : '?');
}

function renderHistory(){
  const h=$('history'); h.innerHTML='';
  state.history.slice().reverse().forEach(entry=>{
    const row=document.createElement('div'); row.className='guess-row';
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
      valueDiv.textContent=(comp.g>0?comp.g:'—')+(nk==='battery'?' mAh':nk==='ram'||nk==='storage'?' GB':nk==='screen'?' ″':'');
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
      compRow.appendChild(label); compRow.appendChild(valueDiv); compRow.appendChild(barWrap); compRow.appendChild(arrowWrap);
      row.appendChild(compRow);
      requestAnimationFrame(()=>{ fill.style.width=pct+'%'; });
    });
    h.appendChild(row);
  });
}

function compareGuess(guessObj,targetObj){
  if(!targetObj) return {result:{}, win:false, numeric:{}};
  const res={}; let win=true;
  keys.forEach(k=>{
    const s=compareCategory(guessObj[k]||'', targetObj[k]||'', k);
    res[k]=s; if(s!=='correct') win=false;
  });
  const numericRes={};
  numericKeys.forEach(nk=>{
    numericRes[nk]=compareNumeric(guessObj[nk]||0, targetObj[nk]||0);
    if(numericRes[nk].level!=='equal') win=false;
  });
  return {result:res, win, numeric:numericRes};
}

function onGuess(){
  if(state.gameOver) return;
  const raw=$('guessInput').value.trim(); if(!raw) return;
  const parsed=parseGuess(raw);
  normalizeBrand(parsed);
  autofillFromModel(parsed);
  const comp=compareGuess(parsed,state.target);
  state.history.push({raw, guess:parsed, result:comp.result, numeric:comp.numeric});
  renderHistory();
  $('guessInput').value=''; $('suggestions').setAttribute('aria-hidden','true');

  if(comp.win){
    $('status').innerHTML=`<span class="equal-tag">You guessed it! ${esc(state.target.brand)} ${esc(state.target.model)} in ${state.history.length} guess${state.history.length>1?'es':''}.</span>`;
    renderPhonePreview(state.target);
    state.gameOver=true;
    $('newBtn').classList.add('glow');
  } else {
    $('status').textContent=`Guesses: ${state.history.length}`;
  }
}

function attachAutocomplete(){
  suggestionsEl=$('suggestions');
  const input=$('guessInput');
  input.addEventListener('input', e=>showSuggestions(e.target.value));
  input.addEventListener('focus', e=>showSuggestions(e.target.value));
  document.addEventListener('click', ev=>{ if(!ev.target.closest('.controls-top')) suggestionsEl.setAttribute('aria-hidden','true'); });
  input.addEventListener('keydown', e=>{
    const el=suggestionsEl;
    if(el.getAttribute('aria-hidden')==='true') return;
    const active=el.querySelector('.suggestion.active');
    if(e.key==='ArrowDown'){ e.preventDefault(); const next=active?active.nextElementSibling:el.firstElementChild; if(active) active.classList.remove('active'); if(next) next.classList.add('active'); }
    else if(e.key==='ArrowUp'){ e.preventDefault(); const prev=active?active.previousElementSibling:null; if(active) active.classList.remove('active'); if(prev) prev.classList.add('active'); }
    else if(e.key==='Enter'){ const sel=el.querySelector('.suggestion.active')||el.firstElementChild; if(sel){ e.preventDefault(); $('guessInput').value=sel.textContent; el.setAttribute('aria-hidden','true'); } }
  });
}

function pickRandom(){ return state.phones[Math.floor(Math.random()*state.phones.length)]; }

function newGame(){
  if(!state.phones.length){ $('status').textContent='No phones loaded'; return; }
  const picked=pickRandom();
  state.target={brand:picked.brand||'Unknown', model:picked.model||'Unknown', cpu:picked.cpu||'', skin:picked.skin||'', image:picked.image||'', battery:Number(picked.battery||0), year:Number(picked.year||0), ram:Number(picked.ram||0), storage:Number(picked.storage||0), screen:Number(picked.screen||0)};
  state.history=[]; state.gameOver=false;
  $('newBtn').classList.remove('glow');
  renderPhonePreview({model:'?',brand:'?'});
  renderHistory();
  $('status').textContent='Good luck!';
}

async function init(){
  $('status').textContent='Loading phones.csv...';
  try{ state.phones=await loadPhonesCSV('phones.csv'); } catch(e){ console.error(e); $('status').textContent='Failed to load phones'; return; }
  if(!state.phones.length){ $('screen').textContent='No phones found'; $('status').textContent='No phones loaded'; return; }
  computeStats();
  buildSuggestionsIndex();
  attachAutocomplete();
  newGame();
  $('status').textContent='Ready';
}

document.addEventListener('DOMContentLoaded', ()=>{
  $('newBtn').addEventListener('click', newGame);
  $('submitBtn').addEventListener('click', onGuess);
  $('guessInput').addEventListener('keydown', e=>{ if(e.key==='Enter') onGuess(); });
  init();
});
