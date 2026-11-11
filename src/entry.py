from __future__ import annotations

import os
from urllib.parse import urlparse

import httpx
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import Response
from recipe_scrapers import scrape_html
from workers import asgi

app = FastAPI(title="Recipe Finder API", docs_url=None, redoc_url=None)

ALLOWED_SITES = {
    "giallozafferano.it",
    "cookist.it",
    "cucchiaio.it",
    "fattoincasadabenedetta.it",
    "ricettedellanonna.net",
}
BRAVE_ENDPOINT = "https://api.search.brave.com/res/v1/web/search"
USER_AGENT = "RecipeFinder/0.1 (recipe search; respects publisher access controls)"


def allowed_host(url: str) -> str | None:
    try:
        parsed = urlparse(url)
        host = (parsed.hostname or "").lower().rstrip(".").removeprefix("www.")
        if parsed.scheme != "https" or host not in ALLOWED_SITES:
            return None
        return host
    except ValueError:
        return None


def recipe_to_dict(scraper) -> dict:
    def value(name: str, default=None):
        try:
            result = getattr(scraper, name)()
            return result if result not in ("", [], None) else default
        except Exception:
            return default

    instructions = value("instructions", []) or []
    if isinstance(instructions, str):
        instructions = [line.strip() for line in instructions.splitlines() if line.strip()]

    return {
        "title": value("title", "Ricetta"),
        "image": value("image"),
        "description": value("description"),
        "ingredients": value("ingredients", []) or [],
        "instructions": instructions,
        "total_time": value("total_time"),
        "prep_time": value("prep_time"),
        "cook_time": value("cook_time"),
        "yields": value("yields"),
        "author": value("author"),
        "source": value("host"),
        "url": value("canonical_url") or value("url"),
    }


@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "recipe-finder"}


@app.get("/api/sites")
async def sites():
    return {"sites": sorted(ALLOWED_SITES)}


@app.get("/api/search")
async def search(request: Request, q: str = Query(min_length=2, max_length=100)):
    env = request.scope["env"]
    api_key = getattr(env, "BRAVE_SEARCH_API_KEY", None) or os.environ.get("BRAVE_SEARCH_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="Ricerca non configurata: aggiungi BRAVE_SEARCH_API_KEY ai secrets del Worker.",
        )

    site_filter = " OR ".join("site:" + site for site in sorted(ALLOWED_SITES))
    params = {"q": q + " (" + site_filter + ")", "count": "15", "search_lang": "it"}
    headers = {"Accept": "application/json", "X-Subscription-Token": api_key}

    try:
        async with httpx.AsyncClient(timeout=12.0, follow_redirects=False) as client:
            response = await client.get(BRAVE_ENDPOINT, params=params, headers=headers)
            response.raise_for_status()
            payload = response.json()
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=502, detail="Il servizio di ricerca non ha accettato la richiesta.") from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Servizio di ricerca temporaneamente non disponibile.") from exc

    results = []
    for item in payload.get("web", {}).get("results", []):
        url = item.get("url", "")
        host = allowed_host(url)
        if host:
            results.append({
                "title": item.get("title") or "Ricetta",
                "url": url,
                "description": item.get("description") or "",
                "source": host,
                "image": None,
            })
    return {"query": q, "results": results}


@app.get("/api/recipe")
async def recipe(url: str = Query(min_length=12, max_length=2000)):
    host = allowed_host(url)
    if not host:
        raise HTTPException(status_code=400, detail="Il sito di questa ricetta non è nella lista delle fonti consentite.")

    try:
        async with httpx.AsyncClient(
            timeout=12.0,
            follow_redirects=False,
            headers={"User-Agent": USER_AGENT, "Accept": "text/html"},
        ) as client:
            response = await client.get(url)
            response.raise_for_status()
            if "text/html" not in response.headers.get("content-type", "").lower():
                raise HTTPException(status_code=415, detail="La pagina selezionata non è una pagina HTML.")
            html = response.text

        scraper = scrape_html(html=html, org_url=url)
        data = recipe_to_dict(scraper)
        data["source"] = host
        data["url"] = url
        if not data["ingredients"] and not data["instructions"]:
            raise HTTPException(status_code=422, detail="Non sono riuscito a trovare i dati della ricetta in questa pagina.")
        return data
    except HTTPException:
        raise
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=502, detail="Il sito non ha consentito di recuperare la pagina.") from exc
    except Exception as exc:
        raise HTTPException(status_code=422, detail="Impossibile estrarre la ricetta da questa pagina.") from exc


async def serve_asset(request: Request, path: str):
    env = request.scope["env"]
    asset_response = await env.ASSETS.fetch("https://assets.local/" + path)
    body = await asset_response.bytes()
    headers = {}
    for name in ("content-type", "cache-control", "etag", "last-modified"):
        value = asset_response.headers.get(name)
        if value:
            headers[name] = value
    return Response(content=body, status_code=asset_response.status, headers=headers)


@app.get("/")
async def frontend_root(request: Request):
    return await serve_asset(request, "index.html")


@app.get("/{path:path}")
async def frontend(path: str, request: Request):
    if path.startswith("api/"):
        raise HTTPException(status_code=404, detail="Endpoint non trovato.")
    return await serve_asset(request, path or "index.html")


Default = asgi.entrypoint(app)
