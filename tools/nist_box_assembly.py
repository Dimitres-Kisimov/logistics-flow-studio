"""tools/nist_box_assembly.py - measured machining run times from a public dataset (v3.50).

The NIST Smart Manufacturing Systems Test Bed published the design, manufacturing and
inspection data of a "Box Assembly" (three parts - Box, Cover, Plate - twenty instances
each, machined on two Hurco VMX 24 vertical machining centres, test-bed device ids Hurco02
and Hurco04) at github.com/usnistgov/smstestbed, folder tdp/mtc. The Split folder holds
one MTConnect log per part instance and operation, pipe-delimited `timestamp|item|value`.
This tool turns those logs into ONE small, committed, reviewable file of run-time
statistics that the app's `nist-box-assembly` factory profile reads - nothing else of the
dataset is shipped.

THE REDUCTION RULE (stated once, applied everywhere, recorded in the JSON):
  1. For one log, take the `Program_Runtime_Seconds` samples in file order.
  2. Drop LEADING STALE samples: a leading sample that is larger than the sample after it
     is the previous program's counter, still displayed before the new program started
     counting (e.g. `1500` then `0`, or `1081` then `1`). Nothing after the first genuine
     sample is dropped.
  3. The instance run time is the MAXIMUM of the remaining samples. The controller shows
     a single `0` at the 60 s mark and then continues (`59, 0, 60, 61 ...`); the maximum
     is unaffected by that glitch and by feed holds (the counter pauses, the wall clock
     does not). The count of such mid-run zeros is recorded.
  4. Cross-check only: the wall-clock span from the first `Program_Status|ACTIVE` to the
     last `Program_Status|PROGRAM_COMPLETED` must be >= the run time (minus 5 s of
     sampling slack); a log without a PROGRAM_COMPLETED, with no sample after the stale
     prefix, or failing the span check is UNUSABLE and counted, never filled in.
  5. Per (part, operation, machine): files, usable, min / median / max / mean of the
     usable run times, the span-check worst case. The median is the number the app uses.

    python tools/nist_box_assembly.py fetch            # download Split (~62 MB) into .cache/nist-smstestbed/ (git-ignored)
    python tools/nist_box_assembly.py reduce           # cache -> data/nist-box-assembly.json + .js + docs/NIST_BOX_ASSEMBLY.md
    python tools/nist_box_assembly.py --check          # fetch + reduce into a temp dir, compare with the committed files (network)
    python tools/nist_box_assembly.py --offline-check  # JS twin, Markdown and schema agree with the JSON (no network; the tests run this)

Attribution: NIST-developed data is provided as a public service; acknowledgment is
appreciated; the use of the NIST logo is not allowed. The notice is kept verbatim in the
JSON (`source.notice`) and in CREDITS.md. The machine models are as documented by NIST
(AMS 200-2 device descriptions), not a vendor claim.
"""
import argparse
import io
import json
import re
import statistics
import sys
import tempfile
import urllib.request
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / ".cache" / "nist-smstestbed"
DATA_JSON = ROOT / "data" / "nist-box-assembly.json"
DATA_JS = ROOT / "data" / "nist-box-assembly.js"
DOC_MD = ROOT / "docs" / "NIST_BOX_ASSEMBLY.md"

REPO = "usnistgov/smstestbed"
BRANCH = "master"
FOLDERS = ("tdp/mtc/Split", "tdp/mtc/PartData")
API = "https://api.github.com/repos/%s/contents/%s?ref=%s"
RAW = "https://raw.githubusercontent.com/%s/%s/%s"
NAME_RE = re.compile(r"^(?P<part>[A-Za-z]+)-(?:(?P<op>[A-Za-z0-9]+)-)?(?P<machine>[A-Za-z]+\d+)-(?P<i>\d+)of(?P<n>\d+)\.txt$")
PARTS = ("Box", "Cover", "Plate")
SCHEMA = "wt-dataset-1"
DATASET_ID = "nist-box-assembly"
TITLE = "NIST SMS Test Bed - Box Assembly: machining run times per operation"
SPAN_SLACK_S = 5.0  # the status and the counter are sampled independently; a run time up to 5 s over the span is the same run

