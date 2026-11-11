const form = document.querySelector("#search-form");
const queryInput = document.querySelector("#query");
const resultsSection = document.querySelector("#results-section");
const resultsGrid = document.querySelector("#results");
const resultsTitle = document.querySelector("#results-title");
const resultCount = document.querySelector("#result-count");
const welcome = document.querySelector("#welcome");
const modal = document.querySelector("#recipe-modal");
const recipeContent = document.querySelector("#recipe-content");
const toast = document.querySelector("#toast");
const favoritesSection = document.querySelector("#favorites-section");
const favoritesGrid = document.querySelector("#favorites-grid");
const favoritesButton = document.querySelector("#show-favorites");
const favoritesCount = document.querySelector("#favorites-count");
const welcomeSection = document.querySelector("#welcome");
const personalSection = document.querySelector("#personal-section");
const personalGrid = document.querySelector("#personal-grid");
const personalButton = document.querySelector("#show-personal");
const personalCount = document.querySelector("#personal-count");
const PERSONAL_KEY = "recipe-finder-personal-recipes-v1";
const FAVORITES_KEY = "recipe-finder-favorites-v1";
const SHOPPING_KEY = "recipe-finder-shopping-list-v1";
const shoppingSection = document.querySelector("#shopping-section");
const shoppingList = document.querySelector("#shopping-list");
const shoppingCount = document.querySelector("#shopping-count");
const allSitesCheckbox = document.querySelector("#sites-all");
const siteCheckboxes = [...document.querySelectorAll('input[name="search-site"]')];
function getSelectedSites() { return siteCheckboxes.filter(input => input.checked).map(input => input.value); }
allSitesCheckbox.addEventListener("change", () => { siteCheckboxes.forEach(input => { input.checked = allSitesCheckbox.checked; }); });
siteCheckboxes.forEach(input => input.addEventListener("change", () => { allSitesCheckbox.checked = siteCheckboxes.every(site => site.checked); }));
function getPersonalRecipes() { try { return JSON.parse(localStorage.getItem(PERSONAL_KEY) || "[]"); } catch { return []; } }
function savePersonalRecipes(items) { localStorage.setItem(PERSONAL_KEY, JSON.stringify(items)); personalCount.textContent = items.length; }
function showPersonal() {
  resultsSection.hidden = true; favoritesSection.hidden = true; shoppingSection.hidden = true; welcomeSection.hidden = true;
  personalSection.hidden = false;
  document.querySelector('#personal-form').hidden = true;
  document.querySelector('#personal-add').hidden = false;
  renderPersonalRecipes();
}
function imageToDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file) { resolve(""); return; }
    if (!file.type.startsWith("image/")) { reject(new Error("Scegli un file immagine.")); return; }
    if (file.size > 10 * 1024 * 1024) { reject(new Error("La foto deve essere inferiore a 10 MB.")); return; }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Non riesco a leggere la foto."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("La foto non è valida."));
      img.onload = () => {
        const scale = Math.min(1, 1000 / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.72));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
