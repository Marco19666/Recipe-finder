# Recipe Finder

Applicazione web in italiano per cercare ricette su siti di cucina selezionati e leggere ingredienti e procedimento.

## Stack
- Python 3.13 + FastAPI
- DuckDuckGo HTML Search per cercare ricette senza API key
- recipe-scrapers per estrarre i dati delle ricette dalle pagine HTML
- Cloudflare Python Workers + Workers Static Assets
- HTML, CSS e JavaScript vanilla per il frontend
- GitHub Actions per il deploy automatico a ogni push su main

## Fonti iniziali
- Misya — misya.info
- Cookist — cookist.it
- Cucchiaio d'Argento — cucchiaio.it
- Fatto in casa da Benedetta — fattoincasadabenedetta.it
- Ricette della Nonna — ricettedellanonna.net

La ricerca invia a DuckDuckGo una query con filtro sui domini consentiti e mostra soltanto risultati appartenenti a queste fonti. L'estrazione legge soltanto pagine dei domini consentiti. Non aggira paywall, CAPTCHA o altre protezioni: gli accessi negati vengono segnalati.

## API
- GET /api/health — stato del servizio
- GET /api/sites — fonti abilitate
- GET /api/search?q=pasta%20alla%20carbonara — risultati di ricerca
- GET /api/recipe?url=... — dati strutturati della ricetta

## Requisiti
- Account Cloudflare
- Node.js e uv per sviluppo e deploy
- Nessuna API key per la ricerca

## Sviluppo locale
1. Installa Node.js e uv.
2. Installa Wrangler e Pywrangler seguendo la guida ufficiale Cloudflare Python Workers.
3. Avvia il progetto con: `uv run pywrangler dev`
4. Apri http://localhost:8787.

## Deploy automatico con GitHub Actions
Il workflow `.github/workflows/deploy.yml` pubblica il Worker su Cloudflare a ogni push sul branch main.

Nel repository GitHub, apri Settings → Secrets and variables → Actions e crea questi repository secrets:
- `CLOUDFLARE_API_TOKEN` — token Cloudflare con permessi di deploy Workers
- `CLOUDFLARE_ACCOUNT_ID` — ID del tuo account Cloudflare

Non serve configurare alcuna chiave per il motore di ricerca. Dopo aver configurato i due secrets GitHub, esegui un push su main oppure avvia manualmente il workflow dalla scheda Actions.

## Deploy manuale
Dalla root del repository esegui: `uv run pywrangler deploy`.

## Nota di compatibilità
Cloudflare Python Workers usa Pyodide/WebAssembly. FastAPI è supportato ufficialmente; la compatibilità completa di recipe-scrapers e delle sue dipendenze va verificata dal primo deploy. Anche DuckDuckGo può limitare o bloccare richieste automatiche e non offre garanzia di disponibilità o quote. Se la ricerca restituisce temporaneamente un errore o nessun risultato, riprova più tardi. Se una dipendenza nativa non è disponibile, servirà un adattamento o un runtime Python tradizionale. Non considerare il deploy riuscito finché la ricerca e l'estrazione reale non sono state testate.

## Note legali e operative
- Le pagine e i contenuti restano di proprietà dei rispettivi editori. L'app mostra il link alla fonte originale.
- Rispettare termini d'uso, robots directives, copyright e limiti di accesso di ogni sito.
- Non inserire mai chiavi API nel frontend o nel repository.
