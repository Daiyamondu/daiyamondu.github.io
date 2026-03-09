// Phonele: static client-only game
// Expects a phones.txt file (CSS-like) next to the HTML

const state = {phones:[],target:null,history:[]};
const keys = ['brand','model','cpu','skin'];

function $(id){return document.getElementById(id);}
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

async function loadPhones(){
  try{
    const res = await fetch('phones.txt');
    if(!res.ok) throw new Error('phones.txt not found');
    const txt = await res.text();
    const blocks = [...txt.matchAll(/\.phone\s*\{([\s\S]*?)\}/g)];
    const phones = blocks.map(b=>{
      const inner=b[1];
      const obj={};
      const kv=[...inner.matchAll(/([a-zA-Z0-9_-]+)\s*:\s*"([^"]*)"\s*;/g)];
      kv.forEach(m=>obj[m[1].trim().toLowerCase()]=m[2].trim());
      return obj;
    }).filter(p=>Object.keys(p).length>0);
    return phones;
  }catch(err){
    console.error(err);
    $('status').textContent='Failed to load phones.txt';
    return [];
  }
}

function pickRandom(){
  const a=state.phones;
  return a[Math.floor(Math.random()*a.length)];
}

function renderPhonePreview(p){
  const screen=$('screen'), badge=$('badge');
  if(!p){screen.textContent='—'; badge.textContent='?'; return;}
  screen.innerHTML=`<div style="font-size:14px;font-weight:700">${esc(p.model||'Unknown')}</div><div class="small">${esc(p.brand||'')}</div>`;
  badge.textContent=(p.brand||'?').split(' ')[0];
}

function renderHistory(){
  const h=$('history'); h.innerHTML='';
  state.history.slice().reverse().forEach(entry=>{
    const row=document.createElement('div'); row.className='guess-row';
    const left=document.createElement('div'); left.innerHTML=`<div class="small">Guess</div><div style="font-weight:700">${esc(entry.raw)}</div>`;
    const right=document.createElement('div'); right.className='category';
    const catRow=document.createElement('div'); catRow.className='cat-row';
    keys.forEach(k=>{
      const chip=document.createElement('div');
      chip.className='chip '+(entry.result[k]?'correct':'wrong');
      chip.textContent=(entry.guess[k]||'—');
      catRow.appendChild(chip);
    });
    right.appendChild(catRow);
    row.appendChild(left); row.appendChild(right);
    h.appendChild(row);
  });
}

function renderTargetList(showValues=false){
  const t=$('targetList'); t.innerHTML='';
  keys.forEach(k=>{
    const div=document.createElement('div'); div.style.display='flex'; div.style.justifyContent='space-between'; div.style.alignItems='center';
    const left=document.createElement('div'); left.textContent=k.charAt(0).toUpperCase()+k.slice(1);
    const right=document.createElement('div'); right.className='small';
    right.textContent = showValues ? (state.target&&state.target[k]?state.target[k]:'—') : 'Hidden';
    div.appendChild(left); div.appendChild(right); t.appendChild(div);
  });
}

function compareGuess(guessObj,targetObj){
  const res={}; let all=true;
  keys.forEach(k=>{
    const g = (guessObj[k]||'').toLowerCase();
    const t = (targetObj[k]||'').toLowerCase();
    const ok = (g !== '' && g === t);
    res[k] = ok;
    if(!ok) all = false;
  });
  return {result:res,win:all};
}

function parseGuess(raw){
  const parts = raw.trim();
  if(!parts) return {};
  const words = parts.split(/\s+/);
  const brand = words[0];
  const model = parts.substring(brand.length).trim();
  return {brand:brand,model:model,cpu:'',skin:''};
}

function normalizeBrand(parsed){
  const bLower = (parsed.brand||'').toLowerCase();
  const match = state.phones.find(p=> (p.brand||'').toLowerCase().startsWith(bLower));
  if(match) parsed.brand = match.brand;
}

function autofillFromModel(parsed){
  const mlower = (parsed.model||'').toLowerCase();
  const found = state.phones.find(p=> (p.model||'').toLowerCase()===mlower || (p.model||'').toLowerCase().endsWith(mlower));
  if(found){
    parsed.cpu = found.cpu||'';
    parsed.skin = found.skin||'';
    parsed.model = found.model||parsed.model;
  }
}

function onGuess(){
  const raw = $('guessInput').value.trim(); if(!raw) return;
  const parsed = parseGuess(raw);
  normalizeBrand(parsed);
  autofillFromModel(parsed);
  const comp = compareGuess(parsed, state.target);
  state.history.push({raw,guess:parsed,result:comp.result});
  renderHistory();
  $('guessInput').value='';
  if(comp.win){
    $('status').innerHTML = `<span class="win">You guessed it! The phone was ${esc(state.target.brand)} ${esc(state.target.model)}</span>`;
    renderTargetList(true);
    renderPhonePreview(state.target);
  }
}

function newGame(){
  if(!state.phones.length){ $('status').textContent='No phones loaded'; return; }
  state.target = pickRandom();
  state.history = [];
  renderPhonePreview({model:'?',brand:'?'});
  renderHistory();
  renderTargetList(false);
  $('status').textContent='Good luck!';
}

async function init(){
  state.phones = await loadPhones();
  if(state.phones.length===0){ $('screen').textContent='No phones found in phones.txt'; return; }
  newGame();
}

document.addEventListener('DOMContentLoaded',()=>{
  $('newBtn').addEventListener('click',newGame);
  $('submitBtn').addEventListener('click',onGuess);
  $('guessInput').addEventListener('keydown',e=>{ if(e.key==='Enter') onGuess(); });
  init();
});