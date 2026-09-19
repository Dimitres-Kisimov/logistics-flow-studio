"""Offline review artifacts for an internally generated resource plan."""
import csv
import html
import json
from pathlib import Path


def safe_cell(value):
    text = str(value) if value is not None else ""
    # Keep user IDs inert when a CSV is opened in a spreadsheet application.
    return "'" + text if text.lstrip().startswith(("=", "+", "-", "@")) or text.startswith(("\t", "\r", "\n")) else text


def csv_table(path, fields, rows):
    with path.open("w", encoding="utf-8", newline="") as file:
        writer = csv.writer(file)
        writer.writerow(fields)
        for row in rows:
            writer.writerow([safe_cell(row.get(field)) for field in fields])


def write_report(plan, directory):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "plan.json").write_text(json.dumps(plan, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    fields = ["id", "resource_id", "source", "destination", "release_s", "duration_s", "assignment_start_s",
              "task_start_s", "end_s", "queue_wait_s", "reposition_s", "state_at_horizon"]
    csv_table(directory / "assignments.csv", fields, plan["jobs"])
    rejections = [dict(job_id=job["id"], resource_id=r["resource_id"], reason=r["reason"],
                       details=json.dumps(r, sort_keys=True)) for job in plan["jobs"] for r in job["rejected_resources"]]
    csv_table(directory / "rejections.csv", ["job_id", "resource_id", "reason", "details"], rejections)
    claims = [dict(area_id=area["id"], capacity=area["capacity"], **r) for area in plan["areas"] for r in area["reservations"]]
    csv_table(directory / "area-claims.csv", ["area_id", "capacity", "job_id", "resource_id", "start_s", "end_s"], claims)
    def esc(value):
        return html.escape(str(value))
    horizon = plan["horizon_s"]

    def bar(start, end, color):
        left, right = min(horizon, max(0, start)), min(horizon, max(0, end))
        return f'<rect x="{left / horizon * 1000:.6f}" y="2" width="{max(0, right-left) / horizon * 1000:.6f}" height="20" fill="{color}"/>'

    rows = []
    for job in plan["jobs"]:
        allocated = job["resource_id"] is not None
        graphic = ""
        if allocated:
            graphic = bar(job["release_s"], job["assignment_start_s"], "#b59047") + bar(job["assignment_start_s"], job["task_start_s"], "#638abd") + bar(job["task_start_s"], job["end_s"], "#55bca4")
            times = f'Assignment {job["assignment_start_s"]:g} s · work {job["task_start_s"]:g}–{job["end_s"]:g} s · wait {job["queue_wait_s"]:g} s'
        else:
            times = "No assignment; no start or completion inferred."
        reasons = [f'{r["resource_id"]}: {r["reason"].replace("-", " ")}' + (" (" + ", ".join(r["skills"]) + ")" if r.get("skills") else "") for r in job["rejected_resources"]]
        waits = [f'{c["area"]}: held by {", ".join(c["holders"])} until {c["release_s"]:g} s' for w in job.get("area_waits", []) for c in w["conflicts"]]
        rows.append(f'<article><div class="jobhead"><h2>{esc(job["id"])}</h2><span class="status">{esc(job["state_at_horizon"])}</span></div><p>{esc(job["resource_id"] or "Unassigned")} · {esc(job["source"])} → {esc(job["destination"])}</p><svg viewBox="0 0 1000 24" preserveAspectRatio="none" role="img" aria-label="{esc(times)}"><rect width="1000" height="24" fill="#17201d"/>{graphic}</svg><p>{esc(times)}</p><p class="reason">{esc("; ".join(waits + reasons) or "No candidate rejection or area wait recorded.")}</p></article>')
    document = f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Resource assignment review</title><style>
:root{{font:16px/1.55 system-ui,sans-serif;color:#e9ede9;background:#171c19}}*{{box-sizing:border-box}}body{{margin:0}}main{{max-width:980px;margin:auto;padding:36px 22px}}h1{{font-size:clamp(28px,5vw,44px);line-height:1.15}}.eyebrow{{letter-spacing:.12em;text-transform:uppercase;color:#9eb3a5;font-size:12px}}.summary{{display:flex;gap:12px;flex-wrap:wrap}}.metric,article{{background:#232d27;border:1px solid #405548;border-radius:10px;padding:18px}}.metric{{flex:1;min-width:160px}}.metric strong{{display:block;font-size:30px}}.jobhead{{display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap}}h2{{font-size:20px;margin:0;overflow-wrap:anywhere}}.status{{font-size:12px;border:1px solid #8a9e90;padding:4px 8px;border-radius:20px}}article{{margin:16px 0}}p{{overflow-wrap:anywhere}}svg{{display:block;width:100%;height:28px}}.reason,.note{{color:#d7c797}}a{{color:#a4dec9}}.legend{{font-size:14px}}a:focus-visible{{outline:3px solid #a4dec9}}footer{{font-size:13px;color:#adbbae;margin-top:30px}}
</style></head><body><main><p class="eyebrow">Operations / Resource plan</p><h1>Review who works, when, and why work waits.</h1><p class="note">Assumed planning data. This greedy schedule is not an optimal roster, live tracking or safety approval.</p><div class="summary"><div class="metric">Completed at horizon<strong>{plan["completed"]}</strong></div><div class="metric">Released unfinished<strong>{plan["unfinished"]}</strong></div><div class="metric">Simulation horizon<strong>{horizon:g} s</strong></div></div><p class="legend">Bars share the 0–{horizon:g} s scale: <span style="color:#d5b26d">queue wait</span> · <span style="color:#8cafe1">repositioning</span> · <span style="color:#76d7bd">work</span>. Bars stop at the horizon; text retains planned future times. Unassigned rows have no bar.</p><p><a href="assignments.csv">Assignments CSV</a> · <a href="rejections.csv">Rejections CSV</a> · <a href="area-claims.csv">Area claims CSV</a> · <a href="plan.json">Full JSON</a></p>{"".join(rows)}<footer>{esc(plan["policy"])}<br>{esc(plan["limitations"])}</footer></main></body></html>'''
    (directory / "index.html").write_text(document, encoding="utf-8")
