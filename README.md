# Recipe Finder

Applicazione web in italiano per cercare ricette su siti di cucina selezionati e leggere ingredienti e procedimento.

## Stack
- Python 3.13 + FastAPI
- recipe-scrapers per estrarre i dati delle ricette dalle pagine HTML
- Cloudflare Python Workers + Workers Static Assets
- HTML, CSS e JavaScript vanilla per il frontend
- Brave Search API per la ricerca limitata ai domini selezionati

## Fonti iniziali
- GialloZafferano — giallozafferano.it
- Cookist — cookist.it
- Cucchiaio d'Argento — cucchiaio.it
- Fatto in casa da Benedetta — fattoincasadabenedetta.it
- Ricette della Nonna — ricettedellanonna.net

La ricerca usa un filtro di dominio e l'API Brave Search. L'estrazione legge soltanto pagine dei domini consentiti. Non aggira paywall, CAPTCHA o altre protezioni: gli accessi negati vengono segnalati.

## API
- GET /api/health — stato del servizio
- GET /api/sites — fonti abilitate
- GET /api/search?q=pasta%20alla%20carbonara — risultati di ricerca
- GET /api/recipe?url=... — dati strutturati della ricetta

## Requisiti
- Account Cloudflare
- Node.js e uv per sviluppo e deploy
- Una chiave API Brave Search: https://brave.com/search/api/

## Sviluppo locale
1. Installa Node.js e uv.
2. Installa Wrangler e Pywrangler seguendo la guida ufficiale Cloudflare Python Workers.
3. Crea un file .dev.vars nella root e aggiungi BRAVE_SEARCH_API_KEY con la tua chiave.
4. Avvia il progetto con: uv run pywrangler dev
5. Apri http://localhost:8787.

## Deploy su Cloudflare
Dalla root del repository:
1. Aggiungi il secret con: uv run pywrangler secret put BRAVE_SEARCH_API_KEY
2. Esegui il deploy con: uv run pywrangler deploy

Inserisci la chiave quando richiesta.

## Collegamento GitHub
Il progetto è un singolo Cloudflare Worker che serve sia l'API FastAPI sia i file statici dalla cartella public/. Per mantenere una sola origine e un solo deploy, collega il repository a Workers Builds.

Nel dashboard Cloudflare:
1. Workers & Pages → Create → Workers.
2. Connect to Git → seleziona Marco19666/Recipe-finder.
3. Configura il comando di build/deploy secondo la guida Python Workers e usa uv run pywrangler deploy.
4. Aggiungi BRAVE_SEARCH_API_KEY in Settings → Variables and Secrets come secret.
5. Avvia il primo deploy e verifica /api/health.

## Nota di compatibilità
Cloudflare Python Workers usa Pyodide/WebAssembly. FastAPI è supportato ufficialmente; la compatibilità completa di recipe-scrapers e delle sue dipendenze va verificata con pywrangler dev e con un deploy di prova. Se una dipendenza nativa non è disponibile, servirà un adattamento o un runtime Python tradizionale. Non considerare il deploy riuscito finché l'estrazione reale non è stata testata.

## Note legali e operative
- Le pagine e i contenuti restano di proprietà dei rispettivi editori. L'app mostra il link alla fonte originale.
- Rispettare termini d'uso, robots directives, copyright e limiti di accesso di ogni sito.
- Non inserire mai chiavi API nel frontend o nel repository.
