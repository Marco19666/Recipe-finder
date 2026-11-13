/* SalvaSoldi: UI and validated requests to the server-side AI endpoint. */
(() => {
  const section = document.querySelector("#salvasoldi-section");
  if (!section) return;
  const ids = id => document.getElementById(id);
  const status = ids("salvasoldi-status");
  const results = ids("salvasoldi-results");
  const costSection = ids("quantospendo-section");
  const costStatus = ids("quantospendo-status");
  const costResults = ids("quantospendo-results");
  const launch = ids("show-salvasoldi");
  const home = ids("welcome");
  const hideOtherSections = () => {
    ["results-section","favorites-section","personal-section","history-section","shopping-section","archimede-section","chef-section","quantospendo-section","welcome"].forEach(id => { const node=ids(id); if(node) node.hidden=true; });
    const tryRecipes=document.querySelector(".try-recipes-section"); if(tryRecipes) tryRecipes.hidden=true;
    const daily=ids("daily-recipe-section"); if(daily) daily.hidden=true;
    if(home) home.hidden=true;
    const hero=document.querySelector(".hero"); if(hero) hero.hidden=true;
  };
  const show = target => { hideOtherSections(); target.hidden=false; window.scrollTo({top:0,behavior:"smooth"}); };
  document.addEventListener("click",event=>{
    if(event.target.closest("#show-salvasoldi")) show(section);
    if(event.target.closest("#show-quantospendo")) show(costSection);
  });
  const backHome = target => { target.hidden=true; if(home) home.hidden=false; const hero=document.querySelector(".hero"); if(hero) hero.hidden=false; const daily=ids("daily-recipe-section"); if(daily) daily.hidden=false; const tries=document.querySelector(".try-recipes-section"); if(tries) tries.hidden=false; };
  ids("salvasoldi-back")?.addEventListener("click",() => backHome(section));
  ids("quantospendo-back")?.addEventListener("click",() => backHome(costSection));
  const deviceKey="cosa-cucino-salvasoldi-device-v1";
  function deviceId(){
    let id=localStorage.getItem(deviceKey);
    if(!id){
      id=crypto.randomUUID?crypto.randomUUID():"salvasoldi-"+Date.now()+"-"+Math.random().toString(36).slice(2);
      localStorage.setItem(deviceKey,id);
    }
    return id;
  }
  const euro = value => new Intl.NumberFormat("it-IT",{style:"currency",currency:"EUR"}).format(Number(value)||0);
  const safe = value => String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
  function setStatus(message,error=false,target=status){target.textContent=message;target.hidden=false;target.classList.toggle("is-error",error);}
  function renderResult(data,mode,targetResults=results) {
    if(!data || typeof data!=="object") throw new Error("Il server ha restituito una risposta non valida.");
    const dishes=Array.isArray(data.dishes)?data.dishes:[];
    const ingredients=Array.isArray(data.ingredients)?data.ingredients:[];
    const alternatives=Array.isArray(data.alternatives)?data.alternatives:[];
    const total=Number(data.total_cost??data.total??0), perPerson=Number(data.cost_per_person??data.per_person??0);
    let html='<article class="salvasoldi-result-card"><h3>'+safe(data.title||(mode==="budget"?"Il tuo menu":"Stima della spesa"))+'</h3>';
    if(data.summary) html+='<p>'+safe(data.summary)+'</p>';
    if(mode==="budget" && typeof data.within_budget==="boolean"){
      const budgetMessage=data.within_budget
        ?"✓ Il menu rientra nel budget di "+euro(data.budget_per_person)+" a persona."
        :"Attenzione: la stima supera il budget di "+euro(data.budget_per_person)+" a persona.";
      html+='<p class="salvasoldi-budget-result '+(data.within_budget?"is-within":"is-over")+'">'+safe(budgetMessage)+'</p>';
    }
    if(dishes.length) html+='<h4>Menu proposto</h4>'+dishes.map(d=>'<div><strong>'+safe(d.course||d.portata||"Piatto")+': '+safe(d.name||d.nome||"")+'</strong><p>'+safe(d.description||d.descrizione||"")+'</p></div>').join("");
    if(ingredients.length) html+='<h4>Lista degli ingredienti</h4><ul class="salvasoldi-ingredient-list">'+ingredients.map(i=>'<li><span>'+safe(i.name||i.ingredient||i.ingrediente||"Ingrediente")+' · '+safe([i.quantity,i.unit].filter(Boolean).join(" "))+'</span><strong>'+euro(i.price??i.cost)+'</strong></li>').join("")+'</ul>';
    html+='<div class="salvasoldi-cost-summary"><div><span>Totale stimato</span><strong>'+euro(total)+'</strong></div><div><span>Costo a persona</span><strong>'+euro(perPerson)+'</strong></div><div><span>Persone</span><strong>'+safe(data.people??data.persons??"—")+'</strong></div></div>';
    if(alternatives.length) html+='<div class="salvasoldi-alternatives"><h4>Idee per risparmiare</h4><ul>'+alternatives.map(a=>'<li>'+safe(typeof a==="string"?a:(a.description||a.suggestion||a.name||""))+'</li>').join("")+'</ul></div>';
    html+='</article>'; targetResults.innerHTML=html;
  }
  const quotaKeys={budget:"create_menu",cost:"calculate_cost"};
  const quotaLabels={};
  const quotaButtons={budget:ids("budget-form").querySelector('button[type="submit"]'),cost:ids("cost-form").querySelector('button[type="submit"]')};
  for(const [key,formId] of [["budget","budget-form"],["cost","cost-form"]]){
    const label=document.createElement("p");label.className="salvasoldi-quota";label.setAttribute("role","status");
    ids(formId).appendChild(label);quotaLabels[key]=label;
  }
  function updateQuota(key,remaining){
    const label=quotaLabels[key],button=quotaButtons[key];
    label.textContent=remaining+" di 2 ricerche disponibili";
    button.disabled=remaining<=0;
    if(remaining<=0)label.textContent="Hai esaurito le 2 ricerche disponibili in "+(key==="budget"?"SalvaSoldi.":"QuantoSpendo.");
  }
  async function refreshQuotas(){
    for(const key of ["budget","cost"]){
      try{const r=await fetch("/api/salvasoldi/status?device_id="+encodeURIComponent(deviceId())+"&mode="+quotaKeys[key],{cache:"no-store"});const d=await r.json();if(r.ok)updateQuota(key,d.remaining);}
      catch(_){quotaLabels[key].textContent="Limite: 2 ricerche per dispositivo";}
    }
  }
  refreshQuotas();
  async function request(payload,button,mode,targetStatus=status,targetResults=results) {
    button.disabled=true; button.textContent="Sto elaborando...";
    targetResults.innerHTML=""; setStatus("Sto preparando il calcolo. Potrebbe richiedere qualche secondo.",false,targetStatus);
    try {
      const response=await fetch("/api/salvasoldi",{method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json"},body:JSON.stringify(payload)});
      const type=response.headers.get("content-type")||"";
      if(!type.includes("application/json")) throw new Error("Il servizio SalvaSoldi non è ancora configurato sul server. È necessaria l'attivazione dell'endpoint AI /api/salvasoldi.");
      const data=await response.json();
      if(!response.ok) throw new Error(data.detail||data.error||"Non è stato possibile completare il calcolo.");
      renderResult(data,mode,targetResults); targetStatus.hidden=true;\n      updateQuota(mode==="budget"?"budget":"cost",Number(data.remaining??0));
    } catch(error) {
      setStatus(error.message||"Errore durante la richiesta. Riprova più tardi.",true,targetStatus);\n      if(error && /esaurito le 2 ricerche/i.test(error.message))updateQuota(mode==="budget"?"budget":"cost",0);
    } finally {
      button.disabled=false;
      button.textContent=mode==="budget"?"Crea il mio menu ↗":"Calcola la spesa ↗";
    }
  }
  ids("budget-form").addEventListener("submit",event=>{
    event.preventDefault();
    const budget=Number(ids("budget-per-person").value),people=Number(ids("budget-people").value);
    const courses=[...document.querySelectorAll('input[name="course"]:checked')].map(input=>input.value);
    if(!Number.isFinite(budget)||budget<=0||!Number.isInteger(people)||people<1||!courses.length){setStatus("Inserisci un budget valido, il numero di persone e almeno una portata.",true);return;}
    const button=event.currentTarget.querySelector('button[type="submit"]');
    request({device_id:deviceId(),mode:"create_menu",budget_per_person:budget,people,courses,diet:ids("budget-diet").value,notes:ids("budget-notes").value.trim(),currency:"EUR",locale:"it-IT"},button,"budget");
  });
  ids("cost-form").addEventListener("submit",event=>{
    event.preventDefault();
    const menu=ids("cost-menu").value.trim(),people=Number(ids("cost-people").value);
    if(menu.length<3||!Number.isInteger(people)||people<1){setStatus("Descrivi almeno un piatto e indica un numero di persone valido.",true);return;}
    const button=event.currentTarget.querySelector('button[type="submit"]');
    request({device_id:deviceId(),mode:"calculate_cost",menu,people,currency:"EUR",locale:"it-IT"},button,"cost",costStatus,costResults);
  });
})();
