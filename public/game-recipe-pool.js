(()=>{"use strict";
const cacheKey="recipe-finder-game-recipe-cache-v1";
const catalog=[];
function strings(value){if(!Array.isArray(value))return[];return value.map(x=>typeof x==="string"?x:(x&&typeof x.text==="string"?x.text:(x&&typeof x.name==="string"?x.name:""))).map(x=>x.replace(/\s+/g," ").trim()).filter(Boolean)}
async function load(){
 const urls=new Map();
 try{const d=JSON.parse(localStorage.getItem("recipe-finder-daily-recipe-v1")||"null");if(d?.item?.url)urls.set(d.item.url,d.item.title||"")}
 catch{}
 try{const d=JSON.parse(localStorage.getItem("recipe-finder-try-menu-v1")||"null");for(const e of (d?.entries||[]))if(e?.item?.url)urls.set(e.item.url,e.item.title||"")}
 catch{}
 let cache={};try{cache=JSON.parse(localStorage.getItem(cacheKey)||"{}")}catch{}
 const entries=[...urls.entries()].slice(0,6);
 const recipes=await Promise.all(entries.map(async([url,title])=>{
  try{
   let d=cache[url];
   if(!d){const r=await fetch("/api/recipe?url="+encodeURIComponent(url),{cache:"no-store",headers:{Accept:"application/json"}});if(!r.ok)return null;d=await r.json();cache[url]=d}
   const ingredients=strings(d.ingredients),steps=strings(d.instructions);
   if(!d.title||ingredients.length<3||steps.length<3)return null;
   return {title:d.title||title,emoji:"🍽️",ingredients,steps,source:url};
  }catch{return null}
 }));
 try{localStorage.setItem(cacheKey,JSON.stringify(cache))}catch{}
 return recipes.filter(Boolean);
}
const quiz={
technique:[
["Che cosa significa rosolare?","🍳",["Cuocere rapidamente a calore vivace per colorire","Cuocere in acqua fredda","Congelare un alimento","Cuocere solo a vapore"],0,"La rosolatura crea una superficie dorata."],
["A cosa serve il riposo della pasta frolla?","🥧",["Rilassare il glutine e rassodare il burro","Far fermentare l'impasto","Sciogliere lo zucchero","Aumentare l'umidità"],0,"Il riposo rende la frolla più facile da stendere."],
["Che cosa vuol dire filtrare un brodo?","🥣",["Separare il liquido dalle parti solide","Far evaporare tutta l'acqua","Frullare le verdure","Aggiungere farina"],0,"Si passa il brodo attraverso un colino."],
["Qual è la funzione della tostatura del riso?","🍚",["Scaldare i chicchi prima di aggiungere il brodo","Raffreddare il riso","Lavare l'amido","Cuocerlo completamente"],0,"La tostatura prepara il chicco alla cottura del risotto."],
["Che cosa significa impanare?","🍗",["Rivestire un alimento con farina, uovo e pangrattato","Cuocere sotto sale","Marinare nel vino","Essiccare"],0,"L'impanatura crea una copertura che diventa croccante."],
["Perché si monta la panna fredda?","🥛",["Il freddo aiuta il grasso a trattenere aria","Per sciogliere lo zucchero","Per eliminare l'acqua","Per renderla salata"],0,"La panna fredda monta più facilmente."],
["Che cosa significa cuocere a bagnomaria?","♨️",["Usare un recipiente immerso o appoggiato su acqua calda","Cuocere direttamente sulla fiamma","Friggere in olio","Cuocere sotto la cenere"],0,"Il calore dell'acqua è più dolce e controllato."],
["A cosa serve la lievitazione?","🍞",["Far sviluppare gas che aumentano il volume dell'impasto","Rendere l'impasto salato","Eliminare l'acqua","Colorare la crosta"],0,"I gas prodotti dai lieviti fanno crescere l'impasto."],
["Che cosa si intende per julienne?","🥕",["Taglio in bastoncini sottili","Taglio a cubi grandi","Fette molto spesse","Verdura grattugiata"],0,"La julienne produce striscioline sottili e regolari."],
["Che cosa significa sfumare?","🍷",["Aggiungere un liquido e lasciarne evaporare la parte alcolica","Aggiungere farina fredda","Spegnere il forno","Frullare una salsa"],0,"Il liquido scioglie i succhi sul fondo e insaporisce."],
["Perché si lascia riposare un impasto per pizza?","🍕",["Per sviluppare struttura e fermentazione","Per far evaporare il lievito","Per eliminare il glutine","Per congelarlo"],0,"Il riposo favorisce fermentazione ed estensibilità."],
["Che cosa significa gratinare?","🧀",["Formare una crosta dorata in superficie","Cuocere in acqua","Marinare a freddo","Frullare"],0,"La gratinatura crea una superficie colorita e croccante."],
["Che cosa vuol dire emulsionare?","🥄",["Unire liquidi che tendono a separarsi in una miscela stabile","Bollire a lungo","Tagliare a dadini","Setacciare"],0,"Un'emulsione disperde un liquido in un altro."],
["Qual è lo scopo di sbianchire le verdure?","🥦",["Immergerle brevemente in acqua bollente e raffreddarle","Essiccarle al sole","Friggerle a lungo","Cuocerle sotto sale"],0,"La sbianchitura è una precottura rapida."],
["Che cosa significa brasare?","🥘",["Rosolare e poi cuocere lentamente con poco liquido e coperchio","Bollire in molta acqua","Cuocere a fiamma altissima senza liquidi","Grigliare"],0,"La brasatura combina rosolatura e cottura lenta."]
],
truth:[
["Il lievito madre contiene una comunità di lieviti e batteri lattici.","🍞",["Vero","Falso"],0,"Vero: è una coltura naturale usata per fermentare gli impasti."],
["La pasta secca va sempre sciacquata dopo la cottura.","🍝",["Vero","Falso"],1,"Falso: si perderebbe parte dell'amido utile al condimento."],
["Il basilico tende a scurirsi se viene ossidato o lavorato troppo a lungo.","🌿",["Vero","Falso"],0,"Vero: calore e ossidazione possono scurirlo."],
["Il riso Carnaroli è spesso usato per preparare risotti.","🍚",["Vero","Falso"],0,"Vero: mantiene bene la consistenza durante la mantecatura."],
["La marinatura acida rende sempre sicuro da mangiare il pesce crudo.","🐟",["Vero","Falso"],1,"Falso: l'acidità non sostituisce le corrette misure di sicurezza."],
["La farina 00 è una farina molto raffinata.","🌾",["Vero","Falso"],0,"Vero: la sigla indica il grado di raffinazione."],
["Il cioccolato può bruciare se sciolto a calore troppo alto.","🍫",["Vero","Falso"],0,"Vero: va sciolto dolcemente, mescolando."],
["Le patate germogliate o verdi possono richiedere particolare cautela.","🥔",["Vero","Falso"],0,"Vero: le parti verdi e i germogli possono contenere più glicoalcaloidi."],
["La lievitazione avviene più rapidamente a temperature molto basse.","🍞",["Vero","Falso"],1,"Falso: il freddo rallenta l'attività dei lieviti."],
["Il sale può rallentare l'attività del lievito se entra in contatto diretto in quantità elevate.","🧂",["Vero","Falso"],0,"Vero: è meglio distribuirlo nell'impasto."],
["La frittura richiede che l'alimento sia completamente immerso nell'olio in ogni ricetta.","🍟",["Vero","Falso"],1,"Falso: esistono anche fritture in padella con poco olio."],
["Le erbe aromatiche delicate spesso si aggiungono verso fine cottura.","🌱",["Vero","Falso"],0,"Vero: così si preservano meglio i profumi."],
["Il bicarbonato può reagire con ingredienti acidi negli impasti.","🧁",["Vero","Falso"],0,"Vero: la reazione produce anidride carbonica."],
["Il brodo caldo è preferibile al brodo freddo quando si prepara un risotto.","🍲",["Vero","Falso"],0,"Vero: mantiene più stabile la temperatura di cottura."],
["La pastorizzazione è un trattamento termico volto a ridurre i microrganismi.","🥛",["Vero","Falso"],0,"Vero: riduce la carica microbica, senza sterilizzare."]
]};
window.RecipeGamePool={load,catalog,quiz};
})();