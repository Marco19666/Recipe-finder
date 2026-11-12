from __future__ import annotations

import asyncio
import json
from html.parser import HTMLParser
from urllib.parse import parse_qs, urljoin, urlparse

import httpx
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import Response
from workers import asgi

app = FastAPI(title="Recipe Finder API", docs_url=None, redoc_url=None)


@app.middleware("http")
async def enforce_utf8_charset(request: Request, call_next):
    response = await call_next(request)
    content_type = response.headers.get("content-type", "")
    if content_type.startswith(("application/json", "text/")) and "charset=" not in content_type.lower():
        response.headers["content-type"] = content_type + "; charset=utf-8"
    if content_type.startswith("application/json"):
        response.headers["cache-control"] = "no-store"
    return response


def decode_html_response(response: httpx.Response) -> str:
    """Decode publisher HTML using its declared charset, with safe UTF-8/Windows fallback."""
    raw = response.content
    if raw.startswith(b"\xef\xbb\xbf"):
        return raw.decode("utf-8-sig", errors="replace")
    import re
    candidates = []
    content_type = response.headers.get("content-type", "")
    header_match = re.search(r"""charset\s*=\s*["\']?([\w.-]+)""", content_type, re.I)
    if header_match:
        candidates.append(header_match.group(1))
    meta = raw[:8192].decode("ascii", errors="ignore")
    meta_match = re.search(r"""<meta[^>]+charset\s*=\s*["\']?([\w.-]+)""", meta, re.I)
    if meta_match:
        candidates.append(meta_match.group(1))
    candidates.extend(["utf-8", "windows-1252"])
    tried = set()
    for encoding in candidates:
        key = encoding.lower()
        if key in tried:
            continue
        tried.add(key)
        try:
            return raw.decode(encoding, errors="strict")
        except (LookupError, UnicodeDecodeError):
            continue
    return raw.decode("utf-8", errors="replace")