function renderPersonalRecipes() {
  const all = getPersonalRecipes();
  const term = (document.querySelector("#personal-search").value || "").trim().toLocaleLowerCase("it");
  const category = document.querySelector("#personal-category-filter").value;
  const items = all.filter(item => (!category || (item.category || "Altro") === category) &&
    (!term || (item.title + " " + (item.ingredients || []).join(" ")).toLocaleLowerCase("it").includes(term)));
  personalGrid.innerHTML = items.length ? items.map((item, index) =>
    '<article class="result-card">' + (item.photo ? '<img class="result-image" src="' + item.photo + '" alt="' + esc(item.title) + '" loading="eager">' : '<div class="result-placeholder" aria-hidden="true">✳</div>') + '<div class="result-body"><span class="result-source">Ricetta personale · ' + esc(item.category || "Altro") + '</span><h3>' + esc(item.title) + '</h3><div class="card-actions"><button class="recipe-button" data-personal-open="' + index + '">Apri ricetta</button><button class="favorite-remove" data-personal-delete="' + index + '">Elimina</button></div><button class="shopping-add" data-shopping-add="' + index + '" type="button">＋ Ingredienti nella lista</button></div></article>'
  ).join("") : '<div class="empty-state">' + (all.length ? "Nessuna ricetta corrisponde alla ricerca o categoria scelta." : "Non hai ancora aggiunto ricette personali. Premi “Aggiungi ricetta” per iniziare.") + '</div>';
  personalGrid.querySelectorAll("[data-personal-open]").forEach(button => button.addEventListener("click", () => showPersonalRecipe(items[Number(button.dataset.personalOpen)])));
  personalGrid.querySelectorAll("[data-personal-delete]").forEach(button => button.addEventListener("click", () => {
    const item = items[Number(button.dataset.personalDelete)];
    savePersonalRecipes(getPersonalRecipes().filter(saved => saved.id !== item.id)); renderPersonalRecipes();
    notify("Ricetta personale eliminata.");
  }));
  personalGrid.querySelectorAll("[data-shopping-add]").forEach(button => button.addEventListener("click", () => addShoppingIngredients(items[Number(button.dataset.shoppingAdd)].ingredients)));
}
function showPersonalRecipe(item) {
  modal.hidden = false; document.body.style.overflow = "hidden";
  const ingredients = item.ingredients.map(value => "<li>" + esc(value) + "</li>").join("");
  const steps = item.steps.map(value => "<li>" + esc(value) + "</li>").join("");
  recipeContent.innerHTML = '<span class="result-source">Ricetta personale</span><h2 id="recipe-title">' + esc(item.title) + '</h2>' +
    (item.photo ? '<img class="recipe-photo" src="' + item.photo + '" alt="' + esc(item.title) + '">' : '') +
    (item.time ? '<div class="recipe-meta">Tempo di preparazione: ' + esc(item.time) + ' min</div>' : '') +
    '<button type="button" class="shopping-add" id="personal-modal-shopping">＋ Ingredienti nella lista della spesa</button><h3>Ingredienti</h3><ul>' + ingredients + '</ul><h3>Preparazione</h3><ol>' + steps + '</ol>';
  document.querySelector("#personal-modal-shopping").addEventListener("click", () => addShoppingIngredients(item.ingredients));
}
function getFavorites() { try { return JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]"); } catch { return []; } }
function saveFavorites(items) { localStorage.setItem(FAVORITES_KEY, JSON.stringify(items)); updateFavoritesCount(); }
function updateFavoritesCount() { const count = getFavorites().length; favoritesCount.textContent = count; favoritesButton.setAttribute("aria-label", "Ricette preferite: " + count); }
function isFavorite(url) { return getFavorites().some(item => item.url === url); }
function toggleFavorite(item) {
  const items = getFavorites(); const exists = items.some(saved => saved.url === item.url);
  saveFavorites(exists ? items.filter(saved => saved.url !== item.url) : [item, ...items]);
  notify(exists ? "Ricetta rimossa dalle preferite." : "Ricetta salvata tra le preferite."); return !exists;
}
function showFavorites() { resultsSection.hidden = true; welcomeSection.hidden = true; personalSection.hidden = true; shoppingSection.hidden = true; favoritesSection.hidden = false; renderFavorites(); }
function renderFavorites() {
  const all = getFavorites();
  const term = (document.querySelector("#favorites-search").value || "").trim().toLocaleLowerCase("it");
  const category = document.querySelector("#favorites-category-filter").value;
  const items = all.filter(item => (!category || (item.category || "Altro") === category) &&
    (!term || (item.title + " " + (item.source || "")).toLocaleLowerCase("it").includes(term)));
  favoritesGrid.innerHTML = items.length ? items.map((item, index) => {
    const image = item.image ? '<img class="result-image" src="' + esc(item.image) + '" alt="' + esc(item.title) + '" loading="eager">' : '<div class="result-placeholder"></div>';
    return '<article class="result-card">' + image + '<div class="result-body"><span class="result-source">' + esc(item.source || "Ricetta salvata") + '</span><h3>' + esc(item.title) + '</h3><label class="favorite-category-label">Categoria <select class="favorite-category" data-favorite-category="' + index + '"><option' + ((item.category || "Altro") === "Primo" ? " selected" : "") + '>Primo</option><option' + (item.category === "Secondo" ? " selected" : "") + '>Secondo</option><option' + (item.category === "Contorno" ? " selected" : "") + '>Contorno</option><option' + (item.category === "Antipasto" ? " selected" : "") + '>Antipasto</option><option' + (item.category === "Dolce" ? " selected" : "") + '>Dolce</option><option' + ((item.category || "Altro") === "Altro" ? " selected" : "") + '>Altro</option></select></label><div class="card-actions"><button class="recipe-button" data-favorite-open="' + index + '">Apri ricetta</button><button class="favorite-remove" data-favorite-remove="' + index + '">Rimuovi</button></div>' + (item.ingredients && item.ingredients.length ? '<button class="shopping-add" data-favorite-shopping="' + index + '" type="button">＋ Ingredienti nella lista</button>' : '') + '</div></article>';
  }).join("") : '<div class="empty-state">' + (all.length ? "Nessuna ricetta corrisponde alla ricerca o categoria scelta." : "Non hai ancora salvato ricette. Apri una ricetta e premi “Ricetta preferita”.") + '</div>';
  favoritesGrid.querySelectorAll("[data-favorite-open]").forEach(button => button.addEventListener("click", () => { const item = items[Number(button.dataset.favoriteOpen)]; loadRecipe(item.url, item); }));
  favoritesGrid.querySelectorAll("[data-favorite-remove]").forEach(button => button.addEventListener("click", () => { const item = items[Number(button.dataset.favoriteRemove)]; saveFavorites(getFavorites().filter(saved => saved.url !== item.url)); renderFavorites(); }));
  favoritesGrid.querySelectorAll("[data-favorite-category]").forEach(select => select.addEventListener("change", () => {
    const item = items[Number(select.dataset.favoriteCategory)];
    saveFavorites(getFavorites().map(saved => saved.url === item.url ? { ...saved, category: select.value } : saved));
    renderFavorites();
  }));
  favoritesGrid.querySelectorAll("[data-favorite-shopping]").forEach(button => button.addEventListener("click", () => addShoppingIngredients(items[Number(button.dataset.favoriteShopping)].ingredients)));
}
updateFavoritesCount();

const esc = value => String(value == null ? "" : value).replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[char]));

