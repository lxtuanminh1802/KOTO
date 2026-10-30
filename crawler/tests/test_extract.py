from expo_crawler.classify import suggest_mang
from expo_crawler.extract import STAND, extract_detail, find_about_link, find_exhibitor_links, main_paragraphs

LIST = """<html><body>
<nav><a href="/">Home</a><a href="/visit">Visit</a><a href="/press">Press</a><a href="/contact">Contact</a><a href="/sponsors">Sponsors</a></nav>
<a href="/exhibitors-list?page=2">2</a>
<div class="grid">
  <a href="/exhibitors-list/exhibitor/acme">Acme</a><a href="/exhibitors-list/exhibitor/acme#map">Acme map</a>
  <a href="/exhibitors-list/exhibitor/beta">Beta</a><a href="/exhibitors-list/exhibitor/gamma">Gamma</a>
  <a href="https://www.linkedin.com/company/x">LinkedIn</a>
</div></body></html>"""


def test_find_links_picks_exhibitor_pattern():
    links = find_exhibitor_links(LIST, "https://expo.example/exhibitors-list")
    assert links == ["https://expo.example/exhibitors-list/exhibitor/acme",
                     "https://expo.example/exhibitors-list/exhibitor/beta",
                     "https://expo.example/exhibitors-list/exhibitor/gamma"]


def test_find_links_with_selector():
    links = find_exhibitor_links(LIST, "https://expo.example/exhibitors-list", "nav a")
    assert "https://expo.example/visit" in links


def test_stand_regex():
    assert STAND.search("Visit us at Stand: C12 today").group(1) == "C12"
    assert STAND.search("Booth No. 4-210").group(1) == "4-210"
    assert STAND.search("Standard features") is None


def test_detail_ignores_footer_country_and_social_links():
    html = """<html><body><main><h1>Foo GmbH</h1><p>Location: Germany</p>
    <div class="description"><p>Foo makes network intrusion detection appliances for utilities and transport operators.</p></div>
    <a href="https://twitter.com/foo">Twitter</a><a href="https://foo.de">Website</a></main>
    <footer>Olympia London, United Kingdom</footer></body></html>"""
    d = extract_detail(html, "https://expo.example/exhibitor/foo", "https://expo.example/list")
    assert d["name"] == "Foo GmbH"
    assert d["country"] == "Đức"
    assert d["website"] == "https://foo.de"
    assert "intrusion detection" in d["expo_description"]


def test_country_from_tld_when_missing():
    html = '<main><h1>Bar</h1><a href="https://bar.se">Visit website</a></main>'
    assert extract_detail(html, "https://e.x/a", "https://e.x/l")["country"] == "Thụy Điển"


def test_about_link_and_paragraphs():
    home = '<nav><a href="/en/">Home</a><a href="/en/company/">About</a></nav>'
    assert find_about_link(home, "https://acme.example/") == "https://acme.example/en/company/"
    paras = main_paragraphs('<div class="cookie-notice"><p>' + "cookie " * 20 + '</p></div><p>' + "Real text about the company. " * 4 + '</p>')
    assert len(paras) == 1 and paras[0].startswith("Real text")


def test_classifier():
    assert suggest_mang("Managed SOC and threat intelligence")[0] == "A05"
    assert suggest_mang("Counter-drone radar")[0] == "UAV"
    assert suggest_mang("Social media marketing", default="Khác")[0] == "Khác"
