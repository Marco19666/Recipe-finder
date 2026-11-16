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
  const panel=node('div');
  const hasKnownOriginal=Number(recipe.servings?.original)>0;
  if(!hasKnownOriginal){
    panel.append(node('p','La ricetta non specifica le porzioni di partenza. Per ricalibrare correttamente le dosi, indica quante porzioni produce la ricetta originale e quante ne vuoi preparare.'));
  }else{
    panel.append(node('h3',presetServings?'Hai indicato '+presetServings+' porzioni nella richiesta':'Quante porzioni vuoi preparare?'));
  }
  let originalInput=null;
  if(!hasKnownOriginal){
    const originalLabel=node('label','Porzioni della ricetta originale');
    originalInput=node('input');originalInput.type='number';originalInput.min='1';originalInput.max='50';originalInput.step='1';originalInput.inputMode='numeric';originalInput.placeholder='Es. 4';originalInput.setAttribute('aria-label','Porzioni della ricetta originale');
    panel.append(originalLabel,originalInput);
  }
  const targetLabel=node('label','Porzioni che vuoi preparare');
  const input=node('input');input.type='number';input.min='1';input.max='50';input.step='1';input.inputMode='numeric';input.value=presetServings||(hasKnownOriginal?recipe.servings.original:'');input.placeholder='Es. 2';input.setAttribute('aria-label','Numero di porzioni desiderate');
  panel.append(targetLabel,input);
  const go=node('button','Conferma porzioni e avvia Chef Guidato');go.className='chefai-action';
  go.onclick=()=>{
    const servings=Number(input.value);
    const original=hasKnownOriginal?Number(recipe.servings.original):Number(originalInput?.value);
    if(!Number.isInteger(original)||original<1||original>50){say('Indica quante porzioni produce la ricetta originale: senza questo dato non posso ricalcolare le dosi.');return}
    if(!Number.isInteger(servings)||servings<1||servings>50){say('Inserisci un numero di porzioni desiderato valido, da 1 a 50.');return}
    const scaled=structuredClone(recipe);
    const factor=servings/original;
    scaled.ingredients=(scaled.ingredients||[]).map(item=>{
      if(item.scaling==='linear'&&typeof item.quantity==='number')return {...item,quantity:Math.round(item.quantity*factor*1000)/1000};
      return {...item};
    });
    scaled.servings={...scaled.servings,original,requested:servings,confirmed:true};
    saveSession(scaled,servings,0);
    startGuide(scaled,servings,0);
  };
  result.append(panel,go);
}
function startGuide(recipe,servings,startIndex=0){
  const steps=Array.isArray(recipe.steps)?recipe.steps:[];
  if(!steps.length){say('Questa ricetta non contiene passaggi da seguire.');return}
  result.replaceChildren(node('h2','Chef Guidato'));
  result.append(node('p','Porzioni: '+servings+'. Le quantità numeriche lineari sono state ricalcolate in base alle porzioni; quantità vaghe o non scalabili restano invariate. Tempi e temperature non vengono moltiplicati.'));
  const area=node('div'),nav=node('div');area.className='chefai-step';nav.className='chefai-nav';
  let screenWakeLock=null,screenWakeVisibilityHandler=null;
  const screenWakeStatus=node('p');
  screenWakeStatus.className='chefai-wake-status';
  screenWakeStatus.setAttribute('aria-live','polite');
  const releaseScreenWakeLock=async()=>{
    if(screenWakeLock){try{await screenWakeLock.release()}catch(_){}screenWakeLock=null}
  };
  const requestScreenWakeLock=async()=>{
    if(!('wakeLock'in navigator)){
      screenWakeStatus.textContent='Schermo sempre acceso non supportato da questo browser: mantieni aperta la pagina e disattiva temporaneamente il blocco schermo.';
      return;
    }
    if(document.visibilityState!=='visible')return;
    try{
      if(screenWakeLock&&!screenWakeLock.released)return;
      screenWakeLock=await navigator.wakeLock.request('screen');
      screenWakeStatus.textContent='☀️ Schermo sempre acceso durante Chef Guidato.';
      screenWakeLock.addEventListener('release',()=>{
        screenWakeLock=null;
        if(document.visibilityState==='visible')screenWakeStatus.textContent='Schermo non bloccato dal Chef-AI. Riprovo ad attivarlo…';
      },{once:true});
    }catch(error){
      screenWakeStatus.textContent='Non posso impedire lo spegnimento dello schermo: controlla i permessi e le impostazioni di risparmio energetico.';
    }
  };
  screenWakeVisibilityHandler=()=>{
    if(document.visibilityState==='visible')requestScreenWakeLock();
    else releaseScreenWakeLock();
  };
  document.addEventListener('visibilitychange',screenWakeVisibilityHandler);
  requestScreenWakeLock();

  const back=node('button','← Indietro'),next=node('button','Avanti →'),read=node('button','▶ Leggi passaggio');
  back.className='chefai-player-button chefai-player-secondary';next.className='chefai-player-button chefai-player-primary';read.className='chefai-player-button chefai-player-play';
  [back,next,read].forEach(button=>{button.type='button'});
  let index=Math.min(Math.max(0,startIndex),steps.length-1),timerInterval=null,timerRemaining=Number(steps[index].timer_seconds)||0,timerEndsAt=null,timerPaused=false,timerFinished=false,currentAudio=null;
  let timerAlarmInterval=null,timerAlarmTimeout=null,timerAlarmContext=null;
  const conversation=[];
  const deviceKey='recipe-finder-device-id';
  let deviceId='';
  try{deviceId=localStorage.getItem(deviceKey)||'';if(!/^[A-Za-z0-9-]{16,100}$/.test(deviceId)){deviceId=(crypto.randomUUID?crypto.randomUUID():('chefai-'+Date.now()+'-'+Math.random().toString(36).slice(2)));localStorage.setItem(deviceKey,deviceId)}}catch(_){deviceId='chefai-'+Date.now()+'-'+Math.random().toString(36).slice(2)}
  function show(){
    if(area._chefTimer?.stopAlarm)area._chefTimer.stopAlarm();
    if(timerInterval){clearInterval(timerInterval);timerInterval=null}
    const step=steps[index];timerRemaining=Number(step.timer_seconds)||0;timerEndsAt=null;timerPaused=false;timerFinished=false;area._chefTimer=null;area.replaceChildren(node('small','PASSAGGIO '+(index+1)+' DI '+steps.length),node('p',step.instruction));
    if(step.temperature_c!==null&&step.temperature_c!==undefined)area.append(node('p','Temperatura: '+step.temperature_c+' °C'+(step.cooking_mode?' · '+step.cooking_mode:'')));
    if(step.timer_seconds){
      const timerPanel=node('section');timerPanel.className='chefai-timer-panel';
      const timerLabel=node('p','TIMER · '+Math.ceil(step.timer_seconds/60)+' MIN');timerLabel.className='chefai-timer-label';
      const timerDisplay=node('p');timerDisplay.className='chefai-timer-display';timerDisplay.setAttribute('aria-live','polite');
      const timerControls=node('div');timerControls.className='chefai-timer-controls';
      const startTimerButton=node('button','▶ Avvia'),pauseTimerButton=node('button','Ⅱ Pausa'),resumeTimerButton=node('button','▶ Riprendi'),resetTimerButton=node('button','↺ Azzera'),stopAlarmButton=node('button','🔕 Ferma allarme');
      [startTimerButton,pauseTimerButton,resumeTimerButton,resetTimerButton].forEach(button=>{button.className='chefai-player-button chefai-player-secondary';button.type='button'});
      stopAlarmButton.className='chefai-player-button chefai-player-alarm';stopAlarmButton.type='button';
      stopAlarmButton.hidden=true;
      const formatTime=value=>Math.floor(Math.max(0,value)/60)+':'+String(Math.max(0,value)%60).padStart(2,'0');
      const updateTimerUI=()=>{
        timerDisplay.textContent=timerFinished?'⏱ Tempo terminato':timerRemaining<=0&&!timerInterval?'⏱ '+(timerPaused?'In pausa · 0:00':'Pronto · '+formatTime(Number(step.timer_seconds))):'⏱ '+formatTime(timerRemaining)+(timerPaused?' · in pausa':'');
        startTimerButton.disabled=!!timerInterval||timerPaused;
        pauseTimerButton.disabled=!timerInterval;
        resumeTimerButton.disabled=!timerPaused;
        resetTimerButton.disabled=(!timerInterval&&!timerPaused&&!timerFinished&&timerRemaining===(Number(step.timer_seconds)||0));
      };
      const stopTimerAlarm=()=>{
        if(timerAlarmInterval){clearInterval(timerAlarmInterval);timerAlarmInterval=null;}
        if(timerAlarmTimeout){clearTimeout(timerAlarmTimeout);timerAlarmTimeout=null;}
        stopAlarmButton.hidden=true;
        if('vibrate'in navigator)navigator.vibrate?.(0);
      };
      const soundTimerAlarm=()=>{
        stopTimerAlarm();
        stopAlarmButton.hidden=false;
        const chime=()=>{
          try{
            if(!timerAlarmContext||timerAlarmContext.state!=='running')return;
            const now=timerAlarmContext.currentTime;
            [[659.25,0],[783.99,0.24]].forEach(([frequency,offset])=>{
              const oscillator=timerAlarmContext.createOscillator(),gain=timerAlarmContext.createGain();
              oscillator.type='sine';oscillator.frequency.setValueAtTime(frequency,now+offset);
              gain.gain.setValueAtTime(0.0001,now+offset);
              gain.gain.exponentialRampToValueAtTime(0.075,now+offset+0.035);
              gain.gain.exponentialRampToValueAtTime(0.0001,now+offset+0.48);
              oscillator.connect(gain);gain.connect(timerAlarmContext.destination);
              oscillator.start(now+offset);oscillator.stop(now+offset+0.5);
            });
          }catch(error){console.warn('Chef-AI timer alarm:',error)}
        };
        chime();
        timerAlarmInterval=setInterval(chime,3000);
        timerAlarmTimeout=setTimeout(()=>{
          stopTimerAlarm();
          say('Allarme terminato automaticamente dopo due minuti.');
        },120000);
        if('vibrate'in navigator)navigator.vibrate?.([180,120,180]);
      };
      const finishTimer=()=>{
        if(timerInterval)clearInterval(timerInterval);
        timerInterval=null;timerRemaining=0;timerEndsAt=null;timerPaused=false;timerFinished=true;
        timerDisplay.textContent='⏰ Tempo terminato: allarme attivo';
        updateTimerUI();soundTimerAlarm();say('Timer scaduto: allarme sonoro attivo. Premi “Ferma allarme” per interromperlo.');
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
        const AudioContextClass=window.AudioContext||window.webkitAudioContext;
        if(AudioContextClass){try{if(!timerAlarmContext)timerAlarmContext=new AudioContextClass();if(timerAlarmContext.state==='suspended')timerAlarmContext.resume()}catch(_){}}
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
        stopTimerAlarm();
        if(timerInterval)clearInterval(timerInterval);
        timerInterval=null;timerEndsAt=null;timerRemaining=Number(step.timer_seconds)||0;timerPaused=false;timerFinished=false;updateTimerUI();
      };
      startTimerButton.onclick=startTimer;pauseTimerButton.onclick=pauseTimer;resumeTimerButton.onclick=resumeTimer;resetTimerButton.onclick=resetTimer;stopAlarmButton.onclick=()=>{stopTimerAlarm();say('Allarme del timer interrotto.');};
      timerControls.append(startTimerButton,pauseTimerButton,resumeTimerButton,resetTimerButton,stopAlarmButton);
      timerControls.style.display='flex';timerControls.style.flexWrap='wrap';timerControls.style.gap='8px';
      timerPanel.append(timerLabel,timerDisplay,timerControls);area.append(timerPanel);updateTimerUI();
      area._chefTimer={start:startTimer,pause:pauseTimer,resume:resumeTimer,reset:resetTimer,stopAlarm:stopTimerAlarm};
    }
    back.disabled=index===0;next.textContent=index===steps.length-1?'Termina':'Avanti →';
    saveSession(recipe,servings,index);
  }
  back.onclick=()=>{index=Math.max(0,index-1);show()};
  next.onclick=()=>{if(index<steps.length-1){index++;show()}else{if(timerInterval)clearInterval(timerInterval);if(screenWakeVisibilityHandler)document.removeEventListener('visibilitychange',screenWakeVisibilityHandler);releaseScreenWakeLock();area.replaceChildren(node('h3','Complimenti, hai terminato!'));nav.hidden=true;try{localStorage.removeItem(SESSION_KEY)}catch(_){}}};
  const speechCache=new Map();
  let ttsContext=null,ttsSource=null,ttsRequestController=null,ttsPlaybackId=0;
  const stopTTS=()=>{
    ttsPlaybackId++;
    if(ttsRequestController){try{ttsRequestController.abort()}catch(_){}ttsRequestController=null}
    if(ttsSource){try{ttsSource.stop()}catch(_){}ttsSource=null}
    if(currentAudio){currentAudio.pause();currentAudio.currentTime=0;currentAudio=null}
    if('speechSynthesis' in window)window.speechSynthesis.cancel();
  };
  function expandCookingAbbreviations(value){
    return String(value||'')
      .replace(/\bq\s*\.?\s*b\.?\b/gi,'quanto basta')
      .replace(/\bq\.?\s*b\.?/gi,'quanto basta')
      .replace(/\bpz\.?(?!\w)/gi,'porzioni')
      .replace(/\bporz\.?(?!\w)/gi,'porzioni')
      .replace(/\bgr\.?(?!\w)/gi,'grammi')
      .replace(/\bn\s*\.?\s*(?=\d)/gi,'numero ')
      .replace(/(\d)\s*g\b/gi,'$1 grammi')
      .replace(/\bkg\.?(?!\w)/gi,'chilogrammi')
      .replace(/\bmg\.?(?!\w)/gi,'milligrammi')
      .replace(/\bml\.?(?!\w)/gi,'millilitri')
      .replace(/\bcl\.?(?!\w)/gi,'centilitri')
      .replace(/(\d)\s*l\b/gi,'$1 litri')
      .replace(/\bcucch(?:\.\s*|\s*)no\.?\b/gi,'cucchiaino')
      .replace(/\bcucch(?:\.\s*|\s*)\.?\b/gi,'cucchiaio')
      .replace(/\bmin\.?(?!\w)/gi,'minuti')
      .replace(/\bsec\.?(?!\w)/gi,'secondi')
      .replace(/\bore\.?\b/gi,'ore')
      .replace(/\bquantit[aà]\s+non\s+(?:stabilita|specificata|indicata)\b/gi,'')
      .replace(/\bquantit[aà]\s+da\s+definire\b/gi,'')
      .replace(/\b(?:dose|quantit[aà])\s+non\s+definita\b/gi,'')
      .replace(/°\s*C\b/gi,'gradi Celsius')
      .replace(/\b(?:forno\s*)?(ventilato)\b/gi,'ventilato');
  }
  const speakText=async (text,onComplete)=>{
    text=expandCookingAbbreviations(text);
    stopTTS();
    const playbackId=ttsPlaybackId;
    say('Sto preparando la voce…');
    try{
      const AudioContextClass=window.AudioContext||window.webkitAudioContext;
      if(!AudioContextClass)throw Error('AudioContext non supportato');
      if(!ttsContext)ttsContext=new AudioContextClass();
      const resumePromise=ttsContext.state==='suspended'?ttsContext.resume():Promise.resolve();
      let audioBuffer=speechCache.get(text);
      if(!audioBuffer){
        const controller=new AbortController();ttsRequestController=controller;
        const timeout=setTimeout(()=>controller.abort(),40000);
        let response;
        try{response=await fetch('/api/chef-ai/speech',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text}),signal:controller.signal})}
        finally{clearTimeout(timeout);if(ttsRequestController===controller)ttsRequestController=null}
        if(playbackId!==ttsPlaybackId)return;
        if(!response.ok){let detail='Servizio vocale non disponibile (HTTP '+response.status+').';try{detail=(await response.json()).detail||detail}catch(_){}throw Error(detail)}
        const bytes=await response.arrayBuffer();if(!bytes.byteLength)throw Error('Audio vuoto');
        audioBuffer=await ttsContext.decodeAudioData(bytes.slice(0));speechCache.set(text,audioBuffer);
      }
      await resumePromise;
      if(playbackId!==ttsPlaybackId)return;
      if(ttsContext.state!=='running')throw Error('AudioContext non attivo');
      ttsSource=ttsContext.createBufferSource();ttsSource.buffer=audioBuffer;ttsSource.connect(ttsContext.destination);ttsSource.onended=()=>{ttsSource=null;if(typeof onComplete==='function')onComplete()};ttsSource.start(0);
      say('Riproduzione della voce naturale in corso.');
    }catch(error){
      if(playbackId!==ttsPlaybackId)return;
      console.warn('Chef-AI neural TTS:',error);
      try{
        if(!('speechSynthesis' in window)||!window.SpeechSynthesisUtterance)throw Error('Sintesi vocale del dispositivo non supportata.');
        window.speechSynthesis.cancel();
        const utterance=new SpeechSynthesisUtterance(text);utterance.lang='it-IT';utterance.rate=0.96;utterance.pitch=1;
        const voices=window.speechSynthesis.getVoices();const italian=voices.find(v=>/^it(-|_)/i.test(v.lang));if(italian)utterance.voice=italian;
        utterance.onstart=()=>say('Lettura in corso con la voce italiana del dispositivo.');
        utterance.onend=()=>{if(typeof onComplete==='function')onComplete()};
        utterance.onerror=event=>{say('La voce del dispositivo non è partita ('+(event.error||'errore audio')+'). Controlla volume e impostazioni audio.');if(typeof onComplete==='function')onComplete()};
        window.speechSynthesis.speak(utterance);
        say('Voce naturale non disponibile: provo la voce italiana del dispositivo…');
      }catch(fallbackError){say('Audio non disponibile: '+(fallbackError.message||error.message||'errore sconosciuto'))}
    }
  };
  read.onclick=()=>speakText(steps[index].instruction);
  const readAll=node('button','▤ Leggi ricetta');readAll.className='chefai-player-button chefai-player-secondary';readAll.type='button';
  readAll.onclick=()=>{
    const fullText=[recipe.name||'Ricetta','Porzioni: '+servings,'Ingredienti:',...(recipe.ingredients||[]).map(item=>[item.name,item.quantity!==null&&item.quantity!==undefined?item.quantity:null,item.unit||null].filter(value=>value!==null&&value!=='').join(', ')),'Attrezzatura:',...(recipe.equipment||[]),'Procedimento:',...steps.map((step,i)=>'Passaggio '+(i+1)+'. '+step.instruction)].join('. ');
    speakText(fullText);
  };
  const stopRead=node('button','■ Interrompi');stopRead.className='chefai-player-button chefai-player-stop';stopRead.type='button';
  stopRead.onclick=()=>{stopTTS();say('Lettura interrotta.');};
  nav.classList.add('chefai-player');
  const navigationControls=node('div');navigationControls.className='chefai-player-navigation';navigationControls.append(back,next);
  const audioControls=node('div');audioControls.className='chefai-player-audio';audioControls.append(read,readAll,stopRead);
  nav.append(navigationControls,audioControls);
  const voiceButton=node('button','🎙 Parla con Chef-AI');
  voiceButton.className='chefai-player-button chefai-player-voice';voiceButton.type='button';
  const SpeechRecognition=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(SpeechRecognition){
    let wakeRecognition=null,wakeActive=false,wakeRestartTimer=null,voiceTurnHandled=false,voiceError=null;
    const normalizeVoiceCommand=value=>String(value||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[.,!?;:]/g,' ').replace(/\s+/g,' ').trim();
    const executeVoiceCommand=(command,onComplete)=>{
      const done=()=>{if(typeof onComplete==='function')onComplete()};
      if(/\b(stop lettura|interrompi lettura|ferma lettura|basta leggere|zitto)\b/.test(command)){stopTTS();speakText('Lettura interrotta.',done);return true}
      if(/\b(stop allarme|ferma allarme|spegni allarme|interrompi allarme)\b/.test(command)){if(area._chefTimer)area._chefTimer.stopAlarm();speakText('Allarme del timer interrotto.',done);return true}
      if(/\b(indietro|precedente|passaggio precedente)\b/.test(command)){back.click();speakText(steps[index].instruction,done);return true}
      if(/\b(avanti|successivo|prossimo|passaggio successivo)\b/.test(command)){next.click();if(area.contains(nav)&&steps[index])speakText(steps[index].instruction,done);else speakText('Hai terminato la ricetta.',done);return true}
      if(/\b(spegni|azzera|resetta|annulla)\b.{0,24}\btimer\b|\btimer\b.{0,24}\b(spegni|azzera|resetta|annulla)\b/.test(command)){if(area._chefTimer)area._chefTimer.reset();speakText(area._chefTimer?'Timer azzerato.':'Questo passaggio non prevede un timer.',done);return true}
      if(/\b(stop|pausa|ferma|metti in pausa)\b.{0,24}\btimer\b|\btimer\b.{0,24}\b(stop|pausa|ferma)\b/.test(command)){if(area._chefTimer)area._chefTimer.pause();speakText(area._chefTimer?'Timer in pausa.':'Questo passaggio non prevede un timer.',done);return true}
      if(/\b(riprendi|continua|riavvia)\b.{0,24}\btimer\b|\btimer\b.{0,24}\b(riprendi|continua)\b/.test(command)){if(area._chefTimer)area._chefTimer.resume();speakText(area._chefTimer?'Timer ripreso.':'Questo passaggio non prevede un timer.',done);return true}
      if(/\b(avvia|inizia|attiva|fai partire|parti con)\b.{0,24}\btimer\b|\btimer\b.{0,24}\b(avvia|inizia|attiva)\b/.test(command)){if(area._chefTimer)area._chefTimer.start();speakText(area._chefTimer?'Timer avviato.':'Questo passaggio non prevede un timer.',done);return true}
      if(/\b(leggi ricetta|leggi tutto|tutta la ricetta|leggimi la ricetta|leggi l intera ricetta)\b/.test(command)){const fullText=[recipe.name||'Ricetta','Porzioni: '+servings,'Ingredienti:',...(recipe.ingredients||[]).map(item=>[item.name,item.quantity!==null&&item.quantity!==undefined?item.quantity:null,item.unit||null].filter(value=>value!==null&&value!=='').join(', ')),'Attrezzatura:',...(recipe.equipment||[]),'Procedimento:',...steps.map((step,i)=>'Passaggio '+(i+1)+'. '+step.instruction)].join('. ');speakText(fullText,done);return true}
      if(/\b(leggi passaggio|leggi il passaggio|leggi questo passaggio|leggimi il passaggio|leggi il passo)\b/.test(command)){speakText(steps[index].instruction,done);return true}
      if(/\b(termina|fine|concludi|ho finito|termina guida|chiudi guida)\b/.test(command)){next.click();speakText('Guida terminata.',done);return true}
      if(/\b(ripeti|rileggi)\b/.test(command)){speakText(steps[index].instruction,done);return true}
      return false;
    };
    const handleRecognizedCommand=command=>{
      const known=/\b(stop lettura|interrompi lettura|ferma lettura|basta leggere|zitto|stop allarme|ferma allarme|spegni allarme|interrompi allarme|indietro|precedente|passaggio precedente|avanti|successivo|prossimo|passaggio successivo|spegni timer|azzera timer|resetta timer|annulla timer|pausa timer|ferma timer|stop timer|metti in pausa timer|riprendi timer|continua timer|riavvia timer|avvia timer|inizia timer|attiva timer|fai partire timer|parti con timer|leggi ricetta|leggi tutto|tutta la ricetta|leggimi la ricetta|leggi l intera ricetta|leggi passaggio|leggi il passaggio|leggi questo passaggio|leggimi il passaggio|leggi il passo|termina|fine|concludi|ho finito|termina guida|chiudi guida|ripeti|rileggi)\b/.test(command);
      if(!known){speakText('Puoi ripetere?',()=>{if(wakeActive)startVoiceTurn()});return}
      speakText('Ho capito.',()=>{
        executeVoiceCommand(command,()=>{if(wakeActive)promptAndListen()});
      });
    };
    const stopWakeListening=(message)=>{
      wakeActive=false;voiceTurnHandled=false;
      if(wakeRestartTimer)clearTimeout(wakeRestartTimer);
      wakeRestartTimer=null;
      if(wakeRecognition){try{wakeRecognition.abort()}catch(_){}wakeRecognition=null}
      if('speechSynthesis'in window)window.speechSynthesis.cancel();
      voiceButton.textContent='🎙 Parla con Chef-AI';voiceButton.setAttribute('aria-pressed','false');
      if(message)say(message);
    };
    const startVoiceTurn=()=>{
      if(!wakeActive||document.visibilityState!=='visible')return;
      try{
        wakeRecognition=new SpeechRecognition();
        voiceTurnHandled=false;voiceError=null;
        wakeRecognition.lang='it-IT';wakeRecognition.continuous=false;wakeRecognition.interimResults=false;wakeRecognition.maxAlternatives=3;
        wakeRecognition.onresult=event=>{
          for(let i=event.resultIndex||0;i<event.results.length;i++){
            const result=event.results[i];
            if(!result?.isFinal)continue;
            const alternatives=Array.from(result).map(item=>normalizeVoiceCommand(item.transcript)).filter(Boolean);
            const known=alternatives.find(value=>/\b(avanti|indietro|precedente|successivo|prossimo|termina|fine|concludi|leggi|ricetta|passaggio|timer|ripeti|interrompi|ferma|spegni|pausa|riprendi|avvia|inizia|attiva)\b/.test(value));
            const command=known||alternatives.sort((a,b)=>b.length-a.length)[0]||'';
            if(!command||voiceTurnHandled)continue;
            voiceTurnHandled=true;
            handleRecognizedCommand(command);
          }
        };
        wakeRecognition.onerror=event=>{
          voiceError=event.error||'unknown';
          if(voiceError==='not-allowed'||voiceError==='service-not-allowed'){
            stopWakeListening('Permesso microfono negato. Abilita il microfono nelle impostazioni del browser e riprova.');
          }else if(voiceError==='audio-capture'){
            stopWakeListening('Non trovo un microfono disponibile. Controlla il microfono del dispositivo.');
          }else if(voiceError==='network'){
            stopWakeListening('Il servizio di riconoscimento vocale non è raggiungibile. Controlla la connessione.');
          }
        };
        wakeRecognition.onend=()=>{
          wakeRecognition=null;
          if(!wakeActive||document.visibilityState!=='visible')return;
          if(voiceTurnHandled){
            return;
          }else{
            stopWakeListening(voiceError==='no-speech'?'Non ho sentito la tua voce. Tocca “Parla con Chef-AI” per riprovare, parlando subito dopo “Dimmi”.':'Non ho ricevuto un comando. Tocca “Parla con Chef-AI” e riprova.');
          }
        };
        wakeRecognition.start();
        voiceButton.textContent='🟢 Ti ascolto…';
        say('Microfono attivo: pronuncia un comando.');
      }catch(error){
        stopWakeListening('Non riesco ad attivare il microfono. Verifica il permesso del browser e riprova.');
      }
    };
    const promptAndListen=()=>{
      if(!wakeActive||document.visibilityState!=='visible')return;
      if('speechSynthesis'in window&&'SpeechSynthesisUtterance'in window){
        try{
          window.speechSynthesis.cancel();
          const prompt=new SpeechSynthesisUtterance('Dimmi');
          prompt.lang='it-IT';prompt.rate=1;
          prompt.onend=()=>startVoiceTurn();
          prompt.onerror=()=>startVoiceTurn();
          voiceButton.textContent='🔊 Chef-AI: Dimmi';
          say('Chef-AI sta per ascoltarti…');
          window.speechSynthesis.speak(prompt);
          return;
        }catch(_){}
      }
      startVoiceTurn();
    };
    voiceButton.onclick=()=>{
      if(wakeActive){stopWakeListening('Ascolto vocale disattivato.');return}
      wakeActive=true;
      voiceButton.textContent='🔊 Chef-AI: Dimmi';
      voiceButton.setAttribute('aria-pressed','true');
      promptAndListen();
    };
    document.addEventListener('visibilitychange',()=>{
      if(!wakeActive)return;
      if(document.visibilityState==='hidden'){
        if(wakeRecognition){try{wakeRecognition.abort()}catch(_){}wakeRecognition=null}
        if(wakeRestartTimer)clearTimeout(wakeRestartTimer);
      }else if(!wakeRecognition)promptAndListen();
    });
    nav.append(voiceButton,node('p','Tocca “Parla con Chef-AI”: sentirai “Dimmi” e il microfono si attiverà. Dopo un comando riconosciuto Chef-AI tornerà ad ascoltarti. Se non rileva la voce, ti avviserà senza ripetere “Dimmi” all’infinito. Esempi: avanti, indietro, avvia timer, pausa timer, riprendi timer, stop allarme, leggi ricetta, ripeti, interrompi lettura.'));
  }else{
    voiceButton.disabled=true;voiceButton.textContent='Riconoscimento vocale non supportato';
    nav.append(voiceButton,node('p','Il browser non supporta il riconoscimento vocale. Puoi usare i pulsanti sullo schermo.'));
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
  result.append(screenWakeStatus,area,nav,askBox);show();
}
$('#search-btn').onclick=async()=>{
  const query=$('#search-q').value.trim();if(query.length<2){say('Scrivi almeno due caratteri.');return}
  say('Cerco ricette…');
  try{
    const response=await fetch('/api/search?q='+encodeURIComponent(query));
    const body=await response.text();
    let data={};
    try{data=body?JSON.parse(body):{}}catch(_){
      throw Error('Il servizio di ricerca ha restituito una risposta non valida. Riprova tra poco.');
    }
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
  const getParser=()=>[window.docstream,window.officeParser,window.officeparser].find(parser=>parser&&typeof parser.parseOffice==='function')||null;
  const existing=getParser();
  if(existing)return Promise.resolve(existing);
  if(!documentParserPromise){
    documentParserPromise=new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      script.src='https://cdn.jsdelivr.net/npm/@jose.espana/docstream@0.1.3/dist/officeparser.browser.js';
      script.onload=()=>{
        const parser=getParser();
        if(parser)resolve(parser);
        else reject(Error('Il lettore documenti è stato caricato, ma la libreria docstream non è disponibile. Ricarica la pagina e riprova.'));
      };
      script.onerror=()=>reject(Error('Non riesco a scaricare il lettore PDF/Office. Controlla la connessione e riprova.'));
      document.head.append(script);
    }).catch(error=>{documentParserPromise=null;throw error});
  }
  return documentParserPromise;
}
async function parseUploadedDocument(parser,file,extension){
  const config={newlineDelimiter:'\n\n',extractAttachments:false,ocr:false,outputErrorToConsole:true};
  if(extension==='pdf')config.pdfWorkerSrc='https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.530/build/pdf.worker.min.mjs';
  const attempts=[()=>parser.parseOffice(file,config),async()=>parser.parseOffice(await file.arrayBuffer(),config)];
  let lastError=null;
  for(const attempt of attempts){
    try{
      const parsed=await attempt();
      let text='';
      if(parsed&&typeof parsed.toText==='function')text=parsed.toText();
      else if(parsed&&typeof parsed.toMarkdown==='function')text=parsed.toMarkdown();
      else if(parsed&&Array.isArray(parsed.content)){
        const collect=nodes=>(nodes||[]).map(n=>[n.text||'',collect(n.children)].filter(Boolean).join(' ')).join('\n');
        text=collect(parsed.content);
      }else text=String(parsed?.text||'');
      if(String(text||'').trim())return String(text);
      lastError=Error('Il lettore non ha trovato testo nel documento.');
    }catch(error){lastError=error}
  }
  throw lastError||Error('Formato non leggibile dal lettore documenti.');
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
      extracted=await parseUploadedDocument(parser,file,extension);
    }
    extracted=String(extracted||'').trim();
    if(!extracted)throw Error('Il file è stato aperto, ma non contiene testo estraibile. Se il PDF è una scansione o una foto, occorre prima applicare l’OCR oppure usare un PDF con testo selezionabile.');
    if(extracted.length>80000)throw Error('Il documento contiene troppo testo (oltre 80.000 caratteri). Carica una versione più breve, solo con la ricetta.');
    $('#file-text').value=extracted;
    say('✓ '+file.name+' caricato: estratti '+extracted.length.toLocaleString('it-IT')+' caratteri. Il testo è visibile nel riquadro qui sotto; premi “Controlla la ricetta” per continuare.');
  }catch(error){
    console.error('Chef-AI file import error:',error);
    const detail=String(error?.message||'Errore sconosciuto.');
    const isOfficeHtml=/dochtml|html.*unexpected|unexpected.*html/i.test(detail);
    say('Non sono riuscito a leggere '+file.name+'. '+(isOfficeHtml?'Il convertitore del documento ha generato un errore interno. Prova a salvarlo come DOCX o PDF con testo selezionabile. ':detail+' ' )+'Puoi anche aprire il file e incollare qui il testo della ricetta.');
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