function notify(message, duration = 3200) {
  toast.textContent = message;
  toast.classList.add("show");
  window.setTimeout(() => toast.classList.remove("show"), duration);
}
function setLoading(loading) {
  const button = form.querySelector("button");
  button.disabled = loading;
  button.innerHTML = loading ? "Cerco..." : 'Cerca ricette <span aria-hidden="true">↗</span>';
}

async function searchRecipes(query) {
  queryInput.value = query;
  const selectedSites = getSelectedSites();
  if (!selectedSites.length) { notify("Seleziona almeno un sito per avviare la ricerca."); return; }
  if (selectedSites.length > 3 && sessionStorage.getItem("recipe-finder-many-sites-reminder-v1") !== "shown") {
    sessionStorage.setItem("recipe-finder-many-sites-reminder-v1", "shown");
    notify("Promemoria: con più di 3 siti la ricerca potrebbe richiedere più tempo o incontrare rallentamenti. Puoi continuare normalmente.", 6500);
  }
  setLoading(true);
  welcome.hidden = true;
  favoritesSection.hidden = true;
  personalSection.hidden = true;
  shoppingSection.hidden = true;
  resultsSection.hidden = false;
  resultsTitle.textContent = "Ricette: " + query;
  resultCount.textContent = "Ricerca in corso";
  resultsGrid.innerHTML = '<div class="empty-state">Sto cercando tra i siti di cucina...</div>';
  try {
    let data = null;
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await fetch("/api/search?q=" + encodeURIComponent(query) + "&sites=" + encodeURIComponent(selectedSites.join(",")) + "&_=" + Date.now(), { cache: "no-store" });
        const contentType = response.headers.get("content-type") || "";
        if (!contentType.includes("application/json")) {
          throw new Error("Il servizio di ricerca ha restituito una pagina non valida.");
        }
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.detail || "Ricerca non disponibile.");
        data = payload;
        if ((data.results || []).length > 0 || attempt === 1) break;
        resultsGrid.innerHTML = '<div class="empty-state">Nessun risultato al primo tentativo. Sto riprovando automaticamente...</div>';
      } catch (error) {
        lastError = error;
        if (attempt === 1) throw error;
        resultsGrid.innerHTML = '<div class="empty-state">La ricerca ha avuto un problema temporaneo. Riprovo automaticamente...</div>';
      }
      await new Promise(resolve => window.setTimeout(resolve, 700));
    }
    if (!data && lastError) throw lastError;
    const results = data?.results || [];
    resultCount.textContent = results.length + (results.length === 1 ? " risultato" : " risultati");
    if (!results.length) {
      resultsGrid.innerHTML = '<div class="empty-state">Non ho trovato ricette per questa ricerca. Prova con un altro ingrediente o piatto.</div>';
      return;
    }
    resultsGrid.innerHTML = results.map((item, index) => {
      const image = item.image ? '<img class="result-image" src="' + esc(item.image) + '" alt="' + esc(item.title) + '" loading="eager" referrerpolicy="no-referrer">' : '<div class="result-placeholder" aria-hidden="true"></div>';
      const description = esc((item.description || "").slice(0, 150)) + ((item.description || "").length > 150 ? "…" : "");
      return '<article class="result-card">' + image +
        '<div class="result-body"><span class="result-source">' + esc(item.source) + '</span>' +
        '<h3>' + esc(item.title) + '</h3><p>' + description + '</p>' +
        '<div class="card-actions"><button class="recipe-button" data-recipe="' + index + '">Ingredienti e procedimento</button></div></div></article>';
    }).join("");
    resultsGrid.querySelectorAll("[data-recipe]").forEach(button => {
      button.addEventListener("click", () => loadRecipe(results[Number(button.dataset.recipe)].url, results[Number(button.dataset.recipe)]));
    });
  } catch (error) {
    resultsGrid.innerHTML = '<div class="error-state">' + esc(error.message) + '<br><br>La ricerca automatica non è riuscita. Riprova tra qualche secondo.</div>';
    resultCount.textContent = "Ricerca non riuscita";
  } finally {
    setLoading(false);
  }
}