NOTICE = (
    "We would appreciate acknowledgment if any of the project results are used, however, the use of the NIST "
    "logo is not allowed. NIST-developed software is provided by NIST as a public service. You may use, copy and "
    "distribute copies of the software in any medium, provided that you keep intact this entire notice. "
    "NIST-developed software is expressly provided \"AS IS.\" NIST MAKES NO WARRANTY OF ANY KIND, EXPRESS, IMPLIED, "
    "IN FACT OR ARISING BY OPERATION OF LAW, INCLUDING, WITHOUT LIMITATION, THE IMPLIED WARRANTY OF MERCHANTABILITY, "
    "FITNESS FOR A PARTICULAR PURPOSE, NON-INFRINGEMENT AND DATA ACCURACY. The use of any software or hardware by the "
    "project does not imply a recommendation or endorsement by NIST."
)
RULE = (
    "Per log: take Program_Runtime_Seconds in file order; drop leading stale samples (a leading sample larger than "
    "its successor is the previous program's counter); the run time is the maximum of the remaining samples (the "
    "controller shows a single 0 at the 60 s mark and continues, and the counter pauses during feed holds, so the "
    "maximum is the program's running time); a log is usable only with a PROGRAM_COMPLETED status, at least one "
    "sample after the stale prefix and a wall-clock ACTIVE-to-PROGRAM_COMPLETED span >= run time - 5 s. Per "
    "(part, operation, machine): min / median / max / mean of the usable run times; the median is what the app uses. "
    "Nothing is filled in for an unusable or missing instance."
)
MACHINES = {
    "Hurco02": {
        "label": "Hurco VMX 24 #2 - 3-axis vertical machining centre",
        "note": "NIST test-bed device id Hurco02; model as documented in NIST AMS 200-2 (device descriptions), not a vendor claim",
    },
    "Hurco04": {
        "label": "Hurco VMX 24 #4 - 3-axis vertical machining centre",
        "note": "NIST test-bed device id Hurco04; model as documented in NIST AMS 200-2 (device descriptions), not a vendor claim",
    },
}
UNTIMED_CONTEXT = (
    "The test bed also documents Hurco VMX 24 #1 and #3, a Hurco VMX 42, a Hurco VMX 64, a GF Machining Solutions "
    "Mikron HPM600U (5-axis) and two Mazak turning centres (Integrex 100-IV, QuickTurn Nexus 300); none of them is "
    "timed in this package and none is modelled here."
)


# ---------------------------------------------------------------- parsing (pure)
def parse_name(name):
    """'Box-OP1-Hurco02-01of20.txt' -> dict(part, op, machine, i, n); PartData names have no op; None otherwise."""
    m = NAME_RE.match(name)
    if not m:
        return None
    return {"part": m["part"], "op": m["op"], "machine": m["machine"], "i": int(m["i"]), "n": int(m["n"])}


def parse_log(text):
    """Pipe-delimited MTConnect lines -> list of (timestamp, item, value); malformed lines are skipped."""
    out = []
    for line in text.splitlines():
        parts = line.split("|")
        if len(parts) < 3:
            continue
        out.append((parts[0].strip(), parts[1].strip(), "|".join(parts[2:]).strip()))
    return out


def _ts(s):
    s = s.rstrip("Z")
    if "." in s:
        head, frac = s.split(".", 1)
        s = head + "." + (frac + "000000")[:6]
    return datetime.fromisoformat(s)


def runtime_samples(records):
    """The Program_Runtime_Seconds values (floats) in file order; non-numeric values are skipped."""
    vals = []
    for _, item, value in records:
        if item != "Program_Runtime_Seconds":
            continue
        try:
            vals.append(float(value))
        except ValueError:
            continue
    return vals


def instance_runtime(values):
    """The rule's steps 2-3 on one log's samples.

    -> dict(runtime_s, stale_dropped, glitch_zeros, samples) or None when no sample survives.
    """
    k = 0
    while k + 1 < len(values) and values[k] > values[k + 1]:
        k += 1
    rest = values[k:]
    if not rest:
        return None
    glitch = sum(1 for j in range(1, len(rest)) if rest[j] == 0 and rest[j - 1] > 0)
    return {"runtime_s": max(rest), "stale_dropped": k, "glitch_zeros": glitch, "samples": len(rest)}


