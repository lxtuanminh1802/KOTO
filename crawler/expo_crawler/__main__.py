"""CLI.

  python -m expo_crawler list
  python -m expo_crawler probe --url https://www.internationalcyberexpo.com/exhibitors-list
  python -m expo_crawler run --source international-cyber-expo [--push] [--limit 10]
  python -m expo_crawler run --url https://.../exhibitors --name "Tên triển lãm"
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
from pathlib import Path

from .crawl import Source, State, crawl_source, load_sources, probe
from .fetch import Fetcher
from .sink import push, write_json

HERE = Path(__file__).resolve().parent.parent


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-") or "source"


def make_fetcher(args, defaults: dict) -> Fetcher:
    return Fetcher(delay=args.delay if args.delay is not None else defaults.get("delay", 1.5),
                   respect_robots=defaults.get("respect_robots", True))


def cmd_list(args) -> int:
    _, sources = load_sources(args.config)
    for s in sources:
        print(f"{s.id:32} {s.schedule:7} {s.url}")
    return 0


def cmd_probe(args) -> int:
    defaults, _ = load_sources(args.config)
    f = make_fetcher(args, defaults)
    try:
        result = probe(args.url, f, args.link_selector, sample=args.sample, website=not args.no_website)
    finally:
        f.close()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["links_found"] else 1


def cmd_run(args) -> int:
    defaults, sources = load_sources(args.config)
    if args.source:
        matches = [s for s in sources if s.id == args.source]
        if not matches:
            print(f"Không có nguồn '{args.source}' trong {args.config}", file=sys.stderr)
            return 2
        targets = matches
    elif args.url:
        name = args.name or args.url
        targets = [Source(id=slug(name), name=name, url=args.url, link_selector=args.link_selector,
                          default_mang=args.default_mang, render=args.render or "auto")]
    else:
        targets = [s for s in sources if s.schedule != "once" or args.all]

    f = make_fetcher(args, defaults)
    api_url = os.environ.get("EXPO_PUSH_URL")
    rc = 0
    try:
        for src in targets:
            if args.render:
                src.render = args.render
            state = None if args.full else State(Path(args.state_dir) / f"{src.id}.json")
            items = crawl_source(src, f, state, limit=args.limit, crawl_website=False if args.no_website else None)
            out = write_json(Path(args.out) / f"{src.id}.json", src.to_meta(), items)
            print(f"[{src.id}] {len(items)} hãng mới → {out}")
            if args.push:
                if not api_url:
                    print("Thiếu biến môi trường EXPO_PUSH_URL", file=sys.stderr)
                    rc = 2
                else:
                    res = push(api_url, os.environ.get("EXPO_PUSH_TOKEN"), src.to_meta(), items)
                    print(f"[{src.id}] đẩy lên API: {res}")
                    rc = rc or (1 if res["errors"] else 0)
            if state is not None and not (args.push and rc):
                state.save()
    finally:
        f.close()
    return rc


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="expo_crawler", description="Crawl danh sách exhibitor triển lãm")
    p.add_argument("--config", default=str(HERE / "sources.yaml"))
    p.add_argument("--delay", type=float, default=None, help="giây giữa 2 request tới cùng host")
    p.add_argument("-v", "--verbose", action="store_true")
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("list", help="liệt kê nguồn trong sources.yaml")

    pr = sub.add_parser("probe", help="kiểm tra một URL nguồn trước khi thêm")
    pr.add_argument("--url", required=True)
    pr.add_argument("--link-selector")
    pr.add_argument("--sample", type=int, default=1)
    pr.add_argument("--no-website", action="store_true")

    r = sub.add_parser("run", help="crawl nguồn")
    g = r.add_mutually_exclusive_group()
    g.add_argument("--source", help="id nguồn trong sources.yaml")
    g.add_argument("--url", help="crawl một URL bất kỳ")
    r.add_argument("--all", action="store_true", help="gồm cả nguồn schedule: once")
    r.add_argument("--name")
    r.add_argument("--link-selector")
    r.add_argument("--default-mang")
    r.add_argument("--render", choices=["auto", "always", "never"])
    r.add_argument("--limit", type=int, help="số hãng tối đa (để thử)")
    r.add_argument("--no-website", action="store_true", help="không vào website hãng lấy giới thiệu")
    r.add_argument("--full", action="store_true", help="crawl lại cả hãng đã lấy")
    r.add_argument("--push", action="store_true", help="đẩy lên API (EXPO_PUSH_URL, EXPO_PUSH_TOKEN)")
    r.add_argument("--out", default=str(HERE / "output"))
    r.add_argument("--state-dir", default=str(HERE / "state"))

    args = p.parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO, format="%(levelname)s %(message)s")
    return {"list": cmd_list, "probe": cmd_probe, "run": cmd_run}[args.cmd](args)


if __name__ == "__main__":
    sys.exit(main())