async function loadRecipe(url, fallback = {}) {
  modal.hidden = false;
  document.body.style.overflow = "hidden";
  recipeContent.innerHTML = '<div class="empty-state">Sto leggendo la ricetta dalla fonte originale...</div>';
  try {
    const response = await fetch("/api/recipe?url=" + encodeURIComponent(url));
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      throw new Error("Il sito della ricetta ha restituito una risposta non valida. Riprova più tardi.");
    }
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || "Non è stato possibile leggere la ricetta.");
    const ingredients = Array.isArray(data.ingredients) ? data.ingredients : [];
    const instructions = Array.isArray(data.instructions) ? data.instructions : [data.instructions].filter(Boolean);
    const meta = [
      data.total_time ? "Tempo totale: " + data.total_time + " min" : "",
      data.yields ? "Dosi: " + data.yields : "",
      data.author ? "Autore: " + data.author : ""
    ].filter(Boolean).map(esc).join(" · ");
    const image = data.image ? '<img class="recipe-image" src="' + esc(data.image) + '" alt="" referrerpolicy="no-referrer">' : "";
    const ingredientList = ingredients.length ? "<ul>" + ingredients.map(item => "<li>" + esc(item) + "</li>").join("") + "</ul>" : "<p>Ingredienti non disponibili in formato leggibile.</p>";
    const steps = instructions.length ? "<ol>" + instructions.map(item => "<li>" + esc(item) + "</li>").join("") + "</ol>" : "<p>Procedimento non disponibile in formato leggibile.</p>";
    const savedItem = { url, title: data.title || fallback.title || "Ricetta", image: data.image || fallback.image || "", source: data.source || fallback.source || "", description: fallback.description || "", ingredients, category: fallback.category || "Altro" };
    if (isFavorite(url)) { saveFavorites(getFavorites().map(item => item.url === url ? { ...item, ...savedItem } : item)); }
    recipeContent.innerHTML = '<span class="result-source">' + esc(data.source || fallback.source || "Fonte originale") + '</span>' +
      '<h2 id="recipe-title">' + esc(data.title || fallback.title || "Ricetta") + '</h2><div class="recipe-meta">' + meta + '</div>' +
      '<button type="button" id="toggle-favorite" class="favorite-toggle" aria-pressed="' + isFavorite(url) + '">' + (isFavorite(url) ? "♥ Ricetta preferita" : "♡ Ricetta preferita") + '</button>' +
      '<button type="button" id="recipe-shopping" class="shopping-add">＋ Ingredienti nella lista della spesa</button>' +
      image + '<h3>Ingredienti</h3>' + ingredientList + '<h3>Preparazione</h3>' + steps;
    document.querySelector("#recipe-shopping").addEventListener("click", () => addShoppingIngredients(ingredients));
    document.querySelector("#toggle-favorite").addEventListener("click", () => {
      const button = document.querySelector("#toggle-favorite");
      const existing = isFavorite(url);
      if (existing) {
        toggleFavorite(savedItem);
        button.textContent = "♡ Ricetta preferita";
        button.setAttribute("aria-pressed", "false");
        const chooser = document.querySelector("#favorite-category-choice");
        if (chooser) chooser.remove();
        return;
      }
      let chooser = document.querySelector("#favorite-category-choice");
      if (chooser) return;
      chooser = document.createElement("div");
      chooser.id = "favorite-category-choice";
      chooser.className = "favorite-category-choice";
      chooser.innerHTML = '<label for="favorite-save-category">In quale categoria vuoi salvarla?</label><select id="favorite-save-category"><option value="" selected disabled>Scegli una categoria</option><option>Primo</option><option>Secondo</option><option>Contorno</option><option>Antipasto</option><option>Dolce</option><option>Altro</option></select><button type="button" class="recipe-button" id="confirm-favorite-category">Salva tra le preferite</button>';
      button.insertAdjacentElement("afterend", chooser);
      document.querySelector("#confirm-favorite-category").addEventListener("click", () => {
        const category = document.querySelector("#favorite-save-category").value;
        if (!category) { notify("Scegli una categoria prima di salvare."); return; }
        toggleFavorite({ ...savedItem, category });
        button.textContent = "♥ Ricetta preferita";
        button.setAttribute("aria-pressed", "true");
        chooser.remove();
      });
    });
  } catch (error) {
    recipeContent.innerHTML = '<div class="error-state">' + esc(error.message) + '</div>';
  }
}