def wall_span(records):
    """Seconds from the first ACTIVE to the last PROGRAM_COMPLETED status, the hold count; None without both."""
    first_active = None
    last_done = None
    holds = 0
    for ts, item, value in records:
        if item != "Program_Status":
            continue
        if value == "ACTIVE" and first_active is None:
            first_active = ts
        elif value == "PROGRAM_COMPLETED":
            last_done = ts
        elif value == "FEED_HOLD":
            holds += 1
    if first_active is None or last_done is None:
        return None
    try:
        return {"span_s": (_ts(last_done) - _ts(first_active)).total_seconds(), "holds": holds}
    except ValueError:
        return None


def reduce_log(text):
    """One log -> dict(usable, reason, runtime_s, span_s, holds, stale_dropped, glitch_zeros, samples)."""
    records = parse_log(text)
    rt = instance_runtime(runtime_samples(records))
    span = wall_span(records)
    if rt is None:
        return {"usable": False, "reason": "no Program_Runtime_Seconds sample"}
    if span is None:
        return {"usable": False, "reason": "no ACTIVE / PROGRAM_COMPLETED status pair", "runtime_s": rt["runtime_s"]}
    ok = rt["runtime_s"] > 0 and span["span_s"] + SPAN_SLACK_S >= rt["runtime_s"]
    out = {"usable": ok, "reason": "" if ok else "run time exceeds the wall-clock span"}
    out.update(rt)
    out.update(span)
    return out


def reduce_group(runtimes):
    """min / median / max / mean of a list of run times (mean rounded to 0.1 s)."""
    if not runtimes:
        return None
    return {
        "min": min(runtimes),
        "median": statistics.median(runtimes),
        "max": max(runtimes),
        "mean": round(statistics.fmean(runtimes), 1),
    }


