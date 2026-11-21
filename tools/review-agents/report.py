"""Validate a staff review and render its human-readable report from the same data."""
import argparse
import html
import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path
from urllib.parse import quote

try:
    from jsonschema import Draft202012Validator, FormatChecker
except ImportError:
    raise SystemExit("Install the review validator in your Python environment: python3 -m pip install jsonschema")

HERE = Path(__file__).resolve().parent
ROLE_SPECS = {
    "head-coach": ("head_coach", "HC", "H", 6),
    "coordinator": ("coordinator", "OC", "C", 7),
    "position-coach": ("position_coach", "PC", "P", 7),
}
SCHEMA = json.loads((HERE / "report.schema.json").read_text(encoding="utf-8"))
VALIDATOR = Draft202012Validator(SCHEMA, format_checker=FormatChecker())
DISCLAIMER = SCHEMA["properties"]["disclaimer"]["const"]


def require(condition, message):
    if not condition:
        raise ValueError(message)


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def child(directory, relative):
    path = Path(relative)
    require(not path.is_absolute() and ".." not in path.parts, f"Expected a relative evidence path: {relative}")
    target = (directory / path).resolve()
    require(target.is_relative_to(directory.resolve()), f"Evidence escapes {directory}: {relative}")
    return target


def check_evidence(reference, root, round_dir, slug, *, source_lines=True, run_id=None):
    if reference.startswith("ui: "):
        relative = reference.removeprefix("ui: ")
        allowed = Path("evidence", slug)
        if run_id:
            allowed /= run_id
        require(Path(relative).is_relative_to(allowed), f"Screenshot belongs to another role or run: {relative}")
        path = child(round_dir, relative)
        with path.open("rb") as screenshot:
            require(screenshot.read(8) == b"\x89PNG\r\n\x1a\n", f"Invalid PNG screenshot: {path}")
    else:
        match = re.fullmatch(r"source: (.+):([1-9]\d*)", reference)
        require(match is not None, f"Invalid evidence reference: {reference}")
        path = child(root, match[1])
        if source_lines:
            with path.open(encoding="utf-8") as source:
                require(any(n == int(match[2]) for n, _ in enumerate(source, 1)), f"Source line missing: {reference}")


def validate(data, root, round_dir, slug, *, source_lines=True, run_id=None):
    for error in VALIDATOR.iter_errors(data):
        raise ValueError(f"{error.json_path}: {error.message}")
    instant = datetime.fromisoformat(data["generated_at"].replace("Z", "+00:00"))
    require(instant.tzinfo is not None and "T" in data["generated_at"], "Use an ISO-8601 timestamp with timezone")
    role, prefix, task_prefix, count = ROLE_SPECS[slug]
    require(data["role"] == role and data["round"] == round_dir.name, "Report role or round differs from its destination")
    expected = [f"G{i}" for i in range(1, 6)] + [f"{task_prefix}{i}" for i in range(1, count + 1)]
    require([t["id"] for t in data["tasks"]] == expected, f"Task IDs or order differ from {expected}")
    require([a["q"] for a in data["interview"]] == list(range(1, 11)), "Interview must answer questions 1 through 10 in order")
    findings = data["findings"]
    ids = [f["id"] for f in findings]
    require(len(ids) == len(set(ids)), "Duplicate finding ID")
    require(all(re.fullmatch(rf"{prefix}-(?:0[1-9]|[1-9]\d+)", i) for i in ids), f"Invalid {prefix} finding ID")
    require(sorted(f["rank"] for f in findings) == list(range(1, len(findings) + 1)), "Ranks must be unique and contiguous from 1")
    for row in [*data["tasks"], *findings]:
        reference = row["evidence"]
        basis = "live_ui" if reference.startswith("ui: ") else "source_review"
        require(data["method"][basis], f"{row['id']} cites evidence from an undeclared method")
        check_evidence(reference, root, round_dir, slug, source_lines=source_lines, run_id=run_id)
    if not data["method"]["live_ui"]:
        require(all(t["steps"] == 0 and t["completion"] == "abandoned" for t in data["tasks"]),
                "A source-only walkthrough must record unobserved UI tasks as abandoned with zero steps")
    elif not any(row["evidence"].startswith("ui: ") for row in [*data["tasks"], *findings]):
        raise ValueError("A live walkthrough needs screenshot evidence for at least one task or finding")


def section(text, heading):
    match = re.search(rf"^## {re.escape(heading)}\s*\n(.*?)(?=^## |\Z)", text, re.M | re.S)
    require(match is not None, f"Missing section {heading}")
    return match[1].strip()


def cell(text):
    return html.escape(str(text), quote=False).replace("|", r"\|").replace("\n", "<br>")


def evidence_link(reference, round_dir, root):
    if reference.startswith("ui: "):
        path = reference.removeprefix("ui: ")
        return "[UI screenshot](" + quote(path, safe="/") + ")"
    path, line = reference.removeprefix("source: ").rsplit(":", 1)
    link = quote(os.path.relpath(root / path, round_dir), safe="/") + "#L" + line
    return f"[Source · {cell(path)} line {line}]({link})"


