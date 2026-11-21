"""Run one independent, evidence-backed FootballOS review in a disposable checkout."""
import argparse
import contextlib
import fcntl
import json
import linecache
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from urllib.error import URLError
from urllib.request import urlopen
from uuid import uuid4

from report import (DISCLAIMER, HERE, ROLE_SPECS, comparison_markdown, markdown,
                    read_json, require, summary, validate)

ROOT = HERE.parent.parent
REVIEW_PATH = HERE.relative_to(ROOT)


def revision():
    result = subprocess.run(["git", "rev-parse", "--verify", "HEAD"], cwd=ROOT, capture_output=True, text=True)
    if result.returncode:
        return "the supplied source archive (no Git revision available)"
    changes = subprocess.run(["git", "status", "--porcelain", "--", ".", ":(exclude)tools/review-agents",
                              ":(exclude).codex/agents"], cwd=ROOT, capture_output=True, text=True, check=True)
    return f"commit `{result.stdout.strip()}`" + (" with local application changes" if changes.stdout else "")


def copy_checkout(app, slug):
    """Keep the reviewed working tree, but isolate dependencies, mock edits and prior reviews."""
    def ignore(directory, names):
        directory = Path(directory)
        skip = {"node_modules", ".git", "__pycache__"}
        if directory == ROOT:
            # The mock uses its bundled demo seed. Exclude local API databases and uploaded film.
            skip.add(".data")
        if directory == HERE:
            skip.add("reports")
        if directory == HERE / "agents":
            skip.update(n for n in names if n.endswith(".md") and n != f"{slug}.md")
        if directory == ROOT / ".codex" / "agents":
            native_file = f"footballos_{slug.replace('-', '_')}.toml"
            skip.update(n for n in names if n.startswith("footballos_") and n != native_file)
        if app.is_relative_to(directory):
            # TMPDIR may itself live below the checkout.
            skip.add(app.relative_to(directory).parts[0])
        return skip

    shutil.copytree(ROOT, app, ignore=ignore, symlinks=True)
    reports = app / REVIEW_PATH / "reports"
    reports.mkdir()
    shutil.copy2(HERE / "reports/README.md", reports)


def copy_baseline(app, slug):
    source = HERE / "reports/round-1"
    baseline_path = source / f"{slug}.json"
    require(baseline_path.is_file(), f"Missing same-role baseline: {baseline_path}")
    baseline = read_json(baseline_path)
    # The updated application may have moved or removed a previously cited source line.
    validate(baseline, ROOT, source, slug, source_lines=False)
    dest = app / REVIEW_PATH / "reports/round-1"
    dest.mkdir()
    shutil.copy2(baseline_path, dest)
    refs = {row["evidence"] for row in [*baseline["tasks"], *baseline["findings"]]}
    for ref in refs:
        if ref.startswith("ui: "):
            name = ref.removeprefix("ui: ")
            (dest / name).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source / name, dest / name)
    return baseline


@contextlib.contextmanager
def mock_server(app, work, env):
    log_path = work / "vite.log"
    with log_path.open("w", encoding="utf-8") as log:
        child = subprocess.Popen(["npm", "run", "dev:web"], cwd=app, env=env, stdout=log,
                                 stderr=subprocess.STDOUT, start_new_session=True)
        try:
            deadline = time.monotonic() + 90
            url = None
            while time.monotonic() < deadline and child.poll() is None:
                output = re.sub(r"\x1b\[[0-9;]*m", "", log_path.read_text(encoding="utf-8", errors="replace"))
                match = re.search(r"\bLocal:\s*(http://(?:localhost|127\.0\.0\.1|\[::1\]):\d+[^\s]*)", output)
                if match:
                    try:
                        with urlopen(match[1], timeout=1) as response:
                            if response.status == 200:
                                url = match[1].rstrip("/")
                                break
                    except (OSError, URLError):
                        pass
                time.sleep(0.2)
            require(url, "The mock Vite server did not announce a responding local URL.\n"
                    + log_path.read_text(encoding="utf-8", errors="replace")[-1600:])
            print(f"Mock app listening at {url}", flush=True)
            yield url
        finally:
            # npm launches Vite in a child. Own and stop the entire process group.
            with contextlib.suppress(ProcessLookupError):
                os.killpg(child.pid, signal.SIGTERM)
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                with contextlib.suppress(ProcessLookupError):
                    os.killpg(child.pid, signal.SIGKILL)
                child.wait()


