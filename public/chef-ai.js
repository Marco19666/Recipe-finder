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
  let index=Math.min(Math.max(0,startIndex),steps.length-1),timerInterval=null,timerRemaining=Number(steps[index].timer_seconds)||0,timerEndsAt=null,timerPaused=false,timerFinished=false,currentAudio=null;
  const conversation=[];
  const deviceKey='recipe-finder-device-id';
  let deviceId='';
  try{deviceId=localStorage.getItem(deviceKey)||'';if(!/^[A-Za-z0-9-]{16,100}$/.test(deviceId)){deviceId=(crypto.randomUUID?crypto.randomUUID():('chefai-'+Date.now()+'-'+Math.random().toString(36).slice(2)));localStorage.setItem(deviceKey,deviceId)}}catch(_){deviceId='chefai-'+Date.now()+'-'+Math.random().toString(36).slice(2)}
  function show(){
    if(timerInterval){clearInterval(timerInterval);timerInterval=null}
    const step=steps[index];timerRemaining=Number(step.timer_seconds)||0;timerEndsAt=null;timerPaused=false;timerFinished=false;area._chefTimer=null;area.replaceChildren(node('small','PASSAGGIO '+(index+1)+' DI '+steps.length),node('p',step.instruction));
    if(step.temperature_c!==null&&step.temperature_c!==undefined)area.append(node('p','Temperatura: '+step.temperature_c+' °C'+(step.cooking_mode?' · '+step.cooking_mode:'')));
    if(step.timer_seconds){
      const timerLabel=node('p','Timer: '+Math.ceil(step.timer_seconds/60)+' minuti');
      const timerDisplay=node('p');timerDisplay.setAttribute('aria-live','polite');
      const timerControls=node('div');
      const startTimerButton=node('button','Avvia timer'),pauseTimerButton=node('button','Pausa timer'),resumeTimerButton=node('button','Riprendi timer'),resetTimerButton=node('button','Spegni timer');
      [startTimerButton,pauseTimerButton,resumeTimerButton,resetTimerButton].forEach(button=>{button.className='chefai-action';button.type='button'});
      const formatTime=value=>Math.floor(Math.max(0,value)/60)+':'+String(Math.max(0,value)%60).padStart(2,'0');
      const updateTimerUI=()=>{
        timerDisplay.textContent=timerFinished?'⏱ Tempo terminato':timerRemaining<=0&&!timerInterval?'⏱ '+(timerPaused?'In pausa · 0:00':'Pronto · '+formatTime(Number(step.timer_seconds))):'⏱ '+formatTime(timerRemaining)+(timerPaused?' · in pausa':'');
        startTimerButton.disabled=!!timerInterval||timerPaused;
        pauseTimerButton.disabled=!timerInterval;
        resumeTimerButton.disabled=!timerPaused;
        resetTimerButton.disabled=(!timerInterval&&!timerPaused&&!timerFinished&&timerRemaining===(Number(step.timer_seconds)||0));
      };
      const finishTimer=()=>{
        if(timerInterval)clearInterval(timerInterval);
        timerInterval=null;timerRemaining=0;timerEndsAt=null;timerPaused=false;timerFinished=true;
        timerDisplay.textContent='⏱ Tempo terminato';
        updateTimerUI();
        if('vibrate'in navigator)navigator.vibrate?.([200,100,200]);
      };
      const tick=()=>{
        timerRemaining=Math.max(0,Math.ceil((timerEndsAt-Date.now())/1000));
        if(timerRemaining<=0){finishTimer();return}
        updateTimerUI();
      };
      const startTimer=()=>{
        if(timerInterval)return;
        if(timerRemaining<=0)timerRemaining=Number(step.timer_seconds)||0;
        if(!timerRemaining){say('Questo passaggio non prevede un timer.');return}
        timerPaused=false;timerFinished=false;timerEndsAt=Date.now()+timerRemaining*1000;
        timerInterval=setInterval(tick,250);tick();
      };
      const pauseTimer=()=>{
        if(!timerInterval)return;
        timerRemaining=Math.max(0,Math.ceil((timerEndsAt-Date.now())/1000));
        clearInterval(timerInterval);timerInterval=null;timerEndsAt=null;timerPaused=true;updateTimerUI();
      };
      const resumeTimer=()=>{
        if(!timerPaused)return;
        timerPaused=false;startTimer();
      };
      const resetTimer=()=>{
        if(timerInterval)clearInterval(timerInterval);
        timerInterval=null;timerEndsAt=null;timerRemaining=Number(step.timer_seconds)||0;timerPaused=false;timerFinished=false;updateTimerUI();
      };
      startTimerButton.onclick=startTimer;pauseTimerButton.onclick=pauseTimer;resumeTimerButton.onclick=resumeTimer;resetTimerButton.onclick=resetTimer;
      timerControls.append(startTimerButton,pauseTimerButton,resumeTimerButton,resetTimerButton);
      timerControls.style.display='flex';timerControls.style.flexWrap='wrap';timerControls.style.gap='8px';
      area.append(timerLabel,timerDisplay,timerControls);updateTimerUI();
      area._chefTimer={start:startTimer,pause:pauseTimer,resume:resumeTimer,reset:resetTimer};
    }
    back.disabled=index===0;next.textContent=index===steps.length-1?'Termina':'Avanti →';
    saveSession(recipe,servings,index);
  }
  back.onclick=()=>{index=Math.max(0,index-1);show()};
  next.onclick=()=>{if(index<steps.length-1){index++;show()}else{if(timerInterval)clearInterval(timerInterval);area.replaceChildren(node('h3','Complimenti, hai terminato!'));nav.hidden=true;try{localStorage.removeItem(SESSION_KEY)}catch(_){}}};
  const speechCache=new Map();
  let ttsContext=null,ttsSource=null;
  const stopTTS=()=>{if(ttsSource){try{ttsSource.stop()}catch(_){}ttsSource=null}if(currentAudio){currentAudio.pause();currentAudio.currentTime=0;currentAudio=null}};
  const speakText=async text=>{
    stopTTS();
    try{
      const AudioContextClass=window.AudioContext||window.webkitAudioContext;
      if(!AudioContextClass)throw Error('Questo browser non supporta la riproduzione audio avanzata.');
      if(!ttsContext)ttsContext=new AudioContextClass();
      const resumePromise=ttsContext.state==='suspended'?ttsContext.resume():Promise.resolve();
      let audioBuffer=speechCache.get(text);
      if(!audioBuffer){
        const response=await fetch('/api/chef-ai/speech',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text})});
        if(!response.ok){let detail='Servizio vocale non disponibile.';try{detail=(await response.json()).detail||detail}catch(_){}throw Error(detail)}
        const bytes=await response.arrayBuffer();if(!bytes.byteLength)throw Error('Il servizio vocale ha restituito un audio vuoto.');
        audioBuffer=await ttsContext.decodeAudioData(bytes.slice(0));speechCache.set(text,audioBuffer);
      }
      await resumePromise;
      if(ttsContext.state!=='running')throw Error('Il browser ha bloccato l’audio. Tocca nuovamente Leggi.');
      ttsSource=ttsContext.createBufferSource();ttsSource.buffer=audioBuffer;ttsSource.connect(ttsContext.destination);ttsSource.onended=()=>{ttsSource=null};ttsSource.start(0);
    }catch(error){console.warn('Chef-AI neural TTS:',error);say('Non riesco ad avviare la voce naturale: '+(error.message||'errore audio')+'. Tocca di nuovo “Leggi” e verifica che il dispositivo non sia in modalità silenziosa.')}
  };
  read.onclick=()=>speakText(steps[index].instruction);
  const readAll=node('button','📖 Leggi ricetta');readAll.className='chefai-action';readAll.type='button';
  readAll.onclick=()=>{
    const fullText=[recipe.name||'Ricetta','Porzioni: '+servings,'Ingredienti:',...(recipe.ingredients||[]).map(item=>item.name+', '+(item.quantity??'quantità non indicata')+' '+(item.unit||'')),'Attrezzatura:',...(recipe.equipment||[]),'Procedimento:',...steps.map((step,i)=>'Passaggio '+(i+1)+'. '+step.instruction)].join('. ');
    speakText(fullText);
  };
  nav.append(back,next,read,readAll);
  const voiceButton=node('button','🎙 Comandi vocali');voiceButton.className='chefai-action';voiceButton.type='button';
  const SpeechRecognition=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(SpeechRecognition){
    voiceButton.onclick=()=>{
      const recognition=new SpeechRecognition();recognition.lang='it-IT';recognition.interimResults=false;recognition.maxAlternatives=1;
      voiceButton.disabled=true;voiceButton.textContent='Ascolto…';
      recognition.onresult=event=>{
        const command=event.results[0][0].transcript.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[.,!?;:]/g,' ').replace(/\s+/g,' ').trim();
        if(/\b(indietro|precedente|passaggio precedente)\b/.test(command))back.click();
        else if(/\b(avanti|successivo|prossimo|passaggio successivo)\b/.test(command))next.click();
        else if(/\b(spegni|azzera|resetta|annulla)\b.{0,24}\btimer\b|\btimer\b.{0,24}\b(spegni|azzera|resetta|annulla)\b/.test(command)){if(area._chefTimer)area._chefTimer.reset();else say('Questo passaggio non prevede un timer.')}
        else if(/\b(stop|pausa|ferma|metti in pausa)\b.{0,24}\btimer\b|\btimer\b.{0,24}\b(stop|pausa|ferma)\b/.test(command)){if(area._chefTimer)area._chefTimer.pause();else say('Questo passaggio non prevede un timer.')}
        else if(/\b(riprendi|continua|riavvia)\b.{0,24}\btimer\b|\btimer\b.{0,24}\b(riprendi|continua)\b/.test(command)){if(area._chefTimer)area._chefTimer.resume();else say('Questo passaggio non prevede un timer.')}
        else if(/\b(avvia|inizia|attiva|fai partire|parti con)\b.{0,24}\btimer\b|\b(timer)\b.{0,24}\b(avvia|inizia|attiva)\b/.test(command)){if(area._chefTimer)area._chefTimer.start();else say('Questo passaggio non prevede un timer.')}
        else if(/\b(leggi ricetta|leggi tutto|tutta la ricetta|leggimi la ricetta|leggi l'intera ricetta)\b/.test(command))readAll.click();
        else if(/\b(ripeti|rileggi)\b/.test(command))read.click();
        else say('Comando non riconosciuto. Prova: avanti, indietro, avvia timer, pausa timer, riprendi timer, spegni timer, leggi ricetta.');
      };
      recognition.onerror=()=>say('Non sono riuscito a riconoscere il comando vocale.');
      recognition.onend=()=>{voiceButton.disabled=false;voiceButton.textContent='🎙 Comandi vocali'};
      recognition.start();
    };
    nav.append(voiceButton,node('p','Comandi: avanti, indietro, avvia timer, pausa timer, riprendi timer, spegni timer (azzera), leggi ricetta, ripeti.'));
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
  const getParser=()=>{
    const candidates=[window.officeParser,window.docstream,window.officeparser];
    return candidates.find(parser=>parser&&typeof parser.parseOffice==='function')||null;
  };
  const existing=getParser();
  if(existing)return Promise.resolve(existing);
  if(!documentParserPromise){
    documentParserPromise=new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      script.src='https://cdn.jsdelivr.net/npm/@jose.espana/docstream@0.1.3/dist/officeparser.browser.js';
      script.onload=()=>{
        const parser=getParser();
        if(parser)resolve(parser);
        else reject(Error('Il file del lettore è stato scaricato, ma non espone la funzione di lettura prevista. Ricarica la pagina e riprova.'));
      };
      script.onerror=()=>reject(Error('Non riesco a scaricare il lettore PDF/Office. Controlla la connessione e riprova.'));
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
  $('#file-text').value='';
  try{
    let extracted='';
    if(extension==='txt'||extension==='md'){
      say('Sto leggendo il file di testo…');
      extracted=await file.text();
    }else{
      say('Sto aprendo '+file.name+' ('+(file.size/1024).toFixed(0)+' KB)…');
      const parser=await loadDocumentParser();
      const config={newlineDelimiter:'\\n\\n',extractAttachments:false,ocr:false,outputErrorToConsole:true};
      if(extension==='pdf')config.pdfWorkerSrc='https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.530/build/pdf.worker.min.mjs';
      const fileBuffer=await file.arrayBuffer();
      const parsed=await parser.parseOffice(fileBuffer,config);
      if(parsed&&typeof parsed.toText==='function')extracted=parsed.toText();
      else if(parsed&&Array.isArray(parsed.content)){
        const collect=nodes=>(nodes||[]).map(n=>[n.text||'',collect(n.children)].filter(Boolean).join(' ')).join('\\n');
        extracted=collect(parsed.content);
      }else extracted=String(parsed?.text||'');
    }
    extracted=String(extracted||'').trim();
    if(!extracted)throw Error('Il file è stato aperto, ma non contiene testo estraibile. Se il PDF è una scansione o una foto, occorre prima applicare l’OCR oppure usare un PDF con testo selezionabile.');
    if(extracted.length>80000)throw Error('Il documento contiene troppo testo (oltre 80.000 caratteri). Carica una versione più breve, solo con la ricetta.');
    $('#file-text').value=extracted;
    say('✓ '+file.name+' caricato: estratti '+extracted.length.toLocaleString('it-IT')+' caratteri. Il testo è visibile nel riquadro qui sotto; premi “Controlla la ricetta” per continuare.');
  }catch(error){
    console.error('Chef-AI file import error:',error);
    say('Non sono riuscito a leggere '+file.name+'. '+(error?.message||'Errore sconosciuto.')+' Puoi provare a salvarlo come PDF testuale o DOCX.');
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
