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
function getPersonalRecipes() { try { return JSON.parse(localStorage.getItem(PERSONAL_KEY) || "[]"); } catch { return []; } }
function savePersonalRecipes(items) { localStorage.setItem(PERSONAL_KEY, JSON.stringify(items)); personalCount.textContent = items.length; }
function showPersonal() {
  resultsSection.hidden = true; favoritesSection.hidden = true; welcomeSection.hidden = true;
  personalSection.hidden = false; renderPersonalRecipes();
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
  const items = getPersonalRecipes();
  personalGrid.innerHTML = items.length ? items.map((item, index) =>
    '<article class="result-card">' + (item.photo ? '<img class="result-image" src="' + item.photo + '" alt="' + esc(item.title) + '" loading="eager">' : '<div class="result-placeholder" aria-hidden="true">✳</div>') + '<div class="result-body"><span class="result-source">Ricetta personale</span><h3>' + esc(item.title) + '</h3><div class="card-actions"><button class="recipe-button" data-personal-open="' + index + '">Apri ricetta</button><button class="favorite-remove" data-personal-delete="' + index + '">Elimina</button></div></div></article>'
  ).join("") : '<div class="empty-state">Non hai ancora aggiunto ricette personali. Usa il modulo qui sopra.</div>';
  personalGrid.querySelectorAll("[data-personal-open]").forEach(button => button.addEventListener("click", () => showPersonalRecipe(items[Number(button.dataset.personalOpen)])));
  personalGrid.querySelectorAll("[data-personal-delete]").forEach(button => button.addEventListener("click", () => {
    const item = items[Number(button.dataset.personalDelete)];
    savePersonalRecipes(getPersonalRecipes().filter(saved => saved.id !== item.id)); renderPersonalRecipes();
    notify("Ricetta personale eliminata.");
  }));
}
function showPersonalRecipe(item) {
  modal.hidden = false; document.body.style.overflow = "hidden";
  const ingredients = item.ingredients.map(value => "<li>" + esc(value) + "</li>").join("");
  const steps = item.steps.map(value => "<li>" + esc(value) + "</li>").join("");
  recipeContent.innerHTML = '<span class="result-source">Ricetta personale</span><h2 id="recipe-title">' + esc(item.title) + '</h2>' +
    (item.photo ? '<img class="recipe-photo" src="' + item.photo + '" alt="' + esc(item.title) + '">' : '') +
    (item.time ? '<div class="recipe-meta">Tempo di preparazione: ' + esc(item.time) + ' min</div>' : '') +
    '<h3>Ingredienti</h3><ul>' + ingredients + '</ul><h3>Preparazione</h3><ol>' + steps + '</ol>';
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
function showFavorites() { resultsSection.hidden = true; welcomeSection.hidden = true; personalSection.hidden = true; favoritesSection.hidden = false; renderFavorites(); }
function renderFavorites() {
  const items = getFavorites();
  favoritesGrid.innerHTML = items.length ? items.map((item, index) => {
    const image = item.image ? '<img class="result-image" src="' + esc(item.image) + '" alt="' + esc(item.title) + '" loading="eager">' : '<div class="result-placeholder"></div>';
    return '<article class="result-card">' + image + '<div class="result-body"><span class="result-source">' + esc(item.source || "Ricetta salvata") + '</span><h3>' + esc(item.title) + '</h3><div class="card-actions"><button class="recipe-button" data-favorite-open="' + index + '">Apri ricetta</button><button class="favorite-remove" data-favorite-remove="' + index + '">Rimuovi</button></div></div></article>';
  }).join("") : '<div class="empty-state">Non hai ancora salvato ricette. Apri una ricetta e premi “Ricetta preferita”.</div>';
  favoritesGrid.querySelectorAll("[data-favorite-open]").forEach(button => button.addEventListener("click", () => { const item = items[Number(button.dataset.favoriteOpen)]; loadRecipe(item.url, item); }));
  favoritesGrid.querySelectorAll("[data-favorite-remove]").forEach(button => button.addEventListener("click", () => { const item = items[Number(button.dataset.favoriteRemove)]; saveFavorites(getFavorites().filter(saved => saved.url !== item.url)); renderFavorites(); }));
}
updateFavoritesCount();

const esc = value => String(value == null ? "" : value).replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[char]));

function notify(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.setTimeout(() => toast.classList.remove("show"), 3200);
}
function setLoading(loading) {
  const button = form.querySelector("button");
  button.disabled = loading;
  button.innerHTML = loading ? "Cerco..." : 'Cerca ricette <span aria-hidden="true">↗</span>';
}

async function searchRecipes(query) {
  queryInput.value = query;
  setLoading(true);
  welcome.hidden = true;
  favoritesSection.hidden = true;
  personalSection.hidden = true;
  resultsSection.hidden = false;
  resultsTitle.textContent = "Ricette: " + query;
  resultCount.textContent = "Ricerca in corso";
  resultsGrid.innerHTML = '<div class="empty-state">Sto cercando tra i siti di cucina...</div>';
  try {
    const response = await fetch("/api/search?q=" + encodeURIComponent(query));
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      throw new Error("Il servizio di ricerca ha restituito una pagina non valida. Riprova tra qualche secondo.");
    }
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || "Ricerca non disponibile.");
    const results = data.results || [];
    resultCount.textContent = results.length + (results.length === 1 ? " risultato" : " risultati");
    if (!results.length) {
      resultsGrid.innerHTML = '<div class="empty-state">Nessuna ricetta trovata. Prova con un altro ingrediente o piatto.</div>';
      return;
    }
    favoritesSection.hidden = true;
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
    resultsGrid.innerHTML = '<div class="error-state">' + esc(error.message) + '<br><br>Controlla la configurazione della ricerca e riprova.</div>';
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
    const savedItem = { url, title: data.title || fallback.title || "Ricetta", image: data.image || fallback.image || "", source: data.source || fallback.source || "", description: fallback.description || "" };
    recipeContent.innerHTML = '<span class="result-source">' + esc(data.source || fallback.source || "Fonte originale") + '</span>' +
      '<h2 id="recipe-title">' + esc(data.title || fallback.title || "Ricetta") + '</h2><div class="recipe-meta">' + meta + '</div>' +
      '<button type="button" id="toggle-favorite" class="favorite-toggle" aria-pressed="' + isFavorite(url) + '">' + (isFavorite(url) ? "♥ Ricetta preferita" : "♡ Ricetta preferita") + '</button>' +
      image + '<h3>Ingredienti</h3>' + ingredientList + '<h3>Preparazione</h3>' + steps;
    document.querySelector("#toggle-favorite").addEventListener("click", () => {
      const active = toggleFavorite(savedItem); const button = document.querySelector("#toggle-favorite");
      button.textContent = active ? "♥ Ricetta preferita" : "♡ Ricetta preferita"; button.setAttribute("aria-pressed", String(active));
    });
  } catch (error) {
    recipeContent.innerHTML = '<div class="error-state">' + esc(error.message) + '</div>';
  }
}

personalCount.textContent = getPersonalRecipes().length;
personalButton.addEventListener("click", showPersonal);
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
    items.unshift({ id: String(Date.now()), title, ingredients, steps, time, photo });
    savePersonalRecipes(items);
    event.target.reset(); renderPersonalRecipes(); notify("Ricetta personale salvata.");
  } catch (error) { notify(error.message || "Non riesco a salvare la foto."); }
});
favoritesButton.addEventListener("click", showFavorites);
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