ALLOWED_SITES = {
    "misya.info",
    "cookist.it",
    "cucchiaio.it",
    "fattoincasadabenedetta.it",
    "ricettedellanonna.net",
    "tavolartegusto.it",
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

def _calories(value):
    """Read calories from Schema.org NutritionInformation when explicitly provided."""
    import re
    if isinstance(value, (int, float)) and value >= 0:
        return round(value)
    if isinstance(value, str):
        match = re.search(r"\d+(?:[.,]\d+)?", value)
        if match and ("kcal" in value.lower() or "calor" in value.lower()):
            return round(float(match.group(0).replace(",", ".")))
    return None


def _estimate_recipe_calories(ingredients, yields):
    """Stima indicativa delle kcal per porzione; rifiuta ingredienti calorici non quantificabili."""
    import re
    import unicodedata

    foods = {
        "spaghetti":353,"pasta":353,"penne":353,"riso":360,"farina":364,
        "zucchero":400,"olio":884,"burro":717,"uova":143,"uovo":143,
        "latte":61,"panna":340,"parmigiano":402,"grana":398,"mozzarella":250,
        "ricotta":174,"passata":30,"pomodoro":18,"zucchine":17,"zucchina":17,
        "melanzane":25,"melanzana":25,"carote":41,"carota":41,"cipolla":40,
        "aglio":149,"patate":77,"patata":77,"pollo":165,"manzo":250,
        "macinato":250,"trita":250,"carne":250,"vitello":172,"maiale":242,
        "tonno":132,"salmone":208,"prosciutto":145,"pancetta":458,
        "speck":303,"salsiccia":301,"pane":265,"pangrattato":395,"mollica":265,
        "miele":304,"cioccolato":546,"cacao":228,"mandorle":579,"noci":654,
        "nocciole":628,"limone":29,"arancia":47,"mela":52,"spinaci":23,
        "funghi":22,"broccoli":34,"peperoni":31,"peperone":31,"piselli":81,
        "ceci":164,"fagioli":127,"lenticchie":116,"yogurt":61,"mascarpone":420,
        "couscous":376,"basilico":23,"prezzemolo":36,"rosmarino":131,"origano":265,
        "noce moscata":525,"parmigiano reggiano":402,"pecorino":387,
        "formaggio":350,"scamorza":334,"ricotta":174,"funghi":22,
        "sedano":16,"carciofi":47,"zucca":26,"cavolfiore":25,"verza":27,
        "melanzana":25,"pangrattato":395,"farina di mais":370
    }
    negligible = (
        "sale", "pepe", "acqua", "prezzemolo", "basilico", "rosmarino",
        "origano", "salvia", "timo", "erba cipollina", "noce moscata",
        "cannella", "paprika", "peperoncino", "menta", "alloro"
    )

    def norm(value):
        value = unicodedata.normalize("NFKD", str(value).casefold())
        return "".join(ch for ch in value if not unicodedata.combining(ch))

    yield_text = " ".join(_as_text(v) or str(v) for v in yields) if isinstance(yields, list) else str(yields or "")
    pm = re.search(r"\d+(?:[.,]\d+)?", yield_text)
    portions = float(pm.group().replace(",", ".")) if pm else 0
    if portions <= 0 or not isinstance(ingredients, list) or not ingredients:
        return None

    total = 0.0
    counted = 0
    for raw in ingredients:
        if isinstance(raw, dict):
            raw = " ".join(str(raw.get(k, "")) for k in ("value", "unitText", "name", "text"))
        text = norm(raw)
        if not text:
            continue
        if "q.b." in text or "quanto basta" in text:
            continue
        # Spezie ed erbe senza quantità hanno un contributo calorico trascurabile.
        if any(re.search(r"\b" + re.escape(item) + r"\b", text) for item in negligible):
            if not re.match(r"^\s*\d", text):
                continue
            if re.match(r"^\s*\d+(?:[.,]\d+)?\s*(?:g|gr|grammi?)\b", text):
                continue
            # Quantità minime di erbe/spezie non incidono in modo apprezzabile.
            continue

        m = re.match(
            r"^\s*(\d+\s+\d+/\d+|\d+/\d+|\d+(?:[.,]\d+)?)\s*"
            r"(chilogrammi?|kg|grammi?|gr?|millilitri?|ml|litri?|litro|l|uova?|"
            r"cucchiai?|cucchiaini?|bicchieri?|spicchi?|fette?|foglie?|rametti?|"
            r"pizzichi?|pizzico|)\b", text
        )
        if not m:
            return None
        token = m.group(1).strip()
        if " " in token:
            whole, fraction = token.split()
            amount = float(whole) + float(fraction.split("/")[0]) / float(fraction.split("/")[1])
        elif "/" in token:
            amount = float(token.split("/")[0]) / float(token.split("/")[1])
        else:
            amount = float(token.replace(",", "."))
        unit = (m.group(2) or "").strip()
        rest = text[m.end():].strip(" ,.-")
        kcal = next((v for key, v in sorted(foods.items(), key=lambda item: len(item[0]), reverse=True)
                     if re.search(r"\b" + re.escape(key) + r"\b", rest)), None)
        if kcal is None:
            # Quantità non misurabili di erbe/spezie possono essere ignorate;
            # per gli altri ingredienti si evita una stima gravemente incompleta.
            if any(re.search(r"\b" + re.escape(item) + r"\b", rest) for item in negligible):
                continue
            return None

        if unit in ("kg", "chilogrammo", "chilogrammi", "l", "litro", "litri"):
            grams = amount * 1000
        elif unit in ("ml", "millilitro", "millilitri"):
            grams = amount
        elif unit in ("uovo", "uova"):
            grams = amount * 60
        elif unit.startswith("cucchiaio"):
            grams = amount * 10
        elif unit.startswith("cucchiaino"):
            grams = amount * 5
        elif unit.startswith("bicchier"):
            grams = amount * 200
        elif unit.startswith("spicchio"):
            grams = amount * 3
        elif unit.startswith("fetta"):
            grams = amount * 30
        elif unit.startswith("foglia"):
            grams = amount
        elif unit.startswith("rametto"):
            grams = amount * 2
        elif unit.startswith("pizzich"):
            grams = amount * 0.5
        else:
            grams = amount
        total += grams * kcal / 100
        counted += 1

    return round(total / portions) if counted else None

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

    nutrition = recipe_data.get("nutrition")
    calories_per_serving = _calories(nutrition.get("calories")) if isinstance(nutrition, dict) else None
    calories_estimated = calories_per_serving is None
    yield_value = recipe_data.get("recipeYield")
    if isinstance(yield_value, list):
        yields_text = " ".join((_as_text(value) or str(value)) for value in yield_value if value is not None)
    elif yield_value is not None:
        yields_text = _as_text(yield_value) or str(yield_value)
    else:
        yields_text = ""
    if calories_estimated:
        calories_per_serving = _estimate_recipe_calories(
            recipe_data.get("recipeIngredient") or [],
            yields_text or None,
        )

    return {
        "title": _as_text(recipe_data.get("name")) or "Ricetta",
        "image": image if isinstance(image, str) else None,
        "description": _as_text(recipe_data.get("description")) or None,
        "ingredients": recipe_data.get("recipeIngredient") or [],
        "instructions": _instructions(recipe_data.get("recipeInstructions")),
        "total_time": _minutes(recipe_data.get("totalTime")),
        "prep_time": _minutes(recipe_data.get("prepTime")),
        "cook_time": _minutes(recipe_data.get("cookTime")),
        "yields": yields_text or None,
        "calories_per_serving": calories_per_serving,
        "calories_estimated": bool(calories_estimated and calories_per_serving is not None),
        "source": urlparse(url).hostname,
        "url": recipe_data.get("url") or url,
    }


@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "recipe-finder"}


