from __future__ import annotations

import os
from html.parser import HTMLParser
from urllib.parse import parse_qs, urlparse

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
DUCKDUCKGO_ENDPOINT = "https://html.duckduckgo.com/html/"
USER_AGENT = "Mozilla/5.0 (compatible; RecipeFinder/0.1; recipe search)"
RECIPE_USER_AGENT = "RecipeFinder/0.1 (recipe search; respects publisher access controls)"


class DuckDuckGoResultsParser(HTMLParser):
    """Extract ordinary web results from DuckDuckGo's HTML results page."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.results = []
        self._current = None
        self._capture = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        classes = attrs.get("class", "").split()

        if tag == "a" and "result__a" in classes:
            self._current = {
                "title": "",
                "url": attrs.get("href", ""),
                "description": "",
            }
            self._capture = "title"
        elif self._current is not None and "result__snippet" in classes:
            self._capture = "description"

    def handle_data(self, data):
        if self._current is not None and self._capture:
            self._current[self._capture] += data

    def handle_endtag(self, tag):
        if self._current is None:
            return
        if tag == "a" and self._capture == "title":
            self._capture = None
            url = self._current["url"]
            if url:
                self.results.append(self._current)
                self._current = None
        elif self._capture == "description" and tag in ("td", "div"):
            self._capture = None


def allowed_host(url: str) -> str | None:
    try:
        parsed = urlparse(url)
        host = (parsed.hostname or "").lower().rstrip(".").removeprefix("www.")
        if parsed.scheme != "https" or host not in ALLOWED_SITES:
            return None
        return host
    except ValueError:
        return None


def direct_result_url(url: str) -> str:
    """Unwrap DuckDuckGo redirect links without following arbitrary redirects."""
    parsed = urlparse(url)
    if parsed.hostname and parsed.hostname.endswith("duckduckgo.com"):
        target = parse_qs(parsed.query).get("uddg", [None])[0]
        if target:
            return target
    return url


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
async def search(q: str = Query(min_length=2, max_length=100)):
    site_filter = " OR ".join("site:" + site for site in sorted(ALLOWED_SITES))
    search_query = q + " (" + site_filter + ")"
    params = {"q": search_query, "kl": "it-it"}

    try:
        async with httpx.AsyncClient(
            timeout=15.0,
            follow_redirects=False,
            headers={
                "User-Agent": USER_AGENT,
                "Accept": "text/html,application/xhtml+xml",
            },
        ) as client:
            response = await client.get(DUCKDUCKGO_ENDPOINT, params=params)
            response.raise_for_status()
            parser = DuckDuckGoResultsParser()
            parser.feed(response.text)
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=502, detail="DuckDuckGo non ha accettato la richiesta. Riprova più tardi.") from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Ricerca temporaneamente non disponibile. Riprova più tardi.") from exc

    results = []
    seen = set()
    for item in parser.results:
        url = direct_result_url(item["url"])
        host = allowed_host(url)
        if host and url not in seen:
            seen.add(url)
            results.append({
                "title": " ".join(item["title"].split()) or "Ricetta",
                "url": url,
                "description": " ".join(item["description"].split()),
                "source": host,
                "image": None,
            })
        if len(results) >= 15:
            break

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
            headers={"User-Agent": RECIPE_USER_AGENT, "Accept": "text/html"},
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
