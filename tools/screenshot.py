"""tools/screenshot.py - the README screenshots, taken from the live app with a real browser (v3.51).

Serves the repo over localhost, drives the app through its own controls (the rail drawers, the
mode button, the Class Library toggles, Fit) and writes:

    docs/img/class-library.png        the Class Library in Factory mode, Machines (DIN 8580) open, 2.5D thumbnails (2x DPR)
    docs/img/nist-box-assembly-2d.png the NIST box-assembly cell on the floor plan with the factory panel (measured vs modelled)
    docs/img/nist-box-assembly-iso.png the same cell in the 2.5D view with a machining centre's provenance in the Inspector
    docs/img/hero-plant-2d.png        (--hero) the README hero: the mega plant fitted, three drawers docked
    docs/img/warehousetwin.png        (--hero) the starter demo layout with the Class Library open

Needs `pip install playwright` and `python -m playwright install chromium`; not part of the gate or CI
(CI checks the sizes the one-pager embeds, not the pixels). The app is driven exactly as a person
would drive it - no test API, no hidden flags - so a screenshot is what the page shows.

    python tools/screenshot.py            # the three v3.51 images
    python tools/screenshot.py --hero     # + the hero and the starter
    python tools/screenshot.py --out DIR  # somewhere else (a review folder)
"""
import argparse
import http.server
import socketserver
import sys
import threading
import time
from functools import partial
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
IMG = ROOT / "docs" / "img"
DRAWERS_KEY = "wt.ui.drawers.v1"


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a, **k):
        pass


def serve(root):
    port = 9600 + int(time.time()) % 300
    httpd = socketserver.TCPServer(("127.0.0.1", port), partial(Quiet, directory=str(root)))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, f"http://127.0.0.1:{port}/index.html"


def seed_drawers(page, names):
    open_names = str(list(names)).replace("'", '"')
    page.add_init_script(f"try {{ localStorage.setItem('{DRAWERS_KEY}', JSON.stringify({{open: {open_names}, layout: {{}}}})); }} catch (e) {{}}")


def click_id(page, el_id):
    page.evaluate("(id) => { const b = document.getElementById(id); if (b) b.click(); }", el_id)


def factory_mode(page):
    page.evaluate("() => { const b = document.getElementById('modeBtn'); if (b && b.getAttribute('aria-pressed') !== 'true') b.click(); }")


def close_assistant(page):
    click_id(page, "sceneAssistantClose")


def open_group(page, label):
    page.evaluate("(label) => { const h = Array.from(document.querySelectorAll('#palette .pal-group-head')).find(e => e.textContent.indexOf(label) >= 0);"
                  " if (h && h.getAttribute('aria-expanded') !== 'true') h.click(); }", label)


def shot_class_library(b, base, out):
    page = b.new_page(viewport={"width": 1400, "height": 1100}, device_scale_factor=2)
    seed_drawers(page, ["library"])
    page.goto(base + "?onboarding=0", wait_until="load")
    page.wait_for_timeout(1500)
    close_assistant(page)
    factory_mode(page)
    page.wait_for_timeout(500)
    open_group(page, "Machines")
    page.click('#palViewToggle [data-view="iso"]')
    page.wait_for_timeout(600)
    page.evaluate("() => { const h = Array.from(document.querySelectorAll('#palette .pal-group-head')).find(e => /Machines/.test(e.textContent)); if (h) h.scrollIntoView({block: 'start'}); }")
    page.mouse.move(1300, 900)  # away from the list, so no hover card is open
    page.wait_for_timeout(400)
    panel = page.query_selector('.wt-drawer-panel[data-drawer="library"]') or page.query_selector("#paletteCard")
    box = panel.bounding_box()
    page.screenshot(path=str(out / "class-library.png"), clip={"x": box["x"], "y": box["y"], "width": box["width"], "height": min(box["height"], 1100 - box["y"])})
    page.click('#palViewToggle [data-view="plan"]')
    page.close()
    print("wrote class-library.png")