@app.get("/api/sites")
async def sites():
    return {"sites": sorted(ALLOWED_SITES)}


class PageMetaParser(HTMLParser):
    """Read the representative image and description from a recipe page."""
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.image = None
        self.description = None

    def handle_starttag(self, tag, attrs):
        if tag != "meta":
            return
        attrs = dict(attrs)
        key = (attrs.get("property") or attrs.get("name") or "").lower()
        value = attrs.get("content", "").strip()
        if key in ("og:image", "og:image:url", "twitter:image") and value and not self.image:
            self.image = value
        elif key in ("og:description", "description") and value and not self.description:
            self.description = value


def _is_complete_recipe(data: dict) -> bool:
    """A usable recipe must include a real title, ingredients, and procedure."""
    title = str(data.get("title") or "").strip()
    ingredients = data.get("ingredients")
    instructions = data.get("instructions")
    if not title or title.casefold() in {"ricetta", "recipe", "senza titolo"}:
        return False
    if not isinstance(ingredients, list) or not any(str(value).strip() for value in ingredients):
        return False
    if not isinstance(instructions, list) or not any(str(value).strip() for value in instructions):
        return False
    return True


async def _add_result_image(client: httpx.AsyncClient, item: dict) -> dict:
    # This page fetch is already needed for the card image. Reuse its HTML
    # to validate structured recipe data, avoiding any additional network call.
    item["_valid_recipe"] = False
    try:
        response = await client.get(item["url"])
        if response.status_code == 200 and "html" in response.headers.get("content-type", "").lower():
            html = decode_html_response(response)
            parser = PageMetaParser()
            parser.feed(html[:300000])
            if parser.image:
                image_url = urljoin(str(response.url), parser.image)
                if urlparse(image_url).scheme in ("http", "https"):
                    item["image"] = image_url
            if parser.description:
                item["description"] = parser.description
            try:
                item["_valid_recipe"] = _is_complete_recipe(extract_recipe(html, item["url"]))
            except (ValueError, TypeError, KeyError):
                item["_valid_recipe"] = False
    except Exception:
        pass
    return item


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


