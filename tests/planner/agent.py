from __future__ import annotations

import json
import subprocess
from datetime import datetime
from pathlib import Path

import yaml

from providers import LLMProvider

MAESTRO_SYSTEM = """\
You are an expert in the Maestro mobile UI testing framework.
Generate a valid Maestro YAML flow for a React Native iOS app.
App bundle ID: com.kliuchnikovv.genie
Known UI elements: "Planner" (screen title), "Chat" (button), "Plan" (button).
Maestro YAML format:
---
appId: com.kliuchnikovv.genie
---
- launchApp
- tapOn: "Plan"
- typeText: "text"
- assertVisible: "expected text"
- waitForAnimationToEnd
- scrollUntilVisible:
    element: "text"
    direction: DOWN

Return ONLY the YAML content, no markdown fences, no explanation.\
"""

ANALYSIS_SYSTEM = """\
You are a QA analyst reviewing mobile test results.
Given Maestro output and success criteria, determine PASS or FAIL.
Return JSON only: {"result": "PASS" or "FAIL", "reason": "one sentence", "failed_criteria": ["list"]}\
"""


def generate_flow(provider: LLMProvider, path_descriptor: dict) -> str:
    user = (
        f"Path: {path_descriptor['name']}\n"
        f"Description: {path_descriptor['description']}\n\n"
        f"Input tasks:\n{yaml.dump(path_descriptor['input_tasks'])}\n"
        f"Clarification answers (respond with these if asked):\n"
        f"{yaml.dump(path_descriptor.get('clarification_answers', {}))}\n"
        f"Success criteria:\n{yaml.dump(path_descriptor['success_criteria'])}"
    )
    return provider.complete(MAESTRO_SYSTEM, user, None)


def run_maestro(flow_yaml: str, flow_dir: Path) -> tuple[int, str, list[Path]]:
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    flow_path = flow_dir / f"flow_{timestamp}.yaml"
    flow_path.write_text(flow_yaml)

    result = subprocess.run(
        ["maestro", "test", str(flow_path)],
        capture_output=True,
        text=True,
        timeout=300,
    )

    maestro_output_dir = Path.home() / ".maestro" / "tests"
    screenshots = sorted(maestro_output_dir.glob("**/*.png"))[-10:] if maestro_output_dir.exists() else []

    return result.returncode, result.stdout + result.stderr, screenshots


def analyze_results(
    provider: LLMProvider,
    log: str,
    success_criteria: list[str],
    screenshots: list[Path],
) -> dict:
    user = f"Test log:\n{log[:3000]}\n\nSuccess criteria:\n{yaml.dump(success_criteria)}"
    images = [p.read_bytes() for p in screenshots[:3]] if provider.supports_vision and screenshots else None
    raw = provider.complete(ANALYSIS_SYSTEM, user, images)
    raw = raw.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    return json.loads(raw)


def save_report(result_dir: Path, path_id: int, analysis: dict, log: str) -> Path:
    result_dir.mkdir(parents=True, exist_ok=True)
    report_path = result_dir / "report.md"
    status = "✅ PASS" if analysis["result"] == "PASS" else "❌ FAIL"
    failed = analysis.get("failed_criteria", [])
    failed_section = (
        "**Failed criteria:**\n" + "\n".join(f"- {c}" for c in failed) + "\n\n"
        if failed
        else ""
    )
    report_path.write_text(
        f"# Path {path_id:02d} — {status}\n\n"
        f"**Reason:** {analysis['reason']}\n\n"
        f"{failed_section}"
        f"## Maestro Log\n\n```\n{log}\n```\n"
    )
    return report_path


def run_test(
    provider: LLMProvider,
    path_descriptor: dict,
    flows_dir: Path,
    results_dir: Path,
) -> dict:
    path_id = path_descriptor["id"]
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    result_dir = results_dir / f"{path_id:02d}_{timestamp}"

    flow_yaml = generate_flow(provider, path_descriptor)
    exit_code, log, screenshots = run_maestro(flow_yaml, flows_dir)
    analysis = analyze_results(provider, log, path_descriptor["success_criteria"], screenshots)
    report_path = save_report(result_dir, path_id, analysis, log)

    icon = "✅" if analysis["result"] == "PASS" else "❌"
    print(f"{icon} {analysis['result']} — {analysis['reason']}")
    print(f"   Report: {report_path}")
    return analysis