def markdown(data, root, round_dir, slug, revision, checks):
    role_doc = (HERE / "agents" / f"{slug}.md").read_text(encoding="utf-8")
    title = role_doc.splitlines()[0].removeprefix("# ").strip()
    persona = section(role_doc, "Persona")
    interview = section((HERE / "PROTOCOL.md").read_text(encoding="utf-8"), "Phase 3 · Interview")
    questions = re.findall(r"^\d+\. (.+)$", interview, re.M)
    require(len(questions) == 10, "The protocol must contain ten interview questions")
    method = data["method"]
    lines = [
        DISCLAIMER, "", f"# {title} · {data['round']}", "",
        f"Generated {data['generated_at']} on {revision}.",
        f"Live UI {'yes' if method['live_ui'] else 'no'} · Source review {'yes' if method['source_review'] else 'no'} · "
        + " · ".join(f"{name} {'passed' if status == 0 else f'failed (exit {status})'}" for name, status in checks.items()),
        "", "## Persona", "", persona, "", "## Expectations", "",
    ]
    for prompt, answer in zip(("What does it do?", "Who is it for?", "What happens in ten minutes?"), data["expectations"]):
        lines.extend([f"**{prompt}** {answer}", ""])
    lines.extend(["## Task table", "", "| Task | Attempt | Outcome | Completion | Steps | Simulated think-aloud | Evidence |",
                  "| --- | --- | --- | --- | ---: | --- | --- |"])
    for task in data["tasks"]:
        values = [task['id'] + " · " + task['title'], task['attempted'], task['observed'], task['completion'], task['steps'], task['note']]
        lines.append("| " + " | ".join([*(cell(v) for v in values), evidence_link(task['evidence'], round_dir, root)]) + " |")
    lines.extend(["", "## Interview answers", ""])
    for question, answer in zip(questions, data["interview"]):
        lines.extend([f"**{answer['q']}. {question}**", "", answer["answer"], ""])
    lines.extend(["## Ranked findings", ""])
    if not data["findings"]:
        lines.extend(["No product findings were established in this session.", ""])
    for finding in sorted(data["findings"], key=lambda f: f["rank"]):
        lines.extend([f"### {finding['rank']}. {finding['title']} ({finding['id']})", "",
                      "| Field | Review |", "| --- | --- |",
                      f"| Location | {cell(finding['route'])} · {cell(finding['element'])} |",
                      f"| Severity | {finding['severity']} |"])
        for label, key in [("Observed", "observed"), ("Expected", "expected"), ("Proposed change", "proposed_change"), ("Simulated quote", "quote")]:
            lines.append(f"| {label} | {cell(finding[key])} |")
        lines.extend([f"| Evidence | {evidence_link(finding['evidence'], round_dir, root)} |", ""])
    verdict = data["verdict"]
    lines.extend(["## Keep list", "", *(["- " + item for item in data["keep"]] or ["No keep items were established in this session."]), "", "## Verdict", "",
                  f"**Would use** {verdict['would_use']}", "", f"**Would recommend** {verdict['would_recommend']}",
                  "", verdict['condition'], ""])
    return "\n".join(lines)


def comparison_markdown(comparison, baseline, current, root, round_dir, slug, run_id):
    require(isinstance(comparison, dict) and set(comparison) == {"prior", "new"}, "Comparison needs prior and new arrays")
    prior, new = comparison["prior"], comparison["new"]
    require(isinstance(prior, list) and isinstance(new, list), "Comparison prior and new must be arrays")
    old = {f["id"] for f in baseline["findings"]}
    active = {f["id"] for f in current["findings"]}
    require(all(isinstance(r, dict) and set(r) == {"id", "status", "reason", "evidence"} for r in prior), "Invalid prior comparison row")
    require(len(prior) == len(old) and {r["id"] for r in prior} == old, "Every baseline ID needs exactly one disposition")
    require(len(new) == len(set(new)) and set(new) == active - old, "New IDs must match all new active findings")
    previous_max = max((int(i.split("-")[1]) for i in old), default=0)
    require(all(int(i.split("-")[1]) > previous_max for i in new), "New IDs must follow the prior ID range")
    lines = [DISCLAIMER, "", f"# {slug} · round-2 comparison", "", "| Previous ID | Status | Retest and result | Current evidence |",
             "| --- | --- | --- | --- |"]
    for row in prior:
        status, fid = row["status"], row["id"]
        require(status in {"resolved", "improved", "unchanged", "regressed"}, f"Invalid disposition for {fid}")
        require((status == "resolved") == (fid not in active), f"Active finding list disagrees with disposition for {fid}")
        require(isinstance(row["reason"], str) and row["reason"].strip(), f"Missing retest reason for {fid}")
        require(isinstance(row["evidence"], str), f"Missing retest evidence for {fid}")
        check_evidence(row["evidence"], root, round_dir, slug, run_id=run_id)
        lines.append(f"| {fid} | {status} | {cell(row['reason'])} | {evidence_link(row['evidence'], round_dir, root)} |")
    lines.extend(["", "## New findings", ""])
    lines.extend([f"- {f['id']} · {f['title']}" for f in current["findings"] if f["id"] in new] or ["None."])
    return "\n".join(lines) + "\n"


def summary(data):
    print(f"\n{data['role']} · {data['round']}")
    for f in sorted(data["findings"], key=lambda f: f["rank"])[:5]:
        print(f"  {f['rank']}. {f['id']} [{f['severity']}] {f['title']}")
    v = data["verdict"]
    print(f"  Use {v['would_use']} · Recommend {v['would_recommend']} · {v['condition']}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("report", type=Path)
    args = parser.parse_args()
    try:
        path = args.report.resolve()
        require(path.stem in ROLE_SPECS, "Use a canonical role filename")
        data = read_json(path)
        validate(data, HERE.parent.parent, path.parent, path.stem)
        summary(data)
    except (ValueError, OSError) as exc:
        sys.exit(str(exc))
