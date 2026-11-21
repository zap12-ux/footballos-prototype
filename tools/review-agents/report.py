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
INITIAL_VALIDATOR = Draft202012Validator(
    json.loads((HERE / "schemas/initial.schema.json").read_text(encoding="utf-8")),
    format_checker=FormatChecker(),
)
STAGES = {
    "head-coach": ("decisions_owed", "awaiting_approval", "parent_access"),
    "coordinator": ("self_scout", "opponent_breakdown", "draft_plan", "monday_install", "approval"),
    "position-coach": ("queue", "labels", "corrections", "handoff"),
}
LEVEL = {"low": 1, "medium": 2, "high": 3}

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


def phase_zero(slug, set_at):
    _, _, prefix, count = ROLE_SPECS[slug]
    return {
        "set_at": set_at,
        "role_task_ids": [f"{prefix}{i}" for i in range(1, count + 1)] + ["W1"],
        "unaided_percent_min": 80, "data_loss_max": 0,
        "evidence_interactions_max": 2, "would_use_target": "yes",
    }


def cost(finding):
    return LEVEL[finding["urgency"]] * LEVEL[finding["value"]]


def priority_key(finding):
    return -cost(finding), -LEVEL[finding["urgency"]], int(finding["id"].split("-")[1])


def evidence_rows(data):
    rows = [*data["tasks"], *data["findings"]]
    if "phase_0" in data:
        rows.extend(data["tasks"][-1]["stages"])
        rows.extend(data["input_checks"])
        rows.extend(data["ai_evidence"]["checks"])
    return rows


def scorecard(data, plan):
    unaided = sum(t["completion"] == "unaided" for t in data["tasks"] if t["id"] in plan["role_task_ids"])
    total = len(plan["role_task_ids"])
    losses = [f["id"] for f in sorted(data["findings"], key=priority_key) if f["data_loss"]]
    exercised = any(c["result"] != "unverified" for c in data["input_checks"])
    inventory = data["ai_evidence"]
    outputs = sum(c["count"] for c in inventory["checks"])
    reached = sum(c["count"] for c in inventory["checks"]
                  if c["result"] == "reached" and len(c["actions"]) <= plan["evidence_interactions_max"])
    answer = data["verdict"]["would_use"]
    live = data["method"]["live_ui"]
    result = {
        "role_tasks": {"met": unaided * 100 >= total * plan["unaided_percent_min"], "unaided": unaided, "total": total},
        "data_loss": {"met": live and exercised and len(losses) <= plan["data_loss_max"], "finding_ids": losses},
        "ai_evidence": {"met": live and inventory["complete"] and outputs > 0 and reached == outputs,
                        "within_budget": reached, "total": outputs},
        "would_use": {"met": answer == plan["would_use_target"], "answer": answer},
    }
    result["overall_met"] = all(row["met"] for row in result.values())
    return result


def assemble_report(observations, plan):
    """Derive comparable results from raw session observations and the pre-session plan."""
    data = dict(observations)
    require(data.get("phase_0", plan) == plan, "Phase 0 changed after the goals were fixed")
    data["phase_0"] = plan
    data["findings"] = [dict(f, cost_of_delay=cost(f), rank=i)
                        for i, f in enumerate(sorted(data["findings"], key=priority_key), 1)]
    data["success_criteria"] = scorecard(data, plan)
    fields = SCHEMA["properties"]
    extra = data.keys() - fields.keys()
    require(not extra, f"Unknown report fields: {sorted(extra)}")
    return {key: data[key] for key in fields}


