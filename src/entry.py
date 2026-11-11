from __future__ import annotations

import json
from html.parser import HTMLParser
from urllib.parse import parse_qs, urljoin, urlparse

import httpx
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import Response
from workers import asgi

app = FastAPI(title="Recipe Finder API", docs_url=None, redoc_url=None)

ALLOWED_SITES = {
    "misya.info",
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
        self._active = None
        self._capture = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        classes = attrs.get("class", "").split()

        if tag == "a" and "result__a" in classes:
            self._active = {"title": "", "url": attrs.get("href", ""), "description": ""}
            self.results.append(self._active)
            self._capture = "title"
        elif tag == "a" and "result__snippet" in classes and self._active is not None:
            self._capture = "description"

    def handle_data(self, data):
        if self._active is not None and self._capture:
            self._active[self._capture] += data

    def handle_endtag(self, tag):
        if tag == "a":
            self._capture = None


class JsonLdParser(HTMLParser):
    """Collect JSON-LD script contents without external HTML/XML dependencies."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.scripts = []
        self._inside = False
        self._parts = []

    def handle_starttag(self, tag, attrs):
        if tag == "script":
            attrs = dict(attrs)
            if "ld+json" in attrs.get("type", "").lower():
                self._inside = True
                self._parts = []

    def handle_data(self, data):
        if self._inside:
            self._parts.append(data)

    def handle_endtag(self, tag):
        if tag == "script" and self._inside:
            self.scripts.append("".join(self._parts))
            self._inside = False
            self._parts = []


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


def _walk_json(value):
    """Yield dictionaries containing structured data, including nested graphs."""
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from _walk_json(child)
    elif isinstance(value, list):
        for child in value:
            yield from _walk_json(child)


def _is_recipe(data):
    kind = data.get("@type", [])
    if isinstance(kind, str):
        kind = [kind]
    return any(str(item).rsplit("/", 1)[-1].rsplit("#", 1)[-1] == "Recipe" for item in kind)


def _as_text(value):
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, dict):
        return str(value.get("name") or value.get("text") or "").strip()
    return ""


def _instructions(value):
    result = []
    def add(item):
        if isinstance(item, str):
            text = item.strip()
            if text:
                result.append(text)
        elif isinstance(item, list):
            for child in item:
                add(child)
        elif isinstance(item, dict):
            if item.get("@type") == "HowToSection":
                add(item.get("itemListElement") or item.get("steps") or [])
            else:
                add(item.get("text") or item.get("name") or item.get("itemListElement") or "")
    add(value)
    return result


def _minutes(value):
    if not isinstance(value, str):
        return None
    # Schema.org durations are commonly expressed as PT1H30M.
    import re
    match = re.fullmatch(r"PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?", value.strip(), re.I)
    if not match:
        return value
    hours, minutes, seconds = (float(part or 0) for part in match.groups())
    total = round(hours * 60 + minutes + seconds / 60)
    return total or None


def extract_recipe(html: str, url: str) -> dict:
    parser = JsonLdParser()
    parser.feed(html)
    recipe_data = None
    for script in parser.scripts:
        try:
            structured = json.loads(script.strip().removeprefix("\ufeff"))
        except (json.JSONDecodeError, TypeError):
            continue
        recipe_data = next((item for item in _walk_json(structured) if _is_recipe(item)), None)
        if recipe_data:
            break

    if not recipe_data:
        raise ValueError("Nessun dato Recipe JSON-LD trovato")

    image = recipe_data.get("image")
    if isinstance(image, list):
        image = next((_as_text(item) for item in image if _as_text(item)), None)
    elif isinstance(image, dict):
        image = image.get("url") or image.get("contentUrl")

    author = recipe_data.get("author")
    if isinstance(author, list):
        author = ", ".join(filter(None, (_as_text(item) for item in author)))
    else:
        author = _as_text(author) or None

    return {
        "title": _as_text(recipe_data.get("name")) or "Ricetta",
        "image": image if isinstance(image, str) else None,
        "description": _as_text(recipe_data.get("description")) or None,
        "ingredients": recipe_data.get("recipeIngredient") or [],
        "instructions": _instructions(recipe_data.get("recipeInstructions")),
        "total_time": _minutes(recipe_data.get("totalTime")),
        "prep_time": _minutes(recipe_data.get("prepTime")),
        "cook_time": _minutes(recipe_data.get("cookTime")),
        "yields": _as_text(recipe_data.get("recipeYield")) or None,
        "author": author,
        "source": urlparse(url).hostname,
        "url": recipe_data.get("url") or url,
    }


@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "recipe-finder"}


@app.get("/api/sites")
async def sites():
    return {"sites": sorted(ALLOWED_SITES)}


class SiteSearchParser(HTMLParser):
    """Collect links from a publisher's own search page."""
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.links = []
        self._link = None

    def handle_starttag(self, tag, attrs):
        if tag == "a":
            attrs = dict(attrs)
            href = attrs.get("href", "")
            if href:
                self._link = {"url": href, "title": ""}
                self.links.append(self._link)

    def handle_data(self, data):
        if self._link is not None:
            self._link["title"] += data

    def handle_endtag(self, tag):
        if tag == "a":
            self._link = None


def _looks_like_recipe_url(url: str) -> bool:
    path = urlparse(url).path.lower()
    excluded = ("/tag/", "/category/", "/author/", "/page/", "/search", "/ricette/", "/ricette")
    if any(part in path for part in excluded):
        return False
    return any(part in path for part in ("/ricetta/", "/recipe/", "/ricette-", "/ricetta-")) or path.count("/") >= 2


async def _search_one_site(client: httpx.AsyncClient, site: str, query: str) -> list[dict]:
    base = "https://" + site
    # Try the publisher's public WordPress search API first; no third-party search engine.
    api_url = base + "/wp-json/wp/v2/search"
    try:
        response = await client.get(api_url, params={"search": query, "per_page": 10, "type": "post"})
        if response.status_code == 200:
            payload = response.json()
            found = []
            for item in payload if isinstance(payload, list) else []:
                url = item.get("url", "")
                title = item.get("title", "")
                if isinstance(title, dict):
                    title = title.get("rendered", "")
                if allowed_host(url) and _looks_like_recipe_url(url) and title:
                    found.append({"title": " ".join(str(title).split()), "url": url,
                                  "description": "", "source": site, "image": None})
            if found:
                return found
    except Exception:
        pass

    # Fallback: use the site's own search page.
    try:
        response = await client.get(base + "/", params={"s": query})
        if response.status_code != 200 or "html" not in response.headers.get("content-type", "").lower():
            return []
        parser = SiteSearchParser()
        parser.feed(response.text)
        found, seen = [], set()
        terms = [term.casefold() for term in query.split() if len(term) > 2]
        for item in parser.links:
            url = urljoin(str(response.url), item["url"])
            title = " ".join(item["title"].split())
            if (not title or url in seen or not allowed_host(url)
                    or not _looks_like_recipe_url(url)):
                continue
            if terms and not any(term in title.casefold() for term in terms):
                continue
            seen.add(url)
            found.append({"title": title, "url": url, "description": "",
                          "source": site, "image": None})
            if len(found) >= 8:
                break
        return found
    except Exception:
        return []


@app.get("/api/search")
async def search(q: str = Query(min_length=2, max_length=100)):
    """Search each approved publisher directly, without DuckDuckGo or paid APIs."""
    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(12.0, connect=6.0),
            follow_redirects=True,
            headers={"User-Agent": RECIPE_USER_AGENT, "Accept": "text/html,application/json"},
        ) as client:
            batches = await __import__("asyncio").gather(
                *(_search_one_site(client, site, q) for site in sorted(ALLOWED_SITES)),
                return_exceptions=True,
            )
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Non riesco a contattare i siti di ricette. Riprova più tardi.") from exc

    results, seen = [], set()
    for batch in batches:
        if isinstance(batch, Exception):
            continue
        for item in batch:
            if item["url"] not in seen:
                seen.add(item["url"])
                results.append(item)
            if len(results) >= 20:
                break
        if len(results) >= 20:
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

        data = extract_recipe(html, url)
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