def capture_landing(url, evidence_dir):
    """Confirm the local browser path and save the first, landing-only view."""
    try:
        from playwright.sync_api import Error, sync_playwright
    except ImportError:
        return False
    try:
        with sync_playwright() as playwright:
            options = {}
            if not Path(playwright.chromium.executable_path).is_file():
                executable = shutil.which("chromium") or shutil.which("google-chrome")
                if executable:
                    options["executable_path"] = executable
            with playwright.chromium.launch(**options) as browser:
                page = browser.new_page(viewport={"width": 1440, "height": 960})
                page.goto(url, wait_until="networkidle", timeout=20000)
                page.screenshot(path=evidence_dir / "landing.png", full_page=True)
        return True
    except (Error, OSError) as exc:
        print(f"Landing capture via Python Playwright unavailable: {str(exc).splitlines()[0]}", flush=True)
        return False


def agent_prompt(slug, round_name, url, evidence_relative, checks, run_work, landing_captured):
    role, prefix, _, _ = ROLE_SPECS[slug]
    return f"""Conduct ONE FootballOS simulated-persona review as {role} for {round_name}.
You are already inside the runner. Read the product documents listed in tools/review-agents/PROTOCOL.md
first, then that protocol, tools/review-agents/agents/{slug}.md and tools/review-agents/report.schema.json.
Use only this role. Do not launch another agent or run the launcher again. Keep application code and tests intact.
The lone permitted fixture exception is an absent matching demo identity in this disposable copy, as the protocol describes.
Drive the running local mock UI at {url} and capture screenshots using available browser automation.
Launcher captured the landing page with Python Playwright: {landing_captured}. If true, landing.png is in the
evidence directory. Use fresh Playwright contexts for the actual tasks (system Chromium if needed).
Try Python Playwright (a system Chromium may be available) or the installed browser tools before falling back to source.
Inspect source as needed. Keep environment failures separate from product findings. Only use seeded or synthetic data.
Before visiting /sign-in, save the three landing-only expectations as a JSON array in {run_work}/expectations.json.
Write screenshots into tools/review-agents/reports/{round_name}/{evidence_relative}. In JSON use exactly
"ui: {evidence_relative}/file.png" or "source: repo/relative/file.tsx:42". Tag source interpretations in observed text.
Choose the highest-impact supported findings. Give one disposition for missing role tasks as described in the protocol.
In {run_work}/report.json write the schema-conforming sidecar with role {role}, round {round_name}, {prefix}- IDs
and the current UTC ISO timestamp. The tests ran; exit codes are {checks}. Use the exact saved expectations.
Include attempted, observed, evidence and the simulated note in every task. The first JSON key is disclaimer with the
exact text "{DISCLAIMER}".
For round-2 only, AFTER the independent task walkthrough consult tools/review-agents/reports/round-1/{slug}.json.
Follow tools/review-agents/compare.md and write {run_work}/comparison.json. Keep unresolved original IDs.
The parent validates and renders Markdown, then publishes results. Do not write output into the original checkout.
"""


def run_agent(prompt, app, work, env, slug, native):
    if not native:
        cmd = ["codex", "exec", "--ephemeral", "--skip-git-repo-check", "--sandbox", "workspace-write",
               "-c", "sandbox_workspace_write.network_access=true", "-"]
        subprocess.run(cmd, cwd=app, input=prompt, text=True, env=env, check=True)
        return

    instructions = work / "instructions.txt"
    instructions.write_text(prompt, encoding="utf-8")
    print(f"Native agent: footballos_{slug.replace('-', '_')}\nWorking directory: {app}\n"
          f"Instructions: {instructions}\n"
          "Complete this review in the working directory above. After closing every output file, "
          "create READY beside instructions.txt. To end a blocked run, put the reason in BLOCKED there.",
          flush=True)
    while not (work / "READY").is_file():
        blocked = work / "BLOCKED"
        if blocked.is_file():
            raise ValueError(blocked.read_text(encoding="utf-8").strip() or "Native review blocked")
        time.sleep(0.5)


def publish(round_dir, slug, run_id, evidence_dir, files):
    round_dir.mkdir(parents=True, exist_ok=True)
    role_evidence = round_dir / "evidence" / slug
    role_evidence.mkdir(parents=True, exist_ok=True)
    # Serialize just publication of this role. Keep prior evidence addressable on a re-run.
    lock_fd = os.open(role_evidence, os.O_RDONLY)
    try:
        fcntl.flock(lock_fd, fcntl.LOCK_EX)
        with tempfile.TemporaryDirectory(dir=round_dir) as pending:
            pending = Path(pending)
            backups = {}
            for name, content in files.items():
                (pending / name).write_text(content, encoding="utf-8")
                existing = round_dir / name
                if existing.exists():
                    backups[name] = pending / (name + ".before")
                    shutil.copy2(existing, backups[name])
            shutil.copytree(evidence_dir, pending / "screens")
            (pending / "screens").rename(role_evidence / run_id)
            changed = []
            try:
                for name in files:
                    (pending / name).replace(round_dir / name)
                    changed.append(name)
            except BaseException:
                for name in reversed(changed):
                    if name in backups:
                        backups[name].replace(round_dir / name)
                    else:
                        (round_dir / name).unlink()
                shutil.rmtree(role_evidence / run_id)
                raise
    finally:
        os.close(lock_fd)


