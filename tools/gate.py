"""tools/gate.py - the one gate (v3.42).

Runs, in order, everything a release must pass and prints one scoreboard:

  1. node test/run-all.mjs                                   (the headless harnesses)
  2. python -m unittest discover -s test -p 'test_*.py'      (the Python tests)
  3. python -m ruff check .                                  (lint)
  4. python tools/export_viewer_sql.py --check               (the viewer's SQL is the tool's SQL)
  5. index.html?selftest=1 and run-ledger.html?selftest=1 in a headless Chromium-based
     browser (Chrome / Chromium / Edge), served over http on a free local port and
     scraped for the `WT-SELFTEST: PASS n/n` line the pages print.

Then it prints the README line-9 sentence with the measured counts and, with
--check-readme, fails when README's counts drift from what was measured (the date is
not compared). Exit 0 only when every step passed. Standard library only, Python 3.9+.

    python tools/gate.py                    # everything
    python tools/gate.py --skip-node        # without the harnesses (they take minutes)
    python tools/gate.py --skip-node --skip-python --check-readme   # what CI's browser job runs

A missing `WT-SELFTEST:` line is a failure, never a pass. The browser is given its own
temporary profile: without one a running Chrome or Edge adopts the request and prints
nothing. Under CI on Linux the sandbox is disabled (the runner is already a container).
"""
import argparse
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

BROWSER_NAMES = ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "msedge", "chrome")
BROWSER_PATHS = (
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
)
PAGES = (("index.html?selftest=1", None), ("run-ledger.html?selftest=1", "run-ledger"))
COUNT_KEYS = ("harnesses", "python", "app_pass", "app_total", "viewer_pass", "viewer_total", "cache")

SELFTEST_RE = re.compile(r"WT-SELFTEST: (PASS|FAIL) (\d+)/(\d+)")
DATA_PAGE_RE = re.compile(r'data-page="([a-z-]+)"')
NODE_SUMMARY_RE = re.compile(r"^(?:ALL (\d+) HARNESSES PASSED|(\d+) OF (\d+) HARNESSES FAILED)\s*$", re.M)
UNITTEST_RAN_RE = re.compile(r"^Ran (\d+) tests? in", re.M)
CACHE_RE = re.compile(r'const CACHE_VERSION = "(wt-v\d+)"')
HARNESS_ENTRY_RE = re.compile(r"^\s*\{ name: ", re.M)
README_LINE9_RE = re.compile(
    r"^- \*\*Verified at the current commit \((\d{4}-\d{2}-\d{2})\)\*\* — `node test/run-all\.mjs`: "
    r"\*\*(\d+) headless harnesses\*\* green; `python -m pytest test`: \*\*(\d+) Python tests\*\* green; "
    r"`index\.html\?selftest=1` in headless Chromium: \*\*WT-SELFTEST PASS (\d+)/(\d+)\*\* and "
    r"`run-ledger\.html\?selftest=1`: \*\*WT-SELFTEST PASS (\d+)/(\d+)\*\*; service-worker cache `(wt-v\d+)`\."
)


# ----------------------------------------------------------------------------- helpers
def run(cmd, timeout=1800):
    """Run a command in the repo root; return (returncode, stdout, stderr) as text."""
    p = subprocess.run(cmd, cwd=str(ROOT), capture_output=True, text=True, errors="replace", timeout=timeout)
    return p.returncode, p.stdout or "", p.stderr or ""


def node_exe():
    return shutil.which("node") or "node"


# ----------------------------------------------------------------------------- steps
def run_node():
    code, out, err = run([node_exe(), "test/run-all.mjs"])
    found = list(NODE_SUMMARY_RE.finditer(out))
    m = found[-1] if found else None
    if m is None:
        return {"ok": False, "harnesses": None, "detail": f"no summary line (exit {code})"}
    if m.group(1) is not None:
        return {"ok": code == 0, "harnesses": int(m.group(1)), "detail": m.group(0).strip()}
    return {"ok": False, "harnesses": int(m.group(3)), "detail": m.group(0).strip()}


def run_unittest():
    code, out, err = run([sys.executable, "-m", "unittest", "discover", "-s", "test", "-p", "test_*.py"])
    text = out + "\n" + err
    m = UNITTEST_RAN_RE.search(text)
    n = int(m.group(1)) if m else None
    tail = text.strip().splitlines()[-1] if text.strip() else f"exit {code}"
    return {"ok": code == 0 and n is not None, "tests": n, "detail": (f"Ran {n} tests; " if n is not None else "") + tail}