# ---------------------------------------------------------------- network (manual only)
def _get(url, timeout=60):
    req = urllib.request.Request(url, headers={"User-Agent": "logistics-flow-studio nist_box_assembly", "Accept": "application/vnd.github+json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def listing(folder):
    """The GitHub contents listing of one dataset folder -> list of dict(name, size, path)."""
    entries = json.loads(_get(API % (REPO, folder, BRANCH)).decode("utf-8"))
    if isinstance(entries, dict):
        raise RuntimeError("GitHub API: " + str(entries.get("message")))
    return [{"name": e["name"], "size": e.get("size", 0), "path": e["path"]} for e in entries if e.get("type") == "file"]


def dataset_commit(folder="tdp/mtc"):
    data = json.loads(_get(f"https://api.github.com/repos/{REPO}/commits?path={folder}&per_page=1&sha={BRANCH}").decode("utf-8"))
    if isinstance(data, list) and data:
        return {"sha": data[0]["sha"], "date": data[0]["commit"]["committer"]["date"]}
    return {"sha": "unknown", "date": "unknown"}


def fetch(cache=CACHE, log=print):
    """Download every log the reduction can use into the cache; PartData only for a part the Split folder lacks."""
    cache = Path(cache)
    cache.mkdir(parents=True, exist_ok=True)
    meta = {"repo": "https://github.com/" + REPO, "branch": BRANCH, "retrieved": datetime.utcnow().strftime("%Y-%m-%d"), "folders": {}}
    meta["commit"] = dataset_commit()
    split = [e for e in listing(FOLDERS[0]) if parse_name(e["name"])]
    have = {parse_name(e["name"])["part"] for e in split}
    wanted = [(FOLDERS[0], e) for e in split]
    if not all(p in have for p in PARTS):
        part_data = [e for e in listing(FOLDERS[1]) if parse_name(e["name"]) and parse_name(e["name"])["part"] not in have]
        wanted += [(FOLDERS[1], e) for e in part_data]
    n_new = 0
    for folder, e in wanted:
        sub = cache / folder.split("/")[-1]
        sub.mkdir(parents=True, exist_ok=True)
        target = sub / e["name"]
        if target.exists() and target.stat().st_size == e["size"]:
            continue
        target.write_bytes(_get(RAW % (REPO, BRANCH, e["path"]), timeout=120))
        n_new += 1
        meta["folders"].setdefault(folder.split("/")[-1], 0)
    for folder, _ in wanted:
        meta["folders"][folder.split("/")[-1]] = meta["folders"].get(folder.split("/")[-1], 0) + 1
    (cache / "meta.json").write_text(json.dumps(meta, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    log(f"fetched {n_new} new of {len(wanted)} files into {cache} (commit {meta['commit']['sha'][:12]})")
    return meta


# ---------------------------------------------------------------- the build (pure over the cache)
def build(cache=CACHE):
    cache = Path(cache)
    meta_path = cache / "meta.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}
    groups = {}
    for folder in ("Split", "PartData"):
        sub = cache / folder
        if not sub.is_dir():
            continue
        for f in sorted(sub.glob("*.txt")):
            nm = parse_name(f.name)
            if not nm:
                continue
            key = (nm["part"], nm["op"] or "all", nm["machine"], folder)
            groups.setdefault(key, []).append(f)
    # Split wins over PartData for a part
    split_parts = {k[0] for k in groups if k[3] == "Split"}
    parts = {}
    machines = {k: dict(v, ops=[]) for k, v in MACHINES.items()}
    for (part, op, machine, folder), files in sorted(groups.items()):
        if folder == "PartData" and part in split_parts:
            continue
        results = [reduce_log(f.read_text(encoding="utf-8", errors="replace")) for f in files]
        usable = [r for r in results if r["usable"]]
        reasons = {}
        for r in results:
            if not r["usable"]:
                reasons[r["reason"]] = reasons.get(r["reason"], 0) + 1
        rec = {
            "op": op,
            "machine": machine,
            "source_folder": folder,
            "files": len(files),
            "usable": len(usable),
            "unusable_reasons": reasons,
            "stale_dropped_files": sum(1 for r in usable if r.get("stale_dropped")),
            "glitch_zero_files": sum(1 for r in usable if r.get("glitch_zeros")),
            "files_with_holds": sum(1 for r in usable if r.get("holds")),
            "runtime_s": reduce_group([r["runtime_s"] for r in usable]),
            "span_check_max_slack_s": round(max((r["runtime_s"] - r["span_s"] for r in usable), default=0.0), 3),
        }
        parts.setdefault(part, {"ops": []})["ops"].append(rec)
        if machine in machines:
            machines[machine]["ops"].append(part + " " + op)
    derived = {}
    box = parts.get("Box", {}).get("ops", [])
    if box and all(o["runtime_s"] for o in box):
        derived["hurco02_box_sum_of_medians_s"] = sum(o["runtime_s"]["median"] for o in box if o["machine"] == "Hurco02")
    cover_plate = [o for p in ("Cover", "Plate") for o in parts.get(p, {}).get("ops", []) if o["machine"] == "Hurco04" and o["runtime_s"]]
    if cover_plate:
        derived["hurco04_cover_plus_plate_sum_of_medians_s"] = sum(o["runtime_s"]["median"] for o in cover_plate)
    commit = meta.get("commit", {})
    return {
        "schema": SCHEMA,
        "id": DATASET_ID,
        "title": TITLE,
        "source": {
            "repo": "https://github.com/" + REPO,
            "path": "tdp/mtc (Split; PartData only where Split lacks a part)",
            "commit": commit.get("sha", "unknown"),
            "commit_date": commit.get("date", "unknown"),
            "retrieved": meta.get("retrieved", "unknown"),
            "licence": "NIST public-service notice (see notice); acknowledgment appreciated; the NIST logo may not be used",
            "notice": NOTICE,
            "collaboration": "NIST Smart Manufacturing Systems Test Bed with the Manufacturing Technology Centre (MTC, UK) - the Box Assembly package",
        },
        "rule": RULE,
        "machines": machines,
        "untimed_context": UNTIMED_CONTEXT,
        "parts": parts,
        "derived": derived,
    }


# ---------------------------------------------------------------- renderers (pure)
def render_json(data):
    return json.dumps(data, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def render_js(data):
    return (
        "/* data/nist-box-assembly.js - GENERATED by tools/nist_box_assembly.py; do not edit.\n"
        " * The JSON twin of data/nist-box-assembly.json for the browser (no fetch, offline-safe).\n"
        " * NIST SMS Test Bed data: " + NOTICE[:120].replace("\n", " ") + "... (full notice inside). */\n"
        "window.WT = window.WT || {};\n"
        "WT.datasets = WT.datasets || {};\n"
        "WT.datasets.nistBoxAssembly = " + render_json(data).rstrip("\n") + ";\n"
    )


def _fmt(v):
    return (f"{v:g}") if isinstance(v, (int, float)) else str(v)


def render_md(data):
    out = io.StringIO()
    src = data["source"]
    out.write("# " + data["title"] + "\n\n")
    out.write("GENERATED by `tools/nist_box_assembly.py reduce` from the committed reduction; do not edit by hand.\n\n")
    out.write("**Source.** " + src["repo"] + ", folder `" + src["path"] + "`, commit `" + src["commit"] + "` (" + src["commit_date"] + "), retrieved " + src["retrieved"] + ". " + src["collaboration"] + ".\n\n")
    out.write("**Notice (verbatim).** " + src["notice"] + "\n\n")
    out.write("**Reduction rule.** " + data["rule"] + "\n\n")
    out.write("## Machines\n\n| Device id | Model (as documented by NIST) | Operations timed here |\n|---|---|---|\n")
    for k in sorted(data["machines"]):
        m = data["machines"][k]
        out.write("| " + k + " | " + m["label"] + " | " + ", ".join(m["ops"]) + " |\n")
    out.write("\n" + data["untimed_context"] + "\n\n")
    out.write("## Run times per operation (seconds)\n\n")
    out.write("| Part | Op | Machine | Folder | Files | Usable | Min | Median | Max | Mean | Stale-prefix files | 60 s glitch files | Files with holds | Span slack max (s) |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n")
    for part in sorted(data["parts"]):
        for o in data["parts"][part]["ops"]:
            r = o["runtime_s"] or {}
            cells = [part, o["op"], o["machine"], o["source_folder"], o["files"], o["usable"],
                     _fmt(r.get("min", "-")), _fmt(r.get("median", "-")), _fmt(r.get("max", "-")), _fmt(r.get("mean", "-")),
                     o["stale_dropped_files"], o["glitch_zero_files"], o["files_with_holds"], _fmt(o["span_check_max_slack_s"])]
            out.write("| " + " | ".join(str(c) for c in cells) + " |\n")
            if o["unusable_reasons"]:
                out.write("|  |  |  |  |  | unusable: " + "; ".join(f"{k} ({v})" for k, v in sorted(o["unusable_reasons"].items())) + " |  |  |  |  |  |  |  |  |\n")
    out.write("\n## Derived (what the factory profile uses)\n\n")
    for k in sorted(data["derived"]):
        out.write("- `" + k + "`: **" + _fmt(data["derived"][k]) + " s**\n")
    out.write("\n## Honest limits\n\n")
    out.write("- Only the machining programs are timed. Assembly, inspection, set-up, tool changes between programs, "
              "transport and demand are NOT in the dataset; where the app needs them they are labelled teaching values.\n")
    out.write("- The run time is the controller's program running time (feed holds excluded), not a cycle time with "
              "load / unload; the wall-clock span is reported only as a cross-check.\n")
    out.write("- A group with fewer files than the 20 instances (e.g. Box OP4) is reported as it is; nothing is filled in.\n")
    out.write("- The machine models are as documented by NIST; this is not a vendor specification or an endorsement.\n")
    return out.getvalue()


def write_outputs(data, json_path=DATA_JSON, js_path=DATA_JS, md_path=DOC_MD):
    for p, text in ((json_path, render_json(data)), (js_path, render_js(data)), (md_path, render_md(data))):
        Path(p).parent.mkdir(parents=True, exist_ok=True)
        Path(p).write_text(text, encoding="utf-8", newline="\n")


def load_committed(json_path=DATA_JSON):
    return json.loads(Path(json_path).read_text(encoding="utf-8"))


def offline_check(json_path=DATA_JSON, js_path=DATA_JS, md_path=DOC_MD, log=print):
    """The committed JS twin and Markdown are the renders of the committed JSON, and the JSON is sane. -> 0 | 1."""
    problems = []
    try:
        data = load_committed(json_path)
    except (OSError, ValueError) as e:
        log(f"offline-check: cannot read {json_path}: {e}")
        return 1
    if Path(json_path).read_text(encoding="utf-8").replace("\r\n", "\n") != render_json(data):
        problems.append("JSON is not in canonical form (sort_keys, 2-space indent)")
    if Path(js_path).read_text(encoding="utf-8").replace("\r\n", "\n") != render_js(data):
        problems.append("JS twin differs from the JSON")
    if Path(md_path).read_text(encoding="utf-8").replace("\r\n", "\n") != render_md(data):
        problems.append("Markdown differs from the render")
    problems += schema_problems(data)
    for p in problems:
        log("offline-check: " + p)
    log("offline-check: " + ("OK" if not problems else f"{len(problems)} problem(s)"))
    return 0 if not problems else 1


def schema_problems(data):
    """Plain sanity: schema id, every op's numbers finite and ordered, usable <= files, machines known, notice kept."""
    out = []
    if data.get("schema") != SCHEMA or data.get("id") != DATASET_ID:
        out.append("schema / id")
    if NOTICE not in data.get("source", {}).get("notice", ""):
        out.append("the NIST notice is not kept verbatim")
    if data.get("rule") != RULE:
        out.append("the rule text differs from the tool's")
    for part, rec in data.get("parts", {}).items():
        for o in rec.get("ops", []):
            if o["usable"] > o["files"] or o["usable"] < 0:
                out.append("{} {}: usable > files".format(part, o["op"]))
            if o["machine"] not in data.get("machines", {}):
                out.append("{} {}: unknown machine {}".format(part, o["op"], o["machine"]))
            r = o.get("runtime_s")
            if o["usable"] and not r:
                out.append("{} {}: usable files but no statistics".format(part, o["op"]))
            if r and not (r["min"] <= r["median"] <= r["max"] and r["min"] <= r["mean"] <= r["max"] and r["min"] > 0):
                out.append("{} {}: statistics not ordered / positive".format(part, o["op"]))
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("command", nargs="?", choices=("fetch", "reduce"), help="fetch the logs into the cache; reduce the cache into the committed files")
    ap.add_argument("--cache", default=str(CACHE))
    ap.add_argument("--check", action="store_true", help="fetch + reduce into a temp dir and compare with the committed files (network)")
    ap.add_argument("--offline-check", action="store_true", help="the committed JS twin and Markdown agree with the JSON (no network)")
    a = ap.parse_args(argv)
    if a.offline_check:
        return offline_check()
    if a.check:
        with tempfile.TemporaryDirectory() as td:
            cache = Path(a.cache)
            if not (cache / "meta.json").exists():
                fetch(cache)
            data = build(cache)
            tmp_json, tmp_js, tmp_md = Path(td) / "d.json", Path(td) / "d.js", Path(td) / "d.md"
            write_outputs(data, tmp_json, tmp_js, tmp_md)
            same = all(Path(p).read_text(encoding="utf-8").replace("\r\n", "\n") == Path(q).read_text(encoding="utf-8")
                       for p, q in ((DATA_JSON, tmp_json), (DATA_JS, tmp_js), (DOC_MD, tmp_md)))
            print("check: " + ("the committed files are what the cache reduces to" if same else "STALE - run reduce"))
            return 0 if same else 1
    if a.command == "fetch":
        fetch(Path(a.cache))
        return 0
    if a.command == "reduce":
        data = build(Path(a.cache))
        if not data["parts"]:
            print("reduce: the cache is empty - run fetch first", file=sys.stderr)
            return 1
        write_outputs(data)
        print(f"wrote {DATA_JSON.relative_to(ROOT)}, {DATA_JS.relative_to(ROOT)}, {DOC_MD.relative_to(ROOT)}")
        for part in sorted(data["parts"]):
            for o in data["parts"][part]["ops"]:
                r = o["runtime_s"] or {}
                print(f"  {part:<6} {o['op']:<4} {o['machine']}  files {o['files']:2d} usable {o['usable']:2d}  median {_fmt(r.get('median', '-'))} s")
        for k, v in sorted(data["derived"].items()):
            print(f"  derived {k} = {_fmt(v)} s")
        return 0
    ap.print_help()
    return 2


if __name__ == "__main__":
    sys.exit(main())
