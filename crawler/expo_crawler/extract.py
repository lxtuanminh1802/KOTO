"""Bóc tách dữ liệu: link exhibitor trên trang danh sách, thông tin trang chi tiết, giới thiệu trên website hãng."""

from __future__ import annotations

import json
import re
from collections import defaultdict
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup, Tag

# ---------------------------------------------------------------- hằng số
DETAIL_HINT = re.compile(r"exhibitor|company|companies|aussteller|exposant|espositor|participant|brand|vendor|profile|booth|stand", re.I)
NEXT_TEXT = re.compile(r"^\s*(next|next page|›|»|>|weiter|suivant|tiếp)\s*$", re.I)
ABOUT_LINK = re.compile(r"about|company|who-we-are|our-story|ueber-uns|uber-uns|unternehmen|a-propos|qui-sommes|chi-siamo|om-oss|gioi-thieu", re.I)
STAND = re.compile(r"\b(?:stand|booth|gian hàng)\s*(?:no\.?|number|#|:)?\s*:?\s*([A-Z]{0,2}\d{1,4}[A-Z]?(?:[-./]\d{1,4}[A-Z]?)?)\b", re.I)
NOISE_CLASS = re.compile(r"cookie|consent|gdpr|newsletter|modal|popup|banner", re.I)
CAT_CLASS = re.compile(r"categor|tag|sector|product|interest|solution", re.I)
LOGO = re.compile(r"logo", re.I)

SKIP_DOMAINS = (
    "linkedin.com", "twitter.com", "x.com", "facebook.com", "instagram.com", "youtube.com", "youtu.be",
    "tiktok.com", "google.", "goo.gl", "apple.com", "bit.ly", "wa.me", "whatsapp.com", "vimeo.com",
    "eventbrite.", "swapcard.com", "a2zinc.net", "mapyourshow.com", "expofp.com", "flickr.com",
)

COUNTRY_VI = {
    "united kingdom": "Anh", "uk": "Anh", "great britain": "Anh", "england": "Anh", "scotland": "Anh", "wales": "Anh",
    "united states": "Mỹ", "usa": "Mỹ", "united states of america": "Mỹ", "germany": "Đức", "deutschland": "Đức",
    "france": "Pháp", "italy": "Ý", "spain": "Tây Ban Nha", "netherlands": "Hà Lan", "belgium": "Bỉ", "sweden": "Thụy Điển",
    "switzerland": "Thụy Sĩ", "finland": "Phần Lan", "norway": "Na Uy", "denmark": "Đan Mạch", "austria": "Áo",
    "poland": "Ba Lan", "czech republic": "Séc", "czechia": "Séc", "estonia": "Estonia", "lithuania": "Litva",
    "ireland": "Ireland", "portugal": "Bồ Đào Nha", "israel": "Israel", "japan": "Nhật Bản", "south korea": "Hàn Quốc",
    "korea": "Hàn Quốc", "republic of korea": "Hàn Quốc", "singapore": "Singapore", "united arab emirates": "UAE", "uae": "UAE",
    "china": "Trung Quốc", "taiwan": "Đài Loan", "india": "Ấn Độ", "canada": "Canada", "australia": "Úc",
    "new zealand": "New Zealand", "turkey": "Thổ Nhĩ Kỳ", "türkiye": "Thổ Nhĩ Kỳ", "vietnam": "Việt Nam", "viet nam": "Việt Nam",
    "malaysia": "Malaysia", "thailand": "Thái Lan", "indonesia": "Indonesia", "ukraine": "Ukraine", "romania": "Romania",
    "greece": "Hy Lạp", "hungary": "Hungary", "luxembourg": "Luxembourg", "saudi arabia": "Ả Rập Xê Út", "qatar": "Qatar",
}
TLD_VI = {
    "uk": "Anh", "de": "Đức", "fr": "Pháp", "it": "Ý", "es": "Tây Ban Nha", "nl": "Hà Lan", "be": "Bỉ", "se": "Thụy Điển",
    "ch": "Thụy Sĩ", "fi": "Phần Lan", "no": "Na Uy", "dk": "Đan Mạch", "at": "Áo", "pl": "Ba Lan", "cz": "Séc", "ee": "Estonia",
    "ie": "Ireland", "pt": "Bồ Đào Nha", "il": "Israel", "jp": "Nhật Bản", "kr": "Hàn Quốc", "sg": "Singapore", "ae": "UAE",
    "cn": "Trung Quốc", "tw": "Đài Loan", "in": "Ấn Độ", "ca": "Canada", "au": "Úc", "nz": "New Zealand", "tr": "Thổ Nhĩ Kỳ",
    "vn": "Việt Nam", "my": "Malaysia", "th": "Thái Lan", "id": "Indonesia", "ua": "Ukraine", "lt": "Litva",
}