def run_ruff():
    code, out, err = run([sys.executable, "-m", "ruff", "check", "."])
    return {"ok": code == 0, "detail": (out.strip().splitlines() or [err.strip() or "clean"])[-1]}


def run_sql_check():
    code, out, err = run([sys.executable, "tools/export_viewer_sql.py", "--check"])
    return {"ok": code == 0, "detail": (out.strip() or err.strip() or f"exit {code}").splitlines()[-1]}


# ----------------------------------------------------------------------------- browser
class _Quiet(SimpleHTTPRequestHandler):
    def log_message(self, format, *args):  # noqa: A002 - the base class names it `format`
        pass


def serve(root=ROOT):
    """Serve `root` over http on a free 127.0.0.1 port; returns (server, port). Daemon thread."""
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(_Quiet, directory=str(root)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, server.server_address[1]


def find_browser(explicit=None):
    """A Chromium-based browser executable, or None. Never raises."""
    if explicit:
        if Path(explicit).is_file():
            return str(Path(explicit))
        return shutil.which(explicit)
    for name in BROWSER_NAMES:
        hit = shutil.which(name)
        if hit:
            return hit
    for p in BROWSER_PATHS:
        if Path(p).is_file():
            return p
    return None


def parse_selftest(dom):
    """The LAST `WT-SELFTEST: PASS|FAIL n/n` in a DOM dump -> (status, passed, total), else None.
    The pages also quote the format in prose as `PASS n/n`; the digits keep that from matching."""
    found = list(SELFTEST_RE.finditer(dom or ""))
    m = found[-1] if found else None
    return (m.group(1), int(m.group(2)), int(m.group(3))) if m else None


def browser_args(browser, url, budget, profile):
    args = [browser, "--headless=new", "--disable-gpu", "--no-first-run", "--disable-extensions",
            "--disable-background-networking", f"--user-data-dir={profile}",
            f"--virtual-time-budget={int(budget)}", "--dump-dom", url]
    if os.environ.get("CI") and sys.platform != "win32":
        args[1:1] = ["--no-sandbox", "--disable-dev-shm-usage"]
    return args


def run_selftest(browser, url, budget=30000, timeout=180, want_page=None):
    """Open `url` headlessly and scrape the self-test line. Retries once at twice the budget
    when no line was printed. Returns a dict with ok / status / passed / total / detail."""
    with tempfile.TemporaryDirectory(prefix="wt-gate-") as profile:
        for attempt, b in enumerate((budget, budget * 2)):
            t0 = time.time()
            try:
                p = subprocess.run(browser_args(browser, url, b, profile), capture_output=True, text=True,
                                   errors="replace", timeout=timeout)
            except subprocess.TimeoutExpired:
                return {"ok": False, "detail": f"browser timed out after {timeout} s"}
            dom = p.stdout or ""
            got = parse_selftest(dom)
            secs = time.time() - t0
            if got is None:
                if attempt == 0:
                    continue
                return {"ok": False, "detail": f"no WT-SELFTEST line in the DOM ({len(dom)} bytes, exit {p.returncode}, {secs:.1f} s)"}
            status, passed, total = got
            page = DATA_PAGE_RE.search(dom)
            page = page.group(1) if page else None
            ok = status == "PASS" and passed == total and total > 0 and (want_page is None or page == want_page)
            detail = f"WT-SELFTEST: {status} {passed}/{total} ({secs:.1f} s, budget {b} ms" + (f", data-page={page}" if page else "") + ")"
            if status == "FAIL":
                m = re.search(r"WT-SELFTEST: FAIL \d+/\d+ :: ([^<]*)", dom)
                if m:
                    detail += " :: " + m.group(1).strip()[:300]
            return {"ok": ok, "status": status, "passed": passed, "total": total, "page": page, "detail": detail}
    return {"ok": False, "detail": "unreachable"}


# ----------------------------------------------------------------------------- README
def read_line9(readme=None):
    text = readme if readme is not None else (ROOT / "README.md").read_text(encoding="utf-8")
    lines = text.splitlines()
    return lines[8] if len(lines) > 8 else ""


def parse_line9(line):
    """-> dict(date, harnesses, python, app_pass, app_total, viewer_pass, viewer_total, cache, tail) or None."""
    m = README_LINE9_RE.match(line)
    if not m:
        return None
    return {"date": m.group(1), "harnesses": int(m.group(2)), "python": int(m.group(3)),
            "app_pass": int(m.group(4)), "app_total": int(m.group(5)),
            "viewer_pass": int(m.group(6)), "viewer_total": int(m.group(7)),
            "cache": m.group(8), "tail": line[m.end():]}


def render_line9(v):
    """The sentence from its parts (the inverse of parse_line9)."""
    return (f"- **Verified at the current commit ({v['date']})** — `node test/run-all.mjs`: "
            f"**{v['harnesses']} headless harnesses** green; `python -m pytest test`: **{v['python']} Python tests** green; "
            f"`index.html?selftest=1` in headless Chromium: **WT-SELFTEST PASS {v['app_pass']}/{v['app_total']}** and "
            f"`run-ledger.html?selftest=1`: **WT-SELFTEST PASS {v['viewer_pass']}/{v['viewer_total']}**; "
            f"service-worker cache `{v['cache']}`.{v.get('tail', '')}")


def cache_version():
    m = CACHE_RE.search((ROOT / "sw.js").read_text(encoding="utf-8"))
    return m.group(1) if m else None


def harness_entries():
    """How many harnesses test/run-all.mjs lists (a static count for when the node step is skipped)."""
    return len(HARNESS_ENTRY_RE.findall((ROOT / "test" / "run-all.mjs").read_text(encoding="utf-8")))


def check_readme(measured):
    """Compare README line 9 with what was measured; unmeasured counts are not compared."""
    current = parse_line9(read_line9())
    if current is None:
        return {"ok": False, "detail": "README line 9 does not match the expected sentence"}
    drift = [f"{k}: README {current[k]} vs measured {measured[k]}" for k in COUNT_KEYS
             if measured.get(k) is not None and measured[k] != current[k]]
    checked = [k for k in COUNT_KEYS if measured.get(k) is not None]
    return {"ok": not drift, "detail": "; ".join(drift) if drift else "counts match (" + ", ".join(checked) + ")"}


# ----------------------------------------------------------------------------- main
def main(argv=None):
    ap = argparse.ArgumentParser(description="The one gate: harnesses, Python tests, lint, generated SQL, both browser self-tests, README line 9.")
    ap.add_argument("--browser", help="a Chromium-based browser executable (default: the first found)")
    ap.add_argument("--virtual-time-budget", type=int, default=30000, help="Chromium virtual-time budget in ms per page (default 30000)")
    ap.add_argument("--skip-node", action="store_true", help="do not run node test/run-all.mjs")
    ap.add_argument("--skip-python", action="store_true", help="do not run unittest, ruff and the generated-SQL check")
    ap.add_argument("--skip-browser", action="store_true", help="do not run the two in-browser self-tests")
    ap.add_argument("--check-readme", action="store_true", help="fail when README line 9 drifts from the measured counts")
    ap.add_argument("--date", default=time.strftime("%Y-%m-%d"), help="the date to print in the README sentence")
    a = ap.parse_args(argv)
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

    rows = []
    measured = {"cache": cache_version()}

    def row(name, r):
        rows.append((name, r))
        print(f"GATE  {name:<46} {'PASS' if r['ok'] else 'FAIL'}  {r.get('detail', '')}", flush=True)

    if not a.skip_node:
        r = run_node()
        measured["harnesses"] = r.get("harnesses")
        row("node test/run-all.mjs", r)
    else:
        measured["harnesses"] = harness_entries()
        print(f"GATE  {'node test/run-all.mjs':<46} SKIP  {measured['harnesses']} harnesses listed", flush=True)
    if not a.skip_python:
        r = run_unittest()
        measured["python"] = r.get("tests")
        row("python -m unittest discover -s test", r)
        row("python -m ruff check .", run_ruff())
        row("python tools/export_viewer_sql.py --check", run_sql_check())
    if not a.skip_browser:
        browser = find_browser(a.browser)
        if not browser:
            row("browser", {"ok": False, "detail": "no Chromium-based browser found (use --browser)"})
        else:
            server, port = serve()
            try:
                for page, want in PAGES:
                    r = run_selftest(browser, f"http://127.0.0.1:{port}/{page}", a.virtual_time_budget, want_page=want)
                    key = "viewer" if want == "run-ledger" else "app"
                    measured[key + "_pass"], measured[key + "_total"] = r.get("passed"), r.get("total")
                    row(page, r)
            finally:
                server.shutdown()
            print(f"GATE  browser: {Path(browser).name} ({browser})")
    if a.check_readme:
        row("README line 9", check_readme(measured))

    sentence = dict(parse_line9(read_line9()) or {})
    sentence.update({k: v for k, v in measured.items() if v is not None})
    sentence["date"] = a.date
    if all(k in sentence for k in COUNT_KEYS):
        print("README line 9:")
        print(render_line9(sentence))
    ok = all(r["ok"] for _, r in rows)
    print("GATE RESULT: " + ("PASS" if ok else "FAIL"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
