"""Tải trang: requests cho trang tĩnh, Playwright (Chromium) cho trang render bằng JavaScript."""

from __future__ import annotations

import logging
import os
import re
import time
import urllib.robotparser
from urllib.parse import urlparse

import requests

log = logging.getLogger(__name__)

USER_AGENT = "Mozilla/5.0 (compatible; AIPT-ExpoCrawler/0.1; +https://aiptgroup.com)"
LOAD_MORE = re.compile(r"(load|show|view|see)\s+more|more\s+exhibitors|xem thêm|mehr laden|voir plus|carica altri", re.I)


class Fetcher:
    """Tải trang có giới hạn tốc độ theo host, tôn trọng robots.txt và thử lại khi lỗi tạm thời."""

    def __init__(self, delay: float = 1.5, respect_robots: bool = True, timeout: int = 30,
                 chromium_path: str | None = None, headless: bool = True):
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": USER_AGENT, "Accept-Language": "en-US,en;q=0.8"})
        self.delay = delay
        self.respect_robots = respect_robots
        self.timeout = timeout
        self.chromium_path = chromium_path or os.environ.get("CHROMIUM_PATH")
        self.headless = headless
        self._last_hit: dict[str, float] = {}
        self._robots: dict[str, urllib.robotparser.RobotFileParser] = {}
        self._pw = None
        self._browser = None

    # ---------- chung ----------
    def allowed(self, url: str) -> bool:
        if not self.respect_robots:
            return True
        p = urlparse(url)
        base = f"{p.scheme}://{p.netloc}"
        rp = self._robots.get(base)
        if rp is None:
            rp = urllib.robotparser.RobotFileParser()
            try:
                r = self.session.get(base + "/robots.txt", timeout=10)
                rp.parse(r.text.splitlines() if r.status_code == 200 else [])
            except requests.RequestException:
                rp.parse([])
            self._robots[base] = rp
        ok = rp.can_fetch(USER_AGENT, url)
        if not ok:
            log.warning("robots.txt không cho phép: %s", url)
        return ok

    def _throttle(self, url: str) -> None:
        host = urlparse(url).netloc
        gap = time.monotonic() - self._last_hit.get(host, 0)
        if gap < self.delay:
            time.sleep(self.delay - gap)
        self._last_hit[host] = time.monotonic()

    # ---------- trang tĩnh ----------
    def get(self, url: str) -> tuple[str, str] | None:
        """Trả về (url cuối cùng, html) hoặc None nếu bị chặn, lỗi hay không phải HTML."""
        if not self.allowed(url):
            return None
        for attempt in range(3):
            self._throttle(url)
            try:
                r = self.session.get(url, timeout=self.timeout)
            except requests.RequestException as e:
                log.debug("Lỗi tải %s (lần %d): %s", url, attempt + 1, e)
                time.sleep(2 * (attempt + 1))
                continue
            if r.status_code in (429, 502, 503, 504):
                time.sleep(5 * (attempt + 1))
                continue
            if r.status_code >= 400:
                log.info("HTTP %s: %s", r.status_code, url)
                return None
            if "html" not in r.headers.get("content-type", "html"):
                return None
            if not r.encoding or r.encoding.lower() == "iso-8859-1":
                r.encoding = r.apparent_encoding
            return r.url, r.text
        log.warning("Bỏ qua sau 3 lần thử: %s", url)
        return None

    # ---------- trình duyệt ----------
    def _ensure_browser(self):
        if self._browser is None:
            from playwright.sync_api import sync_playwright

            self._pw = sync_playwright().start()
            kw = {"headless": self.headless}
            if self.chromium_path:
                kw["executable_path"] = self.chromium_path
            self._browser = self._pw.chromium.launch(**kw)
        return self._browser

    def render(self, url: str, expand: bool = False, max_rounds: int = 40) -> tuple[str, str] | None:
        """Mở trang bằng Chromium. expand=True: cuộn xuống và bấm "Load more" tới khi hết dữ liệu."""
        if not self.allowed(url):
            return None
        self._throttle(url)
        page = self._ensure_browser().new_page(user_agent=USER_AGENT)
        try:
            page.goto(url, wait_until="networkidle", timeout=self.timeout * 1000)
            if expand:
                self._expand(page, max_rounds)
            return page.url, page.content()
        except Exception as e:  # Playwright ném nhiều loại lỗi khác nhau
            log.warning("Không render được %s: %s", url, e)
            return None
        finally:
            page.close()

    def _expand(self, page, max_rounds: int) -> None:
        last_height, still = 0, 0
        for _ in range(max_rounds):
            page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
            page.wait_for_timeout(700)
            clicked = False
            for el in page.locator("button, a, [role=button]").all():
                try:
                    if el.is_visible() and LOAD_MORE.search(el.inner_text(timeout=500) or ""):
                        el.click(timeout=2000)
                        page.wait_for_load_state("networkidle", timeout=self.timeout * 1000)
                        clicked = True
                        break
                except Exception:
                    continue
            height = page.evaluate("document.body.scrollHeight")
            if not clicked and height == last_height:
                still += 1
                if still >= 2:
                    break
            else:
                still = 0
            last_height = height

    def close(self) -> None:
        if self._browser:
            self._browser.close()
        if self._pw:
            self._pw.stop()
        self._browser = self._pw = None
