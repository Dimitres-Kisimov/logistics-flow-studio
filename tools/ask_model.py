"""tools/ask_model.py - the optional model mode (v3.61): a language model rewrites the deterministic answer, beside the app.

THE RUNTIME DECISION. The app is a fully offline PWA behind a strict Content-Security-Policy
(connect-src 'self'; the offline guard refuses any fetch to another host), so a model never runs
inside the page: neither an API (a key and a network call) nor an in-browser model (hundreds of
megabytes pulled from a CDN) keeps that promise. The model mode therefore runs BESIDE the app, as
this tool, over any OpenAI-compatible chat endpoint - a local server (Ollama, llama.cpp: the answer
never leaves the machine) or a hosted API (the user's choice; the tool prints a network banner
whenever the endpoint is not localhost). Off by default: without --endpoint the tool prints the
deterministic answer and the prompt it would send, and nothing is called.

    python tools/ask_model.py "<question>" --export run-ledger.json                         (dry run: deterministic + prompt)
    python tools/ask_model.py "<question>" --export run-ledger.json --endpoint http://localhost:11434/v1 --model llama3.1
    python tools/ask_model.py "<question>" --export run-ledger.json --endpoint https://api.example.com/v1 --model m --api-key-env WT_MODEL_KEY

THE TWO RULES (stated once; test/test_ask_model.py pins them):
  1. The model never produces a number the deterministic layer did not. The evidence pack is the
     deterministic answer of v3.60 (tools/ask_cli.mjs: text, the view rows it read, the sources) - and,
     for a question outside the catalogue, every catalogue answer, so the model can answer from the same
     views. Every number in the model's prose must appear in the evidence (as written, or rounded no
     finer than the evidence gives, or as the percent form of a share); a prose that carries any other
     number is REFUSED and the deterministic answer is printed instead, with the offending numbers named.
  2. Every model answer carries its evidence block: the output JSON always holds the deterministic
     answer (text, read, sources) beside the prose, and the printed answer ends with the evidence lines.

Honesty: the prose is a rewording, not a new analysis; the model sees only aggregates the ledger
already computed and is told never to name a person. A refused prose is not an error of this tool -
it is the rule working. Standard library only (urllib); no key is ever stored or printed.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
HONESTY = ("The model mode runs beside the app, never inside it: a language model rewrites the deterministic answer of ask.js into prose over an "
           "OpenAI-compatible endpoint the user names (a local server keeps the answer on the machine; a hosted API is the user's choice and is "
           "flagged as a network call). It may use only the numbers in the evidence - a prose with any other number is refused and the "
           "deterministic answer stands - and every answer carries its evidence block. Off by default; nothing is called without --endpoint.")
SYSTEM_PROMPT = (
    "You rewrite the deterministic answer of a warehouse and factory simulation's run ledger into clear prose for a planner.\n"
    "Rules you must follow:\n"
    "1. Use only the numbers that appear in EVIDENCE, exactly as written or rounded no finer than given; never introduce a number of your own, "
    "not a count, not a date, not a percentage that is not in EVIDENCE. If you need a number that is not there, say that it is not in the ledger.\n"
    "2. If the question cannot be answered from EVIDENCE, say so in one sentence and name the closest catalogue question.\n"
    "3. Name the view or views the evidence came from (the `read` entries) and the source of any threshold (the `sources` entries).\n"
    "4. Never name, guess or imply a person; the ledger records steps, stations and units.\n"
    "5. Answer in the language of the question (English or German), in at most six sentences."
)
LOCAL_HOSTS = ("localhost", "127.0.0.1", "::1", "[::1]")
_NUM = re.compile(r"(?<![\w.])-?\d+(?:[.,]\d+)?(?![\w])")


def deterministic(question: str, export: Path, everything: bool = False) -> dict:
    """The v3.60 answer through tools/ask_cli.mjs (the same modules the app loads)."""
    cmd = ["node", str(ROOT / "tools" / "ask_cli.mjs")] + (["--all"] if everything else [question]) + ["--export", str(export)]
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", cwd=str(ROOT))
    if r.returncode != 0:
        raise RuntimeError("the deterministic layer failed: " + (r.stderr or r.stdout).strip())
    return json.loads(r.stdout)


def evidence_pack(question: str, export: Path) -> dict:
    """The deterministic answer; for a question outside the catalogue, every catalogue answer as well."""
    ans = deterministic(question, export)
    pack = {"question": question, "answer": {"id": ans["id"], "text": ans["text"], "read": ans.get("read", []), "sources": ans.get("sources", []), "unanswered": bool(ans.get("unanswered"))}}
    if ans.get("unanswered"):
        pack["catalogue_answers"] = {k: {"text": v["text"], "read": v.get("read", []), "sources": v.get("sources", [])} for k, v in deterministic(question, export, True).items() if k != "help"}
    return pack


def _norm(s: str) -> str:
    s = s.replace(",", ".")
    if "." in s:
        s = s.rstrip("0").rstrip(".")
    if s in ("-0", ""):
        s = "0"
    return s


def _variants(v) -> set:
    out = set()
    if isinstance(v, bool) or v is None:
        return out
    if isinstance(v, (int, float)):
        for digits in (0, 1, 2, 3, 4):
            out.add(_norm(f"{v:.{digits}f}"))
        out.add(_norm(repr(v) if isinstance(v, float) else str(v)))
        if 0 <= v <= 1:
            for digits in (0, 1, 2):
                out.add(_norm(f"{v * 100:.{digits}f}"))
        if isinstance(v, (int, float)) and v < 0:
            out |= {x.lstrip("-") for x in list(out)}  # "30 minutes early" for -30
    elif isinstance(v, str):
        for m in _NUM.findall(v):
            out.add(_norm(m))
            out.add(_norm(m).lstrip("-"))
    return out


def evidence_numbers(evidence) -> set:
    """Every number the evidence carries, in the forms the prose may use."""
    found: set = set()

    def walk(o):
        if isinstance(o, dict):
            for x in o.values():
                walk(x)
        elif isinstance(o, list):
            for x in o:
                walk(x)
        else:
            found.update(_variants(o))

    walk(evidence)
    return found


def prose_numbers(text: str) -> list[str]:
    return [_norm(m) for m in _NUM.findall(text or "")]


def guard(prose: str, evidence) -> dict:
    """{ok, offending}: every number in the prose must be in the evidence."""
    allowed = evidence_numbers(evidence)
    offending = sorted({n for n in prose_numbers(prose) if n not in allowed})
    return {"ok": not offending, "offending": offending}


def is_network(endpoint: str) -> bool:
    host = (urlparse(endpoint).hostname or "").lower()
    return host not in LOCAL_HOSTS


def build_messages(pack: dict) -> list[dict]:
    return [{"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": "QUESTION: " + pack["question"] + "\n\nEVIDENCE (JSON, the only numbers you may use):\n" + json.dumps(pack, ensure_ascii=False, indent=1)}]


def call_model(endpoint: str, model: str, messages: list[dict], api_key: str | None, timeout: float = 120.0) -> str:
    """One chat completion over an OpenAI-compatible endpoint; returns the assistant text."""
    url = endpoint.rstrip("/") + "/chat/completions"
    body = json.dumps({"model": model, "messages": messages, "temperature": 0}).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"}, method="POST")
    if api_key:
        req.add_header("Authorization", "Bearer " + api_key)
    with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 - the user named the endpoint
        data = json.loads(resp.read().decode("utf-8"))
    try:
        return str(data["choices"][0]["message"]["content"])
    except (KeyError, IndexError, TypeError) as e:
        raise RuntimeError("the endpoint's reply is not an OpenAI-style chat completion: " + json.dumps(data)[:200]) from e


def ask(question: str, export: Path, endpoint: str | None, model: str, api_key: str | None) -> dict:
    pack = evidence_pack(question, export)
    messages = build_messages(pack)
    out = {"question": question, "mode": "deterministic", "deterministic": pack["answer"], "evidence": pack, "prompt_chars": sum(len(m["content"]) for m in messages), "model": None, "honesty": HONESTY}
    if not endpoint:
        out["dry_run"] = True
        return out
    network = is_network(endpoint)
    prose = call_model(endpoint, model, messages, api_key)
    g = guard(prose, pack)
    out["model"] = {"endpoint_host": urlparse(endpoint).hostname, "model": model, "network": network, "prose": prose, "refused": not g["ok"], "offending": g["offending"]}
    out["mode"] = "model" if g["ok"] else "deterministic"
    return out


def render(out: dict) -> str:
    lines = []
    m = out.get("model")
    if m and m.get("network"):
        lines.append("NETWORK: this answer was produced by " + str(m["endpoint_host"]) + " - the evidence pack left this machine.")
    if m and m.get("refused"):
        lines.append("REFUSED the model's prose: it carried numbers that are not in the evidence (" + ", ".join(m["offending"]) + "). The deterministic answer stands:")
    lines.append(m["prose"].strip() if m and not m.get("refused") else out["deterministic"]["text"])
    if out.get("dry_run"):
        lines.append("(dry run: no endpoint given, nothing was called; the prompt would carry " + str(out["prompt_chars"]) + " characters)")
    for r in out["deterministic"].get("read", []):
        lines.append("Evidence: read " + str(r["view"]) + " (" + str(len(r["rows"])) + " rows)")
    for s in out["deterministic"].get("sources", []):
        lines.append("Source: " + str(s["id"]) + " = " + str(s.get("value")) + " - " + str(s.get("source")))
    return "\n".join(lines)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("question")
    ap.add_argument("--export", required=True, help="a factory-run-ledger/v1 export (the app's Export run ledger, or a fixture)")
    ap.add_argument("--endpoint", help="an OpenAI-compatible base URL, e.g. http://localhost:11434/v1 (Ollama); without it: a dry run")
    ap.add_argument("--model", default="llama3.1", help="the model name the endpoint expects (default llama3.1)")
    ap.add_argument("--api-key-env", default="WT_MODEL_KEY", help="the environment variable holding the key, if the endpoint needs one (default WT_MODEL_KEY)")
    ap.add_argument("--out", help="write the full answer JSON (prose + evidence) here")
    a = ap.parse_args(argv)
    try:
        out = ask(a.question, Path(a.export), a.endpoint, a.model, os.environ.get(a.api_key_env) if a.endpoint else None)
    except (RuntimeError, urllib.error.URLError, OSError, json.JSONDecodeError) as e:
        print("failed: " + str(e))
        return 1
    if a.out:
        Path(a.out).write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n")
    print(render(out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
