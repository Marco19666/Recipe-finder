(()=>{"use strict";
const cacheKey="recipe-finder-game-recipe-cache-v1";
function strings(value){if(!Array.isArray(value))return[];return value.map(x=>typeof x==="string"?x:(x&&typeof x.text==="string"?x.text:(x&&typeof x.name==="string"?x.name:""))).map(x=>x.replace(/\\s+/g," ").trim()).filter(Boolean)}
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
window.RecipeGamePool={load};
})();