"""Điều phối một lần crawl: trang danh sách → trang chi tiết → website hãng → bản ghi chuẩn hóa."""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import yaml

from .classify import suggest_mang
from .extract import (company_overview, domain_of, extract_cards, extract_detail, find_exhibitor_links,
                      find_next_page)
from .fetch import Fetcher

log = logging.getLogger(__name__)

MIN_LINKS_STATIC = 3  # ít hơn số này trên bản tĩnh thì coi như trang render bằng JavaScript


@dataclass
class Source:
    id: str
    name: str
    url: str
    place: str = ""
    when: str = ""
    schedule: str = "weekly"          # once | daily | weekly
    default_mang: str | None = None   # dùng khi không đoán được mảng
    crawl_website: bool = True        # vào website hãng lấy giới thiệu tổng quan
    render: str = "auto"              # auto | always | never
    max_pages: int = 30
    link_selector: str | None = None  # CSS chọn link trang chi tiết, khi tự dò sai
    next_selector: str | None = None  # CSS nút trang sau
    card_selector: str | None = None  # trang không có trang chi tiết: mỗi thẻ là một hãng
    fields: dict = field(default_factory=dict)  # selector riêng: name, booth, description, website, country, categories

    def to_meta(self) -> dict:
        return {"id": self.id, "name": self.name, "url": self.url, "place": self.place, "when": self.when, "schedule": self.schedule}


def load_sources(path: str | Path) -> tuple[dict, list[Source]]:
    data = yaml.safe_load(Path(path).read_text(encoding="utf-8")) or {}
    defaults = data.get("defaults", {})
    keys = Source.__dataclass_fields__.keys()
    sources = [Source(**{k: v for k, v in {**defaults, **s}.items() if k in keys}) for s in data.get("sources", [])]
    return defaults, sources


class State:
    """Lưu các trang chi tiết đã crawl để lần sau chỉ lấy hãng mới."""

    def __init__(self, path: Path):
        self.path = path
        self.data: dict = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}

    def seen(self, url: str) -> bool:
        return url in self.data

    def domains(self) -> set[str]:
        return {v["domain"] for v in self.data.values() if v.get("domain")}

    def mark(self, url: str, domain: str) -> None:
        self.data[url] = {"domain": domain, "at": now_iso()}

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(self.data, ensure_ascii=False, indent=1), encoding="utf-8")


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def list_pages(src: Source, fetcher: Fetcher):
    """Duyệt các trang danh sách (có phân trang), trả về từng (url, html, links)."""
    url, visited = src.url, set()
    for _ in range(src.max_pages):
        if url in visited:
            break
        visited.add(url)
        res = None
        if src.render != "always":
            res = fetcher.get(url)
        links = []
        if res:
            links = [] if src.card_selector else find_exhibitor_links(res[1], res[0], src.link_selector)
        needs_browser = src.render == "always" or (src.render == "auto" and (
            res is None or (not src.card_selector and len(links) < MIN_LINKS_STATIC)))
        if needs_browser:
            log.info("Render bằng trình duyệt: %s", url)
            r2 = fetcher.render(url, expand=True)
            if r2:
                res = r2
                links = [] if src.card_selector else find_exhibitor_links(r2[1], r2[0], src.link_selector)
        if not res:
            break
        log.info("Trang %s: %d link exhibitor", res[0], len(links))
        yield res[0], res[1], links
        nxt = find_next_page(res[1], res[0], src.next_selector)
        if not nxt:
            break
        url = nxt


def build_record(src: Source, raw: dict, overview: dict | None) -> dict:
    text = " ".join([raw.get("name", ""), raw.get("expo_description", ""), " ".join(raw.get("categories", [])),
                     (overview or {}).get("summary", ""), (overview or {}).get("text", "")])
    mang, hits = suggest_mang(text, default=src.default_mang)
    return {
        **raw,
        "overview": overview,
        "mang_suggest": mang,
        "mang_keywords": hits,
        "source_id": src.id,
        "source_name": src.name,
        "source_url": src.url,
        "crawled_at": now_iso(),
    }


def crawl_source(src: Source, fetcher: Fetcher, state: State | None = None, limit: int | None = None,
                 crawl_website: bool | None = None) -> list[dict]:
    """Crawl một nguồn. state: bỏ qua trang chi tiết đã lấy ở lần trước. limit: số hãng tối đa (để thử)."""
    want_site = src.crawl_website if crawl_website is None else crawl_website
    records: list[dict] = []
    domains: set[str] = state.domains() if state is not None else set()

    def add(raw: dict) -> bool:
        key = raw.get("domain") or raw.get("name", "").lower()
        if not raw.get("name"):
            return False
        if key in domains:
            # Trùng hãng đã có (cùng domain): ghi nhận để lần sau không tải lại trang này
            if state is not None:
                state.mark(raw["detail_url"], raw.get("domain", ""))
            log.info("  = trùng: %s", raw["name"])
            return False
        overview = company_overview(fetcher, raw["website"]) if want_site and raw.get("website") else None
        records.append(build_record(src, raw, overview))
        domains.add(key)
        if state is not None:
            state.mark(raw["detail_url"], raw.get("domain", ""))
        log.info("  + %s (%s)", raw["name"], raw.get("domain") or "không có website")
        return limit is not None and len(records) >= limit

    for page_url, html, links in list_pages(src, fetcher):
        if src.card_selector:
            for raw in extract_cards(html, page_url, src.url, src.card_selector, src.fields):
                if add(raw):
                    return records
            continue
        for link in links:
            if state is not None and state.seen(link):
                continue
            res = fetcher.get(link)
            if res is None and src.render != "never":
                res = fetcher.render(link)
            if res is None:
                continue
            raw = extract_detail(res[1], res[0], src.url, src.fields)
            raw["detail_url"] = link
            if not raw["name"]:
                continue
            if add(raw):
                return records
    return records


def probe(url: str, fetcher: Fetcher, link_selector: str | None = None, sample: int = 1, website: bool = True) -> dict:
    """Kiểm tra nhanh một URL nguồn: dò được bao nhiêu link, mẫu link, thử bóc tách vài hãng đầu."""
    src = Source(id="probe", name="probe", url=url, link_selector=link_selector, max_pages=1)
    pages = list(list_pages(src, fetcher))
    links = pages[0][2] if pages else []
    samples = []
    for link in links[:sample]:
        res = fetcher.get(link) or fetcher.render(link)
        if res:
            raw = extract_detail(res[1], res[0], url)
            ov = company_overview(fetcher, raw["website"]) if website and raw["website"] else None
            samples.append(build_record(src, raw, ov))
    return {"url": url, "reachable": bool(pages), "links_found": len(links), "first_links": links[:5], "samples": samples,
            "domain": domain_of(url)}