def run(slug, round_name, native):
    scripts = read_json(ROOT / "package.json").get("scripts", {})
    require((ROOT / "apps/web").is_dir() and "dev:web" in scripts,
            "This checkout lacks the FootballOS workspace (apps/web and the root dev:web script). "
            "Run from the integration source. No round report was produced.")
    for tool in (["npm"] if native else ["npm", "codex"]):
        require(shutil.which(tool), f"Missing executable: {tool}")
    source = revision()
    print(f"Reviewing {source} as {slug} · {round_name}", flush=True)
    env = dict(os.environ, VITE_API_MODE="mock", CI="1", NO_COLOR="1")
    with tempfile.TemporaryDirectory(prefix="footballos-review-") as temp:
        app = Path(temp).resolve() / "checkout"
        copy_checkout(app, slug)
        baseline = copy_baseline(app, slug) if round_name == "round-2" else None
        round_dir = app / REVIEW_PATH / "reports" / round_name
        run_id = uuid4().hex
        evidence_relative = f"evidence/{slug}/{run_id}"
        evidence_dir = round_dir / evidence_relative
        evidence_dir.mkdir(parents=True)
        work = round_dir / ".session"
        work.mkdir()
        subprocess.run(["npm", "install", "--no-audit", "--no-fund"], cwd=app, env=env, check=True)
        checks = {}
        for label, command in [("Typecheck", ["npm", "run", "typecheck"]), ("Tests", ["npm", "test"])]:
            checks[label] = subprocess.run(command, cwd=app, env=env).returncode
        with mock_server(app, work, env) as url:
            landing_captured = capture_landing(url, evidence_dir)
            prompt = agent_prompt(slug, round_name, url, evidence_relative, checks, work.relative_to(app), landing_captured)
            run_agent(prompt, app, work, env, slug, native)
        data = read_json(work / "report.json")
        require(data["expectations"] == read_json(work / "expectations.json"), "Landing expectations changed after phase 1")
        if landing_captured:
            require(data["method"]["live_ui"], "A live browser was available; record the browser walkthrough")
        validate(data, app, round_dir, slug, run_id=run_id)
        require(data["method"]["tests_run"], "Test execution is missing from the method record")
        files = {f"{slug}.md": markdown(data, app, round_dir, slug, source, checks)}
        rows = [*data["tasks"], *data["findings"]]
        if baseline is not None:
            comparison = read_json(work / "comparison.json")
            files[f"{slug}-comparison.md"] = comparison_markdown(
                comparison, baseline, data, app, round_dir, slug, run_id)
            rows.extend(comparison["prior"])
        # A temporary demo account can shift line numbers. Only publish portable citations.
        for ref in {row["evidence"] for row in rows if row["evidence"].startswith("source: ")}:
            path, number = ref.removeprefix("source: ").rsplit(":", 1)
            original = linecache.getline(str(ROOT / path), int(number))
            require(original and original == linecache.getline(str(app / path), int(number)),
                    f"Source citation differs from the reviewed checkout: {ref}")
        # Commit the validated machine-readable sidecar last.
        files[f"{slug}.json"] = json.dumps(data, indent=2, ensure_ascii=False) + "\n"
        target = HERE / "reports" / round_name
        publish(target, slug, run_id, evidence_dir, files)
        for name in files:
            print((target / name).relative_to(ROOT))
        summary(data)
        return 1 if any(checks.values()) else 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("role", choices=ROLE_SPECS)
    parser.add_argument("round", choices=("round-1", "round-2"))
    parser.add_argument("--native", action="store_true", help="use the calling native Codex agent in this review session")
    args = parser.parse_args()

    def terminate(signum, _frame):
        raise SystemExit(128 + signum)

    signal.signal(signal.SIGTERM, terminate)
    try:
        sys.exit(run(args.role, args.round, args.native))
    except (ValueError, OSError, KeyError, subprocess.CalledProcessError) as exc:
        sys.exit(f"Review could not finish: {exc}")