def validate_practices(data, slug, instant):
    plan = data["phase_0"]
    require(plan == phase_zero(slug, plan["set_at"]), "Unexpected Phase 0 scope or targets")
    set_at = datetime.fromisoformat(plan["set_at"].replace("Z", "+00:00"))
    require(set_at.tzinfo is not None and set_at <= instant, "Phase 0 must precede the report")
    require(data["success_criteria"] == scorecard(data, plan), "Success criteria disagree with the session record")
    ordered = sorted(data["findings"], key=priority_key)
    for i, f in enumerate(ordered, 1):
        require(f["rank"] == i and f["cost_of_delay"] == cost(f), f"Cost-of-delay rank or score mismatch for {f['id']}")
    w1 = data["tasks"][-1]
    require([s["id"] for s in w1["stages"]] == list(STAGES[slug]), f"W1 stage order must be {STAGES[slug]}")
    require(sum(s["steps"] for s in w1["stages"]) == w1["steps"], "W1 stage steps must add up to the task total")
    task_ids = {t["id"] for t in data["tasks"]}
    traced_losses = set()
    for c in data["input_checks"]:
        require(c["task_id"] in task_ids, "Input probe refers to an unknown task")
        if c["result"] == "lost":
            require(c["finding_id"] and c["evidence"].startswith("ui: "), "Silent loss needs a finding ID and live evidence")
            traced_losses.add(c["finding_id"])
        else:
            require(c["finding_id"] is None, "Only a lost input can reference a data-loss finding")
        if c["result"] != "unverified":
            require(c["evidence"].startswith("ui: "), "Observed input outcomes need live evidence")
    require(traced_losses == {f["id"] for f in ordered if f["data_loss"]}, "Input probes and data-loss findings disagree")
    for c in data["ai_evidence"]["checks"]:
        require(c["task_id"] in task_ids, "AI evidence check refers to an unknown task")
        if c["result"] != "unverified":
            require(c["evidence"].startswith("ui: "), "Measured AI evidence access needs live evidence")


def validate(data, root, round_dir, slug, *, source_lines=True, run_id=None):
    initial = round_dir.name == "round-1-initial"
    validator = INITIAL_VALIDATOR if initial else VALIDATOR
    for error in validator.iter_errors(data):
        raise ValueError(f"{error.json_path}: {error.message}")
    instant = datetime.fromisoformat(data["generated_at"].replace("Z", "+00:00"))
    require(instant.tzinfo is not None and "T" in data["generated_at"], "Use an ISO-8601 timestamp with timezone")
    role, prefix, task_prefix, count = ROLE_SPECS[slug]
    expected_round = "round-1" if initial else round_dir.name
    require(data["role"] == role and data["round"] == expected_round, "Report role or round differs from its destination")
    expected = [f"G{i}" for i in range(1, 6)] + [f"{task_prefix}{i}" for i in range(1, count + 1)]
    if not initial:
        expected.append("W1")
    require([t["id"] for t in data["tasks"]] == expected, f"Task IDs or order differ from {expected}")
    question_count = 10 if initial else 13
    require([a["q"] for a in data["interview"]] == list(range(1, question_count + 1)), "Interview items are missing or out of order")
    findings = data["findings"]
    ids = [f["id"] for f in findings]
    require(len(ids) == len(set(ids)), "Duplicate finding ID")
    require(all(re.fullmatch(rf"{prefix}-(?:0[1-9]|[1-9]\d+)", i) for i in ids), f"Invalid {prefix} finding ID")
    require(sorted(f["rank"] for f in findings) == list(range(1, len(findings) + 1)), "Ranks must be unique and contiguous from 1")
    if not initial:
        validate_practices(data, slug, instant)
    for row in evidence_rows(data):
        reference = row["evidence"]
        basis = "live_ui" if reference.startswith("ui: ") else "source_review"
        require(data["method"][basis], f"Evidence from an undeclared method: {reference}")
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


def met(value):
    return "Met" if value else "Not met"


def criterion_rows(data):
    plan, results = data["phase_0"], data["success_criteria"]
    role = results["role_tasks"]
    losses = results["data_loss"]
    evidence = results["ai_evidence"]
    adoption = results["would_use"]
    checked = sum(c["result"] != "unverified" for c in data["input_checks"])
    loss_count = len(losses["finding_ids"])
    loss_text = f"{loss_count} {'finding' if loss_count == 1 else 'findings'} ({', '.join(losses['finding_ids']) or 'none'})"
    check_text = f"{checked} observed input {'check' if checked == 1 else 'checks'}"
    return [
        (f"Role tasks unaided ≥{plan['unaided_percent_min']}% (includes W1)", role["met"],
         f"{role['unaided']}/{role['total']} ({100 * role['unaided'] / role['total']:.1f}%)"),
        ("Zero findings of silently lost coach input", losses["met"], f"{loss_text} · {check_text}"),
        (f"Every encountered AI output reaches supporting evidence in ≤{plan['evidence_interactions_max']} actions",
         evidence["met"], f"{evidence['within_budget']}/{evidence['total']} outputs · "
         + ("all encountered outputs inventoried" if data["ai_evidence"]["complete"] else "incomplete inventory")),
        ("Would use this season = yes", adoption["met"], adoption["answer"]),
    ]


