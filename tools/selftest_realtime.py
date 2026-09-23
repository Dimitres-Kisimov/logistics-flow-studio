"""tools/selftest_realtime.py - the in-browser self-test in REAL time (v3.53).

    python tools/selftest_realtime.py                       # index.html?selftest=1
    python tools/selftest_realtime.py run-ledger.html       # the viewer's suite
    python tools/selftest_realtime.py --grep tracking       # print the checks whose name matches

Why this exists beside tools/gate.py: the gate drives Chrome with --virtual-time-budget and
--dump-dom, which is deterministic and fast but leaves IndexedDB requests incomplete under that
budget (an open and a write went through, a read never returned), so the app self-test keeps
the tracking store on its memory backend unless the page is opened with &idb=1. This script
serves the folder over http, opens the same page with &idb=1 in headless Chrome through
Playwright with wall-clock time, waits for the self-test line, and prints it with the detail of
every check whose name matches --grep (default: tracking). Exit 0 only when the suite passes;
--expect-backend indexeddb (the default for index.html) also requires the tracking check's
detail to name that backend.

Playwright is a build-time tool here (see CREDITS "Tooling"), not a runtime dependency; the
browser is looked up like tools/gate.py does.
"""
from __future__ import annotations

import argparse
import re
import sys
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import gate as G  # noqa: E402


class _Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *args):  # noqa: D401 - silence the request log
        pass


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("page", nargs="?", default="index.html", help="index.html (default) or run-ledger.html")
    ap.add_argument("--grep", default="tracking", help="print the checks whose name contains this text (default: tracking)")
    ap.add_argument("--expect-backend", default=None, help="require the tracking check's detail to name this store backend (default: indexeddb for index.html)")
    ap.add_argument("--timeout", type=int, default=120, help="seconds to wait for the self-test line (default 120)")
    a = ap.parse_args(argv)
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("playwright is not installed: python -m pip install playwright && python -m playwright install chromium", file=sys.stderr)
        return 2
    browser = G.find_browser() if hasattr(G, "find_browser") else None
    expect = a.expect_backend if a.expect_backend is not None else ("indexeddb" if a.page.startswith("index.html") else None)
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(_Quiet, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    # &idb=1 makes the app self-test open the tracking store on IndexedDB (the gate's virtual-time driver keeps the memory backend)
    url = f"http://127.0.0.1:{server.server_address[1]}/{a.page}?selftest=1" + ("&idb=1" if a.page.startswith("index.html") else "")
    logs: list[str] = []
    line = None
    try:
        with sync_playwright() as p:
            launch = {"headless": True}
            if browser:
                launch["executable_path"] = browser
            b = p.chromium.launch(**launch)
            pg = b.new_page(viewport={"width": 1400, "height": 1000})
            pg.on("console", lambda m: logs.append(m.text))
            pg.on("pageerror", lambda e: logs.append("PAGEERROR " + str(e)))
            pg.goto(url)
            try:
                pg.wait_for_selector("#wt-selftest[data-total]", state="attached", timeout=a.timeout * 1000)
                line = pg.locator("#wt-selftest").text_content()
            except Exception as e:  # noqa: BLE001 - report, do not raise
                print(f"no self-test line within {a.timeout} s: {e}")
            b.close()
    finally:
        server.shutdown()
    print(f"{a.page}: {line or 'no result'}")
    hits = [x for x in logs if a.grep.lower() in x.lower() and re.match(r"\s*\[(PASS|FAIL)\]", x)]
    for x in hits:
        print(x[:400])
    for x in logs:
        if x.startswith("PAGEERROR") or re.match(r"\s*\[FAIL\]", x):
            print(x[:400])
    ok = bool(line) and line.startswith("WT-SELFTEST: PASS")
    if ok and expect:
        ok = any(f"store {expect}" in x for x in hits)
        if not ok:
            print(f"the tracking check did not name the {expect} backend")
    print("REALTIME RESULT:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
