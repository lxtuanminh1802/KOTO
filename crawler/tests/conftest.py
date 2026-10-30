"""Dựng trang triển lãm giả lập và website các hãng trên localhost để test crawler không cần mạng."""

from __future__ import annotations

import json
import os
import sys
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

if not os.environ.get("CHROMIUM_PATH") and Path("/opt/pw-browsers/chromium").exists():
    os.environ["CHROMIUM_PATH"] = "/opt/pw-browsers/chromium"


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def serve(directory: Path) -> tuple[ThreadingHTTPServer, str]:
    srv = ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=str(directory)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f"http://127.0.0.1:{srv.server_address[1]}"


def write(root: Path, rel: str, content: str) -> None:
    p = root / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding="utf-8")


COOKIE = '<div class="cookie-banner"><p>We use cookies to improve your experience on this website. By continuing you accept our cookie policy and terms.</p></div>'


def company_site(root: Path, name: str, meta_desc: str, about: list[str]) -> None:
    write(root, "index.html", f"""<html><head><title>{name}</title><meta name="description" content="{meta_desc}"></head>
<body><nav><a href="/">Home</a> <a href="/products/">Products</a> <a href="/about-us/">About us</a></nav>{COOKIE}
<main><h1>{name}</h1><p>Welcome to {name}. Short teaser.</p></main><footer><p>© 2026 {name}. All rights reserved. Privacy policy and legal notices apply.</p></footer></body></html>""")
    write(root, "about-us/index.html", f"""<html><body><nav><a href="/">Home</a></nav>{COOKIE}<main><h1>About {name}</h1>
{''.join(f'<p>{t}</p>' for t in about)}</main></body></html>""")