def markdown(data, root, round_dir, slug, revision, checks):
    role_doc = (HERE / "agents" / f"{slug}.md").read_text(encoding="utf-8")
    title = role_doc.splitlines()[0].removeprefix("# ").strip()
    persona = section(role_doc, "Persona")
    interview = section((HERE / "PROTOCOL.md").read_text(encoding="utf-8"), "Phase 3 · Interview")
    questions = re.findall(r"^\d+\. (.+)$", interview, re.M)
    require(len(questions) == 13, "The protocol must contain thirteen interview questions")
    method = data["method"]
    lines = [
        DISCLAIMER, "", f"# {title} · {data['round']}", "",
        f"Generated {data['generated_at']} on {revision}.",
        f"Live UI {'yes' if method['live_ui'] else 'no'} · Source review {'yes' if method['source_review'] else 'no'} · "
        + " · ".join(f"{name} {'passed' if status == 0 else f'failed (exit {status})'}" for name, status in checks.items()),
        "", "## Success criteria", "",
        f"Set before the session at {data['phase_0']['set_at']}. Overall **{met(data['success_criteria']['overall_met'])}**.", "",
        "| Phase 0 goal | Result | Observation |", "| --- | --- | --- |",
    ]
    for label, ok, observed in criterion_rows(data):
        lines.append(f"| {label} | {met(ok)} | {cell(observed)} |")
    lines.extend(["", "## Persona", "", persona, "", "## Expectations", ""])
    for prompt, answer in zip(("What does it do?", "Who is it for?", "What happens in ten minutes?"), data["expectations"]):
        lines.extend([f"**{prompt}** {answer}", ""])
    lines.extend(["## Task table", "", "| Task | Attempt | Outcome | Completion | Steps | Simulated think-aloud | Evidence |",
                  "| --- | --- | --- | --- | ---: | --- | --- |"])
    for task in data["tasks"]:
        values = [task['id'] + " · " + task['title'], task['attempted'], task['observed'], task['completion'], task['steps'], task['note']]
        lines.append("| " + " | ".join([*(cell(v) for v in values), evidence_link(task['evidence'], round_dir, root)]) + " |")
    scenario = data["tasks"][-1]
    lines.extend(["", "### W1 · Weekly cycle", "", scenario["context"], "",
                  "| Stage | Steps | Outcome carried forward | Evidence |", "| --- | ---: | --- | --- |"])
    for s in scenario["stages"]:
        lines.append(f"| {s['id'].replace('_', ' ')} | {s['steps']} | {cell(s['observed'])} | {evidence_link(s['evidence'], round_dir, root)} |")
    lines.extend(["", "### Coach input checks", "", "| Task | Action and observed outcome | Result | Finding | Evidence |",
                  "| --- | --- | --- | --- | --- |"])
    for c in data["input_checks"]:
        lines.append(f"| {c['task_id']} | {cell(c['probe'])} | {c['result']} | {c['finding_id'] or '—'} | {evidence_link(c['evidence'], round_dir, root)} |")
    inventory = data["ai_evidence"]
    lines.extend(["", "### AI outputs and supporting evidence", "", inventory["scope"], "",
                  "| Task and output | Count | Actions from output | Result | Observed | Evidence |",
                  "| --- | ---: | --- | --- | --- | --- |"])
    for c in inventory["checks"]:
        actions = " → ".join(c["actions"]) or "—"
        lines.append(f"| {c['task_id']} · {cell(c['route'])} · {cell(c['output'])} | {c['count']} | "
                     f"{len(c['actions'])} · {cell(actions)} | {c['result']} | {cell(c['observed'])} | {evidence_link(c['evidence'], round_dir, root)} |")
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
                      f"| Severity | {finding['severity']} |",
                      f"| Cost of delay | {finding['urgency']} urgency × {finding['value']} value = {finding['cost_of_delay']} |",
                      f"| Weekly cost | {cell(finding['weekly_cost'])} |",
                      f"| MoSCoW | {finding['moscow']} |", f"| Veto stakeholder | {finding['stakeholder']} |",
                      f"| Silently lost coach input | {'yes' if finding['data_loss'] else 'no'} |"])
        for label, key in [("Observed", "observed"), ("Expected", "expected"), ("Proposed change", "proposed_change"), ("Simulated quote", "quote")]:
            lines.append(f"| {label} | {cell(finding[key])} |")
        lines.extend([f"| Evidence | {evidence_link(finding['evidence'], round_dir, root)} |", ""])
    verdict = data["verdict"]
    lines.extend(["## Keep list", "", *(["- " + item for item in data["keep"]] or ["No keep items were established in this session."]), "", "## Verdict", "",
                  f"**Would use** {verdict['would_use']}", "", f"**Would recommend** {verdict['would_recommend']}",
                  "", verdict['condition'], "", "## Learnings", ""])
    for label, key in [("What worked", "worked"), ("What did not", "did_not"), ("What to try next", "try_next")]:
        lines.extend([f"**{label}**", "", data["learnings"][key], ""])
    return "\n".join(lines)