def _query_match_score(title: str, description: str, query: str) -> int:
    """Rank recipe results by title relevance first, then description relevance."""
    import re
    import unicodedata

    def normalize(value):
        value = unicodedata.normalize("NFKD", value.casefold())
        value = "".join(char for char in value if not unicodedata.combining(char))
        return re.findall(r"[a-z0-9]+", value)

    stopwords = {"con", "per", "alla", "alle", "agli", "della", "delle", "degli",
                 "del", "dei", "di", "da", "in", "il", "lo", "la", "le", "gli",
                 "un", "una", "uno", "e", "a"}
    terms = [term for term in normalize(query) if len(term) > 2 and term not in stopwords]
    title_words = normalize(title)
    description_words = normalize(description)
    if not terms or not title_words:
        return 0

    off_topic = {"vino", "vini", "abbinare", "abbinamento", "abbinamenti",
                 "quale", "quali", "consigli", "menu"}
    if any(word in off_topic for word in title_words) and not any(word in terms for word in off_topic):
        return 0

    def has_match(term, words):
        # Match whole normalized words only: "norcina" must not match
        # "nocino" or "porcino" through substring/fuzzy similarity.
        return term in words

    title_hits = sum(has_match(term, title_words) for term in terms)
    description_hits = sum(has_match(term, description_words) for term in terms)
    # Richiedi corrispondenza nel titolo, non soltanto nella descrizione.
    # Per ricerche composte, almeno metà dei termini deve comparire nel titolo.
    if title_hits == 0:
        return 0
    if len(terms) >= 2 and title_hits * 2 < len(terms):
        return 0

    # Exact phrase in the title is the strongest signal. A full set of
    # query terms in the title outranks partial title matches and description-only matches.
    normalized_title = " ".join(title_words)
    normalized_query = " ".join(terms)
    phrase_bonus = 12 if normalized_query and normalized_query in normalized_title else 0
    title_ratio = title_hits / len(terms)
    description_ratio = description_hits / len(terms)

    # A recipe may still be relevant when its title is generic but its
    # description contains the requested dish; rank it below title matches.
    score = int(60 * title_ratio + 20 * description_ratio + phrase_bonus)
    if title_hits == len(terms):
        score += 20
    elif title_hits == 0:
        score = min(score, 35)
    return score


def _matches_query(title: str, description: str, query: str) -> bool:
    return _query_match_score(title, description, query) > 0

async def _search_one_site(client: httpx.AsyncClient, site: str, query: str) -> list[dict]:
    base = "https://" + site
    # Try the publisher's public WordPress search API first; no third-party search engine.
    api_url = base + "/wp-json/wp/v2/search"
    try:
        response = await client.get(api_url, params={"search": query, "per_page": 8, "type": "post"})
        if response.status_code == 200:
            payload = response.json()
            found = []
            for item in payload if isinstance(payload, list) else []:
                url = item.get("url", "")
                title = item.get("title", "")
                if isinstance(title, dict):
                    title = title.get("rendered", "")
                if allowed_host(url) and _looks_like_recipe_url(url) and title:
                    clean_title = " ".join(str(title).split())
                    excerpt = item.get("excerpt", "")
                    description = excerpt.get("rendered", "") if isinstance(excerpt, dict) else str(excerpt or "")
                    if _matches_query(clean_title, description, query):
                        found.append({"title": clean_title, "url": url,
                                      "description": description, "source": site, "image": None})
            if found:
                return found[:8]
    except Exception:
        pass

    # Fallback: use the site's own search page.
    try:
        response = await client.get(base + "/", params={"s": query})
        if response.status_code != 200 or "html" not in response.headers.get("content-type", "").lower():
            return []
        parser = SiteSearchParser()
        parser.feed(decode_html_response(response))
        found, seen = [], set()
        terms = [term.casefold() for term in query.split() if len(term) > 2]
        for item in parser.links:
            url = urljoin(str(response.url), item["url"])
            title = " ".join(item["title"].split())
            if (not title or url in seen or not allowed_host(url)
                    or not _looks_like_recipe_url(url)):
                continue
            if not _matches_query(title, "", query):
                continue
            seen.add(url)
            found.append({"title": title, "url": url, "description": "",
                          "source": site, "image": None})
            if len(found) >= 8:
                break
        return found[:8]
    except Exception:
        return []