# ---------------------------------------------------------------- tiện ích
def soup_of(html: str) -> BeautifulSoup:
    return BeautifulSoup(html, "lxml")


def clean_text(s: str | None) -> str:
    return re.sub(r"\s+", " ", s or "").strip()


def domain_of(url: str | None) -> str:
    host = urlparse(url or "").netloc.lower()
    return host[4:] if host.startswith("www.") else host


def same_site(a: str, b: str) -> bool:
    da, db = domain_of(a), domain_of(b)
    return bool(da) and (da == db or da.endswith("." + db) or db.endswith("." + da))


def is_skipped_domain(url: str) -> bool:
    d = domain_of(url)
    return any(s in d for s in SKIP_DOMAINS)


def strip_noise(soup: BeautifulSoup) -> BeautifulSoup:
    """Bỏ script, menu, header, footer, cookie banner để không lẫn chữ của trang triển lãm vào dữ liệu hãng."""
    for t in soup(["script", "style", "noscript", "svg", "nav", "header", "footer", "form", "iframe"]):
        t.decompose()
    for t in soup.find_all(True):
        if t.decomposed or t.attrs is None:
            continue
        marker = " ".join(t.get("class", [])) + " " + (t.get("id") or "")
        if NOISE_CLASS.search(marker):
            t.decompose()
    return soup


def meta(soup: BeautifulSoup, *names: str) -> str:
    for n in names:
        tag = soup.find("meta", attrs={"property": n}) or soup.find("meta", attrs={"name": n})
        if tag and tag.get("content"):
            return clean_text(tag["content"])
    return ""


def jsonld_org(soup: BeautifulSoup) -> dict:
    """Lấy object Organization trong JSON-LD nếu trang có khai báo."""
    for s in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(s.string or "")
        except (json.JSONDecodeError, TypeError):
            continue
        stack = data if isinstance(data, list) else [data]
        while stack:
            d = stack.pop()
            if isinstance(d, dict):
                if "@graph" in d:
                    stack.extend(d["@graph"])
                t = d.get("@type")
                types = t if isinstance(t, list) else [t]
                if any(x in ("Organization", "Corporation", "LocalBusiness", "Brand") for x in types):
                    return d
    return {}


def select_text(root: Tag, selector: str | None) -> str:
    if not selector:
        return ""
    el = root.select_one(selector)
    return clean_text(el.get_text(" ")) if el else ""


# ---------------------------------------------------------------- trang danh sách
def find_exhibitor_links(html: str, page_url: str, selector: str | None = None) -> list[str]:
    """Tìm link trang chi tiết exhibitor.

    Có selector thì dùng selector. Không có thì gom link cùng domain theo mẫu đường dẫn (vd /exhibitors/*)
    và chọn nhóm đông nhất, ưu tiên nhóm có từ khóa exhibitor/company/booth... trong đường dẫn.
    """
    soup = soup_of(html)
    if selector:
        anchors = []
        for el in soup.select(selector):
            a = el if el.name == "a" else el.find("a", href=True)
            if a is not None and a.get("href"):
                anchors.append(a)
    else:
        anchors = soup.find_all("a", href=True)

    page = urlparse(page_url)
    seen, cands = set(), []
    for a in anchors:
        href = a["href"].strip()
        if not href or href.startswith(("#", "mailto:", "tel:", "javascript:")):
            continue
        u = urljoin(page_url, href).split("#")[0]
        p = urlparse(u)
        if p.netloc != page.netloc or u.rstrip("/") == page_url.rstrip("/"):
            continue
        if p.path.rstrip("/") == page.path.rstrip("/"):
            continue  # cùng trang danh sách, chỉ khác query (lọc, phân trang)
        if u not in seen:
            seen.add(u)
            cands.append(u)
    if selector:
        return cands

    groups: dict[str, list[str]] = defaultdict(list)
    for u in cands:
        p = urlparse(u)
        segs = p.path.rstrip("/").split("/")
        if p.query:
            keys = ",".join(sorted(k.split("=")[0] for k in p.query.split("&")))
            key = f"{p.path}?{keys}"
        elif len(segs) >= 2 and segs[-1]:
            key = "/".join(segs[:-1]) + "/*"
        else:
            continue
        groups[key].append(u)

    best, best_score = None, 0.0
    for key, urls in groups.items():
        hinted = bool(DETAIL_HINT.search(key))
        if len(urls) < (1 if hinted else 4):
            continue
        score = len(urls) * (3 if hinted else 1)
        if score > best_score:
            best, best_score = key, score
    return groups[best] if best else []