def priority_text(finding):
    return f"#{finding['rank']} / {finding['cost_of_delay']} / {finding['moscow']}"


def comparison_markdown(comparison, baseline, current, root, round_dir, slug, run_id):
    require(isinstance(comparison, dict) and set(comparison) == {"prior", "new"}, "Comparison needs prior and new arrays")
    prior, new = comparison["prior"], comparison["new"]
    require(isinstance(prior, list) and isinstance(new, list), "Comparison prior and new must be arrays")
    old_by_id = {f["id"]: f for f in baseline["findings"]}
    current_by_id = {f["id"]: f for f in current["findings"]}
    old, active = set(old_by_id), set(current_by_id)
    require(all(isinstance(r, dict) and set(r) == {"id", "status", "reason", "evidence"} for r in prior), "Invalid prior comparison row")
    require(len(prior) == len(old) and {r["id"] for r in prior} == old, "Every baseline ID needs exactly one disposition")
    require(len(new) == len(set(new)) and set(new) == active - old, "New IDs must match all new active findings")
    previous_max = max((int(i.split("-")[1]) for i in old), default=0)
    require(all(int(i.split("-")[1]) > previous_max for i in new), "New IDs must follow the prior ID range")
    lines = [DISCLAIMER, "", f"# {slug} · round-2 comparison", "", "| Previous ID | Status | Prior rank / score / MoSCoW | Current rank / score / MoSCoW | Retest and result | Current evidence |",
             "| --- | --- | --- | --- | --- | --- |"]
    for row in sorted(prior, key=lambda r: old_by_id[r["id"]]["rank"]):
        status, fid = row["status"], row["id"]
        require(status in {"resolved", "improved", "unchanged", "regressed"}, f"Invalid disposition for {fid}")
        require((status == "resolved") == (fid not in active), f"Active finding list disagrees with disposition for {fid}")
        require(isinstance(row["reason"], str) and row["reason"].strip(), f"Missing retest reason for {fid}")
        require(isinstance(row["evidence"], str), f"Missing retest evidence for {fid}")
        check_evidence(row["evidence"], root, round_dir, slug, run_id=run_id)
        before = priority_text(old_by_id[fid])
        after = priority_text(current_by_id[fid]) if fid in active else "Resolved"
        lines.append(f"| {fid} | {status} | {before} | {after} | {cell(row['reason'])} | {evidence_link(row['evidence'], round_dir, root)} |")
    lines.extend(["", "## New findings", ""])
    new_findings = sorted((current_by_id[fid] for fid in new), key=lambda f: f["rank"])
    lines.extend([f"- {f['id']} · {priority_text(f)} · {f['title']}" for f in new_findings] or ["None."])
    return "\n".join(lines) + "\n"


def summary(data):
    print(f"\n{data['role']} · {data['round']}")
    if "success_criteria" in data:
        print(f"  Overall {met(data['success_criteria']['overall_met'])}")
        for label, ok, observed in criterion_rows(data):
            print(f"  {label} · {met(ok)} · {observed}")
    for f in sorted(data["findings"], key=lambda f: f["rank"])[:5]:
        priority = priority_text(f) if "moscow" in f else f"#{f['rank']}"
        print(f"  {priority} · {f['id']} [{f['severity']}] {f['title']}")
    for a in data["interview"][10:]:
        print(f"  Q{a['q']} · {a['answer']}")
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
