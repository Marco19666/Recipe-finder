const $=s=>document.querySelector(s);
let mode='search';
const SESSION_KEY='chefai-session-v1';
document.querySelectorAll('.chefai-mode').forEach(button=>button.addEventListener('click',()=>{
  mode=button.dataset.mode;
  document.querySelectorAll('.chefai-mode').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));
  document.querySelectorAll('.chefai-pane').forEach(pane=>pane.hidden=pane.dataset.pane!==mode);
}));
const status=$('#chefai-status'),result=$('#chefai-result');
function say(message){status.hidden=false;status.textContent=message}
function node(tag,value){const item=document.createElement(tag);if(value!==undefined)item.textContent=value;return item}
function saveSession(recipe,servings,step=0){
  try{localStorage.setItem(SESSION_KEY,JSON.stringify({recipe,servings,step,savedAt:Date.now()}))}catch(_){}
}
async function standardize(payload){
  say('Sto standardizzando la ricetta e verificando completezza e coerenza…');
  result.replaceChildren();
  document.querySelectorAll('.chefai-action').forEach(button=>button.disabled=true);
  try{
    const response=await fetch('/api/chef-ai/standardize',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    const data=await response.json();
    if(!response.ok)throw Error(data.detail||'Elaborazione non riuscita.');
    if(!data.recipe)throw Error('La risposta non contiene una ricetta valida.');
    try{sessionStorage.setItem(SESSION_KEY,JSON.stringify({recipe:data.recipe,normalized:true,savedAt:Date.now()}))}catch(_){}
    render(data.recipe);
  }catch(error){say(error.message||'Errore durante l’elaborazione.')}
  finally{document.querySelectorAll('.chefai-action').forEach(button=>button.disabled=false)}
}
function render(recipe){
  status.hidden=true;result.replaceChildren();
  result.append(node('h2',recipe.name||'Ricetta'));
  result.append(node('p','Porzioni originali: '+(recipe.servings?.original??'non indicate')+' · Preparazione: '+(recipe.times?.preparation_minutes??'—')+' min · Cottura: '+(recipe.times?.cooking_minutes??'—')+' min'));
  const audit=recipe.completeness_check||{};
  const findings=Array.isArray(audit.findings)?audit.findings:[];
  if(findings.length){
    const box=node('section');box.className='chefai-issues';box.append(node('h3','Controllo AI di completezza'));
    findings.forEach(f=>{
      const level=f.severity==='blocking'?'Da risolvere':f.severity==='warning'?'Da verificare':'Nota';
      box.append(node('p',level+': '+f.description+(f.evidence?' · Riscontro: '+f.evidence:'')+(f.suggested_action?' · Suggerimento: '+f.suggested_action:'')));
    });
    result.append(box);
  }else result.append(node('p','Controllo AI: nessuna lacuna rilevata nei dati disponibili.'));
  result.append(node('h3','Ingredienti'));
  const ingredients=node('ul');
  (recipe.ingredients||[]).forEach(item=>ingredients.append(node('li',item.name+': '+(item.quantity??'quantità non indicata')+(item.unit?' '+item.unit:''))));
  result.append(ingredients);
  result.append(node('h3','Attrezzatura'));
  result.append(node('p',(recipe.equipment||[]).join(', ')||'Non specificata'));
  result.append(node('h3','Procedimento'));
  (recipe.steps||[]).forEach(step=>result.append(node('p',step.order+'. '+step.instruction)));
  const blocked=audit.status==='blocking'||recipe.validation?.status==='errore'||findings.some(f=>f.severity==='blocking'&&!f.resolved);
  if(blocked){result.append(node('p','La ricetta presenta problemi bloccanti: occorre chiarirli o correggerli prima di avviare la guida.'));return}
  const panel=node('div');panel.append(node('h3','Quante porzioni vuoi preparare?'));
  const input=node('input');input.type='number';input.min='1';input.max='50';input.step='1';input.inputMode='numeric';input.value=recipe.servings?.original||2;input.setAttribute('aria-label','Numero di porzioni desiderate');
  panel.append(input);
  const go=node('button','Conferma porzioni e avvia Chef Guidato');go.className='chefai-action';
  go.onclick=()=>{
    const servings=Number(input.value);
    if(!Number.isInteger(servings)||servings<1||servings>50){say('Inserisci un numero di porzioni valido, da 1 a 50.');return}
    const original=Number(recipe.servings?.original);
    if(!Number.isFinite(original)||original<=0){say('Le porzioni originali non sono chiare: correggi il dato prima di scalare gli ingredienti.');return}
    const scaled=structuredClone(recipe);
    const factor=servings/original;
    scaled.ingredients=(scaled.ingredients||[]).map(item=>{
      if(item.scaling==='linear'&&typeof item.quantity==='number')return {...item,quantity:Math.round(item.quantity*factor*1000)/1000};
      return {...item};
    });
    scaled.servings={...scaled.servings,requested:servings,confirmed:true};
    saveSession(scaled,servings,0);
    startGuide(scaled,servings,0);
  };
  result.append(panel,go);
}
function startGuide(recipe,servings,startIndex=0){
  const steps=Array.isArray(recipe.steps)?recipe.steps:[];
  if(!steps.length){say('Questa ricetta non contiene passaggi da seguire.');return}
  result.replaceChildren(node('h2','Chef Guidato'));
  result.append(node('p','Porzioni: '+servings+'. Le quantità scalabili sono state ricalcolate; tempi e temperature restano quelli della ricetta.'));
  const area=node('div'),nav=node('div');area.className='chefai-step';nav.className='chefai-nav';
  const back=node('button','← Indietro'),next=node('button','Avanti →'),read=node('button','🔊 Leggi');
  [back,next,read].forEach(button=>{button.className='chefai-action';button.type='button'});
  let index=Math.min(Math.max(0,startIndex),steps.length-1),timerInterval=null;
  function show(){
    if(timerInterval){clearInterval(timerInterval);timerInterval=null}
    const step=steps[index];area.replaceChildren(node('small','PASSAGGIO '+(index+1)+' DI '+steps.length),node('p',step.instruction));
    if(step.temperature_c!==null&&step.temperature_c!==undefined)area.append(node('p','Temperatura: '+step.temperature_c+' °C'+(step.cooking_mode?' · '+step.cooking_mode:'')));
    if(step.timer_seconds){
      const timerLabel=node('p','Timer: '+Math.ceil(step.timer_seconds/60)+' minuti');
      const timer=node('button','Avvia timer');timer.className='chefai-action';timer.type='button';
      timer.onclick=()=>{
        if(timerInterval)clearInterval(timerInterval);
        let remaining=Number(step.timer_seconds);timer.disabled=true;
        const update=()=>{timer.textContent='⏱ '+Math.floor(remaining/60)+':'+String(remaining%60).padStart(2,'0')};
        update();
        timerInterval=setInterval(()=>{remaining--;update();if(remaining<=0){clearInterval(timerInterval);timerInterval=null;timer.textContent='Tempo terminato';timer.disabled=false;if('vibrate'in navigator)navigator.vibrate?.([200,100,200])}},1000);
      };
      area.append(timerLabel,timer);
    }
    back.disabled=index===0;next.textContent=index===steps.length-1?'Termina':'Avanti →';
    saveSession(recipe,servings,index);
  }
  back.onclick=()=>{index=Math.max(0,index-1);show()};
  next.onclick=()=>{if(index<steps.length-1){index++;show()}else{if(timerInterval)clearInterval(timerInterval);area.replaceChildren(node('h3','Complimenti, hai terminato!'));nav.hidden=true;try{localStorage.removeItem(SESSION_KEY)}catch(_){}}};
  read.onclick=()=>{if('speechSynthesis'in window){speechSynthesis.cancel();const utterance=new SpeechSynthesisUtterance(steps[index].instruction);utterance.lang='it-IT';speechSynthesis.speak(utterance)}else say('La lettura vocale non è supportata da questo browser.')};
  nav.append(back,next,read);result.append(area,nav);show();
}
$('#search-btn').onclick=async()=>{
  const query=$('#search-q').value.trim();if(query.length<2){say('Scrivi almeno due caratteri.');return}
  say('Cerco ricette…');
  try{
    const response=await fetch('/api/search?q='+encodeURIComponent(query));const data=await response.json();
    if(!response.ok)throw Error(data.detail||'Ricerca non riuscita.');
    const host=$('#search-results');host.replaceChildren();const items=data.results||[];
    if(!items.length){host.append(node('p','Nessuna ricetta trovata.'));return}
    items.forEach(item=>{const button=node('button',item.title);button.className='chefai-action';button.onclick=()=>standardize({source_url:item.url});host.append(button)});
  }catch(error){say(error.message||'Errore durante la ricerca.')}
};
$('#manual-btn').onclick=()=>standardize({text:$('#manual-text').value});
$('#file-btn').onclick=()=>standardize({text:$('#file-text').value});
$('#recipe-file').onchange=async event=>{
  const file=event.target.files?.[0];if(!file)return;
  if(!/\.(txt|md)$/i.test(file.name)){say('In questa versione sono supportati file TXT e MD. Per PDF o DOCX incolla il testo nel campo sottostante.');event.target.value='';return}
  if(file.size>1000000){say('Il file supera 1 MB.');event.target.value='';return}
  $('#file-text').value=await file.text();say('File caricato. Ora puoi controllare la ricetta.');
};
$('#ai-btn').onclick=()=>standardize({request:$('#ai-prompt').value});
