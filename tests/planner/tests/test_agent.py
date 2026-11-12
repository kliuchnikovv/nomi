import subprocess
from pathlib import Path
from unittest.mock import MagicMock, patch


SAMPLE_PATH = {
    "id": 1,
    "name": "Simple plan",
    "description": "Basic test",
    "input_tasks": [{"text": "Run", "chips": []}],
    "clarification_answers": {},
    "success_criteria": ["Tasks visible"],
}


def _make_provider(response: str, vision: bool = False) -> MagicMock:
    p = MagicMock()
    p.complete.return_value = response
    p.supports_vision = vision
    return p


def test_generate_flow_returns_yaml():
    from agent import generate_flow
    provider = _make_provider("appId: com.kliuchnikovv.nomi\n---\n- launchApp")
    result = generate_flow(provider, SAMPLE_PATH)
    assert "launchApp" in result
    provider.complete.assert_called_once()
    system, user, images = provider.complete.call_args.args[:3]
    assert "Maestro" in system
    assert "Simple plan" in user
    assert images is None


def test_analyze_results_pass():
    from agent import analyze_results
    provider = _make_provider('{"result": "PASS", "reason": "All good", "failed_criteria": []}')
    result = analyze_results(provider, log="OK", success_criteria=["Tasks visible"], screenshots=[])
    assert result["result"] == "PASS"
    assert result["reason"] == "All good"


def test_analyze_results_fail():
    from agent import analyze_results
    provider = _make_provider('{"result": "FAIL", "reason": "Missing chip", "failed_criteria": ["Tasks visible"]}')
    result = analyze_results(provider, log="ERROR", success_criteria=["Tasks visible"], screenshots=[])
    assert result["result"] == "FAIL"
    assert "Tasks visible" in result["failed_criteria"]


def test_analyze_results_strips_markdown_fences():
    from agent import analyze_results
    provider = _make_provider('```json\n{"result": "PASS", "reason": "OK", "failed_criteria": []}\n```')
    result = analyze_results(provider, log="", success_criteria=[], screenshots=[])
    assert result["result"] == "PASS"


def test_analyze_results_sends_images_when_vision(tmp_path):
    from agent import analyze_results
    img_path = tmp_path / "shot.png"
    img_path.write_bytes(b"fakeimage")
    provider = _make_provider('{"result": "PASS", "reason": "OK", "failed_criteria": []}', vision=True)
    analyze_results(provider, log="", success_criteria=[], screenshots=[img_path])
    images = provider.complete.call_args.args[2]
    assert images is not None and len(images) > 0


def test_analyze_results_no_images_when_no_vision(tmp_path):
    from agent import analyze_results
    img_path = tmp_path / "shot.png"
    img_path.write_bytes(b"fakeimage")
    provider = _make_provider('{"result": "PASS", "reason": "OK", "failed_criteria": []}', vision=False)
    analyze_results(provider, log="", success_criteria=[], screenshots=[img_path])
    images = provider.complete.call_args.args[2]
    assert images is None


def test_run_maestro_returns_exit_code_and_log(tmp_path):
    from agent import run_maestro
    flow_yaml = "appId: com.kliuchnikovv.nomi\n---\n- launchApp"
    with patch("subprocess.run") as mock_run:
        mock_run.return_value = MagicMock(returncode=0, stdout="PASS", stderr="")
        exit_code, log, screenshots = run_maestro(flow_yaml, tmp_path)
    assert exit_code == 0
    assert "PASS" in log
    assert isinstance(screenshots, list)


def test_save_report_creates_file(tmp_path):
    from agent import save_report
    analysis = {"result": "PASS", "reason": "All good", "failed_criteria": []}
    path = save_report(tmp_path, path_id=1, analysis=analysis, log="test log")
    assert path.exists()
    content = path.read_text()
    assert "PASS" in content
    assert "All good" in content


def test_save_report_includes_failed_criteria(tmp_path):
    from agent import save_report
    analysis = {"result": "FAIL", "reason": "Missing", "failed_criteria": ["Tasks visible"]}
    path = save_report(tmp_path, path_id=2, analysis=analysis, log="")
    assert "Tasks visible" in path.read_text()
