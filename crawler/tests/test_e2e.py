"""Chạy crawler thật (requests + Chromium) trên trang triển lãm giả lập."""

from expo_crawler.crawl import Source, State, crawl_source, probe
from expo_crawler.fetch import Fetcher


def test_js_list_with_load_more_and_company_overview(expo, tmp_path):
    src = Source(id="cyber", name="Cyber Expo", url=expo["url"] + "/exhibitors-list/", default_mang="A05")
    f = Fetcher(delay=0)
    try:
        state = State(tmp_path / "cyber.json")
        items = crawl_source(src, f, state)
        by = {i["name"]: i for i in items}

        # 5 exhibitor, 1 hãng trùng domain với Acme bị loại
        assert set(by) == {"Acme Cyber Defence Ltd", "Nordlight Crypto AB", "SkyGuard Systems GmbH", "Orbis Labs"}

        acme = by["Acme Cyber Defence Ltd"]
        assert acme["booth"] == "C12"
        assert acme["country"] == "Anh"
        assert acme["website"] == expo["sites"]["acme"]
        assert acme["categories"] == ["Threat Intelligence", "Managed SOC"]
        assert acme["email"] == "sales@acme.example"
        assert acme["linkedin"].endswith("/company/acme-cyber")
        assert acme["mang_suggest"] == "A05"
        ov = acme["overview"]
        assert ov["summary"].startswith("Acme builds managed SOC")
        assert "founded in 2009" in ov["text"] and "cookie" not in ov["text"].lower()
        assert ov["about_url"].endswith("/about-us/")

        nord = by["Nordlight Crypto AB"]
        assert nord["country"] == "Thụy Điển" and nord["booth"] == "B07"
        assert "Hardware encryption" in nord["expo_description"]

        sky = by["SkyGuard Systems GmbH"]
        assert sky["country"] == "Đức" and sky["mang_suggest"] == "UAV"

        orbis = by["Orbis Labs"]
        assert orbis["website"] == "" and orbis["overview"] is None

        # Lần chạy sau chỉ lấy hãng mới: không còn gì
        state.save()
        assert crawl_source(src, f, State(tmp_path / "cyber.json")) == []
    finally:
        f.close()


def test_static_pagination_without_browser(expo):
    src = Source(id="paged", name="Paged", url=expo["url"] + "/paged/page-1/", render="never", crawl_website=False)
    f = Fetcher(delay=0)
    try:
        items = crawl_source(src, f)
    finally:
        f.close()
    assert [i["name"] for i in items] == ["Alpha Radio", "Beta Radio", "Gamma Radio", "Delta Radio", "Epsilon Radio", "Zeta Radio"]
    assert items[3]["booth"] == "A20"
    assert all(i["mang_suggest"] == "C09" for i in items)


def test_probe(expo):
    f = Fetcher(delay=0)
    try:
        r = probe(expo["url"] + "/exhibitors-list/", f, website=False)
    finally:
        f.close()
    assert r["links_found"] == 5
    assert r["samples"][0]["name"] == "Acme Cyber Defence Ltd"
