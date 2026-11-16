const $=s=>document.querySelector(s);
let mode=null;
const SESSION_KEY='chefai-session-v1';
const modeChooser=$('#chefai-modes'),sectionTitle=$('#chefai-section-title'),sectionIntro=$('#chefai-section-intro');
const modeNames={search:'Cerca una ricetta',file:'Carica un file',manual:'Scrivi la ricetta',ai:'Crea con Chef-AI'};
function showModes(){mode=null;modeChooser.hidden=false;sectionIntro.hidden=false;sectionTitle.textContent='Come vuoi iniziare?';document.querySelectorAll('.chefai-mode').forEach(b=>b.setAttribute('aria-pressed','false'));document.querySelectorAll('.chefai-pane').forEach(p=>p.hidden=true)}
function selectMode(next){mode=next;modeChooser.hidden=true;sectionIntro.hidden=true;sectionTitle.textContent=modeNames[mode];document.querySelectorAll('.chefai-mode').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mode===mode)));document.querySelectorAll('.chefai-pane').forEach(p=>{p.hidden=p.dataset.pane!==mode;if(p.dataset.pane===mode&&!p.querySelector('.chefai-change-mode')){const b=document.createElement('button');b.type='button';b.className='chefai-change-mode';b.textContent='← Cambia modalità';b.addEventListener('click',showModes);p.prepend(b)}})}
document.querySelectorAll('.chefai-mode').forEach(b=>b.addEventListener('click',()=>selectMode(b.dataset.mode)));
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
    render(data.recipe,Number(payload.requested_servings)||null);
  }catch(error){say(error.message||'Errore durante l’elaborazione.')}
  finally{document.querySelectorAll('.chefai-action').forEach(button=>button.disabled=false)}
}
function render(recipe,presetServings=null){
  status.hidden=true;result.replaceChildren();
  result.append(node('h2',recipe.name||'Ricetta'));
  result.append(node('p',(presetServings?'Porzioni richieste: '+presetServings:'Porzioni originali: '+(recipe.servings?.original??'non indicate'))+' · Preparazione: '+(recipe.times?.preparation_minutes??'—')+' min · Cottura: '+(recipe.times?.cooking_minutes??'—')+' min'));
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
  const validationIssues=Array.isArray(recipe.validation?.issues)?recipe.validation.issues:[];
  validationIssues.forEach(issue=>{
    const label=issue.severity==='blocking'?'Da risolvere':issue.severity==='warning'?'Da verificare':'Nota';
    result.append(node('p',label+': '+(issue.message||'Problema di validazione')));
  });
  const blocked=audit.status==='blocking'||recipe.validation?.status==='errore'||findings.some(f=>f.severity==='blocking'&&!f.resolved)||validationIssues.some(issue=>issue.severity==='blocking');
  if(blocked){result.append(node('p','La ricetta presenta problemi bloccanti: occorre chiarirli o correggerli prima di avviare la guida.'));return}
  const panel=node('div');panel.append(node('h3',presetServings?'Hai indicato '+presetServings+' porzioni nella richiesta':'Quante porzioni vuoi preparare?'));
  const input=node('input');input.type='number';input.min='1';input.max='50';input.step='1';input.inputMode='numeric';input.value=presetServings||recipe.servings?.original||2;input.setAttribute('aria-label','Numero di porzioni desiderate');
  panel.append(input);
  const go=node('button',presetServings?'Conferma '+presetServings+' porzioni e avvia Chef Guidato':'Conferma porzioni e avvia Chef Guidato');go.className='chefai-action';
  go.onclick=()=>{
    const servings=Number(input.value);
    if(!Number.isInteger(servings)||servings<1||servings>50){say('Inserisci un numero di porzioni valido, da 1 a 50.');return}
    const original=Number(recipe.servings?.original)||Number(presetServings);
    const hasOriginal=Number.isFinite(original)&&original>0;
    const scaled=structuredClone(recipe);
    if(hasOriginal){
      const factor=servings/original;
      scaled.ingredients=(scaled.ingredients||[]).map(item=>{
        if(item.scaling==='linear'&&typeof item.quantity==='number')return {...item,quantity:Math.round(item.quantity*factor*1000)/1000};
        return {...item};
      });
    }else{
      say('Porzioni originali non indicate: avvio la guida mantenendo invariate le quantità degli ingredienti.');
    }
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
  const conversation=[];
  const deviceKey='recipe-finder-device-id';
  let deviceId='';
  try{deviceId=localStorage.getItem(deviceKey)||'';if(!/^[A-Za-z0-9-]{16,100}$/.test(deviceId)){deviceId=(crypto.randomUUID?crypto.randomUUID():('chefai-'+Date.now()+'-'+Math.random().toString(36).slice(2)));localStorage.setItem(deviceKey,deviceId)}}catch(_){deviceId='chefai-'+Date.now()+'-'+Math.random().toString(36).slice(2)}
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
  nav.append(back,next,read);
  const voiceButton=node('button','🎙 Comandi vocali');voiceButton.className='chefai-action';voiceButton.type='button';
  const SpeechRecognition=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(SpeechRecognition){
    voiceButton.onclick=()=>{
      const recognition=new SpeechRecognition();recognition.lang='it-IT';recognition.interimResults=false;recognition.maxAlternatives=1;
      voiceButton.disabled=true;voiceButton.textContent='Ascolto…';
      recognition.onresult=event=>{
        const command=event.results[0][0].transcript.toLowerCase();
        if(/indietro|precedente/.test(command))back.click();
        else if(/avanti|successivo|prossimo/.test(command))next.click();
        else if(/ripeti|rileggi/.test(command))read.click();
        else say('Comando non riconosciuto. Puoi dire avanti, indietro o ripeti.');
      };
      recognition.onerror=()=>say('Non sono riuscito a riconoscere il comando vocale.');
      recognition.onend=()=>{voiceButton.disabled=false;voiceButton.textContent='🎙 Comandi vocali'};
      recognition.start();
    };
    nav.append(voiceButton);
  }
  const askBox=node('section');askBox.className='chefai-step';
  askBox.append(node('h3','Hai una domanda su questo passaggio?'));
  const askInput=node('input');askInput.type='text';askInput.maxLength=700;askInput.placeholder='Es. Come capisco se è pronto?';askInput.setAttribute('aria-label','Domanda allo chef');
  const askButton=node('button','Chiedi allo chef');askButton.className='chefai-action';askButton.type='button';
  const answer=node('p');answer.setAttribute('aria-live','polite');
  askButton.onclick=async()=>{
    const question=askInput.value.trim();if(question.length<2){say('Scrivi una domanda prima di inviare.');return}
    askButton.disabled=true;answer.textContent='Lo chef sta pensando…';
    const context='Contesto Chef-AI: ricetta '+recipe.name+'. Porzioni '+servings+'. Passaggio '+(index+1)+'/'+steps.length+': '+steps[index].instruction+'. Ingredienti: '+(recipe.ingredients||[]).map(x=>x.name+' '+(x.quantity??'')+' '+(x.unit||'')).join(', ')+'. Rispondi in modo breve e riferito a questo contesto.';
    const messages=[{role:'user',content:context},...conversation.slice(-5),{role:'user',content:question}];
    try{
      const response=await fetch('/api/chef/ask',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({device_id:deviceId,messages})});
      const data=await response.json();if(!response.ok)throw Error(data.detail||'Domanda non disponibile.');
      answer.textContent=data.answer||'Non ho ricevuto una risposta.';conversation.push({role:'user',content:question},{role:'assistant',content:answer.textContent});askInput.value='';
    }catch(error){answer.textContent=error.message||'Errore durante la domanda.'}
    finally{askButton.disabled=false}
  };
  askBox.append(askInput,askButton,answer);
  result.append(area,nav,askBox);show();
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
$('#manual-btn').onclick=()=>{
  const name=$('#manual-name').value.trim();
  const servings=$('#manual-servings').value.trim();
  const cookingTime=$('#manual-cooking-time').value.trim();
  const ingredients=$('#manual-ingredients').value.trim();
  const preparation=$('#manual-preparation').value.trim();
  const equipment=$('#manual-equipment').value.trim();
  if(!name||!servings||!ingredients||!preparation||!equipment){
    say('Compila tutti e cinque i campi: nome, porzioni, ingredienti, preparazione e strumenti.');
    return;
  }
  const count=Number(servings);
  if(!Number.isInteger(count)||count<1||count>50){
    say('Inserisci un numero di porzioni valido, da 1 a 50.');
    return;
  }
  if(cookingTime&&(!Number.isInteger(Number(cookingTime))||Number(cookingTime)<0||Number(cookingTime)>1440)){
    say('Inserisci un tempo di cottura valido in minuti (da 0 a 1440), oppure lascia il campo vuoto.');
    return;
  }
  const text='Nome ricetta: '+name+'\\nPorzioni originali: '+count+(cookingTime?'\\nTempo di cottura: '+cookingTime+' minuti':'')+'\\nIngredienti:\\n'+ingredients+'\\nPreparazione:\\n'+preparation+'\\nStrumenti:\\n'+equipment;
  standardize({text});
};
$('#file-btn').onclick=()=>standardize({text:$('#file-text').value});
let documentParserPromise=null;
function loadDocumentParser(){
  if(window.docstream?.parseOffice)return Promise.resolve(window.docstream);
  if(!documentParserPromise){
    documentParserPromise=new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      script.src='https://cdn.jsdelivr.net/npm/@jose.espana/docstream@0.1.3/dist/officeparser.browser.js';
      script.onload=()=>window.docstream?.parseOffice?resolve(window.docstream):reject(Error('Lettore documenti non disponibile.'));
      script.onerror=()=>reject(Error('Non riesco a caricare il lettore documenti. Controlla la connessione e riprova.'));
      document.head.append(script);
    }).catch(error=>{documentParserPromise=null;throw error});
  }
  return documentParserPromise;
}
$('#recipe-file').onchange=async event=>{
  const file=event.target.files?.[0];if(!file)return;
  const extension=(file.name.split('.').pop()||'').toLowerCase();
  const supported=['pdf','doc','docx','xls','xlsx','txt','md'];
  if(!supported.includes(extension)){say('Formato non supportato. Scegli PDF, DOC, DOCX, XLS, XLSX, TXT o MD.');event.target.value='';return}
  if(file.size>5*1024*1024){say('Il file supera il limite di 5 MB.');event.target.value='';return}
  try{
    let extracted='';
    if(extension==='txt'||extension==='md'){
      extracted=await file.text();
    }else{
      say('Sto leggendo il documento nel browser…');
      const parser=await loadDocumentParser();
      const parsed=await parser.parseOffice(file,{newlineDelimiter:'\\n\\n',extractAttachments:false,ocr:false,outputErrorToConsole:false});
      extracted=typeof parsed.toText==='function'?parsed.toText():String(parsed.text||'');
    }
    extracted=String(extracted||'').trim();
    if(!extracted){throw Error('Non ho trovato testo leggibile nel file. Se è un PDF composto da immagini o scansioni, serve una versione con testo selezionabile.')}
    if(extracted.length>80000){throw Error('Il documento contiene troppo testo (oltre 80.000 caratteri). Carica una versione più breve, solo con la ricetta.')}
    $('#file-text').value=extracted;
    say('File letto correttamente ('+extension.toUpperCase()+'). Ho estratto '+extracted.length.toLocaleString('it-IT')+' caratteri. Ora puoi controllare la ricetta.');
  }catch(error){
    say(error.message||'Non sono riuscito a leggere il file. Prova a salvarlo in un altro formato.');
    event.target.value='';
  }
};
function servingsFromRequest(value){
  const text=String(value||'');
  const match=text.match(/(?:per|da|di)\s*(\d{1,2})\s*(?:persone|porzioni)\b|(\d{1,2})\s*(?:persone|porzioni)\b/i);
  const count=Number(match?.[1]||match?.[2]);
  return Number.isInteger(count)&&count>=1&&count<=50?count:null;
}
$('#ai-btn').onclick=()=>{
  const request=$('#ai-prompt').value;
  standardize({request,requested_servings:servingsFromRequest(request)});
};

function offerResume(){
  try{
    const saved=JSON.parse(localStorage.getItem(SESSION_KEY)||'null');
    if(!saved||!saved.recipe||!Number.isInteger(saved.servings)||!saved.recipe.steps?.length)return;
    const resume=node('button','↻ Riprendi la sessione salvata');
    resume.className='chefai-action';resume.type='button';
    resume.onclick=()=>startGuide(saved.recipe,saved.servings,Number(saved.step)||0);
    const notice=node('div');notice.className='chefai-status';notice.append(node('p','Hai una sessione Chef Guidato salvata su questo dispositivo.'));
    notice.append(resume);result.prepend(notice);
  }catch(_){}
}
offerResume();