@app.get("/api/search")
async def search(
    q: str = Query(min_length=2, max_length=100),
    sites: str | None = Query(default=None, max_length=300),
):
    """Search selected approved publishers directly, without paid search APIs."""
    if sites is None:
        selected_sites = sorted(ALLOWED_SITES)
    else:
        requested_sites = list(dict.fromkeys(site.strip().lower() for site in sites.split(",") if site.strip()))
        unknown_sites = set(requested_sites) - ALLOWED_SITES
        if unknown_sites:
            raise HTTPException(status_code=400, detail="Uno o più siti selezionati non sono consentiti.")
        if not requested_sites:
            raise HTTPException(status_code=400, detail="Seleziona almeno un sito per la ricerca.")
        selected_sites = requested_sites
    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(6.0, connect=3.0),
            follow_redirects=True,
            headers={"User-Agent": RECIPE_USER_AGENT, "Accept": "text/html,application/json"},
        ) as client:
            # Interroga le fonti in sequenza, rispettando l'ordine scelto dall'utente.
            batches = []
            for site in selected_sites:
                try:
                    batches.append(await _search_one_site(client, site, q))
                except Exception:
                    batches.append([])
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Non riesco a contattare i siti di ricette. Riprova più tardi.") from exc

    # Keep the response small: large result batches and dozens of page fetches
    # can exceed Cloudflare Workers' memory limits.
    candidates, seen = [], set()
    for batch in batches:
        if isinstance(batch, Exception):
            continue
        for item in batch:
            if item["url"] in seen:
                continue
            seen.add(item["url"])
            item["_relevance"] = _query_match_score(
                item.get("title", ""), item.get("description", ""), q
            )
            if item["_relevance"] > 0:
                candidates.append(item)

    # Rank all publisher results together. Keep source diversity without
    # imposing the old two-results-per-site restriction.
    candidates.sort(key=lambda item: item["_relevance"], reverse=True)
    results, site_counts = [], {}
    for item in candidates:
        site = item.get("source", "")
        if site_counts.get(site, 0) >= 3:
            continue
        item.pop("_relevance", None)
        results.append(item)
        site_counts[site] = site_counts.get(site, 0) + 1
        if len(results) >= 12:
            break

    # Enrich every returned card, with bounded concurrency.
    async with httpx.AsyncClient(
        timeout=httpx.Timeout(4.0, connect=2.0),
        follow_redirects=True,
        headers={"User-Agent": RECIPE_USER_AGENT, "Accept": "text/html"},
    ) as image_client:
        semaphore = asyncio.Semaphore(5)

        async def enrich(item):
            async with semaphore:
                return await _add_result_image(image_client, item)

        await asyncio.gather(*(enrich(item) for item in results))

    # Scarta le pagine che non contengono tutti e tre i campi essenziali.
    results = [item for item in results if item.pop("_valid_recipe", False)]

    return {"query": q, "searched_sites": selected_sites, "results": results}

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
            html = decode_html_response(response)

        data = extract_recipe(html, url)
        data["source"] = host
        data["url"] = url
        if not _is_complete_recipe(data):
            raise HTTPException(
                status_code=422,
                detail="Ricetta scartata: la pagina non contiene titolo, ingredienti e procedimento completi.",
            )
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