def find_next_page(html: str, page_url: str, selector: str | None = None) -> str | None:
    soup = soup_of(html)
    a = soup.select_one(selector) if selector else None
    if a is None:
        a = soup.find("a", rel=lambda r: r and "next" in r, href=True)
    if a is None:
        for cand in soup.find_all("a", href=True):
            label = clean_text(cand.get_text()) or cand.get("aria-label", "") or cand.get("title", "")
            if NEXT_TEXT.match(label) or re.search(r"next", cand.get("aria-label", ""), re.I):
                a = cand
                break
    if a is None or not a.get("href"):
        return None
    u = urljoin(page_url, a["href"]).split("#")[0]
    return u if urlparse(u).netloc == urlparse(page_url).netloc and u != page_url else None


# ---------------------------------------------------------------- trang chi tiết exhibitor
def _external_website(root: Tag, base_url: str, expo_url: str) -> str:
    best = ""
    for a in root.find_all("a", href=True):
        u = urljoin(base_url, a["href"])
        if not u.startswith("http") or same_site(u, expo_url) or is_skipped_domain(u):
            continue
        label = (clean_text(a.get_text()) + " " + " ".join(a.get("class", []))).lower()
        if re.search(r"website|visit|www\.|homepage|web site", label):
            return u
        best = best or u
    return best


def _description(root: Tag) -> str:
    # Ưu tiên khối có class "description", rồi "about", rồi các tên chung chung hơn
    priority = [r"description|desc\b", r"about", r"profile|bio|summary|overview", r"company-info|exhibitor-info"]
    for pat in priority:
        rx = re.compile(pat, re.I)
        blocks = []
        for el in root.find_all(True):
            marker = " ".join(el.get("class", [])) + " " + (el.get("id") or "")
            if rx.search(marker):
                t = clean_text(el.get_text(" "))
                if 80 <= len(t) <= 6000:
                    blocks.append(t)
        if blocks:
            return max(blocks, key=len)
    paras = [clean_text(p.get_text(" ")) for p in root.find_all("p")]
    paras = [p for p in paras if len(p) >= 60]
    return "\n\n".join(paras[:5])


def _country(root: Tag, text: str, ld: dict, website: str) -> str:
    addr = ld.get("address") if isinstance(ld.get("address"), dict) else {}
    c = addr.get("addressCountry") if addr else None
    if isinstance(c, dict):
        c = c.get("name")
    if c and c.lower() in COUNTRY_VI:
        return COUNTRY_VI[c.lower()]
    m = re.search(r"\b(?:country|location|headquarters|hq|quốc gia)\s*[:\-]\s*([A-Za-zÀ-ỹ .']{2,40})", text, re.I)
    if m:
        val = m.group(1).strip().lower()
        for name in sorted(COUNTRY_VI, key=len, reverse=True):
            if val.startswith(name):
                return COUNTRY_VI[name]
    tld = domain_of(website).rsplit(".", 1)[-1] if website else ""
    return TLD_VI.get(tld, "")


def _categories(root: Tag) -> list[str]:
    out: list[str] = []
    for el in root.find_all(True):
        marker = " ".join(el.get("class", [])) + " " + (el.get("id") or "")
        if not CAT_CLASS.search(marker):
            continue
        items = el.find_all(["li", "a", "span"]) or [el]
        for it in items:
            if it.find(["li", "a", "span"]):
                continue
            t = clean_text(it.get_text(" "))
            if 2 <= len(t) <= 50 and t not in out and not re.search(r"categor|tags?:", t, re.I):
                out.append(t)
    return out[:12]