function getShoppingItems() { try { return JSON.parse(localStorage.getItem(SHOPPING_KEY) || "[]"); } catch { return []; } }
function saveShoppingItems(items) {
  localStorage.setItem(SHOPPING_KEY, JSON.stringify(items));
  shoppingCount.textContent = items.length;
}
function addShoppingIngredients(ingredients) {
  const items = getShoppingItems();
  const known = new Set(items.map(item => item.text.toLocaleLowerCase("it")));
  let added = 0;
  (ingredients || []).forEach(value => {
    const text = String(value).trim();
    if (text && !known.has(text.toLocaleLowerCase("it"))) {
      items.push({ id: String(Date.now()) + "-" + added, text, checked: false });
      known.add(text.toLocaleLowerCase("it")); added++;
    }
  });
  saveShoppingItems(items);
  notify(added ? added + " ingredienti aggiunti alla lista." : "Gli ingredienti sono già nella lista.");
}
function renderShoppingList() {
  const items = getShoppingItems();
  shoppingList.innerHTML = items.length ? items.map(item =>
    '<div class="shopping-item"><input type="checkbox" aria-label="Segna come acquistato" data-shopping-check="' + esc(item.id) + '"' + (item.checked ? " checked" : "") + '><span' + (item.checked ? ' class="checked"' : '') + '>' + esc(item.text) + '</span><button type="button" class="favorite-remove" data-shopping-delete="' + esc(item.id) + '">Rimuovi</button></div>'
  ).join("") : '<div class="empty-state">La lista è vuota. Apri una ricetta e premi “Ingredienti nella lista della spesa”.</div>';
  shoppingList.querySelectorAll("[data-shopping-check]").forEach(input => input.addEventListener("change", () => {
    saveShoppingItems(getShoppingItems().map(item => item.id === input.dataset.shoppingCheck ? { ...item, checked: input.checked } : item));
    renderShoppingList();
  }));
  shoppingList.querySelectorAll("[data-shopping-delete]").forEach(button => button.addEventListener("click", () => {
    saveShoppingItems(getShoppingItems().filter(item => item.id !== button.dataset.shoppingDelete)); renderShoppingList();
  }));
}
function showShopping() {
  resultsSection.hidden = true; favoritesSection.hidden = true; personalSection.hidden = true; welcomeSection.hidden = true;
  shoppingSection.hidden = false; renderShoppingList();
}
shoppingCount.textContent = getShoppingItems().length;
document.querySelector("#show-shopping").addEventListener("click", showShopping);
document.querySelector("#shopping-back").addEventListener("click", () => { shoppingSection.hidden = true; welcomeSection.hidden = false; });
document.querySelector("#shopping-clear").addEventListener("click", () => {
  saveShoppingItems([]); renderShoppingList(); notify("Lista della spesa svuotata.");
});