@pytest.fixture(scope="session")
def expo(tmp_path_factory):
    base = tmp_path_factory.mktemp("sites")
    servers, sites = [], {}
    companies = {
        "acme": ("Acme Cyber Defence", "Acme builds managed SOC and threat intelligence services.",
                 ["Acme Cyber Defence was founded in 2009 in Manchester and runs a 24/7 security operations centre for government and critical infrastructure customers.",
                  "Its threat intelligence platform is deployed on-premise and supports air-gapped networks, which suits defence and public sector clients."]),
        "nordlight": ("Nordlight Crypto AB", "Nordlight makes hardware encryption for secure communication.",
                      ["Nordlight Crypto AB designs hardware encryption modules and secure communication gateways certified for classified networks in the Nordics."]),
        "skyguard": ("SkyGuard Systems GmbH", "Counter-drone detection and mitigation.",
                     ["SkyGuard Systems GmbH develops counter-drone radar and RF detection systems used to protect airports, prisons and stadiums across Europe."]),
    }
    for key, (name, desc, about) in companies.items():
        d = base / key
        company_site(d, name, desc, about)
        srv, url = serve(d)
        servers.append(srv)
        sites[key] = url + "/"

    root = base / "expo"
    write(root, "robots.txt", "User-agent: *\nAllow: /\n")
    exhibitors = [
        {"slug": "acme-cyber-defence", "name": "Acme Cyber Defence Ltd", "stand": "C12"},
        {"slug": "nordlight-crypto", "name": "Nordlight Crypto AB", "stand": "B07"},
        {"slug": "skyguard-systems", "name": "SkyGuard Systems GmbH", "stand": "F3"},
        {"slug": "orbis-labs", "name": "Orbis Labs", "stand": "D3"},
        {"slug": "acme-partner-pavilion", "name": "Acme Cyber (Partner Pavilion)", "stand": "C14"},
    ]
    write(root, "api/exhibitors.json", json.dumps(exhibitors))
    write(root, "exhibitors-list/index.html", """<html><head><title>Exhibitors | Cyber Expo</title></head><body>
<header><nav><a href="/">Home</a><a href="/visit/">Visit</a><a href="/exhibitors-list/">Exhibitors</a><a href="/conference/">Conference</a><a href="/contact/">Contact</a></nav></header>
<main><h1>Exhibitor list</h1><div id="grid"></div><button id="more" hidden>Load more</button></main>
<footer><p>Olympia London, United Kingdom</p></footer>
<script>
let all=[],shown=0;
function draw(n){shown=Math.min(all.length,shown+n);
  document.getElementById('grid').innerHTML=all.slice(0,shown).map(e=>`<div class="card"><a href="/exhibitors-list/exhibitor/${e.slug}/">${e.name}</a><span>Stand ${e.stand}</span></div>`).join('');
  document.getElementById('more').hidden = shown>=all.length;}
fetch('/api/exhibitors.json').then(r=>r.json()).then(d=>{all=d;draw(3);});
document.getElementById('more').onclick=()=>setTimeout(()=>draw(3),200);
</script></body></html>""")

    def detail(slug, body, head=""):
        write(root, f"exhibitors-list/exhibitor/{slug}/index.html", f"""<html><head><title>{slug} | Cyber Expo</title>{head}</head><body>
<header><nav><a href="/">Home</a><a href="/exhibitors-list/">Back to exhibitors</a></nav></header>
<main>{body}</main><footer><p>Olympia London, United Kingdom</p><a href="https://twitter.com/cyberexpo">Twitter</a></footer></body></html>""")

    detail("acme-cyber-defence", f"""<h1>Acme Cyber Defence Ltd</h1><p class="stand">Stand: C12</p><p>Country: United Kingdom</p>
<div class="exhibitor-description"><p>Acme Cyber Defence provides managed SOC, threat intelligence and incident response for government and critical national infrastructure.</p></div>
<ul class="categories"><li>Threat Intelligence</li><li>Managed SOC</li></ul>
<a class="btn" href="{sites['acme']}">Visit website</a> <a href="https://www.linkedin.com/company/acme-cyber">LinkedIn</a> <a href="mailto:sales@acme.example">Email</a>""")
    ld = {"@context": "https://schema.org", "@type": "Organization", "name": "Nordlight Crypto AB", "url": sites["nordlight"],
          "description": "Hardware encryption modules and secure communication gateways for classified networks.",
          "address": {"@type": "PostalAddress", "addressCountry": "Sweden"}}
    detail("nordlight-crypto", "<h1>Nordlight Crypto AB</h1><p>Booth B07</p>",
           head=f'<script type="application/ld+json">{json.dumps(ld)}</script>')
    detail("skyguard-systems", f"""<h1>SkyGuard Systems GmbH</h1><div class="info"><span>Stand F3</span> <span>Location: Germany</span></div>
<div class="about"><p>SkyGuard delivers counter-drone radar, RF detection and mitigation for airports and critical sites.</p></div>
<a href="{sites['skyguard']}">www.skyguard.example</a>""")
    detail("orbis-labs", """<h1>Orbis Labs</h1><p>Stand D3</p><div class="description"><p>Orbis Labs offers post-quantum encryption libraries and key management for software vendors and banks.</p></div>""")
    detail("acme-partner-pavilion", f"""<h1>Acme Cyber (Partner Pavilion)</h1><p>Stand C14</p>
<div class="description"><p>Acme partners showcase joint SOC solutions in the partner pavilion at the expo this year.</p></div><a href="{sites['acme']}">Visit website</a>""")

    # Danh sách tĩnh có phân trang (không JavaScript)
    for i, names in enumerate([["Alpha Radio", "Beta Radio", "Gamma Radio"], ["Delta Radio", "Epsilon Radio", "Zeta Radio"]], 1):
        nxt = '<a rel="next" href="/paged/page-2/">Next</a>' if i == 1 else ""
        links = "".join(f'<li><a href="/paged/company/{n.split()[0].lower()}/">{n}</a></li>' for n in names)
        write(root, f"paged/page-{i}/index.html", f"<html><body><main><ul>{links}</ul>{nxt}</main></body></html>")
        for n in names:
            write(root, f"paged/company/{n.split()[0].lower()}/index.html",
                  f"<html><body><main><h1>{n}</h1><p>Booth A{i}0</p><div class='description'><p>{n} builds tactical radio and software defined radio equipment for public safety.</p></div></main></body></html>")

    srv, url = serve(root)
    servers.append(srv)
    yield {"url": url, "sites": sites}
    for s in servers:
        s.shutdown()