def extract_detail(html: str, url: str, expo_url: str, fields: dict | None = None) -> dict:
    """Bóc thông tin một exhibitor. fields: selector CSS cấu hình riêng cho nguồn (name, booth, description...)."""
    fields = fields or {}
    raw = soup_of(html)
    ld = jsonld_org(raw)
    og_title = meta(raw, "og:title")
    og_desc = meta(raw, "og:description", "description")
    linkedin = next((a["href"] for a in raw.find_all("a", href=True) if "linkedin.com/company" in a["href"]), "")
    email = next((a["href"][7:].split("?")[0] for a in raw.find_all("a", href=True)
                  if a["href"].startswith("mailto:") and not same_site("http://" + a["href"].split("@")[-1], expo_url)), "")
    logo = ""
    img = next((i for i in raw.find_all("img") if LOGO.search((i.get("alt") or "") + " ".join(i.get("class", [])) + (i.get("src") or ""))), None)
    if img is not None and img.get("src"):
        logo = urljoin(url, img["src"])

    root = strip_noise(raw)
    main = root.find("main") or root.find("article") or root.body or root
    text = clean_text(main.get_text(" "))

    name = select_text(root, fields.get("name")) or clean_text(ld.get("name"))
    if not name:
        h1 = main.find("h1")
        name = clean_text(h1.get_text(" ")) if h1 else re.split(r"\s[|–—-]\s", og_title)[0]
    website = ""
    if fields.get("website"):
        el = root.select_one(fields["website"])
        website = urljoin(url, el["href"]) if el is not None and el.get("href") else ""
    if not website and ld.get("url") and not same_site(ld["url"], expo_url):
        website = ld["url"]
    website = website or _external_website(main, url, expo_url)

    booth = select_text(root, fields.get("booth"))
    if not booth:
        m = STAND.search(text)
        booth = m.group(1) if m else ""
    desc = select_text(root, fields.get("description")) or clean_text(ld.get("description")) or _description(main) or og_desc
    cats = [clean_text(t.get_text(" ")) for t in root.select(fields["categories"])] if fields.get("categories") else _categories(main)

    return {
        "name": name,
        "detail_url": url,
        "website": website,
        "domain": domain_of(website),
        "country": select_text(root, fields.get("country")) or _country(main, text, ld, website),
        "booth": booth,
        "categories": cats,
        "expo_description": desc[:4000],
        "email": email,
        "linkedin": linkedin,
        "logo": logo or (urljoin(url, ld["logo"]) if isinstance(ld.get("logo"), str) else ""),
    }


def extract_cards(html: str, page_url: str, expo_url: str, card_selector: str, fields: dict) -> list[dict]:
    """Chế độ không có trang chi tiết: mọi thông tin nằm ngay trên thẻ của trang danh sách."""
    soup = soup_of(html)
    out = []
    for card in soup.select(card_selector):
        rec = extract_detail(str(card), page_url, expo_url, fields)
        rec["detail_url"] = page_url
        if rec["name"]:
            out.append(rec)
    return out


# ---------------------------------------------------------------- website hãng
def main_paragraphs(html: str, limit: int = 6) -> list[str]:
    root = strip_noise(soup_of(html))
    main = root.find("main") or root.find("article") or root.body or root
    out: list[str] = []
    for p in main.find_all(["p", "li"]):
        t = clean_text(p.get_text(" "))
        if len(t) < 70 or t in out or re.search(r"cookie|javascript|all rights reserved|privacy policy", t, re.I):
            continue
        out.append(t)
        if len(out) >= limit:
            break
    return out


def find_about_link(html: str, site_url: str) -> str | None:
    soup = soup_of(html)
    best = None
    for a in soup.find_all("a", href=True):
        u = urljoin(site_url, a["href"]).split("#")[0]
        if not same_site(u, site_url) or u.rstrip("/") == site_url.rstrip("/"):
            continue
        label = clean_text(a.get_text()).lower()
        path = urlparse(u).path.lower()
        if re.search(r"^(about|about us|company|who we are|our story|über uns|qui sommes-nous|chi siamo|giới thiệu)$", label):
            return u
        if best is None and ABOUT_LINK.search(path):
            best = u
    return best


def company_overview(fetcher, website: str, max_chars: int = 1500) -> dict | None:
    """Đọc trang chủ và trang About của hãng để lấy giới thiệu tổng quan."""
    if not website:
        return None
    home = fetcher.get(website)
    if not home:
        return None
    home_url, home_html = home
    soup = soup_of(home_html)
    summary = meta(soup, "og:description", "description")
    about_url = find_about_link(home_html, home_url)
    paras: list[str] = []
    if about_url:
        about = fetcher.get(about_url)
        if about:
            paras = main_paragraphs(about[1])
    if not paras:
        paras = main_paragraphs(home_html)
    text = "\n\n".join(paras)
    if len(text) > max_chars:
        text = text[:max_chars].rsplit(" ", 1)[0] + "…"
    if not summary and not text:
        return None
    return {"summary": summary, "text": text, "about_url": about_url or "", "site": home_url}