personalCount.textContent = getPersonalRecipes().length;
document.querySelector("#personal-search").addEventListener("input", renderPersonalRecipes);
document.querySelector("#personal-category-filter").addEventListener("change", renderPersonalRecipes);
personalButton.addEventListener("click", showPersonal);
document.querySelector('#personal-add').addEventListener('click', () => {
  document.querySelector('#personal-form').hidden = false;
  document.querySelector('#personal-add').hidden = true;
  document.querySelector('#personal-title').focus();
});
document.querySelector("#personal-back").addEventListener("click", () => { personalSection.hidden = true; welcomeSection.hidden = false; });
document.querySelector("#personal-form").addEventListener("submit", async event => {
  event.preventDefault();
  const title = document.querySelector("#personal-title").value.trim();
  const ingredients = document.querySelector("#personal-ingredients").value.split("\n").map(x => x.trim()).filter(Boolean);
  const steps = document.querySelector("#personal-steps").value.split("\n").map(x => x.trim()).filter(Boolean);
  const time = document.querySelector("#personal-time").value.trim();
  const photoFile = document.querySelector("#personal-photo").files[0];
  if (!title || !ingredients.length || !steps.length) { notify("Compila nome, ingredienti e preparazione."); return; }
  try {
    const photo = await imageToDataUrl(photoFile);
    const items = getPersonalRecipes();
    items.unshift({ id: String(Date.now()), title, category: document.querySelector("#personal-category").value, ingredients, steps, time, photo });
    savePersonalRecipes(items);
    event.target.reset();
    event.target.hidden = true;
    document.querySelector("#personal-add").hidden = false;
    renderPersonalRecipes();
    notify("Ricetta personale salvata.");
  } catch (error) { notify(error.message || "Non riesco a salvare la foto."); }
});
favoritesButton.addEventListener("click", showFavorites);
document.querySelector("#favorites-search").addEventListener("input", renderFavorites);
document.querySelector("#favorites-category-filter").addEventListener("change", renderFavorites);
document.querySelector("#back-home").addEventListener("click", () => { favoritesSection.hidden = true; welcomeSection.hidden = false; });
form.addEventListener("submit", event => {
  event.preventDefault();
  const query = queryInput.value.trim();
  if (query.length >= 2) searchRecipes(query);
});
document.querySelectorAll("[data-query]").forEach(button => {
  button.addEventListener("click", () => searchRecipes(button.dataset.query));
});
modal.querySelectorAll("[data-close]").forEach(element => {
  element.addEventListener("click", () => {
    modal.hidden = true;
    document.body.style.overflow = "";
  });
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && !modal.hidden) {
    modal.hidden = true;
    document.body.style.overflow = "";
  }
});
