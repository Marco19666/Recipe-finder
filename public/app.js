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
  resultsSection.hidden = false;
  resultsTitle.textContent = "Ricette: " + query;
  resultCount.textContent = "Ricerca in corso";
  resultsGrid.innerHTML = '<div class="empty-state">Sto cercando tra i siti di cucina...</div>';
  try {
    const response = await fetch("/api/search?q=" + encodeURIComponent(query));
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || "Ricerca non disponibile.");
    const results = data.results || [];
    resultCount.textContent = results.length + (results.length === 1 ? " risultato" : " risultati");
    if (!results.length) {
      resultsGrid.innerHTML = '<div class="empty-state">Nessuna ricetta trovata. Prova con un altro ingrediente o piatto.</div>';
      return;
    }
    resultsGrid.innerHTML = results.map((item, index) => {
      const image = item.image ? '<img class="result-image" src="' + esc(item.image) + '" alt="" loading="lazy" referrerpolicy="no-referrer">' : '<div class="result-placeholder">✳</div>';
      const description = esc((item.description || "").slice(0, 150)) + ((item.description || "").length > 150 ? "…" : "");
      return '<article class="result-card">' + image +
        '<div class="result-body"><span class="result-source">' + esc(item.source) + '</span>' +
        '<h3>' + esc(item.title) + '</h3><p>' + description + '</p>' +
        '<div class="card-actions"><a class="text-link" href="' + esc(item.url) + '" target="_blank" rel="noopener noreferrer">Fonte originale ↗</a>' +
        '<button class="recipe-button" data-recipe="' + index + '">Ingredienti e procedimento</button></div></div></article>';
    }).join("");
    resultsGrid.querySelectorAll("[data-recipe]").forEach(button => {
      button.addEventListener("click", () => loadRecipe(results[Number(button.dataset.recipe)].url));
    });
  } catch (error) {
    resultsGrid.innerHTML = '<div class="error-state">' + esc(error.message) + '<br><br>Controlla la configurazione della ricerca e riprova.</div>';
    resultCount.textContent = "Ricerca non riuscita";
  } finally {
    setLoading(false);
  }
}

async function loadRecipe(url) {
  modal.hidden = false;
  document.body.style.overflow = "hidden";
  recipeContent.innerHTML = '<div class="empty-state">Sto leggendo la ricetta dalla fonte originale...</div>';
  try {
    const response = await fetch("/api/recipe?url=" + encodeURIComponent(url));
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
    recipeContent.innerHTML = '<span class="result-source">' + esc(data.source || "Fonte originale") + '</span>' +
      '<h2 id="recipe-title">' + esc(data.title || "Ricetta") + '</h2><div class="recipe-meta">' + meta + '</div>' +
      image + '<h3>Ingredienti</h3>' + ingredientList + '<h3>Preparazione</h3>' + steps +
      '<a class="source-visit" href="' + esc(data.url || url) + '" target="_blank" rel="noopener noreferrer">Vai alla ricetta originale ↗</a>';
  } catch (error) {
    recipeContent.innerHTML = '<div class="error-state">' + esc(error.message) + '<br><br><a class="text-link" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">Apri il sito originale ↗</a></div>';
  }
}

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