def shot_nist(b, base, out):
    page = b.new_page(viewport={"width": 1600, "height": 1000}, device_scale_factor=1.5)
    seed_drawers(page, ["simulate"])
    page.goto(base + "?scenario=nist-box-assembly-cell&onboarding=0", wait_until="load")
    page.wait_for_timeout(2500)
    close_assistant(page)
    factory_mode(page)
    page.wait_for_timeout(400)
    click_id(page, "zoomFitBtn")
    page.wait_for_timeout(600)
    # the factory panel: fold the shift worksheet above it, unfold the panel (the card titles are the toggles), scroll to it
    page.evaluate("() => { const t = document.querySelector('#capacityCard > .card-title'); if (t && t.getAttribute('aria-expanded') === 'true') t.click(); }")
    page.evaluate("() => { const t = document.querySelector('#procCard > .card-title'); if (t && t.getAttribute('aria-expanded') !== 'true') t.click();"
                  " const c = document.getElementById('procCard'); if (c) c.scrollIntoView({block: 'start'}); }")
    page.mouse.move(1500, 950)
    page.wait_for_timeout(500)
    page.screenshot(path=str(out / "nist-box-assembly-2d.png"))
    print("wrote nist-box-assembly-2d.png")
    # the 2.5D view with the first machining centre selected: click along the machining lane until the Inspector names Hurco02
    page.evaluate("() => document.querySelector('.wt-rail-btn[data-drawer=\"simulate\"]').click()")
    page.wait_for_timeout(200)
    page.evaluate("() => document.querySelector('.wt-rail-btn[data-drawer=\"inspect\"]').click()")
    page.wait_for_timeout(300)
    r = page.query_selector("#floor").bounding_box()
    for fx in (0.3, 0.36, 0.42, 0.48, 0.54, 0.6, 0.66, 0.72):
        for fy in (0.24, 0.28, 0.32):
            page.mouse.click(r["x"] + r["width"] * fx, r["y"] + r["height"] * fy)
            page.wait_for_timeout(120)
            if "Hurco02" in page.evaluate("() => (document.getElementById('propCard') || document.body).textContent"):
                break
        else:
            continue
        break
    click_id(page, "isoBtn")
    page.wait_for_timeout(1200)
    page.screenshot(path=str(out / "nist-box-assembly-iso.png"))
    page.close()
    print("wrote nist-box-assembly-iso.png")


def shot_hero(b, base, out):
    page = b.new_page(viewport={"width": 1680, "height": 1280})
    seed_drawers(page, ["generate", "inspect", "simulate"])
    page.goto(base + "?scenario=mega-automated-fulfilment-plant&onboarding=0", wait_until="load")
    page.wait_for_timeout(2500)
    click_id(page, "zoomFitBtn")
    page.wait_for_timeout(1200)
    page.screenshot(path=str(out / "hero-plant-2d.png"))
    page.close()
    page = b.new_page(viewport={"width": 1400, "height": 1180})
    seed_drawers(page, ["library"])
    page.goto(base + "?onboarding=0", wait_until="load")
    page.wait_for_timeout(1500)
    click_id(page, "demoBtn")
    page.wait_for_timeout(800)
    close_assistant(page)
    click_id(page, "zoomFitBtn")
    page.wait_for_timeout(5500)  # the starter's heads-up toast fades first
    page.screenshot(path=str(out / "warehousetwin.png"))
    page.close()
    print("wrote hero-plant-2d.png, warehousetwin.png")


def quantise(paths):
    """256-colour PNGs keep the README light; a no-op without Pillow."""
    try:
        from PIL import Image
    except ImportError:
        return
    for p in paths:
        im = Image.open(p).convert("RGB")
        im.quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.FLOYDSTEINBERG).save(p, optimize=True)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--out", default=str(IMG))
    ap.add_argument("--hero", action="store_true", help="also retake the README hero and the starter shot")
    a = ap.parse_args(argv)
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("playwright is not installed: pip install playwright && python -m playwright install chromium", file=sys.stderr)
        return 2
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    httpd, base = serve(ROOT)
    errors = []
    try:
        with sync_playwright() as p:
            b = p.chromium.launch()
            b.on("disconnected", lambda: None)
            shot_class_library(b, base, out)
            shot_nist(b, base, out)
            if a.hero:
                shot_hero(b, base, out)
            b.close()
    finally:
        httpd.shutdown()
    names = ["class-library.png", "nist-box-assembly-2d.png", "nist-box-assembly-iso.png"] + (["hero-plant-2d.png", "warehousetwin.png"] if a.hero else [])
    quantise([out / n for n in names if (out / n).exists()])
    for n in names:
        f = out / n
        print(f"{n}: {f.stat().st_size} bytes" if f.exists() else f"{n}: MISSING")
    return 0 if not errors else 1


if __name__ == "__main__":
    sys.exit(main())
